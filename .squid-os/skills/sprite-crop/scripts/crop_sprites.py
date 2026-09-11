#!/usr/bin/env python3
"""Deterministic sprite sheet cropping CLI.

AI-generated sheets are NOT pixel-perfect grids: row heights vary and column
centers drift per row. This tool measures the real sprite bounds on a black
background, crops each cell, and supports manual overrides so the agent can
iterate (crop -> inspect -> adjust) until every frame is clean.

Subcommands:
  scan   --sheet PATH [--min-gap N]
         Measure sprite-free bands. Prints JSON: {width, height, rows:[[y0,y1]], col_gaps_per_row:[[[x0,x1],...]]}
  crop   --sheet PATH --out DIR --names n1,n2,... [--bands BANDS.json]
         [--row-y "y0-y1,y0-y1,..."] [--col-x "x0,x0,x0,x0|..."]
         Crop one frame per (row x col). Frame size = measured row height x 256 (or --frame-size WxH).
  report --dir DIR
         Print dimensions + count of every PNG in dir.
"""
import argparse, json, os, sys, time

def load_img(path):
    from PIL import Image
    im = Image.open(path).convert("RGBA")
    return im, im.load()

def is_ink(px, x, y):
    r, g, b, a = px[x, y]
    return a > 10 and (r + g + b) > 30

def cmd_scan(args):
    im, px = load_img(args.sheet)
    W, H = im.size
    # horizontal occupancy: find vertical gaps (sprite-free bands between rows).
    # A separator must be nearly empty across the width — light ink (glow, thin
    # tentacles) does not count as a row boundary. Threshold scales with width.
    def row_occ(y):
        return sum(1 for x in range(0, W, 2) if is_ink(px, x, y))
    occ = [row_occ(y) for y in range(H)]
    row_thresh = max(3, W // 500)
    gaps = []
    y = 0
    while y < H:
        if occ[y] < row_thresh:
            s = y
            while y < H and occ[y] < row_thresh:
                y += 1
            gaps.append((s, y))
        else:
            y += 1
    # keep only gaps that look like separators (>= min-gap px), drop edge margins
    inner = [g for g in gaps if g[1] - g[0] >= args.min_gap and 0 < g[0] and g[1] < H]
    rows = []
    prev = 0
    for s, e in inner:
        rows.append([prev, s])
        prev = e
    rows.append([prev, H])
    # trim top/bottom margin-only rows
    rows = [r for r in rows if r[1] - r[0] > 8]
    # merge bands separated by a sliver gap (< min-gap): sprite ink (glow, thin
    # tentacles) can split one real row into two measured bands
    merged = [list(rows[0])]
    for y0, y1 in rows[1:]:
        if y0 - merged[-1][1] < args.min_gap:
            merged[-1][1] = y1
        else:
            merged.append([y0, y1])
    rows = merged
    # per-row vertical gaps (column separators)
    col_gaps_per_row = []
    for y0, y1 in rows:
        def col_occ(x):
            return sum(1 for y in range(y0, y1, 4) if is_ink(px, x, y))
        cocc = [col_occ(x) for x in range(W)]
        # a separator must span most of the row height; light ink (glow, thin
        # tentacles) does NOT count as a cell boundary
        need = int((y1 - y0) * 0.5)
        cg = []
        x = 0
        while x < W:
            if cocc[x] < 2:
                s = x
                while x < W and cocc[x] < 2:
                    x += 1
                # only interior gaps (between cells), not left/right margins
                if x - s >= args.min_gap and s > 0 and x < W:
                    depth = min(cocc[t] for t in range(s, x))
                    span_ok = sum(1 for t in range(s, x) if cocc[t] < need) > (x - s) * 0.7
                    if depth == 0 or span_ok:
                        cg.append([s, x])
            else:
                x += 1
        # interior gaps only (between cells); margins start at 0 or end at W
    cg = [g for g in cg if g[0] > 0 and g[1] < W]
    # merge adjacent separators closer than min-gap (sprite ink can split one gap)
    merged = []
    for g in cg:
        if merged and g[0] - merged[-1][1] < args.min_gap:
            merged[-1][1] = g[1]
        else:
            merged.append(list(g))
    col_gaps_per_row.append(merged)
    result = {"width": W, "height": H, "rows": rows, "col_gaps_per_row": col_gaps_per_row}
    print(json.dumps(result, indent=2))
    if args.save:
        with open(args.save, "w") as f:
            json.dump(result, f, indent=2)
        print(f"BANDS SAVED: {args.save}", file=sys.stderr)

def crop_grid(im, rows, cols_centers, names, out_dir, frame_size=None, inset=3):
    """rows: [[y0,y1]]; cols_centers: [x_center per col]; saves frames.

    inset: pull each crop box inward by N px (default 3) so the sheet's outer
    edge / separator-line slivers don't bleed into outer frames as a visible
    border.

    TRADEOFF / RISK:
      - PRO: removes the 1-2px dark edge + grid-line residue that otherwise
        shows up as a square outline on outer frames (f1 left, f5 right, etc).
      - CON: we permanently discard a 3px ring from every frame. If a sprite's
        content (hair, ribbon, weapon tip, foot) extends within 3px of the cell
        boundary in the SOURCE sheet, that sliver gets cut off.
      - This is safe when sprites are composed with a small margin inside their
        cell (the normal case for AI-generated sheets). It is NOT safe if a
        sprite deliberately bleeds to the cell edge — in that case pass inset=0
        and instead fix the source (re-generate with margin, or widen the cell).
      - The inset shrinks every frame uniformly by 2*inset in W and H, so all
        frames of an entity stay the same size (no jitter).
    """
    os.makedirs(out_dir, exist_ok=True)
    W, H = im.size
    fw, fh = frame_size if frame_size else (256, None)
    saved = []
    for r, (y0, y1) in enumerate(rows):
        rh = y1 - y0
        h = fh or rh
        yy0 = max(0, min(H - h, y0))  # top-aligned within measured band
        for c, cx in enumerate(cols_centers):
            x0 = max(0, min(W - fw, cx - fw // 2))
            # inset the box (see tradeoff above)
            ix0 = x0 + inset
            iy0 = yy0 + inset
            iw = fw - 2 * inset
            ih = h - 2 * inset
            box = (ix0, iy0, ix0 + iw, iy0 + ih)
            fn = f"{names[r]}_f{c+1}.png"
            im.crop(box).save(os.path.join(out_dir, fn))
            saved.append(fn)
    return saved

def detect_bg(px, W, H):
    """Sample a ring just INSIDE the border to estimate the background color.

    Skips the outer ~4px so painted edge frames / anti-aliased borders don't
    fool detection. Buckets samples by color distance (hand-painted bgs are
    not flat — exact-match counting fails on them) and returns the centroid
    of the dominant cluster.
    """
    skip = min(4, W // 10, H // 10)
    samples = []
    for x in range(skip, W - skip, max(1, W // 40)):
        samples += [px[x, skip][:3], px[x, H - 1 - skip][:3]]
    for y in range(skip, H - skip, max(1, H // 40)):
        samples += [px[skip, y][:3], px[W - 1 - skip, y][:3]]
    # find the dominant color cluster by distance
    best_center, best_count = None, 0
    for r, g, b in samples:
        count = sum(1 for r2, g2, b2 in samples
                    if abs(r - r2) < 30 and abs(g - g2) < 30 and abs(b - b2) < 30)
        if count > best_count:
            best_center, best_count = (r, g, b), count
    if best_center is None:
        return samples[0] + (255,)
    cluster = [(r, g, b) for r, g, b in samples
               if abs(r - best_center[0]) < 30 and abs(g - best_center[1]) < 30
               and abs(b - best_center[2]) < 30]
    cr = sum(c[0] for c in cluster) // len(cluster)
    cg = sum(c[1] for c in cluster) // len(cluster)
    cb = sum(c[2] for c in cluster) // len(cluster)
    return (cr, cg, cb, 255)

def make_transparent(im, bg, tol=40):
    """Flood-fill from all border pixels matching bg color -> alpha 0.

    Only removes background CONNECTED to the image border, so dark pixels
    inside sprites (shadows, dark bodies) are preserved.

    CRITICAL: tolerance must stay TIGHT (default 40). A loose tolerance lets
    the fill leak through dark-but-not-black sprite pixels (e.g. rgb(0,15,41)
    body shading on a black sheet) and eats holes in the sprites. If corners
    remain opaque after prep, raise tol in small steps (+10) and re-prep —
    never jump to 80+.
    """
    from collections import deque
    W, H = im.size
    px = im.load()
    br, bgc, bb, _ = bg
    def is_bg(x, y):
        r, g, b, a = px[x, y]
        return abs(r - br) <= tol and abs(g - bgc) <= tol and abs(b - bb) <= tol
    seen = bytearray(W * H)
    q = deque()
    # Seed from border AND from interior points every ~100px (hand-painted sheets
    # may have edge artifacts that block border-only seeding)
    for x in range(0, W, max(1, W // 20)):
        for y in (0, 1, 2, H - 3, H - 2, H - 1):
            if not seen[y * W + x] and is_bg(x, y):
                seen[y * W + x] = 1; q.append((x, y))
    for y in range(0, H, max(1, H // 20)):
        for x in (0, 1, 2, W - 3, W - 2, W - 1):
            if not seen[y * W + x] and is_bg(x, y):
                seen[y * W + x] = 1; q.append((x, y))
    # Interior seeds: sample a grid of points, seed any that match bg
    for y in range(H // 4, H - H // 4, max(1, H // 8)):
        for x in range(W // 4, W - W // 4, max(1, W // 8)):
            if not seen[y * W + x] and is_bg(x, y):
                seen[y * W + x] = 1; q.append((x, y))
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and not seen[ny * W + nx]:
                nr, ng, nb, na = px[nx, ny]
                # passable if already transparent OR matches bg color
                if na == 0 or (abs(nr - br) <= tol and abs(ng - bgc) <= tol and abs(nb - bb) <= tol):
                    seen[ny * W + nx] = 1; q.append((nx, ny))
    return im

def cmd_degrid(args):
    """Remove grid separator lines from a sprite sheet.
    
    Detects horizontal and vertical lines by scanning for rows/columns where
    >95% of pixels share a very similar color (the line color) AND the line
    is thin (1-6px thick). Clears only those line pixels to transparent.
    Does NOT remove the background fill between lines.
    """
    from PIL import Image
    im = Image.open(args.sheet).convert("RGBA")
    px = im.load()
    W, H = im.size

    # --- Detect horizontal grid lines ---
    # A grid line: a thin band (1-6px) where >95% of pixels are very uniform
    # AND darker than the surrounding background (real separators are drawn darker).
    h_lines = []
    y = 0
    while y < H:
        colors = [px[x, y][:3] for x in range(0, W, max(1, W // 200))]
        if len(colors) < 10:
            y += 1
            continue
        avg_r = sum(c[0] for c in colors) // len(colors)
        avg_g = sum(c[1] for c in colors) // len(colors)
        avg_b = sum(c[2] for c in colors) // len(colors)
        # Very strict: >95% within 10 of average
        uniform = sum(1 for c in colors if abs(c[0]-avg_r)<10 and abs(c[1]-avg_g)<10 and abs(c[2]-avg_b)<10)
        if uniform > len(colors) * 0.95:
            # Measure how thick this uniform band is
            thickness = 1
            while y + thickness < H and thickness < 8:
                next_colors = [px[x, y+thickness][:3] for x in range(0, W, max(1, W // 200))]
                next_uniform = sum(1 for c in next_colors if abs(c[0]-avg_r)<10 and abs(c[1]-avg_g)<10 and abs(c[2]-avg_b)<10)
                if next_uniform > len(next_colors) * 0.95:
                    thickness += 1
                else:
                    break
            # Must be a thin line (1-8px), not a large flat region
            if 1 <= thickness <= 8 and 10 < y < H - 10:
                # Line must be DARKER than the bg above it (not just uniform pink)
                if y >= 2:
                    bg_above = [px[x, max(0, y-2)][:3] for x in range(0, W, max(1, W // 50))]
                    bg_sum = sum(sum(c) for c in bg_above) // len(bg_above)
                    line_sum = avg_r + avg_g + avg_b
                    if line_sum < bg_sum - 30:
                        h_lines.append((y, y + thickness))
            y += thickness
        else:
            y += 1

    # --- Detect vertical grid lines ---
    v_lines = []
    x = 0
    while x < W:
        colors = [px[x, y][:3] for y in range(0, H, max(1, H // 200))]
        if len(colors) < 10:
            x += 1
            continue
        avg_r = sum(c[0] for c in colors) // len(colors)
        avg_g = sum(c[1] for c in colors) // len(colors)
        avg_b = sum(c[2] for c in colors) // len(colors)
        uniform = sum(1 for c in colors if abs(c[0]-avg_r)<10 and abs(c[1]-avg_g)<10 and abs(c[2]-avg_b)<10)
        if uniform > len(colors) * 0.95:
            thickness = 1
            while x + thickness < W and thickness < 8:
                next_colors = [px[x+thickness, y][:3] for y in range(0, H, max(1, H // 200))]
                next_uniform = sum(1 for c in next_colors if abs(c[0]-avg_r)<10 and abs(c[1]-avg_g)<10 and abs(c[2]-avg_b)<10)
                if next_uniform > len(next_colors) * 0.95:
                    thickness += 1
                else:
                    break
            if 1 <= thickness <= 8 and 10 < x < W - 10:
                # Line must be DARKER than the bg to its left
                if x >= 2:
                    bg_left = [px[max(0, x-2), y][:3] for y in range(0, H, max(1, H // 50))]
                    bg_sum = sum(sum(c) for c in bg_left) // len(bg_left)
                    line_sum = avg_r + avg_g + avg_b
                    if line_sum < bg_sum - 30:
                        v_lines.append((x, x + thickness))
            x += thickness
        else:
            x += 1

    # --- Clear ONLY pixels matching the grid line color (not entire rows/cols) ---
    # Clear the line core + 2px padding above/below with looser tol to kill AA halos
    cleared = 0
    for y0, y1 in h_lines:
        # Get the line color from this band
        sample_colors = [px[x, y0][:3] for x in range(0, W, max(1, W // 50))]
        lr = sum(c[0] for c in sample_colors) // len(sample_colors)
        lg = sum(c[1] for c in sample_colors) // len(sample_colors)
        lb = sum(c[2] for c in sample_colors) // len(sample_colors)
        pad = 3
        for y in range(max(0, y0 - pad), min(H, y1 + pad)):
            for x in range(W):
                r, g, b, a = px[x, y]
                if a > 0 and abs(r-lr)<40 and abs(g-lg)<40 and abs(b-lb)<40:
                    px[x, y] = (0, 0, 0, 0)
                    cleared += 1
    for x0, x1 in v_lines:
        sample_colors = [px[x0, y][:3] for y in range(0, H, max(1, H // 50))]
        lr = sum(c[0] for c in sample_colors) // len(sample_colors)
        lg = sum(c[1] for c in sample_colors) // len(sample_colors)
        lb = sum(c[2] for c in sample_colors) // len(sample_colors)
        pad = 3
        for x in range(max(0, x0 - pad), min(W, x1 + pad)):
            for y in range(H):
                r, g, b, a = px[x, y]
                if a > 0 and abs(r-lr)<40 and abs(g-lg)<40 and abs(b-lb)<40:
                    px[x, y] = (0, 0, 0, 0)
                    cleared += 1

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    im.save(args.out)
    print(f"DEGRID: removed {len(h_lines)} horizontal + {len(v_lines)} vertical lines ({cleared} px cleared)")
    print(f"OUTPUT: {args.out}")
    if not h_lines and not v_lines:
        print("NOTE: No grid lines detected. Sheet may not need degrid.")

def cmd_prep(args):
    im, px = load_img(args.sheet)
    W, H = im.size
    bg = detect_bg(px, W, H)
    print(f"BG DETECTED: rgb{bg}")
    # snapshot original ink before flood-fill so we can audit losses
    orig_ink = {}
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 10 and (r + g + b) > 40:
                orig_ink[(x, y)] = (r, g, b)
    make_transparent(im, bg, tol=args.tol)
    # AUDIT: count real-ink pixels that became transparent (fill leak)
    lost = sum(1 for (x, y) in orig_ink if px[x, y][3] == 0)
    total = len(orig_ink)
    pct = 100.0 * lost / max(1, total)
    # FAIL LOUD: if almost nothing became transparent, bg detection was wrong
    trans_pct = 100.0 * sum(1 for y in range(0, H, 4) for x in range(0, W, 4) if px[x, y][3] == 0) / ((W // 4 + 1) * (H // 4 + 1))
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    im.save(args.out)
    print(f"PREPARED (transparent bg) -> {args.out}")
    print(f"INK AUDIT: {lost}/{total} real-ink pixels removed ({pct:.1f}%)")
    if pct > 2.0:
        print(f"WARN: fill likely leaked into sprite bodies. Re-run with lower --tol "
              f"(try {max(10, args.tol - 15)}) and re-audit.", file=sys.stderr)
    if trans_pct < 10.0:
        print(f"FAIL: only {trans_pct:.1f}% of image became transparent — background was NOT removed. "
              f"Detected bg {bg[:3]} is probably wrong. Do NOT continue. Re-detect bg or use a different method.", file=sys.stderr)
    if args.save_bg:
        with open(args.save_bg, "w") as f:
            json.dump({"bg_color": list(bg)}, f)
        print(f"BG SAVED: {args.save_bg}", file=sys.stderr)

def cell_centers(gaps, W, n_cols):
    """Derive n_cols cell centers from interior separator gaps.

    If exactly n_cols-1 separators: center of each span between them (or edges).
    If fewer (some cells touch): fall back to even division of the inked width.
    """
    interior = [g for g in gaps if g[0] > 0 and g[1] < W]
    if len(interior) == n_cols - 1:
        bounds = [0] + [(a + b) // 2 for a, b in interior] + [W]
        return [(bounds[i] + bounds[i + 1]) // 2 for i in range(n_cols)]
    # fallback: even division
    return [int(W * (i + 0.5) / n_cols) for i in range(n_cols)]

def cmd_crop(args):
    im, _ = load_img(args.sheet)
    W, H = im.size
    bands = None
    if args.bands:
        with open(args.bands) as f:
            bands = json.load(f)
    elif args.row_y:
        bands = {"rows": [tuple(map(int, p.split("-"))) for p in args.row_y.split(",")]}
    if not bands:
        print("ERROR: provide --bands BANDS.json or --row-y 'y0-y1,...'", file=sys.stderr)
        sys.exit(1)
    rows = bands["rows"]
    names = [n.strip() for n in args.names.split(",")]
    # column centers: explicit --col-x per row, else derived from measured gaps
    if args.col_x:
        per_row = [list(map(int, p.split(","))) for p in args.col_x.split("|")]
    else:
        gaps = bands.get("col_gaps_per_row", [])
        per_row = [cell_centers(g, W, args.cols) for g in gaps]
        if not per_row:
            per_row = [cell_centers([], W, args.cols)] * len(rows)
        elif len(per_row) < len(rows):
            per_row += [per_row[-1]] * (len(rows) - len(per_row))
    names = [n.strip() for n in args.names.split(",")]
    if len(names) != len(rows):
        print(f"ERROR: {len(names)} names but {len(rows)} rows", file=sys.stderr)
        sys.exit(1)
    frame_size = None
    if args.frame_size:
        w, h = map(int, args.frame_size.split("x"))
        frame_size = (w, h)
    saved = []
    for r in range(len(rows)):
        saved += crop_grid(im, [rows[r]], per_row[r], [names[r]], args.out, frame_size, inset=args.inset)
    print(f"CROPPED {len(saved)} frames -> {args.out}")
    for f in sorted(saved):
        print(" ", f)
    # ALWAYS normalize: crops come out at different sizes (thin edge-on frames
    # vs wide face frames). Auto-run trim on the output dir so every entity's
    # frames end up identical in size with equal padding. This is not optional.
    trim_args = argparse.Namespace(dir=args.out, out=None, pad=args.pad)
    cmd_trim(trim_args)

def cmd_report(args):
    from PIL import Image
    files = sorted(f for f in os.listdir(args.dir) if f.endswith(".png"))
    sizes = {}
    for f in files:
        w, h = Image.open(os.path.join(args.dir, f)).size
        sizes.setdefault(f"{w}x{h}", []).append(f)
    print(f"{len(files)} PNGs in {args.dir}")
    for s, fl in sorted(sizes.items()):
        print(f"  {s}: {len(fl)} frames")
        if len(fl) <= 12:
            for f in fl:
                print("   ", f)

def cmd_trim(args):
    """Normalize frames: per entity (filename prefix before _fN), compute the
    largest alpha bbox across all its frames, then place EVERY frame's content
    CENTERED on a common WxH canvas (max_w x max_h + 2*pad).

    Result: all frames of one entity are identical in size AND centered, so
    every frame gets equal padding around its content and animation playback
    doesn't jitter or stretch. Different entities may differ in size.

    NOTE: this is REQUIRED after cropping any multi-frame animation — crops
    come out at different sizes (e.g. thin edge-on frames vs wide face frames)
    and must be normalized before use.
    """
    from PIL import Image
    import re
    os.makedirs(args.out or args.dir, exist_ok=True)
    files = sorted(f for f in os.listdir(args.dir) if f.endswith(".png"))
    # group by entity prefix (name before _f<number>)
    groups = {}
    for f in files:
        m = re.match(r"^(.+)_f\d+\.png$", f)
        key = m.group(1) if m else f
        groups.setdefault(key, []).append(f)
    total = 0
    for key, flist in groups.items():
        boxes = {}
        for f in flist:
            im = Image.open(os.path.join(args.dir, f)).convert("RGBA")
            boxes[f] = im.getchannel("A").getbbox() or (0, 0, 0, 0)
        # common canvas = max extent across the group
        max_x1 = max(b[2] for b in boxes.values())
        max_y1 = max(b[3] for b in boxes.values())
        cw, ch = max_x1 + 2 * args.pad, max_y1 + 2 * args.pad
        for f in flist:
            im = Image.open(os.path.join(args.dir, f)).convert("RGBA")
            # 1) crop this frame to its own tight bbox
            bb = im.getchannel("A").getbbox()
            if bb:
                im = im.crop(bb)
            # 2) center the tight content on the common canvas -> equal
            #    padding around every frame; content stays put between
            #    frames of similar size, no vertical bounce
            canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
            ox = (cw - im.width) // 2
            oy = (ch - im.height) // 2
            canvas.paste(im, (ox, oy), im)
            canvas.save(os.path.join(args.out or args.dir, f))
            total += 1
        print(f"  {key}: {len(flist)} frames -> {cw}x{ch}")
    print(f"NORMALIZED {total} frames (pad={args.pad}) -> {args.out or args.dir}")

# This is the code to append into crop_sprites.py: a cmd_viewer + VIEWER_TMPL + arg wiring.

VIEWER_TMPL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SPRITE VIEWER — __PROJECT__</title>
<style>
  html,body{margin:0;height:100%;background:#0a0c14;color:#cfe4ff;font-family:'Courier New',monospace;}
  #app{display:flex;height:100%;}
  #side{width:260px;border-right:1px solid #1b2540;padding:16px;overflow-y:auto;background:#070912;}
  #side h1{font-size:18px;color:#3ef0ff;letter-spacing:2px;margin:0 0 4px;text-transform:uppercase;}
  #side .sub{font-size:11px;color:#5a6a90;margin-bottom:14px;}
  .label{color:#ffe23e;font-size:13px;margin:12px 0 4px;letter-spacing:1px;}
  .ent{font-size:14px;padding:6px 10px;border-radius:6px;cursor:pointer;color:#8fa0d0;user-select:none;display:flex;justify-content:space-between;align-items:center;}
  .ent:hover{background:rgba(62,240,255,.08);color:#cfe4ff;}
  .ent.on{background:rgba(255,226,62,.12);color:#fff;}
  .ent .cnt{color:#5a6a90;font-size:11px;margin-left:8px;white-space:nowrap;}
  .ent.on .cnt{color:#ffe23e;}
  #main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:20px;}
  #stage{position:relative;display:flex;align-items:center;justify-content:center;}
  canvas{image-rendering:pixelated;image-rendering:crisp-edges;border:2px solid #1b2540;border-radius:8px;max-width:60vmin;max-height:55vmin;}
  #name{font-size:26px;color:#3ef0ff;font-weight:bold;letter-spacing:2px;text-shadow:0 0 14px #3ef0ff;text-transform:uppercase;}
  #meta{font-size:15px;color:#8fa0d0;margin-top:-12px;letter-spacing:1px;}
  #frameinfo{font-size:12px;color:#5a6a90;margin-top:4px;letter-spacing:.5px;font-family:'Courier New',monospace;}
  #controls{display:flex;align-items:center;gap:16px;font-size:18px;}
  button{font-family:inherit;font-size:22px;width:48px;height:48px;border-radius:8px;border:2px solid #1b2540;
          background:#0d1120;color:#cfe4ff;cursor:pointer;transition:all .1s;}
  button:hover{border-color:#3ef0ff;color:#3ef0ff;}
  #fps{min-width:90px;text-align:center;font-size:20px;color:#ffe23e;font-weight:bold;}
  #bgrow{display:flex;align-items:center;gap:10px;font-size:14px;color:#8fa0d0;}
  input[type=color]{width:44px;height:32px;border:2px solid #1b2540;border-radius:6px;background:#0d1120;cursor:pointer;padding:2px;}
  #hint{font-size:12px;color:#5a6a90;}
</style>
</head>
<body>
<div id="app">
  <div id="side">
    <h1>Sprite Viewer</h1>
    <div class="sub">__PROJECT__</div>
    <div id="tree"></div>
  </div>
  <div id="main">
    <div id="name">&nbsp;</div>
    <div id="meta">&nbsp;</div>
    <div id="frameinfo">&nbsp;</div>
    <div id="stage"><canvas id="cv" width="256" height="256"></canvas></div>
    <div id="controls">
      <button id="slower" title="slower">&#8722;</button>
      <div id="fps">-- fps</div>
      <button id="faster" title="faster">&#43;</button>
    </div>
    <div id="bgrow">
      <span>background</span>
      <input type="color" id="bg" value="__BGCOLOR__">
      <span id="bgval">__BGCOLOR__</span>
    </div>
    <div id="hint">click an entity &middot; &#8593;/&#8595; next/prev animation &middot; &#8722;/&#43; speed &middot; space play/pause &middot; &#8592;/&#8594; step frame (paused)</div>
  </div>
</div>
<script>
const MANIFEST = __MANIFEST__;   // {labels:[{name, entities:[{name, frames:["path",...]}]}], bg:"#hex"}
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
const nameEl = document.getElementById('name');
const metaEl = document.getElementById('meta');
const frameInfoEl = document.getElementById('frameinfo');
const fpsEl = document.getElementById('fps');
const bgInput = document.getElementById('bg');
const bgVal = document.getElementById('bgval');
const tree = document.getElementById('tree');

let current = null;      // {name, frames:[Image]}
let frameIdx = 0;
let fps = 8;
let playing = true;
let lastT = 0;
let acc = 0;
let flatList = [];       // [{li, ei}] flattened entity list
let flatIdx = -1;        // current position in flatList

// Build the sidebar tree.
MANIFEST.labels.forEach((lbl, li) => {
  const hd = document.createElement('div'); hd.className='label'; hd.textContent = lbl.name.toUpperCase();
  tree.appendChild(hd);
  lbl.entities.forEach((en, ei) => {
    const row = document.createElement('div'); row.className='ent';
    row.innerHTML = `<span>${en.name}</span><span class="cnt">${en.frames.length}f</span>`;
    row.addEventListener('click', () => selectEntity(li, ei));
    en._el = row;
    tree.appendChild(row);
    flatList.push({li, ei});
  });
});

function loadFrames(paths){
  return Promise.all(paths.map(p => new Promise(res => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = p;
  })));
}

async function selectEntity(li, ei){
  const en = MANIFEST.labels[li].entities[ei];
  document.querySelectorAll('.ent').forEach(e=>e.classList.remove('on'));
  en._el.classList.add('on');
  flatIdx = flatList.findIndex(f => f.li === li && f.ei === ei);
  const imgs = await loadFrames(en.frames);
  current = { name: en.name, frames: imgs.filter(Boolean), framePaths: en.frames };
  frameIdx = 0; acc = 0; playing = true;
  nameEl.textContent = current.name;
  metaEl.textContent = current.frames.length + ' frames';
  if (current.frames.length && current.frames[0]) {
    cv.width = current.frames[0].naturalWidth || 256;
    cv.height = current.frames[0].naturalHeight || 256;
  }
  draw();
}

function draw(){
  const bg = bgInput.value;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (current && current.frames.length){
    const idx = frameIdx % current.frames.length;
    const im = current.frames[idx];
    if (im) ctx.drawImage(im, 0, 0, cv.width, cv.height);
    // Show current frame filename
    if (current.framePaths && current.framePaths.length){
      const fn = current.framePaths[idx] || '';
      const basename = fn.split('/').pop();
      frameInfoEl.textContent = (idx+1) + '/' + current.frames.length + '  \u2014  ' + basename;
    }
  }
}

function tick(t){
  requestAnimationFrame(tick);
  if (!current || !playing) { lastT = t; return; }
  const dt = (t - lastT) / 1000; lastT = t;
  acc += dt;
  const step = 1 / Math.max(1, fps);
  if (acc >= step){
    acc = acc % step;
    frameIdx = (frameIdx + 1) % current.frames.length;
    draw();
  }
}
requestAnimationFrame(tick);

function setFps(v){
  fps = Math.max(1, Math.min(60, v));
  fpsEl.textContent = fps + ' fps';
}
setFps(fps);
document.getElementById('faster').addEventListener('click', ()=>setFps(fps+1));
document.getElementById('slower').addEventListener('click', ()=>setFps(fps-1));
bgInput.addEventListener('input', ()=>{ bgVal.textContent = bgInput.value; draw(); });
window.addEventListener('keydown', (e)=>{
  if (e.code==='ArrowRight'){ e.preventDefault(); if(playing) setFps(fps+1); else { frameIdx=(frameIdx+1)%current.frames.length; draw(); } }
  else if (e.code==='ArrowLeft'){ e.preventDefault(); if(playing) setFps(fps-1); else { frameIdx=(frameIdx-1+current.frames.length)%current.frames.length; draw(); } }
  else if (e.code==='ArrowUp'){ e.preventDefault(); if(flatIdx>0){ flatIdx--; const f=flatList[flatIdx]; selectEntity(f.li, f.ei); } }
  else if (e.code==='ArrowDown'){ e.preventDefault(); if(flatIdx<flatList.length-1){ flatIdx++; const f=flatList[flatIdx]; selectEntity(f.li, f.ei); } }
  else if (e.code==='Minus'||e.code==='NumpadSubtract'){ e.preventDefault(); setFps(fps-1); }
  else if (e.code==='Equal'||e.code==='NumpadAdd'){ e.preventDefault(); setFps(fps+1); }
  else if (e.code==='Space'){ e.preventDefault(); playing=!playing; }
});
// Auto-select first entity.
if (MANIFEST.labels.length){ selectEntity(0, 0); }
</script>
</body>
</html>
"""


def build_manifest(assets_dir, project, prefix="", state_file=None):
    """Build manifest from state JSON tree structure (folders > sheets > entities).
    
    Expected JSON structure:
    {
      "folders": {
        "<label>": {
          "path": "project/assets/<label>",
          "sheets": [
            {
              "file": "...",
              "entities": [
                {"name": "...", "anim": "...", "frames": ["..._f1.png", ...]}
              ]
            }
          ]
        }
      }
    }
    
    Falls back to disk scan if no state file or no 'folders' key found.
    prefix: path prefix so frames resolve relative to viewer HTML location."""
    import re
    
    # Try state JSON with new tree structure
    if state_file and os.path.isfile(state_file):
        with open(state_file) as f:
            state = json.load(f)
        
        folders = state.get('folders', {})
        if folders:
            labels = []
            for label_name in sorted(folders.keys()):
                folder = folders[label_name]
                entities = []
                for sheet in folder.get('sheets', []):
                    for entity in sheet.get('entities', []):
                        name = entity['name']
                        anim = entity.get('anim', '')
                        ent_name = f"{name}_{anim}" if anim else name
                        frames = entity.get('frames', [])
                        if frames:
                            full_frames = [prefix + os.path.join(label_name, fn) for fn in frames]
                            entities.append({"name": ent_name, "frames": [p.replace(os.sep, "/") for p in full_frames]})
                entities.sort(key=lambda e: e["name"])
                if entities:
                    labels.append({"name": label_name, "entities": entities})
            
            if labels:
                return labels
    
    # Fallback: scan disk
    labels = []
    if not os.path.isdir(assets_dir):
        return labels
    for label in sorted(os.listdir(assets_dir)):
        ldir = os.path.join(assets_dir, label)
        if not os.path.isdir(ldir):
            continue
        files = [f for f in os.listdir(ldir) if f.endswith(".png")]
        groups = {}
        for f in files:
            m1 = re.match(r"^(.+?)_f(\d+)\.png$", f)
            m2 = re.match(r"^(.+?)_(.+)_f(\d+)\.png$", f)
            if m2:
                entity, action, num = m2.group(1), m2.group(2), int(m2.group(3))
                key = f"{entity}_{action}"
            elif m1:
                entity, num = m1.group(1), int(m1.group(2))
                key = entity
            else:
                continue
            groups.setdefault(key, []).append((num, f))
        if not groups:
            continue
        entities = []
        for ent in sorted(groups.keys()):
            fr = [fn for _, fn in sorted(groups[ent])]
            frames = [prefix + os.path.join(label, fn) for fn in fr]
            frames = [p.replace(os.sep, "/") for p in frames]
            entities.append({"name": ent, "frames": frames})
        labels.append({"name": label, "entities": entities})
    return labels


def cmd_viewer(args):
    out_dir = os.path.dirname(os.path.abspath(args.out))
    assets_abs = os.path.abspath(args.assets_dir)
    prefix = os.path.relpath(assets_abs, out_dir).replace(os.sep, "/")
    if not prefix.endswith("/"):
        prefix += "/"
    # Find state file: look for state-<project>.json in .squid-os/sprite-gen/
    state_file = None
    if args.state:
        state_file = args.state
    else:
        # Auto-detect: .squid-os/sprite-gen/state-<project>.json relative to cwd
        candidate = os.path.join(".squid-os", "sprite-gen", f"state-{args.project}.json")
        if os.path.isfile(candidate):
            state_file = candidate
    manifest = build_manifest(args.assets_dir, args.project, prefix, state_file=state_file)
    if not manifest:
        print("ERROR: no cropped frames found under %s (expected <label>/<entity>_fN.png)" % args.assets_dir, file=sys.stderr)
        sys.exit(1)
    bg = "#000000"
    if args.bg:
        try:
            with open(args.bg) as f:
                rgb = json.load(f)["bg_color"]
            bg = "#%02x%02x%02x" % (rgb[0], rgb[1], rgb[2])
        except Exception:
            pass
    html = (VIEWER_TMPL
            .replace("__PROJECT__", args.project)
            .replace("__BGCOLOR__", bg)
            .replace("__MANIFEST__", json.dumps({"labels": manifest})))
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        f.write(html)
    n_ent = sum(len(l["entities"]) for l in manifest)
    print("PASS: wrote %s (%d labels, %d entities)" % (args.out, len(manifest), n_ent))

def cmd_record_crop(args):
    """Write crop params to the state file in strict format."""
    state_path = args.state
    if not os.path.exists(state_path):
        print(f"ERROR: {state_path} does not exist.", file=sys.stderr)
        sys.exit(1)
    with open(state_path) as f:
        state = json.load(f)

    if args.sheet not in state.get("sheets", {}):
        print(f"ERROR: sheet '{args.sheet}' not found in state. Run sprite_gen.py state --add-sheet first.", file=sys.stderr)
        sys.exit(1)

    # Parse row-y: "y0-y1,y0-y1,..." -> [[y0,y1],...]
    row_y = None
    if args.row_y:
        row_y = [list(map(int, p.split("-"))) for p in args.row_y.split(",")]

    # Parse col-x: "x1,x2,x3|x1,x2,x3|..." -> [[x1,x2,x3],...]
    col_x = None
    if args.col_x:
        col_x = [list(map(int, p.split(","))) for p in args.col_x.split("|")]

    # Parse bg-color: "R,G,B" -> [R,G,B]
    bg_color = None
    if args.bg_color:
        bg_color = list(map(int, args.bg_color.split(",")))

    frame_size = None
    if args.frame_size:
        w, h = map(int, args.frame_size.split("x"))
        frame_size = f"{w}x{h}"

    crop_block = {}
    if bg_color is not None:
        crop_block["bg_color"] = bg_color
    if args.bg_tol is not None:
        crop_block["bg_tol"] = args.bg_tol
    if row_y is not None:
        crop_block["row_y"] = row_y
    if col_x is not None:
        crop_block["col_x"] = col_x
    if frame_size is not None:
        crop_block["frame_size"] = frame_size
    if args.frames_dir:
        crop_block["frames_dir"] = args.frames_dir

    state["sheets"][args.sheet]["crop"] = crop_block
    state["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    with open(state_path, "w") as f:
        json.dump(state, f, indent=2)
    print(f"CROP PARAMS RECORDED for '{args.sheet}' -> {state_path}")
    print(json.dumps(crop_block, indent=2))


def main():
    p = argparse.ArgumentParser(description="Sprite sheet cropping CLI")
    sub = p.add_subparsers(dest="cmd")
    sp = sub.add_parser("scan"); sp.add_argument("--sheet", required=True); sp.add_argument("--min-gap", type=int, default=8); sp.add_argument("--save")
    sd = sub.add_parser("degrid"); sd.add_argument("--sheet", required=True); sd.add_argument("--out", required=True)
    spr = sub.add_parser("prep"); spr.add_argument("--sheet", required=True); spr.add_argument("--out", required=True); spr.add_argument("--tol", type=int, default=40); spr.add_argument("--save-bg")
    sc = sub.add_parser("crop"); sc.add_argument("--sheet", required=True); sc.add_argument("--out", required=True); sc.add_argument("--names", required=True); sc.add_argument("--cols", type=int, default=4); sc.add_argument("--bands"); sc.add_argument("--row-y"); sc.add_argument("--col-x"); sc.add_argument("--frame-size"); sc.add_argument("--inset", type=int, default=3); sc.add_argument("--pad", type=int, default=8, help="padding for the automatic post-crop normalization (trim)")
    sr = sub.add_parser("report"); sr.add_argument("--dir", required=True)
    st = sub.add_parser("trim"); st.add_argument("--dir", required=True); st.add_argument("--out"); st.add_argument("--pad", type=int, default=4)
    sv = sub.add_parser("viewer"); sv.add_argument("--assets-dir", required=True); sv.add_argument("--project", required=True); sv.add_argument("--out", required=True); sv.add_argument("--bg"); sv.add_argument("--state", help="Path to state JSON (auto-detected if omitted)")
    rc = sub.add_parser("record-crop"); rc.add_argument("--state", required=True); rc.add_argument("--sheet", required=True); rc.add_argument("--bg-color"); rc.add_argument("--bg-tol", type=int); rc.add_argument("--row-y"); rc.add_argument("--col-x"); rc.add_argument("--frame-size"); rc.add_argument("--frames-dir")
    args = p.parse_args()
    {"scan": cmd_scan, "degrid": cmd_degrid, "prep": cmd_prep, "crop": cmd_crop, "report": cmd_report, "trim": cmd_trim, "viewer": cmd_viewer, "record-crop": cmd_record_crop}[args.cmd](args)

if __name__ == "__main__":
    main()
