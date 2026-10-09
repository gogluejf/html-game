# 07 — Manual Play Mode

## Goal
Let the user control the ghost hero freely on the current macro draft. No AI, no goals — just physics + keyboard. Reuse all existing ride infrastructure (world, hero, fixed-timestep loop, trail, rendering).

## UX

| Control | Action |
|---------|--------|
| **PLAY button** (new) | Start/stop manual play. Disabled when no macro loaded. |
| **Space** (existing) | Toggle AI test ride (unchanged). |
| **Arrows / WASD** | Move hero (left/right). |
| **Z / Up** | Jump / double-jump. |
| **X / Down+Jump** | Super / drop-through. |
| **ESC** | Stop manual play, return to edit mode. |

- PLAY button shows ▶ when idle, ■ when active (same pattern as TRACE button).
- Disabled when no macro is selected.
- Starting manual play kills any active AI ride (and vice versa).
- Hero spawns at entry point, same as AI ride.
- Trail renders (green hero, gray trail) — same visual as AI ride.
- No goal tracking, no landing detection, no clearance commit.
- Hero can fall out of world → respawn at entry (same as AI ride).

## Implementation

### State
```js
// Add to ride object:
ride.manual = false;  // true = player-controlled, false = AI-controlled
```

### Input
```js
// In rideInput():
if (ride.manual){
  // Return raw keyboard state. No picker, no walk-to-edge, no goals.
  return {
    left: keys.left, right: keys.right,
    up: false, down: keys.down,
    jump: keys.jump, super: keys.super,
    onOneWay: !!ride._onOneWay,
  };
}
// ... existing AI logic below
```

### Keyboard tracking
```js
// Module-level in ghost.js:
const keys = { left: false, right: false, down: false, jump: false, super: false };
// Bound in startManualPlay() / cleared in stopRide().
// Use keydown/keyup with e.code checks. Prevent default for game keys.
```

### PLAY button
- New button in toolbar (next to TEST and TRACE).
- `id="playBtn"`, class `tbtn`.
- Click → `toggleManualPlay()`.
- Disabled when `!app.cur`.
- Visual: ▶ icon when off, ■ when on (CSS class `.active`).

### toggleManualPlay()
```js
export function toggleManualPlay(){
  if (!app.cur || !app.cur.st) return;
  if (ride.active && ride.manual){
    stopRide();  // stop manual play
  } else {
    stopRide(false);  // kill any AI ride
    startRide();      // reuse existing spawn/world setup
    ride.manual = true;
    // Bind keyboard listeners
  }
}
```

### stepOnce changes
- Skip goal-landing detection when `ride.manual`.
- Skip "fell past goal" respawn logic when `ride.manual`.
- Keep fell-out-of-world respawn (always).
- Keep trail recording.

### updateRideHint
- When manual: show `manual play · x=NNN y=NNN` instead of goal info.

### Cleanup
- `stopRide()` unbinds keyboard listeners, sets `ride.manual = false`.
- PLAY button disabled state synced in `updateRideHint()` (same pattern as TRACE).

## Files touched
- `macro-editor/js/ghost.js` — main logic
- `macro-editor/js/main.js` — button binding, keyboard events
- `macro-editor/index.html` — PLAY button element
- `macro-editor/css/editor.css` — button active/disabled styles

## NOT doing
- No camera follow (hero moves, viewport stays).
- No animation/sprites (green rect, same as AI ride).
- No sound.
- No multi-hero.
- No saving replays.
