#!/usr/bin/env python3
"""glue.py — shared sheet-gluing primitive for sprite-engine.

One source of truth for "frames -> fresh sheet PNG + exact bbox JSON".
Used by reassemble.py (migration) and carve_anim.py (anim carving).
"""
import json
import os
from PIL import Image


def glue_frames(frame_files, out_png, cols=None):
    """Glue frame PNGs (in order) into a fresh sheet.

    Layout: if cols is None → single row (1 x N). Otherwise wrap at `cols`.
    Cell size = max frame width per column, max frame height per row;
    each frame centered in its cell (transparent padding).

    Returns (new_frames, rows, cols_used, W, H) where new_frames is a list of
    dicts {row, col, bbox} aligned with frame_files order (bbox = exact paste
    offset + actual frame size).
    """
    imgs = [Image.open(f).convert("RGBA") for f in frame_files]
    n = len(imgs)
    c = cols or n
    r = (n + c - 1) // c
    # grid slots in reading order
    col_w = [0] * c
    row_h = [0] * r
    for i, im in enumerate(imgs):
        ri, ci = divmod(i, c)
        col_w[ci] = max(col_w[ci], im.width)
        row_h[ri] = max(row_h[ri], im.height)
    W, H = sum(col_w), sum(row_h)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    col_x, row_y = [0], [0]
    for w in col_w:
        col_x.append(col_x[-1] + w)
    for h in row_h:
        row_y.append(row_y[-1] + h)
    new_frames = []
    for i, im in enumerate(imgs):
        ri, ci = divmod(i, c)
        fx = col_x[ci] + (col_w[ci] - im.width) // 2
        fy = row_y[ri] + (row_h[ri] - im.height) // 2
        canvas.paste(im, (fx, fy))   # plain paste: lossless (self-mask corrupts semi-transparent px)
        new_frames.append({"row": ri, "col": ci, "bbox": [fx, fy, im.width, im.height]})
    canvas.save(out_png)
    return new_frames, r, c, W, H


def write_twin_json(out_json, frames_dir_rel, entity_name, anim, file_names,
                    new_frames, rows, cols, W, H, kind="animation", description=""):
    """Write the twin JSON for a freshly glued sheet. Paths are repo-root-relative."""
    doc = {
        "file": os.path.join(frames_dir_rel, os.path.basename(out_json)[:-5] + ".png").replace(os.sep, "/"),
        "size": f"{W}x{H}",
        "rows": rows,
        "cols": cols,
        "kind": kind,
        "description": description or f"{entity_name} {anim} ({len(file_names)} frames)",
        "entities": [{
            "name": entity_name,
            "anim": anim,
            "frames_dir": frames_dir_rel,
            "frames": [
                {"file": fn, "row": nf["row"], "col": nf["col"], "bbox": nf["bbox"]}
                for fn, nf in zip(file_names, new_frames)
            ],
        }],
        "updated": __import__("datetime").date.today().isoformat(),
    }
    with open(out_json, "w") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    return doc


def verify_roundtrip(sheet_json_path):
    """Pixel-verify every frame crops back out of its sheet exactly. Returns bad count."""
    from PIL import ImageChops
    d = json.load(open(sheet_json_path))
    fpath = d["file"]
    if not os.path.isabs(fpath) and not os.path.exists(fpath):
        # fall back to resolving next to the JSON (sandbox/foreign trees)
        fpath = os.path.join(os.path.dirname(sheet_json_path),
                             os.path.basename(fpath))
    sheet = Image.open(fpath)
    W, H = map(int, d["size"].split("x"))
    assert sheet.size == (W, H), f"size mismatch {sheet.size} != {(W, H)}"
    bad = 0
    base_dir = os.path.dirname(sheet_json_path)
    for e in d["entities"]:
        fdir = e.get("frames_dir") or base_dir
        if not os.path.isdir(fdir):
            fdir = base_dir   # sandbox/foreign tree: frames live next to the JSON
        for f in e["frames"]:
            x, y, w, h = f["bbox"]
            region = sheet.crop((x, y, x + w, y + h)).convert("RGBA")
            frame = Image.open(os.path.join(fdir, f["file"])).convert("RGBA")
            if ImageChops.difference(region, frame).getbbox() is not None:
                bad += 1
                print(f"  ROUNDTRIP FAIL: {f['file']}")
    return bad
