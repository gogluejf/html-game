# Attack Engine — Plan

**Date:** 2026-10-13
**Mechanic docs (source of truth):**
- `petal-panic/docs/architecture/attack-primitives.md`
- `petal-panic/docs/architecture/attack-macros.md`
**Status:** ready to execute

## Context

The game currently has handcrafted attack code: hero weapons fire via inline
loops in `shooting.js`, enemies have bespoke AI that spawns projectiles with
hardcoded math, and bosses use one-off sequences. The Attack Engine replaces all
of this with a data-driven primitive + macro system so that:

- Every attack is expressible as a macro invocation with parameters.
- Adding a new enemy/boss attack = choosing/configuring existing macros, not
  writing new collision/projectile code.
- Hero special weapons become macro consumptions (thorn → `Projectile_Shot`,
  bomb → `Bomb_Throw`, spread → `Spread_Shot`).
- An Attack Theater (like the Effect Theater) showcases every macro/primitive
  in a sandbox for tuning and demo.

Full behavior specs live in the two architecture docs above. This plan is the
execution order.

---

## Cross-references & existing systems

The Attack Engine does NOT duplicate existing infrastructure. It consumes it:

| Existing system | Location | Relationship |
|----------------|----------|--------------|
| **Effect Theater** (F2) | `js/debug/theater.js` + `js/debug/theater-meta.js` | The Attack Theater (Milestone 3) is a SEPARATE overlay that follows the same UI pattern (side panel, scrollable list, param controls, play/step/reset) but has its own entity list (macros/primitives), param schema, sandbox arena, and playback logic. It does NOT import or extend the Effect Theater code. However, during playback it DOES consume the Effect Engine (`js/effects/`) for rendering beams, explosions, telegraphs, etc. |
| **Sprite editor markers** | `js/skills/sprite-crop/scripts/server/js/markers.js` | Markers are already implemented in the sprite-crop editor. Schema: `st.markers = [{ label, x, y, radiusOn, radius }]` per animation, stored in entity JSON as `e.markers`. Primitives read these at runtime via `attacker.markers.find(m => m.label === origin)`. No new marker system needed. |
| **SPECIAL_WEAPONS registry** | `js/objects/specialWeapons.js` | Already built. Each weapon entry will gain a `macro` field (Task 4.1). The registry is the data contract between hero slot model and the Attack Engine. |
| **Collision/Hitbox engine** | `js/core/collision.js`, `js/combat/hitboxes.js` | Primitives register temporary hitboxes with this system. No new collision layer. |
| **Effect Engine** | `js/effects/` + `js/effects/registry.js` | Primitives declare a `style` param; the Effect Engine renders it. The Attack Engine never draws pixels directly. |
| **Damage system** | `js/combat/damage.js` | All damage funnels through `damage()` or `takeDamage()`. Primitives call these; they don't do HP math themselves. |
| **Knockback system** | `js/combat/knockback.js` | Primitives declare a knockback setting; `applyKnockback()` handles the math. |
| **Explosion system** | `js/combat/explosion.js` | The Explosion primitive is a thin wrapper over `resolveExplosion()`. No second explosion path. |
| **Projectile pool** | `js/objects/projectile.js` (`projectilePool`, `specialPool`) | The Projectile primitive spawns into these existing pools. No new allocation during gameplay. |

**Rule:** if a capability already exists in one of the systems above, the
primitive wraps or calls it — it does not reimplement it.

---

## Milestone 1 — Primitives

Implement the 17 primitives as reusable functions/classes in `js/combat/attack/`.
Each primitive is a self-contained mechanical action that reads its parameters,
interacts with the collision/hitbox engine and effect engine, and reports
completion events (hit, expire, detonate).

### Task 1.1 — Core infrastructure
- Create `js/combat/attack/` directory structure:
  - `primitives/` — one file per primitive
  - `macros/` — one file per macro
  - `engine.js` — the Attack Engine dispatcher (invokes macros, tracks active
    attacks, handles completion callbacks)
  - `registry.js` — primitive + macro registration tables
- Define the shared `AttackContext` interface: `{ attacker, target, world,
  markers, effects, collisionWorld }`
- Define the shared `AttackResult` / event types: `hit`, `expire`, `detonate`,
  `complete`
- Primitives receive a params object + context; return a handle with `.cancel()`
  and `.on(event, cb)`

### Task 1.2 — Projectile primitive
- Straight-line projectile with speed, direction, ttl, damage, origin/marker,
  solidBehavior, gravity
- Spawns into the existing `projectilePool` or a new attack-projectile pool
- Emits `hit` on contact, `expire` on TTL/off-screen
- Reuses existing `damage()` routing
- **Transport rules (consume, don't duplicate):**
  - `solidBehavior` maps directly onto the existing entity flag consumed by
    `collisionHandlers.js` (`pass`/`absorb`/`bounce`). The primitive sets DATA;
    it never implements wall physics itself.
  - `gravity` reuses the `Special`-class ballistic path (`gravityValue` +
    vy integration in `update()`), not a new integrator.
  - Origin resolution: named marker via `resolveMarker(ctx, label)` (sprite-crop
    schema) falling back to attacker center; explicit `{x,y}` also accepted.

### Task 1.3 — Spread primitive
- Direction-generation only: given count + angle + center direction, returns an
  array of angles
- Composable: feeds into Projectile, Bomb, etc.

### Task 1.4 — Bomb / Ballistic Arc primitive
- Thrown object with gravity arc, bounce, explodeOnContact, ttl
- On detonation, triggers a payload (another primitive or macro)
- Reuses existing `Special` entity physics or a new generic ballistic entity

### Task 1.5 — Explosion primitive
- Thin wrapper over the existing `resolveExplosion()` in `combat/explosion.js`
- Parameters: radius, damage, knockback, alignment, style
- Emits `complete` after VFX finish

### Task 1.6 — Melee Hitbox primitive
- Temporary damaging AABB synchronized to animation frames
- Parameters: activeFrames, shape, offset/marker, damage, knockback, hitLimit
- Integrates with the existing unified hitbox system (`hero.attackHitboxWorld`)

### Task 1.7 — Movement / Charge primitive
- Applies velocity to the attacker for a duration/distance
- Parameters: direction, speed, duration, easing, stopOnObstacle
- Body contact damage optional via Body Contact Damage primitive

### Task 1.8 — Body Contact Damage primitive
- Toggles/enables the entity's body as a damaging area
- Parameters: damage, knockback, enabled, temporaryOverride
- Wraps the existing contact collision rule

### Task 1.9 — Beam primitive
- Continuous damaging line/ray for a duration
- Parameters: origin/marker, direction, length, width, duration, damage, style
- Effect Engine renders the visual; primitive owns the hitbox + lifetime

### Task 1.10 — Reticle / Telegraph primitive
- Visual warning at a position/target before an attack activates
- Parameters: position/target, duration, style, tracking, lockTime
- Purely visual + timing; no damage

### Task 1.11 — Homing / Steering primitive
- Modifies a projectile's direction each frame toward a target
- Parameters: steerVelocity, target, ttl
- Applied as a modifier on a Projectile instance

### Task 1.12 — Predictive Targeting primitive
- Calculates an aim point from target velocity
- Parameters: target, predictionTime, maxPrediction
- Returns a direction/point; feeds into Projectile

### Task 1.13 — Fire / Persistent Area primitive
- Damaging area that persists for a duration, ticking damage
- Parameters: length/width, height, duration, tickRate, damage, style
- Ground-anchored horizontal area (Molotov pattern)

### Task 1.14 — Spike / Static Hazard primitive
- Stationary damaging hazard with visible/hidden cycle
- Parameters: position, size, visibleTTL, hiddenTTL, repeat, damage, warningTime

### Task 1.15 — Orbit primitive
- Entities rotating around an owner
- Parameters: count, radius, angularSpeed, direction, startAngle, ttl,
  hideBehindOwner, damage
- Eject behavior: releases entities as linear projectiles on trigger

### Task 1.16 — Boomerang primitive
- Outbound → turnaround → return projectile
- Parameters: force, direction, count, outboundDuration, returnForce, ttl, damage

### Task 1.17 — Spawn / Split primitive
- Creates N child entities from a parent event
- Parameters: spawnType, count, direction, angle, force, inheritVelocity, delay

### Task 1.18 — Self-Destruct primitive
- Kills/removes the attacker, optionally triggering a payload first
- Parameters: timing, deathBehavior, triggerPayloadFirst

### Task 1.19 — Primitive integration test
- Each primitive has a unit test: spawn it in a minimal world, verify it
  produces the expected damage/collision/timing behavior
- No DOM required (pure logic tests where possible)

---

## Milestone 2 — Macros

Implement the 26 macros as compositions of primitives in `js/combat/attack/macros/`.
Each macro is a named function that takes a params object, orchestrates its
primitive sequence, and reports progress/completion to the caller.

### Task 2.1 — Macro framework
- `macros/index.js` — registry of all macro ids → implementations
- Shared `MacroHandle`: `.cancel()`, `.on('phase', cb)`, `.on('complete', cb)`
- Phase reporting: each macro emits phase transitions (telegraph → active →
  recovery) so AI/theater can react
- Default params table per macro (the "canonical" values from the doc)

### Task 2.2 — Simple shot macros
- `Predictive_Shot` (intercept math is a pattern, not targeting)
- `Burst_Shot` (N shots, fixed intra-burst interval; timing lives here, not in
  the projectile primitive)
- `Spread_Shot`
- `Radial_Shot` (360° spread)
(No Projectile_Shot / Bomb_Throw: single-shot and single-bomb are primitives
called directly with a caller-computed direction — Design contract rules 8+9.)

### Task 2.3 — Advanced projectile macros (6–9)
- `Homing_Missile`

(Boomerang, orbiting projectiles, and orbit-eject are used directly as
primitives — the orbit primitive already owns eject() — per the Design
contract "a macro must compose".)

### Task 2.4 — Missile Rain (10)
- Full canonical sequence: launch up → oscillate → leave screen → calculate
  landing positions → show reticles → wait → fall → impact
- Fixed vs relative distance, simultaneous vs sequential, coordination modes
- Most complex macro; gets its own dedicated file + thorough test

### Task 2.5 — Bomb macros (11–15)
- `Bomb_Throw`
- `Bomb_Spread`
- `Cluster_Bomb`
- `Molotov`
- `Explosive_Bomb`

### Task 2.6 — Beam macros (16–18)
- `Horizontal_Beam`
- `Targeted_Beam`
- `Sweeping_Beam`

### Task 2.7 — Melee / movement macros (19–20)
- `Melee`
- `Charge_Dash`

### Task 2.8 — Stomp / wave / area macros (21–24)
- `Stomp`
- `Stomp_Wave`
- `Dust_Cloud`
- `Spikes`

### Task 2.9 — Kamikaze / lane macros (25–26)
- `Body_Explosion` (Kamikaze)
- `Dash_Lane_Sequence`

### Task 2.10 — Macro integration tests
- Each macro tested in isolation: invoke it against a dummy target, verify the
  full sequence plays out (timing, damage, phases)
- Missile Rain and Dash Lane get extended tests covering all parameter variants

---

## Milestone 3 — Attack Theater

A debug/showcase overlay (like the Effect Theater at F2) that lists all macros
and primitives, lets you select one, configure its parameters via sliders/inputs,
and plays it in a sandbox arena.

### Task 3.1 — Theater shell
- New key binding (F4 or configurable) opens the Attack Theater
- Left panel: scrollable list of all macros (grouped by category) + all
  primitives
- Selecting an entry loads its default params into the right panel
- Right panel: parameter inputs (sliders for numbers, dropdowns for enums,
  toggles for booleans)
- Bottom: play/pause/step/reset controls + phase indicator

### Task 3.2 — Sandbox arena
- Flat ground, one dummy hero target (non-damaging, just stands there)
- Optional: a few barrels for explosion testing
- Camera follows the attacker
- Attacker is a placeholder sprite at center-left facing right
- All collisions/damage resolve normally (dummy target flashes, takes HP)

### Task 3.3 — Parameter binding
- Each macro's exposed params map to UI controls automatically (derived from
  the macro's param schema)
- Changing a param while idle updates the preview
- "Play" invokes the macro with current params
- Step mode: advance one phase at a time (telegraph → active → recovery)

### Task 3.4 — Primitive solo mode
- Selecting a primitive (not a macro) plays just that primitive in the sandbox
- Useful for tuning individual mechanics (e.g., orbit speed, beam width)

### Task 3.5 — Recording / export
- "Export params" button copies the current param set as JSON to clipboard
- Useful for pasting into level configs or boss definitions

---

## Milestone 4 — Replace hero weapons with macro consumption

Refactor the hero's firing path so that all weapons (thorn + specials) go
through the Attack Engine as macro invocations.

### Task 4.1 — Registry update
- Add an `attack` field (registry id + params) to each entry in
  `SPECIAL_WEAPONS`:
  - thorn → `projectile` primitive (hero direction from input)
  - saw → `projectile` (different params: short ttl, high dmg, stop)
  - bomb → `bomb` primitive (payload: explosion)
  - spread → `spreadShot` macro (count: 3, angle: 60°)
- Targeting rule: hero aim (direction) comes from input code; enemy aim comes
  from AI. The engine never takes a target entity.

### Task 4.2 — Refactor `fireThorn`
- Replace inline `projectilePool.spawn` + cooldown logic with:
  `attackEngine.invoke('projectile', { direction: <from input>, ...params }, heroContext)`
- Cooldown still managed by the hero (fireCooldown timer); the actual
  projectile creation goes through the primitive

### Task 4.3 — Refactor `fireSpecial`
- Replace the spread fan loop + single-spawn logic with:
  `attackEngine.invoke(meta.macro, { ...meta.params }, heroContext)`
- The macro handles multi-shot (spread), ballistic arc (bomb), etc.
- Remove the now-dead inline fan/spawn code

### Task 4.4 — Regression gate
- All existing hero weapon behavior preserved: same damage, same cooldown,
  same spread angles, same bomb arc, same AoE radius
- Run full test suite; compare projectile trajectories frame-by-frame if needed
- Debug G-key (special drop flood) still works

### Task 4.5 — Dead code cleanup
- Remove `explodeSpecial` inline AoE loop (now handled by Explosion primitive)
- Remove spread fan loop from `shooting.js` (now in Spread_Shot macro)
- Clean up any now-unused imports/constants

---

## Milestone 5 — Enemy/Boss migration (future)

Not in scope for initial execution. Documented here for planning:

- Each enemy's AI gets an `attackPlan`: an ordered list of macro invocations
  with timing/triggers
- Bosses get phase-based attack plans that swap macro sets
- Existing enemy AI (jester charge, violetta shots, boris dive) gets refactored
  to consume macros instead of inline projectile spawning
- Done incrementally: one enemy type at a time, regression-tested

---

## Session / Wave Breakdown

The plan is too large for a single session. Execution proceeds in focused waves,
each ending with a working, tested checkpoint. No wave starts until the previous
one is committed and green.

### Wave 1 — Core primitives (Session 1)

**Scope:** Tasks 1.1 – 1.8 (infrastructure + the 5 most-used primitives)
- 1.1 Core infrastructure (directory, context, events, registry)
- 1.2 Projectile
- 1.3 Spread
- 1.4 Bomb / Ballistic Arc
- 1.5 Explosion
- 1.6 Melee Hitbox
- 1.7 Movement / Charge
- 1.8 Body Contact Damage

**Exit criteria:** All 7 primitives pass unit tests. You can invoke
`projectile`, `spread`, `bomb`, `explosion`, `meleeHitbox`, `charge`, and
`bodyContact` from a test harness and verify correct damage/timing/position.

**Why this boundary:** These are the primitives your hero weapons and simple
enemies use. Everything else builds on them.

---

### Wave 2 — Remaining primitives (Session 2)

**Scope:** Tasks 1.9 – 1.19 (the other 10 primitives + integration tests)
- 1.9 Beam
- 1.10 Reticle / Telegraph
- 1.11 Homing / Steering
- 1.12 Predictive Targeting
- 1.13 Fire / Persistent Area
- 1.14 Spike / Static Hazard
- 1.15 Orbit
- 1.16 Boomerang
- 1.17 Spawn / Split
- 1.18 Self-Destruct
- 1.19 Primitive integration tests (all 17)

**Exit criteria:** All 17 primitives implemented + tested. Full primitive suite
green.

**Why this boundary:** Theater and complex macros need all primitives available.
Beam, Orbit, and Spawn/Split are prerequisites for their respective macros.

---

### Wave 3 — Simple + medium macros (Session 3)

**Scope:** Tasks 2.1 – 2.3, 2.5 – 2.9 (framework + macros)
- 2.1 Macro framework (registry, handle, phases)
- 2.2 Simple shot macros (Projectile_Shot, Predictive_Shot, Burst_Shot,
  Spread_Shot, Radial_Shot)
- 2.3 Advanced projectile macros (Homing_Missile; boomerang/orbit/orbit-eject
  stay primitives — Design contract: a macro must compose)
- 2.5 Bomb macros (Bomb_Throw, Bomb_Spread, Cluster_Bomb, Molotov,
  Explosive_Bomb)
- 2.6 Beam macros (Horizontal_Beam, Targeted_Beam, Sweeping_Beam)
- 2.7 Melee / movement macros (Melee, Charge_Dash)
- 2.8 Stomp / wave / area macros (Stomp, Stomp_Wave, Dust_Cloud, Spikes)
- 2.9 Kamikaze / lane macros (Body_Explosion, Dash_Lane_Sequence)

**Exit criteria:** 25 of 26 macros implemented. Each passes its integration
test (invoke against dummy target, verify sequence + damage).

**Why this boundary:** Missile Rain (Task 2.4) is the outlier — it's 3× more
complex than any other macro and deserves its own focused session.

---

### Wave 4 — Missile Rain + macro tests (Session 4)

**Scope:** Tasks 2.4, 2.10
- 2.4 Missile Rain (full canonical sequence, all distance/coordination modes)
- 2.10 Macro integration tests (extended coverage for Missile Rain + Dash Lane)

**Exit criteria:** All 26 macros green. Missile Rain handles simultaneous,
sequential (left/right/random), fixed, and relative distance correctly.

**Why this boundary:** Missile Rain has the most parameters and the most edge
cases (screen-exit detection, landing redistribution, sequential timing). Giving
it a dedicated session prevents it from blocking the rest.

---

### Wave 5 — Attack Theater (Session 5)

**Scope:** Tasks 3.1 – 3.5
- 3.1 Theater shell (F4, panel layout, list)
- 3.2 Sandbox arena (dummy target, ground, camera)
- 3.3 Parameter binding (auto-generated controls, play/step/reset)
- 3.4 Primitive solo mode
- 3.5 Export params to clipboard

**Exit criteria:** F4 opens the theater. You can select any macro or primitive,
tweak its params, hit play, and watch it execute in the sandbox. Step mode
advances one phase at a time. Export copies valid JSON.

**Why this boundary:** The Theater is a consumer of everything above. It needs
all macros stable. Building it earlier would mean constant rework as macros
change.

---

### Wave 6 — Hero weapon refactor (Session 6)

**Scope:** Tasks 4.1 – 4.5
- 4.1 Registry update (add `macro` field to SPECIAL_WEAPONS)
- 4.2 Refactor fireThorn → macro invocation
- 4.3 Refactor fireSpecial → macro invocation
- 4.4 Regression gate (behavior identical, full test suite green)
- 4.5 Dead code cleanup

**Exit criteria:** `shooting.js` contains no inline spawn loops. All hero
weapons fire through `attackEngine.invoke()`. Full test suite green. Debug G-key
still works. Projectile trajectories match pre-refactor frame-by-frame.

**Why this boundary:** This is the highest-risk task (regression on existing
gameplay). It must come last, after everything is proven stable in the Theater.

---

### Summary

| Wave | Session | Scope | ~Tasks |
|------|---------|-------|--------|
| 1 | 1 | Core primitives (infra + 7) | 8 |
| 2 | 2 | Remaining primitives + tests | 11 |
| 3 | 3 | Framework + 21 macros | 8 |
| 4 | 4 | Missile Rain + extended tests | 2 |
| 5 | 5 | Attack Theater | 5 |
| 6 | 6 | Hero weapon refactor + regression | 5 |

Total: **6 sessions**, ~39 tasks. Each session ends with a committed, tested
checkpoint. You can stop at any wave and still have a working system.

---

## Acceptance (full plan)

- All 17 primitives implemented + unit tested
- All 26 macros implemented + integration tested
- Attack Theater opens, lists everything, plays any macro/primitive with live
  param tuning
- Hero weapons fire through the Attack Engine (no inline spawn loops remain in
  `shooting.js`)
- Behavior identical to pre-refactor for all hero weapons (regression gate)
- Adding a new macro = one file in `macros/` + one entry in the registry; no
  other files touched
- Architecture docs match implementation
