#!/usr/bin/env python3
"""reassemble.py — additive per-anim sheet builder for split-sheet-per-anim.

For each (entity, anim) group in a sheet JSON: glue the existing frame PNGs
into a fresh sheet that reproduces the old grid footprint, write
{anim}_sheet.png + twin {anim}_sheet.json with exact bbox coords.

Never deletes or overwrites. Run audit.py first; hard errors abort here too.
"""
import json, glob, os, sys, datetime
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import glob as _glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root


def frame_dir(jf, entity_name):
    base = os.path.dirname(jf)
    if os.path.basename(base) == "_sheets":
        return os.path.join(os.path.dirname(base), entity_name)
    return base


def find_sheet_jsons(projects=None, include_single=True):
    """Multi-entity sheet JSONs via os.walk (no glob patterns — see audit.py)."""
    out = []
    for root, dirs, files in os.walk(ROOT):
        if "/.git" in root or os.path.basename(root) == ".git":
            continue
        for f in files:
            if not f.endswith("_sheet.json"):
                continue
            p = os.path.join(root, f)
            try:
                d = json.load(open(p))
            except Exception:
                continue
            if not include_single and len(d.get("entities", [])) <= 1:
                continue
            proj = os.path.relpath(p, ROOT).split(os.sep)[0]
            if projects and proj not in projects:
                continue
            out.append(p)
    return sorted(out)

# kind overrides by path pattern (see PLAN.md)
KIND_TILE = "tile_variant"
KIND_ENTITY = "entity_variant"


def pick_kind(jf, entity_name, anim):
    if "/levels/" in jf:
        return KIND_TILE
    if entity_name == "coin":
        return KIND_ENTITY
    return "animation"


def audit_one(jf):
    """Return (rows, hard_errors). Reuses audit logic minimally."""
    d = json.load(open(jf))
    errs = []
    for e in d.get("entities", []):
        fdir = frame_dir(jf, e["name"])
        for f in e.get("frames", []):
            fp = os.path.join(fdir, f["file"])
            if not os.path.exists(fp):
                errs.append(f"missing frame {fp}")
    return d, errs


def build_anim_sheet(jf, e, dry_run=False):
    """Glue one (entity, anim) into its own sheet. Returns (out_png, out_json, info)."""
    name, anim = e["name"], e["anim"]
    fdir = frame_dir(jf, name)
    frames = e["frames"]

    # layout: reproduce old row/col footprint
    rows_used = sorted({f["row"] for f in frames})
    cols_used = sorted({f["col"] for f in frames})
    n_rows, n_cols = len(rows_used), len(cols_used)
    row_idx = {r: i for i, r in enumerate(rows_used)}
    col_idx = {c: i for i, c in enumerate(cols_used)}

    sizes = {}  # (ri, ci) -> (w, h)
    imgs = {}
    for f in frames:
        ri, ci = row_idx[f["row"]], col_idx[f["col"]]
        im = Image.open(os.path.join(fdir, f["file"])).convert("RGBA")
        imgs[(ri, ci)] = (im, f)
        sizes[(ri, ci)] = im.size

    col_w = [max(sizes[(ri, ci)][0] for ri in range(n_rows) if (ri, ci) in sizes) for ci in range(n_cols)]
    row_h = [max(sizes[(ri, ci)][1] for ci in range(n_cols) if (ri, ci) in sizes) for ri in range(n_rows)]
    W, H = sum(col_w), sum(row_h)

    out_png = os.path.join(fdir, f"{anim}_sheet.png")
    out_json = os.path.join(fdir, f"{anim}_sheet.json")

    if not dry_run:
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        new_frames = []
        x = 0
        col_x = [0]
        for w in col_w:
            col_x.append(col_x[-1] + w)
        y = 0
        row_y = [0]
        for h in row_h:
            row_y.append(row_y[-1] + h)
        for f in frames:
            ri, ci = row_idx[f["row"]], col_idx[f["col"]]
            im, _ = imgs[(ri, ci)]
            w, h = im.size
            fx = col_x[ci] + (col_w[ci] - w) // 2
            fy = row_y[ri] + (row_h[ri] - h) // 2
            canvas.paste(im, (fx, fy))
            new_frames.append({
                "file": f["file"], "row": ri, "col": ci,
                "bbox": [fx, fy, w, h],
            })
        canvas.save(out_png)
        rel = os.path.relpath(out_png, ROOT)
        doc = {
            "file": rel,
            "size": f"{W}x{H}",
            "rows": n_rows,
            "cols": n_cols,
            "kind": pick_kind(jf, name, anim),
            "description": f"{name} {anim} ({len(frames)} frames) — reassembled from frames",
            "entities": [{
                "name": name,
                "anim": anim,
                "frames_dir": os.path.relpath(fdir, ROOT),
                "frames": new_frames,
            }],
            "updated": datetime.date.today().isoformat(),
        }
        with open(out_json, "w") as fh:
            json.dump(doc, fh, indent=1)
            fh.write("\n")
    return out_png, out_json, {"rows": n_rows, "cols": n_cols, "frames": len(frames)}


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    project = None
    if "--project" in args:
        project = set(args[args.index("--project") + 1].split(","))
    sheets = None
    if "--sheet" in args:
        sheets = [os.path.abspath(args[args.index("--sheet") + 1])]

    jfs = sheets or find_sheet_jsons(project, include_single=False)
    built = skipped = 0
    for jf in jfs:
        d, errs = audit_one(jf)
        if errs:
            print(f"ABORT {jf}: {errs[:3]}")
            sys.exit(1)
        rel = os.path.relpath(jf, ROOT)
        print(f"\n== {rel}")
        for e in d.get("entities", []):
            fdir = frame_dir(jf, e["name"])
            tgt = os.path.join(fdir, f"{e['anim']}_sheet.json")
            if os.path.abspath(tgt) == os.path.abspath(jf):
                # already a per-anim sheet (single-anim source) — skip
                print(f"   - {e['name']}/{e['anim']} (already per-anim)")
                skipped += 1
                continue
            png, js, info = build_anim_sheet(jf, e, dry_run=dry)
            verb = "would write" if dry else "wrote"
            print(f"   {verb} {e['name']}/{e['anim']}  {info['frames']}f  grid {info['rows']}x{info['cols']}")
            built += 1
    print(f"\n--- {'DRY RUN: ' if dry else ''}{built} anim sheets {'to build' if dry else 'built'}, {skipped} skipped")


if __name__ == "__main__":
    main()
