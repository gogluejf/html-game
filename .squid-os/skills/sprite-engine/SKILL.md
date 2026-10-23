---
name: sprite-engine
description: "Sheet tooling for the cat/entity/anim sprite asset convention: audits the assets tree (missing frames, bbox drift, pixel round-trip, gaps), reassembles mixed sheets into per-anim sheets by gluing existing frames (never re-cropping), carves anim ranges out of a sheet, and serves a browsable sheet gallery with game/category/kind filters. Use when auditing sprite assets, splitting mixed sheets, carving sneaked-in anims, or browsing/verifying generated sheets."
allowed-tools: bash read_file write_file edit_file inspect_media open
---

## Overview
Sheet tooling for the cat/entity/anim asset convention: audit (ground-truth checker over every *_sheet.json — structure, bboxes, pixel round-trip, frame gaps), reassemble (split mixed sheets into per-anim sheets by gluing existing frame PNGs — never re-cropping), carve_anim (cut frame ranges out of a per-anim sheet into new anims with full renumber + round-trip verify), glue (shared frames-to-sheet primitive), and a browsable gallery server (thumbnails + game/category/kind filters). All scripts are deterministic CLIs that take explicit paths — no hardcoded locations.

## Variables
- `<skill-folder>` — directory containing this skill's SKILL.md (scripts live in <skill-folder>/scripts/)
- `<working-dir>` — the REPO ROOT (e.g. ~/src/html-game). NOT a game subfolder. All asset paths and --root args are relative to this.

## Instructions
## Workflow

All tools are deterministic CLIs under <skill-folder>/scripts/. They take explicit paths — always pass --root <working-dir> where required. Never hand-edit sheet JSONs; all state writes go through these scripts or @skill:sprite-gen / @skill:sprite-crop CLIs.

### 1. Audit (read-only, run first)

```bash
python3 <skill-folder>/scripts/audit.py --root <working-dir> [substring-filter]
```

Walks the whole tree with os.walk (no glob patterns). Checks per *_sheet.json: kind present, exactly one entity (per-anim convention), size decl == PNG size, bboxes in bounds, frames exist on disk, grid decl == actual max row/col, plus a PIXEL ROUND-TRIP (each frame cropped out of its sheet at its bbox must be byte-identical). Also gap-checks: every {anim}_fN.png group has its {anim}_sheet.json. Exit 0 = clean, 1 = problems.

### 2. Reassemble (migration tool — mixed sheets -> per-anim sheets)

```bash
python3 <skill-folder>/scripts/reassemble.py --root <working-dir> [--project X,Y] [--sheet path/to/sheet.json] [--dry-run]
```

For each (entity, anim) in multi-entity sheet JSONs: glues the existing frame PNGs into a fresh {anim}_sheet.png reproducing the old grid footprint, writes the twin {anim}_sheet.json with exact bboxes. Additive — never deletes or overwrites. The original split migration is done; only needed if a new hand-made mixed sheet appears.

### 3. Carve anims out of a per-anim sheet

When the AI sneaks a second action into the last frames of a sheet:

```bash
python3 <skill-folder>/scripts/carve_anim.py --root <working-dir> --sheet <path/to/anim_sheet.json> --carve explode:7-8 [--carve special:3-5] [--dry-run]
```

Ranges are 1-based inclusive over current frame order, non-overlapping, targets must not exist. Renames carved frames, renumbers survivors from f1, re-glues ALL affected sheets from scratch, refuses if repo code references files that would break, then pixel-verifies every output sheet round-trip.

### 4. Gallery server

```bash
bash <skill-folder>/scripts/server/server.sh go [port] [root]
# -> prints http://localhost:8799
```

Open http://localhost:8799 — thumbnail grid of every per-anim sheet with game/category/kind filter dropdowns; click a card for full-size view with its path. Scans the live assets tree on every request (no cache). root defaults to the repo root inferred from the script location. Stop: server.sh stop. If the page 404s, a stale process is serving from the wrong dir: server.sh stop, kill any orphan on the port (ss -tlnp | grep 8799), restart with server.sh go. Verify before opening: curl -s -o /dev/null -w "%{http_code}" http://localhost:8799/ must return 200.

## Rules
- **Convention is strict:** {project}/assets/{cat}/{entity}/{anim}_sheet.{png,json} + {anim}_f{N}.png flat in the entity dir. One action per sheet. Twin JSON always next to its PNG with exact base-name parity.
- **Sheet JSON schema:** file, size, rows, cols, kind, description, entities[] where each entity has name, anim, frames_dir, frames[{file,row,col,bbox}]. kind = animation | tile_variant | entity_variant (required).
- **Glue, never re-crop:** when splitting or rebuilding sheets, work from existing verified frame PNGs — never re-run extraction over original AI sheets.
- **State written only via CLI:** audit/reassemble/carve_anim (this skill) and sprite-gen --add-sheet / record_crop.py (@skill:sprite-gen, @skill:sprite-crop). NEVER hand-edit sheet or meta JSON.
- **Audit before mutating:** run audit.py first; hard errors abort reassemble. Carve always round-trip verifies at the end — a failed verification means stop and inspect.
- **Scripts take explicit paths:** always pass --root <working-dir>; never rely on cwd or __file__ inference.
- **Verify the gallery URL before opening it** (curl must return 200); 404 = stale/mis-rooted server process.

## Output Format
```
## Sprite-Engine Report

- **Action:** [audit / reassemble / carve / gallery]
- **Scope:** [whole tree / project filter / specific sheet path]
- **Sheets scanned:** [N]
- **Findings:** [clean / list of X lines: missing frames, bbox drift, pixel mismatches, gaps]
- **Pixel round-trip:** [PASS N/N / FAIL details]
- **Written:** [files created/changed, or none (read-only)]
- **Gallery:** [url + sheet count, if started]
- **Status:** DONE / NEEDS USER DECISION (reason)
```

## Examples
**Example 1: Audit the tree**

User: "check our sprite assets are clean"

1. python3 <skill-folder>/scripts/audit.py --root <working-dir>
2. Report: sheets scanned, structural errors, pixel mismatches, gaps — exit code drives DONE vs NEEDS FIX.

**Example 2: Carve a sneaked-in anim**

User: "the last 2 frames of jester shoot are actually the explosion, split them out"

1. Read the sheet JSON (jester/shoot) to confirm frame count and order
2. python3 <skill-folder>/scripts/carve_anim.py --root <working-dir> --sheet petal-panic/assets/enemies/jester/shoot_sheet.json --carve explode:9-10 --dry-run -> review plan
3. Re-run without --dry-run; verify round-trip PASS on both sheets
4. audit.py --root <working-dir> jester -> clean

**Example 3: Browse sheets**

User: "show me the sheets"

1. bash <skill-folder>/scripts/server/server.sh go
2. curl -s -o /dev/null -w "%{http_code}" http://localhost:8799/ -> must be 200
3. Open http://localhost:8799 for the user (filters: game/category/kind)

## Resources

### References
- [PLAN.md](references/PLAN.md) — Additional documentation
