# Petal Panic — Input Engine Contract

Implemented in `js/input.js`; no separate mapping/gamepad modules are required yet.

## Ownership and tick order

- `createInput()` owns DOM keyboard listeners and gamepad polling. The exported
  `input` singleton is used by the game; dependency injection supports deterministic
  Node tests. Physical codes, button indices, axis thresholds and capture policy
  never enter screens or update logic (debug listeners remain separate).
- `update()` calls `processInput()` once per fixed tick, in every state. It polls
  input, dispatches semantic screen actions with retry/continue/playAgain/quit
  closures, then updates gameplay only in PLAY. There is no render-frame pad bridge.
- Screens implement `onAction(action)`. `dispatchScreenInput()` is the sole live
  navigation route. No semantic-action-to-virtual-key conversion exists.

## Navigation and lifecycle

`input.nav = { held, pressed, released }` provides merged semantic edges for
`up/down/left/right/confirm/back/pause` and optional retry/cont/quit shortcuts and remove (Delete / pad west).
Keyboard events are queued, preserving a tap between ticks. OS repeat is ignored.
Pads are sampled each tick, including all connected slots; digital actions OR
across sources, axes use the highest magnitude. A pad tap entirely between samples
cannot be observed by the browser polling API.

- Arrows/WASD and D-pad/left stick navigate. Enter/Space and pad south confirm.
- Escape provides back and gameplay pause; Options/Start provides pause (confirm
  on non-pause menus). Circle provides back, never gameplay pause.
- PLAY responds only to semantic pause. Space jump and Circle supermove cannot pause.
- Every state transition and capture boundary clears the action batch and
  quarantines all held physical controls until release. No wall-clock debounce.
  Simultaneous confirm/back/other events cannot cascade into a second screen.
- Blur/hidden document releases state, cancels capture, and quarantines pad controls
  on focus return. Disconnect releases pad contributions. Selection hints follow
  semantic held state, without timeout expiry.

## Gameplay and mapping

`input.state` supplies moveX/Y, aimX/Y/angle, shooting, jump, melee, supermove,
switchWeapon, crouch, lockDir, lockMove, pause, and source/layout display metadata.
Jump is held (including a one-tick short tap) for the existing Hero variable-height
jump logic. Melee/supermove/switchWeapon are press edges; shooting/crouch/locks are
held. Keyboard movement also aims; pad right stick independently aims.

Approved defaults:
- Keyboard: WASD/arrows movement/aim, Space jump, Ctrl shoot, X melee, C super,
  V weapon switch, S/down crouch, K direction lock, L movement lock.
- Standard pad: left stick/D-pad movement, right stick aim, south jump,
  west (Square) shoot, north melee, RB/R1 OR east/Circle super, LB switch,
  LT/L2 direction lock, RT/R2 movement lock (not shooting).

`mapping[source][action]` contains physical bindings. Directions have exactly two
UI slots (WASD + arrows or left stick + D-pad); gamepad Supermove has two
(default ○ + R1). All other rows have one slot. Keyboard Supermove defaults to C.
The mapping API enforces these limits; the UI has no Add/remove controls.
Storage key: `petal_panic_mapping`, version 3. Legacy direction/Supermove rows
missing a second binding receive a default alternative while retaining their
first choice. Extra bindings on single-slot rows are trimmed to the first.
Complete exact original-default snapshots upgrade to current defaults. Custom
first bindings otherwise remain. Reset restores the full current defaults.
Obsolete crouch mappings are ignored: Down alone supplies crouch intent.

Direction lock freezes the last aim angle on entry (hero facing if unset), not
on every held tick. Movement lock zeros movement without freezing aim.

## Capture and remap

`beginCapture(targetSource)` isolates navigation and waits for a new physical
binding from that target. `captureResult` is either `{status:'cancelled'}` or
`{status:'bound', source, binding}`. Back from *either device* cancels capture only,
regardless of active tab. Cancel wins over simultaneous binding candidates.
The next fresh back leaves REMAP to its recorded parent (PAUSE or HOME), one level.
The opening confirm and completing/cancelling press cannot leak into gameplay.

Remap consumes semantic actions and normalized capture results. There is no
chip-selection mode: up/down moves rows and left/right selects a chip directly.
Up from the first row focuses the device tabs; left/right there selects the source.
Confirm starts continuous capture. Each assignment advances one row and immediately
starts the next capture, retaining the preferred chip column. Single-slot rows use
chip 1 temporarily; subsequent double-slot rows restore the preferred column.
The final row ends capture without wrapping. Held inputs are quarantined between
assignments. Cancel stops capture on the current chip; the next Back returns to
the parent screen. Navigation uses a soft chip highlight; capture uses a stronger
border and 50%-opaque fill. Reset restores defaults; Done saves and exits.
Back and pause remain reserved during capture (tap-to-bind/hold-to-cancel is not
implemented in this flow).

## Verification and boundaries

Run `node --test petal-panic/js/test/input.test.js` for adapter-level deterministic
coverage, and `node petal-panic/js/test/<name>.test.js` for existing standalone
suites. `node petal-panic/js/test/headless-smoke.mjs` exercises the update pipeline.

Touch/mouse gameplay adapters, arbitrary non-standard controller layouts, independent
keyboard aim remapping, binding conflict UI are not implemented.
Real-browser visual/controller verification remains separate from Node coverage.
