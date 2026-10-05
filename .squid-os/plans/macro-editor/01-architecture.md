# Macro Editor — Architecture & Implementation Plan

## Status

| Area | State |
|---|---|
| §3 Macros as JSON files in `macros/levels/<id>.json` (filename = id) | ✅ done |
| §3 Game loads macro data from disk at boot (`js/world/macroLoader.js` + `setMacros()`) | ✅ done |
| §3 Migration/sync tool (`tools/export_macros.mjs`, re-run after inline edits) | ✅ done |
| §4 Anisotropic units confirmed in plan (72×48, imported not redefined) | ✅ done |
| §5–§8 Rules (clearance, platform ground restriction, slot support, mixed validation) exist in game code (`js/world/macros.js`) for the editor to call | ✅ done |
| §10 Location decided: inside petal-panic, next to `macros/` | ✅ done |
| §16 Save model decided: sprite-editor draft/dirty-dot rule | ✅ done |
| §3 JSON Schema as formal contract + validation on game/editor load + editor/server save | ✅ done |
| §10–§15 Editor app itself (UI, grid, tools, zoom, panels) | 🔲 todo |
| §17–§20 Procedural generator | 🔲 todo |
| §21–§24 Test mode (manual + ghost runner) | 🔲 todo |
| §27 Local server with save/delete endpoints for macros | 🔲 todo |

Legend: ✅ = already built and verified · 🔲 = planned, not started.

---

## 1. Purpose

Build a dedicated visual Macro Editor for Petal Panic that makes level-design iteration extremely fast.

The editor must support:

- Creating, editing, generating, testing, saving, and deleting macros.
- Horizontal and vertical macros.
- Manual visual editing on a unit grid.
- Procedural macro generation from deterministic algorithms.
- Immediate validation against the exact same placement rules used by the game.
- Manual playtesting with the real hero controller and physics.
- Automatic traversal/playability testing.
- Draft autosaving without modifying the canonical macro until explicitly saved.

The editor is a development tool, not a second implementation of the level system. It must consume the game's actual configuration, validation logic, movement rules, and data structures.

---

## 2. Core Architectural Principle: One Source of Truth

Do not duplicate game rules inside the editor.

The game, Macro Editor, procedural generator, level composer, and automated tester must share the same underlying modules wherever possible.

Shared definitions include:

- Unit size (currently ANISOTROPIC: 72 px wide × 48 px tall — `UNIT_PX_X` / `UNIT_PX_Y` in `js/world/macros.js`).
- Play-area dimensions.
- Horizontal-level height.
- Vertical-level width and maximum height.
- Block dimensions and legal variants.
- Platform dimensions and legal variants.
- Clearance rules.
- Slot placement rules.
- Hero movement configuration.
- Jump mechanics.
- Collision rules.
- Macro validation.
- Macro JSON schema.

Game constants should remain in shared JavaScript configuration/modules and be imported by both the game and editor.

No magic numbers should be independently redefined in the editor.

---

## 3. Macro Data Model

Macros move out of hard-coded JavaScript definitions and become data. ✅ (done — `macros/levels/<id>.json`, one file per macro, filename = id)

Store macros as JSON files in a macro directory.

The game and editor consume the same macro data.

A macro should contain at minimum:

- Unique ID/name.
- Orientation: `horizontal` or `vertical`.
- Optional metadata:
  - difficulty
  - tags/style
  - generator seed
  - notes
- Blocks.
- Platforms.
- Slots.
- Bounding dimensions if useful, or derive them from content.

Use `petal-panic/macros/macro.schema.json` (JSON Schema Draft 2020-12) as the formal contract. ✅

The dependency-free browser validator is `js/world/macroSchema.js`; the local
server validates the same schema with Python `jsonschema`.

Validate macro JSON:

- When loaded by the editor. ✅
- Before saving in the editor and again at the server PUT boundary. ✅
- When loaded by the game. ✅
- In the Node test loader and formal-schema contract tests. ✅
- When generated procedurally. 🔲 (generator not built yet)

Invalid data should fail with useful validation errors rather than silently entering the game.

---

## 4. Unit Coordinate System

All macro authoring operates in logical units, not raw pixels.

Current unit (ANISOTROPIC — a cell is wider than it is tall): ✅ (verified against code)

`1 unit = 72 px wide × 48 px tall` (`UNIT_PX_X` / `UNIT_PX_Y`, imported from
`js/world/macros.js` — never redefined)

Objects use integer grid coordinates:

`(x, y)`

Rendering converts units to pixels using the shared game configuration.

This allows editor zoom to change without changing macro data.

Canonical area dimensions are also owned in unit space by `js/world/macros.js`:

- Horizontal length: **56 units** (`4032px`).
- Horizontal play height: **10 units above ground**; canvas/world height remains `540px`.
- Vertical climb height: **56 units** (`2688px`).
- Vertical width: **13 units** (`floor(960/72)`; 936 authored pixels in the 960px view).
- Horizontal top clearance: **2 empty units**, so block/platform surfaces may not exceed row **8**.

The game level builder and editor import these constants; neither derives its
own unit dimensions from unrelated pixel literals.

Editor implication: the grid draws RECTANGULAR cells (72×48), and zoom/pan
math uses separate x/y scales — or a uniform zoom applied to the rectangular
cell. Never assume square cells.

---

## 5. Blocks

Blocks are solid objects and occupy the complete width/height of their cells.

Block descriptor:

`{ kind: "block", x, y, width, height }`

- `width` and `height` are positive whole units with no fixed 1–3 cap.
- Horizontal maximum width is `areaExitStart - finalX`; blocks may not enter
  area entry/exit clearance.
- Vertical maximum width is `13 - x`.
- Horizontal maximum height is `8 - y` (two-row top clearance).
- Contiguous blocks with identical `y` and `height` should be stored as one
  wider block rectangle.

Blocks may begin directly on the floor.

For horizontal macros, a block's top surface may not exceed row **8**. This
preserves the shared **2-unit top clearance** inside the 10-unit play height.
Therefore a block beginning at row `y` has maximum legal height `8 - y`.
Vertical macros use the climb-height/exit-clear rules instead.

### Vertical block clearance

When separate blocks exist vertically in the same column, an intentional air gap must contain at least **2 empty units**.

Example:

A height-1 block beginning at Y=0 occupies its base unit. If another disconnected block is placed above it, the next valid location must preserve two full empty units before that block.

Blocks may also directly touch/stack where that arrangement is intentionally continuous. The two-unit rule applies when creating an actual traversable gap.

The validator owns the exact implementation of this distinction. ✅ (implemented in `js/world/macros.js` — editor will call it, not re-derive it)

Reason: solid blocks consume their entire grid cells, so a one-unit air gap is too restrictive for the hero to jump and land comfortably.

---

## 6. One-Way Platforms

Platforms are thin one-way surfaces.

Platform descriptor:

`{ kind: "platform", x, y, width }`

- `width` is any positive whole unit count; there is no width-3 cap.
- Horizontal maximum width is `areaExitStart - finalX`.
- Vertical maximum width is `13 - x`.
- Logical thickness remains one grid row; rendering/collision use the thin face.

Visually/collision-wise, the platform only occupies the thin surface near the top/end of its logical cell — currently approximately 6 pixels rather than a full 48-pixel solid cell (`PLATFORM_DRAW_H` in `js/world/macros.js`). Collision keeps using the full unit box (oneWay logic) — only the draw is thin.

Platforms may be placed at different heights.

For horizontal macros, a platform's landing face may not exceed row **8**, so
it preserves the same shared **2-unit top clearance** as a block top.

### Ground restriction

Platforms cannot begin at Y=0.

The lowest legal platform level is Y=1.

This preserves an empty unit underneath the platform.

### Vertical platform clearance

Separate platform levels require at least **1 empty logical unit** of spacing.

Because the platform itself is thin rather than a full solid cell, this provides substantially more usable air space than the equivalent block arrangement.

The validator must use the actual shared platform semantics rather than approximating platforms as solid blocks. ✅ (game code already does: full-cell collision + thin draw via `PLATFORM_DRAW_H`)

---

## 7. Mixed Structures

Macros may combine blocks and platforms.

Mixed arrangements must be validated according to the real geometry and traversal rules.

A platform and block can exist at adjacent logical elevations when the arrangement is physically valid.

Do not reduce mixed validation to a simplistic universal spacing rule. The shared validator must evaluate the involved object types.

---

## 8. Slots

Slots are possible spawn positions, not guaranteed spawned entities.

Three slot types currently exist:

1. Power-up.
2. Enemy.
3. Barrel.

The macro defines potential positions only.

The level composer decides whether a slot is populated based on level progression and budgets, including the enemy budget.

Therefore:

**Macros define opportunities. The level composer decides actual population.**

### Slot placement rule

A slot may only exist exactly one logical level above a valid supporting surface.

Examples:

- A height-1 block at Y=0 supports its slot at Y=1.
- A taller block supports a slot immediately above its top.
- A platform supports a slot immediately above its surface's logical row.

A slot cannot float arbitrarily in empty space. ✅ (enforced by `slotIsOnValidSurface` in game code)

The editor must prevent illegal slot placement.

---

## 9. Horizontal and Vertical Macro Modes

### Horizontal macros

- Constrained by the playable height of a horizontal level.
- May extend horizontally as far as permitted by the level/macro configuration.
- Current horizontal play-area height is approximately 500 px, but this must come from shared game configuration rather than being hard-coded in the editor.

### Vertical macros

- Constrained by the vertical level's playable width.
- May extend upward until the configured maximum vertical-level height.
- Current working assumptions discussed were roughly 960 px width and roughly 2500 px total height, but these values must be read from the actual game configuration and verified rather than copied into editor code.

The editor should calculate the macro's occupied bounding box dynamically.

---

## 10. Editor Architecture

Implement the Macro Editor as a dedicated web development tool rather than drawing its complete UI inside the game's Canvas.

**Location: inside the petal-panic project folder** (e.g. `petal-panic/macro-editor/`) — it is a project dev tool, NOT a skill. It sits next to `macros/`, which it reads and writes.

Recommended structure:

- HTML/CSS for application UI.
- Canvas for the macro/grid workspace and game rendering.
- JavaScript modules shared with the game.
- Small local development server for file access/save operations.

The game's Debug menu may launch/open the Macro Editor.

The tool should feel integrated with Petal Panic while remaining architecturally separate from the runtime game UI.

---

## 11. Visual Design

The Macro Editor should intentionally reuse the visual architecture and interaction conventions of the existing Sprite Editor.

Reuse/inspire from:

- Top menu.
- Toolbar.
- Central Canvas.
- Grid.
- Side navigation panel.
- Zoom behavior.
- General spacing/layout.
- Selection behavior where applicable.
- Save-state indicators.

Do not unnecessarily redesign tooling conventions that already work.

---

## 12. Macro Navigation

A side panel lists existing macros, **classified by difficulty** (same navigation experience as the sprite editor's left menu). A **"New" button sits at the top of the menu**.

Functions:

- Select/open macro.
- Create new macro (`+`).
- Delete macro.
- Display orientation.
- Optionally display difficulty/tags.
- Search/filter later if the collection becomes large.

Switching macros requires no confirmation: every mutation is already stored in
a per-macro localStorage draft. Switching away and back restores that working
copy; the yellow dot continues to show draft ≠ canonical. Save and Discard are
explicit actions, not navigation guards.

---

## 13. Editing Tools — Pass 2 Interaction Contract

Implementation handoff: [`03-pass2-drag-editing.md`](03-pass2-drag-editing.md).

Pass 2 replaces the obsolete click-to-cycle design. Width and height are no
longer limited to 1–3, so geometry is created and resized by dragging.

### Active creation tools

The toolbar exposes mutually exclusive creation tools:

- **Block** — click-drag-release a rectangular `{x,y,width,height}` block.
- **Platform** — click-drag-release a horizontal `{x,y,width}` platform.
- **Slot** — click to place a one-cell spawn opportunity.
- **Erase** — click an existing object/slot to remove it.

Only one creation/erase tool is active at a time. A separate Select button is
not required for basic editing: when the pointer is over existing geometry,
that object becomes the hover/selection target and exposes resize handles.
Clicking empty space with no creation tool active clears selection.

### Block creation

1. Pointer-down snaps the anchor to a grid intersection/cell.
2. Drag defines width and height in whole units in any direction.
3. A translucent rectangle previews the normalized `{x,y,width,height}`.
4. Pointer-up commits only if the complete candidate layout is valid.
5. A click without meaningful drag creates a `1×1` block.

### Platform creation

1. Pointer-down snaps to a grid cell/row.
2. Horizontal drag defines positive whole-unit width.
3. Vertical pointer movement does not add thickness; a platform remains one
   logical row with the shared thin visual/collision face.
4. Pointer-up commits only if valid.
5. A click without meaningful drag creates a width-1 platform.

### Slot creation and type

Slots are points, not resizable rectangles. The Slot tool has three explicit
kinds rather than geometry cycling:

- Enemy (red)
- Barrel (orange)
- Power-up (blue)

Implementation may use three small Slot sub-buttons or one Slot button with a
three-option segmented control. Do not use round-robin clicking on the canvas.
Only slot type has a small rotate/cycle affordance if desired; block/platform
sizes never cycle.

### Existing-object selection and resize

- Hovering an existing block/platform highlights it and shows edge/corner
  handles appropriate to its shape.
- Blocks resize from edges/corners in whole grid units.
- Platforms resize only from left/right handles; their row remains fixed.
- The original object remains the authoritative state throughout the drag.
  Dragging creates a temporary candidate only.
- Pointer-up commits one atomic draft mutation when valid.
- Slots may be selected, moved to another cell, or have their type changed;
  they do not expose size handles.

### Erase/delete

- Erase tool click deletes the hovered object or slot.
- Delete/Backspace deletes the current selection.
- Deletion is one atomic draft mutation.

Every committed create/resize/move/delete calls the existing `markChanged()`
path, so localStorage draft, dirty dot, Save, and macro switching continue to
work unchanged.

---

## 14. Placement and Resize Validation UX

Validation runs continuously against the temporary candidate, but never mutates
the real draft until pointer-up succeeds.

### Valid candidate

- Normal tool color with translucent fill.
- Grid-snapped dimensions/coordinates visible near the pointer.
- Pointer-up commits the candidate as one operation.

### Invalid candidate

- Candidate turns translucent red with a clear invalid outline/red-X cue.
- Show the most useful shared-rule reason, such as:
  - `Outside playable bounds`
  - `Intrudes into entry/exit clearance`
  - `Requires 2 empty rows of block clearance`
  - `Platform cannot be placed at row 0`
  - `Platform requires an empty row below`
  - `Overlaps another block/platform`
  - `Slot requires a supporting surface`
  - `Surface must preserve 2 rows of top clearance`
- Pointer-up does not change the draft.

### Invalid resize rollback animation

For resize/move of an existing object:

1. Keep the original geometry unchanged in state during the drag.
2. Render only a temporary candidate over it.
3. If released invalid, animate/visually snap the candidate back to the
   original rectangle/position, then clear the candidate.
4. Do not call `markChanged()` and do not create a dirty state.

This makes failure explicit: the red shape was rejected and the original object
was preserved, rather than silently clipping or accepting partial geometry.

Validation must use the shared schema/model and layout rules. Editor code may
adapt data into a candidate layout for `validateLayout()` but must not duplicate
clearance/bounds formulas.

## 15. Zoom and Navigation

The central workspace behaves similarly to the Sprite Editor.

Required:

- Mouse-wheel zoom in/out.
- Pan around large macros.
- Grid remains aligned at every zoom.
- Objects scale visually according to unit dimensions.
- Hero/test rendering scales with the same transform.
- Fit-to-macro / reset zoom is desirable.

Logical coordinates never change because of zoom.

---

## 16. Draft vs Canonical Save Model

Edits should never be lost, but they should also not immediately overwrite canonical game data. **Same model as the sprite editor — no complex dirty/stale states: if localStorage draft == canonical data, the macro is clean; otherwise it's dirty (dot indicator).**

### Draft

Every editor modification automatically updates a draft in browser `localStorage`.

Draft data is recovery/session state.

### Canonical save

The Save button explicitly writes the macro JSON through the local server.

Save is disabled when canonical data and the current editor state are identical.

After modification:

- Dirty state becomes active.
- Save becomes enabled.
- Draft is continuously refreshed.

If the user switches macros with unsaved canonical changes:

- Save.
- Discard.
- Cancel.

On reload/crash, the editor can detect and offer the newer local draft.

LocalStorage must never be the only authoritative storage for gameplay data.

---

## 17. Procedural Macro Generator

The editor includes a **Generate** action.

"Generate" is preferable to "Shuffle" because the system creates a new pattern rather than merely rearranging existing objects.

Generation happens locally and deterministically in JavaScript.

An AI model is **not** invoked for every Generate click.

AI can be used during development to design and improve the generator algorithm, but runtime generation is normal game/tool code.

Generation should be fast enough to click repeatedly:

`Generate → inspect → Generate → inspect → keep → tweak → test → save`

---

## 18. Generator Parameters

Keep generation controls expressive but understandable.

Recommended inputs:

### Dimensions

- Target length for horizontal macros.
- Target height for vertical macros.

### Block density

Scale such as 0–10.

Controls how strongly solid blocks participate in the generated structure.

### Platform density

Scale 0–10.

Controls prevalence of one-way platforms.

### Slot density

Scale 0–10.

Controls how many legal spawn opportunities are proposed.

Potentially expose individual weighting later for enemy/power-up/barrel slots.

### Verticality

Controls how aggressively the path changes elevation.

Low:
- flatter traversal
- fewer elevation changes

High:
- stronger stairs
- climbs/drops
- more layered structures

### Difficulty

Influences generation within legal movement limits:

- Jump distances.
- Precision required.
- Frequency of elevation transitions.
- Recovery/safe surfaces.
- Complexity of alternate paths.

Difficulty must not make geometry physically impossible.

### Pattern/style

Potential presets:

- Mixed.
- Staircase.
- Islands.
- Zigzag.
- Platform-heavy.
- Block-heavy.
- Climb.
- Sparse.
- Dense.

These should be generator strategies/weights rather than separate hard-coded macro collections.

### Seed

Expose the random seed.

Same:

- generator version
- configuration
- parameters
- seed

should reproduce the same macro.

---

## 19. Generator Pipeline

Recommended generation pipeline:

1. Read shared level/game configuration.
2. Establish legal bounds.
3. Choose/generate a primary traversable route.
4. Place structural blocks/platforms around that route.
5. Apply style and density parameters.
6. Validate each placement using shared validation functions.
7. Add legal optional branches/variation.
8. Add candidate slots only on valid surfaces.
9. Run structural validation.
10. Run traversal/playability validation.
11. Reject/repair invalid sections.
12. Return macro plus seed and useful generation metadata.

The generator should construct playable topology rather than randomly scattering valid objects.

A collection of individually legal objects does not automatically make a good macro.

---

## 20. Generation and Human Editing

Generated content is never special after generation.

Once generated, it becomes ordinary editable macro data.

The intended workflow is:

1. Choose parameters.
2. Generate.
3. Rapidly regenerate until the structure is interesting.
4. Manually adjust blocks/platforms/slots.
5. Test.
6. Save as canonical macro.

This preserves procedural speed while allowing authored gameplay quality.

---

## 21. Test Mode

Testing occurs directly inside the Macro Editor using the real game systems.

Do not implement alternate editor physics.

When entering Test mode:

- Editing controls become locked/disabled.
- Macro geometry remains visible through the game renderer.
- Spawn the actual hero.
- Use the actual collision engine.
- Use actual movement/jump mechanics.
- Use the actual platform behavior.
- Keep the current unsaved editor state available for testing.

Provide two testing modes:

- Manual.
- Automatic.

Exit Test returns to the same editing state.

---

## 22. Manual Test

Manual Test gives control of the hero directly to the developer.

Use normal game inputs and mechanics.

The purpose is to answer the most important level-design question:

**Does this actually feel good to play?**

No separate approximation of movement should exist.

The editor can optionally expose useful debugging overlays already supported by the game:

- Collision boxes.
- Platform surfaces.
- Grid.
- Input display.
- Slow motion.
- Relevant movement/debug information.

---

## 23. Automatic Test / Ghost Runner

Automatic mode uses a deterministic traversal agent ("ghost") to attempt the macro.

This is not an online AI/LLM agent.

It is a local algorithm operating against actual movement capabilities.

Its job is to provide rapid automated evidence that a macro is traversable.

Potential approach:

1. Derive navigable surfaces/nodes from macro geometry.
2. Calculate candidate transitions using actual hero movement constraints.
3. Build a traversal graph.
4. Search for a route from macro entry to exit/goal.
5. Simulate or execute that route through the real movement/physics system.
6. Render the hero/ghost performing the route.
7. Report failures and unreachable sections.

The tester should understand at minimum:

- Running.
- Jump reach.
- Jump height.
- One-way platform behavior.
- Landing surfaces.
- Required clearance.
- Horizontal/vertical macro orientation.

It does not need to mimic human creativity. It needs to provide a deterministic playability check.

---

## 24. Static Validation vs Dynamic Validation

Keep two distinct validation layers.

### Static structural validation

Fast, immediate, used during editing/generation.

Examples:

- Bounds.
- Overlaps.
- Clearance.
- Platform ground restriction.
- Slot support.
- Legal dimensions.

### Dynamic traversal validation

Used for macro testing.

Examples:

- Can the hero reach the next surface?
- Is there a valid path from entry to exit?
- Does actual physics produce a valid landing?
- Are required jumps within hero capabilities?

Both should ultimately depend on shared game configuration.

---

## 25. Level Composer Relationship

The Macro Editor does not replace the level composer.

Responsibilities:

### Macro

Defines:

- Geometry.
- Platform/block topology.
- Candidate spawn slots.
- Difficulty/style metadata.

### Level composer

Defines:

- Which macros are selected.
- Macro ordering.
- Difficulty progression.
- Entry-clearance/empty-floor sections between macros.
- Enemy budget.
- Which enemy slots become populated.
- Which power-up slots become populated.
- Which barrel slots become populated.
- Global level pacing.

This separation must remain explicit.

---

## 26. Entry Clearance

Existing level composition includes empty space between macros.

These sections provide pacing and prevent every macro from visually/gameplay-wise colliding with the next.

The Macro Editor edits individual macros; the level composer remains responsible for inter-macro entry/exit clearance unless a future preview mode explicitly visualizes neighboring macro boundaries.

Macro validation should nevertheless understand entry and exit requirements so generated structures do not immediately block transitions.

---

## 27. Local Server

Use a lightweight local development server for tool operations.

Responsibilities may include:

- Serve Macro Editor.
- Serve game assets/modules.
- Load macro JSON.
- Save macro JSON.
- Delete/create macro files.
- Validate writes.
- Potentially launch/reference other development tools.

Do not build unnecessary backend infrastructure.

This is a local development tool.

---

## 28. Shared Tooling Direction

The Macro Editor and Sprite Editor should follow a common tooling philosophy:

- Browser-based editor.
- HTML controls.
- Canvas for visual content.
- Local server.
- Shared JSON schemas.
- LocalStorage drafts.
- Explicit canonical saves.
- Shared runtime modules.
- Tools launched from the game's Debug environment when useful.

This creates a coherent internal game-development suite rather than unrelated one-off utilities.

---

## 29. Implementation Priorities

Although the implementation can be completed as one coordinated build, keep internal architecture separated into modules:

- `macro-model`
- `macro-schema`
- `macro-validator`
- `macro-storage`
- `macro-renderer`
- `macro-editor-state`
- `macro-generator`
- `macro-test-runner`
- `macro-traversal`
- shared game configuration/imports

Exact filenames can follow the existing repository conventions.

The important requirement is separation of responsibilities, not these specific names.

---

## 30. Definition of Done

The Macro Editor is complete when the developer can:

1. Open it from the development workflow.
2. Browse all existing macros.
3. Create a horizontal or vertical macro.
4. Visually place blocks, platforms, and slots.
5. Be prevented from creating invalid structures.
6. Zoom/pan comfortably.
7. Generate new legal macro patterns from parameters.
8. Rapidly regenerate using different seeds.
9. Manually modify generated results.
10. Automatically retain every edit as a local draft.
11. Explicitly save canonical macro JSON.
12. Switch macros safely without accidental data loss.
13. Enter Manual Test and play the macro with the real hero.
14. Enter Automatic Test and watch/check automated traversal.
15. Return to editing immediately.
16. Have the game load exactly the same saved macro data.
17. Have the level composer use those macros and independently populate their slots.

The resulting workflow should be:

**Generate → Edit → Test → Tweak → Test → Save**

with almost no friction.
