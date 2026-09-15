# Petal Panic — Sprite Crop Orchestration

You are the orchestrator. You do NOT crop, validate, or compose yourself. You delegate to sub-agents and verify their work.

## Context

- **Working dir:** `/home/goglue/src/html-game`
- **Project:** `petal-panic`
- **Assets dir:** `petal-panic/assets/`
- **State file:** `.squid-os/sprite-gen/state-petal-panic.json`
- **Viewer output:** `.squid-os/sprite-gen/petal-panic.viewer.html`
- **Music (already done, DO NOT TOUCH):** `.squid-os/music-composer/petal-panic.jukebox.html`

## Sheets to Crop

### Already Cropped (done)

| Sheet | Entity | Label | State Name |
|-------|--------|-------|------------|
| `scarlet_vale_sheet_1-6.png` | scarlet_vale | heroes | scarlet_vale |
| `balthazar_sheet_1-6.png` | balthazar | heroes | balthazar |
| `jester_sheet_1-2.png` | jester | enemies | jester |
| `jackolantern_sheet.png` | jackolantern | enemies | jackolantern |
| `vine_hound_sheet.png` | vine_hound | enemies | vine_hound |
| `boris_loon_sheet.png` | boris_loon | enemies | boris_loon |
| `boris_loon_baby_sheet.png` | boris_loon_baby | enemies | boris_loon_baby |
| `violetta_marionetta_sheet.png` | violetta_marionetta | enemies | violetta_marionetta |
| `overgrown_elephant_sheet.png` | overgrown_elephant | boss | overgrown_elephant |
| `projectile_sheet_1.png` | projectile_1 | projectiles | projectile_1 |

### Upcoming Crops (new — Sep 13)

| Sheet | Entity | Label | State Name | Notes |
|-------|--------|-------|------------|-------|
| `ratchet_rumbelow_sheet_1-5.png` | ratchet_rumbelow | boss | ratchet_rumbelow | Boss — 5 sheets |
| `grim_vertigo_sheet.png` | grim_vertigo | boss | grim_vertigo | Mid-boss carousel — 4 rows × 4 cols (idle, angry, attack, death) |
| `dictator_carrot_sheet_1-4.png` | dictator_carrot | boss | dictator_carrot | Final boss — 4 sheets, 3×5 grid each |
| `ratzo_ringleader_sheet.png` | ratzo_ringleader | enemies | ratzo_ringleader | Clown rat — 4×5 grid |
| `toadstool_tilly_sheet.png` | toadstool_tilly | enemies | toadstool_tilly | Clown mushroom — 4×5 grid (idle, spore, ground eruption, death) |
| `gustav_grapplersnout_sheet.png` | gustav_grapplersnout | enemies | gustav_grapplersnout | Strongman caterpillar — 4×5 grid (crawl, dumbbell throw, ground punch, death) |
| `doodle_dink_sheet_1.png` | doodle_dink | enemies | doodle_dink_1 | Striped jester attacks — 3×5 grid (teleport, tomato throw, headbutt) |
| `doodle_dink_sheet_2.png` | doodle_dink | enemies | doodle_dink_2 | Death dissolve — 1×5 strip |
| `projectile_sheet_2.png` | projectile_2 | projectiles | projectile_2 | Spinning dumbbell — 1×5 strip |
| `projectile_sheet_3.png` | projectile_3 | projectiles | projectile_3 | Tomato/carrot/pea — 3×8 grid |
| `projectile_sheet_4.png` | projectile_4 | projectiles | projectile_4 | Fish-bone/ball/peas — 3×8 grid |

Single images (no crop, just state entry with rows=1 cols=1):
- `logo.png`, `cover.png`, `select_screen_1.png`, `select_screen_2.png`, `select_screen_3.png`

## Step 1: Crop All Sheets (one agent per sheet)

Launch agents **sequentially** (one at a time, wait for each to finish before next). Pass BOTH skills: `["sprite-gen", "sprite-crop"]`.

Agent prompt template:

```
Crop this pre-existing sprite sheet. The image is already provided — do NOT generate or download any image.

SHEET: /home/goglue/src/html-game/petal-panic/assets/<SHEET>.png
ENTITY: <ENTITY>
LABEL: <LABEL>
WORKING DIR: /home/goglue/src/html-game
STATE FILE: /home/goglue/src/html-game/.squid-os/sprite-gen/state-petal-panic.json
OUTPUT DIR: /home/goglue/src/html-game/petal-panic/assets/<LABEL>/

Style: hand-painted circus, pink background with light grid. Assets dir: petal-panic/assets.
Reverse-engineer the prompt from visual inspection and save to /tmp/<ENTITY>_prompt.txt.

CROP RULES (critical):
- Identify each sprite's actual bounding box within its cell. Do NOT use uniform grid math — AI-generated grids are never perfectly uniform. Scan for real sprite boundaries.
- Fill the identified background zone with the exact pink bg color BEFORE making transparent. This prevents halos and edge artifacts.
- After transparency: NO crazy top/bottom transparent margins. Trim to fit the sprite tightly. The frame should be snug around the character — no wasted empty space above head or below feet.
- No missing left/right portions. Verify the full character body is captured including limbs, tails, weapons, effects that extend beyond the "cell".
- No neighbor bleed. Each frame must contain ONLY its own sprite.
```

Agent limits: `max_steps: 300`, `max_time: "7m"`, `max_tools: 300`
Tools: `["bash", "read_file", "write_file", "inspect_media"]`

If an agent fails (context canceled, timeout), clean its partial output and retry once. If it fails twice, skip and note it.

For single images, use the same pattern but add: `rows=1 cols=1, no crop needed, just register in state.`

### Crop Order (upcoming)

1. `ratchet_rumbelow_sheet_1.png` → `boss/ratchet_rumbelow_`
2. `ratchet_rumbelow_sheet_2.png` → `boss/ratchet_rumbelow_`
3. `ratchet_rumbelow_sheet_3.png` → `boss/ratchet_rumbelow_`
4. `ratchet_rumbelow_sheet_4.png` → `boss/ratchet_rumbelow_`
5. `ratchet_rumbelow_sheet_5.png` → `boss/ratchet_rumbelow_`
6. `grim_vertigo_sheet.png` → `boss/grim_vertigo_`
7. `dictator_carrot_sheet_1.png` → `boss/dictator_carrot_`
8. `dictator_carrot_sheet_2.png` → `boss/dictator_carrot_`
9. `dictator_carrot_sheet_3.png` → `boss/dictator_carrot_`
10. `dictator_carrot_sheet_4.png` → `boss/dictator_carrot_`
11. `ratzo_ringleader_sheet.png` → `enemies/ratzo_ringleader_`
12. `toadstool_tilly_sheet.png` → `enemies/toadstool_tilly_`
13. `gustav_grapplersnout_sheet.png` → `enemies/gustav_grapplersnout_`
14. `doodle_dink_sheet_1.png` → `enemies/doodle_dink_`
15. `doodle_dink_sheet_2.png` → `enemies/doodle_dink_`
16. `projectile_sheet_2.png` → `projectiles/projectile_2_`
17. `projectile_sheet_3.png` → `projectiles/projectile_3_`
18. `projectile_sheet_4.png` → `projectiles/projectile_4_`

## Step 2: Per-Sheet Validation (after EACH crop agent finishes)

After EACH individual crop agent completes, launch a quick validation agent for THAT sheet only:

```
Validate the cropped frames for <ENTITY> in /home/goglue/src/html-game/petal-panic/assets/<LABEL>/<ENTITY>_. Inspect every frame with inspect_media. Check:
1. Background fully transparent (no pink/tan residue anywhere)
2. No see-through faces/bodies (no holes where bg showed through during generation)
3. No neighbor bleed (no parts of adjacent sprites visible)
4. No cut-off limbs, tails, weapons, or effects at edges
5. No excessive transparent margin top/bottom (frame should be tight around sprite)
6. Full character present left-to-right (no missing side portions)

Report PASS or FAIL per frame. If ANY frame fails, list which frames and what's wrong.
```

Tools: `["bash", "inspect_media"]`
Limits: `max_steps: 50`, `max_time: "7m"`, `max_tools: 50`

If any frame FAILs → relaunch a crop agent for that specific sheet with a note about exactly what failed (which frames, what issue). Max 1 retry per sheet.

## Step 3: Verify State Consistency

Check the state file yourself after all crops:
- All sheets present in state JSON
- Each has `entities[]`, `crop` block (except singles), consistent field names
- No garbage top-level fields
- Frame files on disk match state (`frames_dir` paths exist, file count = rows × cols)

## Step 4: Generate Viewer

```bash
python3 .squid-os/skills/sprite-crop/scripts/crop_sprites.py viewer \
  --assets-dir petal-panic/assets \
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
- Keep agent prompts minimal. The skills carry the workflow. The CROP RULES block is the critical addition.
- Launch crop agents SEQUENTIALLY (LLM connection drops with parallel calls).
- Validate AFTER EACH SHEET, not just at the end. Catch issues early.
- If an agent stalls on skill_load or gets "context canceled", kill it and retry.
- Agent timeout is 7 minutes. If it's not done by then, it's stuck.
- Final deliverable: clean assets, perfect state JSON, working viewer, working jukebox.
