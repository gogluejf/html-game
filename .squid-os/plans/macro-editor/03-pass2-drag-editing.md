# Macro Editor — Pass 2 Handoff: Drag Editing

## Goal

Turn the completed viewer/draft editor into a visual geometry editor using
click-drag-release creation and handle-based resize. Do not reintroduce the old
1→2→3 size cycling; dimensions are positive whole units bounded by final
placement rules.

## Already complete — preserve these contracts

- Canonical data: `macros/levels/<id>.json`.
- Formal schema: `macros/macro.schema.json`.
- Shared schema validator: `js/world/macroSchema.js`.
- Shared geometry/playability validator: `validateLayout()` in
  `js/world/macros.js`.
- Blocks: `{ kind:'block', x, y, width, height }`.
- Platforms: `{ kind:'platform', x, y, width }`.
- Slots: `{ slot, type, x, y }`, type is enemy/barrel/powerup.
- Drafts auto-save per macro; switching macros is safe without a dialog.
- `markChanged()` is the only mutation-finalization path.
- Game/editor share 72×48 units, zone dimensions, clearance, and bounds.

## Interaction model

### Tool mode

Exactly one of:

- `none` — hover/select/resize existing objects.
- `block` — drag-create block rectangle.
- `platform` — horizontal drag-create one-row platform.
- `slot-enemy`
- `slot-barrel`
- `slot-powerup`
- `erase`

Creation tools are mutually exclusive. Existing geometry remains hoverable and
resizable in `none`; optionally allow resizing regardless of active creation
tool when the pointer is directly on a resize handle.

### Pointer state machine

Use one pointer controller with explicit states:

- `idle`
- `creating-block`
- `creating-platform`
- `moving-object`
- `resizing-block`
- `resizing-platform`
- `moving-slot`
- `rollback`

Capture the pointer on pointer-down and release/cancel cleanly.

### Temporary candidate

Keep interaction state outside the macro draft:

```js
{
  mode,
  targetKind,
  targetIndex,
  handle,
  anchorCell,
  currentCell,
  original,
  candidate,
  valid,
  reason
}
```

Never mutate `app.cur.st` during pointer movement. On valid pointer-up, clone the
relevant array once, apply the candidate, assign it, and call `markChanged()`.
On invalid pointer-up, preserve state and show rollback/snap-back feedback.

## Suggested modules

- `js/tools.js`
  - active tool state
  - toolbar button synchronization
  - slot subtype selection
- `js/pointer.js`
  - hit testing
  - pointer state machine
  - grid snapping
  - create/move/resize candidate generation
- `js/validation.js`
  - clone current macro
  - substitute/add candidate
  - schema validation via `macroSchemaErrors()`
  - build a preview layout and call shared `validateLayout()`
  - return `{ valid, reason }`
- `js/draw.js`
  - draw hover target
  - draw selection/handles
  - draw candidate valid/invalid overlay
  - draw rollback animation

Do not put interaction logic directly into `draw.js`.

## Geometry rules

### Block

- Drag rectangle normalizes all directions.
- Minimum `1×1`.
- Positive integer width/height.
- Horizontal final x-range must stay outside entry/exit clearance.
- Horizontal top surface ≤ row 8.
- Vertical right edge ≤ column 13.
- Existing block rectangle overlap forbidden; touching is legal.
- Existing block vertical-gap rule remains 0 or ≥2 empty rows.

### Platform

- Horizontal drag only; minimum width 1.
- `y >= 1`.
- Horizontal/vertical bounds same as blocks.
- Same-row platform overlap forbidden; touching should preferably merge into one
  platform rectangle on commit.
- Platform clearance and top-clearance rules remain shared validator behavior.

### Slot

- Explicit subtype controls: enemy, barrel, power-up.
- No round-robin geometry interaction.
- Snap to one grid cell.
- Duplicate slot coordinate forbidden.
- Enemy/barrel must not be inside block geometry and should use the shared
  support-surface rule.
- Slot names must be generated uniquely and deterministically within the macro,
  e.g. `enemy-1`, `barrel-2`, `powerup-1`; preserve names when moving/type-changing
  unless collision requires regeneration.

## Validation adapter

`validateLayout()` consumes placed layout units with AABBs, while the editor
edits macro-local descriptors. Add one small adapter:

1. Clone macro data with candidate applied.
2. Validate schema.
3. Convert each unit to a preview unit:
   - block AABB `{x,y,w:width,h:height}`
   - platform AABB `{x,y,w:width,h:1}`
4. For horizontal preview, offset x by `H_ENTRY_CLEAR`, set total width to the
   horizontal zone budget, and apply entry/exit clear values.
5. For vertical preview, retain local x, set fixed total width 13 and relevant
   vertical height/clear values.
6. Call `validateLayout()` and map its thrown message to UI reason text.

If `validateLayout()` is too composition-specific for isolated vertical macros,
extract pure shared candidate rules from it rather than duplicating formulas in
the editor.

## Visual behavior

- Hover: cyan/white outline.
- Selected: stronger outline + resize handles.
- Valid candidate: tool color, 30–40% fill.
- Warning candidate: amber fill/outline; commit is allowed. Warnings are
  physics-derived traversal guidance, not structural rejection.
- Invalid candidate: red fill/outline + red X.
- Show `x, y, w, h` or `x, y, w` while dragging.
- Invalid existing-object resize: 120–180ms ease-out snap-back to original.
- Invalid new-object creation: short red rejection flash; nothing added.

## Task order

1. Add tool buttons and active-tool state.
2. Add world↔grid conversion and hit tests.
3. Add candidate-only pointer state machine.
4. Add validation adapter and reason mapping.
5. Implement block drag-create.
6. Implement platform drag-create.
7. Implement hover/select and resize handles.
8. Implement invalid red preview + rollback.
9. Implement explicit slot subtype placement/move/type change.
10. Implement erase and Delete/Backspace.
11. Add tests and browser verification.

## Acceptance checklist

- [ ] Dragging empty grid with Block creates the exact normalized rectangle.
- [ ] Clicking with Block creates `1×1`.
- [ ] Dragging Platform creates arbitrary legal width.
- [ ] Only one creation tool is active.
- [ ] Hovering existing geometry exposes correct handles.
- [ ] Block edges/corners resize in whole units.
- [ ] Platform only resizes left/right.
- [ ] Valid release commits once and marks draft dirty.
- [ ] Invalid release never mutates draft.
- [ ] Invalid resize visibly snaps back to original.
- [ ] Entry/exit, vertical width, top clearance, overlap, and gap rules display
      rejection feedback.
- [ ] Enemy/barrel/power-up slots have explicit controls and colors.
- [ ] Erase and Delete/Backspace work.
- [ ] Switching macros preserves each draft.
- [ ] Save schema validation and server validation still pass.
- [ ] Existing viewer, zoom/pan/FIT, labels, zones, and slots still render.
- [ ] All tests pass except explicitly documented unrelated pre-existing failures.

## Out of scope for Pass 2

- Procedural Generate.
- Manual hero test mode.
- Ghost runner.
- New/delete macro files (can follow after editing primitives).
