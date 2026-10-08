# Macro Editor — Pass 4 Handoff: Smart Mover (Provable Traversal)

## Why this pass exists

Pass 3 (`04`) shipped a **reflex bot**: the ghost looks ~18px ahead, and when it
sees a wall it mashes jump / double-jump / super until something works. That is
the wrong tool for proving clearability. It:

- "Clears" by muscle, not by finding a valid line — so a clear is not a proof.
- Mis-fires super while just walking on a surface (rule too blunt).
- Cannot reason about *landing on* a small/precise platform vs. overshooting it
  into the hole between two blocks.
- Retries by respawning from the start, which reads as "stupid jumping in place."

The validator already has a **reachability BFS** (`computeUnreachable` in
`js/world/macros.js`) that proves which surfaces are *individually reachable*
using real rise+gap physics envelopes. But it answers *"is surface B within max
reach of A?"* — a generous upper bound. It does **not** prove the hero can
**land ON** B's top surface specifically (brake/steer to stop there), which is
exactly the case that fails in practice:

> Small platform over a hole. Validator says "reachable." A real attempt that
> supers off the previous block falls into the gap. The hero must instead jump,
> steer in the air, and drop onto the small platform, THEN double-jump + super
> from it to continue.

This pass replaces the reflex brain with a **predict → execute → correct**
mover that physically lands on each target platform using the same button-input
contract the game uses, and only then declares the macro clearable.

## Goal

One movement brain that, given a hero (with injected stats) and a goal surface,
produces the **button inputs** (`left/right/jump/super/down`) needed to travel
there and **land on it**, verified by real simulation. It:

- Works identically for **horizontal and vertical** macros (goal is just a
  target surface; the axis is derived from orientation).
- **Proves** traversal by actually landing on every required platform — not by
  math alone, not by mashing.
- **Lands precisely** on small platforms (uses air control to position + drop),
  so "reachable" means "I can stand on it and continue."
- **Retries/backtracks only when a goal is confirmed unreachable** — not
  constantly. Normal misses within a hop are corrected in-place.
- Is **param-injected** so the same module later drives enemy AI (different
  weight, jump, some enemies have no double jump, etc.).

## Non-negotiables

- **No duplicated physics.** The mover executes via `stepHeadless`
  (`js/hero/headless.js`) — the SAME `Hero.update` + `resolve` the game runs.
  Prediction may use closed-form math, but the *proof* is simulation. If
  prediction and simulation disagree, simulation wins.
- **Button-input contract only.** The mover never teleports the hero or writes
  `hero.x/y/vx/vy` directly. It outputs `{ left, right, up, down, jump, super }`
  and lets the engine integrate. (Direct state writes were the old bug class.)
- **Params injected, not hardcoded.** Jump height, run speed, weight,
  `hasDoubleJump`, super availability all come from a `params` object. Ghost =
  Balthazar's stats. Future enemies = their own. No `HEROES.balthazar` lookups
  inside the mover core.
- **Runs in Node AND browser.** Pure module, importable from `node --test` and
  the editor. Zero DOM in the core.
- **Weakest-hero governs** for the clearability verdict (Balthazar). If the
  weakest configured hero lands every platform, the macro is clearable.
- **Validator stays as the fast pre-check.** `computeUnreachable` still runs
  first: if a surface is provably orphaned by the envelope math, we report it
  without simulating. The mover is the rigorous layer for surfaces the BFS says
  are reachable.

## What the existing code already gives us (reuse, don't rebuild)

- `js/hero/headless.js` — `createHeadlessHero`, `stepHeadless(hero, dt, input,
  solids)` → `{ hit, grounded, onOneWay }`. Real per-frame step. **Execute**
  layer runs on this.
- `js/world/ghostRider.js` — `buildRideWorld(macro, opts)` turns a macro draft
  into `{ solids, landings, entry, exit, W, H, groundY, UX, UY, vertical }`.
  Reuse for world construction. Also holds near-duplicate reach envelopes
  (`minDoubleJumpReach`, `minFullReach`) — see consolidation task.
- `js/world/macros.js` — `computeUnreachable` (BFS), `minHeroDoubleJumpHorizontalReachPx`,
  `minHeroSuperAssistReachPx`, `MAX_ELEVATION_STEP`, `MAX_CLEARABLE_GAP`. The
  single source of truth for reach envelopes. **Predict** layer reuses these.
- Air control exists in `Hero.update` (`AIR_ACCEL = 1400`, air-reversal rule).
  This is what makes precise landing possible: the hero steers + brakes mid-air.
- Drop-through: `input.down && input.jump` while `onOneWay` drops through a
  one-way platform.

## Architecture

### New module: `js/world/platformMover.js` (pure logic, Node-testable)

Public API:

```
moveToward(hero, goal, world, params, opts) ->
  { landed: boolean,
    path: [{x,y}...],        // simulated trail (world px)
    frames: number,
    reason: 'landed' | 'unreachable' | 'timeout',
    inputs?: [{left,right,up,down,jump,super}] }  // optional recorded input log
```

- `hero` — a headless hero instance (caller creates via `createHeadlessHero`).
- `goal` — a target landing `{ x0, x1, y, index, kind }` (from `world.landings`)
  OR the exit point. For vertical, the same shape with y as the traversal axis.
- `world` — output of `buildRideWorld`.
- `params` — injected movement stats:
  ```
  { speed, jump, hasDoubleJump, doubleJumpFactor, weight,
    canSuper, superSpeed, ... }   // mirrors HEROES[key].stats + consts
  ```
- `opts` — `{ dt=1/60, maxFrames, recordInputs=false, onFrame? }`.

Internal layers:

```
predictHop(hero, goal, world, params)  -> planned button sequence
  Closed-form estimate of the inputs that should carry the hero from its current
  state onto `goal`: takeoff distance, jump hold duration, air-steer direction,
  whether double-jump / super are needed (from the rise+gap envelope). Uses the
  macros.js envelope functions. Returns a coarse plan, NOT the truth.

stepAndCorrect(hero, goal, world, params, opts) -> result
  The real loop:
    1. PREDICT a plan for the current state.
    2. EXECUTE: feed planned buttons into stepHeadless, frame by frame.
    3. CHECK each frame: am I on track? (heading toward goal x-band at the right
       altitude? not overshooting the far edge?)
    4. CORRECT: if drifting (about to overshoot the small platform, rising too
       high/low), re-PREDICT from the current state and adjust (e.g. tap left to
       kill forward momentum and drop onto the platform).
    5. LANDED? feet on goal top within tolerance → success.
       Fell out / past the zone → miss.

moveToward(...)  -> public wrapper
  Calls stepAndCorrect. On a miss where the goal is STILL envelope-reachable,
  backtracks to the last safe takeoff edge and retries (bounded). Only when the
  goal is confirmed unreachable (envelope says impossible) does it return
  reason:'unreachable' without further retry.
```

### Retry / backtrack policy (the "only when stuck" rule)

- **In-hop correction** (default): drift is fixed by re-predicting mid-air. No
  respawn. This handles "about to overshoot the small platform" → steer back.
- **Missed hop, goal still reachable:** hero fell short or into a recoverable
  spot → reverse direction (`left`), return to the takeoff edge of the previous
  surface, re-attempt the hop. Bounded attempts per hop (default ~4).
- **Goal confirmed unreachable:** envelope math says no arc reaches it → stop,
  return `reason:'unreachable'`. No infinite mashing. This is the ONLY terminal
  fail, and it matches the validator's BFS verdict.

This replaces Pass 3's "respawn from start, flip a decision, max 8 attempts"
with "correct in place; backtrack to the last edge; give up only when provably
impossible."

### Horizontal + vertical: one code path

The mover treats `goal` as a target surface and derives behavior from
`world.vertical`:
- Horizontal: traverse +x, land on tops, drop-through downward.
- Vertical: traverse -y (upward), land on tops, the "forward" intent is up-bias.
Same predict/execute/correct; only the axis mapping and facing differ. No
separate vertical brain.

### Relationship to the validator (two-layer proof)

1. **Fast layer (existing):** `computeUnreachable` → set of orphaned surfaces.
   If non-empty, the macro is NOT clearable; report the orphans (amber). Done —
   no simulation needed for those.
2. **Rigorous layer (new):** for every surface the BFS says is reachable, the
   mover *physically lands* on it (in BFS order) to confirm precise landing is
   actually achievable. All landed → CLEARED. Any that can't be landed (despite
   being envelope-reachable) → reported as a precision failure with the trace.

The CLEARED flag in the editor stamps only when BOTH layers pass.

### Consolidation task (dedupe reach math)

`ghostRider.js` has `minDoubleJumpReach` / `minFullReach`; `macros.js` has
`minHeroDoubleJumpHorizontalReachPx` / `minHeroSuperAssistReachPx`. These are
near-duplicates. **Single source of truth:** the mover's predict layer and the
validator both call the `macros.js` exports. Delete the `ghostRider.js` copies
(or re-export from `macros.js`). Goal: the ghost and validator can never
disagree about reach envelopes.

## Editor integration (UI skin, `macro-editor/js/ghost.js`)

Replace the reflex `rideInput()` driver with calls to `platformMover.moveToward`:

- **TEST button** starts a ride: build world, create headless hero (Balthazar
  params), then drive the mover through the BFS-ordered list of reachable
  surfaces, finally the exit.
- **Render:** keep the green hero rect + gray trail (already built). Add:
  - cyan dot/line to the current `goal` surface (so you see what it's aiming at),
  - green flash when it lands a platform,
  - amber X on any surface reported unreachable/unlandable.
- **Status readout:** `ride: aiming <surface> · landed 4/7 · try 2`.
- **TRACE (X)** unchanged — records the button inputs + physics per frame
  (now the inputs come from the smart mover, so the trace shows the *planned*
  moves, which is more useful for debugging).
- **Kill:** TEST again / Escape / any edit → stop ride, dump active trace,
  restore draft. (Already implemented in Pass 3/this session.)

## Enemy-AI reuse (design now, build later)

The mover's contract is deliberately enemy-ready:

```
moveToward(hero, goal, world, params)
```

For an enemy, `goal` = the hero's current position (recomputed each decision
tick), `params` = that enemy's stats (some lack double jump, lower speed, etc.).
The same predict/execute/correct + air-control landing logic lets an enemy chase
the hero across platforms and land on precise surfaces. This pass builds the
module with that shape; enemy wiring is a future pass, not this one. Keep the
core free of any ghost/editor-specific assumptions.

## Node tests (before UI)

`js/test/platformMover.test.js`:

- **Precise landing (the core case):** synthetic macro — ground, a small
  1-wide platform over a 2-wide hole, then a higher block. Assert the mover
  lands ON the small platform (feet on its top, not in the hole) and continues
  to the block. This is the regression that the reflex bot failed.
- **Overshoot correction:** a far low platform where full-speed would overshoot;
  assert the mover brakes/steers and lands on it (air control used).
- **Double-jump + super hop:** a rise+gap only clearable with double-jump then
  super at apex; assert the mover produces that input sequence and lands.
- **Drop-down:** a lower platform requiring drop-through; assert `down+jump`
  used and landing below.
- **Unreachable:** a shelf above `MAX_ELEVATION_STEP` with no stepping stone;
  assert `reason:'unreachable'`, no infinite loop, bounded frames.
- **Vertical:** climb a vertical macro, land each platform, clear.
- **Param injection:** run the same macro with a `params` that has
  `hasDoubleJump:false` and a weaker jump → assert a previously-clearable hop
  now reports unreachable (proves params drive behavior, not hardcoded Balthazar).
- **Determinism:** same macro + params twice → identical `path`.
- **Canonical macros:** every currently-valid `macros/levels/*.json` → mover
  lands all reachable surfaces (regression net alongside the existing
  ghostRider tests).

## Task order

1. **Consolidate reach math** — move/dedupe envelope functions so `macros.js`
   is the single source; `ghostRider.js` re-exports. Existing tests stay green.
2. **`platformMover.js` core** — `predictHop` + `stepAndCorrect` + `moveToward`,
   param-injected, H+V, retry/backtrack policy. Pure, Node-runnable.
3. **Node tests** — the suite above. Gate: precise-landing + overshoot +
   unreachable + param-injection must pass before UI.
4. **Editor integration** — swap `rideInput()` for `moveToward`; render goal
   marker + land flashes + unreachable X; status readout. Keep TRACE.
5. **Two-layer CLEARED** — stamp CLEARED only when BFS orphans empty AND mover
   landed all reachable surfaces.
6. **Docs** — `structure.md` "Test ride" note updated (editor proves clearability
   by physically landing every platform); `task.list.md` relevant items ticked.
   Note the enemy-AI reuse contract.

## Definition of done

- TEST makes the ghost traverse the draft by **landing on each platform**
  (visible goal marker + land flashes), using real button inputs + real physics.
- The small-platform-over-hole case is cleared by steering + dropping on, not by
  overshooting into the gap.
- Unreachable surfaces stop the ride cleanly (amber X, no infinite mashing) and
  match the validator's BFS verdict.
- `node js/test/run-all.mjs`: precise-landing, overshoot, drop-down,
  unreachable, vertical, param-injection, determinism, and all canonical macros
  pass. Zero new failures vs. baseline.
- One reach-envelope source of truth (no ghost/validator disagreement).
- Mover core has zero ghost/editor assumptions — ready to drive enemy AI with a
  different `goal` + `params`.
