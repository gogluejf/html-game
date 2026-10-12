# Attack Engine — Handoff

**Last updated:** 2026-10-13
**Plan:** `.squid-os/plans/attack-engine/attack-engine.md`
**Architecture docs:**
- `petal-panic/docs/architecture/attack-primitives.md`
- `petal-panic/docs/architecture/attack-macros.md`

## Current state

- Special weapons registry is live (`js/objects/specialWeapons.js`) with 3 weapons: saw, bomb, spread.
- All hardcoded `'saw'/'bomb'` string checks are generalized to `isSpecialType()`.
- Hero has 2 special slots + default thorn. Spread fans 3 pellets at ±30°.
- No Attack Engine code exists yet. `js/combat/attack/` directory does not exist.
- The plan is ready to execute from Wave 1.

## What to do in this session

Read the plan. Start **Wave 1** (Tasks 1.1–1.8): core infrastructure + the 7 most-used primitives (Projectile, Spread, Bomb, Explosion, Melee Hitbox, Movement/Charge, Body Contact Damage).

Work through tasks in order. Commit after each task is verified green. Stop at the Wave 1 exit criteria.

## Key rules for the executor

1. **Consume, don't duplicate.** The cross-references table in the plan lists every existing system. Primitives wrap/call them — they never reimplement collision, damage, knockback, explosion, or effects.
2. **Markers already exist.** Sprite-crop editor stores `st.markers = [{ label, x, y, radiusOn, radius }]` per animation. Primitives read via `attacker.markers.find(m => m.label === origin)`. Do NOT build a new marker system.
3. **SPECIAL_WEAPONS registry is the data contract.** It's in `js/objects/specialWeapons.js`. Wave 6 will add a `macro` field to each entry. Don't restructure it now.
4. **Attack Theater is separate from Effect Theater.** Same UI pattern (panel, list, params, play/step), but its own code. It consumes the Effect Engine for rendering during playback. It does NOT import `theater.js`.
5. **No DOM in unit tests.** Primitives should be testable in node (pure logic where possible). Use the same test convention as existing suites: `node js/test/<name>.test.js`, assert-based, no framework.
6. **Projectiles spawn into existing pools.** `projectilePool` (64) and `specialPool` (16) in `js/objects/projectile.js`. No new allocation during gameplay.

## Files you'll create (Wave 1)

```
petal-panic/js/combat/attack/
├── engine.js          # Attack Engine dispatcher
├── registry.js        # Primitive + macro registration tables
├── context.js         # Shared AttackContext interface
└── primitives/
    ├── projectile.js
    ├── spread.js
    ├── bomb.js
    ├── explosion.js
    ├── meleeHitbox.js
    ├── movement.js
    └── bodyContact.js
```

Plus tests:
```
petal-panic/js/test/attack/
├── projectile.test.js
├── spread.test.js
├── bomb.test.js
├── explosion.test.js
├── meleeHitbox.test.js
├── movement.test.js
└── bodyContact.test.js
```

## Verify commands

```bash
# Individual primitive tests
node petal-panic/js/test/attack/projectile.test.js
node petal-panic/js/test/attack/spread.test.js
# ... etc

# Full suite (must stay green)
node --test petal-panic/js/test/*.test.js

# Existing combat tests (regression)
node petal-panic/js/test/projectile.test.js
node petal-panic/js/test/specialRotation.test.js
```

## Known baseline flakes (ignore these)

- `barrel.solid` timing flake
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
| Special weapons registry | `petal-panic/js/objects/specialWeapons.js` |
| Projectile pool + Special class | `petal-panic/js/objects/projectile.js` |
| Shooting (hero fire path) | `petal-panic/js/combat/shooting.js` |
| Central damage | `petal-panic/js/combat/damage.js` |
| Explosion resolver | `petal-panic/js/combat/explosion.js` |
| Knockback | `petal-panic/js/combat/knockback.js` |
| Collision world | `petal-panic/js/core/collision.js` |
| Effects registry | `petal-panic/js/effects/registry.js` |
| Effect Theater (pattern ref) | `petal-panic/js/debug/theater.js` |
| Sprite-crop markers (schema ref) | `.squid-os/skills/sprite-crop/scripts/server/js/markers.js` |
| Hero weapon slot model | `petal-panic/js/hero/hero.js` (search `specialSlots`) |

## Session prompt (copy-paste)

```
Read .squid-os/plans/attack-engine/attack-engine.md and the handoff at
.squid-os/plans/attack-engine/HANDOFF.md. Start Wave 1 (Tasks 1.1–1.8).
Work through them in order, committing after each task is verified green.
Stop at the Wave 1 exit criteria.
```
