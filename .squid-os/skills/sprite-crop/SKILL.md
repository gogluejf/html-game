---
name: sprite-crop
description: Extracts animation frames from AI-generated sprite sheets with transparent backgrounds using foreground-ownership clustering instead of grid slicing. Alpha mask, connected components, row grouping, frame clustering with satellite assignment, bounding-box crops, and full stage-by-stage trace output. Use when the user asks to crop/extract frames from a transparent sprite sheet where grids are unreliable, frames overlap, or effects are detached.
allowed-tools: bash read_file write_file inspect_media open
---

## Overview
Crops animation frames from transparent-background sprite sheets by discovering which foreground pixels belong to each frame, then deriving rectangles — never the other way around. Pipeline: vision assessment of expected structure → alpha mask → connected components → row grouping → per-row frame clustering (constrained by expected counts) → component ownership including detached satellites → bounding-rect crops → deterministic validation (counts, edge-touching, orphans). Every stage emits a readable trace plus optional JSON for debugging and state recording. Vision is used only for the initial structural assessment and for flagged low-confidence cases; all pixel work is deterministic.

## Variables
- `<skill-folder>` — directory containing this SKILL.md\n- `<working-dir>` — the REPO ROOT (e.g. ~/src/html-game), NOT the game subfolder\n- `<state-file>` — sprite-gen state file <working-dir>/.squid-os/sprite-gen/state-<PROJECT>.json (source of truth for sheet paths, rows/cols, entity names)\n- `<assets-dir>` — project asset folder from state (assets_dir, e.g. panic-petal/assets)

## Instructions
**PRIMARY METHOD:** the deterministic CLI does all pixel math — you supply the structural assessment and do verification:
```bash
python3 <skill-folder>/scripts/extract_frames.py extract --sheet <sheet.png> --out <tmp-dir> --rows R1,R2,... --names n1,n2,... --actions a1,a2,... [--margin N] [--json result.json]
python3 <skill-folder>/scripts/extract_frames.py report --dir <tmp-dir>
```
Requires numpy + scipy + PIL (pillow).

### 1. Inspect the sheet first (vision)

Use @tool:inspect_media on the COMPLETE source sheet BEFORE running extraction. Establish the expected structure — this is an assessment, not pixel data:
- number of animation rows and what action each row represents
- expected frame count per row
- which frames are unusually wide/tall, have detached particles/debris, or look fragmented (deaths/explosions)

Record it as `rows=<n1>,<n2>,...` plus one entity name and one action word per row. Example: "Row 1: 5 run, Row 2: 4 attack (one very wide), Row 3: 5 death with debris" → `--rows 5,4,5 --names flower_dog --actions run,attack,death`. A single `--names` value applies to all rows (one entity, multiple animations); `--actions` needs one word per row.

The sheet must already have a transparent background (alpha). If it doesn't, stop and tell the user — this skill does NOT remove backgrounds.

### 2. Extract

Run extract with the assessed `--rows`, `--names`, `--actions` and ALWAYS pass `--json <out-dir>/result.json` (needed by record_crop.py):
1. alpha mask (foreground = alpha > threshold)
2. connected components (building blocks: bodies, limbs, petals, debris)
3. row grouping (y-density bands)
4. per-row frame clustering constrained by expected counts (gap-split; even division fallback when frames overlap)
5. ownership assignment (centroid in span; small detached satellites join nearest frame center within radius, low-confidence cases flagged)
6. bounding rect per owned cluster + safety margin → crop
7. validation (count vs assessment, edge-touching, tiny crops)

Read the full trace output. Exit code 0 = PASS, 2 = issues found (see VALIDATION section).

### 3. Verify & iterate

1. Read the trace: any WARN/FLAG lines? Low-confidence satellite flags and unassigned components need attention.
2. Use @tool:inspect_media on a SAMPLE of crops — minimum: first and last frame of each row plus every frame that was flagged. Query: "Is any part of this sprite cut off at the edges? Is any neighboring sprite visible bleeding in? Does this frame contain two poses?"
3. On failure, adjust PARAMETERS and re-run into a FRESH tmp dir (`<label>-v2`, `-v3`...):
   - wrong row count → fix the assessment (re-inspect sheet) or check transparency
   - satellite joined wrong frame → lower `--satellite-radius` or raise `--satellite-max-area` ceiling so it stays unassigned, then decide via vision
   - frame clipped (edge-touching) → raise `--margin`
   - two poses in one crop / missing frame → the clustering split was wrong; re-inspect and correct the expected count for that row
4. Repeat until every inspected frame is clean. Max 4 passes; if still failing, show the user the worst crops with the trace and offer regeneration via @skill:sprite-gen.

### 4. Install verified frames

Copy the FINAL verified pass to the project (FLAT structure, no per-entity subfolders):
```bash
mkdir -p <working-dir>/<assets-dir>/<label>
cp <tmp-dir>-v<N>/*.png <working-dir>/<assets-dir>/<label>/
```
Use @tool:open on the destination folder so the user can review.

### 5. Record crop params in state (via CLI — NEVER hand-edit JSON)

The extract step MUST be run with `--json <out-dir>/result.json`. After frames are verified and installed, record the exact per-frame coordinates:
```bash
python3 <working-dir>/.squid-os/skills/sprite-crop/scripts/record_crop.py \
  --state <state-file> --result <out-dir>/result.json \
  [--frames-dir "<assets-dir>/<label>"]
```
This is IDEMPOTENT: re-running for a re-cropped sheet REPLACES the `crop` block (no duplicates). It writes only:
```json
"crop": {
  "frames_dir": "...",
  "pass": "<tmp dir>",
  "frames_bbox": { "entity_action_f1.png": [x, y, w, h], ... }
}
```
All legacy grid fields (`row_y`, `col_x`, `frame_size`, `bg_color`, `bg_tol`) are dropped on record.

### 6. Emit the animation viewer (after frames are verified)

```bash
python3 <working-dir>/.squid-os/skills/sprite-crop/scripts/crop_sprites.py viewer --assets-dir <working-dir>/<assets-dir> --project <PROJECT> --out <working-dir>/.squid-os/sprite-gen/<PROJECT>.viewer.html
```
Always run after cropping a new label and open the viewer so the user can confirm the animation. Re-run if you re-crop.

## Rules
- **Frames are clusters, not cells.** Ownership first, rectangles second. Never treat a virtual grid or measured separator as a clipping boundary — limbs/attacks may cross into neighbor territory and must stay whole.
- **Assess before extracting.** Always inspect the full sheet with vision and record expected rows/actions/counts BEFORE running extract. The expected count constrains clustering; extraction without an assessment is blind.
- **Transparent input only.** Sheets must already have alpha transparency. No background removal, no degrid, no color keying in this skill. If the background isn't transparent, stop and tell the user.
- **USE THE SCRIPT for all pixel work.** No custom Python/PIL/numpy inline for masks, components, clustering, or crops. When output is wrong, adjust CLI parameters (rows, margin, satellite-radius, satellite-max-area, alpha-threshold) and re-run.
- **Read the trace every run.** The stage-by-stage output is the debug surface: WARN/FLAG lines, unassigned components, edge-touching frames, and count mismatches tell you which stage to fix.
- **Inspect after EVERY pass.** One inspection = at least 4 crops (first/last per row + any flagged). Do not declare success without inspecting the pass being shipped.
- **Iterate until perfect, max 4 passes.** Fresh tmp dir per pass (`<label>-v1`, `-v2`...). After 4 failed passes, escalate to the user with trace + worst crops.
- **Filenames are ALWAYS `<entity>_<action>_f<N>.png`.** Entity prefix on every file, one action word per row, _fN sequential within that row. Game code loads by this pattern.
- **Only verified frames reach the project.** Nothing is copied into <assets-dir> until its pass passed inspection AND validation reported PASS (or issues were explicitly accepted by the user).
- **State is written ONLY via CLI** (record-crop). NEVER hand-edit the state JSON.
- **Flat frame structure.** Frames go directly in assets/<label>/ — NO per-entity subfolders.
- **Single-image sheets** (backgrounds, single props, no animation): skip extract entirely — the image is already one transparent PNG; just copy it into <assets-dir>/ and register it in state like before.
- **Vision resolves ambiguity, code moves pixels.** Low-confidence ownership flags get a vision look; never silently guess satellite ownership, and never use vision to guess pixel coordinates.

## Output Format
```
```
## Sprite Extraction Report

- **Sheet:** <relative sheet path> ([W]x[H])
- **Assessment:** [R] rows — <action1>: n1, <action2>: n2, ... (expected total: N)
- **Foreground:** [px] pixels ([%] of sheet), [C] connected components ([S] satellite candidates)
- **Rows measured:** [R'] bands (y-ranges: [y0-y1, ...])
- **Clustering:** [gap-split / even-division per row], wide frames: [none / row X frame Y spans Wpx]
- **Ownership flags:** [none / list with confidence]
- **Validation:** [PASS — N/N frames / ISSUES — details]
- **Adjustment passes:** [N] (params changed: [none / margin / satellite-radius / rows / ...])
- **Verification:** [PASS — X crops inspected, 0 issues / FAIL — details]
- **Frames installed:** <assets-dir>/<label>/ ([total] PNGs)
- **State updated:** yes/no
- **Status:** DONE / NEEDS USER DECISION (reason)
```
```

## Examples
**Example 1: Standard sheet (fresh)**

User: "Extract frames from the flower dog sheet"

Skill actions:
1. @tool:inspect_media the sheet → assessment: 3 rows — run: 5, attack: 4 (frame 3 is a very wide attack with detached petals), death: 5 (debris in last frames)
2. extract --rows 5,4,5 --names flower_dog --actions run,attack,death --json result.json
3. Trace: row 1 gap-split finds only 3 clean separators for 4 expected → takes deepest 3; wide attack cluster spans ~2 normal cells; 6 petal satellites assigned to attack frame 3, 2 flagged low-confidence
4. Inspect flower_dog_attack_f3, flower_dog_death_f5, flower_dog_run_f1 + 2 flagged → petals intact, no bleed
5. Validation PASS 14/14 → install to assets/<label>/, record-crop, emit viewer

**Example 2: Clustering mismatch**

User: "Crop the balloon bat sheet"

Skill actions:
1. Assessment: 3 rows — idle: 4, attack: 4 (detached red projectiles), destruction: 5 (progressively fragmented)
2. extract → trace WARN: row 2 produced 4 bands but 5 expected (two early destruction poses sit close together)
3. Re-inspect sheet: row 3 actually has 5 poses, two nearly touch → lower nothing; instead the even-division fallback already split them; inspect all 5 death crops
4. One crop contains two poses → re-run with corrected assessment if needed, or accept and note
5. Install verified pass, update state, viewer

**Example 3: Non-transparent input**

User: "Extract this sheet" (sheet has flat pink background)

Skill actions:
1. inspect_media → background is opaque pink, no alpha
2. STOP: tell the user this skill requires transparent-background sheets (no bg removal by design); offer to regenerate via @skill:sprite-gen with a transparency prompt or handle it manually.

## Resources

### Scripts
- [extract_frames.py](scripts/extract_frames.py) — Executable script

### References
- [extraction-design.md](references/extraction-design.md) — Additional documentation
