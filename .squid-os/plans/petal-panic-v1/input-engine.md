# Petal Panic — Input Engine Plan

## Goal

One `input.js` module that polls all sources (keyboard, gamepad, touch) and returns
a single normalized state object every tick. The update engine reads only this object.
No more `keys.has()` scattered around. No if/if/if per source.

## Files

| File | Responsibility |
|------|---------------|
| `js/input.js` | Core: poll, normalize, lock logic, expose `state` |
| `js/input-mapping.js` | Mapping table, persistence (localStorage), defaults |
| `js/input-gamepad.js` | Gamepad detection, layout tables, button names |
| `js/screens/remap.js` | Remap UI (settings screen) |

Modified:
- `js/systems/update.js` — remove inline `keys.has()`, read from `input.state`
- `js/hud.js` — dynamic button hints from mapping layer
- `js/screens.js` — gamepad navigation in menus

---

## Actions (10)

| Action ID | Description |
|-----------|-------------|
| `move` | 4-way / analog movement (X + Y axes) |
| `jump` | Jump / double jump |
| `aim` | Aim direction (X + Y axes) + shoot trigger |
| `melee` | Melee swing |
| `supermove` | Supermove dash (when meter full) |
| `switchWeapon` | Cycle weapon (thorn → special → ...) |
| `lockDir` | Hold to freeze aim direction, reposition freely |
| `lockMove` | Hold to freeze position, aim freely |
| `crouch` | Crouch / slide |
| `pause` | Pause game |

---

## Normalized State Object

What the update engine reads every tick:

```js
input.state = {
  // Movement (analog: -1..1, digital: -1/0/1)
  moveX: 0,
  moveY: 0,

  // Aim (analog: -1..1, or locked angle)
  aimX: 0,
  aimY: 0,
  aimAngle: 0,          // radians, used when lockDir is active
  shooting: false,      // fire trigger held

  // Discrete actions (edge-triggered: true on the tick pressed)
  jump: false,
  melee: false,
  supermove: false,
  switchWeapon: false,
  crouch: false,        // level-triggered (held)
  pause: false,         // edge-triggered

  // Lock states (level: true while held)
  lockDir: false,
  lockMove: false,

  // Source info (for HUD display)
  source: 'keyboard',   // 'keyboard' | 'gamepad' | 'touch'
  gamepadLayout: null,  // 'ps5' | 'xbox' | '8bitdo' | 'generic' | null
}
```

The update engine does:
```js
const inp = input.state;
hero.update(dt, {
  left:   inp.moveX < -0.2,
  right:  inp.moveX > 0.2,
  up:     inp.moveY < -0.2,
  down:   inp.moveY > 0.2 || inp.crouch,
  jump:   inp.jump,
  shoot:  inp.shooting,
  melee:  inp.melee,
  super:  inp.supermove,
  special: inp.switchWeapon, // weapon switch triggers special context
});
```

---

## Mapping Layer

### Structure

```js
// input-mapping.js
const DEFAULTS = {
  keyboard: {
    move:       { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
    jump:       ['Space'],
    aim:        { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
    shoot:      ['KeyG'],
    melee:      ['KeyJ'],
    supermove:  ['KeyB'],
    switchWeapon: ['Tab'],
    lockDir:    ['KeyK'],
    lockMove:   ['KeyL'],
    crouch:     ['KeyS'],  // shared with move.down
    pause:      ['Escape'],
  },
  gamepad: {
    move:       { axis: 0 },           // left stick
    jump:       ['button0'],           // A / Cross
    aim:        { axis: 1 },           // right stick
    shoot:      ['button7'],           // RT / R2
    melee:      ['button2'],           // X / Square
    supermove:  ['button5'],           // RB / R1
    switchWeapon: ['button3'],         // Y / Triangle
    lockDir:    ['button10'],          // L3
    lockMove:   ['button11'],          // R3
    crouch:     ['button1'],           // B / Circle
    pause:      ['button9'],           // Start / Options
  },
};
```

### Persistence

- Saved to `localStorage` key `petal_panic_input_mapping`
- Loaded on boot, merged over defaults
- "Reset to defaults" clears the key and reloads

### Remap flow

1. User enters remap screen (from settings/pause)
2. List of actions shown, each with current binding displayed
3. User selects an action → "Press any key/button..."
4. Next physical input captured → assigned
5. Auto-advance to next action (sequence style)
6. Skip button to leave an action unbound
7. Done → save to localStorage

---

## Gamepad Detection

### Layout tables

```js
// input-gamepad.js
const LAYOUTS = {
  ps5: {
    id: [0x054C, 0.0],  // vendor + product match (approx)
    buttons: { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, l3: 10, r3: 11, start: 9, select: 8 },
    sticks: { left: [0, 1], right: [2, 3] },
    label: 'PS5',
  },
  xbox: { ... },
  '8bitdo': { ... },
  generic: { ... },  // fallback
};
```

### Detection logic

1. `navigator.getGamepads()` on each tick
2. First connected pad → check vendorId/productId against known layouts
3. Match → use that layout's button map
4. No match → use generic (standard mapping by index)
5. Store active layout for HUD display ("△" vs "A" vs "X")

### Button display names

```js
function buttonLabel(action, layout) {
  // Returns "△", "A", "X", "W", "Space", etc.
  // Based on current mapping + active layout
}
```

HUD calls this to show contextual hints.

---

## Lock Direction / Lock Movement

### Lock Direction (`lockDir`)

- While held: `aimAngle` freezes at current value. Right stick / arrow keys
  no longer change aim. Movement still works normally.
- On release: aim resumes following the stick/keys.
- Edge case: if no aim was set before locking (aimX=0, aimY=0), lock uses
  the hero's facing direction as default angle.

### Lock Movement (`lockMove`)

- While held: `moveX` and `moveY` are forced to 0. Hero stops (or maintains
  current velocity with friction). Left stick / WASD no longer move.
- Aim still works normally.
- On release: movement resumes.

### Both locked simultaneously

- Hero is stationary, aim is frozen. Useful for precise shooting while
  an enemy circles. Rare but valid.

---

## Keyboard specifics

- **Movement:** WASD (digital, -1/0/1)
- **Aim:** Arrow keys (digital, -1/0/1) OR mouse position (analog, relative to hero)
- **Shoot:** G (or mouse click)
- **Jump:** Space (dedicated, NOT up arrow — frees up for aiming)
- **Crouch:** S (shared with move.down — crouching IS moving down)
- **Pause:** Escape

Note: Up arrow is NO LONGER jump. Jump is Space only. This resolves the
conflict between "jump" and "aim up."

---

## Gamepad specifics

- **Movement:** Left stick (analog)
- **Aim:** Right stick (analog) + RT/R2 to shoot
- **Jump:** A / Cross
- **Melee:** X / Square
- **Supermove:** RB / R1
- **Switch Weapon:** Y / Triangle
- **Lock Direction:** L3 (left stick click)
- **Lock Movement:** R3 (right stick click)
- **Crouch:** B / Circle
- **Pause:** Start / Options

---

## Touch (future, not v1)

- Virtual left stick (movement)
- Virtual right stick (aim + shoot on release)
- Buttons: jump, melee, supermove, switch, lock dir, lock move, pause
- Not implemented in v1. Architecture must not block adding it later.

---

## Integration changes

### `systems/update.js`

Remove:
```js
const keys = new Set();
window.addEventListener('keydown', ...);
window.addEventListener('keyup', ...);
// all keys.has() calls
```

Replace with:
```js
import { input } from '../input.js';
// In the update loop:
input.poll(); // reads keyboard + gamepad, updates state
const inp = input.state;
// Use inp.* everywhere instead of keys.has()
```

Debug keys (F, Z, T, Y, L, X, E, C, 1-9) stay as a separate debug-only
listener inside `update.js`. They're not part of the game input engine.

### `hud.js`

Replace hardcoded key hints with:
```js
import { input } from '../input.js';
const jumpLabel = input.buttonLabel('jump'); // "Space" or "A" or "△"
```

### `screens.js`

Add gamepad navigation:
- D-pad / left stick to move cursor
- A/Cross to confirm
- B/Circle to go back
- Works in: title screen, checkpoint screen, gameover, settings/remap

---

## Remap UI — Visual Design

Must match the existing screen visual language. Do NOT hardcode colors, fonts,
or layout constants — read them from the same sources `screens.js` already uses
(`drawMarqueeTitle`, `drawPrompt`, `roundRect`, CREAM, PINK, the gradient stops,
the card dimensions). The remap screen is a new screen class in `screens.js`
(or its own file that imports the same helpers) and reuses the exact same
drawing primitives.

- **Background:** same gradient as other screens (reuse the existing helper)
- **Header:** `drawMarqueeTitle` — "REMAP CONTROLS", same style as "SELECT YOUR HERO"
- **Tab toggle:** [KEYBOARD] [GAMEPAD] — top-right, active tab highlighted with
  the same accent color used for focus states elsewhere
- **Action rows:** rounded-rect cards using the same `roundRect` + fill/stroke
  pattern as stat bars on the select screen
  - Left: action name via `drawPrompt`
  - Right: current binding displayed as a "keycap" chip (rounded rect, dark fill,
    border, label inside)
  - Selected row: same focus highlight style as hero select (pink stroke + glow)
- **Remap mode:** selected row's keycap chip pulses, text changes to
  "PRESS ANY KEY / BUTTON..." in the accent color
- **Bottom bar:** [RESET TO DEFAULTS] (left) ... [DONE] (right) — same style
  as "PRESS ENTER" prompts
- **Navigation:** d-pad / WASD to move between rows, A/Enter to enter remap
  mode for that row, B/Esc to go back, Y to skip (leave unbound)
- **Gamepad button display:** shows the actual symbol (△ ○ ✕ □ or A B X Y or
  generic "BTN 4") based on detected layout
- **Keyboard key display:** shows the key label ("W", "SPACE", "ESC", "TAB")

If the select screen changes its look, the remap screen changes with it because
they share the same drawing helpers. No duplication of style constants.

---

## Testing

- Unit test: mapping layer (assign, read, reset, persist)
- Unit test: lock logic (lock dir freezes angle, lock move zeros velocity)
- Unit test: gamepad layout detection (mock getGamepads)
- Integration: update engine reads input.state correctly
- Manual: play with keyboard, then plug in gamepad, verify all actions work
