#!/usr/bin/env python3
"""
record-crop — the ONLY writer of crop data into the sprite-gen state file.

Reads the extract_frames.py --json result and, for the matching sheet entry:
  1. REPLACES the `crop` block with clean data (idempotent — safe on re-crops)
  2. SYNCS entities[].frames to exactly match the frames in the result
     (fixes count drift like expected-8/actual-7 automatically)

Nothing else may write crop data or frame lists. Agents never touch state;
this CLI is called once per sheet after frames are verified + installed.

Usage:
  python3 record_crop.py --state <state.json> --result <extract-result.json>
                         [--frames-dir <dir>]

Crop block written (legacy row_y/col_x/frame_size/bg_* are DROPPED; bbox now
lives inline on each frame, so crop only keeps sheet-level fields):
  {
    "frames_dir": "...",
    "pass": "<out_dir>",
    "margin": 8                              # kept from previous block if present
  }
Each entities[].frames entry becomes {file, row, col, bbox}.
"""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from state_format import compact as _compact_json


def _cluster(vals, n):
    """Map each value to cluster index 0..n-1 by cutting at the n-1 largest gaps."""
    s = sorted(set(vals))
    if len(s) <= 1 or n <= 1:
        return {v: 0 for v in s}
    gaps = [(s[i+1] - s[i], i) for i in range(len(s) - 1)]
    gaps.sort(reverse=True)
    cut_after = sorted(idx for _, idx in gaps[:n - 1])
    return {v: sum(1 for c in cut_after if c < s.index(v)) for v in s}


def derive_rowcol(frames, R, C):
    """Fallback: derive (row,col) per frame from bbox origin when not provided."""
    if not R or not C:
        return {}
    fb = {}
    for fr in frames:
        bb = fr.get("bbox") or ([fr["center"][0]-fr["size"][0]//2,
                                 fr["center"][1]-fr["size"][1]//2]+list(fr["size"]))
        fb[fr["file"]] = bb
    xc = _cluster([v[0] for v in fb.values()], C)
    yc = _cluster([v[1] for v in fb.values()], R)
    return {f: (yc.get(v[1]), xc.get(v[0])) for f, v in fb.items()}


def find_sheet(state, result):
    """Locate the sheet entry whose file matches the result's sheet path."""
    sheet_name = os.path.basename(result.get("sheet", ""))
    for folder, f in state.get("folders", {}).items():
        for sh in f.get("sheets", []):
            if os.path.basename(sh.get("file", "")) == sheet_name:
                return folder, sh
    for name, sh in state.get("sheets", {}).items():
        if os.path.basename(sh.get("file", "")) == sheet_name:
            return None, sh
    return None, None


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state", required=True)
    p.add_argument("--result", required=True, help="extract_frames.py --json output")
    p.add_argument("--frames-dir", help="override frames_dir in crop block")
    args = p.parse_args()

    with open(args.state) as f:
        state = json.load(f)
    with open(args.result) as f:
        result = json.load(f)

    folder, sheet = find_sheet(state, result)
    if sheet is None:
        print(f"ERROR: no sheet entry matches {result.get('sheet')}", file=sys.stderr)
        sys.exit(1)

    frames = result.get("frames", [])
    if not frames:
        print("ERROR: result has no frames", file=sys.stderr)
        sys.exit(1)

    # fallback row/col derivation from bbox (used when extract didn't emit them)
    R, C = sheet.get("rows", 0), sheet.get("cols", 0)
    rc_fallback = derive_rowcol(frames, R, C)

    # --- sync entities[].frames from the result (group by entity+action) ---
    # Each frame becomes {file, row, col, bbox} — single source of truth.
    by_ea = {}
    for fr in frames:
        key = (fr["entity"], fr["action"])
        by_ea.setdefault(key, []).append(fr)
    for key, flist in by_ea.items():
        flist.sort(key=lambda x: x["frame"])
        new_frames = []
        for fr in flist:
            if "bbox" in fr:
                bb = fr["bbox"]
            else:
                cx, cy = fr["center"]; w, h = fr["size"]
                bb = [cx - w // 2, cy - h // 2, w, h]
            r, c = fr.get("row"), fr.get("col")
            if r is None or c is None:
                dr, dc = rc_fallback.get(fr["file"], (None, None))
                r = r if r is not None else dr
                c = c if c is not None else dc
            new_frames.append({
                "file": fr["file"],
                "row": r,
                "col": c,
                "bbox": bb,
            })
        matched = False
        for e in sheet.get("entities", []):
            if e.get("name") == key[0] and e.get("anim") == key[1]:
                old = e.get("frames", [])
                e["frames"] = new_frames
                if len(old) != len(new_frames):
                    print(f"  SYNC {key[0]}_{key[1]}: {len(old)} -> {len(new_frames)} frames")
                matched = True
                break
        if not matched:
            print(f"  WARN: no entity entry for {key[0]}/{key[1]} — add it manually",
                  file=sys.stderr)

    # --- replace crop block (idempotent; bbox now lives inline on frames) ---
    crop = sheet.get("crop", {})
    new_crop = {
        "frames_dir": args.frames_dir or crop.get("frames_dir")
                     or (folder and state["folders"][folder]["path"]) or "",
        "pass": result.get("out_dir", ""),
    }
    if "margin" in crop:
        new_crop["margin"] = crop["margin"]
    sheet["crop"] = new_crop
    state["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    with open(args.state, "w") as f:
        f.write(_compact_json(state, 0) + "\n")

    n_frames = sum(len(e.get("frames", [])) for e in sheet.get("entities", []))
    print(f"RECORDED: {os.path.basename(sheet['file'])} -> {n_frames} frames "
          f"(frames_dir={new_crop['frames_dir']})")


if __name__ == "__main__":
    main()
