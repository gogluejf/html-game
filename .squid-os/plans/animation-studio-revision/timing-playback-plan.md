# Animation Studio Revision — Items 1 & 2: Per-Frame Duration + Playback Mode

Scope: revision items §1 (per-frame duration) and §2 (playback mode) from
`animation-studio-revision.md`. Also includes the reusable confirm-dialog
behavior change requested for all reset actions.

---

## 1. Data Model Changes

### Per animation (`st`)

Add:

```js
playback: 'loop' | 'once'   // default 'loop'
```

### Per frame (`st.frames[i]`)

Add:

```js
durUnits: number   // positive integer, 1..N, default 1
```

Duration formula:

```
baseUnit  = 1000 / st.speed          // e.g. 6 fps → 166.67ms
frameMs   = baseUnit × durUnits      // integer multiple, always whole units
```

- `durUnits = 1`  → exactly one base unit (plain FPS timing, the default)
- `durUnits = 3`  → three base units (frame lingers 3× longer)
- Minimum: 1 (a frame cannot be shorter than one unit)
- Maximum: 10 (UI slider range; data model allows higher if typed)

A frame with `durUnits === 1` uses plain animation FPS — satisfies the
revision requirement that "a frame without an override uses the animation FPS".

### JSON export fields (when §12 lands)

```
frames[].duration_units   (integer ≥ 1, omit or 1 when default)
playback                  ("loop" | "once")
```

---

## 2. Side Panel — New "Timing" Section

Location: directly under the existing **Animation** section (name, frames,
speed). Above the **Frame** section.

Layout:

```
┌─ Timing ───────────────────────────────────────────────┐
│  ◉ Loop   ○ Once                                       │
│                                                        │
│  [thumb]  ──●─────────   ×1    167ms                   │  frame 1
│  [thumb]  ────────●────   ×3    500ms                  │  frame 2
│  [thumb]  ──●─────────   ×1    167ms                   │  frame 3
│  ...                                                  │
│                                                        │
│  Total: 834ms (5 units @ 6fps)       [Reset All]      │
└────────────────────────────────────────────────────────┘
```

Row contents (left → right):

| Cell | Content |
|------|---------|
| Thumbnail | 24×24 preview of the frame image (reuse loaded `imgs[i]`, drawn to small canvas or `<img>` with object-fit) |
| Slider | Range input, min 1, max 10, step 1, value = `durUnits`. Center tick mark at 1 (default position). |
| Multiplier | Read-only text: `×{durUnits}` |
| Duration | Read-only text: `{(baseUnit*durUnits).toFixed(0)}ms` |

Behavior:

- Slider drag updates `durUnits` live; multiplier + duration cells update
  immediately; total row recalculates.
- Double-click a row's slider (or its duration cell) resets that frame's
  `durUnits` to 1 (no confirm — single frame, low risk).
- Rows with `durUnits ≠ 1` get a subtle highlight (e.g. left border accent)
  so custom-timed frames are visually distinct.
- Table scrolls vertically if frame count exceeds ~8 visible rows.
- When speed (fps) changes, all duration cells + total recalculate (sliders
  keep their values; only the derived ms changes).

### Loop / Once toggle

Radio pair at the top of the Timing section. Bound to `st.playback`.
Persisted via existing `saveState()`.

Playback behavior:

- **Loop**: wraps from last frame back to first.
- **Once**: advances through frames; after the final frame elapses its
  duration, stops (playing = false, play button shows ▶). Pressing play
  again restarts from frame 0.

### Reset All button

Bottom-right of the Timing section. Sets every frame's `durUnits` to 1.
Triggers the **confirm dialog** (see §4). Label: `Reset All`.

---

## 3. Playback Tick — Unit-Based Accumulator

All timing math happens in **unit space**, not milliseconds. This guarantees
every frame boundary lands exactly on a whole-unit tick with zero
floating-point drift.

```
baseUnitMs = 1000 / st.speed
unitsPerMs = st.speed / 1000        // inverse, for accumulation

On each rAF:
  elapsed += (now - lastNow) * unitsPerMs
  while (elapsed >= currentFrame.durUnits):
      elapsed -= currentFrame.durUnits
      advanceToNextFrame()
```

Properties:

- Frame 1 at ×1, Frame 2 at ×3: the clock counts 1 unit, advances, then
  counts 3 units, advances. Always whole units. Never half a unit.
- Pausing freezes `elapsed` and `lastNow`.
- Resuming resets `lastNow = now` and continues accumulating.
- Frame stepping (◀/▶, arrows) sets `elapsed = 0` for the new frame.
- In "Once" mode, after the last frame's units elapse → stop.
- Speed change mid-playback: recalculate `unitsPerMs`; `elapsed` stays in
  units so no discontinuity.

No `setInterval`, no `setTimeout` chain. Single rAF loop (the editor already
runs one for drawing).

---

## 4. Reusable Confirm Dialog

Replace the current inline reset-menu "just do it" behavior with a modal
confirm for ALL destructive resets.

### UI

Centered modal overlay (dimmed backdrop). Contents:

```
┌────────────────────────────────────────┐
│  ⚠  Confirm Reset                      │
│                                        │
│  <message varies by action>            │
│                                        │
│         [ Cancel ]    [ Yes, Reset ]   │
└────────────────────────────────────────┘
```

- **Esc** closes (equivalent to Cancel).
- **Enter** triggers Yes.
- Clicking backdrop closes (Cancel).
- Focus moves into the dialog on open; returns to trigger on close.
- Single instance, reusable — no stacking.

### Call sites

| Action | Message |
|--------|---------|
| Timing table → Reset All | "Reset per-frame timing for all N frames?" |
| RESET menu → Reset Frame | "Reset current frame (offset, scale, boxes, markers)?" |
| RESET menu → Reset Animation | "Reset all frames and animation-level settings for this entity?" |
| RESET menu → Reset to Factory… | "Restore factory defaults for ALL entities? This cannot be undone." |

All four use the same dialog component with different message strings.
The existing `pushUndo()` still fires on confirmed resets, so Ctrl+Z remains
available as a safety net.

### Implementation

One function:

```js
function confirmDialog(message, onYes) { /* show, wire esc/enter/backdrop */ }
```

Called from each reset site. No new DOM added at page load — the dialog
element is created once (hidden) and reused.

---

## 5. State Persistence

Both new fields flow through the existing `collectState()` / `loadState()`
pipeline automatically since they live inside `st` and `st.frames[i]`.

Migration: on `loadState`, any frame missing `durUnits` gets `1`; any `st`
missing `playback` gets `'loop'`. No breaking change for saved states.

---

## 6. What Does NOT Change

- Collision box stays per-animation.
- Pivot stays per-animation.
- Sprite crop stays per-frame, read-only.
- Offset/scale stay per-frame, unchanged.
- Melee box logic untouched (that's item §3, separate work).
- Filmstrip drawer: may optionally show a small timing indicator per frame
  cell later; not required for this pass.
- No gameplay parameters anywhere.

---

## 7. Validation Checklist

1. Open editor, select an entity. Timing section visible under Animation.
2. Set speed to 6 fps. Verify all rows show ×1 / 167ms.
3. Drag frame 2 slider to 3. Row shows ×3 / 500ms. Total updates to
   (1+3+1+…)×167ms. Highlight visible on frame 2.
4. Drag frame 3 slider to 5. Row shows ×5 / 833ms.
5. Double-click frame 2 slider. Returns to ×1 / 167ms.
6. Switch to Once mode. Play. Animation stops at last frame after its
   duration elapses. Play again → restarts from frame 0.
7. Switch back to Loop. Play. Wraps continuously.
8. Change speed to 12 fps while sliders have non-zero values. All ms values
   halve; slider positions (unit counts) unchanged.
9. Click Reset All. Confirm dialog appears with correct message. Esc closes,
   nothing changed. Click again, press Yes — all sliders at 1, all ms = base.
10. Undo (Ctrl+Z) restores pre-reset slider values.
11. Switch entities, come back — timing edits + playback mode preserved.
12. Reload page — same.
13. Reset Frame / Reset Animation / Reset to Factory each show the confirm
    dialog with their respective messages.
14. Screenshot evidence of: Timing section populated, Once-mode stopped state,
    confirm dialog open.

---

## 8. File Touch List

| File | Change |
|------|--------|
| `templates/editor-template.html` | Main work: data model, Timing section HTML/CSS/JS, unit-based playback tick, confirm dialog |
| `scripts/render_editor.py` | None (manifest shape unchanged) |
| Generated `editor-*.html` | Rerun script after template changes |

Single-file edit in practice (~200–300 lines added/modified in the template).
