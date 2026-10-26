#!/usr/bin/env python3
"""Normalize every one-json-per-sheet file to the canonical compact format.

The migration step wrote sheets with plain json.dump(indent=2) — frames and
bboxes spread across many lines. record_crop.py, however, serializes with
state_format.compact(): each frame object on ONE line and each bbox array on
ONE line. This pass rewrites every .squid-os/sprite-sheets/<proj>/<label>/*.json
through that same serializer so all sheets are byte-consistent with what a
future crop will produce (no formatting churn on re-crop).

Purely cosmetic — identical data, validated by a JSON round-trip per file.

Usage: normalize_sheets.py [project ...]   (default: all projects under sprite-sheets)
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from state_format import compact as _compact_json

ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent  # repo root
SHEETS_ROOT = ROOT / ".squid-os" / "sprite-sheets"


def main():
    projects = sys.argv[1:]
    if not projects:
        projects = sorted(p.name for p in SHEETS_ROOT.iterdir() if p.is_dir())

    n_files = 0
    for proj in projects:
        proj_dir = SHEETS_ROOT / proj
        if not proj_dir.is_dir():
            print(f"SKIP {proj}: no dir", file=sys.stderr)
            continue
        count = 0
        for shf in sorted(proj_dir.glob("*/*.json")):
            raw = shf.read_text()
            data = json.loads(raw)                        # parse (validates)
            out = _compact_json(data, 0) + "\n"
            json.loads(out)                               # round-trip validate
            if out != raw:
                shf.write_text(out)
            count += 1
        n_files += count
        print(f"{proj}: normalized {count} sheet file(s)")
    print(f"done: {n_files} sheet file(s) checked")


if __name__ == "__main__":
    main()
