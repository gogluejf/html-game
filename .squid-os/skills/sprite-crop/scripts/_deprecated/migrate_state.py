#!/usr/bin/env python3
"""Migrate legacy state-<project>.json (nested folders) -> one json per sheet.

New layout:
  .squid-os/sprite-sheets/<project>/<label>/<sheetname>.json   (per sheet)
  .squid-os/sprite-sheets/<project>.meta.json                  (chat_url, palette, assets_dir)

Per-sheet file fields:
  label         <- folder key (also encoded in the path; kept explicit for tooling)
  file          <- sheet.file            (unchanged)
  cropped_path  <- folder.path           (was redundant folder-level path)
  rows/cols/cell/size/description/original_prompt/entities/crop  <- copied verbatim

Run with --dry to print the plan without writing. Idempotent-safe: refuses to
overwrite an existing target unless --force.
"""
import argparse, json, os, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent  # repo root (html-game)
SRC_DIR = ROOT / ".squid-os" / "sprite-gen"
DST_ROOT = ROOT / ".squid-os" / "sprite-sheets"


def sheet_name(sheet):
    """Derive a stable filename from the sheet png path."""
    base = os.path.basename(sheet.get("file", ""))
    stem = os.path.splitext(base)[0]
    return stem + ".json"


def migrate(project, dry, force):
    src = SRC_DIR / f"state-{project}.json"
    if not src.exists():
        print(f"SKIP {project}: no {src.name}")
        return 0
    d = json.load(open(src))
    folders = d.get("folders", {})

    proj_dst = DST_ROOT / project
    written = 0
    skipped = 0
    for label, fd in folders.items():
        cpath = fd.get("path", "")
        label_dst = proj_dst / label
        for sh in fd.get("sheets", []):
            name = sheet_name(sh)
            out = label_dst / name
            rec = {
                "label": label,
                "file": sh.get("file"),
                "cropped_path": cpath,
            }
            # copy through any remaining sheet-level fields verbatim
            for k in ("size", "rows", "cols", "cell", "description",
                      "original_prompt", "entities", "crop"):
                if k in sh:
                    rec[k] = sh[k]
            if out.exists() and not force:
                print(f"  SKIP (exists) {out.relative_to(ROOT)}")
                skipped += 1
                continue
            if dry:
                print(f"  WOULD WRITE {out.relative_to(ROOT)}  ({len(json.dumps(rec))} bytes)")
            else:
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(rec, indent=2) + "\n")
            written += 1

    # meta file: pull root-level non-folder fields; normalize "null" -> None
    meta = {}
    for k in ("chat_url", "palette", "assets_dir"):
        if k in d:
            v = d[k]
            if isinstance(v, str) and v.strip().lower() == "null":
                v = None
            meta[k] = v
    meta["project"] = project
    meta["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    meta_out = DST_ROOT / f"{project}.meta.json"
    if dry:
        print(f"  WOULD WRITE {meta_out.relative_to(ROOT)}  {json.dumps(meta)}")
    else:
        DST_ROOT.mkdir(parents=True, exist_ok=True)
        meta_out.write_text(json.dumps(meta, indent=2) + "\n")

    n_sheets = sum(len(fd.get("sheets", [])) for fd in folders.values())
    print(f"{project}: {n_sheets} sheets across {len(folders)} labels "
          f"-> wrote {written}, skipped {skipped}")
    return written


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry", action="store_true", help="print plan, write nothing")
    ap.add_argument("--force", action="store_true", help="overwrite existing targets")
    ap.add_argument("projects", nargs="*", help="project names (default: all state-*.json)")
    args = ap.parse_args()

    projects = args.projects
    if not projects:
        projects = sorted(p.stem[len("state-"):] for p in SRC_DIR.glob("state-*.json"))

    for proj in projects:
        migrate(proj, args.dry, args.force)
    if args.dry:
        print("\nDRY RUN — nothing written.")


if __name__ == "__main__":
    main()
