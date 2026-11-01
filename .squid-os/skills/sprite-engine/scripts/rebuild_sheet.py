#!/usr/bin/env python3
"""Rebuild one per-anim sheet from selected existing frame PNGs.

Preserves all existing anim tuning (fps, playback, direction, collision, pivot,
markers) and compatible per-frame tuning. Crop data is regenerated from the
selected frames using glue.py. The operation verifies pixel round-trip before
removing obsolete source frames.
"""
import argparse
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glue import glue_frames, write_twin_json, verify_roundtrip


def parse_selection(spec):
    """Parse '1,2,3' or '1-4,6' into 1-based indices."""
    if not spec:
        return None
    out = []
    for part in spec.split(','):
        part = part.strip()
        if '-' in part:
            a, b = map(int, part.split('-'))
            out.extend(range(a, b + 1))
        else:
            out.append(int(part))
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', required=True)
    p.add_argument('--sheet', required=True)
    p.add_argument('--frames', help='Comma-separated 1-based frame selection, e.g. "1-5,7"')
    p.add_argument('--rename', action='append', default=[],
                   help='old:new frame filename mapping, e.g. fly_f7.png:fly_f6.png')
    p.add_argument('--remove', action='append', default=[],
                   help='obsolete frame filenames to remove after successful rebuild')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    root = Path(args.root).resolve()
    sheet_path = (root / args.sheet).resolve()
    sheet = json.loads(sheet_path.read_text())
    ent = sheet['entities'][0]
    frames = ent['frames']
    names = [f['file'] for f in frames]
    base_dir = sheet_path.parent
    frames_dir = ent.get('frames_dir')
    if not frames_dir:
        frames_dir = str(base_dir)
    elif not os.path.isabs(frames_dir):
        # Sheet JSON stores repo-root-relative paths; rebuild resolves them against root.
        candidate = root / frames_dir
        frames_dir = str(candidate if candidate.exists() else base_dir)

    selection = parse_selection(args.frames)
    if selection is None:
        selected_names = names
    else:
        for i in selection:
            if not 1 <= i <= len(names):
                raise SystemExit(f'frame index {i} out of range 1-{len(names)}')
        selected_names = [names[i - 1] for i in selection]

    rename = dict(pair.split(':', 1) for pair in args.rename)
    output_names = [rename.get(n, n) for n in selected_names]
    if len(set(output_names)) != len(output_names):
        raise SystemExit('duplicate output frame names')

    # Preserve existing tuning.
    anim_tuning = {k: ent[k] for k in ('fps', 'playback', 'direction', 'collision', 'pivot', 'markers') if k in ent}
    old_frame_tuning = {f['file']: {k: f[k] for k in ('offset', 'scale', 'boxes', 'durUnits') if k in f} for f in frames}

    tmp = base_dir / '_rebuild_tmp'
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir()
    for src_name in selected_names:
        src = Path(frames_dir) / src_name
        if not src.exists():
            raise SystemExit(f'missing source frame: {src}')
        shutil.copy2(src, tmp / rename.get(src_name, src_name))

    new_frames, rows, cols, W, H = glue_frames(
        [str(tmp / n) for n in output_names],
        str(base_dir / (sheet_path.name[:-5] + '.png')),
    )
    doc = write_twin_json(
        str(sheet_path), ent.get('frames_dir') or (str(base_dir).replace(str(root) + os.sep, '').replace(os.sep, '/')),
        ent['name'], ent['anim'], output_names, new_frames, rows, cols, W, H,
        kind=sheet.get('kind', 'animation'), description=f"{ent['name']} {ent['anim']} ({len(output_names)} frames)",
    )

    # Restore compatible per-frame tuning by source name.
    for out_name, nf in zip(output_names, doc['entities'][0]['frames']):
        src_name = next((k for k, v in rename.items() if v == out_name), out_name)
        nf.update({k: v for k, v in old_frame_tuning.get(src_name, {}).items() if v is not None})
    doc['entities'][0].update(anim_tuning)
    sheet_path.write_text(json.dumps(doc, indent=1) + '\n')

    # Copy final frames only after JSON is written; verify before removing obsolete sources.
    for out_name in output_names:
        shutil.copy2(tmp / out_name, base_dir / out_name)
    bad = verify_roundtrip(str(sheet_path))
    if bad:
        raise SystemExit(f'rebuild failed pixel round-trip on {bad} frame(s); restore required')

    if not args.dry_run:
        for old in args.remove:
            path = Path(frames_dir) / old
            if path.exists():
                path.unlink()
        shutil.rmtree(tmp)
        print(f'Rebuilt {sheet_path.name}: {len(output_names)} frames, round-trip PASS')
    else:
        shutil.rmtree(tmp)
        print(f'DRY RUN: would rebuild {sheet_path.name} with {len(output_names)} frames')


if __name__ == '__main__':
    main()
