# REVISION: Petal Panic Level Engine — 2D Grid Macro Model (v1)

**Why:** The current macro model is a **1D sequential list**. `placeMacro` walks one cursor along a
single axis (x for horizontal, y for vertical), so every unit is placed *next to* the previous one and
units never share a column. That makes it impossible to stack a platform over a block in the same
column (e.g. a block wall with an overhead platform bridge). This revision replaces the sequence with
a **2D grid**: every unit is placed at an explicit `(row, col)` cell.

**The one rule that unifies everything:**
- **`row` = units up from the ground** (0 = on the ground). Counted the SAME way for horizontal and
  vertical areas.
- **`col` = units from the left** (0 = left edge of the macro's footprint).
- A block's `row` is its **base** (it rises UP by its height from that row).
- A platform's `row` is its **landing face** elevation (replaces the old `tier`).
- Empty cells are gaps — **`G()` is removed.** A "hole" is just an unoccupied cell.

**Example:** `B(2, 0, 2)` = a block **2 units tall**, base at **row 0** (on the ground), at
**col 2** (2 from the left). `P(3, 4, 2)` = a platform **3 wide**, landing face at **row 4**, at
**col 2** — i.e. directly above the same column as the block (block top is row 2, platform face row 4
= 2 rows of clearance, satisfying the rule below). Stacking works because both use the same
`(row, col)` space.

**Clearance rule (the one geometry law):** any unit whose base/face is above row 0 must be **≥ 2 rows
above the top of whatever is directly below it** in its column span (floor counts as row 0; a platform
below counts by its face row; a block below counts by base+height). A block may sit at row 0 on the
floor freely. This single rule covers blocks-above-blocks and platforms-over-blocks / blocks-over-
platforms alike. Violation → authoring error.

**Outcomes:**
- Units place at any `(row, col)`; a platform can sit over a block in the same column (≥ 2 rows clear).
- Horizontal and vertical configure identically (row = up-from-ground, col = from-left).
- `G()` gone; gaps are empty cells. No auto-assign — every macro declares explicit positions.
- Platforms render thin (`UNIT_PX / 8`) and the dump reflects that height.
- Composer still validates reachability (clearance rule, upward steps ≤ 1 tier, clearable gaps,
  both heroes complete the route).
- Trace areaMap stores the full 2D layout (accurate per seed).
- All existing tests green (or updated to the new model).

---

## MILESTONE: R1 — 2D Grid Unit Model

### TASK: R1.1 — New unit descriptor + helpers (row, col)
Type: refactor
What: Change the unit descriptor to carry an explicit grid position, counted from the ground/left:
  - block:    `{ kind:'block', height, row, col }`      // row = base (rises up by height)
  - platform: `{ kind:'platform', width, row, col }`    // row = landing-face elevation (was `tier`)
New helper signatures — **explicit position required, NO auto-assign fallback** (migration is a one-time port of every macro; silent sequential placement would be confusing):
  - `B(height, row, col)`   // row = base row (rises UP by height from that row)
  - `P(width, row, col)`    // row = landing-face elevation (was `tier`)
Remove `G()`. Omitting `row`/`col` is an authoring error → throw at macro definition time.
Why: Explicit `(row,col)` is what enables stacking; the shared "row = up from ground" convention makes
horizontal and vertical identical. No fallback — every macro must declare its grid explicitly (see R3.1).
Files: ~ petal-panic/js/macros.js
Snippet: export function B(height, row, col) { if (row==null||col==null) throw new Error('B requires explicit row,col'); return {kind:'block',height,row,col}; }\nexport function P(width, row, col) { if (row==null||col==null) throw new Error('P requires explicit row,col'); return {kind:'platform',width,row,col}; }\n// G() removed — an empty cell is a gap.
Acceptance: Units declare explicit (row,col); omitting throws at definition time; two units may share a
column at different rows (stacking legal per clearance rule below); no `G()` references remain in new macros.
Verification: node --test petal-panic/js/test/macros.test.js

### TASK: R1.2 — Rewrite placeMacro for 2D placement
Type: refactor
What: Replace the single-cursor walk with grid placement. For each unit compute its pixel rect from
`(col, row) × UNIT_PX` + zone origin:
  - x = origin.x + col * UNIT_PX
  - y = groundY - (row + unitHeight) * UNIT_PX   // row counted UP from ground
Same formula for horizontal and vertical (row is always up-from-ground). Rules:
  - **No fallback:** every unit must carry explicit `(row, col)`; missing → throw.
  - **Clearance rule (unified):** any unit whose base/face is above row 0 must be ≥ 2 rows above the
    top of whatever is directly below it in the same column span (floor at row 0, a platform's face, or
    a block's top = its base+height). A block may sit at row 0 on the floor with no clearance needed.
    This single rule covers both "two blocks need ≥ 2 units between them" and "platform over block /
    block over platform needs ≥ 2 units". Violation → throw.
  - Vertical areas: the climb still advances along row; col gives lateral variety within the fixed width.
Why: This is the core change making a block + overhead platform in the same column legal, with one
formula for both orientations.
Files: ~ petal-panic/js/macros.js
Snippet: function placeMacro(macro, ...) {\n  for (const u of macro.units) {\n    if (u.row==null || u.col==null) throw new Error('unit missing row/col');\n    const px = origin.x + u.col*UNIT_PX;\n    const py = groundY - (u.row + (u.kind==='block'?u.height:1)) * UNIT_PX;\n    // clearance: if u.row > 0, require >= 2 rows above top of nearest unit below in same col span\n  }\n}
Acceptance: `B(2,row=0,col=3)` + `P(3,row=4,col=3)` → a block at col 3 with a platform floating above it
at the same col (block top row 2, platform face row 4 = 2 clear); violating clearance throws; horizontal
and vertical place identically via (row,col); deterministic for a given macro.
Verification: node --test petal-panic/js/test/macros.test.js (add a stacking test case)

### TASK: R1.3 — Update width/axis-length + budget math
Type: refactor
What: `macroWidth` / `macroAxisLength` currently sum sequential widths. With 2D placement a macro's
footprint is its bounding box: width = max(col+unitWidth)-min(col), height = max(row+unitHeight)-min(row).
Budget consumption uses the footprint along the composition axis (x for horizontal, y for vertical).
Update both functions.
Why: Budget/length must reflect the real 2D extent, not a sequential sum.
Files: ~ petal-panic/js/macros.js
Acceptance: macroWidth/macroAxisLength return the bounding-box extent along the relevant axis; a stacked
macro consumes correct budget; composer still fills areas to budget.
Verification: node --test petal-panic/js/test/macros.test.js

---

## MILESTONE: R2 — Composer + Validation for 2D

### TASK: R2.1 — composeArea works on grid macros
Type: refactor
What: The compose loop selects macros and offsets them along the composition axis by the previous
macro's axis-extent (bounding box, not a sequential sum). Follow-condition + anti-repetition logic
unchanged. Each macro contributes a 2D footprint placed at the running axis offset.
Why: Composition stays macro-based (readable challenges) while individual macros gain internal 2D freedom.
Files: ~ petal-panic/js/macros.js
Acceptance: composeArea produces valid 2D layouts for all stages/orientations; deterministic per seed;
stacked macros compose without clearance errors.
Verification: node --test petal-panic/js/test/macros.test.js

### TASK: R2.2 — validateLayout for 2D reachability
Type: refactor
What: Extend validation to the 2D model: (a) **clearance rule** — any unit above row 0 must be ≥ 2 rows
above the top of whatever is below it in its column span (floor counts as row 0); (b) required landings
not buried under a solid; (c) upward elevation steps between successive landings ≤ 1 tier (double-jump
reachable); (d) horizontal gaps between landings ≤ MAX_CLEARABLE_GAP; (e) entry/exit zones clear;
(f) **row bounds** — block base row ≤ `floor(ZONE_GROUND_Y / UNIT_PX) - height - 1` (= 9 - h - 1 at
48px/500px floor, so the hero can walk over without leaving the screen); platform face row ≤
`floor(ZONE_GROUND_Y / UNIT_PX) - 1` (= 8). A stacked platform-over-block passes when the platform is
≥ 2 rows above the block's top AND reachable from below/adjacent.
Why: 2D freedom must not create impossible geometry; existing guarantees carry over.
Files: ~ petal-panic/js/macros.js
Acceptance: validateLayout throws on clearance violations, buried landings, >1-tier upward jumps,
over-wide gaps, and out-of-bounds rows; passes valid stacked layouts; existing validation tests still hold.
Verification: node --test petal-panic/js/test/macros.test.js

---

## MILESTONE: R3 — Re-author Macros + Early-Stage Platforms

### TASK: R3.1 — Port existing macros to (row, col) form
Type: refactor
What: Re-express every macro in MACROS using explicit `(row,col)` — **all of them, no exceptions**
(no sequential fallback exists anymore). Verify each still composes + validates identically to before
(regression).
Why: Migration must not change existing areas' feel beyond intended.
Files: ~ petal-panic/js/macros.js
Acceptance: All macros ported; composed outputs match prior behavior except where intentionally changed;
tests green.
Verification: node --test petal-panic/js/test/macros.test.js

### TASK: R3.2 — Add early-stage + stacked platform macros
Type: feature
What: Add (a) a difficulty-1 horizontal macro containing a platform (so stage 1 shows platforms),
(b) at least one STACKED set piece (block wall + overhead platform bridge the hero crosses above),
available stage 2+. Tune STAGE_WEIGHTS / macro difficulty so platforms appear from stage 1–2, not only 3–4.
Why: Fixes the observed "platforms only in late stages" gap and proves the stacking value.
Files: ~ petal-panic/js/macros.js
Snippet: // Easy platform macro (diff 1) so stage 1 shows platforms:\n easyPlatformHop: { difficulty:1, units:[ P(2,1,0), P(2,2,3) ] },\n// Stacked set piece (diff 2): block wall + overhead platform bridge (clearance: block top row 2, platform face row 4 = 2 clear):\n blockBridge: { difficulty:2, units:[ B(2,0,0), B(2,0,1), P(3,4,0) ] }, // platform at row 4 over the blocks
Acceptance: Stage 1 areas can contain a platform; at least one composed area shows a platform stacked over
a block; trace areaMap reflects the stacked layout; both heroes complete the routes.
Verification: node --test petal-panic/js/test/macros.test.js

---

## MILESTONE: R4 — Trace/areaMap stores full 2D layout

### TASK: R4.1 — areaMap captures (row, col) layout
Type: refactor
What: Update `captureAreaMap` so `placedUnits` carries (row, col, w, h, kind) in unit space plus the
layout bounding box. Stable per seed. (No separate debug/PNG renderer in this revision — the data is
there for a future tool.)
Why: The dump must capture the authoritative 2D layout, not a 1D sequence.
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/stats.js
Acceptance: A dumped trace's areaMap fully reconstructs each area's 2D terrain including stacked units.
Verification: node --test petal-panic/js/test/ + manual JSON inspection

---

## MILESTONE: R5 — Platform Render Height (thin platforms)

### TASK: R5.1 — Platforms draw at 1/8 unit height
Type: feature
What: A platform is a thin landing face, not a full-height slab. When rendering, a platform's drawn
height = `UNIT_PX / 8` (6 px at 48px units), anchored to its landing-face row (the top of the drawn
rect sits at the face elevation; the hero stands on that top). Blocks keep their full
`height × UNIT_PX` drawing. The physics/landing surface stays exactly where it is today — only the
drawn rect changes (collision uses the existing one-way platform logic, unaffected).
Add a constant `PLATFORM_DRAW_H = Math.max(2, Math.round(UNIT_PX / 8))` in macros.js (or level.js next
to ZONE_GROUND_Y) so renderer and dump share the single source of truth.
Why: Thin platforms read visually as "a platform" rather than another block wall.
Files: ~ petal-panic/js/systems/render.js
Files: ~ petal-panic/js/macros.js
Acceptance: Platforms render as a 6px-tall strip at their face row; blocks unchanged; hero collision /
one-way landing behavior identical to before; no visual overlap with entities standing on the face.
Verification: node --test petal-panic/js/test/ + manual playthrough screenshot check

### TASK: R5.2 — Dump/areaMap reflects platform draw height
Type: refactor
What: In `captureAreaMap` (R4.1 output), each placed platform unit carries its **draw** height
(`h: PLATFORM_DRAW_H / UNIT_PX` → fractional 0.125, or store both `unitH` and `drawH` in px) so the
dumped JSON distinguishes a thin platform from a solid block purely from the data. Blocks carry
`h: height` (full units). Keep the layout bounding box consistent (bounding box still uses logical
footprint: platform occupies 1 row of clearance space even though it draws thin).
Why: The trace must be able to reconstruct the visual distinction without re-deriving it.
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/stats.js
Acceptance: A dumped areaMap shows platform units with the thin draw height (0.125 units / 6px) and
block units with full integer heights; round-trip inspection matches what renders.
Verification: node --test petal-panic/js/test/ + manual JSON inspection

---

## Decisions (confirmed)
1. **`P()` 2nd arg = `row`** — `tier` renamed to `row` everywhere (same meaning: elevation in units
   from ground). ✅ Confirmed.
2. **No auto-assign fallback.** Every macro is migrated to explicit `(row, col)` (R3.1); omitting
   position throws. Row bounds: block base row ≤ `floor(ZONE_GROUND_Y/UNIT_PX) - height - 1`
   (= 9 - h - 1) so the hero can walk over without leaving the screen; platform face row ≤
   `floor(ZONE_GROUND_Y/UNIT_PX) - 1` (= 8). ✅ Confirmed.
3. **Block `row` = base** (rises up by height); **platform `row` = top/face**. ✅ Confirmed.
4. & 5. **Unified clearance rule:** any unit above row 0 must be ≥ 2 rows above the top of whatever is
   directly below it in its column span (floor = row 0, platform face, or block top). Covers both
   "two blocks need ≥ 2 units between them" and "platform over block / block over platform needs
   ≥ 2 units". A block at row 0 on the floor needs no clearance. Violation → throw. ✅ Confirmed.
6. **Cell size** stays 1 unit = UNIT_PX (48px). ✅ Confirmed.
7. **No fallback** (restated): migration is complete and explicit — see decision 2. ✅ Confirmed.
