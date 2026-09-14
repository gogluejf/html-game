#!/usr/bin/env python3
"""Deterministic sprite-frame extractor for transparent-background sheets.

Design rule (SPRITE_EXTRACTION_README): a frame is a cluster of related
foreground content, NOT a grid cell. Rectangles are an output format, derived
from foreground ownership — never the mechanism used to discover frames.

Pipeline:
  alpha mask -> connected components -> row grouping -> per-row frame
  clustering (constrained by expected counts) -> component ownership
  (satellites assigned by distance) -> bounding-rect crops -> validation.

Every stage prints a readable trace; --json also dumps the full result tree.

Subcommands:
  extract  --sheet PATH --out DIR --rows R1,R2,... [--names n1,n2,...]
           [--actions a1,a2,...] [--margin N] [--alpha-threshold N]
           [--satellite-max-area N] [--satellite-radius N] [--min-comp N]
           [--row-y y0-y1,y0-y1,...] [--col-x row:x1,x2;row:x1,x2]
           [--trace] [--json OUT.json]
  report   --dir DIR
"""
import argparse
import json
import os
import re
import sys
from collections import defaultdict


def load_rgba(path):
    from PIL import Image
    im = Image.open(path).convert("RGBA")
    return im


def connected_components(mask, min_area=0):
    """4-connected labeling on a boolean numpy mask. Returns list of dicts."""
    import numpy as np
    from scipy import ndimage
    labels, n = ndimage.label(mask)
    comps = []
    if n == 0:
        return comps
    areas = ndimage.sum(mask, labels, index=list(range(1, n + 1)))
    slices = ndimage.find_objects(labels)
    for i in range(n):
        area = int(areas[i])
        if area < min_area:
            continue
        sl = slices[i]
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        # centroid via label sum
        ys, xs = np.where(labels == (i + 1))
        cy = int(ys.mean())
        cx = int(xs.mean())
        comps.append({
            "id": i + 1,
            "area": area,
            "bbox": [x0, y0, x1, y1],
            "centroid": [cx, cy],
        })
    return comps


def density_bands(profile, thresh, min_band=8, min_gap=6):
    """Find contiguous bands where profile >= thresh; merge bands separated
    by gaps smaller than min_gap. profile: 1-D array of ink counts per line."""
    bands = []
    i = 0
    n = len(profile)
    while i < n:
        if profile[i] >= thresh:
            s = i
            while i < n and profile[i] >= thresh:
                i += 1
            bands.append([s, i])
        else:
            i += 1
    # drop edge-margin-only bands handled by caller; merge sliver gaps
    merged = [list(bands[0])] if bands else []
    for b in bands[1:]:
        if b[0] - merged[-1][1] < min_gap:
            merged[-1][1] = b[1]
        else:
            merged.append(list(b))
    return [b for b in merged if b[1] - b[0] >= min_band]


def group_rows(mask, W, H, trace):
    """Project foreground onto y-axis -> row bands."""
    import numpy as np
    yprof = mask.sum(axis=1)
    thresh = max(2, W // 400)
    bands = density_bands(yprof, thresh, min_band=8, min_gap=6)
    trace("[3] ROW GROUPING")
    trace(f"    y-density profile -> {len(bands)} row band(s), threshold={thresh}")
    for i, (y0, y1) in enumerate(bands):
        trace(f"    row {i}: y {y0}-{y1} (height {y1 - y0})")
    return bands


def cluster_row(row_mask, y0, y1, expected, trace, row_idx):
    """Cluster one row's foreground into `expected` frame groups.

    Strategy: x-density profile within the row band; find interior valleys
    (gaps or low-density zones). If we get exactly expected-1 usable
    separators, split there. Otherwise fall back to even division of the
    inked width. Wide frames emerge naturally when a separator is missing.
    Returns list of [x0, x1] spans (in sheet coords).
    """
    import numpy as np
    H_r = y1 - y0
    xprof = row_mask.sum(axis=0)
    inked = np.where(xprof > 0)[0]
    if len(inked) == 0:
        return []
    xs, xe = int(inked[0]), int(inked[-1] + 1)

    # candidate separators: runs of zero (or near-zero) ink inside the row
    sep_thresh = max(1, int(H_r * 0.05))
    seps = []
    i = xs
    while i < xe:
        if xprof[i] <= sep_thresh:
            s = i
            while i < xe and xprof[i] <= sep_thresh:
                i += 1
            seps.append((s, i))
        else:
            i += 1
    # keep only interior separators with some width.
    # A true interior separator must be separated from BOTH inked edges by
    # real content — otherwise it's just an outer margin, not a frame boundary.
    # Require a minimum "ink wall" on each side so edge margins are excluded.
    min_wall = max(8, int((xe - xs) * 0.02))
    seps = [s for s in seps
            if s[0] > xs + min_wall and s[1] < xe - min_wall and s[1] - s[0] >= 2]

    spans = None
    method = "gap-split"
    if len(seps) == expected - 1:
        bounds = [xs] + [(a + b) // 2 for a, b in seps] + [xe]
        spans = [[bounds[i], bounds[i + 1]] for i in range(expected)]
    elif len(seps) >= expected - 1:
        # more separators than needed: take the deepest (widest) ones
        seps.sort(key=lambda s: s[1] - s[0], reverse=True)
        seps = sorted(seps[: expected - 1])
        bounds = [xs] + [(a + b) // 2 for a, b in seps] + [xe]
        spans = [[bounds[i], bounds[i + 1]] for i in range(expected)]
    else:
        # not enough clean gaps (overlap / fragmentation): even division
        method = "even-division"
        w = (xe - xs) / expected
        spans = [[int(xs + i * w), int(xs + (i + 1) * w)] for i in range(expected)]

    trace(f"    row {row_idx}: {method} -> {len(spans)} span(s) (expected {expected})")
    for i, (a, b) in enumerate(spans):
        trace(f"      frame {i + 1}: x {a}-{b} (width {b - a}, center {(a + b) // 2})")
    return spans


def assign_components(comps, spans, y0, y1, sat_max_area, sat_radius, trace, row_idx):
    """Assign each component to a frame span.

    Primary: centroid falls inside a span.
    Satellite fallback: small components whose centroid misses all spans
    (or sits between them) join the nearest span center within sat_radius.
    Returns (assignments dict comp_id->span_idx, flags list).
    """
    centers = [(a + b) // 2 for a, b in spans]
    assignments = {}
    flags = []
    for c in comps:
        cx, cy = c["centroid"]
        hit = None
        for si, (a, b) in enumerate(spans):
            if a <= cx < b:
                hit = si
                break
        if hit is not None:
            assignments[c["id"]] = hit
            continue
        # satellite path
        if c["area"] > sat_max_area:
            flags.append({"comp": c["id"], "area": c["area"],
                          "reason": "large component outside all spans — unassigned"})
            continue
        best, best_d = None, None
        for si, cc in enumerate(centers):
            d = abs(cx - cc)
            if best_d is None or d < best_d:
                best, best_d = si, d
        if best is None or best_d > sat_radius:
            flags.append({"comp": c["id"], "area": c["area"],
                          "reason": f"satellite too far ({best_d}px from frame {best + 1}) — unassigned"})
            continue
        # confidence: margin vs second-nearest center
        dists = sorted(abs(cx - cc) for cc in centers)
        margin = dists[1] - dists[0] if len(dists) > 1 else 9999
        conf = "low" if margin < 12 else "ok"
        assignments[c["id"]] = best
        if conf == "low":
            flags.append({"comp": c["id"], "area": c["area"], "frame": best + 1,
                          "reason": f"satellite close to two frames (margin {margin}px)"})
    trace(f"    row {row_idx}: {len(assignments)}/{len(comps)} components assigned, "
          f"{len(flags)} flag(s)")
    for f in flags:
        trace(f"      FLAG comp #{f['comp']} (area {f['area']}): {f['reason']}")
    return assignments, flags


def crop_frames(im, comps, assignments, spans, rows, names, actions, out_dir, margin, trace):
    """Build one bounding rect per frame from owned pixels; crop RGBA.

    Before saving, erases any foreground pixel whose component is NOT owned
    by this frame (prevents cross-contamination when frames overlap in
    x-space). Each frame is cropped independently from the original image.
    """
    import numpy as np
    from scipy import ndimage
    arr = np.array(im)
    alpha = arr[:, :, 3]
    # Per-pixel component label map (0 = background)
    fg_mask = alpha > 16
    comp_labels, _ = ndimage.label(fg_mask)
    os.makedirs(out_dir, exist_ok=True)
    results = []
    for r, (y0, y1) in enumerate(rows):
        name = names[r] if names else f"row{r + 1}"
        action = actions[r] if actions else "anim"
        for si, (sx0, sx1) in enumerate(spans[r]):
            owned = [c for c in comps
                     if assignments.get(c["id"]) == si and rows_match(c, (y0, y1))]
            if not owned:
                trace(f"    WARN: frame {name}_{action}_f{si + 1} has no owned components — skipped")
                continue
            fx0 = min(c["bbox"][0] for c in owned)
            fy0 = min(c["bbox"][1] for c in owned)
            fx1 = max(c["bbox"][2] for c in owned)
            fy1 = max(c["bbox"][3] for c in owned)
            fx0 = max(0, fx0 - margin)
            fy0 = max(0, fy0 - margin)
            fx1 = min(arr.shape[1], fx1 + margin)
            fy1 = min(arr.shape[0], fy1 + margin)
            fn = f"{name}_{action}_f{si + 1}.png"
            # Crop from original, then erase unowned foreground pixels
            crop_arr = arr[fy0:fy1, fx0:fx1].copy()
            crop_labels = comp_labels[fy0:fy1, fx0:fx1]
            owned_ids = set(c["id"] for c in owned)
            # Erase: foreground pixels whose component is not owned by this frame
            fg_in_crop = crop_arr[:, :, 3] > 16
            unowned = fg_in_crop & ~np.isin(crop_labels, list(owned_ids))
            erased = int(unowned.sum())
            crop_arr[unowned, 3] = 0
            from PIL import Image
            Image.fromarray(crop_arr).save(os.path.join(out_dir, fn))
            # edge-touching check on the CLEANED crop
            clean_alpha = crop_arr[:, :, 3]
            edge_px = bool(clean_alpha[0].sum() > 0 or clean_alpha[-1].sum() > 0 or
                           clean_alpha[:, 0].sum() > 0 or clean_alpha[:, -1].sum() > 0)
            results.append({
                "file": fn,
                "entity": name,
                "action": action,
                "frame": si + 1,
                "row": r,
                "bbox": [fx0, fy0, fx1 - fx0, fy1 - fy0],
                "size": [fx1 - fx0, fy1 - fy0],
                "center": [(fx0 + fx1) // 2, (fy0 + fy1) // 2],
                "components": len(owned),
                "erased_pixels": erased,
                "edge_touching": edge_px,
            })
            touch = " EDGE-TOUCH" if edge_px else ""
            erased_note = f" erased={erased}" if erased else ""
            trace(f"    {fn}: {fx1 - fx0}x{fy1 - fy0} @ ({fx0},{fy0}) "
                  f"center ({(fx0 + fx1) // 2},{(fy0 + fy1) // 2}) "
                  f"comps={len(owned)}{erased_note}{touch}")
    return results


def rows_match(comp, row_band):
    y0, y1 = row_band
    cy = comp["centroid"][1]
    return y0 - 4 <= cy < y1 + 4


def validate(results, expected_counts, trace):
    """Structural + pixel-level checks against the assessment."""
    issues = []
    total_expected = sum(expected_counts)
    got = len(results)
    trace("[7] VALIDATION")
    if got != total_expected:
        issues.append(f"expected {total_expected} frames, got {got}")
        trace(f"    COUNT MISMATCH: expected {total_expected}, got {got}")
    else:
        trace(f"    count OK: {got}/{total_expected}")
    for r in results:
        if r["edge_touching"]:
            issues.append(f"{r['file']}: foreground touches crop edge (possible clip)")
            trace(f"    EDGE-TOUCH: {r['file']}")
        if r["size"][0] < 8 or r["size"][1] < 8:
            issues.append(f"{r['file']}: suspiciously tiny ({r['size'][0]}x{r['size'][1]})")
            trace(f"    TINY: {r['file']}")
    if not issues:
        trace("    PASS: no structural issues")
    return issues


def cmd_extract(args):
    import numpy as np
    lines = []

    def trace(msg=""):
        print(msg)
        lines.append(msg)

    im = load_rgba(args.sheet)
    W, H = im.size
    arr = np.array(im)
    alpha = arr[:, :, 3]

    trace("[1] ALPHA MASK")
    fg = alpha > args.alpha_threshold
    fg_px = int(fg.sum())
    trace(f"    sheet: {W}x{H}, foreground pixels: {fg_px} "
          f"({100.0 * fg_px / (W * H):.1f}%), threshold: {args.alpha_threshold}")
    if fg_px == 0:
        trace("    FAIL: no foreground found — is the background actually transparent?")
        sys.exit(1)

    trace("[2] CONNECTED COMPONENTS")
    comps = connected_components(fg, min_area=args.min_comp)
    small = [c for c in comps if c["area"] <= args.satellite_max_area]
    trace(f"    total: {len(comps)} components (min kept: {args.min_comp}px, "
          f"max: {max(c['area'] for c in comps)}px)")
    for c in sorted(comps, key=lambda c: -c["area"])[:12]:
        x0, y0, x1, y1 = c["bbox"]
        trace(f"    #{c['id']:>3} area {c['area']:>7} bbox {x0}-{x1} x {y0}-{y1} "
              f"centroid ({c['centroid'][0]},{c['centroid'][1]})")
    if len(comps) > 12:
        trace(f"    ... {len(comps) - 12} more")
    trace(f"    small (<={args.satellite_max_area}px): {len(small)} -> satellite candidates")

    expected = [int(x) for x in args.rows.split(",")]
    if getattr(args, "row_y", None):
        # explicit row bands: y0-y1,y0-y1,... (skips auto-detection)
        rows = []
        for part in args.row_y.split(","):
            a, b = part.split("-")
            rows.append((int(a), int(b)))
        trace(f"[3] ROW GROUPING (manual --row-y: {len(rows)} bands)")
        for i, (y0, y1) in enumerate(rows):
            trace(f"    row {i}: y {y0}-{y1}")
    else:
        rows = group_rows(fg, W, H, trace)
    if len(rows) != len(expected):
        trace(f"    WARN: {len(rows)} row bands but {len(expected)} rows expected. "
              f"Check the sheet assessment or pass --row-y manually.")
        if len(rows) < len(expected):
            trace("    FAIL: cannot map expected rows onto fewer measured bands.")
            sys.exit(1)

    names = [n.strip() for n in args.names.split(",")] if args.names else None
    actions = [a.strip() for a in args.actions.split(",")] if args.actions else None
    # single name/action applies to all rows (one entity, multiple animations)
    if names and len(names) == 1 and len(expected) > 1:
        names = names * len(expected)
    if actions and len(actions) == 1 and len(expected) > 1:
        actions = actions * len(expected)
    if names and len(names) != len(expected):
        print(f"ERROR: {len(names)} names but {len(expected)} rows", file=sys.stderr)
        sys.exit(1)
    if actions and len(actions) != len(expected):
        print(f"ERROR: {len(actions)} actions but {len(expected)} rows", file=sys.stderr)
        sys.exit(1)

    trace("[4] FRAME CLUSTERING")
    # Parse --col-x if provided: "row_idx:x1,x2,...;row_idx:x1,x2,..."
    manual_cols = {}
    if getattr(args, "col_x", None):
        for part in args.col_x.split(";"):
            part = part.strip()
            if not part:
                continue
            row_str, xs_str = part.split(":")
            row_idx = int(row_str.strip())
            splits = [int(x.strip()) for x in xs_str.split(",")]
            manual_cols[row_idx] = splits
        trace(f"    manual --col-x overrides for rows: {list(manual_cols.keys())}")

    all_spans = []
    for r, (y0, y1) in enumerate(rows[: len(expected)]):
        if r in manual_cols:
            # Use manual split points: boundaries are [0, split1, split2, ..., W]
            splits = manual_cols[r]
            bounds = [0] + splits + [W]
            spans = [[bounds[i], bounds[i + 1]] for i in range(len(bounds) - 1)]
            # If span count doesn't match expected, warn
            if len(spans) != expected[r]:
                trace(f"    WARN: row {r} manual col-x gives {len(spans)} spans, expected {expected[r]}")
            trace(f"    row {r}: manual-col-x -> {len(spans)} span(s) at x={splits}")
            for i, (a, b) in enumerate(spans):
                trace(f"      frame {i + 1}: x {a}-{b} (width {b - a})")
        else:
            row_mask = fg[y0:y1, :]
            spans = cluster_row(row_mask, y0, y1, expected[r], trace, r)
            if len(spans) != expected[r]:
                trace(f"    WARN: row {r} produced {len(spans)} spans, expected {expected[r]}")
        all_spans.append(spans)

    trace("[5] OWNERSHIP")
    all_assignments = {}
    all_flags = []
    for r, (y0, y1) in enumerate(rows[: len(expected)]):
        row_comps = [c for c in comps if rows_match(c, (y0, y1))]
        # local comp ids -> global: assign within row, keyed by comp id
        a, fl = assign_components(row_comps, all_spans[r], y0, y1,
                                  args.satellite_max_area, args.satellite_radius,
                                  trace, r)
        all_assignments.update(a)
        all_flags.extend(fl)

    trace("[6] BOUNDING RECTS + CROPS")
    results = crop_frames(im, comps, all_assignments, all_spans,
                          rows[: len(expected)], names, actions,
                          args.out, args.margin, trace)

    issues = validate(results, expected, trace)

    summary = {
        "sheet": args.sheet,
        "size": [W, H],
        "foreground_pixels": fg_px,
        "components": len(comps),
        "rows_measured": len(rows),
        "rows_used": len(expected),
        "expected_frames": sum(expected),
        "frames_cropped": len(results),
        "flags": all_flags,
        "issues": issues,
        "frames": results,
        "out_dir": args.out,
    }
    if args.json:
        with open(args.json, "w") as f:
            json.dump(summary, f, indent=2)
        trace(f"\nJSON WRITTEN: {args.json}")
    status = "PASS" if not issues else "ISSUES"
    trace(f"\nSUMMARY: {status} — {len(results)}/{sum(expected)} frames -> {args.out}")
    return 0 if not issues else 2


def cmd_report(args):
    from PIL import Image
    files = sorted(f for f in os.listdir(args.dir) if f.endswith(".png"))
    sizes = defaultdict(list)
    for f in files:
        w, h = Image.open(os.path.join(args.dir, f)).size
        sizes[f"{w}x{h}"].append(f)
    print(f"{len(files)} PNGs in {args.dir}")
    for s, fl in sorted(sizes.items()):
        print(f"  {s}: {len(fl)} frames")
        for f in fl:
            m = re.match(r"^(.+?)_(.+)_f(\d+)\.png$", f)
            if m:
                print(f"    {f}  [{m.group(1)}/{m.group(2)}]")
            else:
                print(f"    {f}")


def main():
    p = argparse.ArgumentParser(description="Foreground-ownership sprite frame extractor")
    sub = p.add_subparsers(dest="cmd")
    ex = sub.add_parser("extract")
    ex.add_argument("--sheet", required=True)
    ex.add_argument("--out", required=True)
    ex.add_argument("--rows", required=True, help="expected frames per row, e.g. 5,4,5")
    ex.add_argument("--names", help="one entity name per row, comma-separated")
    ex.add_argument("--actions", help="one action word per row, comma-separated")
    ex.add_argument("--margin", type=int, default=4, help="transparent safety margin px")
    ex.add_argument("--alpha-threshold", type=int, default=16)
    ex.add_argument("--satellite-max-area", type=int, default=400,
                    help="components at/below this area may be assigned as satellites")
    ex.add_argument("--satellite-radius", type=int, default=160,
                    help="max distance from a frame center for satellite assignment")
    ex.add_argument("--min-comp", type=int, default=4, help="drop components smaller than this")
    ex.add_argument("--row-y", help="manual row bands y0-y1,y0-y1,... (skips auto-detection)")
    ex.add_argument("--col-x", help="manual column split points per row, e.g. '0:300,600;1:400,800' "
                    "(row_idx:x_split1,x_split2,...). Forces frame boundaries at given x coords, "
                    "bypassing auto gap detection for that row. Use when glow/effects glue poses together.")
    ex.add_argument("--json", help="also write full result JSON here")
    rp = sub.add_parser("report")
    rp.add_argument("--dir", required=True)
    args = p.parse_args()
    {"extract": cmd_extract, "report": cmd_report}[args.cmd](args)


if __name__ == "__main__":
    main()
