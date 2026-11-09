# Unified Damage Routing — Plan

**Date:** 2026-11-03
**Updated:** 2026-11-05 — confirmed team rules and generic destructibles
**Status:** design finalized for plan generation — implementation not started
**Scope:** one hit-resolution contract: attack team + target team + target class + attack provenance + target state → hit effects. Preserve
per-class HP/energy math, death pipelines, impact reactions, and destruction
payloads while making every damage path reach the appropriate lifecycle.

## Known field bugs (observed 2026-11-05)

Concrete reproduction cases found in playtesting that this plan must fix. Each
one is a symptom of aftermath/reward logic being duplicated per call site
instead of owned by a single router:

1. **Melee on super-coin barrel pops no coins.** Per-hit popcorn
   (`popSuperCoinHit`) is only wired into the projectile side-hit path
   (`collisionHandlers.js`) and the bomb top-landing path (`update.js`). The
   melee path (`processAllHitboxes` → `processHitboxes`) calls `t.hit()`
   directly and never fires any reward hook — non-killing melee hits pop
   nothing even though the def declares `hitCoins`.
2. **Dust zone kills propane barrel → no molotov fan.** `HazardZone.update()`
   routes ticks through `processHitboxes` with a callback that only records
   hits — it never checks `target.destroyed` / calls `handleBarrelDestroyed`.
   The barrel's HP drains correctly and `destroyed` latches, but the payload
   pipeline (molotov spawnSplit, VFX, collision-world removal) never runs.
   Fire zones (`fireArea.js` per-segment hitboxes) have the identical hole.
3. **Some explosive/hazard attacks kill propane without its molotov fan**
   (user report; dust path explained above; exact explosive variant still needs
   reproduction). Do not assume all blasts deal zero damage: ally blast filters
   exclude ordinary objects, whereas an eligible fallback `damage()` CAN drain
   object HP but bypass `GameObj.hit()` / destruction aftermath.
4. **Scattered aftermath ownership** (code finding): projectile side/top hits
   and gameplay melee explicitly run destruction handling; zone callbacks do
   not. Engine hitboxes and raw-damage paths require an exhaustive caller audit.

Correction to earlier discussion: `getDamageables()` includes live barrels.
Dust can damage and destroy propane; it is the payload handling that is missing.
The absence of a contact callback in `carrierMacro` alone does NOT prove carrier
object impacts are broken: gameplay also runs the shared top/side impact paths.
Carrier contact remains a regression case, not a confirmed additional bug.

Acceptance: reproduce the reported cases, then verify per-hit rewards and
exactly-once destruction payloads through production paths. Do not fix these by
adding manual barrel aftermath calls to each attack.

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

## Goal — complete hit resolution, not only damage routing

```text
attack team + target team + target class + attack provenance + target state
                             ↓
                      resolved hit effects
```

One public entry accepts all required hit context, decides the outcome, and
orchestrates specialized executors. Callers must not independently remember
knockback, rewards, or destruction aftermath. Exact API signature is pending
joint validation; the previous amount/options signature is not final.

Inputs to declare explicitly:
- Attack and target affiliation, independently of their classes.
- Target class and target-specific behavior/configuration (e.g. supercoin rewards).
- Attack provenance: melee, super move, projectile, explosion, hazard, etc.
  These are examples, NOT an approved exhaustive enum. Provenance is a real
  behavior input, not merely a telemetry label.
- Target state: life/destruction state, protection, resources, resistance.
- Damage and reaction settings, source identity, and necessary contact geometry
  or motion context. Numeric tuning is data, not an enum.

Outputs/effects resolved together:
- Accepted/rejected hit and reason; HP/shield/energy changes.
- Knockback, stun, protection and other applicable impact reactions.
- Hit flash/visual feedback and per-hit rewards (including supercoin popcorn).
- Death/destruction transition, payload, rewards and world removal exactly once.
- Applicable carrier contact outcome, coordinated with its lifecycle owner
  (retain/consume/detonate/fizzle are examples requiring validation).

Central resolution does NOT mean putting physics, rendering, coins and attack
spawning in one giant function. Existing specialized executors can remain;
the resolver owns the decision and reliable orchestration, not each caller.
New destructibles use a generic contract, not a hardcoded barrel-ID routing list.

## Routing declarations — finalized for implementation planning

| Declaration | Decision |
|---|---|
| Teams | `Team` enum; preserve the confirmed matrix above |
| Target classes | `TargetClass` enum with explicit registration and an `OTHER` fallback policy |
| Attack provenance | Full 14-value candidate set below; add values only when distinct behavior is needed |
| Target state | Existing life/destruction/protection/resource/resistance fields, normalized into context |
| Hit/reaction configuration | Caller supplies requested damage/reactions; target state modifies them; resolver produces final result |
| Impact policy and result | Attack/carrier lifecycle owns impact behavior; resolver reports accepted hit and resolved target effects |
| Behavior matrix | Preserve existing code behavior as baseline; inventory cells as keep / fix / undefined rather than inventing a full table |

### Finalized initial enums

```js
Team = { ALLY: 'ALLY', FOE: 'FOE', NEUTRAL: 'NEUTRAL' }

TargetClass = {
  HERO: 'HERO',
  ENEMY: 'ENEMY',
  BOSS: 'BOSS',
  DESTRUCTIBLE: 'DESTRUCTIBLE',
  OTHER: 'OTHER',
}

AttackProvenance = {
  MELEE: 'MELEE',
  SPECIAL_MELEE: 'SPECIAL_MELEE',
  SUPER_MOVE: 'SUPER_MOVE',
  PROJECTILE: 'PROJECTILE',
  EXPLOSION: 'EXPLOSION',
  HAZARD_FIRE: 'HAZARD_FIRE',
  HAZARD_DUST: 'HAZARD_DUST',
  SPIKE: 'SPIKE',
  CONTACT: 'CONTACT',
  DASH: 'DASH',
  STOMP: 'STOMP',
  BEAM: 'BEAM',
  SHOCKWAVE: 'SHOCKWAVE',
  OBJECT_IMPACT: 'OBJECT_IMPACT',
}
```

Fire, dust and spike may share a hazard family while retaining distinct values.
The provenance list is extensible; do not infer behavior from collision layer or
method-name heuristics. Invalid/missing required inputs must fail before mutation.

### Proposed effect taxonomy

```js
HitEffect = {
  RESOURCE_LOSS,
  KNOCKBACK,
  STUN,
  PROTECTION,
  FEEDBACK,       // flash, sparkles, sound, shake
  REWARD,         // target-specific hit reward such as supercoin coins
  DEATH,
  DESTRUCTION_PAYLOAD,
  WORLD_REMOVAL,
}
```

This taxonomy describes effect ownership, not exact tuning values. Impact
behavior is intentionally not a fixed enum: an attack may disappear, explode,
spawn children, create zones, bounce, detonate later, fizzle or transform. The
attack/carrier lifecycle owns that policy and consumes `HitResult` as input.

### Confirmed dependency direction

- **Caller/router decides eligibility and requested effects.**
- **Target implements its own reaction behavior through hooks/configuration.**
- **Resolver resolves the final outcome and orchestrates specialized executors.**

The old model (“when I perform this attack, manually apply every world effect”)
is replaced by “this resolved hit happened; the target responds according to its
own contract.” This prevents forgotten per-caller rewards and destruction payloads.

### Confirmed behavior-preservation rule

Use current production behavior as the default baseline. The migration must
preserve existing working cases and only change explicitly confirmed gaps:
- Fire can damage destructibles for now; toxic dust affects living targets only.
  Spike behavior remains separately inventoried. Use “destructible” rather than
  “barrel” because future non-barrel objects will use the same contract.
- Melee on supercoin must trigger configured per-hit rewards.
- Any eligible attack that destroys propane must run its molotov payload exactly once.
- Existing knockback, resistance, i-frame and death-motion behavior is preserved
  unless a specific case is explicitly changed.

Task 0 becomes a behavior inventory marking each relevant cell **keep**, **fix**,
or **undefined**. Do not hand-author a complete theoretical matrix.

## Unified hit context and result schema

Proposed field names are finalized enough for planning; validate naming during
implementation, but do not reopen architecture.

```js
HitContext = {
  source,
  target,
  attackTeam,
  targetTeam,
  targetClass,
  provenance,
  damage,
  reaction: {
    knockback,
    stun,
    protection,   // recovery protection requested for the target, e.g. i-frames
  },
  impactPosition,
  direction,      // unit push direction
  motion,         // attacker velocity used for speed-based knockback
}

HitResult = {
  accepted,
  reason,
  resourceLoss,   // HP/shield/energy breakdown
  appliedKnockback,
  stun,
  protectionGained, // actual recovery protection applied after modifiers
  feedback,
  rewards,
  destroyed,
}
```

**Reaction semantics:** caller defines intent; target resistance/state modifies it;
resolver records the final applied value. `direction` is where the push goes;
`motion` is how fast the attacker was moving into the target. `protectionGained`
belongs to the target’s recovery state.

Rejected hits do not invoke target callbacks and must not produce reactions.
Zero-damage accepted hits preserve current reward behavior for now: rewards that
scale by actual damage remain unchanged, and the inventory must record any path
that currently rewards on contact regardless of damage before changing it.

## Target callback contract

Proposed API names; final field schemas/enums remain subject to joint validation:

```js
target.onHit(hitContext, hitResult)
target.onDestroyed(hitContext, hitResult)
```

Both receive the same unified context and resolved outcome for the triggering hit.

**hitContext — what caused it:** source and target identity; attack team, target
team/class; attack provenance; requested damage/reaction settings; applicable
impact position, direction and motion context.

**hitResult — what happened:** acceptance/rejection and reason; actual
HP/shield/energy loss; resolved knockback/stun and shared reactions; whether this
hit caused destruction. Rejected hits do not invoke these callbacks.

**Ownership:**
- Resolver owns eligibility, resource changes and shared-effect orchestration.
  Existing specialized executors may implement those effects.
- `onHit` runs once per accepted hit, including lethal hits. Target-specific
  effects such as supercoin popcorn belong here.
- `onDestroyed` runs once per target destruction, after that hit's `onHit`.
  Propane molotovs and final coin bursts belong here.
- Hooks do not repeat team checks, subtract HP again, or reapply shared
  knockback/flash. Each effect has one owner; attack callers never manually
  invoke target aftermath hooks.
- Host services may implement payloads/world removal; entity callbacks need not
  directly depend on rendering, pools or global world state.
- Establish destruction/aftermath guards before callbacks can trigger nested
  chain reactions. Preserve the triggering context/result through pool reuse.
- Callback order does not require knockback after death: retain Task 0's explicit
  ordering decision and lethal-hit motion requirements.

**Still to validate together:** accepted zero-damage hit/reward behavior, final
field names, reward scaling (actual damage versus requested/overkill), service
wiring and callback failure policy. Do not silently change supercoin scaling.

Regression tests must verify shared context, onHit-before-onDestroyed order,
no callbacks for rejected hits, no duplicate effects, and exactly-once destruction
under nested chain reactions. Include nonlethal and lethal supercoin hits and
propane destroyed by dust/fire/blasts.

## Task 0 — Behavior inventory (blocking)

Inventory existing teams/classes/provenance, reaction owners and impact policies.
Mark each relevant current behavior **keep**, **fix**, or **undefined**, with file/
call-site evidence. Confirm fire/destructible and dust/living-only rules, zero-
damage reward paths, effect ordering, lethal-hit motion, and carrier impact owners.
Do not invent a complete theoretical matrix; use production behavior as baseline.

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

- Target classes: use the declarations approved in Task 0; earlier examples are not final enums.
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

## Task 2 — One public hit resolver

Implement the public hit contract approved in Task 0 (working name `applyHit`).
Validate all required team/class/provenance/state/configuration inputs before
mutation. Resolve eligibility and the provenance/target behavior profile, then
coordinate resource changes, reactions, rewards and lifecycle effects. No
independent caller-owned aftermath decisions. Reuse specialized executors.

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
- Centralize reaction selection and orchestration, reusing existing executors.
  Use Task 0-approved ordering, including lethal-hit motion and zero-damage rules.
  Target class alone must not determine all reactions; provenance/configuration
  also participates. Avoid duplicate flash, knockback, rewards or contact effects.
- Ensure per-hit rewards and destruction payloads/world removal run exactly
  once for direct hits, blasts and zones. Reuse shared host orchestration rather
  than copying barrel-specific branches into each attack.
- Temporary migration adapters must preserve team and lifecycle semantics;
  remove them once all callers migrate.

## Task 3 — Migrate every damage path

- Audit ALL direct HP mutations and reaction calls, including shockwave,
  surfaceWave, beam, spike, dashCombo, fireArea and engine hitboxes. Each path
  supplies the approved hit context; remove duplicate caller effects only once
  the resolver owns them. Collision geometry and physics remain specialized.

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

- Cover the approved provenance × target-class/configuration behavior matrix,
  combined with team and protection gates; not just the 3×3 team truth table.
- Reproduce melee supercoin per-hit rewards and dust-killed propane molotovs.
  Test fire and explosive variants through actual production call paths.
- Assert configured knockback/no-knockback differences, resistance, lethal-hit
  motion, feedback, rewards and payloads; each intended effect runs once.
- Test invalid required enum/context inputs before mutation and approved
  zero-damage/contact policies.

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

Reassess scope after Task 0: full hit resolution is broader than a damage-only
router and touches reaction/contact owners beyond the core combat files.

Original assessment — Medium: this is a targeting/lifecycle correction, not merely a rename.
Primary risks are missed collision candidates, duplicate chain reactions,
recursion through legacy damage wrappers, and affiliation defaults that alter
friendly-fire rules. Mitigate with explicit team initialization, shared routing,
exactly-once destruction hooks, and production-path regression tests.

## Execution order

0 (joint validation; blocking) → 1 → 2 → 3 → 4 (test gate) → 5 → 6.
No automatic commits or pushes. Each commit needs explicit user instruction.
