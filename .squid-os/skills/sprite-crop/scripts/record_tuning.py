#!/usr/bin/env python3
"""Read/write gameplay tuning data in sprite sheet JSON files.

Tuning fields (per animation): speed, playback, collision, pivot, markers.
Frame-level tuning fields: offset, scale, boxes, durUnits.

Crop data (file, row, col, bbox, name, anim) is never modified by write/clear.
"""

import argparse
import json
import os
import sys

ANIM_FIELDS = ("speed", "playback", "collision", "pivot", "markers")
FRAME_FIELDS = ("offset", "scale", "boxes", "durUnits")
CROP_FIELDS = {"file", "row", "col", "bbox", "name", "anim"}

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           '..', 'references', 'sheet-schema.json')


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def load_sheet(path):
    if not os.path.exists(path):
        die(f"sheet not found: {path}")
    with open(path) as f:
        return json.load(f)


def find_entity(sheet, name, anim):
    for ent in sheet.get("entities", []):
        if ent.get("name") == name and ent.get("anim") == anim:
            return ent
    return None


def atomic_write(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    os.replace(tmp, path)


def validate(sheet):
    from jsonschema import validate, ValidationError
    with open(SCHEMA_PATH) as f:
        schema = json.load(f)
    try:
        validate(instance=sheet, schema=schema)
    except ValidationError as e:
        die(f"schema validation failed: {e.message} at {'/'.join(map(str, e.absolute_path))}")


def cmd_read(args):
    sheet = load_sheet(args.sheet)
    ent = find_entity(sheet, args.name, args.anim)
    if ent is None:
        die(f"entity not found: {args.name}/{args.anim}")

    out = {}
    for k in ANIM_FIELDS:
        if k in ent:
            out[k] = ent[k]
    frames_out = []
    for fr in ent.get("frames", []):
        fo = {}
        for k in FRAME_FIELDS:
            if k in fr:
                fo[k] = fr[k]
        if fo:
            frames_out.append(fo)
    if frames_out:
        out["frames"] = frames_out
    print(json.dumps(out, indent=2))


def cmd_write(args):
    sheet = load_sheet(args.sheet)
    ent = find_entity(sheet, args.name, args.anim)
    if ent is None:
        die(f"entity not found: {args.name}/{args.anim}")

    try:
        data = json.loads(args.data)
    except json.JSONDecodeError as e:
        die(f"--data is not valid JSON: {e}")
    if not isinstance(data, dict):
        die("--data must be a JSON object")

    for k in ANIM_FIELDS:
        if k in data:
            ent[k] = data[k]

    data_frames = data.get("frames")
    if isinstance(data_frames, list):
        ent_frames = ent.setdefault("frames", [])
        for i, df in enumerate(data_frames):
            if i >= len(ent_frames) or not isinstance(df, dict):
                continue
            for k in FRAME_FIELDS:
                if k in df:
                    ent_frames[i][k] = df[k]

    validate(sheet)
    atomic_write(args.sheet, sheet)
    print(f"Wrote tuning for {args.name}/{args.anim} → {args.sheet}")


def has_frame_tuning(ent):
    return any(k in fr for fr in ent.get("frames", []) if isinstance(fr, dict)
               for k in FRAME_FIELDS)


def cmd_list(args):
    sheet = load_sheet(args.sheet)
    for ent in sheet.get("entities", []):
        if any(k in ent for k in ANIM_FIELDS) or has_frame_tuning(ent):
            print(f"{ent.get('name')}/{ent.get('anim')}")


def cmd_clear(args):
    sheet = load_sheet(args.sheet)
    ent = find_entity(sheet, args.name, args.anim)
    if ent is None:
        die(f"entity not found: {args.name}/{args.anim}")

    for k in ANIM_FIELDS:
        ent.pop(k, None)
    for fr in ent.get("frames", []):
        if isinstance(fr, dict):
            for k in FRAME_FIELDS:
                fr.pop(k, None)

    validate(sheet)
    atomic_write(args.sheet, sheet)
    print(f"Cleared tuning for {args.name}/{args.anim} → {args.sheet}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    pr = sub.add_parser("read", help="print tuning data for an entity/animation")
    pr.add_argument("--sheet", required=True)
    pr.add_argument("--name", required=True)
    pr.add_argument("--anim", required=True)
    pr.set_defaults(func=cmd_read)

    pw = sub.add_parser("write", help="merge tuning data into an entity/animation")
    pw.add_argument("--sheet", required=True)
    pw.add_argument("--name", required=True)
    pw.add_argument("--anim", required=True)
    pw.add_argument("--data", required=True, help="JSON string of tuning fields")
    pw.set_defaults(func=cmd_write)

    pl = sub.add_parser("list", help="list entities that have tuning data")
    pl.add_argument("--sheet", required=True)
    pl.set_defaults(func=cmd_list)

    pc = sub.add_parser("clear", help="remove all tuning data from an entity/animation")
    pc.add_argument("--sheet", required=True)
    pc.add_argument("--name", required=True)
    pc.add_argument("--anim", required=True)
    pc.set_defaults(func=cmd_clear)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
