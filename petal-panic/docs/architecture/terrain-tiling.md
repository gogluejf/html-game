# Terrain Sprite Tiling Rules

How block and platform art is tiled from their frame sets on the **square 48×48px
logical grid** (source of truth: `js/consts.js`, `UNIT_PX_X = UNIT_PX_Y = 48`).
Source of truth for the render path in `js/systems/render.js` and any future
macro-editor preview. Footprint contract: `js/world/squareGrid.js`.

## Art inventory (per level)

| Kind | Variants | Frames |
|------|----------|--------|
| Block | height single (1 cell), double (2 cells), triple (3 cells); width fixed at 2 cells per column | f1, f2 |
| Platform | width single (1 cell), double (2 cells), triple (3 cells); height fixed at 1 cell | f1, f2 |

All dimensions are in **cells** (one cell = 48px × 48px). A platform is always
1 cell thick; a block column is always 2 cells wide and may be multiple cells
tall. Wide walls repeat 2-cell columns side by side; tall columns decompose
into height variants.

## Placement order (overlay rule)

Tiling walks **RIGHT → LEFT** for both kinds, and block rows stack
**BOTTOM → TOP**. Draw order follows array order, so right-side / bottom tiles
are painted first and left-side / top tiles overlay them — the proper overdraw
order for art whose left/top edges carry the "front" bevels.

- Blocks: columns right→left; within each column, rows bottom→top.
- Platforms: tiles right→left along the width.

The walk is **right-anchored**: the cursor starts at the solid's right edge and
each placed tile subtracts its own width. The decomposition list is consumed
in order, so any leftover remainder lands as the LAST tile (still inside the
solid, right-aligned). Every tile rect is an exact multiple of the 48px cell —
no offsets, no half-cells.

## Height tiling rule (blocks only)

Given a block column of height **H** cells (any positive integer ≥ 1):

1. **Biggest unit first:** place the tallest variant that fits the remaining
   height (triple → double → single).
2. **Stack to complete:** repeat until the remaining height is 0. The first
   (biggest) row sits at the BOTTOM; smaller rows stack on top.

### Examples

| H | Stacking (bottom → top) |
|---|-------------------------|
| 1 | single |
| 2 | double |
| 3 | triple |
| 4 | triple + single |
| 5 | triple + double |
| 6 | triple + triple |
| 7 | triple + triple + single |
| 8 | triple + triple + double |
| 9 | triple + triple + triple |

Each row's y offset is the sum of all previous row heights (stacked bottom-up).
Horizontal repetition of 2-cell columns is done by the tiler itself
(`blockColumns`), right→left.

## Width tiling rule (platforms only)

Given a platform of width **W** cells (any positive integer ≥ 1):

1. **Biggest unit first:** place the widest variant that fits the remaining
   width (triple → double → single).
2. **Patch with the rest:** consume the decomposition right→left; the leftover
   remainder becomes the final tile, right-aligned inside the span.

### Examples (draw order = placement order, right→left)

| W | Tiles placed (first drawn → last drawn) | Coverage left→right |
|---|------------------------------------------|---------------------|
| 1 | single @x0 | single |
| 3 | triple @x0 | triple |
| 4 | triple @x0, single @x3 | triple + single |
| 5 | triple @x0, double @x3 | triple + double |
| 6 | triple @x0, triple @x3 | triple + triple |
| 7 | single @x6, triple @x3, triple @x0 | triple + triple + single |
| 9 | triple @x6, triple @x3, triple @x0 | triple + triple + triple |

Both rules route through the shared `squareGrid.decomposeVariant(kind, cells)`
(longest-first `[3,2,1]`) so runtime and editor previews agree.

## Frame selection rule

Each tile picks which frame to draw using a weighted random roll, made **once
per tile at build time** (not per-frame — the choice must be stable across
renders and zone reloads within the same game seed):

Pools are **per-kind** (each tile draws from its own variant's sheet —
`block_single` / `block_double` / `block_triple` / `platform_single` / ...):

| Kind | Frames | 75% pool | 25% pool |
|------|--------|----------|----------|
| Platform | f1–f6 | **f4–f6** (empty) | **f1–f3** (decorated) |
| Block | f1–f2 | **f1** (decorated) | **f2** (empty) |

Both kinds show their DECORATED art most of the time; the empty/quiet frame
is the 25% variation. New frames appended at a sheet's end join the platform
empty pool automatically; for blocks they join the empty (25%) pool.

The random number comes from the **per-game seeded RNG** (`createRng` in
`terrain.js`), so the same seed always produces the same frame choices —
death/Continue rebuilds the identical world (lifecycle.md §6).

### Why 75/25

Decorated art leads on both kinds: platforms show their decorated frames
(f1–f3) only 25% of the time so long runs stay coherent, with the empty
frames (f4–f6) filling 75%; blocks show their decorated f1 75% of the time
so walls keep their character, with the empty f2 as the 25% variation.

## Scaling & platform pinning

Each tile is a real Entity running the standard sprite pipeline
(`setAnim()` → `uniformScale(collisionBox.h)` → `drawSprite()`). The authored
collision box in the sheet JSON is **the tile's true footprint** — blocks:
2 cells wide × variant height; platforms: variant width × 1 cell — centered
on the anchor (bottom-center), so `uniformScale` = rect height / box height =
**exactly 1** for every terrain anim. One uniform scalar, never stretched.

Per-frame tuning (`frame.offset` + `frame.scale` in the sheet JSON, the
Animation Studio contract) does the actual placement:

- `offset` = where the frame's **CENTER** sits in anchor space (y-up, anchor
  at the tile's bottom-center) — exactly how the sprite editor displays
  frames (`rect = offset − w/2, h/2`). All terrain frames use `x: 0`
  (centered on the column) and `y: -h/2` (bottom edge on the anchor line).
- `scale` fits the frame's crop onto the tile rect: blocks fill their row
  (96×48/96/144 px), platforms fill their cell (48/96/144 × 48 px). Crops are
  non-square source art, so sx ≠ sy by design — this is per-frame TUNING, not
  a §4 rescale; the §4 scalar stays one per animation.

`drawSprite()` uses tuned placement whenever `frame.offset` is present;
sheets without tuning fall back to the legacy placement (centered on the
anchor x, bottom edge on the anchor line) at the image's natural size.

- **Platforms:** the drawn slab is pinned to the landing face — `tileSprite.js`
  multiplies the anim scale by `PLATFORM_DRAW_H / UNIT_PX_Y` (≈0.125) for
  one-way solids, so the full-cell art renders as a thin strip whose BOTTOM
  sits on the rect's bottom edge = the landing face (build.js R5.1 thins the
  solid to `PLATFORM_DRAW_H` at that same face). A platform at level y=1
  therefore renders its slab right at the y=1 surface.

## Integration points

- **Game render:** `render.js` solid/platform loop calls the tiler instead of
  `fillRect`. The tiler returns an array of `{x, y, w, h, frame, imgKey}` draw
  commands in world coordinates; `tileSprite.js` turns them into pooled
  Entities.
- **Macro editor preview:** same tiler, same seed → identical preview.
- **Collision:** unchanged by tiling. The macro's full W×H rect stays the
  collision box (platforms thinned to `PLATFORM_DRAW_H` at the landing face).

## Out of scope (for now)

- Distinct cap/corner art for block tops and edges.
- Per-level frame-weight overrides (today the 75/25 split is global).
- Animation between frames (frames are static picks; the SpritePlayer
  milestone will drive multi-frame playback when sheets gain timing data).
