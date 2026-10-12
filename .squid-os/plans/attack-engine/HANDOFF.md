# Attack Engine — Handoff

**Last updated:** 2026-10-13 (end of Wave 1)
**Plan:** `.squid-os/plans/attack-engine/attack-engine.md`
**Architecture docs:**
- `petal-panic/docs/architecture/attack-primitives.md`
- `petal-panic/docs/architecture/attack-macros.md`

## Current state — WAVE 1 COMPLETE ✅

All 7 core primitives implemented + unit tested, committed individually:

| Commit | Task | Primitive |
|--------|------|-----------|
| `1a71a3a` | 1.1 | Core infra (context.js, registry.js, engine.js + AttackHandle) |
| `96bd228` | 1.2 | Projectile (pool transport; solidBehavior = data flag, no physics rewrite) |
| `cb5735f` | 1.3 | Spread (direction generation, synchronous) |
| `55eb7bb` | 1.4 | Bomb / Ballistic Arc (Special-class physics reuse, payload routing) |
| `172493a` | 1.5 | Explosion (thin wrapper over resolveExplosion) |
| `f8a45d6` | 1.6 | Melee Hitbox (unified hitbox system reuse) |
| `171e0f1` | 1.7 | Movement / Charge (motion profile only) |
| `03c15f9` | 1.8 | Body Contact Damage (data override + restore) |
| `77d54be` | — | **Attack Theater v0 (F4)** — live sandbox, all 7 playable |

**Attack Theater v0 is live:** F4 opens it from any screen. Arrows select
primitives, ↑/↓ selects a param, Shift+arrows adjusts it, Enter replays,
Esc closes. Real pools + real CollisionWorld + real damage routing; dummy
target flashes and loses HP; event log at bottom-left of arena.

Test suites: `petal-panic/js/test/attack/*.test.js` — 63 assertions across
8 files, all green. Full suite unchanged vs baseline (402 pass / 2 known
flaky picker failures).

## What to do in this session

Start **Wave 2** (Tasks 1.9–1.19): the remaining 10 primitives.

Order suggestion (by dependency):
1. **1.10 Reticle / Telegraph** — pure visual + timing, simple
2. **1.11 Homing / Steering** — modifier on a Projectile instance
3. **1.12 Predictive Targeting** — aim-point math, feeds Projectile
4. **1.9 Beam** — continuous damaging line (Effect Engine renders)
5. **1.13 Fire / Persistent Area** — ground-anchored ticking damage
6. **1.14 Spike / Static Hazard** — visible/hidden cycle
7. **1.15 Orbit** — rotating entities around owner (+ eject behavior)
8. **1.16 Boomerang** — outbound → turnaround → return
9. **1.17 Spawn / Split** — N children from parent event
10. **1.18 Self-Destruct** — kill attacker, optional payload first
11. **1.19 Integration tests** — verify all 17 together

Each new primitive: one file in `js/combat/attack/primitives/`, registers
itself, gets a test in `js/test/attack/`, and **automatically appears in the
Attack Theater** (add its preset + tweakable keys to `SANDBOX_PRESETS` /
`TWEAKABLE` in `js/debug/attack-theater.js`).

Commit after each task is verified green. Stop at the Wave 2 exit criteria
(all 17 primitives + full suite green).

## Key rules for the executor

1. **Consume, don't duplicate.** Primitives wrap/call existing systems
   (collision, damage, knockback, explosion, effects, pools). Never reimplement.
2. **Markers already exist** (sprite-crop schema). Read via
   `attacker.markers.find(m => m.label === origin)` or `resolveMarker()`.
3. **No DOM in unit tests.** Pure logic; `node js/test/attack/<name>.test.js`.
4. **Projectiles spawn into existing pools** (`projectilePool` 64 /
   `specialPool` 16). No new allocation during gameplay.
5. **Handles follow the uniform contract:** `.on('hit'|'expire'|'detonate'|
   'complete')` + `.cancel()`. Terminal events fire exactly once; late
   subscriptions never replay them. Synchronous primitives complete during
   `invoke()` — that's fine, assert on data not events for those.
6. **stepX() pattern:** long-lived primitives (projectile, bomb, meleeHitbox,
   charge) expose `stepX(entity/state, params, ctx, handle)` called by the
   host loop until it returns true. The Attack Theater's `_stepOnce()` shows
   the canonical host-loop shape — copy it if you build other harnesses.

## Known gotchas learned in Wave 1

- **`damage(source, ...)` with `source = null` throws** in this Node version
  (v24.12.0 — property access on null throws even inside `&&` guards; plain
  objects work normally). The Explosion primitive passes an inert stand-in
  `{ traceStats: undefined }` when there's no detonator. Do the same if you
  route damage with a null source.
- **Pool slots recycle via Object.assign** — always set fields explicitly
  after spawn (the Projectile primitive sets `solidBehavior ?? 'pass'`
  because a recycled slot could carry a stale value).
- **Test dummies need:** `takeDamage()` method (enemies), `traceStats:
  createTrace()` (hero, from `stats.js`), `loseSelectedSpecial()`/`takeHit()`
  stubs (hero, for explosion routing), correct `layer` bitmask (team routing).
- **The Effect Theater freezes gameplay** while open (`update()` early-returns).
  The Attack Theater does the same — sandbox steps at fixed 60Hz via
  accumulator.

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

- `picker: wide low gap needing super` (takeoffPicker) — flips between runs
- `ride: full end-to-end ride classifies every platform` (pickerRide)
- Space-jump pause interaction
- `effectTheater c2d.ellipse` (canvas API in node)
- Input tabs test
- `bck/` test directory (broken `../consts.js` import path — pre-existing)

Compare failure sets before/after. Never chase baseline flakes.

## Where things live (quick reference)

| Thing | Path |
|-------|------|
| Plan | `.squid-os/plans/attack-engine/attack-engine.md` |
| Primitives doc | `petal-panic/docs/architecture/attack-primitives.md` |
| Macros doc | `petal-panic/docs/architecture/attack-macros.md` |
| Attack engine core | `petal-panic/js/combat/attack/{engine,registry,context}.js` |
| Primitives (7 so far) | `petal-panic/js/combat/attack/primitives/` |
| Attack Theater v0 | `petal-panic/js/debug/attack-theater.js` (F4) |
| Theater key wiring | `petal-panic/js/debug/debugHarness.js` (handleAttackTheaterKeys) |
| Theater loop wiring | `petal-panic/js/systems/update.js` + `render.js` |
| Special weapons registry | `petal-panic/js/objects/specialWeapons.js` |
| Projectile pool + classes | `petal-panic/js/objects/projectile.js` |
| Shooting (hero fire path) | `petal-panic/js/combat/shooting.js` |
| Central damage | `petal-panic/js/combat/damage.js` |
| Explosion resolver | `petal-panic/js/combat/explosion.js` |
| Knockback | `petal-panic/js/combat/knockback.js` |
| Unified hitboxes | `petal-panic/js/combat/hitbox.js` + `hitboxes.js` |
| Collision world | `petal-panic/js/core/collision.js` |
| Effects facade | `petal-panic/js/effects.js` |
| Effect Theater (pattern ref) | `petal-panic/js/debug/theater.js` |
| Hero weapon slot model | `petal-panic/js/hero/hero.js` (search `specialSlots`) |

## Session prompt (copy-paste)

```
Read .squid-os/plans/attack-engine/attack-engine.md and the handoff at
.squid-os/plans/attack-engine/HANDOFF.md. Wave 1 is complete (7 primitives +
Attack Theater v0 on F4). Start Wave 2 (Tasks 1.9–1.19): the remaining 10
primitives + integration tests. Work through them in the suggested order,
committing after each task is verified green. Each new primitive must also get
a SANDBOX_PRESETS + TWEAKABLE entry in js/debug/attack-theater.js so it shows
up in the F4 theater. Stop at the Wave 2 exit criteria.
```
