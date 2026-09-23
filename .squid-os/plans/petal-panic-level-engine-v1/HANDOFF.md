# Handoff — petal-panic-level-engine-v1

## Current State

**Plan:** `petal-panic-level-engine-v1` (Petal Panic Level Engine v1 — Level 1)
**Working directory:** `~/src/html-game`
**Progress file:** `.squid-os/plans/petal-panic-level-engine-v1/.plan-progress.json`
**Orchestrator:** `.squid-os/plans/petal-panic-level-engine-v1/orchestrator.md`
**Reviews log:** `.squid-os/plans/petal-panic-level-engine-v1/reviews.md`

### Completed Tasks (13/20)

| Task | Name | Commit | Status |
|---|---|---|---|
| 1.1 | Global game settings module | `9c1f71c` | ✅ done |
| 1.2 | Lifecycle operations | `fcce894` | ✅ done (deferred findings) |
| 1.3 | Shared area-entry screen + death flow | `a4577ef`+`72b176b` | ✅ done (deferred findings) |
| 2.1 | Zone model replacing single corridor | `cf46e4e` | ✅ done (deferred to 7.1) |
| 2.2 | Exit flag, clear banner, fade transition | `9c68b89` | ✅ done (deferred to 7.1) |
| 2.3 | Camera max-scroll from zone length | `501e884` | ✅ done |
| 3.1 | Terrain grammar + seeded RNG | `a1bc700` | ✅ done |
| 3.2 | Macro library + area composer | `17919d9` | ✅ done (deferred to 7.1/7.2) |
| 3.3 | Progression -1 to -4 + length doubling | `4d218da` | ✅ done (deferred to 7.2) |
| 4.1 | Macro placement + population resolver | `1b2fb3a` | ✅ done (deferred to 7.1) |
| 4.2 | Level 1 config (The Circus) | `f667058` | ✅ done (deferred to 7.1) |
| 5.1 | Vertical zone orientation | `5f5fc56` | ✅ done |
| 5.2 | Climbing macros for vertical composition | `2efaf64` | ✅ done |
| 6.1 | Boss approach + arena lock + intro sequence | `d0cbb71` | ✅ done |

### In Progress (1 task)

| Task | Name | Status |
|---|---|---|
| 6.2 | Level reward screen + continue crediting | `in_progress` — **NOT STARTED** (executor aborted before writing files) |

### Not Started (5 tasks — all Wave 7)

| Task | Name |
|---|---|
| 7.1 | Wire engine into main loop (replace prototype world) |
| 7.2 | Concrete design-plan values + tuning pass |
| 7.3 | Full-flow integration tests + suite green |
| 7.4 | 8 level config entries |
| 7.5 | Minimal end-of-game screen |

### Wave Gates

- ✅ Gate 1 (after Wave 1): committed
- ✅ Gate 2 (after Wave 2): committed `adfd0bc`
- ✅ Gate 3 (after Wave 3): committed `86f0df4`
- ✅ Gate 4 (after Wave 4): committed `9e9d80c`
- ✅ Gate 5 (after Wave 5): committed `2634a61`
- ⬜ Gate 6 (after Wave 6): **NOT YET RUN** — needs to run after 6.2 is done
- ⬜ Gate 7 (after Wave 7): final gate

## What to Do Next

### 1. Complete Task 6.2

Task 6.2 was marked `in_progress` but the executor was aborted before writing any files. No files exist yet. You need to:

1. Dispatch the executor for task 6.2 using the standard EXECUTOR PROMPT from the orchestrator.
2. The task: Replace the placeholder post-boss screen with the level reward screen (kills, score, coins, continues earned). Continue crediting: `floor(coins / 1000)`, credited exactly once. After the screen: next level at area -1 (or end-of-game if final level).
3. Docs: `petal-panic/docs/levels/boss-arena.md` §4-5, `game-rules.md` §2-3, `lifecycle.md` §5.
4. Files: `~ petal-panic/js/screens.js`, `~ petal-panic/js/systems/update.js`, `+ petal-panic/js/test/reward.test.js`
5. After executor + review + commit, run **Wave 6 Gate**: `node --test petal-panic/js/test/*.test.js` vs baseline, commit `levels: wave 6 gate`.

### 2. Wave 7 (Tasks 7.1-7.5)

This is the big integration wave. Task 7.1 is the critical one — it resolves ALL deferred findings from waves 1-6.

#### Task 7.1 — Wire engine into main loop (replace prototype world)

This is the task that resolves the accumulated "runtime still uses legacy corridor" findings. Specifically:

1. **Zone geometry installation:** Swap the runtime from `generateLevel()`/`LEGACY_CORRIDOR` to the zone model. The active zone's platforms, blocks, and flags must be installed into the collision world. When a zone is cleared, the old zone's entities are removed and the new zone's entities are added.
2. **Clear sequence geometry swap:** The area-clear sequence (task 2.2) currently advances the area index and shows the entry screen but doesn't swap the actual world geometry. Wire it so the new zone's terrain is actually generated and installed.
3. **Population integration:** Call `populateArea` (task 4.1) when a zone is generated. Store the population snapshot on the hero/zone. `restoreArea` (lifecycle.js) must restore the stored population on life loss.
4. **Hero position at boot:** `startGame` (lifecycle.js) should set the hero's physical position, not update.js.
5. **regenerateWorld wiring:** The callback pattern exists (task 1.2) but old entities aren't removed from the collision world and new entities aren't added. Wire this up.
6. **Boss ID mismatch:** `levelConfigs.js` says `'tusko_wobble'`, `boss.js` says `'elephant'`. Reconcile.
7. **Game Over Retry:** Currently bypasses the shared entry screen. Route it through the entry screen per the shared-screen contract.
8. **level.js bridge functions:** `buildZoneTerrain`/`buildAllZoneTerrain` need test coverage.

**Key files to modify:**
- `petal-panic/js/systems/update.js` — the main game loop, currently uses `generateLevel()` and `LEGACY_CORRIDOR`
- `petal-panic/js/lifecycle.js` — `startGame`, `startLife`, `continueRun`, `restoreArea`
- `petal-panic/js/level.js` — `buildLevelZones`, `buildZoneTerrain`, `buildAllZoneTerrain`
- `petal-panic/js/macros.js` — `composeArea`, `populateArea`
- `petal-panic/js/bossZone.js` — boss zone flow

**The zone model is already the authoritative structure** (from tasks 2.1-3.3). What's missing is the runtime consuming it instead of the legacy corridor. The legacy corridor (`LEGACY_CORRIDOR` in level.js) should be removed or fully deprecated after this task.

#### Task 7.2 — Concrete design-plan values + tuning pass

Resolve the tuning constants that were deferred:
- `REACH_MARGIN` (16px) — measure and set
- `BARREL_STRUCTURE.super.max` (99) — set a real value
- Sparseness of -1 — verify breathing-room values are correct
- Anti-repetition constraint for macro selection
- -2/-3 pacing re-tune
- `BOSS_ENTER_TRAVEL` (400px) — tie to VIEW_W
- Any other magic numbers flagged in reviews

#### Task 7.3 — Full-flow integration tests + suite green

- Integration tests for the full game flow: start → area -1 → clear → area -2 → ... → boss → reward → next level
- Test that `buildZoneTerrain`/`buildAllZoneTerrain` produce valid layouts
- Test the vertical climbing path end-to-end
- Test the boss zone flow end-to-end (approach → intro → combat → reward)
- Ensure the full test suite is green (only known baseline flakes allowed)

#### Task 7.4 — 8 level config entries

Add the remaining 7 level configs to `levelConfigs.js` (currently only Level 1 "The Circus" exists). Use the story doc (`docs/story/levels.md`) for rosters, bosses, and vibes. Levels 2-4 have defined rosters; levels 5-8 may need placeholder rosters.

#### Task 7.5 — Minimal end-of-game screen

After the final level's boss and reward screen, show a minimal end-of-game screen: congratulations + final score + return home. Follows the shared screen ergonomics contract. This is a placeholder — the full ending (story scenes, credits) belongs to a future story epic.

## Key Architecture Notes

### Module Structure (new files created by this plan)

| File | Purpose |
|---|---|
| `petal-panic/js/gameRules.js` | Global settings (lives, continues, coinsPerContinue) + continue pool helpers |
| `petal-panic/js/lifecycle.js` | Lifecycle operations (startGame, startArea, startLife, continueRun, restoreArea) |
| `petal-panic/js/level.js` | Zone model (`buildLevelZones`), legacy corridor (`LEGACY_CORRIDOR`), level config |
| `petal-panic/js/terrain.js` | Terrain units (block/platform), seeded RNG, tier physics |
| `petal-panic/js/macros.js` | Macro vocabulary, area composer, population resolver, stage weights |
| `petal-panic/js/levelConfigs.js` | Per-level config (roster, boss, budgets, weights) |
| `petal-panic/js/bossZone.js` | Boss zone state machine (approach → intro → combat) |
| `petal-panic/js/camera.js` | Camera with zone bounds, vertical ratchet, boss lock |

### Key Conventions

- **Area indexing:** Zone model uses -1, -2, -3, -4, boss (index 4). Legacy checkpoints use 0, 1, 2, 3. `hero.currentArea` uses the zone-model convention.
- **Zone model is authoritative:** `buildLevelZones(LEVEL_DEF)` produces 5 sealed zones. `getActiveZone(hero)` resolves the current zone. The legacy corridor (`LEGACY_CORRIDOR`) is deprecated but still consumed by the runtime until task 7.1.
- **Determinism:** `createRng(seed)` from terrain.js. Same seed → same world. The RNG is rolled once per game (in `startGame`), never rerolled on death/continue.
- **Pure modules:** terrain.js, macros.js, bossZone.js, levelConfigs.js are pure (no DOM). They're unit-testable in isolation.
- **Screen ergonomics contract:** All full-screen presentations (area entry, pause, game over, reward) share the same list layout, focus pill, and keycap nav bar.

### Test Baseline

Known baseline flakes (ignore, never chase):
- `barrel.solid.test.js` — timing flake
- `contextualAim.test.js` — flaky under parallel runs
- `input.test.js` — "simultaneous sources dispatch" and "Space jump and Circle super" tests
- `effectTheater c2d.ellipse` — (if it appears)

Full suite command: `node --test petal-panic/js/test/*.test.js` (glob form, NOT directory form)

### Review Protocol

Per the orchestrator:
1. Execute (inline agent, task-executor skill, 150 steps / 200 tools / 15m)
2. Review — two independent reviewers (Qwen3.8-27B + GPT-5.6-sol), same prompt, different models
3. Fix — if FAIL with major/blocker, re-dispatch executor with findings verbatim
4. Re-review — confirm fixes
5. Max 2 fix rounds + 1 final confirmation review
6. Commit: `levels <task-id>: <task name>`
7. Record in reviews.md

**Runner rules:**
- Runner NEVER writes code — all code work goes through the executor agent
- Do NOT wait for user authorization between tasks
- Tests: high-level behavioral assertions, not micro-tests on timing/frames/pixels

## Git State

- Branch: `master`
- Last commit: `d0cbb71` (levels 6.1: Boss approach + arena lock + intro sequence)
- Working tree: clean (6.2 executor aborted before writing files)
- Uncommitted: reviews.md update (5.2, 6.1 entries) — **commit this before starting 6.2**

## Files to Read First

1. `.squid-os/plans/petal-panic-level-engine-v1/orchestrator.md` — execution contract
2. `.squid-os/plans/petal-panic-level-engine-v1/reviews.md` — all review findings and deferred items
3. `petal-panic/docs/levels/*.md` — design contract (source of truth)
4. `petal-panic/docs/story/levels.md` — Level 1 content
5. `.squid-os/plans/petal-panic-level-engine-v1/petal-panic-level-engine-v1.md` — task definitions
