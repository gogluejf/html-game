#!/usr/bin/env python3
"""
record-crop — the ONLY writer of crop data into a sheet's json file.

Twin-JSON model: each sheet's json lives NEXT TO its PNG in the assets tree at
  <assets-dir>/<category>/<entity>/<anim>_sheet.json
(never under .squid-os/sprite-sheets/ — that dir holds only <project>.meta.json).
This CLI is pointed at that ONE file (--sheet, any path to the twin) and rewrites
only it. It never reads sibling sheets, so a single-sheet crop touches a few KB,
not the whole project state.

Reads the extract_frames.py --json result and, for the given sheet file:
  1. REPLACES sheet.entities ENTIRELY from the result (idempotent full rewrite).
     The result is the single source of truth for entity/frame data. No
     matching against old entries, no merge, no WARN path.
  2. REPLACES the `crop` block with clean data (idempotent — safe on re-crops)
  3. VERIFIES every frames[].file exists in cropped_path; warns on orphan PNGs
     in cropped_path not referenced by any entity on this sheet.

Sheet-level fields (file, size, rows, cols, cell, description, original_prompt)
belong to sprite-gen (--add-sheet) and are NEVER touched here.

Nothing else may write crop data or frame lists. Agents never touch state;
this CLI is called once per sheet after frames are verified + installed.

Usage:
  python3 record_crop.py --sheet <assets-dir>/<category>/<entity>/<anim>_sheet.json \
                         --result <extract-result.json> [--frames-dir <dir>]

Crop block written (legacy row_y/col_x/frame_size/bg_* are DROPPED; bbox now
lives inline on each frame, so crop only keeps sheet-level fields):
  {
    "frames_dir": "...",
    "pass": "<out_dir>",
    "margin": 8                              # kept from previous block if present
  }
Each entities[] entry: {name, anim, frames_dir, frames: [{file, row, col, bbox}, ...]}
with frames sorted by frame number. Existing non-crop/tuning fields are preserved
by matching (name, anim) and frame filename; no silent data loss is allowed.
"""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from state_format import compact as _compact_json


def repair_frames_dir(sheet_path):
    """Restore entity-level frames_dir without touching crop or tuning data."""
    with open(sheet_path) as f:
        sheet = json.load(f)
    ents = sheet.get("entities", [])
    if not ents:
        print("ERROR: no entities to repair", file=sys.stderr)
        sys.exit(1)

    fallbacks = []
    crop_fd = (sheet.get("crop") or {}).get("frames_dir")
    if crop_fd and os.path.isdir(crop_fd):
        fallbacks.append(os.path.abspath(crop_fd))
    fallbacks.append(os.path.abspath(os.path.dirname(sheet_path)))

    repaired = 0
    for e in ents:
        fd = e.get("frames_dir")
        if fd and os.path.isdir(fd):
            continue
        candidates = [os.path.abspath(fd)] if fd else []
        candidates.extend(fallbacks)
        # Prefer the first candidate containing every recorded frame.
        chosen = next((c for c in candidates
                       if all(os.path.exists(os.path.join(c, fr["file"]))
                              for fr in e.get("frames", []))), None)
        if not chosen:
            print(f"ERROR: cannot resolve frames_dir for {e.get('name')}/{e.get('anim')}: "
                  f"tried {candidates}", file=sys.stderr)
            sys.exit(1)
        e["frames_dir"] = os.path.relpath(chosen, os.getcwd())
        repaired += 1

    if not repaired:
        print(f"OK: already complete ({sheet_path})")
        return
    tmp = sheet_path + ".tmp"
    with open(tmp, "w") as f:
        f.write(_compact_json(sheet, 0) + "\n")
    os.replace(tmp, sheet_path)
    print(f"REPAIRED: {repaired} entity path(s) in {os.path.basename(sheet_path)}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--sheet", help="path to the single sheet json to update")
    p.add_argument("--result", help="extract_frames.py --json output")
    p.add_argument("--frames-dir", help="override frames_dir in crop block")
    p.add_argument("--repair-frames-dir", action="store_true",
                   help="repair missing entity-level frames_dir values from the crop block or sheet directory without re-cropping")
    args = p.parse_args()

    if args.repair_frames_dir:
        repair_frames_dir(args.sheet)
        return

    if not args.sheet or not args.result:
        p.error("--sheet and --result are required unless --repair-frames-dir is used")

    if not os.path.exists(args.sheet):
        print(f"ERROR: sheet file not found: {args.sheet}", file=sys.stderr)
        sys.exit(1)
    with open(args.sheet) as f:
        sheet = json.load(f)
    with open(args.result) as f:
        result = json.load(f)

    # Sanity: the result's sheet path should match this file's 'file' field.
    res_sheet = os.path.basename(result.get("sheet", ""))
    my_sheet = os.path.basename(sheet.get("file", ""))
    if res_sheet and my_sheet and res_sheet != my_sheet:
        print(f"WARNING: result sheet '{res_sheet}' != this file '{my_sheet}'. "
              f"Recording anyway.", file=sys.stderr)

    frames = result.get("frames", [])
    if not frames:
        print("ERROR: result has no frames", file=sys.stderr)
        sys.exit(1)

    # --- build the full replacement for sheet.entities from the result ---
    old_entities = {}
    for e in sheet.get("entities", []):
        key = (e.get("name"), e.get("anim"))
        if key in old_entities:
            print(f"ERROR: duplicate existing entity {key[0]}/{key[1]}; refusing to guess which record to preserve", file=sys.stderr)
            sys.exit(1)
        old_entities[key] = e

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
        old_ent = old_entities.pop(key, {})
        old_frames = {f.get("file"): f for f in old_ent.get("frames", [])}
        if len(old_frames) != len(old_ent.get("frames", [])):
            print(f"ERROR: duplicate frame filenames in existing {key[0]}/{key[1]}; refusing to guess which tuning to preserve", file=sys.stderr)
            sys.exit(1)
        new_frames = []
        for fr in flist:
            bb = fr.get("bbox")
            if bb is None:
                cx, cy = fr["center"]; w, h = fr["size"]
                bb = [cx - w // 2, cy - h // 2, w, h]
            nf = dict(old_frames.get(fr["file"], {}))
            nf.update({
                "file": fr["file"],
                "row": fr.get("row"),
                "col": fr.get("col"),
                "bbox": bb,
            })
            new_frames.append(nf)
        ne = dict(old_ent)
        ne.update({"name": key[0], "anim": key[1], "frames": new_frames})
        new_entities.append(ne)

    # Preserve pre-crop entities that are unrelated to this crop pass. This keeps
    # multi-entity sheets and already-tuned records intact while still replacing
    # every entity described by the extraction result.
    new_entities.extend(old_entities.values())

    sheet["entities"] = new_entities

    # --- replace crop block (idempotent; bbox now lives inline on frames) ---
    crop = sheet.get("crop", {})
    new_crop = {
        "frames_dir": args.frames_dir or crop.get("frames_dir")
                     or sheet.get("cropped_path", "") or "",
        "pass": result.get("out_dir", ""),
    }
    if "margin" in crop:
        new_crop["margin"] = crop["margin"]

    # Entity-level frames_dir is the runtime/editor source of truth. The crop
    # block remains for provenance, but both must agree after recording.
    fd_abs = os.path.abspath(new_crop["frames_dir"]) if new_crop["frames_dir"] else None
    if not new_crop["frames_dir"] or not os.path.isdir(fd_abs):
        print(f"ERROR: frames_dir '{new_crop['frames_dir']}' does not exist", file=sys.stderr)
        sys.exit(1)
    for e in new_entities:
        e["frames_dir"] = os.path.relpath(fd_abs, os.getcwd())

    # Validate all referenced frame files before mutating the original file.
    missing = [fr["file"] for e in new_entities for fr in e["frames"]
               if not os.path.exists(os.path.join(fd_abs, fr["file"]))]
    if missing:
        print(f"ERROR: {len(missing)} recorded frames missing from {fd_abs}: {missing[:5]}...",
              file=sys.stderr)
        sys.exit(1)

    sheet["entities"] = new_entities
    sheet["crop"] = new_crop
    sheet["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    with open(args.sheet, "w") as f:
        f.write(_compact_json(sheet, 0) + "\n")

    # --- verify: recorded files exist on disk; warn on orphans ---
    fd = new_crop["frames_dir"]
    if os.path.isdir(fd):
        # Orphans = unreferenced FRAME pngs of THIS sheet's anim(s) only.
        # Frames are named {anim}_f{N}.png; other actions' frames belong to
        # their own sheets, and sheets/raws are not frames by definition.
        import re as _re
        anims = tuple(e["anim"] for e in new_entities)
        frame_res = [_re.compile(rf"^{_re.escape(a)}_f\d+\.png$") for a in anims]
        recorded = {f_["file"] for e in new_entities for f_ in e["frames"]}
        orphans = sorted(n for n in os.listdir(fd)
                         if any(rx.match(n) for rx in frame_res)
                         and n not in recorded)
        if orphans:
            print(f"  ORPHAN FRAMES in {fd} (this sheet's anims, not referenced): {orphans}")

    n_frames = sum(len(e["frames"]) for e in new_entities)
    ents = ", ".join(f"{e['name']}/{e['anim']}x{len(e['frames'])}" for e in new_entities)
    print(f"RECORDED: {os.path.basename(sheet.get('file','?'))} -> {n_frames} frames ({ents})")


if __name__ == "__main__":
    main()
