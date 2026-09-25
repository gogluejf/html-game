#!/usr/bin/env python3
"""Compact-serialize music-composer song files: inline the leaf note/drum arrays.

Normal 2-space indent everywhere EXCEPT the "hard to read" leaf arrays, which are
collapsed onto ONE line each (identical data, purely cosmetic):
  - a note phrase  -> ["E4", null, "B4", ...]          (bass[i], leads[i], leadLayers[i])
  - a pad chord map-> {"0": [...], "8": [...], ...}    (pads[i])
  - a drum set     -> [{"k":..,"s":..,"h":..}, ...]    (drums[i])

This mirrors what sprite-crop's state_format.compact does for frames/bboxes, so a
song file reads at a glance instead of ~160 lines of one-note-per-line.

Run after split_songs.py / compose. Idempotent (re-running is a no-op once compact).

Usage: compact_songs.py [game ...]   (default: every <game>/ dir under music-composer)
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent  # repo root
MC_DIR = ROOT / ".squid-os" / "music-composer"


def _is_note_phrase(v):
    """A 32-step phrase: list of strings/nulls (no nested lists/dicts)."""
    return isinstance(v, list) and all(x is None or isinstance(x, str) for x in v)


def _is_drum_set(v):
    return (isinstance(v, list) and len(v) > 0
            and all(isinstance(x, dict) and set(x.keys()) <= {"k", "s", "h"} for x in v))


def _is_pad_map(v):
    """pads[i]: dict of step-index (str) -> note list."""
    return (isinstance(v, dict)
            and all(isinstance(k, str) and _is_note_phrase(val) for k, val in v.items()))


def compact(obj, ind=0):
    sp = "  " * ind
    sp1 = "  " * (ind + 1)
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        items = [f"{sp1}{json.dumps(k)}: {compact(v, ind + 1)}" for k, v in obj.items()]
        return "{\n" + ",\n".join(items) + f"\n{sp}}}"
    if isinstance(obj, list):
        if not obj:
            return "[]"
        # collapse the leaf arrays onto one line (raw json.dumps so nested
        # {k,s,h} drum objects stay inline too)
        if _is_note_phrase(obj) or _is_drum_set(obj):
            inner = ", ".join(json.dumps(x) for x in obj)
            return "[" + inner + "]"
        items = ",\n".join(f"{sp1}{compact(x, ind + 1)}" for x in obj)
        return "[\n" + items + f"\n{sp}]"
    return json.dumps(obj)


def main():
    games = sys.argv[1:]
    if not games:
        games = sorted(p.name for p in MC_DIR.iterdir() if p.is_dir())

    n = 0
    for g in games:
        gdir = MC_DIR / g
        if not gdir.is_dir():
            print(f"SKIP {g}: no dir", file=sys.stderr)
            continue
        changed = 0
        for sf in sorted(gdir.glob("*.json")):
            raw = sf.read_text()
            data = json.loads(raw)                 # validate input
            out = compact(data, 0) + "\n"
            json.loads(out)                        # round-trip validate
            if out != raw:
                sf.write_text(out)
                changed += 1
            n += 1
        print(f"{g}: checked {len(list(gdir.glob('*.json')))}, rewrote {changed}")
    print(f"done: {n} song file(s) checked")


if __name__ == "__main__":
    main()
