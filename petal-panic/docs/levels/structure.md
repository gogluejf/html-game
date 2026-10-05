# Petal Panic — Level Structure

A **level** is a themed journey. An **area** is one independent playable zone
within it. Areas are not physically connected pieces of one scrolling map.

## 1. Five zones per level

Each level contains:

1. Area 1.
2. Area 2.
3. Area 3.
4. Area 4.
5. A separate boss zone, including its short approach and arena.

For example, Level 1 contains 1-1 through 1-4, then its boss zone.
**Exactly one of the four ordinary areas is vertical.** It can be 2, 3, or 4;
never 1. The other three are horizontal. Whether the vertical slot is selected
by configuration or chosen once per game remains a tuning/design choice; it
must remain unchanged throughout that game.

The boss and enemy roster belong to the level's theme. Difficulty increases
across its numbered areas through macro selection and population, not by
changing the hero's controls.

## 2. Independent zones

Reaching an exit ends the current zone. After the celebration and fade, a new
zone replaces it. A vertical-to-horizontal transition does not require walking
back down or building a physical connecting passage.

- Area 1 starts without an entry checkpoint flag.
- Later areas begin beside a visible entry flag.
- The boss zone begins beside a boss checkpoint flag.
- Each ordinary area ends at its exit flag. There is no scrolling beyond it.
- The exit of area 4 uses the boss checkpoint appearance and leads to the boss zone.

Death restarts the current zone, not the area before the flag. Details belong
to [checkpoints](checkpoints.md).

## 3. Horizontal areas

Ordinary horizontal progression runs left to right. The exit is at the far end.
The camera stops at the area boundaries; it cannot reveal the previous or next
zone. Horizontal backward-scroll behavior within the current area is a
design-plan decision.

Do not invent mandatory pits or a particular camera lead distance. Those have
not yet been specified.

## 4. Vertical areas

Vertical progression is an upward climb, Contra-style.

- The starting (entry) flag sits on a supporting platform at the **bottom** of
  the zone. In screen coordinates (y=0 is the top), the bottom platform is at
  the largest y value in the zone's bounds, and the entry flag's top edge is at
  `bounds.y + bounds.h - flagHeight`.
- There is **no horizontal camera scrolling**. The hero can still move sideways
  and jump between platforms inside the fixed width.
- The camera follows upward progress only. Once raised, it never follows back down.
- The hero may fall within the visible view, but falling into the bottom emptiness
  kills them. Descending cannot recover the earlier part of the climb.
- The exit flag sits on a platform at the **top** of the climb. In screen
  coordinates the top platform is at a small y offset from `bounds.y`, and the
  exit flag's top edge is at `topPlatformY - flagHeight`. The top platform is
  a one-way surface (the hero can pass up through it and land from above).
- Death resets the ascent to its starting platform and starting camera position.

The initial supporting platform must allow a safe start; the lethal bottom rule
must not kill a hero standing normally at the entry.

**Composition.** Vertical areas are composed along the Y axis (height), not
the X axis (width). Geometry uses canonical whole-unit bounds shared by the
game and Macro Editor: **56 height units** (`56 × 48 = 2688px`) and **13 width
units** (`floor(960 / 72) = 13`, or 936 authored pixels inside the 960px view).
Macros are stacked upward: each macro's entry sits at the current climb
elevation, and its exit raises the hero's position. Composition itself is
purely vertical; x remains constrained to columns `0..13`.

**Coordinate summary (screen coordinates, y=0 is top):**

| Element | Y position |
|---------|-----------|
| Entry flag (bottom) | `bounds.y + bounds.h - flagHeight` (largest y) |
| Bottom platform top | `bounds.y + bounds.h` |
| Top platform top | `bounds.y + topOffset` (small y, near top) |
| Exit flag (top) | `bounds.y + topOffset - flagHeight` (smallest y) |

**Shared unit geometry.** Authored level geometry is defined in unit space in
`js/world/macros.js`; `level.js` derives pixels from it:

- Horizontal area: **56 columns** (`4032px`).
- Vertical climb: **56 rows** (`2688px`) × **13 columns** (`936px`).
- Horizontal play height: **10 rows** above ground.
- Entry and exit inset: **2 columns** (`144px`).
- Vertical top exit platform: **1 row** below the world top, **2 columns** wide.
- Boss approach: **22 columns** (`1584px`), card trigger at column **15** (`1080px`).

Viewport dimensions (`960×540`) and sprite/collision-box dimensions remain
pixel-based because they are render/entity measurements, not authored terrain.

## Macro JSON contract

`macros/macro.schema.json` is the formal Draft 2020-12 contract for every
`macros/levels/<id>.json` file. `js/world/macroSchema.js` enforces that contract
in the game and Macro Editor without a browser dependency; the editor server
validates PUT writes against the same schema before touching disk. Placement-
specific geometry/playability rules remain in `validateLayout()` because they
depend on the final composed area.

## 5. Terrain vocabulary

**Blocks are solid landscape. Platforms are one-way landing surfaces.** They
are not interchangeable, even when their top surfaces share a height.

### Horizontal top clearance

Horizontal areas provide **10 whole play rows above ground**. Every standable
terrain surface must preserve **2 empty rows below the top of that play space**:

- Maximum block-top row: `8`.
- Maximum platform-face row: `8`.
- A block at base row `y` may therefore have at most height `8 - y`.
- This ceiling rule does not apply to vertical macros; their Y axis is the
  climb axis and their top exit is governed by vertical exit clearance.

The constants (`HORIZONTAL_PLAY_HEIGHT_UNITS`, `TOP_CLEARANCE_UNITS`, and
`HORIZONTAL_MAX_SURFACE_UNITS`) and enforcement live in `js/world/macros.js`.
The game and Macro Editor consume those same constants.

### Blocks

- Rectangular descriptor: `{ x, y, width, height }`.
- Width and height are positive whole units; there is no fixed 1–3 size cap.
- The maximum legal width is placement-specific:
  - horizontal: from the block's final `x` to the area exit-clear boundary;
    it may not enter either area entry or exit clearance,
  - vertical: from its `x` to the fixed 13-column right boundary.
- The maximum horizontal height is `8 - y`, preserving two empty top rows.
- Vertical height is bounded by the vertical area's climb/exit rules.
- Blocks are solid from every direction and cannot be jumped/dropped through.
- Contiguous blocks with the same `y` and `height` are one wider rectangle.

### Platforms

- Descriptor: `{ x, y, width }`; logical thickness remains one row.
- Width is any positive whole number, with the same placement-specific horizontal
  or vertical boundary as blocks. There is no fixed width-3 cap.
- `y` is any legal positive row; the hero stands on the top face.
- Support the normal jump-through and Down + Jump drop-through rules from
  [hero mechanics](../architecture/hero-mechanics.md).

Successive top-surface elevations are spaced so double jumping can reach the
next tier: ground to tier 1, then tier 1 to tier 2, then tier 2 to tier 3.
Spacing must work for both heroes with a usable margin, not only a perfect jump.

The maximum clearable horizontal gap is derived from hero physics: the minimum
horizontal distance a hero can cover during a full-speed double-jump airtime
(speed × total airtime). This is computed from the hero's run speed and jump
impulse (both heroes, take the minimum), not a hand-tuned constant.

### Traversal reachability warnings

The Macro Editor derives a landing graph from every block top and platform
face. Ground is continuous, so the hero may walk to the nearest edge before
jumping. A landing is reachable when either:

- its height can be reached directly from ground, or
- it can be reached from another reachable landing.

Each graph edge uses the real shared physics values: hero run speed, jump
impulse, gravity, double-jump factor, `UNIT_PX_X`, and `UNIT_PX_Y`. Horizontal
distance is measured edge-to-edge. Vertical rise and horizontal gap are
calculated together: a higher destination leaves less airborne time for
horizontal travel. Both heroes are evaluated and the weaker result governs.
Same-height surfaces never become unreachable merely because they are near or
far from another surface.

This graph is authoring guidance, not structural legality. A disconnected
surface is allowed because it may hold a static projectile enemy, decoration,
or another intentionally inaccessible feature. The editor renders it amber
and reports a warning; it does not reject or alter the geometry. Structural
errors such as overlap, bounds, clearance, and unsupported slots remain
blocking errors.

Vertical composer route validation remains strict and separate from these
horizontal editor warnings.

Vertical areas repeat reachable climbing patterns upward; three tiers must not
accidentally become a three-platform cap on the entire ascent. Exact vertical
pattern dimensions remain tuning work.

## 6. Art and length

Use the level-specific background, foreground, block, and platform artwork.
The circus horizontal layers and the balloon-filled vertical sky establish the
two orientations visually. Decorative props painted into an image do not alone
create collision or collectible objects.

Target **roughly twice the current prototype area length**, particularly the
short existing 1-1-style stretches. Record the measured baseline before
implementation; no screen count has been agreed. Vertical climb duration and
boss approach length are tuned separately rather than blindly doubled.
