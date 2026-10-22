# split-sheet-per-anim

Rebuild every mixed sprite sheet as one sheet **per anim**, by gluing the
already-cropped frame PNGs that live on disk — never by re-cropping the
original AI-generated sheet.

## Why

- Frames are already cut: every `cat/entity/` dir contains `{anim}_fN.png`
  (verified: 897/897 frames referenced by sheet JSONs exist on disk).
- Re-cropping original sheets is lossy and messy (sprite bleed past cell
  edges, ragged rows, satellite effects). Gluing clean frames makes the new
  sheet + JSON exact **by construction**.
- Old mixed sheets (holding pens + multi-anim entity sheets) become
  redundant and are deleted in a final Phase B.

## Convention (strict)

```
{project}/assets/{category}/{entity}/{anim}_sheet.png   ← glued per-anim sheet
{project}/assets/{category}/{entity}/{anim}_sheet.json  ← twin JSON
{project}/assets/{category}/{entity}/{anim}_f{N}.png    ← frames (unchanged)
```

Twin JSON shape (same family as today's sheet JSONs):

```json
{
  "file": "<rel path to png>",
  "size": "WxH",
  "rows": R,
  "cols": C,
  "kind": "animation",          // "animation" | "tile_variant" | "entity_variant"
  "description": "...",
  "entities": [
    {
      "name": "<entity>",
      "anim": "<anim>",
      "frames": [
        { "file": "{anim}_f1.png", "row": 0, "col": 0, "bbox": [x, y, w, h] }
      ]
    }
  ],
  "updated": "<iso date>"
}
```

### `kind` semantics
- `animation` (default) — temporal animation frames
- `tile_variant` — level blocks/platforms (block_single/double/triple, platform_*)
- `entity_variant` — same entity, visual variants (coin bronze/silver/gold)

## Layout rule (reverse-engineer from the OLD json)

For each old sheet JSON, for each `(entity, anim)` group:

1. Take the anim's frames **in f1..fN order** (JSON `frames` array order).
2. Reproduce the old grid configuration restricted to this anim:
   - if all frames share one `row` → new sheet is 1 row × N cols
   - if frames span multiple rows of the old grid → keep the same
     rows×cols footprint they occupied (e.g. supermove: 2×5 stays 2×5)
3. Cell size: per column = max frame width in that column; per row = max
   frame height in that row. Canvas = sum of cells. Each frame is centered
   in its cell (transparent padding).
4. New JSON `bbox` = actual frame offset within the glued PNG. Exact by
   construction — no cropping tolerance, no bleed.

No re-flowing, no wrapping decisions: the old JSON is the layout source of
truth.

## Scripts

### `audit.py` (dry-run, read-only)
Per old sheet JSON:
- frame count on disk vs JSON (abort-flag on mismatch)
- bbox sanity: recorded bbox ≈ actual frame PNG size (warn on drift > 2px)
- target name collision: refuse if `{anim}_sheet.{png,json}` already exists
- report table: sheet → anims → frames → easy/flagged

Exit non-zero if any hard error. Prints summary. No writes.

### `reassemble.py` (additive build)
- runs the same audit checks first (hard errors abort)
- for each `(entity, anim)`: glue frames → write `{anim}_sheet.png`
- write twin JSON with recomputed grid/bbox + `kind` prop
- **never deletes or overwrites anything** — purely additive
- `--project <name>` scopes to one project; `--sheet <path>` scopes to one
  sheet; `--dry-run` reports what would be written

## `kind` assignments for this batch

| Sheets | kind |
|---|---|
| all holding pens (abyss + pp powerups/weapons/projectiles) | `animation` |
| pp projectiles (thorn/shoot etc.) | `animation` |
| pp coins (bronze/silver/gold) | `entity_variant` |
| levels block_sheet / platform_sheet | `tile_variant` |
| boss/hero/enemy entity sheets | `animation` |

## Execution order

1. **Abyss-qwen** (practice batch — 3 pens → 13 sheets)
   - audit → reassemble → verify JSON/PNG consistency
2. **Petal-panic** (6 pens + 19 entity sheets → ~43 sheets)
3. **Levels** (16 sheets → 48 tiny variant sheets)
4. **Validate**: game loads (abyss index.html hardcoded paths untouched —
   frames unchanged), editor spot-checks
5. **Phase B (user-driven, later)**: delete old mixed sheets + JSONs, fix
   petal-panic home/select screen paths that still point at old sheets

## Out of scope / known pending

- Game code migration to JSON-driven loading (future feature)
- Petal-panic home + select screens still reference old sheet paths —
  fixed in Phase B alongside deletions
- Future AI-generated sheets without pre-cropped frames still need real
  slicing (sprite-crop skill territory)

## Status (2026-10-21)

- [x] `audit.py` + `reassemble.py` written and tested
- [x] Abyss-qwen practice batch: 3 pens → 13 sheets, round-trip exact
- [x] Full batch: 40 multi-entity source sheets → **134 per-anim sheets built**
- [x] Validation: 565/566 frames pixel-exact on round-trip; grid/bounds/paths consistent
- [x] Schema fix pass 1: added missing `frames_dir` to all 134 new JSONs (editor
      loads frames from `/${framesDir}/${file}` — without it every frame 404s)
- [x] Schema fix pass 2: migrated editor tuning (speed/playback/collision/pivot/
      markers + per-frame offset/scale/boxes/durUnits) from old sheets into the
      5 new sheets that had tuned entities (colonel_carrot/attack,
      grim_vertigo/death, tusko_wobble/charge+death, scarlet_vale/jump). The other
      4 tuned anims (ratchet_rumbelow x3, balthazar/supermove) were already
      single-anim sheets and kept their originals.
- [ ] Known soft-mismatch: `violetta_marionetta/attack_f4.png` — pre-existing stale
      frame (disk frame doesn't match old sheet crop either; 3321/317k px differ).
      Needs re-crop from original or regeneration. Flagged for user.
- [ ] Phase B (user-driven): delete old mixed sheets + JSONs (list below), fix
      petal-panic home/select screen paths

### Bug found & fixed during build
Pillow `canvas.paste(im, pos, im)` (image as its own mask) alters semi-transparent
pixels; plain `paste(im, pos)` is lossless. All sheets rebuilt with the fix.

### Phase B deletion candidates (old mixed sheets, once validated by user)
- abyss-qwen/assets/{boss,enemy,powerup}/_sheets/* (6 files)
- petal-panic/assets/{objects,powerups,powerups_weapon,projectiles}/_sheets/* (12 files)
- 19 entity-dir mixed sheets (colonel_carrot_sheet, grim_vertigo_sheet, ...)
- 16 levels block/platform sheets

## Commits

- This plan MD: committed immediately (status section updated in place, uncommitted)
- All script + migration work: **NOT committed** until user says so
