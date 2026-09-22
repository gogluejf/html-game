# Animation Studio Revision — Item 5: Point Markers (+ Radius)

Scope: revision items §5 (point markers), §6 (radius markers), §7 (types/labels)
from `animation-studio-revision.md`. Adds named spatial points per animation,
with optional radius circles.

---

## 1. Data Model

### Per animation (`st`) — NOT per frame

Add:

```js
markers: [
  { label: "projectile-origin", x: 50, y: -30, radiusOn: false, radius: 0 },
  { label: "ground-impact",     x: 20, y: 0,   radiusOn: true,  radius: 40 }
]
```

Each marker: `{ label: string, x, y, radiusOn: boolean, radius: number }`
All in sprite-space pixels. Same space as collision/pivot/boxes.

### Migration

No migration needed — new field. On `loadState`, if `st.markers` is undefined,
set to `[]`. Old saves load fine.

### JSON export field (when §12 lands)

```
markers[]
    label       (string)
    x, y        (numbers, sprite-space px)
    radius_on   (boolean)
    radius      (number, px, only meaningful when radius_on is true)
```

---

## 2. Default Position (Cascade)

When adding a new marker:

- **First marker** (empty collection): placed at the pivot point.
- **Subsequent markers**: offset from the previous highest-index marker by
  **+20x, -20y** (right and up).

```js
function nextMarkerPosition(st){
  const markers = st.markers;
  if (markers.length === 0){
    return { x: st.pivot.x, y: st.pivot.y };
  }
  const last = markers[markers.length - 1];
  return { x: last.x + 20, y: last.y - 20 };
}
```

### Label naming

Same logic as hit boxes: `"marker"`, `"marker_2"`, `"marker_3"`, etc.
Lowest available N. Duplicate labels within the same animation are blocked
(same red-flash behavior as hit box rename).

---

## 3. Canvas Rendering

### When visible

Markers render when `show.markerView` is true. They show during BOTH paused
and playing states (they're spatial reference points, not editing tools).

### Style

- **Dot:** 8px screen-radius filled circle, color `COL_MARKER` (`#ff5a5a` red).
  White 2px border for contrast. Same visual weight as the pivot dot but red.
- **Radius circle** (when `radiusOn` is true): dashed circle, same red color,
  1.5px line width, centered on the dot. No fill.
- **Label text:** drawn above the dot (or above the radius circle if radius is
  on). 11px, same red color. Always visible when markers are shown.

### During playback

Markers remain visible (unlike hit boxes which hide handles). They just show
the dot + optional circle + label. No selection handles.

### Selection highlight

When a marker is selected (clicked):
- Dot gets a larger white ring (12px radius outline)
- Radius circle becomes solid (not dashed) if present
- Same visual language as hit box selection

### Hit-testing

Marker dots are hit-tested with a ~12 screen-px tolerance (same as pivot).
They take priority over boxes/collision/sprite (small target, drawn on top).
Only one marker can be selected at a time.

---

## 4. Movement & Propagation

### Moving a marker (drag or arrows)

- ONLY the marker moves. The rest of the body (sprite, collision, boxes,
  other markers, pivot) does NOT follow.
- Same behavior as moving the pivot point today.
- Arrow keys nudge ±1px (Ctrl+arrows ±10px).
- Works in all-frames mode and normal mode (markers are per-animation,
  there's no "per-frame" variant).

### Body movement carrying markers

When you move/scale the body (sprite, collision, or hit box drag in
all-frames mode), markers ARE carried along:

- **`shiftAll(dx, dy)`** → all markers shift by (dx, dy)
- **`scaleAllAbout(st, before, rx, ry)`** → all markers scale about center
  (position scales, radius scales)

Markers snap to the body. They don't cause the body to move.

### Implementation

Add markers to `shiftAll`:

```js
function shiftAll(dx, dy){
  // ... existing frames/collision/boxes/pivot ...
  for (const m of st.markers){ m.x += dx; m.y += dy; }
}
```

Add markers to `scaleAllAbout`:

```js
// markers: scale position + radius about center
for (const m of st.markers){
  m.x = Math.round(C.cx + (beforeMarkers[idx].x - C.cx) * rx);
  m.y = Math.round(C.cy + (beforeMarkers[idx].y - C.cy) * ry);
  if (m.radiusOn) m.radius = Math.max(1, Math.round(beforeMarkers[idx].radius * rx));
}
```

The `before` state in pointerdown must include a `markers` snapshot.

---

## 5. Side Panel — Markers Section

New collapsible section (between Collision Box and Timing, or after Hit Boxes):

```
┌─ Markers [▾] ───────────────────────────── [+ Add] ┐
│  [●] projectile_origin       [○] [×]               │
│  X[___] Y[___] R[___]                             │
│  ───────────────────────────────────────────────── │
│  [●] ground_impact           [●] [×]               │
│  X[___] Y[___] R[___]                             │
└────────────────────────────────────────────────────┘
```

### Row structure (two lines per marker)

Line 1: red dot indicator + label input + radius toggle button (○ off / ● on) + delete [×]
Line 2: X, Y, R number inputs (R disabled/dimmed when radius is off)

### Behavior

- **Hover row** → highlights that marker on canvas (solid ring, works even
  with marker view off).
- **Focus label/coord input** → same highlight.
- **Radius toggle button:** click to switch `radiusOn`. When turned on with
  radius=0, defaults to 30px. R input enables/disables with the toggle.
- **[×] Delete** → removes marker. Pushes undo.
- **[+ Add]** → appends new marker at cascade position with next available
  label. Pushes undo. Auto-enables marker view.
- **Duplicate label** → blocked (red flash), same as hit boxes.
- **Whole row is one hover zone** (same as hit box rows).

### Toolbar

- `[+ MARKER]` button (next to [+ BOX])
- `MARKERS` view toggle button (show/hide all markers)
- Keyboard shortcut: **Shift+M** toggles marker view
- **Ctrl+H** now toggles hit box view (was Shift+M)

---

## 6. Filmstrip

Markers appear in the filmstrip as small red dots (3px radius) at their
scaled position. If radius is on, a small dashed circle too. No label text
in the filmstrip (too small). They appear on every frame cell (since they're
per-animation, same position in each cell).

---

## 7. Playback

Markers are visible during playback (dots + circles + labels). No selection
handles shown while playing. They serve as spatial reference while watching
the animation.

---

## 8. Undo/Redo

All marker operations push undo:
- Add marker
- Delete marker
- Move marker (drag start / first arrow nudge)
- Rename label (on change/blur)
- Edit coords via panel (on change)
- Toggle radius on/off
- Change radius value

Same pattern as hit boxes: one snapshot per interaction.

---

## 9. What Does NOT Change

- Hit boxes: still per-frame, still cause body movement when dragged.
- Collision: still per-animation, single.
- Pivot: still per-animation, single point, yellow.
- Markers do NOT cause body movement when dragged (unlike hit boxes).
- Markers DO get carried by body movement (shiftAll/scaleAllAbout).
- No gameplay parameters on markers. Just label + position + optional radius.

---

## 10. Shortcut Changes

| Key | Was | Now |
|-----|-----|-----|
| Shift+M | Toggle melee/hit box view | Toggle **marker** view |
| Ctrl+H | Hide all overlays | Toggle **hit box** view |
| Ctrl+H (double-press) | Restore overlays | Unchanged (still hides/restores all) |

Wait — Ctrl+H is already "hide all overlays." Let me reconsider:

| Key | Action |
|-----|--------|
| Shift+M | Toggle hit box view (unchanged from current) |
| Shift+N | Toggle marker view (new) |
| Ctrl+H | Hide/restore ALL overlays (unchanged) |

Actually re-reading the user's request: "fix also the shortcut for melee view it must become ctrl+h". So:

| Key | Action |
|-----|--------|
| **Ctrl+H** | Toggle hit box view (moved from Shift+M) |
| **Shift+M** | Toggle marker view (new, freed up) |
| **Ctrl+Shift+H** | Hide/restore ALL overlays (moved from Ctrl+H to avoid conflict) |

---

## 11. Validation Checklist

1. Open editor. No markers by default. `[+ MARKER]` button visible in toolbar.
2. Click `[+ MARKER]`. Red dot appears at pivot. Panel shows new row labeled
   "marker". Marker view auto-enabled.
3. Add 3 markers. Cascade positions visible. Labels: marker, marker_2, marker_3.
4. Drag marker #2. Only that marker moves. Sprite/collision/boxes/pivot stay.
5. Enable all-frames mode. Drag sprite. All markers shift with the body.
6. Scale sprite (all-frames). Markers scale about center. Radii scale too.
7. Select marker #1 (click). Solid ring highlight. Arrow keys nudge ±1px.
8. Delete key removes selected marker. Undo restores it.
9. Toggle radius on for marker #2. Dashed circle appears. R input enables.
10. Set radius to 60. Circle grows. Scale body → radius scales proportionally.
11. Rename marker to "explosion". Try renaming another to "explosion" → blocked.
12. Play animation. Markers visible (dots + circles + labels), no handles.
13. Open filmstrip. Red dots visible on each frame cell.
14. Collapse Markers section. Refresh. State preserved.
15. Switch entities. Markers per-entity preserved.
16. Ctrl+H toggles hit box view. Shift+M toggles marker view.
17. Screenshot: panel with 2 markers (one with radius), canvas showing dots.

---

## 12. File Touch List

| File | Change |
|------|--------|
| `templates/editor-template.html` | Main work: data model, canvas rendering, panel section, toolbar buttons, shiftAll/scaleAllAbout extension, filmstrip, shortcuts |
| `scripts/render_editor.py` | None |
| Generated `editor-*.html` | Rerun script |

Estimated: ~250–350 lines added in the template.
