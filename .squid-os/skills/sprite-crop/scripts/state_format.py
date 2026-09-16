#!/usr/bin/env python3
"""Compact-serialize sprite-gen state: frame objects + bbox arrays on one line.

Normal 2-space indent everywhere EXCEPT:
  - each entities[].frames[] item -> {"file":..., "row":..., "col":..., "bbox":[...]}
  - each bbox array               -> [x, y, w, h]
Purely cosmetic (identical data). Run after migration / record_crop.

Usage: sanitize_state.py <state.json> [<state.json> ...]
"""
import json, sys


def is_frame(o):
    return isinstance(o, dict) and "file" in o and ("bbox" in o or "row" in o)


def compact(obj, ind=0):
    sp = "  " * ind
    sp1 = "  " * (ind + 1)
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        if is_frame(obj):
            inner = ", ".join(f"{json.dumps(k)}: {compact(v, 0)}" for k, v in obj.items())
            return "{" + inner + "}"
        items = [f"{sp1}{json.dumps(k)}: {compact(v, ind + 1)}" for k, v in obj.items()]
        return "{\n" + ",\n".join(items) + f"\n{sp}}}"
    if isinstance(obj, list):
        if not obj:
            return "[]"
        if all(isinstance(x, int) for x in obj) and len(obj) in (2, 4):
            return "[" + ", ".join(str(x) for x in obj) + "]"
        if all(is_frame(x) for x in obj):
            items = ",\n".join(f"{sp1}{compact(x, 0)}" for x in obj)
            return "[\n" + items + f"\n{sp}]"
        return "[" + ", ".join(compact(x, ind) for x in obj) + "]"
    return json.dumps(obj)


def sanitize(path):
    d = json.load(open(path))
    out = compact(d, 0)
    json.loads(out)  # validate round-trip
    open(path, "w").write(out + "\n")
    print(f"sanitized {path}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        sanitize(p)
