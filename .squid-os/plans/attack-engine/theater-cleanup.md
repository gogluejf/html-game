# Attack Theater Cleanup Plan

**Status:** TODO — audit & refactor  
**Created:** 2026-10-19  
**Scope:** `petal-panic/js/debug/attack-theater.js` + attack engine integration  
**Goal:** Make the theater a pure **host/staging layer** that reuses real gameplay mechanics, instead of duplicating combat logic.

## Problem Statement

The attack theater is a debug sandbox that should let us preview attacks using the **same rules as real gameplay**. Instead, it has accumulated its own parallel implementations of:

- Collision detection
- Damage routing
- Hit-flash / white flash
- Projectile/bomb stepping
- Terrain handling
- Knockback
- Target bookkeeping
- Per-attack choreography

This causes behavior drift between the theater and the real game (e.g., inconsistent hit flashes, wrong terrain assumptions, duplicated lifecycle code).

---

## Issues to Fix

### 1. Duplicated Combat Logic in Theater

**Location:** `attack-theater.js`

**What’s wrong:** The theater implements its own versions of mechanics that already exist in the engine/gameplay systems.

**Examples:**
- Own projectile-vs-target overlap check (`aabbOverlap`)
- Own damage routing for several attacks
- Own bomb terrain stepping (`stepBombTerrain`)
- Own projectile/bomb lifecycle stepping
- Own knockback application
- Own staged victim entities with ad-hoc `takeDamage`

**Why it matters:** Any bug or improvement made to the real system must be manually mirrored here, and will eventually drift.

**Fix direction:** Remove theater-local combat logic. Route all attacks through the same entry points used by gameplay (`spawnBombAttack`, real collision handlers, real damage pipeline).

---

### 2. Two Separate Flash Systems

**Location:** `attack-theater.js`

**What’s wrong:** There are two independent flash mechanisms:
- `this._flash` — theater-local white box timer
- `target.hitFlash` — real entity damage-flash property

**Why it matters:** This is why some targets flash white inconsistently (stomp radius victims, missile rain dummy, etc.). The visual feedback is disconnected from actual damage events.

**Fix direction:**
- Centralize hit-flash ownership in the damage pipeline (`damage()` or each entity’s `takeDamage()`)
- Remove theater-local `_flash`
- Theater should only read `hitFlash` from targets/entities

---

### 3. Inconsistent Hit-Flash Ownership

**Location:** Multiple files (`combat/damage.js`, `combat/collisionHandlers.js`, `combat/hitbox.js`, `enemies/enemy.js`, `objects/object.js`, `debug/attack-theater.js`)

**What’s wrong:** Different code paths decide separately whether to set `hitFlash`:
- Some use `takeDamage()` which sets it internally
- Some use raw `damage()` and forget to set it
- Theater sets its own `_flash` independently

**Why it matters:** Same logical hit can produce different visual results depending on which code path handled it.

**Fix direction:** Single rule: **any target whose HP/energy actually decreases from an attack gets `hitFlash = 0.1` exactly once**, owned by the damage pipeline.

---

### 4. Theater Does Its Own Collision Detection

**Location:** `attack-theater.js` around line 951–977

**What’s wrong:** The theater runs its own minimal projectile→target check instead of relying on the real `collisionWorld` + `registerCollisionHandlers()`.

**Why it matters:** Real gameplay uses spatial-hash broadphase + declarative mask rules. The theater’s manual AABB check doesn’t match that, so edge cases (one-way platforms, barrels, boss zones) behave differently.

**Fix direction:** Use the real collision world for all attack interactions. The theater should only provide the sandbox bounds and initial entities.

---

### 5. Theater Has Its Own Bomb Terrain Stepping

**Location:** `attack-theater.js` around line 982–985

**What’s wrong:** The theater calls `stepBombTerrain()` directly with a flat `GROUND_Y`, bypassing the real level solids/platforms context.

**Why it matters:** Bombs in the theater don’t interact with blocks/walls/ceilings the same way they do in real gameplay.

**Fix direction:** Use the same `BombAttackHost` + shared terrain context that gameplay uses. The theater should supply the same shape of context (groundY, platforms, collisionWorld) but not reimplement the stepping loop.

---

### 6. Theater Has Its Own Projectile/Bomb Lifecycle

**Location:** `attack-theater.js` around line 988–1096

**What’s wrong:** The theater manually steps projectiles, bombs, and macros with special-case branches per attack id.

**Why it matters:** Every new attack type requires a new branch here. Lifecycle bugs (pool exhaustion, premature completion, child promotion) must be fixed twice.

**Fix direction:** Use the unified handle-stepping contract. The theater should call `h.step(dt, targets)` and let the macro/primitive own its internal lifecycle. No per-id branching except for rendering.

---

### 7. Theater Has Its Own Knockback Application

**Location:** `attack-theater.js` around line 1051–1057

**What’s wrong:** Dash combo knockback is applied manually in the theater instead of going through the normal hitbox/knockback registry.

**Why it matters:** Real gameplay applies knockback via the hitbox system + `applyKnockback()`. The theater’s manual version can diverge (timing, cooldowns, stacking rules).

**Fix direction:** Let the dash combo macro emit its freeze-frame hitbox through the normal hitbox processing path. Theater just provides the target list.

---

### 8. Theater Stages Victims With Ad-Hoc `takeDamage`

**Location:** `attack-theater.js` around line 660–663, 910

**What’s wrong:** Stomp demo victims and body-explosion victims are plain objects with hand-written `takeDamage` functions that don’t match the real `Enemy.takeDamage()` pipeline.

**Why it matters:** These victims don’t go through defense mitigation, death transitions, i-frames, or any other real enemy behavior. They’re test doubles that hide real issues.

**Fix direction:** Use real `Enemy` instances (or at minimum the shared placeholder target factory) so they exercise the actual damage pipeline.

---

### 9. Theater Special-Cases Too Many Attacks

**Location:** `attack-theater.js` throughout

**What’s wrong:** There are explicit branches for stomp, stompWave, skyMissile, missileRain, dashCombo, boomerang, orbit, dustZone, etc. Each one stages the scene differently and often adds custom damage/flash logic.

**Why it matters:** This makes the theater hard to maintain and guarantees drift when the underlying attack changes.

**Fix direction:** Move staging into a declarative config (per-attack setup function) that only positions entities and sets params. All combat behavior comes from the engine.

---

### 10. Theater Doesn’t Reuse Real Gameplay Entry Points

**Location:** `attack-theater.js`

**What’s wrong:** The theater invokes attacks directly via `invoke()` with its own context, instead of using the gameplay entry points like `spawnBombAttack()` or the real shooting system.

**Why it matters:** Gameplay-specific wiring (pools, collision world, terrain context, target lists) is reconstructed manually in the theater, so it can miss things the real game does.

**Fix direction:** Where possible, route through the same entry points gameplay uses. At minimum, build the theater context from the same source-of-truth data structures.

---

## Acceptance Criteria

When this cleanup is done:

1. **No combat logic lives in the theater.** It only stages scenes, supplies context, and renders results.
2. **Hit-flash is owned by the damage pipeline.** One place decides who flashes; the theater just reads it.
3. **All attacks use the real collision world** for interaction, not manual AABB checks.
4. **Bombs/projectiles use the shared terrain + lifecycle host** (same as gameplay).
5. **Staged victims are real entities** (or shared placeholders), not ad-hoc objects.
6. **Adding a new attack requires zero theater changes** beyond optional staging config.
7. **Behavior parity:** An attack that behaves a certain way in real gameplay behaves identically in the theater (modulo sandbox bounds).

---

## Suggested Refactor Steps

1. **Centralize hit-flash in `damage()`** — remove scattered assignments.
2. **Remove theater-local `_flash`** — render only from `hitFlash`.
3. **Route theater projectiles through the real collision world** — delete manual overlap check.
4. **Use `BombAttackHost` for all bomb-derived attacks** — delete theater terrain/lifecycle branches.
5. **Replace ad-hoc victims with real Enemy instances** — or a shared placeholder factory.
6. **Move per-attack staging into a declarative config** — no inline combat logic.
7. **Delete all theater-local damage/knockback/sparkle code** — let the engine own it.
8. **Add regression tests** that compare theater vs gameplay behavior for key attacks.

---

## Out of Scope (for now)

- Redesigning the attack engine itself (it’s mostly sound)
- Changing how effects/VFX work
- Reworking the macro/primitive composition model

This plan is about **removing duplication** and **restoring single-source-of-truth** for combat behavior.
