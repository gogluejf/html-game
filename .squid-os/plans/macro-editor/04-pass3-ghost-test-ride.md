# Macro Editor — Pass 3 Handoff: Ghost Test Ride (Test Mode)

## Goal

A **TEST** button in the macro editor that spawns a small hero rectangle and
makes it physically ride through the current draft macro using the **real game
hero mechanics** (same consts, same physics step, same jump/supermove math).
The ghost runs toward the exit, visits every reachable platform, leaves a pale
gray trail, loops on success, retries smartly on failure, and reports
"CLEARED" or the exact fail point. Any other editor action kills the ride and
restores normal editing with the draft untouched.

This is §21–§24 of `task.list.md`: manual/automatic test, real physics inside
the editor, lock editing during test, return to same draft, collision/debug
overlays, automatic ghost runner, traversal graph, failure reporting.

## Non-negotiables

- **No duplicated physics.** The ghost must run the SAME hero mechanics code
  the game uses (`js/hero/hero.js` + `js/hero/physics.js` + `js/consts.js` +
  `js/hero/heroDefs.js`). If isolation/refactor is needed to run that code
  headless (no DOM, no enemies, no camera), do it — but the integration math
  (gravity, jump impulse, double-jump factor, supermove burst/decel profile,
  run speed, one-way platform drop-through) must be the single shared source.
- **Runs in Node AND in the browser.** The clearability core is a pure module
  importable from `node --test` and from the editor server context alike. Zero
  DOM access in the core; rendering is a thin editor-side skin.
- **Infinite supers during test.** We test geometry clearability, not meter
  pacing. The ghost may trigger supermove at will (meter always full).
- **Weakest-hero priority.** The ghost uses Balthazar's stats (weaker jump);
  if Balthazar clears it, Scarlet clears it. Hero rect tinted per hero.
- **Draft safety.** The ride never mutates `app.cur.st`. Editing is locked
  while a ride is active; killing the ride (any tool action, TEST again, or
  Escape) restores the exact draft state and unlocks.

## Already complete — preserve these contracts

- Canonical data: `macros/levels/<id>.json`; drafts in localStorage;
  `markChanged()` is the only mutation path.
- Shared validators: `macroSchema.js`, `validateLayout()` in `js/world/macros.js`.
- Unified reachability BFS (`computeUnreachable`) + `minHeroSuperAssistReachPx`
  (run → double jump → supermove at apex → post-super fall), weakest hero governs.
- `MAX_ELEVATION_STEP` derived from the weakest hero's double-jump apex.
- Editor pointer model: tools, marquee select, space+drag pan, transient
  select mode (`beginTransientSelect` / `endTransientSelect`).
- Units: blocks `{x,y,width,height}`, platforms `{x,y,width}`; 72×48 px cells;
  horizontal zone 56 wide × 10 play rows; vertical zone 56 high × 13 wide.

## Architecture

### 1. Headless hero core (refactor, first task)

Extract the pure per-frame hero step so it can run without the game world:

```
js/hero/headless.js   (new)
  createHeadlessHero(heroKey) -> hero-like object with the REAL Hero update
                                 math, minus combat/camera/effects deps
  stepHeadless(hero, dt, input, solids) -> { hit, grounded }
```

Approach (choose during implementation, keep it minimal):

- **Preferred:** make `Hero.update(dt, input)` self-contained for movement
  (it already takes `_world` optionally). Collision resolution lives in
  `systems/update.js` via `resolve(hero, solids, {prevBottom, ignoreOneWay})`
  — that `resolve` + `isGrounded` + `standingOnOneWay` are already near-pure
  (verify imports; they must not touch DOM/canvas). The headless wrapper then
  is: build a `Hero` instance with a stubbed `draw()`, feed it synthetic
  `input`, call `hero.update(dt, input)`, then `resolve()` against the macro's
  solid boxes, then `hero.setGrounded(isGrounded(hit))`. Same three lines the
  game loop uses.
- Solid boxes come from the macro draft: each block → AABB; each platform →
  one-way AABB; ground row 0 → continuous floor (horizontal) / bottom support
  platform (vertical). No barrels, no enemies.
- Supermove: force `supermoveMeter = SUPERMOVE_MAX` every frame before
  `update()` so the ghost can dash freely.
- Death/fall: falling below the zone bottom (or past entry/exit bounds in
  horizontal) = ride failure event, not a game-over flow.

If `Hero.update` proves too entangled (combat state machines firing on their
own), the fallback is a `GhostHero` that reuses the *exact* numeric blocks
(movement accel/friction, jump impulses, variable jump height, coyote time,
jump buffer, supermove phase machine) by importing them as functions — but
only if option A fails. Option A is expected to work because `update()`
already guards all combat behind input flags we simply never set.

### 2. Rider brain (decision rules)

```
js/world/ghostRider.js   (new, pure logic, Node-testable)
  runGhostRide(macro, { heroKey='balthazar', dt=1/60 }) ->
    { cleared: boolean,
      path: [{x,y}...],            // world-space trail points
      visited: [unitIndex...],     // landings touched
      failPoint: {x,y,reason} | null,
      attempts: number }
```

Decision rules (dumb, deterministic, no randomness):

1. **Facing:** always face the exit (right for horizontal, up-biased for
   vertical). Never turn around unless backed against a wall with an open
   route behind (then retry logic handles it).
2. **Run:** hold forward constantly.
3. **Jump timing:** when the next edge/gap ahead requires it — computed from
   the landing graph: if the surface ahead ends within `k` units and the next
   landing is higher or across a gap, start the jump so the apex meets the
   target (use `minHeroDoubleJumpHorizontalReachPx` inverted for takeoff
   distance).
4. **Double jump / super:** when the rise+gap envelope says a plain jump
   cannot make it but the super-assist envelope can → double jump, then
   supermove at the second apex (exactly the move sequence the validator
   assumes).
5. **Drop-through:** Down+Jump on a one-way platform when the target landing
   is below.
6. **Visit-all pass:** after reaching the exit, the rider continues: BFS order
   over the landing graph (the existing `computeUnreachable` output inverted),
   physically riding to each not-yet-visited reachable landing, then back
   toward the exit. Unreachable landings are skipped (they're amber warnings,
   not ride targets).
7. **Failure & smart retry:** on fall-out, respawn at the last safe grounded
   position (checkpoint = last frame standing on a solid), increment attempt
   counter, and flip the decision that led to the fall (e.g., "jumped early"
   → wait one more unit; "didn't super" → super this time). Max N attempts
   (default 8) → report `failPoint` with reason (`'fell'`, `'wall'`,
   `'unreachable-rise'`).
8. **Loop:** on `cleared`, the caller (editor) restarts the ride
   automatically; the core just returns.

The rider consumes the landing graph + envelopes from `js/world/macros.js`
(existing exports) — no new clearance math.

### 3. Node tests (before any UI)

```
js/test/ghostRider.test.js
```

- Every canonical macro in `macros/levels/*.json` that is currently valid:
  assert `cleared === true` (this is the regression net: any future rule or
  physics change that breaks a shipped macro fails here).
- Synthetic dead-end macro (high shelf reachable from below, exit beyond a
  too-wide drop): assert `cleared === false`, `failPoint.reason === 'fell'`,
  and that the fail x/y is on the expected side.
- Visit-all: synthetic macro with 3 reachable platforms + 1 unreachable
  perch → `visited` contains exactly the 3 reachable indices.
- Vertical macro: ride climbs, uses drop-through where needed, clears.
- Determinism: same macro twice → identical `path` (byte-equal).

### 4. Editor integration (UI skin)

Files: `macro-editor/js/ghost.js` (new), toolbar button in `index.html`,
small hooks in `pointer.js` / `main.js` / `draw.js`.

- **TEST button** (toolbar, icon + `T` shortcut): toggles ride mode.
  - Start: snapshot nothing (draft is immutable during ride anyway); lock
    editing via a `app.editor.riding = true` flag checked at the top of
    `onPointerDown` (all tools no-op while riding, except TEST itself and
    Escape); spawn ghost at macro entry.
  - Drive: `requestAnimationFrame` loop stepping `stepHeadless` at fixed
    `dt = 1/60` (accumulator pattern, same as the game) — NOT tied to draw
    rate, so the ride plays at real speed.
  - Render (in `drawEditorOverlay`): green hero rect (Balthazar = his debug
    color, Scarlet selectable later) at ghost position, scaled to ~half cell;
    **trail**: pale gray dots (alpha ~0.25, radius ~2px) along `path[]`,
    drawn under everything else; fade oldest points beyond ~4s of ride.
  - Cleared: toast "CLEARED ✓", brief pause (300 ms), auto-restart ride
    (loop). Trail resets each lap.
  - Fail: red flash at `failPoint`, toast with reason, smart-retry loop
    visible (respawn + reroute), until max attempts → ride stops, fail point
    stays marked amber until the user edits something or presses TEST.
- **Kill conditions** (all reset trail + unlock + restore cursor):
  - TEST pressed again,
  - Escape,
  - any pointer interaction with another tool (select/block/platform/slot/
    erase), macro switch, or save/discard.
- **Status readout** (next to validation hint): `ride: running · lap 3 ·
  visited 7/9` or `ride: FAILED at (x,y) — fell`.

### 5. Debug overlay (bonus, same pass)

While riding, toggleable (existing `G` grid toggle pattern): show the landing
graph edges the rider used (thin cyan lines between consecutive landings) and
amber X on unreachable landings. Reuses `descriptorScreenRect` from `draw.js`.

## Task order

1. **Isolation audit + headless core** — verify `Hero.update` / `resolve` /
   `isGrounded` / `standingOnOneWay` are DOM-free; extract what isn't into
   `js/hero/headless.js`. Game behavior unchanged (tests stay green).
2. **`ghostRider.js`** — landing-graph-driven rider brain, pure logic.
3. **Node tests** — canonical macros clear, dead-end fails, visit-all,
   determinism. (This gate must pass before UI work.)
4. **Editor UI** — TEST button, rAF driver, ghost rect + trail render,
   lock/unlock, kill conditions, status readout, loop-on-clear, retry loop.
5. **Debug overlay** — graph edges + fail marker.
6. **Docs** — `structure.md` gains a short "Test ride" note (conceptual:
   the editor can prove a macro is clearable with the real hero physics);
   `task.list.md` §21–§24 items ticked.

## Definition of done

- TEST in the editor makes a green rect ride the current draft with real
  physics, gray trail behind, CLEARED loop on success, smart retry + fail
  marker on failure.
- Any other action instantly kills the ride; draft and selection restored.
- `node js/test/run-all.mjs`: all canonical macros clear; dead-end fixture
  fails correctly; zero new failures vs. today's baseline.
- No duplicated physics constants or integration math anywhere in the editor.
