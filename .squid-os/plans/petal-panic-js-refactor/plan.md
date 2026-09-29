# Petal Panic — JS Refactor Plan

## Rules (NON-NEGOTIABLE)

1. **Preserve behavior exactly.** No gameplay logic changes, no algorithm changes, no timing/constant/damage/movement/collision/input changes.
2. **Move code by responsibility.** Each module owns one concern.
3. **Dependency wiring changes are allowed** (imports, exports, function signatures, passing context).
4. **Many imports are fine.** ES modules use imports.
5. **No circular dependencies.** Solve via architecture (shared lower-level module, dependency injection). No hacks/globals/bridges.
6. **NO LEGACY BRIDGES.** Once migrated, delete old implementation. No forwarding wrappers.
7. **NO DEAD CODE.** Remove unused functions, variables, imports, obsolete helpers.
8. **No duplication.** One authoritative implementation per behavior.
9. **Work incrementally.** After each extraction: update imports, verify syntax, run tests.
10. **Do not stop because it's large.** Continue until `update.js` is fully decomposed.
11. **Do not simplify behavior** because something is hard to move. Preserve it.
12. **If preserving behavior requires changing logic, STOP and explain.** Otherwise continue.

## Target Folder Structure

```
js/
├── main.js              # boot, game loop, canvas setup
├── consts.js            # LAYER, GRAVITY, etc.
├── tuning.js            # TUNING block
│
├── core/                # engine primitives (no game logic)
│   ├── entity.js
│   ├── collision.js
│   ├── camera.js
│   ├── input.js
│   ├── state.js
│   ├── anim.js
│   ├── timers.js
│   └── view.js
│
├── world/               # level structure + zone management
│   ├── build.js         # terrain→pixel math, instantiateZone, buildWorld
│   ├── zoneLifecycle.js # loadActiveZone, clear sequence, area entry fade
│   ├── accessors.js     # getSolids(), getEnemies(), getHero()…
│   ├── level.js
│   ├── levelConfigs.js
│   ├── macros.js
│   └── terrain.js
│
├── combat/              # all fighting logic
│   ├── shooting.js      # tryFire, fireThorn, fireSpecial, explodeSpecial
│   ├── hitboxes.js      # unified hitbox system, processAllHitboxes
│   ├── collisionHandlers.js  # on('hit'), on('contact'), on('collect'), on('pickup'), on('checkpoint')
│   ├── damage.js
│   ├── knockback.js
│   └── explosion.js
│
├── enemies/             # enemy-specific
│   ├── enemy.js         # base Enemy class
│   ├── enemyUpdate.js   # per-frame enemy loop (AI tick, death pipeline)
│   ├── jester.js
│   ├── vine_hound.js
│   ├── violetta.js
│   ├── jackolantern.js
│   └── boris_loon.js
│
├── boss/                # boss-specific
│   ├── boss.js          # Elephant entity
│   ├── bossZone.js      # flow machine (LOCKED→INTRO→COMBAT)
│   └── bossFlow.js      # enterBossRoom, settleIntoBossRoom, updateBoss
│
├── hero/                # hero-specific
│   ├── hero.js
│   ├── heroDefs.js
│   └── floatText.js     # VFX popup pool
│
├── objects/             # world objects (not enemies)
│   ├── object.js        # GameObj, Checkpoint
│   ├── barrel.js        # barrel factories + destruction handler
│   ├── powerup.js
│   ├── coin.js
│   └── projectile.js    # pools + sync-to-world
│
├── systems/             # high-level orchestration
│   ├── update.js        # THE thin orchestrator (<300 lines)
│   ├── render.js
│   ├── lifecycle.js     # startGame, startLife, continueRun, restoreArea
│   ├── screens.js
│   └── hud.js
│
├── debug/               # ALL debug stuff
│   ├── debug.js         # Debug singleton (overlay, log, spawn table)
│   ├── debugHarness.js  # keydown handlers, god mode, entity select, JSON dumps
│   ├── theater.js       # Effect Theater
│   ├── theater-meta.js
│   └── theater-scenes.js
│
├── effects/             # VFX implementations (already exists)
│   └── …
│
├── ui/                  # screen-level
│   ├── screens.js
│   └── fonts.js
│
└── test/                # (already exists)
    └── …
```

## Phase 1: Move Existing Files Into Folders

Pure `git mv` + import path fixes. No code changes.

### Mapping (current → target)

| Current file | Target |
|---|---|
| `js/entity.js` | `js/core/entity.js` |
| `js/collision.js` | `js/core/collision.js` |
| `js/camera.js` | `js/core/camera.js` |
| `js/input.js` | `js/core/input.js` |
| `js/state.js` | `js/core/state.js` |
| `js/anim.js` | `js/core/anim.js` |
| `js/timers.js` | `js/core/timers.js` |
| `js/view.js` | `js/core/view.js` |
| `js/level.js` | `js/world/level.js` |
| `js/levelConfigs.js` | `js/world/levelConfigs.js` |
| `js/macros.js` | `js/world/macros.js` |
| `js/terrain.js` | `js/world/terrain.js` |
| `js/damage.js` | `js/combat/damage.js` |
| `js/knockback.js` | `js/combat/knockback.js` |
| `js/explosion.js` | `js/combat/explosion.js` |
| `js/enemy.js` | `js/enemies/enemy.js` |
| `js/jester.js` | `js/enemies/jester.js` |
| `js/vine_hound.js` | `js/enemies/vine_hound.js` |
| `js/violetta.js` | `js/enemies/violetta.js` |
| `js/jackolantern.js` | `js/enemies/jackolantern.js` |
| `js/boris_loon.js` | `js/enemies/boris_loon.js` |
| `js/boss.js` | `js/boss/boss.js` |
| `js/bossZone.js` | `js/boss/bossZone.js` |
| `js/hero.js` | `js/hero/hero.js` |
| `js/heroDefs.js` | `js/hero/heroDefs.js` |
| `js/object.js` | `js/objects/object.js` |
| `js/powerup.js` | `js/objects/powerup.js` |
| `js/coin.js` | `js/objects/coin.js` |
| `js/projectile.js` | `js/objects/projectile.js` |
| `js/debug.js` | `js/debug/debug.js` |
| `js/effects/theater.js` | `js/debug/theater.js` |
| `js/effects/theater-meta.js` | `js/debug/theater-meta.js` |
| `js/effects/theater-scenes.js` | `js/debug/theater-scenes.js` |
| `js/screens.js` | `js/ui/screens.js` |
| `js/fonts.js` | `js/ui/fonts.js` |
| `js/hud.js` | `js/systems/hud.js` |
| `js/lifecycle.js` | `js/systems/lifecycle.js` |

Stays in place:
- `js/main.js`
- `js/consts.js`
- `js/tuning.js`
- `js/systems/update.js`
- `js/systems/render.js`
- `js/effects/*` (except theater files)
- `js/test/*`

### Import Fix Pattern

After moving, all imports referencing the old paths must be updated. Example:
- `import { Entity } from './entity.js'` → `import { Entity } from '../core/entity.js'`
- `import { Hero } from '../hero.js'` → `import { Hero } from '../../hero/hero.js'`

Use `grep -r` to find all references and fix them systematically.

## Phase 2: Split `update.js`

Extract from `update.js` into new modules:

| New file | Contents (from update.js) |
|---|---|
| `js/world/build.js` | `horizontalUnitBox`, `verticalUnitBox`, `surfaceY`, `slotX`, `slotCenterX`, `ENEMY_FACTORIES`, `BARREL_FACTORIES`, `instantiateZone`, `buildWorld`, `captureAreaMap` |
| `js/world/zoneLifecycle.js` | `CLEAR_SEQ`, `clearSeq`, `getClearSequence`, `getClearBanner`, `getClearFadeAlpha`, `onExitFlagReached`, `debugWrapToNextArea`, `stepClearSequence`, `beginClearFadeIn`, `AREA_ENTRY_FADE`, `areaEntrySeq`, `beginAreaEntryPresentation`, `getAreaEntryFadeAlpha`, `stepAreaEntrySequence`, `loadActiveZone`, `regenerateWorld`, `newGameSeed`, `entryPosition`, `heroEntryPosition`, `resetActiveZoneContent`, `retryFromGameOver`, `continueFromGameOver` |
| `js/boss/bossFlow.js` | `enterBossRoom`, `settleIntoBossRoom`, `restoreBossRunFloor`, `beginBossZoneFlow`, `updateBoss` |
| `js/combat/shooting.js` | `tryFire`, `fireThorn`, `fireSpecial`, `explodeSpecial` |
| `js/combat/hitboxes.js` | `_hitboxes`, `makeSlot`, `updateSlot`, `_hbMelee`, `_slotMelee`, `_hbSuper`, `_slotSuper`, `_hbSpecialMelee`, `_slotSpecialMelee`, `processAllHitboxes`, `getEnemyAttackHitbox` |
| `js/combat/collisionHandlers.js` | All `collisionWorld.on(...)` handlers (hit, contact, collect, pickup, checkpoint) |
| `js/enemies/enemyUpdate.js` | `updateRealEnemy`, `getAttackHitbox`, `updateRealEnemies` |
| `js/hero/floatText.js` | `FloatText` class, `floatTexts` pool, `spawnFloatText` |
| `js/debug/debugHarness.js` | `handleDebugToggle`, `handleDebugKeys`, `debugSpawn`, `dumpCollisionWorld`, `swapHero`, `scrubSelectedAnim`, `selectEntityAt`, `forceStateAt`, `pickEnemyAt`, `applyGodMode`, `updateTheaterGamepad`, `theaterWasHeld`, mousedown/contextmenu listeners |
| `js/world/accessors.js` | All `getX()` getter functions |

### What stays in `systems/update.js`:
- The `update(dt)` function (thin orchestrator)
- Module-level state that multiple extracted modules need (hero ref, collisionWorld, SOLIDS, realEnemies, barrels, powerups, checkpoints, boss, camera)
- `readInput()` (builds intent from input state)
- `isGrounded()`, `standingOnOneWay()` (hero physics helpers tightly coupled to update loop)
- `isBelowVerticalBottom()` (death check)
- `finishHeroDeath()` (death pipeline completion)
- `getDeathFadeAlpha()` (render reads this)
- `refreshBarrelSolidBoxes()` (tightly coupled to collision step)
- `syncCoinsToWorld()`, `syncProjectilesToWorld()`, `syncSpecialsToWorld()`, `cullOffScreen()` (pool sync, called every frame)
- `handleBarrelDestroyed()` (called from multiple contexts)
- `updateEffects()` (particle/coin pool advancement)
- Transition hooks (`onTransition`)
- `processInput()` (input dispatch)
- `resetWorldForDebug()` (debug boot)

### Dependency Direction (top → bottom)

```
systems/update.js
  → world/zoneLifecycle.js, world/build.js, world/accessors.js
  → combat/shooting.js, combat/hitboxes.js, combat/collisionHandlers.js
  → enemies/enemyUpdate.js
  → boss/bossFlow.js
  → hero/floatText.js
  → debug/debugHarness.js
  → objects/* (projectile, coin, powerup, barrel)
  → core/* (entity, collision, camera, input, state, anim, timers, view)
  → enemies/* (jester, vine_hound, etc.)
  → boss/* (boss, bossZone)
  → hero/* (hero, heroDefs)
  → world/* (level, levelConfigs, macros, terrain)
  → combat/* (damage, knockback, explosion)
  → ui/* (screens, fonts)
  → effects/*
  → consts.js, tuning.js
```

No module may import from a higher level. If a circular dep appears, extract the shared piece to a lower-level module.

## Validation

After each phase:
1. `node --check` on all modified/new files (syntax)
2. Run test suite: `cd petal-panic && node js/test/run-all.mjs`
3. Verify no circular imports: `grep -r "from.*'" js/ | sort` and check direction

## Agent Instructions

When dispatched for mechanical work:
- Read THIS file for full context
- Do NOT change any gameplay logic
- Do NOT add comments explaining the refactor
- Do NOT create compatibility wrappers
- Only move code + fix import paths
- Run `node --check` on every file you touch
- Report: files moved, imports fixed, any issues found
