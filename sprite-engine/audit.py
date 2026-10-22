#!/usr/bin/env python3
"""audit.py — dry-run auditor for split-sheet-per-anim.

Reads every sheet JSON, checks that referenced frames exist on disk,
bbox sanity vs actual frame size, and target name collisions.
Read-only. Exit 1 on hard errors.
"""
import json, glob, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # html-game


def find_sheet_jsons(projects=None, include_single=True):
    pats = [
        "*/assets/*/_sheets/*.json",          # holding pens
        "*/assets/*/*/*_sheet.json",          # entity-dir sheets
    ]
    out = []
    for pat in pats:
        for p in glob.glob(os.path.join(ROOT, pat)):
            if os.path.basename(p).startswith("."):
                continue
            if not include_single:
                try:
                    d = json.load(open(p))
                    if len(d.get("entities", [])) <= 1:
                        continue
                except Exception:
                    pass
            parts = p.split(os.sep)
            proj = parts[-5] if "_sheets" in p else parts[-6]
            if projects and proj not in projects:
                continue
            out.append(p)
    return sorted(set(out))


def frame_dir(jf, entity_name):
    """Entity dir for a sheet json: pens live in {cat}/_sheets/, entity dir is sibling."""
    base = os.path.dirname(jf)
    if os.path.basename(base) == "_sheets":
        return os.path.join(os.path.dirname(base), entity_name)
    return base


def audit_sheet(jf):
    d = json.load(open(jf))
    errs, warns, rows = [], [], []
    for e in d.get("entities", []):
        name, anim = e["name"], e.get("anim", "?")
        fdir = frame_dir(jf, name)
        n = len(e.get("frames", []))
        missing, drift = [], []
        for f in e.get("frames", []):
            fp = os.path.join(fdir, f["file"])
            if not os.path.exists(fp):
                missing.append(f["file"])
                continue
            bbox = f.get("bbox")
            if bbox:
                with Image.open(fp) as im:
                    w, h = im.size
                bw, bh = bbox[2], bbox[3]
                if abs(w - bw) > 2 or abs(h - bh) > 2:
                    drift.append(f"{f['file']} disk={w}x{h} json={bw}x{bh}")
        # target collision
        tgt_png = os.path.join(fdir, f"{anim}_sheet.png")
        tgt_json = os.path.join(fdir, f"{anim}_sheet.json")
        collides = []
        # only a collision if it's NOT the sheet being audited itself
        if os.path.exists(tgt_png) and os.path.abspath(tgt_png) != os.path.abspath(d.get("file", "")):
            collides.append("png")
        if os.path.exists(tgt_json) and os.path.abspath(tgt_json) != os.path.abspath(jf):
            collides.append("json")
        flag = "OK"
        if missing:
            flag = "MISSING-FRAMES"; errs.append(f"{jf} {name}/{anim}: missing {missing}")
        if collides:
            flag = "TARGET-COLLIDES"; warns.append(f"{jf} {name}/{anim}: target exists ({','.join(collides)})")
        if drift:
            flag = (flag + "+DRIFT") if flag != "OK" else "DRIFT"
            warns.append(f"{jf} {name}/{anim}: bbox drift: {drift[:3]}{'...' if len(drift)>3 else ''}")
        rows.append((name, anim, n, flag))
    return rows, errs, warns


def main():
    projects = None
    args = sys.argv[1:]
    if "--project" in args:
        projects = set(args[args.index("--project") + 1].split(","))
    total_sheets = total_anims = 0
    all_errs, all_warns = [], []
    for jf in find_sheet_jsons(projects):
        rel = os.path.relpath(jf, ROOT)
        rows, errs, warns = audit_sheet(jf)
        total_sheets += 1
        total_anims += len(rows)
        all_errs += errs; all_warns += warns
        print(f"\n== {rel}  ({len(rows)} anims)")
        for name, anim, n, flag in rows:
            mark = "  " if flag == "OK" else "!!"
            print(f" {mark} {name}/{anim}  {n}f  {flag}")
    print(f"\n--- SUMMARY: {total_sheets} sheets -> {total_anims} per-anim sheets")
    if all_warns:
        print(f"WARNINGS ({len(all_warns)}):")
        for w in all_warns: print("  !", w)
    if all_errs:
        print(f"HARD ERRORS ({len(all_errs)}):")
        for e in all_errs: print("  X", e)
        sys.exit(1)
    print("No hard errors.")


if __name__ == "__main__":
    main()
