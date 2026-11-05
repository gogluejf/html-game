# Unified Damage Routing — Plan

**Date:** 2026-11-03
**Updated:** 2026-11-05 — confirmed team rules and generic destructibles
**Status:** ready to execute; this document does not mean implementation is complete
**Scope:** one targeting policy and one public damage entry point. Preserve
per-class HP/energy math, death pipelines, impact reactions, and destruction
payloads while making every damage path reach the appropriate lifecycle.

## Problem

Three public damage entry points currently have inconsistent routing:

| Current entry | Target | Responsibility |
|---|---|---|
| `damage()` | hero / fallback | shield/energy or HP drain, defense, telemetry |
| `takeDamage()` | enemy | damage + flash + death pipeline |
| `hit()` | GameObj | HP chip + flash + destruction latch |

Separate team filters in hitboxes, explosions, and collision dispatch disagree.
For example, ally explosions exclude neutral destructibles, while direct ally
projectile hits damage them. Foe projectile dispatch also excludes objects.
Blast fallback damage can bypass an object's destruction lifecycle.

Recent fixes that MUST survive migration:
- Invalid damage throws before changing HP/energy/shields.
- Molotovs ignore flight TTL, produce fire only on contact, and never teleport
  off-screen cleanup effects to the floor.
- Destructible top and side impacts use a shared object-hit operation.
- Mines retain landing and delayed detonation; ordinary terrain retains bounce.
- Spawned child attacks preserve defaults instead of forwarding undefined damage.

## Confirmed targeting contract

**Affiliation is independent of entity class.** Class chooses how damage is
handled; team chooses whom an attack can hurt. Never infer team eligibility from
"has takeDamage", "is hero", "is barrel", or a collision layer alone.

| Attack team → target team | Ally | Foe | Neutral |
|---|---|---|---|
| Ally | No | Yes | Yes |
| Foe | Yes | No | Yes |
| Neutral | Yes | Yes | Yes |

- Both ally and foe attacks can damage neutral destructible objects.
- Neutral attacks can damage neutral targets too; neutral is not a protected team.
- The source/detonator itself is excluded, including neutral sources.
- Dead/destroyed targets and applicable invulnerability states remain protected.
- Team filtering is shared by projectiles, melee, explosions, and damage zones.
- Static terrain is not a damageable target. A solid destructible is damageable;
  do not confuse its physical SOLID layer with indestructible terrain.
- No blanket zone-versus-destructible exclusion. The old plan's dust/zone ban is
  removed. Any future attack-specific immunity must be explicit, separately
  designed, and must not masquerade as a team rule.

## Goal

```text
applyHit(target, source, amount, options) — only public damage entry
  1. Validate damage and targeting inputs
  2. Exclude self, dead/destroyed targets and applicable protected states
  3. Apply attack-team versus target-team matrix
  4. Route through the target class's proper damage/death lifecycle
  5. Preserve exactly-once destruction aftermath through shared host hooks
```

New destructibles use the generic `GameObj` contract, not a list of barrel IDs.
Hero/enemy/boss/destructible classifications must not override team membership.

## Task 1 — Explicit affiliation and shared targeting

Create `js/combat/targeting.js` with a single target classifier, target-team
accessor, and team eligibility predicate.

```js
export const TEAM_TARGETS = Object.freeze({
  ally: Object.freeze(['foe', 'neutral']),
  foe: Object.freeze(['ally', 'neutral']),
  neutral: Object.freeze(['ally', 'foe', 'neutral']),
});
```

- Target classes: `hero`, `enemy`, `boss`, `destructible`, `other`.
- Establish explicit affiliation at entity creation: player/allies → ally,
  enemies/bosses → foe, ordinary destructible objects → neutral. Allow explicit
  affiliation overrides for future allied/enemy objects and characters.
- Audit existing `team` fields before selecting the canonical entity field;
  distinguish target affiliation from a particular attack's `team` override.
- Centralize any temporary compatibility mapping; never duplicate class-based
  inference inside individual attack handlers.
- Unknown/invalid team values must fail clearly, not silently become neutral.
- Every currently supported damage kind permits all damageable target classes
  before team filtering. Do not retain the old projectile/melee `hero: false`
  rows: foe projectiles and melee must be able to hit allied targets.
- Physical collision masks remain broadphase concerns. Ensure they do not
  prevent valid foe-versus-destructible or neutral-versus-character candidates
  from reaching the shared targeting policy.

## Task 2 — One public damage router

Implement `applyHit(target, source, amount, options)` in `js/combat/damage.js`.
Options carry explicit attack team plus method/kind for telemetry and behavior.
Resolve any omitted team through one documented policy; do not silently treat
all omitted teams as neutral. Migrate callers to explicit attack affiliation.

- Preserve `assertDamageAmount`: reject undefined, null, NaN, infinity, strings,
  and negative damage BEFORE mutation. Errors identify source, target, method.
- Hero route: preserve shield/energy drain and defense.
- Enemy/boss route: preserve their own damage/death pipeline; include bosses
  explicitly rather than dropping them into a zero-damage default.
- Destructible route: preserve `GameObj.hit()` semantics, flash and destruction
  latch. Generic HP subtraction is not a substitute for object destruction.
- Internal names can become `heroDamage`, `enemyDamage`, `objectDamage`;
  `applyHit` is the only public caller-facing entry. Avoid recursive routing
  when existing enemy damage methods call the current `damage()` core.
- Keep impact reactions (i-frames, knockback, special loss) at their existing
  owners and trigger them only after actual damage.
- Ensure per-hit rewards and destruction payloads/world removal run exactly
  once for direct hits, blasts and zones. Reuse shared host orchestration rather
  than copying barrel-specific branches into each attack.
- Temporary migration adapters must preserve team and lifecycle semantics;
  remove them once all callers migrate.

## Task 3 — Migrate every damage path

- `processHitboxes`: replace hardcoded layer/team filtering and per-target
  method selection with shared eligibility and `applyHit`.
- `resolveExplosion`: replace enemy-only/hero-only filters with the team matrix;
  route destructibles through object damage and destruction handling. Preserve
  radius geometry, source exclusion and knockback behavior.
- `HazardZone`: retain zone identity and use the same team rules; neutral
  destructibles are not globally immune to zones.
- `collisionHandlers`: migrate projectile/melee/contact paths, including foe
  hits on neutral objects. Do not consume same-team projectiles solely because
  a damage-ineligible friendly target overlaps them; audit existing policy.
- `objectImpact`: retain one top/side operation and route its damage through
  the shared API. Retained carriers/mines must keep their special landing path.
- Candidate gathering: include live generic destructibles, not only the three
  barrel arrays. Include valid allied/foe characters and bosses; exclude dead
  animations and destroyed objects. Snapshot candidates where chain reactions
  may modify collections during iteration.
- Preserve explicit attack-team overrides (a neutral barrel blast remains
  neutral even if the player destroyed the barrel).

## Task 4 — Tests and regression gates

- Exhaustive 3×3 attack-team/target-team truth table, including neutral→neutral
  and self-exclusion for every team.
- Verify affiliation independently from class: allied enemies, foe-owned
  destructibles, neutral objects, and non-player allied characters.
- Verify direct projectile, melee, explosion and zone routing against neutral
  destructibles for BOTH ally and foe attacks.
- Bomb blast damages nearby objects inside radius, not objects outside radius;
  destruction payload, removal and rewards happen exactly once.
- Explosive barrel chain reactions retain correct team and self exclusion.
- Generic non-barrel GameObj follows the same top/side and blast lifecycle.
- Mine landing causes no immediate object damage; delayed blast uses the same
  team matrix. Static terrain bounce and molotov contact-only rules stay intact.
- Dead/dying enemies cannot repeatedly flash or restart their death pipeline
  from new hits; destroyed objects cannot trigger duplicate payloads.
- Invalid damage throws with resources unchanged; valid zero remains supported.
- Hero shield/energy, invulnerability and enemy/boss death behavior stay intact.
- Record a fresh baseline before migration. Do not reuse historical failure
  counts as evidence. Run focused tests per task and full relevant suites at
  the migration gate; identify new failures explicitly.

## Task 5 — Naming and consistency sweep

- Replace caller-facing `damage` / `takeDamage` / `hit` routing with `applyHit`.
- Use generic `destructible` / `objectDamage` terminology instead of `barrel`
  where the contract covers all GameObj instances.
- Remove duplicated team predicates and classifier-by-method heuristics.
- Do not rename `takeHit` (impact reaction), `flashTarget`, or `applyKnockback`.
- Ensure comments, theater metadata and tests describe the same team matrix.

## Task 6 — Remove adapters and document

- Remove obsolete hitbox layer lists and explosion-local team switches after
  all callers use shared targeting. Retain compatibility exports only if their
  callers are explicitly migrated in this task.
- Delete temporary damage adapters and dead routing code.
- Update explosion and attack documentation with the team truth table, generic
  destructible contract, and exactly-once destruction responsibilities.

## Out of scope

- Redesigning knockback, physics, projectile pooling, mine timing, or molotov
  flight behavior.
- Moving every class's side effects into one monolithic router.
- Inventing new attack-specific immunities or changing blast radius geometry.

## Risk

Medium: this is a targeting/lifecycle correction, not merely a rename.
Primary risks are missed collision candidates, duplicate chain reactions,
recursion through legacy damage wrappers, and affiliation defaults that alter
friendly-fire rules. Mitigate with explicit team initialization, shared routing,
exactly-once destruction hooks, and production-path regression tests.

## Execution order

1 → 2 → 3 → 4 (test gate) → 5 → 6.
No automatic commits or pushes. Each commit needs explicit user instruction.
