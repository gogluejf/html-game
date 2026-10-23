# Sprite Ingest Handoff — Petal Panic (2026-10-22)

Context doc so we don't lose the thread mid-batch. Read top to bottom.

## 1. The core problem we solved this session

AI-generated sprite sheets have **soft/feathered alpha** — no pixel is truly
transparent (alpha=0) at frame boundaries, and no pixel is fully opaque
(alpha=255). Only ~0.06% of pixels hit 255. So naive "find columns where
alpha=0" gap detection fails: faint bleed between frames pollutes every column.

**Fix that works:** threshold the alpha (foreground = alpha > 16 for masks,
> 64 to isolate solid bodies from trails), then use connected components.
The real poses come out as distinct large blobs even when their x-ranges
overlap (e.g. f3's hand and f4's cape share columns but sit at different y —
they're separate components).

## 2. The sprite-crop algo fixes (committed)

File: `.squid-os/skills/sprite-crop/scripts/extract_frames.py`

Three changes, all committed:

1. **Centroid-split** (replaces blind even-division). When no clean gaps are
   found, span boundaries are placed at midpoints between consecutive
   component centroids instead of equal-width slices. Commit `7787041c`.

2. **Removed the span-boundary clip / Voronoi.** This was the big bug. It was
   zeroing owned-component pixels past a vertical line, which chopped limbs
   (e.g. colonel_carrot's pointing hand). Trust component ownership — the
   unowned-erase already removes other frames' bodies. No position-based
   clipping. Commit `63124f47`.

3. **Body-count guard.** After cropping, counts large body components per row
   and WARNs if it != the `--rows` you passed. Catches wrong frame-count
   assessments (death=6 not 5, stomp=3 not 5). It's a warning, not a hard
   stop — it also fires on throw-anim sheets where a detached projectile
   counts as an extra body. Commit in the grim_vertigo feat.

### Key lesson (the actual root cause of most failures)
**The algo was fine. I kept passing the wrong `--rows` count** because I
assumed "all 5 frames" without inspecting each sheet. ALWAYS count the real
poses first (open the sheet + check big-component count), never assume.

## 3. Correct ingest workflow (use this every time)

For each source sheet in `~/Downloads/petal-panic/`:

1. **Count frames** — open the sheet AND run a big-component count
   (`alpha > 64`, count blobs > 4000px). Don't trust either alone; trails
   inflate the count, merged poses deflate it. Confirm with the user if unsure.
2. **Crop** via the script into a fresh tmp dir:
   ```
   python3 .squid-os/skills/sprite-crop/scripts/extract_frames.py extract \
     --sheet <src>.png --out /home/goglue/tmp/<label>_v1 \
     --rows <N> [--rows N,M + --span for multi-row continuous anims] \
     [--row-y "0-H1,H1-H" to force row split] \
     [--col-x "0:x1,x2;1:y1,y2" to force column boundaries] \
     --names <entity> --anims <anim> --margin 10 \
     --json /home/goglue/tmp/<label>_v1/result.json
   ```
3. **Inspect** f1 + any flagged/odd-sized frame BEFORE installing. Open them.
4. **Install**: copy `<anim>_fN.png` into the entity dir, glue a single-row
   `_sheet.png` (center each frame in a max_w×max_h cell, plain paste), write
   twin `_sheet.json`.
5. **Audit**: `python3 .squid-os/skills/sprite-engine/scripts/audit.py --root . <entity>`
   Must be 0 structural errors / 0 gaps. (Pixel mismatches only appear if you
   use the ORIGINAL as the sheet instead of re-gluing — see §5.)
6. **Commit**, then back up the source to `bck.new/` and remove from Downloads root.

### Asset convention
```
petal-panic/assets/{category}/{entity}/{anim}_sheet.{png,json}
petal-panic/assets/{category}/{entity}/{anim}_f{N}.png   (flat, same dir)
```
Categories: boss, enemies, heroes, projectiles, powerups_weapon, objects,
interface, levels. JSON schema: file, size, rows, cols, kind, description,
entities[{name,anim,frames_dir,frames[{file,row,col,bbox}]}], updated.

## 4. What's DONE and committed this session

| Entity | Category | Anims added | Notes |
|---|---|---|---|
| colonel_carrot | boss | launch (replaced old), command | old launch deleted |
| grim_vertigo | boss | 12 new + dash_shark = 13 total | dropped angry/attack/idle; kept card |
| ratzo_ringleader | enemies | idle, pickup_bomb, pickup_fish_bone, throw_bomb, throw_fish_bone | dropped attack; projectiles on f4 via --col-x |
| jester | enemies | run | |
| homing | powerups_weapon | fly (8) | |
| explosive | powerups_weapon | fly (7) | |
| petal | projectiles | fly (8) | |
| stink_mine | projectiles | idle (5) | |
| mine | projectiles | idle (5) | |

grim_vertigo anim list: buck_horse, card, dash_shark(4), dazed_elephant,
death(6), falling_elephant, rampage, spin, spin_elephant, spin_empty,
spin_horse, spin_shark, stomp_elephant(3).

## 5. KNOWN ISSUES / OPEN

### 5a. Hero attacks — INSTALLED BUT UNCOMMITTED, and user says they look wrong
- `balthazar/cane_attack` (10 frames, 2×5 span) — UNCOMMITTED
- `scarlet_vale/ribbon_attack` (7 frames, 4+3 span) — UNCOMMITTED
- User said "they are all fuck" — need to re-inspect. The cane swing arcs and
  ribbon trails may have produced bad crops (fragments or merged poses).
- Old `attack` anims were KEPT (user said keep old, add new).
- **ACTION: open each frame, find what's wrong, re-crop or revert.**

### 5b. grim_vertigo death + stomp_elephant — 8 pixel mismatches in audit
These two use the ORIGINAL AI sheet as `_sheet.png` (copied as-is) while the
other 10 vertigo anims are re-glued. Round-trip fails because frames are
cleaned crops, not exact slices of the original. Cosmetic — frames are correct.
To make uniform: re-glue death + stomp_elephant like the rest. Low priority.

### 5c. Still in Downloads, NOT ingested (8 files)
- tusko_wobble_idle → boss/tusko_wobble/idle
- clown_bomb_multi → projectile? multi-anim sheet, needs splitting
- clown_drone_multi → new enemy clown_drone, multi-anim
- dynamite_monkey_explode + dynamite_monkey_walk → maps to existing
  `explosive_monkey` entity (code id in js/enemies/explosiveMonkey.js), NOT a
  new name
- parachute_clown_fall_alt + parachute_clown_fall_explode → new enemy
  parachute_clown
- interface_world_map_bg → interface static bg

## 6. Download folder state
- `~/Downloads/petal-panic/*.png` — remaining sources (see 5c)
- `~/Downloads/petal-panic/bck.new/` — backup of everything ingested so far
  (colonel_carrot, grim_vertigo, ratzo, jester, the 5 projectiles/powerups,
  mech_shark). Always cp -n to bck.new BEFORE rm from root. Verify before rm.

## 7. Rules learned the hard way
- NEVER assume frame count — inspect + count components first.
- NEVER zero/erase pixels on installed frames to "fix" a crop — re-slice from
  the source instead. (Destroyed a hand once.)
- NEVER move/delete more than asked. Copy to backup, verify, then remove only
  the specific named files.
- Use the script for all pixel work. Manual PIL slicing is last resort only
  (used once for spin/death when the carousel bg glued frames — flag for review).
- Multi-row continuous anim → `--rows N,M --span`. Force splits with
  `--row-y` / `--col-x` when auto-detection fails on trails.
