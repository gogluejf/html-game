# Terrain Sprite Tiling Rules

How block and platform art is tiled from their frame sets on the **square 48×48px
logical grid** (source of truth: `js/consts.js`, `UNIT_PX_X = UNIT_PX_Y = 48`).
Source of truth for the render path in `js/systems/render.js` and any future
macro-editor preview. Footprint contract: `js/world/squareGrid.js`.

## Art inventory (per level)

| Kind | Variants | Frames |
|------|----------|--------|
| Block | height single (1 cell), double (2 cells), triple (3 cells); width fixed at 2 cells per column | f1, f2 |
| Platform | width single (1 cell), double (2 cells), triple (3 cells); height fixed at 1 cell | f1, f2, f3, f4 |

All dimensions are in **cells** (one cell = 48px × 48px). A platform is always
1 cell thick; a block column is always 2 cells wide and may be multiple cells
tall. Wide walls repeat 2-cell columns side by side; tall columns decompose
into height variants.

## Height tiling rule (blocks only)

Given a block column of height **H** cells (any positive integer ≥ 1):

1. **Longest first:** place the tallest variant that fits the remaining height
   (triple → double → single).
2. **Trim:** repeat until the remaining height is 0.

This produces a deterministic, non-uniform pattern that avoids obvious
repeat-tiling.

### Examples

| H | Stacking (bottom → top) |
|---|-------------------------|
| 1 | single |
| 2 | double |
| 3 | triple |
| 4 | triple + single |
| 5 | triple + double |
| 6 | triple + triple |
| 7 | triple + double + single + single |
| 8 | triple + triple + single + single |
| 9 | triple + triple + triple |

Each row's y offset is the sum of all previous row heights (stacked bottom-up).
Horizontal repetition of 2-cell columns is done by the macro layout, not by the
tiler — the tiler only splits one column's height.

## Width tiling rule (platforms only)

Given a platform of width **W** cells (any positive integer ≥ 1):

1. **Longest first:** place the widest variant that fits the remaining width
   (triple → double → single).
2. **Trim:** repeat until the remaining width is 0.

The tiling is computed left-to-right; each tile's x offset is the sum of all
previous tile widths.

### Examples

| W | Tiling |
|---|--------|
| 1 | single |
| 2 | double |
| 3 | triple |
| 4 | triple + single |
| 5 | triple + double |
| 6 | triple + triple |
| 7 | triple + double + single + single |
| 8 | triple + triple + single + single |
| 9 | triple + triple + triple |

Both rules route through the shared `squareGrid.decomposeVariant(kind, cells)`
(longest-first `[3,2,1]`) so runtime and editor previews agree.

## Frame selection rule

Each tile picks which frame to draw using a weighted random roll, made **once
per tile at build time** (not per-frame — the choice must be stable across
renders and zone reloads within the same game seed):

| Roll | Probability | Platform frame | Block frame |
|------|-------------|----------------|-------------|
| "best" | 75% | **f4** | **f2** |
| "random" | 25% | random from **f1–f3** | **f1** |

The random number comes from the **per-game seeded RNG** (`createRng` in
`terrain.js`), so the same seed always produces the same frame choices —
death/Continue rebuilds the identical world (lifecycle.md §6).

### Why 75/25

f4 (platform) and f2 (block) are the visually strongest frames. Using them
most of the time keeps large stretches coherent; the 25% variation prevents
the "copy-paste" look on long runs without sacrificing readability.

## Scaling

Each tile is scaled uniformly to fit its logical footprint:

```text
scale = target_height_px / source_bbox_height_px
```

where `target_height_px = 48` (one cell) for a single-row tile, and the
source bbox comes from the sheet JSON (first-frame bbox as reference, per
`sprites.md` §4 v1). One uniform collision-height scalar per animation — width
follows the same scalar; never stretched independently.

## Integration points

- **Game render:** `render.js` solid/platform loop calls the tiler instead of
  `fillRect`. The tiler returns an array of `{x, y, w, h, frame, img}` draw
  commands in world coordinates.
- **Macro editor preview:** same tiler, same seed → identical preview.
- **Collision:** unchanged. Tiling is purely visual; the collision box remains
  the full W×H rectangle defined by the macro.

## Out of scope (for now)

- Distinct cap/corner art for block tops and edges.
- Per-level frame-weight overrides (today the 75/25 split is global).
- Animation between frames (frames are static picks; the SpritePlayer
  milestone will drive multi-frame playback when sheets gain timing data).
