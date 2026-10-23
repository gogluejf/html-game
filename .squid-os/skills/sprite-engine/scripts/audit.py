#!/usr/bin/env python3
"""audit.py — ground-truth sheet auditor for sprite-engine.

Walks the filesystem (os.walk — NO glob patterns; pattern-based scans are how
the _2/_3/_4-suffixed sheets got missed in the original migration). Checks:

  1. every *_sheet.json has `kind` and exactly one entity (per-anim convention)
  2. gap check: every frame-anim on disk ({anim}_fN.png) has its {anim}_sheet.json
  3. internal consistency: size decl == PNG size, bboxes in bounds, frames exist,
     grid decl == actual max row/col
  4. PIXEL ROUND-TRIP: crop each frame out of its sheet at its bbox and compare
     to the frame file — must be identical

Exit 0 = clean, 1 = problems found. Read-only.
"""
import json
import os
import re
import sys
from PIL import Image, ImageChops

import argparse
import json
import os
import re
import sys
from PIL import Image, ImageChops


def walk_sheets(root):
    out = []
    for dirpath, dirs, files in os.walk(root):
        if "/.git" in dirpath or os.path.basename(dirpath) == ".git":
            continue
        for f in files:
            if f.endswith("_sheet.json"):
                out.append(os.path.join(dirpath, f))
    return sorted(out)


def main():
    ap = argparse.ArgumentParser(description="ground-truth sheet auditor (read-only)")
    ap.add_argument("--root", required=True, help="repo root to scan")
    ap.add_argument("filter", nargs="?", default=None, help="optional substring filter on paths")
    args = ap.parse_args()
    ROOT = os.path.abspath(args.root)
    only = args.filter
    sheets = [s for s in walk_sheets(ROOT) if not only or only in s]
    errs = rt_bad = 0

    # 1+3+4 per sheet
    for jf in sheets:
        rel = os.path.relpath(jf, ROOT)
        d = json.load(open(jf))
        ents = d.get("entities", [])
        if "kind" not in d:
            print(f"X {rel}: missing kind"); errs += 1
        if len(ents) != 1:
            print(f"X {rel}: {len(ents)} entities (expected 1)"); errs += 1
        fpath = d["file"]
        if not os.path.isabs(fpath) and not os.path.exists(fpath):
            fpath = os.path.join(os.path.dirname(jf), os.path.basename(fpath))
        if not os.path.exists(fpath):
            print(f"X {rel}: missing PNG {d['file']}"); errs += 1
            continue
        sheet = Image.open(fpath)
        W, H = map(int, d["size"].split("x"))
        if sheet.size != (W, H):
            print(f"X {rel}: size decl {d['size']} != actual {sheet.size}"); errs += 1
            continue
        maxr = maxc = 0
        for e in ents:
            fdir = e.get("frames_dir") or os.path.dirname(jf)
            if not os.path.isdir(fdir):
                fdir = os.path.dirname(jf)
            for f in e["frames"]:
                bbox = f.get("bbox")
                if bbox is None:
                    print(f"X {rel} {f['file']}: no bbox"); errs += 1
                    continue
                x, y, w, h = bbox
                if not (0 <= x and 0 <= y and x + w <= W and y + h <= H):
                    print(f"X {rel} {f['file']}: bbox out of bounds"); errs += 1
                    continue
                fp = os.path.join(fdir, f["file"])
                if not os.path.exists(fp):
                    print(f"X {rel} {f['file']}: frame missing on disk"); errs += 1
                    continue
                region = sheet.crop((x, y, x + w, y + h)).convert("RGBA")
                frame = Image.open(fp).convert("RGBA")
                if ImageChops.difference(region, frame).getbbox() is not None:
                    rt_bad += 1
                    print(f"X {rel} {f['file']}: PIXEL MISMATCH (sheet out of sync)")
                maxr = max(maxr, f["row"]); maxc = max(maxc, f["col"])
        if maxr + 1 != d["rows"] or maxc + 1 != d["cols"]:
            print(f"X {rel}: grid decl {d['rows']}x{d['cols']} != actual {maxr+1}x{maxc+1}")
            errs += 1

    # 2. gap check (frame anims without a sheet)
    gaps = 0
    for dirpath, dirs, files in os.walk(ROOT):
        if "/.git" in dirpath or os.path.basename(dirpath) == ".git":
            continue
        if only and only not in dirpath:
            continue
        frames = [f for f in files if re.match(r"[a-z0-9_]+?_f\d+\.png$", f)]
        if not frames:
            continue
        anims = set(re.match(r"([a-z0-9_]+?)_f\d+\.png$", f).group(1) for f in frames)
        for anim in anims:
            if not os.path.exists(os.path.join(dirpath, f"{anim}_sheet.json")):
                gaps += 1
                print(f"X GAP: {os.path.relpath(dirpath, ROOT)}/{anim} frames have no {anim}_sheet.json")
                errs += 1

    print(f"\nAUDIT: {len(sheets)} sheets | structural errors: {errs} | "
          f"pixel mismatches: {rt_bad} | gaps: {gaps}")
    sys.exit(1 if (errs or rt_bad) else 0)


if __name__ == "__main__":
    main()
