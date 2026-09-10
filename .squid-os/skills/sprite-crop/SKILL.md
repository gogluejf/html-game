---
name: sprite-crop
description: Crops animation frames from AI-generated sprite sheets with pixel-perfect precision. Scans real sprite boundaries (AI grids are never uniform), makes backgrounds transparent, and iterates crop-inspect-adjust until every frame is clean. Use when the user asks to crop/slice a sprite sheet into individual frames or animation sequences.
allowed-tools: bash read_file write_file inspect_media open
---

## Overview
Turns AI-generated sprite sheets into clean, transparent, individually-cropped animation frames. AI sheets are NEVER pixel-perfect grids — row heights vary and column centers drift per row — so this skill measures the real sprite bounds on the background color, crops each cell from those measured bands, makes the background fully transparent (flood-fill from borders only, so dark pixels inside sprites survive), then verifies crops visually and re-crops with adjusted offsets until every sampled frame is perfect. Working crops go to tmp; verified frames are saved next to the sheet in per-label folders, and final crop parameters are stored in the sprite-gen state file for one-command re-cropping later.

## Variables
- `<skill-folder>` — directory containing this SKILL.md
- `<working-dir>` — active working directory and project root for the current session
- `<state-file>` — the sprite-gen state file `<working-dir>/.squid-os/sprite-gen/state-<PROJECT>.json` (source of truth for sheet paths, rows/cols, entity names)
- `<assets-dir>` — project asset folder from state (`assets_dir`, e.g. `galaga/assets`)

## Instructions

**PRIMARY METHOD:** the deterministic CLI does all pixel math — you supply decisions and verification:
```bash
python3 <skill-folder>/scripts/crop_sprites.py <subcommand> [args]
```
Subcommands: `prep` (bg detect + transparency), `scan` (measure real grid), `crop` (cut frames), `trim` (remove transparent margins), `report` (list sizes), `viewer` (emit an animation visualizer HTML). Requires PIL: `pip install pillow`.

### 1. Load Context

1. Read `<state-file>`. Find the sheet to crop (by label, e.g. `enemies`). Get: `file` (sheet path), `rows`, `cols`, `entities[].name` (one name per row, top→bottom).
2. If no state file exists, ask the user for the sheet path, number of rows, number of frames per row, and one name per row.
3. Determine output dir: `<working-dir>/<assets-dir>/<label>/` (create if missing). Single-image sheets (backgrounds) go directly in `<assets-dir>/` as one transparent PNG.

### 2. Prep — Background Detection + Transparency

Run ONCE per sheet before cropping:
```bash
python3 <skill-folder>/scripts/crop_sprites.py prep --sheet <sheet.png> --out /tmp/sprite-crop/<project>/<label>_prepared.png --save-bg /tmp/sprite-crop/<project>/<label>_bg.json
```
- Detects the actual background color from edge pixels (never assume pure black).
- Flood-fills from image borders only → true alpha transparency WITHOUT eating dark pixels inside sprites.
- **Reads the INK AUDIT line in the output.** It counts real sprite pixels the fill removed. `> 2%` = the fill leaked into sprite bodies (holes/eaten shading) → re-run with lower `--tol` (step down by ~10) until the audit is near 0%. Default tol is 40; sheets with very dark sprite shading on black often need 15-25.
- All subsequent steps use the PREPARED sheet, not the original.
- Store the detected `bg_color` AND the working `bg_tol` in the sheet's state entry later (step 7).

### 3. Scan — Measure the Real Grid

```bash
python3 <skill-folder>/scripts/crop_sprites.py scan --sheet <prepared.png> --save /tmp/sprite-crop/<project>/<label>_bands.json
```
Prints JSON: `rows` (measured y-bands per entity row) and `col_gaps_per_row` (measured x-separators per row). These replace any assumed uniform `cell` size — trust the measurement, never the prompt's claimed dimensions.

Sanity check: the scan must return exactly `rows` bands. If it returns more/fewer, some sprites touch each other or the sheet has extra content — tell the user and inspect the sheet with @tool:inspect_media before continuing. **Common cause:** a near-invisible separator (glow/tentacles leaving only 1-3px of black) is invisible to the scan. Fix by eyeballing the sheet (open it), estimating the missing boundary y, and cropping with explicit `--row-y "y0-y1,y0-y1,..."` instead of `--bands`. This is normal, not an error.

### 4. Crop

```bash
python3 <skill-folder>/scripts/crop_sprites.py crop \
  --sheet <prepared.png> --out /tmp/sprite-crop/<project>/<label> \
  --names <entity1>,<entity2>,... --cols <C> --bands <bands.json>
```
- `--names`: one kebab/snake name per row (from state `entities[].name`).
- `--cols`: frames per row (from state `cols`).
- Frame files: `<entity>_<action>_f<N>.png` (e.g. `pumpkin_run_f1.png`, `pumpkin_attack_f3.png`). One action label per row, frames numbered sequentially within that row. Sized to the measured row height × 256px (override with `--frame-size WxH` if needed).
- **CRITICAL NAMING RULE:** Every filename MUST be `<entity>_<action>_f<N>.png`. The entity name is consistent across all rows for that sprite. The action is a single short word per row (run, jump, attack, death, idle, etc.). N is 1-based sequential within that row. No freeform names, no missing entity prefix, no missing _fN suffix.

Then run `report --dir <out>` and confirm the count equals `rows × cols`.

### 5. Normalize Frames (uniform size per entity)

Measured row bands are often TALLER than the sprite inside them (glow, tendrils, or uneven AI layout stretch the band). After cropping, normalize every frame:

```bash
python3 <skill-folder>/scripts/crop_sprites.py trim --dir /tmp/sprite-crop/<project>/<label>-v<N> --pad 4
```

Per entity (filename prefix before `_fN`): computes the largest alpha bbox across ALL its frames, then places every frame's content at the SAME top-left origin on a common `max_w x max_h + pad` canvas. Result: all frames of one entity are **identical in size AND aligned** — required for stable animation playback (mixed frame sizes or drifting origins = jitter). Different entities may have different sizes; that's fine. Run it on EVERY pass before verification, and confirm with `report` that sizes within each entity are identical.

### 6. Verify & Iterate (CRITICAL — repeat until perfect)

Use @tool:inspect_media on a SAMPLE of cropped frames — minimum: first row f1, last row f<cols>, and 2 middle cells (corners catch the most bleed):

```text
Query: "Is any part of this sprite cut off at the edges? Is any part of a NEIGHBORING sprite visible (any shape bleeding in from left/right/top/bottom)? Which edges have problems, if any?"
```

**Decision loop — do NOT stop after one pass:**
1. Any frame shows neighbor bleed or cut-off parts → adjust and re-crop:
   - Horizontal bleed (left/right): pass explicit centers `--col-x "x1,x2,x3|y1,y2,y3|..."` (one comma-list per row, `|` separated) shifted away from the intruding side.
   - Vertical bleed (top/bottom): pass explicit bands `--row-y "y0-y1,y0-y1,..."` tightened inward.
   - Wrong frame size: `--frame-size WxH`.
2. Re-crop into a FRESH tmp dir (`<label>-v2`, `-v3`, ...) — never mix passes.
3. Re-inspect the SAME failing frames plus 2 new samples.
4. Repeat until every inspected frame reports zero problems. Max 4 adjustment passes; if still failing, show the user the worst frames and offer: tighter manual coords, or regenerate the sheet via @skill:sprite-gen.

Also verify transparency programmatically after the final pass:
```bash
python3 -c "from PIL import Image; im=Image.open('<frame>'); px=im.load(); print('corner alphas:', [px[x,y][3] for x,y in [(0,0),(im.width-1,0),(0,im.height-1),(im.width-1,im.height-1)]])"
```
All four corners must be 0. If not, increase `--tol` in step 2 (small steps) and redo from step 3 — but watch the INK AUDIT: raising tol can start eating sprite bodies. The correct tol is the highest one where corners are transparent AND the audit stays near 0%.

### 7. Install Verified Frames

Copy the FINAL verified pass to the project:
```bash
mkdir -p <working-dir>/<assets-dir>/<label>
cp /tmp/sprite-crop/<project>/<label>-v<N>/*.png <working-dir>/<assets-dir>/<label>/
```
Use @tool:open on the destination folder so the user can review.

### 8. Record Crop Params in State

Update the sheet entry in `<state-file>` so future re-crops are one command. Add/replace these fields on the sheet object (edit the JSON directly — sprite-gen's CLI manages its own fields, crop params are additive):
```json
"crop": {
  "bg_color": [0, 0, 0],
  "bg_tol": 15,
  "bands_file_params": {"rows": [[0, 240], [272, 468]], "col_centers_per_row": [[128, 384, 640, 896]]},
  "final_overrides": {"col_x": null, "row_y": null, "frame_size": null},
  "frames_dir": "<assets-dir>/<label>"
}
```
If the sheet already has a `crop` entry, reuse its params as the starting point (skip step 3 if `bands_file_params` matches the sheet's `size`).

### 9. Emit the Animation Viewer (after frames are verified)

Once frames for a label are cropped/verified, generate the visualizer so the user can watch each entity animate:
```bash
python3 <skill-folder>/scripts/crop_sprites.py viewer --assets-dir <assets-dir> --project <PROJECT> --out <working-dir>/.squid-os/sprite-gen/<PROJECT>.viewer.html [--bg <label>_bg.json]
```
- Scans `<assets-dir>/<label>/<entity>_fN.png` and builds a self-contained `viewer.html` (next to the state file, like plan-generator).
- `--bg` points at a saved bg-color JSON from `prep` so the default preview background matches the sheet; omit it for black.
- The viewer: click an entity to play its animation, `←`/`→` or `−`/`+` change speed (live FPS readout), space = play/pause, and a color picker previews transparency over any tint.
- **Always run this after cropping a new label** and open the viewer so the user can confirm the animation looks right. Re-run it if you re-crop (it rebuilds the manifest from disk).

## Rules
- **Never trust uniform grid math.** AI sheets have variable row heights and drifting column centers. Always `scan` first; use measured bands, not `rows*cell`.
- **Prep before crop.** Always run `prep` on the raw sheet first; crop from the prepared (transparent) version. Never deliver black-background frames when transparency was requested.
- **Flood-fill only, never global color delete.** The script only removes border-connected background — do not "help" by deleting all pixels near the bg color; that punches holes in dark-bodied sprites.
- **Tight tolerance, always audit.** Flood-fill `--tol` defaults to 40 but MUST be validated with the prep INK AUDIT line: >2% real-ink loss means the fill leaked into sprite bodies (visible as holes/eaten dark shading). Step tol down until the audit is ~0%, then verify corners are still transparent. Record the working tol in state (`crop.bg_tol`).
- **Inspect after EVERY crop pass.** One inspection pass = look at ≥4 frames (corners + middles). Do not declare success without inspecting the pass you're shipping.
- **Iterate until perfect, max 4 passes.** Each pass uses fresh overrides derived from what the inspection reported (which edge bled which direction). After 4 failed passes, stop and escalate to the user with evidence.
- **Normalize before verify.** Always run `trim` on a crop pass before inspecting — oversized empty margins and non-uniform frame sizes within an entity are failure modes, not cosmetic.
- **Uniform frames per entity.** All frames of one entity MUST end up identical in size with aligned content origin (the trim step guarantees this). Never install mixed-size frames for one entity.
- **Filenames are ALWAYS `<entity>_<action>_f<N>.png`.** Entity prefix on every file, one action word per row, _fN sequential within that row. No freeform names, no missing parts. Game code loads by pattern `<entity>_<action>_f1..fN`.
- **Fresh tmp dir per pass.** `<label>-v1`, `-v2`, ... so a bad pass can never contaminate the good one.
- **Only verified frames reach the project.** Nothing is copied into `<assets-dir>` until its pass passed inspection AND corner-alpha check.
- **State is the memory.** Final crop params always get written back to the state file. A re-crop request should complete in: load state → crop with stored params → quick inspect → done.
- **No game data.** Crop params and asset paths only — never points/wave/hp/effect in state.
- **Backgrounds/single-image sheets** (no grid): skip scan/crop; just run `prep` and save the transparent PNG to `<assets-dir>/`.

## Output Format
```
## Sprite Crop Report

- **Sheet:** <relative sheet path> ([W]x[H])
- **Background:** rgb(r,g,b) → transparent (flood-fill)
- **Grid measured:** [R] rows × [C] frames (row heights: [h1,h2,...])
- **Adjustment passes:** [N] (overrides used: [none / col-x / row-y / frame-size])
- **Verification:** [PASS — X frames inspected, 0 issues / FAIL — details]
- **Frames installed:** <assets-dir>/<label>/ ([total] PNGs)
- **State updated:** yes/no
- **Status:** DONE / NEEDS USER DECISION (reason)
```

## Examples
**Example 1: Crop the enemies sheet (fresh)**

User: "Crop the enemies sheet into frames"

Skill actions:
1. Load state-galaga.json → sheet `enemies`: file `assets/galaga/enemies_sheet.png`, 6 rows × 4 cols, names pufferfish, mantis_crab, jellyfish, anglerfish, mech_shark, sea_dragon
2. `prep` → detects bg rgb(0,0,0), writes `/tmp/sprite-crop/galaga/enemies_prepared.png`
3. `scan` → 6 row bands with varying heights (e.g. 240/196/258/216/215/288)
4. `crop --cols 4 --bands ...` → 24 frames in `/tmp/sprite-crop/galaga/enemies-v1`
5. Inspect mantis_crab_f1, sea_dragon_f4, jellyfish_f2, pufferfish_f1 → mantis bottom shows jellyfish dome bleed
6. Tighten row 2 band via `--row-y`, re-crop to `-v2`, re-inspect same frames → clean
7. Corner-alpha check → all 0
8. Copy v2 → `assets/galaga/aquatic-neo-arcade/enemies/`, open folder
9. Write `crop` params into state-galaga.json

**Example 2: Re-crop after a tweak (state-driven)**

User: "Re-crop the bosses, they regenerated"

Skill actions:
1. Load state → bosses sheet has `crop.bands_file_params` from last time
2. `prep` (new sheet) → `scan` → compare with stored bands; close enough → reuse stored col centers
3. `crop` with stored params → inspect 4 frames → clean on pass 1
4. Install + update state `updated`

**Example 3: Scan finds wrong row count**

User: "Crop the tileset sheet"

Skill actions:
1. `scan` returns 9 bands but state says 8 rows
2. @tool:inspect_media the sheet → GPT added an extra partial row at the bottom
3. Tell the user, show the sheet, offer: ignore the partial row (manual `--row-y`) or regenerate via @skill:sprite-gen

## Resources

### Scripts
- [crop_sprites.py](scripts/crop_sprites.py) — Deterministic CLI: `prep` (bg detection + flood-fill transparency + ink-loss audit), `scan` (measure real row/column boundaries), `crop` (cut frames with measured bands + manual overrides), `trim` (remove transparent margins), `report` (frame size audit).
