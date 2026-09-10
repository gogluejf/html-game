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
import argparse, json, os, sys

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

def crop_grid(im, rows, cols_centers, names, out_dir, frame_size=None):
    """rows: [[y0,y1]]; cols_centers: [x_center per col]; saves frames."""
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
            box = (x0, yy0, x0 + fw, yy0 + h)
            fn = f"{names[r]}_f{c+1}.png"
            im.crop(box).save(os.path.join(out_dir, fn))
            saved.append(fn)
    return saved

def detect_bg(px, W, H):
    """Sample corners + edges to estimate the background color."""
    from collections import Counter
    samples = []
    for x in range(0, W, max(1, W // 40)):
        samples += [px[x, 0], px[x, 1], px[x, H - 2], px[x, H - 1]]
    for y in range(0, H, max(1, H // 40)):
        samples += [px[0, y], px[1, y], px[W - 2, y], px[W - 1, y]]
    c = Counter(samples)
    return c.most_common(1)[0][0]

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
    for x in range(W):
        for y in (0, H - 1):
            if not seen[y * W + x] and is_bg(x, y):
                seen[y * W + x] = 1; q.append((x, y))
    for y in range(H):
        for x in (0, W - 1):
            if not seen[y * W + x] and is_bg(x, y):
                seen[y * W + x] = 1; q.append((x, y))
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and not seen[ny * W + nx] and is_bg(nx, ny):
                seen[ny * W + nx] = 1; q.append((nx, ny))
    return im

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
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    im.save(args.out)
    print(f"PREPARED (transparent bg) -> {args.out}")
    print(f"INK AUDIT: {lost}/{total} real-ink pixels removed ({pct:.1f}%)")
    if pct > 2.0:
        print(f"WARN: fill likely leaked into sprite bodies. Re-run with lower --tol "
              f"(try {max(10, args.tol - 15)}) and re-audit.", file=sys.stderr)
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
        saved += crop_grid(im, [rows[r]], per_row[r], [names[r]], args.out, frame_size)
    print(f"CROPPED {len(saved)} frames -> {args.out}")
    for f in sorted(saved):
        print(" ", f)

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
    at the same top-left origin on a common WxH canvas (max_w x max_h + pad).

    Result: all frames of one entity are identical in size AND aligned, so
    animation playback doesn't jitter. Different entities may differ in size.
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
  .ent{font-size:14px;padding:6px 10px;border-radius:6px;cursor:pointer;color:#8fa0d0;user-select:none;}
  .ent:hover{background:rgba(62,240,255,.08);color:#cfe4ff;}
  .ent.on{background:rgba(255,226,62,.12);color:#fff;}
  .ent .cnt{float:right;color:#5a6a90;font-size:11px;margin-left:8px;}
  .ent.on .cnt{color:#ffe23e;}
  #main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:20px;}
  #stage{position:relative;display:flex;align-items:center;justify-content:center;}
  canvas{image-rendering:pixelated;image-rendering:crisp-edges;border:2px solid #1b2540;border-radius:8px;max-width:60vmin;max-height:55vmin;}
  #name{font-size:26px;color:#3ef0ff;font-weight:bold;letter-spacing:2px;text-shadow:0 0 14px #3ef0ff;text-transform:uppercase;}
  #meta{font-size:15px;color:#8fa0d0;margin-top:-12px;letter-spacing:1px;}
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
    <div id="hint">click an entity &middot; &#8592;/&#8594; or &#8722;/&#43; change speed &middot; space play/pause</div>
  </div>
</div>
<script>
const MANIFEST = __MANIFEST__;   // {labels:[{name, entities:[{name, frames:["path",...]}]}], bg:"#hex"}
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
const nameEl = document.getElementById('name');
const metaEl = document.getElementById('meta');
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
  const imgs = await loadFrames(en.frames);
  current = { name: en.name, frames: imgs.filter(Boolean) };
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
    const im = current.frames[frameIdx % current.frames.length];
    if (im) ctx.drawImage(im, 0, 0, cv.width, cv.height);
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
  if (e.code==='ArrowRight'){ e.preventDefault(); setFps(fps+1); }
  else if (e.code==='ArrowLeft'){ e.preventDefault(); setFps(fps-1); }
  else if (e.code==='Space'){ e.preventDefault(); playing=!playing; }
});
// Auto-select first entity.
if (MANIFEST.labels.length){ selectEntity(0, 0); }
</script>
</body>
</html>
"""


def build_manifest(assets_dir, project, prefix=""):
    """Scan <assets_dir>/<label>/<entity>_f<N>.png -> manifest for the viewer.
    prefix: path prefix prepended to each frame so it resolves relative to the
    viewer HTML's location (e.g. '../../../assets/abyss-qwen/')."""
    import re
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
            m = re.match(r"^(.+)_f(\d+)\.png$", f)
            key = (m.group(1), int(m.group(2))) if m else (f, 0)
            groups.setdefault(key[0], []).append((key[1], f))
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
    manifest = build_manifest(args.assets_dir, args.project, prefix)
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

def main():
    p = argparse.ArgumentParser(description="Sprite sheet cropping CLI")
    sub = p.add_subparsers(dest="cmd")
    sp = sub.add_parser("scan"); sp.add_argument("--sheet", required=True); sp.add_argument("--min-gap", type=int, default=8); sp.add_argument("--save")
    spr = sub.add_parser("prep"); spr.add_argument("--sheet", required=True); spr.add_argument("--out", required=True); spr.add_argument("--tol", type=int, default=40); spr.add_argument("--save-bg")
    sc = sub.add_parser("crop"); sc.add_argument("--sheet", required=True); sc.add_argument("--out", required=True); sc.add_argument("--names", required=True); sc.add_argument("--cols", type=int, default=4); sc.add_argument("--bands"); sc.add_argument("--row-y"); sc.add_argument("--col-x"); sc.add_argument("--frame-size")
    sr = sub.add_parser("report"); sr.add_argument("--dir", required=True)
    st = sub.add_parser("trim"); st.add_argument("--dir", required=True); st.add_argument("--out"); st.add_argument("--pad", type=int, default=4)
    sv = sub.add_parser("viewer"); sv.add_argument("--assets-dir", required=True); sv.add_argument("--project", required=True); sv.add_argument("--out", required=True); sv.add_argument("--bg")
    args = p.parse_args()
    {"scan": cmd_scan, "prep": cmd_prep, "crop": cmd_crop, "report": cmd_report, "trim": cmd_trim, "viewer": cmd_viewer}[args.cmd](args)

if __name__ == "__main__":
    main()
