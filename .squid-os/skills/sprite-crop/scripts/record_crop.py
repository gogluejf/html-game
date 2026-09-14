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

Crop block written (legacy row_y/col_x/frame_size/bg_* are DROPPED):
  {
    "frames_dir": "...",
    "pass": "<out_dir>",
    "margin": 8,                        # kept from previous block if present
    "frames_bbox": { "entity_action_f1.png": [x, y, w, h], ... }
  }
"""
import argparse, json, os, sys, time


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

    # --- per-frame bboxes ---
    bbox = {}
    for fr in frames:
        if "bbox" in fr:
            bbox[fr["file"]] = fr["bbox"]
        else:
            cx, cy = fr["center"]
            w, h = fr["size"]
            bbox[fr["file"]] = [cx - w // 2, cy - h // 2, w, h]

    # --- sync entities[].frames from the result (group by entity+action) ---
    by_ea = {}
    for fr in frames:
        key = (fr["entity"], fr["action"])
        by_ea.setdefault(key, []).append(fr)
    for key, flist in by_ea.items():
        flist.sort(key=lambda x: x["frame"])
        names = [f["file"] for f in flist]
        matched = False
        for e in sheet.get("entities", []):
            if e.get("name") == key[0] and e.get("anim") == key[1]:
                old = e.get("frames", [])
                e["frames"] = names
                if old != names:
                    print(f"  SYNC {key[0]}_{key[1]}: {len(old)} -> {len(names)} frames")
                matched = True
                break
        if not matched:
            print(f"  WARN: no entity entry for {key[0]}/{key[1]} — add it manually",
                  file=sys.stderr)

    # --- replace crop block (idempotent) ---
    crop = sheet.get("crop", {})
    new_crop = {
        "frames_dir": args.frames_dir or crop.get("frames_dir")
                     or (folder and state["folders"][folder]["path"]) or "",
        "pass": result.get("out_dir", ""),
        "frames_bbox": bbox,
    }
    if "margin" in crop:
        new_crop["margin"] = crop["margin"]
    sheet["crop"] = new_crop
    state["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    with open(args.state, "w") as f:
        json.dump(state, f, indent=2)

    print(f"RECORDED: {os.path.basename(sheet['file'])} -> {len(bbox)} frame bboxes "
          f"(frames_dir={new_crop['frames_dir']})")


if __name__ == "__main__":
    main()
