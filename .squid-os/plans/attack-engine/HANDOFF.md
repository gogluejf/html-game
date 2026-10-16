# Attack Engine — Handoff

**Last updated:** 2026-10-13 (end of Wave 2)
**Plan:** `.squid-os/plans/attack-engine/attack-engine.md`
**Architecture docs:**
- `petal-panic/docs/architecture/attack-primitives.md`
- `petal-panic/docs/architecture/attack-macros.md`

## Current state — WAVES 1 + 2 COMPLETE ✅

All **17 primitives** implemented + unit tested. Attack Theater (F4) lists and
plays all 17 with live param tweaking.

### Wave 1 (committed individually, see git log)
Core infra + projectile, spread, bomb, explosion, meleeHitbox, charge
(movement.js), bodyContact + Attack Theater v0.

### Wave 2 (this session — NOT yet committed; working tree has all of it)
| Task | Primitive | File | Tests |
|------|-----------|------|-------|
| 1.10 | Reticle / Telegraph | `primitives/reticle.js` | 9 |
| 1.11 | Homing / Steering | `primitives/homing.js` | 8 |
| 1.12 | Predictive Targeting | `primitives/predictive.js` | 6 |
| 1.9 | Beam | `primitives/beam.js` | 9 |
| 1.13 | Fire / Persistent Area | `primitives/fireArea.js` | 6 |
| 1.14 | Spike / Static Hazard | `primitives/spike.js` | 7 |
| 1.15 | Orbit (+ eject) | `primitives/orbit.js` | 8 |
| 1.16 | Boomerang | `primitives/boomerang.js` | 7 |
| 1.17 | Spawn / Split | `primitives/spawnSplit.js` | 7 |
| 1.18 | Self-Destruct | `primitives/selfDestruct.js` | 7 |
| 1.19 | Integration (all 17 + compositions) | `test/attack/integration.test.js` | 8 |

Attack Theater wiring (`js/debug/attack-theater.js`): all 17 imported,
SANDBOX_PRESETS + TWEAKABLE entries for the 10 new ones, replay logic
(homing binds a spawned projectile; predictive fires along its aim point;
spawnSplit fans children as projectiles; selfDestruct runs a kamikaze dummy
with an explosion payload aimed at the target), step-loop handling
(beam/fireArea/spike tick damage vs the dummy; orbit + boomerang do contact
checks), and draw pass (orbit ring + diamonds, boomerang spinner with phase
label, fire/spike tinted boxes by phase, reticle closing ring, aim crosshair,
kamikaze dummy).

Test suites: `petal-panic/js/test/attack/*.test.js` — 19 files, 152
assertions, all green. Full suite: 402 pass / 2 known flakes (takeoffPicker +
pickerRide baseline).

## What to do in this session

Start **Wave 3** (Tasks 2.1–2.3, 2.5–2.9): macro framework + 21 of 26 macros.

Order suggestion:
1. **2.1 Macro framework** — `macros/index.js` registry usage, shared
   MacroHandle semantics (reuse AttackHandle), phase reporting
   (telegraph → active → recovery), default params table per macro.
2. **2.2 Simple shot macros** — Projectile_Shot, Predictive_Shot, Burst_Shot,
   Spread_Shot, Radial_Shot
3. **2.3 Advanced projectile macros** — Homing_Missile (boomerang, orbit, and
   orbit-eject stay primitives: the orbit primitive already owns eject();
   Design contract: a macro must compose)
4. **2.5 Bomb macros** — Bomb_Throw, Bomb_Spread, Cluster_Bomb, Molotov,
   Explosive_Bomb
5. **2.6 Beam macros** — Horizontal_Beam, Targeted_Beam, Sweeping_Beam
6. **2.7 Melee / movement macros** — Melee, Charge_Dash
7. **2.8 Stomp / wave / area macros** — Stomp, Stomp_Wave, Dust_Cloud, Spikes
8. **2.9 Kamikaze / lane macros** — Body_Explosion, Dash_Lane_Sequence

Each macro: one file in `js/combat/attack/macros/`, registers via
`registerMacro()`, gets a test in `js/test/attack/`. Macros compose
primitives via `attackEngine.invoke()` — they never touch pools/collision
directly. Add each to the Attack Theater list once done (theater currently
lists primitives only; macros need a second section or a combined list).

Commit after each task is verified green. Stop at the Wave 3 exit criteria
(25 of 26 macros + full suite green). Missile Rain (2.4) is Wave 4.

## Key rules for the executor

1. **Consume, don't duplicate.** Primitives wrap existing systems; macros
   wrap primitives. Never reimplement collision/damage/pooling.
2. **Handles follow the uniform contract:** `.on('hit'|'expire'|'detonate'|
   'complete')` + `.cancel()`. Terminal events fire exactly once; late
   subscriptions never replay them. Synchronous primitives/macros complete
   during `invoke()` — assert on data/state, not events, for those.
3. **stepX() pattern:** long-lived primitives expose `step(...)` called by the
   host loop until true. The Attack Theater's `_stepOnce()` is the canonical
   host shape.
4. **No DOM in unit tests.** Pure logic; `node js/test/attack/<name>.test.js`.
5. **Anti-spin debugging rules** (user-enforced, in global memory): one debug
   run per hypothesis, max 3 iterations per bug, never repeat a tool call with
   identical args, state the hypothesis first.

## Known gotchas learned in Waves 1–2

- **`damage(source, ...)` with `source = null` throws** in Node v24.12.0.
  Pass an inert stand-in `{ traceStats: undefined }` when there's no source.
- **Pool slots recycle via Object.assign** — always set fields explicitly
  after spawn.
- **Frame quantization:** tick-rate accumulators (beam/fireArea/spike) can be
  ±1 tick off from naive `duration × rate` math at 60Hz. Assert ranges, not
  exact counts, near boundaries.
- **Spike `repeatCount` = TOTAL cycles** (not repeats-after-first). With
  repeatCount N you get N−1 full damaging windows before teardown... actually
  N windows minus the final hidden tail — test with `repeatCount: 3` if you
  want ≥2 visible windows.
- **Homing is a modifier**: `invoke('homing',...).bind(projectileEntity)` then
  `step(dt)`. It steers velocity; it does not move the entity (the pool's
  updateAll does that).
- **Orbit/boomerang are motion profiles**: they own positions/vectors, the
  host renders + does contact checks (see theater `_stepOnce`).
- **SelfDestruct with async payload** sets `h.step(dt)`; synchronous payloads
  (explosion) complete immediately inside invoke().
- **The screen-y-down convention bites:** target at y=200 vs attacker y=116
  is DOWN-right, so steering produces vy > 0. Check signs against screen
  coords, not "up is negative" intuition.

## Verify commands

```bash
# Individual primitive tests
node petal-panic/js/test/attack/projectile.test.js   # etc.

# Full attack suite
for t in petal-panic/js/test/attack/*.test.js; do node "$t"; done

# Full game suite (must stay 402 pass / 2 known flakes)
node --test petal-panic/js/test/*.test.js
```

## Known baseline flakes (ignore these)

- `picker: wide low gap needing super` (takeoffPicker)
- `ride: full end-to-end ride classifies every platform` (pickerRide)

Compare failure sets before/after. Never chase baseline flakes.

## Where things live (quick reference)

| Thing | Path |
|-------|------|
| Plan | `.squid-os/plans/attack-engine/attack-engine.md` |
| Primitives doc | `petal-panic/docs/architecture/attack-primitives.md` |
| Macros doc | `petal-panic/docs/architecture/attack-macros.md` |
| Attack engine core | `petal-panic/js/combat/attack/{engine,registry,context}.js` |
| Primitives (17) | `petal-panic/js/combat/attack/primitives/` |
| Macros (0 so far) | `petal-panic/js/combat/attack/macros/` (create in Wave 3) |
| Attack Theater (F4) | `petal-panic/js/debug/attack-theater.js` |
| Special weapons registry | `petal-panic/js/objects/specialWeapons.js` |
| Projectile pool + classes | `petal-panic/js/objects/projectile.js` |
| Central damage | `petal-panic/js/combat/damage.js` |
| Explosion resolver | `petal-panic/js/combat/explosion.js` |
| Unified hitboxes | `petal-panic/js/combat/hitbox.js` |
| Effects facade | `petal-panic/js/effects.js` + `js/effects/index.js` |

## Session prompt (copy-paste)

```
Read .squid-os/plans/attack-engine/attack-engine.md and the handoff at
.squid-os/plans/attack-engine/HANDOFF.md. Waves 1+2 are complete (all 17
primitives + Attack Theater on F4 playing all of them). Commit the Wave 2
working tree first (primitives + tests + theater wiring), then start Wave 3
(Tasks 2.1–2.3, 2.5–2.9): macro framework + 21 macros. Work through them in
the suggested order, committing after each task is verified green. Each macro
composes primitives via attackEngine.invoke() and gets a test in
js/test/attack/. Stop at the Wave 3 exit criteria (25 of 26 macros).
```
