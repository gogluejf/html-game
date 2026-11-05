# Attack Lifecycle — Self-Contained Invoke

The attack engine's lifecycle is **self-contained**: callers fire attacks with
`invoke(id, params, ctx)` and never wire step/draw. The engine-owned
`AttackLifecycle` registry (js/combat/attack/lifecycle.js) steps, draws, and
prunes every live handle automatically from the game loop.

## The one rule

Callers fire attacks via `invoke(id, params, ctx)`. They **NEVER** step or draw
the returned handle. `AttackLifecycle` steps, draws, and prunes every live
handle:

- `systems/update.js` calls `AttackLifecycle.stepAll(dt, getDamageables(), { refreshCtx })` once per frame.
- `systems/render.js` calls `AttackLifecycle.drawAll(ctx)` in world space.

No host, no getter, no per-caller step/draw lists.

## How registration works

`engine.invoke()` is the SINGLE registration point. A handle is registered into
the registry only when it is a **root**:

- invoked from outside another invoke's impl (`_invokeDepth` guard), AND
- invoked outside a per-frame step callback (`_step.depth` guard).

Nested invokes (a macro composing a carrier/payload inside its impl, or
materializing a payload mid-step like skyMissile/clusterBomb) are stepped by
their parent macro and are NOT registered — registering them too would
double-step. Handles that complete synchronously (instant macros like
`explosion`) are skipped by `register()`.

A handle is "live" (needs per-frame driving) when it has a `.step` fn or a
`.zone`. Live handles self-prune from the registry once `_completed` /
`_cancelled`.

## Adding a new macro

1. Register it (primitive or macro) with `meta.effects`.
2. If it needs per-frame driving, give its handle a `.step` fn and/or a `.zone`.
3. Done. No host, no getter, no game-loop edit.

Fire it anywhere with a bare `invoke(id, params, ctx)` — the registry takes it
from there.

## Single exception: host-built contexts

`BombAttackHost` (hero shots) no longer owns stepping or drawing. It is a thin
ctx-factory: `spawn()` builds the rich context (groundY, platforms, camera,
targets) via `makeContext`, stamps the root with `_ctx` + `_ctxRefresh`, and
delegates to `invoke()`. The registry then steps AND draws those roots like any
other — `stepAll`'s `refreshCtx` option hands each handle's `_ctxRefresh` the
fresh world-state bag every frame, and the generic arc-recipe fallback
(`stepBombTerrain` behind the `bombTerrainStepped` guard, then `stepBomb`)
covers bomb carriers exactly as the old host did. `host.clear()` remains for
level-teardown bookkeeping only.

One owner per handle, always: the registry.

## Tests

- `js/test/attackLifecycle.test.js` — registry semantics + plug-and-play
  contract: representative primitives (fireArea, dustZone, shockwave) fired
  from a bare ctx are stepped, drawn, and pruned with zero caller wiring.
- `js/test/attackLifecycleGuard.test.js` — discarded-handle guard: every
  registered handle across hero/barrel/enemy entry points must be live,
  completed, or reachable from a live root — a fired-and-abandoned handle fails
  the suite before it reaches gameplay.
