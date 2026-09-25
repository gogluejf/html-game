#!/usr/bin/env python3
"""Render sprite editor HTML files from the one-json-per-sheet tree.

Reads .squid-os/sprite-sheets/<project>/<label>/<sheet>.json (one file per sheet)
and builds the same MANIFEST shape the viewer uses:
  { labels:[{name:<label>, entities:[{name, char, anim, frames, crops}]}] }
Label grouping comes from the subfolder name (the path), NOT a field in the json.
Renders editor-<project>.html from templates/editor-template.html into
.squid-os/sprite-gen/ (unchanged output location).

Usage: render_editor.py [project ...]   (default: every <project>/ dir under sprite-sheets)
"""
import json, sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent            # .squid-os/skills/sprite-crop
TEMPLATE = SKILL / "templates" / "editor-template.html"
SHEETS_ROOT = SKILL.parent.parent / "sprite-sheets"       # .squid-os/sprite-sheets
OUT_DIR = SKILL.parent.parent / "sprite-gen"              # .squid-os/sprite-gen (outputs)


def build_manifest(proj_dir):
    """Scan <proj>/<label>/*.json and group entities by label (subfolder)."""
    labels = []
    for label_dir in sorted(p for p in proj_dir.iterdir() if p.is_dir()):
        ents = []
        seen = set()
        for shf in sorted(label_dir.glob("*.json")):
            sh = json.loads(shf.read_text())
            cpath = sh.get("cropped_path", "")
            for e in sh.get("entities", []):
                name = f"{e.get('name','x')}_{e.get('anim','a')}"
                if name in seen or not e.get("frames"):
                    continue
                seen.add(name)
                files = [f["file"] if isinstance(f, dict) else f for f in e["frames"]]
                bboxes = [f.get("bbox") if isinstance(f, dict) else None for f in e["frames"]]
                # viewer-relative paths: editor sits 2 levels above the assets root
                frames = [f"../../{cpath}/{f}" for f in files]
                ents.append({"name": name, "char": e.get("name",""), "anim": e.get("anim",""),
                             "frames": frames, "crops": bboxes})
        if ents:
            labels.append({"name": label_dir.name, "entities": ents})
    return {"labels": labels}


def main():
    projects = sys.argv[1:]
    if not projects:
        projects = sorted(p.name for p in SHEETS_ROOT.iterdir() if p.is_dir())
    tpl = TEMPLATE.read_text()
    for proj in projects:
        proj_dir = SHEETS_ROOT / proj
        if not proj_dir.is_dir():
            print(f"SKIP {proj}: no {proj_dir}", file=sys.stderr)
            continue
        man = build_manifest(proj_dir)
        out = tpl.replace("/*__MANIFEST__*/null", json.dumps(man))
        out = out.replace("__PROJECT__", proj)
        dest = OUT_DIR / f"editor-{proj}.html"
        dest.write_text(out)
        n = sum(len(l["entities"]) for l in man["labels"])
        print(f"wrote {dest.name} ({n} entities across {len(man['labels'])} labels)")


if __name__ == "__main__":
    main()
