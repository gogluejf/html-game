# Petal Panic — Sprite Crop Orchestration

You are the orchestrator. You do NOT crop, validate, or compose yourself. You delegate to sub-agents and verify their work.

## Context

- **Working dir:** `/home/goglue/src/html-game`
- **Project:** `panic-petal`
- **Assets dir:** `panic-petal/assets/`
- **State file:** `.squid-os/sprite-gen/state-petal-panic.json`
- **Viewer output:** `.squid-os/sprite-gen/petal-panic.viewer.html`
- **Music (already done, DO NOT TOUCH):** `.squid-os/music-composer/petal-panic.jukebox.html`

## Sheets to Crop

| Sheet | Entity | Label | State Name |
|-------|--------|-------|------------|
| `scarlet_vale_sheet.png` | scarlet_vale | heroes | scarlet_vale |
| `balthazar_sheet.png` | balthazar | heroes | balthazar |
| `jester_sheet_1.png` | jester | enemies | jester_1 |
| `jester_sheet_2.png` | jester | enemies | jester_2 |
| `jackolantern_sheet.png` | jackolantern | enemies | jackolantern |
| `vine_hound_sheet.png` | vine_hound | enemies | vine_hound |
| `boris_loon_sheet.png` | boris_loon | enemies | boris_loon |
| `boris_loon_baby_sheet.png` | boris_loon_baby | enemies | boris_loon_baby |
| `violetta_marionetta_sheet.png` | violetta_marionetta | enemies | violetta_marionetta |
| `overgrown_elephant_sheet.png` | overgrown_elephant | boss | overgrown_elephant |

Single images (no crop, just state entry with rows=1 cols=1):
- `logo.png`, `cover.png`, `select_screen_1.png`, `select_screen_2.png`, `select_screen_3.png`

## Step 1: Crop All Sheets (one agent per sheet)

Launch agents **sequentially** (one at a time, wait for each to finish before next). Pass BOTH skills: `["sprite-gen", "sprite-crop"]`.

Agent prompt template (keep it minimal):

```
Crop this pre-existing sprite sheet. The image is already provided — do NOT generate or download any image.

SHEET: /home/goglue/src/html-game/panic-petal/assets/<SHEET>.png
ENTITY: <ENTITY>
LABEL: <LABEL>
WORKING DIR: /home/goglue/src/html-game
STATE FILE: /home/goglue/src/html-game/.squid-os/sprite-gen/state-petal-panic.json
OUTPUT DIR: /home/goglue/src/html-game/panic-petal/assets/<LABEL>/

Style: hand-painted circus, pink background with light grid. Assets dir: panic-petal/assets.
Reverse-engineer the prompt from visual inspection and save to /tmp/<ENTITY>_prompt.txt.
```

Agent limits: `max_steps: 300`, `max_time: "20m"`, `max_tools: 300`
Tools: `["bash", "read_file", "write_file", "inspect_media"]`

If an agent fails (context canceled, timeout), clean its partial output and retry once. If it fails twice, skip and note it.

For single images, use the same pattern but add: `rows=1 cols=1, no crop needed, just register in state.`

## Step 2: Validation Agent

After all crops are done, launch ONE validation agent:

```
Validate all cropped sprite frames for Petal Panic. Inspect 2-3 frames from each entity directory under /home/goglue/src/html-game/panic-petal/assets/. Check: background fully transparent (no pink/tan residue), no see-through faces/bodies, no neighbor bleed, no cut-off limbs. Report PASS/FAIL per entity.
```

Tools: `["bash", "inspect_media"]`
Limits: `max_steps: 100`, `max_time: "15m"`, `max_tools: 100`

If any FAIL → relaunch a crop agent for that specific sheet with a note about what failed.

## Step 3: Verify State Consistency

Check the state file yourself:
- All 7 sheets + 5 single images present
- Each has `entities[]`, `crop` block (except singles), consistent field names
- No garbage top-level fields
- Frame files on disk match state (`frames_dir` paths exist, file count = rows × cols)

## Step 4: Generate Viewer

```bash
python3 .squid-os/skills/sprite-crop/scripts/crop_sprites.py viewer \
  --assets-dir panic-petal/assets \
  --project petal-panic \
  --out .squid-os/sprite-gen/petal-panic.viewer.html
```

Open it: `open .squid-os/sprite-gen/petal-panic.viewer.html`

## Step 5: Open Music Jukebox (verify it still works)

```bash
open .squid-os/music-composer/petal-panic.jukebox.html
```

DO NOT regenerate or modify music. Just open to confirm it plays.

## Rules

- You are ORCHESTRATOR ONLY. Do not crop, validate pixel-by-pixel, or compose music yourself.
- Keep agent prompts minimal. The skills carry the workflow.
- Launch crop agents SEQUENTIALLY (LLM connection drops with parallel calls).
- If an agent stalls on skill_load or gets "context canceled", kill it and retry.
- Verify with inspect_media on 1-2 frames per entity after crop (quick sanity check).
- Final deliverable: clean assets, perfect state JSON, working viewer, working jukebox.
