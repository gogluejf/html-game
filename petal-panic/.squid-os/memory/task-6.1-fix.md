# Task 6.1 — Boss approach + arena lock + intro sequence (Fix Mode)

**Date:** 2025-09-22
**Status:** Complete — all 6 findings fixed, bossZone/contextualAim/camera/clearSequence green (41/41); full suite 279 pass, 2 fail = known baseline input.test.js flakes (verified identical on the reverted baseline), plus a timing-flaky barrel.solid.test.js that passes in isolation.

## Findings Fixed

### BLOCKER 1 (R2): bossZone active in APPROACH at module load
- `BossZone` now starts **DORMANT** (`this.state = null`, `active === false`) instead of `APPROACH`. It only activates when `begin()` is called (when the hero reaches the boss zone).
- While dormant, `inIntro` is `false`, so the effective shooting gate (`!bossZone.inIntro`) is `true` and the boss-damage gate (`active && bossCanTakeDamage()`) is `false` — shooting/melee/boss-damage all behave normally in ordinary areas.
- `update.js` arms the flow in `update()` when `!bossZone.active && getActiveZone(hero)?.kind === 'boss'` (safety net alongside the AREA_ENTRY→PLAY hook), so it re-arms on death restart.
- This also unblocked the previously-failing `contextualAim.test.js` pipeline tests (shooting was globally disabled at boot).

### BLOCKER 2 (R2): arenaEntryX = 120 − 960 = −840
- Root cause: the start was derived from the entry flag on the zone's LEFT edge (x=120) and the approach distance was subtracted, giving a negative, unreachable entry.
- Per docs (§1: leftward approach), the hero now starts on the RIGHT side: `approachStartX = b.x + b.w − BOSS_APPROACH_START_PAD` (new export `BOSS_APPROACH_START_PAD = 100`). `arenaEntryX = approachStartX − BOSS_APPROACH_DIST` (clamped `>= b.x`).
- Result for the 1600px boss zone: start = 1500, entry = 540 (positive, inside bounds). Approach runs exactly one documented screen (960px) and leaves the flag behind.
- Updated `bossZone.test.js` "approach leaves the flag behind" → "approach is leftward" to assert the new (correct) geometry.

### BLOCKER 3 (R1): hero.currentArea never advanced to boss zone on death restart
- In `finishHeroDeath()`, when `getActiveZone(hero)?.kind === 'boss'`, set `hero.currentArea = BOSS_AREA` (new const `levelZones.length - 1`, the same value the legacy path used: `LEVEL_DEF.LEGACY.checkpoints.length`).
- This makes `getActiveZone()` keep resolving to the boss zone on restart, so the flow re-arms and `showAreaEntry` shows the correct boss area id ("1-B").

### MAJOR (R2): no collision wall / hero clamp during intro or combat
- Added a boss-arena clamp in `update()` after the level clamp: when `bossZone.arenaLocked()` (LOCKED through COMBAT), clamp the hero's `worldBox().x` to `[arenaX, arenaX + arenaW]` (the fixed camera view), zeroing `vx`. No-op outside the boss zone (dormant ⇒ `arenaLocked()` false).

### MAJOR (R2): boss position interpolation broken (`_entered` latch)
- Removed the `_entered` latch. During `BOSS_ENTER`, `boss.x` is now interpolated from `bossEnterFromX` → `bossRestX` EVERY frame over the `BOSS_ENTER` duration (easeOutCubic), so the boss slides in smoothly instead of teleporting when the timer expires.

### MAJOR (R2): pre-COMBAT hitbox guard ran after takeDamage
- `processHitboxes` applies damage internally, so the `onHit` callback fired only AFTER the boss was already damaged. The real gate now runs BEFORE damage: the boss is excluded from the `targets` list in `processAllHitboxes()` when `!bossZone.bossCanTakeDamage()`, so melee/projectiles/specials never reach the boss's `takeDamage()` until COMBAT. The `onHit` guard is kept as a redundant safety net.

## Files Modified
- `petal-panic/js/bossZone.js` — dormant start, leftward approach geometry, boss interpolation fix, removed `_entered`.
- `petal-panic/js/systems/update.js` — `BOSS_AREA` const, `LEGACY_CORRIDOR` import, dormant-activation safety net, boss-arena hero clamp, `finishHeroDeath` currentArea advance, pre-damage boss-damage gate.
- `petal-panic/js/test/bossZone.test.js` — updated approach-geometry test + boot-state test (now asserts DORMANT).

## Test Results
- `bossZone.test.js`: 18/18 pass
- `contextualAim.test.js`: 16/16 pass (was 12/16 — the 4 pipeline failures were caused by BLOCKER 1's global shooting block, now fixed)
- `camera.test.js`, `clearSequence.test.js`: pass (combined bossZone+contextualAim+camera+clearSequence = 41/41)
- Full suite: 279 pass / 2 fail. The 2 fails are `input.test.js` ("simultaneous sources…" and "Space jump…") — verified PRE-EXISTING by reverting update.js and re-running (identical failures). `barrel.solid.test.js` is a timing flake under full-suite load (passes 3/3 in isolation).
