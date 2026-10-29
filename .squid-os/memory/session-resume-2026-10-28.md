# Session Resume — 2026-10-28 (petal-panic sprite engine)

## User's last two questions + answers (saved on request)

### Q1: "block double should be 2 unit and triple 3 unit"
**A:** Already how it works. `tileSolid()` decomposes width into variants:
single = 1u (72px), double = 2u (144px), triple = 3u (216px). Same for platforms. No change needed.

### Q2: "the background should not be blocks for the ground — we must use the fg"
**A (initial stopgap):** added `drawFgGround()` in parallax.js, wired over block tiles in render.js.
**Final state (M7, commit e2578a59):** stopgap deleted; floor is now a first-class
`kind='floor'` Entity using the per-level fg_sheet.json with `sprite.tile = true`.

## The follow-up question (this session)
"Is not the block entity using the collision size to calculate the block height, then proportion the sprite?"

**Answer: NO — blocks do NOT use the collision-box uniform-scale rule. (Corrected 2026-10-28:
earlier draft of this note wrongly said they did.)**

1. **Floor (real Entity path):** `setAnim()` → `_spriteScale = uniformScale(animData, this.h)`
   where `scaleReference` = the editor-authored **collision box** from the sheet JSON.
   Floor: 48px / 175px (fg collision h) ≈ 0.274 uniform scale. Verified by test
   `tileRepeat.test.js`: "tile=true: scale comes from the collision box, not the raw image height".

2. **Blocks/platforms (tileSolid path):** do NOT touch the collision box at all.
   `tileSolid()` builds draw rects purely from unit math (`variant * UNIT_PX_X` × `rowH`),
   and render.js draws each with a raw stretched `ctx.drawImage(img, t.x, t.y, t.w, t.h)`.
   The sheet's collision box is never read on this path (grep confirms zero references in
   terrainTiles.js outside floor comments). So block frames are STRETCHED to the 48px row —
   f1 (326px source) and f2 (270px source) both become 48px tall. Not proportioned, just squashed.

## Status snapshot (2026-10-28 evening)
- M7 task 7.1 DONE + committed (e2578a59): tile=true repeat, floor entity, drawFgGround deleted.
- Tests green: 12 pass (tileRepeat + terrainTiles).
- Git tree clean, master @ 151f2303.
- Plan `.squid-os/plans/sprite-engine/.plan.json` still lists 7.1 without status field — cosmetic.
