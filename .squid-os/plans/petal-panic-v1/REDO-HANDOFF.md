# Petal-Panic Sprite Redo — Handoff for Next Agent

## READ FIRST (in this order)
1. THIS FILE (.squid-os/plans/petal-panic-v1/REDO-HANDOFF.md) — remaining work + protocol
2. skill_load sprite-crop — the skill's pipeline rules & validation protocol
3. .squid-os/sprite-gen/state-petal-panic.json — source of truth: entity names, anim words, frame lists, existing crop blocks (check before AND after each sheet)
4. .squid-os/plans/petal-panic-v1/transparent-regen-plan.md — prior context on the transparent-bg pass (only if alpha questions come up)
Do NOT need: petal-panic-v1.md / .plan.json (game design, not sprites), any /tmp dirs (old passes; result.json paths are reported by agents at runtime).

## DEFINITIONS (avoid confusion)
- **Orchestrator** = the main session agent (talks to the user, runs record_crop.py, verifies disk, launches sub-agents).
- **Sub-agent** = inline worker that only crops: runs extract_frames.py, inspects, copies frames, reports back. Never touches state or git.
- **"regen" = RE-CROP.** No sprite-gen image generation anywhere in this plan. Source sheets are final.
- **record** = running record_crop.py against a result.json (orchestrator only, after disk verification).

## Context
Full re-crop of all petal-panic sprite sheets using the NEW sprite-crop skill
(foreground-ownership clustering, per-frame bboxes). Most sheets are DONE.
This doc is the remaining work list + exact protocol.

**Repo:** /home/goglue/src/html-game
**State file:** .squid-os/sprite-gen/state-petal-panic.json
**Assets root:** panic-petal/assets/

**Vocabulary: "regen" = RE-CROP.** We do NOT regenerate source art via sprite-gen
in this plan (source sheets are final; user fixed defects by hand when needed).

## HARD RULES (never break these)
1. **NO GIT. NO COMMITS. EVER.** Everything stays uncommitted. The orchestrator does not commit even at the end — the user handles commits separately. Do not stage, do not run git add/commit/status-for-committing.
2. **Agents never edit state JSON.** Only `record_crop.py` writes state (see Protocol). Sub-agents: produce frames + result.json, report back, stop.
3. **No custom Python for pixel work.** Only: `extract_frames.py` CLI + `inspect_media` + cp/mv/rm.
4. **Max 3 passes per sheet.** After 3, accept best result and report the problem — do NOT loop on one frame. Never re-inspect the same crop more than once.
5. **Validate CONTENT, not just counts.** Counts matching is necessary but not sufficient: verify each row shows the RIGHT object and no frame is empty (fg% > 0). Duplicate rows (two entities byte-identical) = FAIL.
6. **Filenames are sacred:** `<entity>_<action>_f<N>.png` (or `<entity>_f<N>.png` where noted). If the CLI names differently, mv before copying.
7. **Fresh tmp dir per pass:** `/tmp/<label>-v1`, `-v2`, ...
8. **After any re-crop that yields FEWER frames than before: rm the stale extra `_fN.png` files** from the install dir (happened with tusko stomp f5, balthazar run2 f8).

## The Pipeline (per sheet)
```bash
# 1. extract (ALWAYS with --json)
python3 .squid-os/skills/sprite-crop/scripts/extract_frames.py extract \
  --sheet <sheet.png> --out /tmp/<label>-v1 \
  --rows <n1,n2,...> --names <entity> --actions <a1,a2,...> \
  --margin 8 --json /tmp/<label>-v1/result.json
#   optional flags: --alpha-threshold N, --row-y y0-y1,y0-y1,... (manual row bands)

# 2. check SUMMARY line: "count OK" = good. COUNT MISMATCH = diagnose (max 2 inspections), fix --rows, re-run -v2.

# 3. content check: inspect_media first+last frame per row (min 4 crops). Empty frame (fg%=0) or wrong object = re-run.

# 4. install: cp <pass-dir>/*.png <assets-dir>/<folder>/  (overwrite)

# 5. record state (ONLY the orchestrator does this, after verifying disk):
python3 .squid-os/skills/sprite-crop/scripts/record_crop.py \
  --state .squid-os/sprite-gen/state-petal-panic.json \
  --result /tmp/<label>-vN/result.json --frames-dir <assets-dir>/<folder>
```
`record_crop.py` is idempotent: replaces the `crop` block + syncs `entities[].frames`.
Crop block shape: `{frames_dir, pass, margin?, frames_bbox: {file: [x,y,w,h]}}`.

## Sub-agent prompt template (USE THIS EXACT FORMAT — it is the proven one)
The working prompts always gave CONCRETE per-sheet params (entity, rows, actions, install dir, target filenames). Never send a worker a vague "figure it out" list. Fill every blank:

```
You are a sprite-crop worker. Work in /home/goglue/src/html-game. Use the sprite-crop skill (skill_load sprite-crop).

HARD RULES:
- Do NOT edit any JSON state file. Do NOT run git.
- No custom Python for pixel work. Only: extract_frames.py CLI + inspect_media + cp/mv.
- Max 3 passes per sheet. Accept best result after 3 and REPORT the problem.
- Validate CONTENT not just counts: every frame non-empty (fg%>0), each row shows the right object, no two entities byte-identical.
- Filenames are sacred: if the CLI names outputs differently, mv them to the EXACT target names before copying.

PROCESS THESE SHEETS:
1. <sheet path> — entity: <name> — rows <R> — actions: <a1,a2,...> — install to <folder>/
   Target files: <exact filename pattern, e.g. jester_chase_f1..5.png>
2. <next sheet...>
(For special sheets add the extra line: --row-y <bands> / split-row mapping / per-row entity list)

For EACH sheet:
1. Count frames per row yourself (trust measurement; if the sheet has fewer poses than stated, the sheet wins — report it).
2. Run: python3 .squid-os/skills/sprite-crop/scripts/extract_frames.py extract --sheet <sheet> --out /tmp/redo-<label>-v1 --rows <counts> --names <entity> --actions <actions> --margin 8 --json /tmp/redo-<label>-v1/result.json
3. Check SUMMARY: "count OK" → content check (inspect first+last frame per row) → copy ALL PNGs (renamed to targets) to the install folder (overwrite) → next sheet.
4. COUNT MISMATCH → max 2 inspections to diagnose, re-run into -v2 with corrected --rows (keep --json), copy, move on.

Report back EXACTLY this format (one block per sheet):
SHEET: <filename>
PASS_DIR: <final tmp dir>
RESULT_JSON: <absolute path to the final result.json>
ROWS_USED: <e.g. 5,5,5>
ACTIONS: <words actually used>
FRAMES: <count>
CONTENT_CHECK: <what you verified per row>
ISSUES: <none or one-line>
```

Worked example of a filled entry (from this session):
```
1. panic-petal/assets/jester_sheet_2.png — entity: jester — rows 3 — actions: idle,attack,death — install to panic-petal/assets/enemies/
   Target files: jester_idle_f1..5.png, jester_attack_f1..5.png, jester_death_f1..5.png
```

## ORCHESTRATOR WORKFLOW (the loop, per batch)
1. Launch ONE sub-agent with the prompt template + the sheet list for the batch (5-8 sheets).
2. When it returns: verify disk (frame counts, no empty files via fg% check, hashes differ between entities that must differ).
3. Run record_crop.py per sheet with the agent's reported RESULT_JSON path (check BOTH /tmp and /home/goglue/tmp — agents use both).
4. Fix any state naming drift the rename tricks caused (e.g. sweep2→sweep, anim words).
5. rm stale _fN leftovers if a re-crop produced fewer frames.
6. Next batch. After ALL batches: run section F audit. STOP. No git.

## READY-TO-SEND PROMPTS (copy-paste, no construction needed)

### Prompt 1 — section A batch (6 sheets)
```
You are a sprite-crop worker. Work in /home/goglue/src/html-game. Use the sprite-crop skill (skill_load sprite-crop).

HARD RULES:
- Do NOT edit any JSON state file. Do NOT run git.
- No custom Python for pixel work. Only: extract_frames.py CLI + inspect_media + cp/mv.
- Max 3 passes per sheet. Accept best result after 3 and REPORT the problem.
- Validate CONTENT not just counts: every frame non-empty (fg%>0), each row shows the right object, no two entities byte-identical.
- Filenames are sacred: if the CLI names outputs differently, mv them to the EXACT target names before copying.

PROCESS THESE SHEETS:
1. panic-petal/assets/balthazar_sheet_6.png — entity: balthazar — ONE 10-frame animation laid over 2 grid rows (assess actual pose count) — action: sweep — install to panic-petal/assets/heroes/
   Target files: balthazar_sweep_f1..f10.png (sequential across both grid rows; use --rows 5,5 with actions sweep,sweep then rename r2 outputs to f6-f10)
2. panic-petal/assets/scarlet_vale_sheet_6.png — entity: scarlet_vale — ONE 10-frame animation over 2 grid rows (assess) — action: cartwheel — install to panic-petal/assets/heroes/
   Target files: scarlet_vale_cartwheel_f1..f10.png (same 2-row trick as above)
3. panic-petal/assets/vine_hound_sheet.png — entity: vine_hound — rows 3 — actions: run,attack,death — install to panic-petal/assets/enemies/
   Target files: vine_hound_run_f1..5.png, vine_hound_attack_f1..4.png (attack row has only 4 poses, f3 is a WIDE ~623px frame), vine_hound_death_f1..5.png
4. panic-petal/assets/doodle_dink_sheet_2.png — entity: doodle_dink — rows 1 — actions: death — install to panic-petal/assets/enemies/
   Target files: doodle_dink_death_f1..f5.png
5. panic-petal/assets/tusko_wobble_sheet.png — entity: tusko_wobble — rows 4 — actions: charge,stomp,trunk_blast,death — install to panic-petal/assets/boss/
   EXPECTED counts: charge=5, stomp=4, trunk_blast=4, death=5 (this is the cleaned sheet — trust measurement, report if different)
   Target files: tusko_wobble_charge_f1..5.png, tusko_wobble_stomp_f1..4.png, tusko_wobble_trunk_blast_f1..4.png, tusko_wobble_death_f1..5.png
   IMPORTANT: after copying, rm any stale tusko_wobble_stomp_f5.png / tusko_wobble_trunk_blast_f5.png from boss/ if present.
6. panic-petal/assets/projectile_sheet_2.png — entity: projectile_2 — rows 1 — actions: spin — install to panic-petal/assets/projectiles/
   Target files: projectile_2_spin_f1..f5.png

For EACH sheet:
1. Count frames per row yourself (trust measurement; if the sheet has fewer poses than stated, the sheet wins — report it).
2. Run: python3 .squid-os/skills/sprite-crop/scripts/extract_frames.py extract --sheet <sheet> --out /tmp/redo-<label>-v1 --rows <counts> --names <entity> --actions <actions> --margin 8 --json /tmp/redo-<label>-v1/result.json
3. Check SUMMARY: "count OK" → content check (inspect first+last frame per row) → copy ALL PNGs (renamed to targets) to the install folder (overwrite) → next sheet.
4. COUNT MISMATCH → max 2 inspections to diagnose, re-run into -v2 with corrected --rows (keep --json), copy, move on.

Report back EXACTLY this format (one block per sheet):
SHEET: <filename>
PASS_DIR: <final tmp dir>
RESULT_JSON: <absolute path to the final result.json>
ROWS_USED: <e.g. 5,5,5>
ACTIONS: <words actually used>
FRAMES: <count>
CONTENT_CHECK: <what you verified per row>
ISSUES: <none or one-line>
```

### Prompt 2 — powerups batch (2 sheets, --row-y)
```
You are a sprite-crop worker. Work in /home/goglue/src/html-game. Use the sprite-crop skill (skill_load sprite-crop).

HARD RULES:
- Do NOT edit any JSON state file. Do NOT run git.
- No custom Python for pixel work. Only: extract_frames.py CLI + inspect_media + cp/mv.
- Max 3 passes per sheet. Accept best result after 3 and REPORT the problem.
- Validate CONTENT not just counts: EVERY frame must be non-empty (fg%>0) and show the right capsule. A previous attempt shipped 5 EMPTY frames — that is a FAIL.
- Filenames are sacred: mv CLI outputs to the EXACT target names before copying.

CONTEXT: these sheets have glow/vines bleeding between rows, so auto row-detection fails. USE THE PROVIDED --row-y BANDS. Do not brute-force alpha thresholds.

PROCESS THESE SHEETS (install both to panic-petal/assets/powerups/):
1. panic-petal/assets/powerups_sheet_1.png
   Command flags: --rows 4,4,4,4,4 --names tmp --actions r1,r2,r3,r4,r5 --margin 8 --row-y 0-177,177-324,324-464,464-611,611-793 --json ...
   Row entities top→bottom: scarlet_1up, balthazar_1up, rapid_fire, invincibility, panic_clear
   Target files: scarlet_1up_f1..f4.png, balthazar_1up_f1..f4.png, rapid_fire_f1..f4.png, invincibility_f1..f4.png, panic_clear_f1..f4.png (NO action word in filenames)
2. panic-petal/assets/powerups_sheet_2.png
   Command flags: --rows 4,4,4,4,4 --names tmp --actions r1,r2,r3,r4,r5 --margin 8 --row-y 0-157,157-308,308-459,459-607,607-793 --json ...
   Row entities top→bottom: energy, bomb, petal_saw, thorn_missile, shield
   Target files: energy_f1..f4.png, bomb_f1..f4.png, petal_saw_f1..f4.png, thorn_missile_f1..f4.png, shield_f1..f4.png (NO action word)

For EACH sheet:
1. Run the extract command with the exact flags above into /tmp/redo-pp<n>-v1.
2. MANDATORY: verify ALL 20 frames non-empty and correct (inspect at least f1+f4 of every row = 10 inspections). If any frame empty/wrong: adjust band boundary by a few px or lower --alpha-threshold, re-run -v2. Max 3 passes.
3. Rename outputs (r1→entity1, r2→entity2, ...) to target names, copy to powerups/ OVERWRITING existing.

Report back EXACTLY per sheet:
SHEET: <filename>
PASS_DIR: <final tmp dir>
RESULT_JSON: <absolute path>
ROWS_USED: 4,4,4,4,4
ROW_Y_USED: <bands>
FRAMES: <count>
CONTENT_CHECK: <per row: what capsule + confirmed non-empty>
ISSUES: <none or one-line>
```

## REMAINING WORK

### A. Re-crop 8 multi-frame sheets (frames exist on disk, bbox missing from state)
One agent batch (or two of 4):
| Sheet | Entity | Rows | Actions | Install |
|---|---|---|---|---|
| balthazar_sheet_6.png | balthazar | 2 grid rows = ONE 10-frame anim (assess) | sweep | heroes/ |
| scarlet_vale_sheet_6.png | scarlet_vale | 2 grid rows = ONE 10-frame anim (assess) | cartwheel | heroes/ |
| vine_hound_sheet.png | vine_hound | 5,4,5 (attack row has WIDE f3 ~623px) | run,attack,death | enemies/ |
| doodle_dink_sheet_2.png | doodle_dink | 1 row, 5 frames | death | enemies/ |
| tusko_wobble_sheet.png | tusko_wobble | 5,4,4,5 (stomp=4, trunk_blast=4 — cleaned sheet) | charge,stomp,trunk_blast,death | boss/ |
| projectile_sheet_2.png | projectile_2 | 1 row, 5 frames | spin | projectiles/ |
| powerups_sheet_1.png | per-row (see B) | 4,4,4,4,4 + --row-y | idle×5 | powerups/ |
| powerups_sheet_2.png | per-row (see B) | 4,4,4,4,4 + --row-y | idle×5 | powerups/ |
(Powerups params are in section B — same batch or separate agent, orchestrator's choice.)

NOTE: balthazar_sheet_6 & scarlet_vale_sheet_6 are 2-grid-row sheets holding ONE 10-frame animation
(same pattern as ratchet_rumbelow: use --rows 5,5 with action repeated twice, then rename outputs
to sequential f1..f10). After recording, if the 2-action trick left `sweep2`/`cartwheel2` in state,
normalize anim to the single word. (Ratchet's recorded state entries show the end shape to aim for.)

### B. Powerups ×2 — RE-CROP with MANUAL ROW BANDS (--row-y) [included in section A batch]
Source art has glow/vines bleeding between rows → auto row-detection fails. Measured bands:
| Sheet | --row-y | Entities per row (top→bottom) | Target filenames |
|---|---|---|---|
| powerups_sheet_1.png | 0-177,177-324,324-464,464-611,611-793 | scarlet_1up,balthazar_1up,rapid_fire,invincibility,panic_clear | `<entity>_f1..f4.png` |
| powerups_sheet_2.png | 0-157,157-308,308-459,459-607,607-793 | energy,bomb,petal_saw,thorn_missile,shield | `<entity>_f1..f4.png` |

Target filenames have NO action word (game code uses `<entity>_fN.png`).
CLI will name them `tmp_r1_f1..` etc → mv to target names → cp to powerups/ (OVERWRITE old grid crops).
Content check MANDATORY: a previous attempt produced 5 EMPTY frames (bomb/energy/petal_saw/shield/thorn_missile
came from threshold roulette) — verify fg%>0 for ALL 20 frames per sheet. If a frame is empty, the band or
threshold is wrong — adjust, do NOT ship empty frames.

### C. Re-crop ALL existing 1-frame images (user requirement: their _f1 must come from a fresh crop pass)
These are single-image sources; "crop" = extract the single frame cleanly (trim to content bbox) so the
installed `_f1.png` is a fresh artifact of this redo, not a stale old file. For each: run extract with
--rows 1 --names <entity> --actions idle (or use the tool's single-frame path), verify non-empty + correct
content, overwrite the `_f1.png` in the folder, record via record_crop.py.
| Source | Entity | Install folder |
|---|---|---|
| select_balthazar.png | select_balthazar | interface/ |
| select_none.png | select_none | interface/ |
| select_scarlet_vale.png | select_scarlet_vale | interface/ |
| logo.png | logo | interface/ |
| home_bigtop.png | home_bigtop | home/ |
| home_crowd.png | home_crowd | home/ |
| home_stage.png | home_stage | home/ |
| home_scarlet_portrait.png | home_scarlet_portrait | home/ |
| home_cover_idle.png | home_cover | home/ |
| home_squid_os_logo.png | squid_os_logo | home/ |
| barrel_sheet.png | barrel | objects/ |
| barrel_bomb_sheet.png | barrel_bomb | objects/ |
| barrel_coin_sheet.png | barrel_coin | objects/ |
| checkpoint_sheet.png | checkpoint | objects/ |
| checkpoint_boss_sheet.png | checkpoint_boss | objects/ |
NOTE: some sources are OPAQUE (RGB, no alpha: select_*, logo, home_bigtop, home_scarlet_portrait, home_cover_idle).
The crop skill requires alpha. For opaque singles: skip extract, just verify the existing _f1 matches the
source (copy source → _f1 if different) and record a trivial crop block (full-image bbox). Report which were opaque.

### D. Register 12 orphan files into state + create missing frames
Use sprite-gen CLI for registration (NEVER hand-edit JSON):
```bash
python3 .squid-os/skills/sprite-gen/scripts/sprite_gen.py state \
  --state .squid-os/sprite-gen/state-petal-panic.json \
  --add-sheet folder=<folder> name=<label> file=<rel/path> size="<W>x<H>" \
  rows=<R> cols=<C> cell=<N> description="..." \
  entities='[{"row":1,"name":"<entity>","anim":"idle","frames":["<entity>_f1.png"]}]'
```
| File | Suggested folder | Type | Action |
|---|---|---|---|
| bg_level1–4.png (4) | interface | RGB, no alpha, 2172x724 | register as singles; ensure `bg_level<N>_f1.png` exists in interface/ (level1 exists; COPY source→_f1 for 2–4) |
| fg_level1–4.png (4) | interface | RGBA strips, single row band | register as singles; `fg_level1_f1.png` exists; create fg_level2–4_f1.png (fresh crop of the strip) |
| platforms_level1–4_sheet.png (4) | objects (or new "platforms") | RGBA, 3 row-bands each (tile grids) | ASSESS cols per row, CROP tiles with extract_frames.py, install as `platforms_level<N>_f<M>.png`, register with per-row entities |

### E. SKIP for now (user said fuck it): violetta_marionetta attack row
Current state: 4 attack frames (f2 missing, old f5 double-pose) — already recorded as-is. DO NOT touch.

### F. Final audit (orchestrator, at the very end — still NO COMMIT)
```bash
python3 - <<'EOF'
import json, os
s=json.load(open('.squid-os/sprite-gen/state-petal-panic.json'))
missing=[fr for f in s['folders'].values() for sh in f['sheets'] for e in sh.get('entities',[]) for fr in e.get('frames',[]) if not os.path.exists(os.path.join(f['path'],fr))]
print('MISSING FRAMES:', missing)
badsrc=[sh['file'] for f in s['folders'].values() for sh in f['sheets'] if not os.path.exists(sh['file'])]
print('BAD SOURCE PATHS:', badsrc)
nobbox=[sh['file'].split('/')[-1] for f in s['folders'].values() for sh in f['sheets']
        if not(sh.get('rows',0)<=1 and sh.get('cols',0)<=1)
        and len(sh.get('crop',{}).get('frames_bbox',{})) != sum(len(e.get('frames',[])) for e in sh.get('entities',[]))]
print('BBOX MISMATCH:', nobbox)
EOF
```
Report results to the user. STOP. Do not commit.

## Known gotchas (learned the hard way)
- **Glow-heavy sheets** (powerups): auto row detection fails → use --row-y with measured bands (section B values).
- **2-grid-row single animations** (ratchet, sheet_6 heroes): --rows N,N with action duplicated, then rename to sequential f1..fN.
- **Per-row different entities** (powerups, coins, projectiles): CLI takes one --names for all rows → placeholder name, mv outputs to real names.
- **Split rows** (projectile_sheet_1 row2 = bomb×4 + boom×4): extract as 8, rename halves.
- **Stale leftovers:** after re-crops with FEWER frames, always rm the extra old _fN files.
- **Agent rabbit holes:** a previous agent burned 20+ calls re-inspecting one corner pixel. "max 3 passes, never re-inspect same frame twice" exists because of that.
- **Empty crops:** high --alpha-threshold erases soft-glow sprites → if frames come out empty (fg%=0), LOWER threshold or use --row-y. Never brute-force threshold sequences.
- State `entities[].anim` words must match game code: run2/jump2 (not run/jump) for sheet_4/5 heroes; coin FRAME FILES are `coin_<color>_fN.png` (no action word in filename).
- Agents write tmp dirs under BOTH /tmp and /home/goglue/tmp — check both when collecting result.json paths.

## Status snapshot (as of handoff)
- 42/50 multi-frame sheets: cropped + bbox recorded ✅
- Section A+B: 8 sheets need re-crop + record (6 plain + 2 powerups with --row-y)
- Section C: 15 single-image _f1 re-crops/verifications
- Section D: 12 orphans to register (+ fg/bg level2–4 frames, platforms crop)
- Section E: violetta — skipped by user decision
- ALL work stays UNCOMMITTED. User commits separately. Orchestrator never runs git.
