# Petal Panic — Sprite Contract (2026-10-30, commit a4758fac)

HARD RULE for any LLM/human touching petal-panic sprite code:

- **bbox does NOT exist at runtime.** It was a build-time crop rect in sheet
  PNGs; the parser no longer reads it and the renderer never uses it. If you
  catch yourself writing `frame.bbox` in game code, STOP — the field is gone.
- Frames are **standalone PNGs** (`fg_f1.png`, `block_triple_f2.png`, …).
  The game draws the whole image at its **natural size** — it never cuts anything.
- **Size** = collision box (§4): one uniform scalar `s = targetHeight / collisionBox.h`,
  applied to everything. Every sheet MUST author a `collision` box —
  `scaleReference()` throws when missing (no fallback).
- **Position** = per-frame tuning in ANCHOR SPACE (anchor = box bottom-center, y-up):
  - `offset` = where the frame's **CENTER** sits (same convention as the sprite editor:
    rect = offset − w/2, h/2). Absent → legacy placement (centered on anchor x,
    bottom edge on anchor line).
  - `scale` = `{sx, sy}` multiplier on the image's natural size (default 1).
- Pipeline order: translate to anchor → mirror → rotate → §4 scale → draw at
  `(offset − size/2) × s`.
- Terrain: collision boxes ARE the tile footprints (blocks 96×48/96/144,
  platforms 48/96/144×48) so `s = 1`; per-frame tuning fits each crop onto the
  rect. Platforms pin their slab via `PLATFORM_DRAW_H / UNIT_PX_Y` in tileSprite.js.
- Current contract docs: `petal-panic/docs/architecture/sprites.md` §2/§9,
  `terrain-tiling.md` "Scaling & platform pinning". Plan files under
  `.squid-os/plans/sprite-engine/` are historical records (banner-marked SUPERSEDED).

## Notes
- 2026-10-30: bbox removed from runtime (a4758fac). Earlier same-day attempts
  (top-left offset convention, ratio-box scaling) broke fg/blocks/barrel renders
  and were reverted — center-based offset + footprint boxes is the working contract.
- 2026-10-30: TEMP on-screen FG debug readout lives in `drawFloor`
  (terrainTiles.js, top-left y≈140) for mobile diagnosis — remove once fg
  visibility is confirmed by the user.
