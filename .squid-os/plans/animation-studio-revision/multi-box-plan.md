# Animation Studio Revision — Item 3: Multi-Box Collection

Scope: revision items §3 (multi-box), §4 (box types/labels), §7 (marker types),
§8 (collections) from `animation-studio-revision.md`. Replaces the current
single per-frame melee box with a typed collection.

---

## 1. Data Model

### Per frame (`st.frames[i]`)

Replace:

```js
melee: { on:false, x:0, y:0, w:0, h:0 }
```

With:

```js
boxes: [
  { label: "attack",    x: 12, y: -40, w: 30, h: 36 },
  { label: "attack_2",  x: 50, y: -60, w: 24, h: 28 },
  { label: "sword_tip", x: 90, y: -70, w: 12, h: 12 }
]
```

Each box: `{ label: string, x, y, w, h }` — all in sprite-space pixels.

### Migration (backward-compatible)

On `loadState`, for each frame:

```js
if (f.melee && !f.boxes){
  f.boxes = f.melee.on
    ? [{ label: "attack", x: f.melee.x, y: f.melee.y, w: f.melee.w, h: f.melee.h }]
    : [];
  delete f.melee;
}
if (!f.boxes) f.boxes = [];
```

Old saves with `melee.on = true` get one box labeled "attack". Old saves with
`melee.on = false` get an empty array. No data loss.

### JSON export field (when §12 lands)

```
frames[].boxes[]
    label   (string)
    x, y, w, h  (numbers, sprite-space px)
```

---

## 2. Default Position (Cascade)

When adding a new box to a frame:

- **First box** (empty collection): uses the old melee default position
  (25% collision width, right of collision with 3px gap, same height).
- **Subsequent boxes**: offset from the previous highest-index box by
  **+20x, -20y** (right and up in sprite-space, since +y is down).

```js
function nextBoxPosition(st, fi){
  const boxes = st.frames[fi].boxes;
  if (boxes.length === 0){
    // old melee default
    const c = st.collision;
    const w = Math.max(1, Math.round(c.w * 0.25));
    const h = c.h;
    return { x: c.x + c.w + 3, y: c.y, w, h };
  }
  const last = boxes[boxes.length - 1];
  return { x: last.x + 20, y: last.y - 20, w: last.w, h: last.h };
}
```

The cascade index is simply `boxes.length` at time of add. Deleting a box
does NOT renumber or shift positions of remaining boxes. Add after delete
still cascades from the last existing box's position.

---

## 3. Label Naming

- Default label on create: `"attack"`, then `"attack_2"`, `"attack_3"`, etc.
- Algorithm: find the lowest integer N ≥ 1 such that `"attack"` (N=1) or
  `"attack_N"` (N≥2) does not already exist in **this frame's** collection.
- On rename (typing in the panel label input):
  - If the new label already exists in this frame → **block** (don't apply,
    flash the input border red briefly).
  - Empty label → block (revert to previous).
  - Duplicates across different frames are allowed (frame 1 can have two
    "attack" boxes as long as they're in different frames).

---

## 4. Canvas Rendering

### When visible

Boxes render when `show.meleeView` is true AND the editor is paused
(`!editingLocked()`). During playback, all box overlays are hidden (same as
today's melee behavior).

### Style

- Same color as today's melee: `COL_MELEE` (`#ff9d2e`)
- 8-handle resize gizmo (same as collision/melee today)
- Body drag moves the box
- Shift+corner keeps aspect ratio
- **Label text** drawn above the box (centered, 11px, same color as box
  stroke). Always visible when the box is visible. Hidden during playback.

### Hover highlight (from panel)

When the user hovers a row in the panel's Melee Boxes section, OR has focus
in that row's label/coord inputs:

- That specific box renders **solid fill** (full opacity, no grid/dashed
  pattern) instead of the normal translucent outline.
- Works even when `show.meleeView` is off — it's a pure indicator.
- On mouseout / blur → back to normal rendering.

This lets the user identify which box they're editing without toggling view.

### Hit-testing

Same priority as today: pivot > sprite > collision > boxes (front-to-back by
z-order, last-touched wins). Multiple boxes in the same frame: topmost in
z-order gets the hit. `bringToFront` applies per-box.

---

## 5. All-Frames Propagation

The existing rigid-body logic (`scaleAllAbout`, collision move delta, sprite
move delta) must extend to `boxes[]`:

- **Sprite move (all-frames):** every box in every frame shifts by the same
  delta (same as melee today).
- **Collision move (all-frames):** same.
- **Scale (all-frames):** every box scales about the shared center, same as
  melee today. Each box's x/y/w/h transform identically.
- **Direct box edit (all-frames):** when you move/resize box at index `i`
  in the current frame, the same delta/ratio applies to box at index `i` in
  every other frame. Frames with fewer boxes (index doesn't exist) are
  skipped. No auto-creation.

Implementation: replace every `f.melee` reference in the propagation math
with a loop over `f.boxes`.

---

## 6. Side Panel — Melee Boxes Section

Replaces the old single "Melee Box" section entirely. Remove:
- `p_mon` checkbox
- `p_mx`, `p_my`, `p_mw`, `p_mh` inputs
- `tglMeleeOn` toolbar button (replaced by `[+ BOX]`)

New section (collapsible, like all others):

```
┌─ Melee Boxes [▾] ─────────────────────────── [+ Add] ┐
│  attack                        [×]                   │
│  X[___] Y[___] W[___] H[___]                         │
│  ─────────────────────────────────────────────────── │
│  attack_2                      [×]                   │
│  X[___] Y[___] W[___] H[___]                         │
│  ─────────────────────────────────────────────────── │
│  sword_tip                     [×]                   │
│  X[___] Y[___] W[___] H[___]                         │
└──────────────────────────────────────────────────────┘
```

### Row structure (two lines per box)

Line 1: `<input type="text" class="box-label">` + `<button class="box-del">×</button>`
Line 2: four `<input type="number">` for X, Y, W, H

### Behavior

- **Hover row** → highlights that box solid on canvas (see §4).
- **Focus label input** → same highlight. Typing live-updates the label on
  canvas. Duplicate check on `change` (not per keystroke).
- **Focus coord input** → same highlight. Typing updates the box, canvas
  reflects immediately.
- **Drag box on canvas** → the corresponding row's inputs update live
  (same as today's melee panel sync).
- **[×] Delete** → removes the box from the array. Pushes undo. No confirm
  dialog (undo is the safety net).
- **[+ Add]** → appends a new box at the cascade position with the next
  available label. Pushes undo. Scrolls the new row into view.

### Toolbar

Add a `[+ BOX]` button in the toolbar (near the old MELEE ON position).
Calls the same add function. Small, same style as other toolbar buttons.

The old `tglMeleeView` (show/hide melee boxes) stays — it now controls
visibility of ALL boxes in the collection.

---

## 7. Collapsible Sections

Every `<h2>` section in the side panel becomes collapsible:

- Click the `<h2>` to toggle its content (the rows/inputs below it).
- Visual indicator: `▾` (expanded) / `▸` (collapsed) before the title text.
- Content hides via `display:none` on the wrapper div.
- **State persisted in localStorage** under `view.collapsed: { sectionId: bool }`.
- Default: all expanded.
- Sections affected: Sprite Frame, Melee Boxes, Rotation, Pivot Point,
  Collision Box, Timing.

Implementation: wrap each section's content in a `<div class="section-body">`.
The `<h2>` gets a click handler. State stored alongside `show`, `bgColor`,
etc. in the existing `collectState`/`loadState` pipeline.

---

## 8. Undo/Redo

All box operations push undo:
- Add box
- Delete box
- Move box (drag start)
- Resize box (drag start)
- Rename label (on change/blur)
- Edit coords via panel (on change)
- Reset All (timing) — already done

One snapshot per interaction (not per tick during drag). Same pattern as
the timing slider fix.

---

## 9. What Does NOT Change

- Collision box: still per-animation, single, cyan.
- Pivot: still per-animation, single point.
- Sprite crop/offset/scale: unchanged.
- Timing section: unchanged.
- Playback mode: unchanged.
- Filmstrip: may show box outlines per frame cell later; not required now.
- No gameplay parameters on boxes. Label is a string, nothing else.

---

## 10. Validation Checklist

1. Open editor. Old melee box (if any) migrated to `boxes[0]` labeled "attack".
2. Click `[+ BOX]` in toolbar. New box appears offset +20/-20 from last.
   Labeled "attack_2". Panel shows new row.
3. Click `[+ Add]` in panel header. Same behavior.
4. Add 3 boxes. Cascade positions visible, no overlap.
5. Drag box #2 on canvas. Its panel row updates live. Other rows untouched.
6. Type in box #1's X input. Canvas box moves. Highlight solid while focused.
7. Hover box #3's row in panel. Box #3 renders solid on canvas (even with
   melee view off). Mouseout → back to normal.
8. Rename box #2 to "sword_tip". Canvas label updates. Try renaming box #3
   to "sword_tip" too → blocked, input flashes red.
9. Delete box #2. Undo (Ctrl+Z). Box #2 restored with same label/position.
10. Enable All Frames mode. Move box #1. All frames' box #1 shifts by same
    delta. Scale sprite → all boxes scale about shared center.
11. Play animation. Boxes hidden. Pause. Boxes visible with labels.
12. Collapse "Sprite Frame" section. Expand "Melee Boxes". Refresh page.
    Collapse state preserved.
13. Switch entities, come back. Boxes intact.
14. Reload page. Boxes intact. Old save with `melee.on=true` migrates cleanly.
15. Screenshot: panel with 3 boxes, canvas showing labels, one highlighted.

---

## 11. File Touch List

| File | Change |
|------|--------|
| `templates/editor-template.html` | Main work: data model migration, canvas rendering, panel section, toolbar button, collapsible sections, all-frames propagation |
| `scripts/render_editor.py` | None |
| Generated `editor-*.html` | Rerun script |

Estimated: ~300–400 lines changed/added in the template.
