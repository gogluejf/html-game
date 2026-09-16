#!/usr/bin/env python3
"""Render sprite editor HTML files from state-<project>.json.

Usage: render_editor.py [project ...]   (default: all state-*.json in the sprite-gen dir)
Builds the same MANIFEST shape the viewer uses ({labels:[{name, entities:[{name, frames}]}]})
and renders editor-<project>.html from editor-template.html.
"""
import json, sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent            # .squid-os/skills/sprite-crop
TEMPLATE = SKILL / "templates" / "editor-template.html"
OUT_DIR = SKILL.parent.parent / "sprite-gen"              # .squid-os/sprite-gen (outputs + state)


def build_manifest(state):
    labels = []
    for folder, fd in state.get("folders", {}).items():
        ents = []
        seen = set()
        for sh in fd.get("sheets", []):
            # per-frame crop bbox from the sheet's crop data: {frame: [x,y,w,h]}
            bbox = (sh.get("crop") or {}).get("frames_bbox", {})
            for e in sh.get("entities", []):
                name = f"{e.get('name','x')}_{e.get('anim','a')}"
                if name in seen or not e.get("frames"):
                    continue
                seen.add(name)
                # viewer-relative paths: editor sits 2 levels above the assets root
                frames = [f"../../{fd['path']}/{f}" for f in e["frames"]]
                # per-frame crop coords [x,y,w,h] from the source sheet (or null)
                crops = [bbox.get(f) for f in e["frames"]]
                ents.append({"name": name, "char": e.get("name",""), "anim": e.get("anim",""), "frames": frames, "crops": crops})
        if ents:
            labels.append({"name": folder, "entities": ents})
    return {"labels": labels}


def main():
    projects = sys.argv[1:]
    if not projects:
        projects = sorted(p.stem[len("state-"):] for p in OUT_DIR.glob("state-*.json"))
    tpl = TEMPLATE.read_text()
    for proj in projects:
        st = json.loads((OUT_DIR / f"state-{proj}.json").read_text())
        man = build_manifest(st)
        out = tpl.replace("/*__MANIFEST__*/null", json.dumps(man))
        out = out.replace("__PROJECT__", proj)
        dest = OUT_DIR / f"editor-{proj}.html"
        dest.write_text(out)
        n = sum(len(l["entities"]) for l in man["labels"])
        print(f"wrote {dest.name} ({n} entities)")


if __name__ == "__main__":
    main()
