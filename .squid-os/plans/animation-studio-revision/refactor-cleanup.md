# Animation Studio — Code Cleanup / Refactor Plan

Not a feature plan. This is technical debt to pay down before or during the
next feature additions (JSON export, any future marker types).

---

## 1. Generic Collection List Builder

**Problem:** `buildMeleeBoxList()` and `buildMarkerList()` are ~90% identical.
Both create rows with: label input, action buttons, coord inputs, whole-row
hover highlight, duplicate check, delete handler.

**Fix:** Extract one function:

```js
function buildCollectionList(opts) {
  // opts: {
  //   containerId: 'meleeBoxList' | 'markerList',
  //   items: array,
  //   getKey: (item, idx) => 'box_2' | 'marker_1',
  //   fields: [{id:'x', label:'X'}, ...],
  //   extraLine1: (item, idx, row) => void,  // e.g. radius toggle button
  //   onDelete: (idx) => void,
  //   onLabelChange: (item, idx, newLabel) => void,
  //   allowDuplicate: false
  // }
}
```

Both callers become ~15 lines of config. Any future collection (points, radii
if they become per-frame) plugs in without copy-paste.

**Effort:** ~1hr. Low risk (pure UI refactor, no logic change).

---

## 2. Pointerdown Handler — Strategy Pattern

**Problem:** The canvas pointerdown is a growing if-chain:

```
marker radius handle → marker dot → pivot → box (sprite/collision/box_N) → pan
```

Each branch sets up a different `drag` object shape. Adding more element types
makes this harder to follow.

**Fix:** Array of hit-test strategies, first match wins:

```js
const DRAG_STRATEGIES = [
  { test: hitMarkerRadiusHandle, start: startMarkerRadiusDrag },
  { test: hitMarker,             start: startMarkerDrag },
  { test: hitPivot,              start: startPivotDrag },
  { test: hitBox,                start: startBoxDrag },
  { test: () => true,            start: startPanDrag },   // fallback
];
```

Each `start` function returns the `drag` object. The pointermove handler
dispatches via `drag.key` as it does now (or via a `drag.update(sx,sy)` method).

**Effort:** ~1.5hr. Medium risk (touching the core interaction path). Do after
all features are stable.

---

## 3. syncPanel — Data-Driven Field Binding

**Problem:** `syncPanel()` manually sets 20+ individual `.value` / `.textContent`
calls. Adding a new field means editing this function.

**Fix:** Define a binding map:

```js
const PANEL_BINDINGS = [
  { id: 'p_fidx',    get: st => (curFrameIdx()+1)+' / '+st.frames.length },
  { id: 'p_speed',   get: st => st.speed },
  { id: 'p_ox',      get: st => st.frames[curFrameIdx()].offset.x },
  // ...
];
function syncPanel(){
  for (const b of PANEL_BINDINGS){
    const el = P(b.id);
    if ('value' in el) el.value = b.get(cur.st);
    else el.textContent = b.get(cur.st);
  }
  // then: buildMeleeBoxList(), buildMarkerList(), buildTimingTable(), etc.
}
```

**Effort:** ~30min. Low risk.

---

## 4. `before` State Schema

**Problem:** The `before` snapshot object built in pointerdown has an implicit
shape: `{ frames: [{ox,oy,sx,sy,bx[]}], col, pivot, markers }`. Every consumer
(`scaleAllAbout`, BOX resize handlers) reaches into it by convention. No
validation, no documentation beyond comments.

**Fix:** Add a single factory function with a JSDoc typedef:

```js
/**
 * @typedef {Object} BeforeState
 * @property {Array<{ox:number,oy:number,sx:number,sy:number,bx:Array}>} frames
 * @property {{x:number,y:number,w:number,h:number}} col
 * @property {{x:number,y:number}|null} pivot
 * @property {Array<{label:string,x:number,y:number,radiusOn:boolean,radius:number}>} markers
 */
function snapshotBefore(st) { /* ... */ }
```

All pointerdown code calls `snapshotBefore(st)` instead of building inline.
One place to update the shape if we add fields.

**Effort:** ~20min. Zero risk (rename + extract).

---

## 5. Filmstrip Rendering Deduplication

**Problem:** `drawFilm()` re-implements box drawing, marker dots, collision
rects — logic that also exists in the main `draw()`. If we change how boxes
render (e.g. add labels to filmstrip), we edit two places.

**Fix:** Extract small helpers:

```js
function drawCollisionRect(ctx, rect, scale, ox, oy) { ... }
function drawBoxes(ctx, boxes, scale, ox, oy) { ... }
function drawMarkers(ctx, markers, scale, ox, oy) { ... }
```

Both `draw()` and `drawFilm()` call the same helpers with their own transform
context. Not pixel-identical (filmstrip is smaller, no handles) but the core
"stroke a rect at these coords" logic is shared.

**Effort:** ~1hr. Low risk (visual output must stay identical — verify with
screenshots).

---

## 6. Keyboard Handler — Route Table

**Problem:** One 80-line keydown handler with nested ifs, early returns, and
special cases. Hard to find "what does Ctrl+Shift+H do?" without reading
the whole block.

**Fix:** Top-level route table:

```js
const KEY_ROUTES = [
  { match: (e) => e.ctrlKey && e.shiftKey && e.code==='KeyH', action: hideAllToggle },
  { match: (e) => e.ctrlKey && e.code==='KeyZ',              action: doUndo },
  { match: (e) => !e.ctrlKey && !e.shiftKey && e.code==='KeyS', action: selectSprite },
  { match: (e) => !e.ctrlKey && !e.shiftKey && e.code==='KeyH', action: cycleHitBox },
  // ...
];
// Fallback: arrow keys, space, digits
```

Each action is a named function. Easy to grep, easy to add, easy to remove.

**Effort:** ~45min. Low risk (behavior unchanged, just reorganized).

---

## 7. CSS Class Naming

**Problem:** Mixed conventions. `.mb-row` (melee box), `.trow` (timing row),
`.fcell` (film cell), `.cd-body` (confirm dialog). No prefix system.

**Fix (optional, low priority):** Adopt a consistent prefix:
- `.se-` for editor sections (`.se-panel`, `.se-toolbar`)
- Keep existing class names working (no breaking change)
- New classes use the prefix

Only worth doing if we're adding major new UI sections. Skip for now.

---

## Priority Order

| # | Item | Effort | Risk | When |
|---|------|--------|------|------|
| 4 | `before` state schema | 20min | Zero | Next session, before new features |
| 3 | syncPanel data-driven | 30min | Low | Same session |
| 6 | Keyboard route table | 45min | Low | Same session |
| 1 | Generic collection builder | 1hr | Low | Before next collection type |
| 5 | Filmstrip dedup | 1hr | Low | Before JSON export (will touch rendering) |
| 2 | Pointerdown strategy pattern | 1.5hr | Medium | After all features stable |
| 7 | CSS naming | — | — | Skip unless major UI addition |

Total: ~5hr of cleanup. Items 4+3+6 can be done in one sitting (~2hr) with
zero behavior change. Items 1+5 before the next feature. Item 2 last.
