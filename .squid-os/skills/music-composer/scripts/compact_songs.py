#!/usr/bin/env python3
"""Compact-serialize music-composer song files (backbone + parts format).

Normal 2-space indent everywhere EXCEPT leaf arrays which are collapsed onto
ONE line each (identical data, purely cosmetic):
  - a bar of notes   -> ["E4", null, "B4", ...]         (lead/layer/bass bars)
  - a drum set       -> [{"k":..,"s":..,"h":..}, ...]   (drumKit values)
  - a pad chord map  -> {"0": [...], "16": [...]}       (pad section values)

Run after compose.py arch/parts. Idempotent.

Usage: compact_songs.py [game ...]   (default: every game dir under music-composer)
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent  # repo root
MC_DIR = ROOT / ".squid-os" / "music-composer"


def _is_note_bar(v):
    """A single bar: flat list of strings/nulls (no nested lists/dicts)."""
    return isinstance(v, list) and len(v) > 0 and all(x is None or isinstance(x, str) for x in v)


def _is_drum_set(v):
    return (isinstance(v, list) and len(v) > 0
            and all(isinstance(x, dict) and set(x.keys()) <= {"k", "s", "h"} for x in v))


def _is_pad_map(v):
    """pad section: dict of step-index (str) -> note list."""
    return (isinstance(v, dict) and len(v) > 0
            and all(isinstance(k, str) and k.isdigit() and _is_note_bar(val) for k, val in v.items()))


def compact(obj, ind=0):
    sp = "  " * ind
    sp1 = "  " * (ind + 1)
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        items = []
        for k, v in obj.items():
            key_str = json.dumps(k)
            cv = compact(v, ind + 1)
            # If value is a single-line leaf (note bar, drum set, pad map), keep inline
            if "\n" not in cv:
                items.append(f"{sp1}{key_str}: {cv}")
            else:
                items.append(f"{sp1}{key_str}: {cv}")
        return "{\n" + ",\n".join(items) + f"\n{sp}}}"
    if isinstance(obj, list):
        if not obj:
            return "[]"
        # Collapse leaf arrays onto one line
        if _is_note_bar(obj) or _is_drum_set(obj):
            inner = ", ".join(json.dumps(x) for x in obj)
            return "[" + inner + "]"
        items = ",\n".join(f"{sp1}{compact(x, ind + 1)}" for x in obj)
        return "[\n" + items + f"\n{sp}]"
    return json.dumps(obj)


def main():
    games = sys.argv[1:]
    if not games:
        games = sorted(p.name for p in MC_DIR.iterdir() if p.is_dir())

    total_checked = 0
    total_rewritten = 0
    for g in games:
        gdir = MC_DIR / g
        if not gdir.is_dir():
            print(f"SKIP {g}: no dir", file=sys.stderr)
            continue
        changed = 0
        checked = 0
        # Compact parts files
        for sf in sorted(gdir.glob("parts-*.json")):
            raw = sf.read_text()
            data = json.loads(raw)
            out = compact(data, 0) + "\n"
            json.loads(out)  # round-trip validate
            if out != raw:
                sf.write_text(out)
                changed += 1
            checked += 1
        # Compact backbone files
        bb_dir = gdir / "backbones"
        if bb_dir.is_dir():
            for sf in sorted(bb_dir.glob("*.json")):
                raw = sf.read_text()
                data = json.loads(raw)
                out = compact(data, 0) + "\n"
                json.loads(out)
                if out != raw:
                    sf.write_text(out)
                    changed += 1
                checked += 1
        total_checked += checked
        total_rewritten += changed
        print(f"{g}: checked {checked}, rewrote {changed}")

    print(f"done: {total_checked} file(s) checked, {total_rewritten} rewritten")


if __name__ == "__main__":
    main()
