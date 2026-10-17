# Petal Panic — Mobile Touch Controls (Virtual Gamepad + Debug Bar)

## Context

The game runs in a phone browser via `http://10.0.0.230:8765` (server.sh).
Phone is **portrait**; the game canvas is letterboxed in the middle, leaving
free space top and bottom. Today there are **zero touch controls** — keyboard
(F1/F2/F3 debug, WASD/arrows) and native gamepad only.

Goal: play + debug entirely from the phone.

- **Bottom:** full virtual gamepad (real thing — standard mapping incl. triggers)
- **Top:** debug/function key bar (F1 F2 F3 F4 + every other debug key that exists)

## Architecture decision (the important one)

The input engine (`js/core/input.js`) polls gamepads through an **injectable
`getGamepads()`** (default: `navigator.getGamepads`). The Web Gamepad API is
read-only — you cannot register a fake pad with the browser — but we don't need
to: the singleton `input = createInput()` at input.js:721 uses the default, so
we **monkey-patch `navigator.getGamepads`** to return `[...nativePads, virtualPad]`.

The virtual pad is a plain Gamepad-shaped object:

```js
// js/ui/virtualPad.js — state shared with the touch UI
export const vpadState = {
  axes: [0, 0, 0, 0],          // axis 0/1 = left stick, 2/3 = right stick
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
};

// Gamepad-shaped snapshot consumed by input.js's poll loop
export function virtualPadSnapshot() {
  return {
    index: 99,                 // never collides with a real pad index
    id: 'squid-virtual-pad',
    connected: true,
    timestamp: performance.now(),
    vibrationActuator: null,
    axes: vpadState.axes.slice(),
    buttons: vpadState.buttons.map(b => ({ ...b })),
  };
}

// install once (main.js): merge virtual pad behind the native list
const nativeGet = navigator.getGamepads?.bind(navigator);
navigator.getGamepads = () => [...(nativeGet?.() ?? []), virtualPadSnapshot()];
```

Why this is clean:
- input.js reads `pad.index`, `pad.id`, `pad.connected`, `pad.buttons[i].pressed/value`,
  `pad.axes[i]` — all provided.
- Per-pad prefix `p:99:squid-virtual-pad:` keeps virtual bindings from ever
  clashing with a real pad plugged in later.
- Edge detection (previousPhysical/padPhysical diffing) works for free —
  press/release of a virtual button is indistinguishable from a real one.
- No changes to input.js, no per-feature wiring, remapping screen just works
  (a "Squid Virtual Pad" entry appears as a normal pad).

## Standard button layout (W3C mapping — what we render)

| idx | label | role in game (default mapping) |
|-----|-------|-------------------------------|
| 0   | A / ✕ | jump / confirm |
| 1   | B / ○ | back / supermove (alt) |
| 2   | X / □ | shoot / nav.remove |
| 3   | Y / △ | melee |
| 4   | LB? no — **btn:4** | switchWeapon |
| 5   | (small) | supermove (alt) |
| 6   | **L1** | lockDir |
| 7   | **R1** | lockMove |
| 8   | **L2** | (free) |
| 9   | **R2** | pause (PAD_NAV) |
| 10  | L3 | (stick click, optional) |
| 11  | R3 | (stick click, optional) |
| 12  | D-pad ▲ | moveUp |
| 13  | D-pad ▼ | moveDown |
| 14  | D-pad ◀ | moveLeft |
| 15  | D-pad ▶ | moveRight |
| 16  | Start | (optional) |

Axes: `axis:0` = left stick X, `axis:1` = left stick Y (deadzone 0.2 handled
by input.js already). Right stick (axes 2/3) exposed for future aim use.

Note btn:4 is switchWeapon in DEFAULT_MAPPING (not a trigger) — triggers L1/R1
are btn:6/btn:7, L2/R2 are btn:8/btn:9. Render labels accordingly; the *index*
is what matters, the label is cosmetic.

## Files

### 1. `petal-panic/js/ui/virtualPad.js` (new, ~80 lines)
- `vpadState` + `virtualPadSnapshot()` + `installVirtualPad()` (the
  navigator patch, idempotent).
- Helpers: `press(btn)`, `release(btn)`, `setStick(axisPair, x, y)` with
  clamp-to-unit-circle.

### 2. `petal-panic/js/ui/touchControls.js` (new, ~200 lines)
Builds the DOM overlay (no framework, plain divs + CSS file):

**Bottom zone (gamepad):**
- Left: analog stick (touch-tracked, writes axes 0/1; fallback D-pad buttons
  12–15 rendered small under it for precision)
- Right face: A/B/X/Y cluster (0–3)
- Triggers row: L1 R1 L2 R2 (6, 7, 8, 9) — wide flat buttons above the face
  cluster (thumb reach)
- Small row: btn:4 (weapon), btn:5, Start (16)
- Stick-click L3/R3 (10/11) optional — skip v1

**Top zone (debug bar):**
Buttons dispatching synthetic `KeyboardEvent`s on `window` (keydown + keyup,
`code` set correctly) — debugHarness listens on window keydown, so this works
with zero engine changes:
- `F1` debug toggle · `F2` effect theater · `F3` collision view cycle ·
  `F4` (whatever F4 does — verify in debugHarness)
- `Shift+E` collision JSON dump (two-button combo: hold Shift tap E, or a
  single dedicated button that dispatches both)
- `Escape` (nav.back) · `KeyP` pause · `KeyD` (verify purpose)
- Any other F-key / debug shortcut found in `debugHarness.js` keydown handler
  → add a button. **Rule: every key the desktop debugger can hit, the phone
  can hit.**

Behavior rules:
- Overlay only active when `('ontouchstart' in window) || navigator.maxTouchPoints > 0`
- `touch-action: none` on control zones; multi-touch supported (stick + button
  simultaneously)
- Buttons use `touchstart`/`touchend`/`touchcancel` (NOT click — latency)
- Semi-transparent (opacity ~0.35), big enough thumbs (min 48px targets)
- Hide/show toggle button (so screenshots/theater view stay clean)

### 3. `petal-panic/js/ui/touchControls.css` (new)
Fixed positioning: top bar `top: 4px`, gamepad `bottom: 4px`, both
`position: fixed; z-index: 9999; pointer-events: none` on container,
`pointer-events: auto` on controls (so canvas touches elsewhere still work).

### 4. `petal-panic/js/main.js` (edit, ~5 lines)
```js
import { initTouchControls } from './ui/touchControls.js';
initTouchControls(); // no-op on desktop
```

### 5. Docs: `petal-panic/docs/architecture/mobile-input.md` (new, short)
One page: the getGamepads injection contract, button table, debug bar list.

## Out of scope (v1)
- Haptics (vibrationActuator is null)
- Right-stick aim (exposed in state, unbound)
- Portrait-specific canvas scaling (letterbox is fine for now)
- Remapping UI tweaks (existing remap screen already sees the virtual pad)

## Verification
1. Desktop: `./server.sh go` → open localhost → overlay absent (no touch).
2. Phone: `http://10.0.0.230:8765` → overlay present; hero moves via stick,
   jumps via A, shoots via X.
3. Top bar: F1 opens debug, F2 opens effect theater, F3 cycles collision view,
   Shift+E dumps JSON (check DevTools/console or the on-screen dump).
4. Plug a real gamepad while playing → both pads coexist (different prefixes).
5. `node --test` suite still green (no engine files touched except main.js import).

## Task order
1. virtualPad.js + install in main.js → verify with a console poll
   (`navigator.getGamepads()[1]`) and moving the hero by setting vpadState from
   devtools.
2. touchControls.js bottom half (stick + face + triggers) → playable on phone.
3. touchControls.js top half (debug bar) → all debug keys reachable.
4. CSS polish + opacity/sizing pass on the actual phone.
5. mobile-input.md doc.
