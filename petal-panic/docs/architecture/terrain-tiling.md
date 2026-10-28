# Terrain Sprite Tiling Rules

How block and platform art is tiled from the single/double/triple width variants
and their frame sets. Source of truth for the render path in `js/systems/render.js`
and any future macro-editor preview.

## Art inventory (per level)

| Kind | Widths | Frames |
|------|--------|--------|
| Block | single (1u), double (2u), triple (3u) | f1, f2 |
| Platform | single (1u), double (2u), triple (3u) | f1, f2, f3, f4 |

All dimensions are in **logical units** (72px wide × 48px tall per unit). A
platform is always 1 row thick; a block may be multiple rows tall.

## Width tiling rule

Given a terrain piece of width **W** units (any positive integer):

1. **Longest first:** place the widest variant that fits the remaining width
   (triple → double → single).
2. **Trim:** repeat until the remaining width is 0.

This produces a deterministic, non-uniform pattern that avoids obvious
repeat-tiling.

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

The tiling is computed left-to-right; each tile's x offset is the sum of all
previous tile widths.

## Height stacking rule (blocks only)

A block of height **H** units is stacked vertically using the same
"longest-first, trim" logic:

1. Place the tallest available block-art row that fits the remaining height.
2. Repeat until the remaining height is 0.

In practice the block art is a single rectangular image per width variant, so
"stacking" means drawing the same width-variant image multiple times, each one
row tall, from bottom to top. If H > 1 the topmost row may use a different
frame for visual variety (see frame selection below).

### Example

A 4-unit-tall, 3-unit-wide block:
- Row 0 (bottom): triple-width block, frame per selection rule
- Row 1: triple-width block, frame per selection rule
- Row 2: triple-width block, frame per selection rule
- Row 3 (top): triple-width block, frame per selection rule

(If distinct "cap" art existed we would use it on the top row; today all rows
use the same width-variant image.)

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

where `target_height_px = 48` (one Y-unit) for a single-row tile, and the
source bbox comes from the sheet JSON (first-frame bbox as reference, per
`sprites.md` §4 v1). Width follows the same scalar — never stretched
independently.

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
