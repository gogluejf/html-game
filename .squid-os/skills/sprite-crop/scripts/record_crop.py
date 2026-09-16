#!/usr/bin/env python3
"""
record-crop — the ONLY writer of crop data into the sprite-gen state file.

Reads the extract_frames.py --json result and, for the matching sheet entry:
  1. REPLACES sheet.entities ENTIRELY from the result (idempotent full rewrite).
     The result is the single source of truth for entity/frame data. No
     matching against old entries, no merge, no WARN path.
  2. REPLACES the `crop` block with clean data (idempotent — safe on re-crops)
  3. VERIFIES every frames[].file exists in frames_dir; warns on orphan PNGs
     in frames_dir not referenced by any entity on this sheet.

Sheet-level fields (file, size, rows, cols, cell, description, original_prompt)
belong to sprite-gen (--add-sheet) and are NEVER touched here.

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
Each entities[] entry: {name, anim, frames: [{file, row, col, bbox}, ...]}
with frames sorted by frame number.
"""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from state_format import compact as _compact_json


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

    # --- build the full replacement for sheet.entities from the result ---
    by_ea = {}
    order = []
    for fr in frames:
        key = (fr["entity"], fr.get("anim", fr.get("action")))
        if key not in by_ea:
            by_ea[key] = []
            order.append(key)
        by_ea[key].append(fr)

    new_entities = []
    for key in order:
        flist = sorted(by_ea[key], key=lambda x: x["frame"])
        new_frames = []
        for fr in flist:
            bb = fr.get("bbox")
            if bb is None:
                cx, cy = fr["center"]; w, h = fr["size"]
                bb = [cx - w // 2, cy - h // 2, w, h]
            new_frames.append({
                "file": fr["file"],
                "row": fr.get("row"),
                "col": fr.get("col"),
                "bbox": bb,
            })
        new_entities.append({"name": key[0], "anim": key[1], "frames": new_frames})

    sheet["entities"] = new_entities

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

    # --- verify: recorded files exist on disk; warn on orphans ---
    fd = new_crop["frames_dir"]
    missing = [f_["file"] for e in new_entities for f_ in e["frames"]
               if fd and not os.path.exists(os.path.join(fd, f_["file"]))]
    if missing:
        print(f"ERROR: {len(missing)} recorded frames missing from {fd}: {missing[:5]}...",
              file=sys.stderr)
        sys.exit(1)

    if fd and os.path.isdir(fd):
        # Orphans = unreferenced PNGs whose name starts with one of THIS
        # sheet's entity names (other sheets/entities share the same dir).
        prefixes = tuple(e["name"] for e in new_entities)
        recorded = {f_["file"] for e in new_entities for f_ in e["frames"]}
        orphans = sorted(n for n in os.listdir(fd)
                         if n.endswith(".png") and n.startswith(prefixes)
                         and n not in recorded)
        if orphans:
            print(f"  ORPHANS in {fd} (not referenced by this sheet): {orphans}")

    n_frames = sum(len(e["frames"]) for e in new_entities)
    ents = ", ".join(f"{e['name']}/{e['anim']}x{len(e['frames'])}" for e in new_entities)
    print(f"RECORDED: {os.path.basename(sheet['file'])} -> {n_frames} frames ({ents})")


if __name__ == "__main__":
    main()
