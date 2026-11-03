# Unified Damage Routing — Plan

**Date:** 2026-11-03
**Status:** ready to execute
**Scope:** routing + naming only. Per-class side effects (i-frames, death
pipeline, coin/blast payloads) stay where they live — they get clean internal
names but move no logic.

## Problem

Three public damage entry points with inconsistent names and behavior:

| today | class | actually does |
|---|---|---|
| `damage()` (combat/damage.js) | hero (+fallback for all) | energy/shield drain, defense, death flag, telemetry |
| `takeDamage()` (enemies/enemy.js) | enemy | `damage()` + flash + death pipeline |
| `hit()` (objects/object.js) | barrel | hp chip + flash + destroy latch + payload trigger |

And targeting is decided by ad-hoc team strings (`ally/foe/neutral` →
hardcoded layer lists in TWO places: `TEAM_TARGETS` in hitbox.js and
`isValidTarget` in explosion.js). Consequences seen in practice:
- dust zone ticked barrels (weird — zones shouldn't chip solids)
- hero had neither `takeDamage` nor `hit` → zones silently dealt 0 until patched
- every new attack re-derives "who can I hurt" by hand

## Goal

ONE public door, declarative targeting, clean names:

```
applyHit(target, source, amt, method, kind)     ← the ONLY caller-facing API
  │  1. AFFECTS matrix filter: does `kind` affect classOf(target)?
  │  2. team preset (ally/foe/neutral) refines the row
  └─► routes by class:
        hero   → drainEnergy()      (internal; i-frames/vignette stay at call site)
        enemy  → drainHp()          (internal; death pipeline stays inside)
        barrel → chipHp()           (internal; destroy/payload stays inside)
```

Callers never see per-class functions. New target class or new attack kind =
one table row, works out of the box.

## Task 1 — Target classes + AFFECTS matrix (new file `js/combat/targeting.js`)

```js
// Target classes — single classifier (layer + duck-typing, reuses isEnemy logic)
export function targetClass(t) {
  // 'hero' | 'enemy' | 'boss' | 'barrel' | 'other'
}

// Declarative matrix: attack kind → affected classes.
// THE source of truth for "can this attack hurt that thing".
export const AFFECTS = {
  projectile: { hero: false, enemy: true,  boss: true,  barrel: true  },
  melee:      { hero: false, enemy: true,  boss: true,  barrel: true  },
  explosion:  { hero: true,  enemy: true,  boss: true,  barrel: true  },
  zone:       { hero: true,  enemy: true,  boss: true,  barrel: false },
};

// Team presets refine a row instead of replacing it:
//   neutral → the kind's own row (today's "hits everyone valid")
//   ally    → force hero-sparing view  (hero: false)
//   foe     → force hero-only view     (only hero: true)
export function isAffected(kind, team, target) { /* row lookup + preset */ }
```

- Deliberate behavior change: **zones no longer chip barrels** (the weird case).
  Everything else matches current effective behavior — verify per row in Task 4.
- Boss gets its own column (today it's folded into enemy checks everywhere).

## Task 2 — The router (rename + wrap, `js/combat/damage.js`)

```js
/** THE one public damage API. Replaces damage()/takeDamage()/hit() at call sites. */
export function applyHit(target, source, amt, { method = 'projectile', kind = method, team = 'neutral' } = {}) {
  if (!target || target.alive === false) return 0;
  if (!isAffected(kind, team, target)) return 0;        // matrix gate
  const cls = targetClass(target);
  switch (cls) {
    case 'hero':   return heroDamage(source, target, amt, method);
    case 'enemy':  return enemyDamage(source, target, amt, method);
    case 'barrel': return barrelDamage(source, target, amt, method);
    default:       return 0;
  }
}
```

Internal renamed functions (same bodies, moved/cleaned):
- `heroDamage` — today's `damage()` core: defense, shield→energy drain, death
  flag, telemetry. (Hero i-frame/vignette/special-loss stay at the CALL SITE —
  they are impact reactions, not damage math; blast path already does this.)
- `enemyDamage` — today's `Enemy.takeDamage()` body: `heroDamage`-style drain on
  hp + flash + `die()` pipeline. Lives on Enemy but is reached ONLY via
  applyHit from now on.
- `barrelDamage` — today's `GameObj.hit()` body: hp chip + flash + destroy
  latch. Destroy payload (explosion/coins/dust) still triggered by the caller
  via the existing `destroyed` latch (no change).

Back-compat shims during migration (delete in Task 6):
```js
export const damage = (s, t, a, m) => applyHit(t, s, a, { method: m, kind: m });
```

## Task 3 — Migrate call sites (grep-driven, mechanical)

- `processHitboxes` (hitbox.js): drop `TEAM_TARGETS` layer check →
  `applyHit(t, hb.owner, hb.damage, { method: hb.method, kind: hb.kind ?? 'melee', team: hb.team })`.
  Hero impact reaction block (takeHit i-frames + vignette) stays AFTER a
  `dealt > 0` result, as today.
- `resolveExplosion` (explosion.js): drop `isValidTarget` team switch →
  `applyHit(t, source, dmg, { method: 'explosion', kind: 'explosion', team })`.
  Radial knockback block unchanged (runs on `dealt > 0`).
- `HazardZone` (objects/hazardZone.js): register hitbox with `kind: 'zone'`.
- collisionHandlers.js projectile/melee/contact paths → `applyHit`.
- Keep `team` param flowing from attack definitions (no data migration —
  existing `team: 'neutral'` etc. keep meaning via presets).

## Task 4 — Tests

- `targeting.test.js` (new): full matrix assertion — every kind × every class
  equals the documented row; team presets verified (ally spares hero, foe
  hero-only).
- Regression gates:
  - hero in dust zone takes ticks (the bug fixed this session)
  - barrel in dust zone takes 0 (NEW deliberate change)
  - explosion hits hero+enemies+barrels (unchanged)
  - thorn hits barrels, not hero (unchanged)
- Existing suite must hold at baseline (6 pre-existing failures, nothing new).

## Task 5 — Rename sweep (consistency pass)

- Public: `damage` → `applyHit` everywhere (call sites + imports).
- Internal: `takeDamage` → `enemyDamage`, `hit` → `barrelDamage`,
  `damage()` core → `heroDamage`.
- Grep-verify zero stragglers; update doc comments that quote old names.
- Do NOT rename: `takeHit` (hero impact/knockback reaction — different
  concern), `flashTarget`, `applyKnockback`.

## Task 6 — Delete shims + dead code

- Remove `TEAM_TARGETS` (hitbox.js) and `isValidTarget` (explosion.js) once
  zero references remain.
- Remove back-compat `damage` alias.
- Update `docs/architecture/explosion.md` + `attack-macros.md` references to
  the new API (one paragraph each).

## Out of scope (explicit)

- Unifying side-effect TIMING (when i-frames arm vs when flash fires) — stays
  per-class/per-caller.
- Knockback system — untouched (caller-controlled, verified this session).
- Adding new attack kinds beyond the four rows — trivial later (one row).

## Risk

Low-medium. Filter-only + rename; behavior preserved except the deliberate
zone↔barrel change. Biggest risk: a missed call site in the rename — mitigated
by grep verification + full test suite per task.

## Execution order

1 → 2 → 3 → 4 (test gate) → 5 → 6. Commit after each task ONLY on explicit
user instruction (standing rule).
