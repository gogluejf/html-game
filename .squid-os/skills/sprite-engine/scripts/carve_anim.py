#!/usr/bin/env python3
"""carve_anim.py — carve frame ranges out of a per-anim sheet into new anims.

The AI's classic fault pattern: you ask for one action, it sneaks another in
(e.g. frames 7-8 of "shoot" are actually the explosion). This tool cuts any
number of ranges out of the source anim and re-glues EVERYTHING from scratch:

  before (9f):  f1 f2 | f3 f4 f5 f6 | f7 f8 f9
                keep   └ carve A    └ keep
  after:
    original anim: f1 f2 f7 f8 f9 -> renumbered f1..f5, fresh 1x5 sheet
    new anim A:    f3 f4 f5 f6    -> f1..f4, fresh 1x4 sheet

Usage:
  python3 carve_anim.py --sheet <path/to/anim_sheet.json> \
      --carve explode:7-8 [--carve special:3-5 ...] [--dry-run]

Rules:
  - ranges are 1-based over the CURRENT frame order, inclusive
  - ranges must not overlap; targets must not already exist
  - survivors keep their relative order and are renumbered from f1
  - old sheet PNG+JSON are overwritten (frames are the source of truth)
  - refuses if repo code references frame files that would be renumbered
  - full pixel round-trip verification of every output sheet at the end
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glue import glue_frames, write_twin_json, verify_roundtrip


def parse_carve(spec):
    m = re.fullmatch(r"([a-z0-9_]+):(\d+)(?:-(\d+))?", spec)
    if not m:
        raise SystemExit(f"bad --carve '{spec}' (want NAME:FROM-TO or NAME:N)")
    name, a = m.group(1), int(m.group(2))
    b = int(m.group(3) or a)
    if a < 1 or b < a:
        raise SystemExit(f"bad range in '{spec}'")
    return name, a, b


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", required=True, help="source per-anim sheet JSON")
    ap.add_argument("--carve", action="append", required=True,
                    help="NAME:FROM-TO (repeatable); 1-based inclusive over current frames")
    ap.add_argument("--root", required=True, help="repo root (for code-reference safety check)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    ROOT = os.path.abspath(args.root)

    jf = os.path.abspath(args.sheet)
    d = json.load(open(jf))
    ents = d.get("entities", [])
    if len(ents) != 1:
        raise SystemExit(f"expected a per-anim sheet (1 entity), found {len(ents)}")
    e = ents[0]
    src_anim, name = e["anim"], e["name"]
    base = os.path.dirname(jf)
    n = len(e["frames"])
    src_files = [os.path.join(base, f["file"]) for f in e["frames"]]

    carves = [parse_carve(c) for c in args.carve]
    # validate ranges
    used = set()
    for cname, a, b in carves:
        rng = set(range(a, b + 1))
        if rng & used:
            raise SystemExit(f"ranges overlap: {cname}:{a}-{b}")
        used |= rng
        if b > n:
            raise SystemExit(f"{cname}:{a}-{b} exceeds frame count {n}")
        tgt = os.path.join(base, f"{cname}_sheet.json")
        if os.path.exists(tgt):
            raise SystemExit(f"target exists, refusing to overwrite: {tgt}")
    if used == set(range(1, n + 1)):
        raise SystemExit("carving ALL frames leaves an empty source anim")

    keep_idx = [i for i in range(n) if (i + 1) not in used]

    # safety: refuse if repo code references frame files that get renumbered/moved
    moved = [src_files[i] for i in range(n) if (i + 1) in used] + \
            [src_files[i] for i in keep_idx]
    risky = []
    for p in moved:
        fn = os.path.basename(p)
        r = subprocess.run(["grep", "-rln", fn, "--include=*.js", "--include=*.html",
                            ROOT],
                           capture_output=True, text=True)
        hits = [h for h in r.stdout.splitlines() if "/assets/" not in h]
        if hits:
            risky.append((fn, hits[:3]))
    if risky and not args.dry_run:
        print("REPO CODE REFERENCES these frame files (would break):")
        for fn, hits in risky:
            print(f"  {fn}: {hits}")
        raise SystemExit("fix references first, or re-run with --dry-run to just see the plan")

    plan = {"keep": [(i + 1, os.path.basename(src_files[i])) for i in keep_idx]}
    for cname, a, b in carves:
        plan[cname] = [os.path.basename(src_files[i]) for i in range(a - 1, b)]
    print(f"source: {os.path.relpath(jf)} ({name}/{src_anim}, {n}f)")
    for k, v in plan.items():
        print(f"  {'KEEP ' if k == 'keep' else 'CARVE '}{k if k!='keep' else src_anim}: {v}")
    if args.dry_run:
        print("dry run — nothing written")
        return

    # execute: rename carved frames first (to temp names so nothing collides),
    # then renumber survivors, then re-glue everything.
    tmp = {}
    for cname, a, b in carves:
        for j, i in enumerate(range(a - 1, b), 1):
            newp = os.path.join(base, f".tmp_{cname}_{j}.png")
            os.replace(src_files[i], newp)
            tmp[(cname, j)] = newp
    # renumber survivors
    for newnum, i in enumerate(keep_idx, 1):
        want = os.path.join(base, f"{src_anim}_f{newnum}.png")
        if os.path.abspath(src_files[i]) != os.path.abspath(want):
            os.replace(src_files[i], want)
    keep_files = [os.path.join(base, f"{src_anim}_f{i}.png") for i in range(1, len(keep_idx) + 1)]

    frames_dir_rel = e.get("frames_dir") or os.path.relpath(base, ROOT)
    # rebuild source sheet
    nf, r, c, W, H = glue_frames(keep_files, os.path.join(base, f"{src_anim}_sheet.png"))
    write_twin_json(os.path.join(base, f"{src_anim}_sheet.json"), frames_dir_rel,
                    name, src_anim, [os.path.basename(p) for p in keep_files],
                    nf, r, c, W, H, kind=d.get("kind", "animation"),
                    description=f"{name} {src_anim} ({len(keep_files)} frames) — carved")
    print(f"rebuilt {src_anim}: {len(keep_files)}f grid {r}x{c}")
    # build each carved anim
    for cname, a, b in carves:
        cnt = b - a + 1
        final = [os.path.join(base, f"{cname}_f{j}.png") for j in range(1, cnt + 1)]
        for j in range(1, cnt + 1):
            os.replace(tmp[(cname, j)], final[j - 1])
        nf, r, c, W, H = glue_frames(final, os.path.join(base, f"{cname}_sheet.png"))
        write_twin_json(os.path.join(base, f"{cname}_sheet.json"), frames_dir_rel,
                        name, cname, [os.path.basename(p) for p in final],
                        nf, r, c, W, H, kind=d.get("kind", "animation"),
                        description=f"{name} {cname} ({cnt} frames) — carved from {src_anim}")
        print(f"carved {cname}: {cnt}f grid {r}x{c}")

    # verify everything
    bad = 0
    bad += verify_roundtrip(os.path.join(base, f"{src_anim}_sheet.json"))
    for cname, _, _ in carves:
        bad += verify_roundtrip(os.path.join(base, f"{cname}_sheet.json"))
    if bad:
        raise SystemExit(f"VERIFICATION FAILED on {bad} frames — inspect before using")
    print("round-trip verified: all sheets exact")


if __name__ == "__main__":
    main()
