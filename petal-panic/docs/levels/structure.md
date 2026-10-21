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
  the zone. In screen coordinates (y=0 is the top), the bottom platform's top
  surface is `VERTICAL_GROUND_Y` — one floor-slab height above the world
  bottom (`bounds.y + bounds.h - floorH`, i.e. `2640` for the canonical 56-row
  zone) — so a visible ground band shows at the bottom of the view, exactly
  like the horizontal floor. The entry flag's top edge is at
  `VERTICAL_GROUND_Y - flagHeight`.
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
| Entry flag (bottom) | `VERTICAL_GROUND_Y - flagHeight` (largest y) |
| Bottom platform top | `VERTICAL_GROUND_Y` (= `bounds.y + bounds.h - floorH`) |
| Top platform top | `bounds.y + topOffset` (small y, near top) |
| Exit flag (top) | `bounds.y + topOffset - flagHeight` (smallest y) |

The climb height is the space ABOVE the ground surface: macro elevations count
up from `VERTICAL_GROUND_Y`, and the lethal-bottom rule kills a hero whose feet
drop strictly below it. The first composed macro is validated against the
ground exactly like every inter-macro join (its lowest landing must be within
one jump step of the floor), so the entry is always a safe start.

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

### Clearance between units

How much empty space a unit needs above whatever is directly below it (in the
same column). The ground counts as a surface, so this also covers a unit that
is floating with nothing under it:

- **Block:** needs **2 empty rows** of clearance above the surface below it —
  or above the ground if nothing is there. A block sitting on the ground is
  always fine. This means blocks cannot stack on each other and cannot float
  too low.
- **Platform:** needs **1 empty row** of clearance above the surface below it
  (a block or another platform). A platform can never sit on the ground.

On top of that, every standable surface must respect the ceiling rule above
(leave 2 empty rows before the top of the play space). So a unit is legal only
when it clears both the surface beneath it *and* the ceiling above it.

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

Successive top-surface elevations are spaced so the hero's movement budget can
reach the next tier (see Traversal reachability above). Spacing must work for
both heroes with a usable margin, not only a perfect jump. The maximum
clearable horizontal gap is derived from hero physics — run speed, jump
impulse, and the supermove profile — never a hand-tuned constant.

### Traversal reachability — the movement budget

All reachability checks share one conceptual model: **how far can the weakest
hero travel between two landings?** The answer is not a fixed distance; it is
derived from the hero's actual abilities, so any tuning change (jump height,
run speed, supermove profile) shifts the answer automatically. Nothing here is
hand-tuned.

The hero's full traversal budget, best spent, is:

1. **Run up to full speed** on the launch surface.
2. **Double jump**: ground jump, second jump at the first apex. This sets the
   maximum climb height — roughly *two* rows for the weakest hero, nearly
   three for the strongest. A rise above the double-jump apex is impossible,
   even with everything else.
3. **Supermove at the second-jump apex**: a horizontal burst with no gravity,
   then a decaying tail where gravity resumes. This is what turns a jump into
   a long-range crossing.
4. **Post-super fall**: after the super ends the hero keeps running at full
   speed while falling back down to the landing surface. Falling *down* buys
   extra horizontal distance.

One combined check answers both questions at once: *given this rise (or drop)
and this gap, can the weakest hero make it?* Higher destinations leave less
airtime for horizontal travel, so rise and gap are never evaluated separately.
Both heroes are always evaluated and the weaker result governs.

### Traversal reachability warnings

The Macro Editor derives a landing graph from every block top and platform
face. Ground is continuous, so the hero may walk to the nearest edge before
jumping. A landing is reachable when either:

- its height can be reached directly from ground, or
- it can be reached from another reachable landing.

Every graph edge is tested with the single shared movement-budget check above
(same algorithm for horizontal and vertical areas). Horizontal distance is
measured edge-to-edge along the traversal axis. In vertical areas the same
check applies to the sideways distance between platforms while climbing.

Same-height surfaces never become unreachable merely because they are near or
far from another surface.

This graph is authoring guidance, not structural legality. A disconnected
surface is allowed because it may hold a static projectile enemy, decoration,
or another intentionally inaccessible feature. The editor renders it amber
and reports a warning; it does not reject or alter the geometry. Structural
errors such as overlap, bounds, clearance, and unsupported slots remain
blocking errors.

Vertical areas repeat reachable climbing patterns upward; the climb must stay
within the movement budget at every step, and three tiers must not accidentally
become a three-platform cap on the entire ascent. Exact vertical pattern
dimensions remain tuning work.

## 6. Art and length

Use the level-specific background, foreground, block, and platform artwork.
The circus horizontal layers and the balloon-filled vertical sky establish the
two orientations visually. Decorative props painted into an image do not alone
create collision or collectible objects.

Target **roughly twice the current prototype area length**, particularly the
short existing 1-1-style stretches. Record the measured baseline before
implementation; no screen count has been agreed. Vertical climb duration and
boss approach length are tuned separately rather than blindly doubled.
