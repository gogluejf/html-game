# Handoff — Area-advance auto-skip + 1-B boss card auto-trigger

**Plan:** `petal-panic-level-engine-v1`
**Working directory:** `~/src/html-game` (project `petal-panic/`)
**Baseline commit:** `42a46b5` — *petal-panic: relax trigger-line test bound*
**Status of baseline:** green. `node --test "js/test/*.test.js"` → 353 pass / 3 pre-existing fail (hud83, two input tests — fail on clean HEAD too).

---

## 0. The two bugs (user-reported, verbatim intent)

### Bug A — Area card auto-skips (1-1 → 1-2 → 1-3)
> "when I pass level 1-1, it arrives on the play level card 1-2, then automatically to 1-3. I literally see the card for the play arena switching from 1-2 to 1-3 like it auto-skips a level."

**Root cause (confirmed):** `beginClearFadeIn()` (update.js ~line 530) teleports the hero to the new area's entry but **kept the hero's velocity from the cleared area**. You clear an area running right at full speed (~250 px/s). That momentum survives into the next area; if the → key is still held, the hero sprints across the whole zone and re-triggers its exit flag within seconds → the clear sequence restarts → the card flips to the next area on screen. Inconsistent because it depends on your exact speed at the flag.

**Fix APPLIED (uncommitted, 6 lines in `petal-panic/js/systems/update.js`):**
```js
// in beginClearFadeIn(), after placing hero.x / hero.y:
hero.vx = 0;
hero.vy = 0;
```
Every fresh area now starts at rest regardless of held keys. User confirmed 1-1→1-2 no longer skips. Tests: clearSequence (16), levelFlow (15), bossZone (20) all pass.

### Bug B — Boss card auto-plays on arrival in 1-B (UNFIXED)
> "if I beat 1-4 I arrived in 1-B and the card was automatically playing… I start the level, I see the level render, then the boss card. I did not have to run to the trigger zone line."
> "It does NOT happen when I W-wrap into 1-B. That is very suspicious — what is not reset between 1-4 and 1-B?"

**Geometry (why 1-B is special):**
- 1-B zone is only **1600px** wide (vs 4000px for horizontal areas).
- Hero spawns at x=120 (`ZONE_ENTRY_X`).
- Trigger line at x=1080 (`BOSS_TRIGGER_X`, level.js line 136).
- So only **960px** separate spawn from trigger — at 250 px/s that's ~3.8s. For 1-2 it's 3760px (~15s). The same carried-momentum root cause has a much shorter fuse in 1-B.

**Key diagnostic clue:** W-wrap into 1-B does NOT trigger the bug; the real 1-4→1-B path DOES. Both paths call `loadActiveZone` + `showAreaEntry` + `beginAreaEntryPresentation`. Something in the REAL path leaves state dirty that W doesn't touch. Suspects (not yet verified):
1. Hero position/velocity not fully reset on the real path (the vx/vy fix above may already cover this — **re-test first**).
2. `bossZone` machine state not dormant on the real path (should be `state === null`).
3. Camera bounds stale from 1-4.
4. Checkpoint array residue from 1-4 (the 1-4 exit flag is the boss-checkpoint appearance; verify it's actually removed by `loadActiveZone`).

**Trigger check location:** update.js ~line 2318:
```js
if (!bossZone.active && !hero.dying && getActiveZone(hero)?.kind === 'boss'
    && hero.x >= BOSS_TRIGGER_X) { enterBossRoom(); return; }
```

## 1. What to do next (in order)

1. **Re-test Bug B with the vx/vy fix applied** (hard refresh Ctrl+Shift+R, clear 1-4 normally). If the card no longer auto-plays → done, commit.
2. If it still fires, add ONE temporary log line just before the trigger check:
   ```js
   console.log(`[1B] x=${Math.round(hero.x)} vx=${Math.round(hero.vx)} bz=${bossZone.state} cam=[${camera.minX},${camera.maxX}] cps=${checkpoints.map(c=>c.checkpointId).join(',')}`);
   ```
   Clear 1-4 once, paste the last few `[1B]` lines + the `[zone] loaded boss zone` line. Compare against a W-wrap session (same logs). The diff IS the bug.
3. Fix whatever the diff shows. Expected candidates: zero hero velocity on the real path (already done), `bossZone.reset()` + `camera.unlock()` + `camera.setZoneBounds(zone)` on the real advance path (W-path has these at update.js ~lines 395–405; the real path at ~lines 475–490 does loadActiveZone + camera.setZoneBounds but check whether bossZone.reset() is missing there).
4. Remove the temp log. Run full test suite. Commit.

## 2. Current uncommitted change (KEEP)

`git diff` should show exactly one hunk in `petal-panic/js/systems/update.js`:
- `beginClearFadeIn()`: +6 lines (comment + `hero.vx = 0; hero.vy = 0;`)

Nothing else should be modified. Everything else from the debugging session was reverted.

## 3. Do NOT do (rabbit holes already burned)

- Do **not** restructure the death pipeline (`hero.dying` skip-physics, double energy checks, early `isBelowVerticalBottom`). Two pre-existing screens.test.js failures ("death in 1-3", "zero lives") are UNRELATED to these bugs and were left as-is. They fail because the test harness sets `hero.energy = 0` directly and steps `U.update()` — a test-harness vs engine-timing mismatch, not a gameplay bug.
- Do **not** add `hero.dying` guards to enemy AI files (jester/vine_hound/jackolantern/boris_loon/violetta). Reverted.
- Do **not** add damage-handler energy guards (contact/projectile). Reverted.
- Do **not** change `TUNING.areaEntryHold` (was temporarily set to 0.5 for testing; reverted to 1.75).
- Do **not** add W-wrap guards or diagnostic logging. Reverted.
- Do **not** touch lifecycle.js / screens.js / render.js / reward.test.js — those carry the user's earlier-session reward-screen rework which was also reverted by mistake-free checkout; if they're clean in git status, leave them.

## 4. Verification commands

```bash
cd ~/src/html-game
git diff --stat          # expect: only petal-panic/js/systems/update.js, +6
node --check petal-panic/js/systems/update.js
node --test "petal-panic/js/test/clearSequence.test.js" \
           "petal-panic/js/test/levelFlow.test.js" \
           "petal-panic/js/test/bossZone.test.js"   # expect 51 pass / 0 fail
node --test "petal-panic/js/test/*.test.js"         # expect 353 pass / 3 pre-existing fail
```

## 5. Suggested commit shape (confirm with user before committing)

1. `petal-panic: zero hero momentum on area-entry so held keys can't auto-skip the next area`
   — the 6-line beginClearFadeIn fix (Bug A)
2. *(after Bug B is fixed)* `petal-panic: <what the 1-B diff showed>`

## 6. Context for the next session

- Game: Petal Panic, canvas platformer, vanilla ES modules, node:test for tests. No build step.
- Level 1 "Big Top": areas 1-1…1-4 (area 3 is vertical), then 1-B boss zone. Zone model in `js/level.js` (`buildLevelZones`), each zone local at x=0, only one loaded at a time via `loadActiveZone` (update.js ~line 990).
- Area flow: exit flag → `onExitFlagReached` → banner → fadeOut → `showAreaEntry` (card) → timed hold (`stepAreaEntrySequence`) → `startLife` + AREA_ENTRY→PLAY transition → `beginClearFadeIn` (places hero) → play.
- Boss flow: hero walks 1-B left→right, crosses `BOSS_TRIGGER_X` (1080) → `enterBossRoom()` → instant black + card presentation (LOCKED→INTRO_SWEEP→BAR_FILL→BOSS_ENTER) → `settleIntoBossRoom()` swaps floor to 960px room at [0,960], freezes camera at 0, places hero at x=120 → COMBAT.
- Debug W (`debugWrapToNextArea`, update.js ~line 363) advances areas instantly for dev testing — useful as a control case: anything that differs between W-advance and real-advance is suspect.
- Console logs worth knowing: `[clear]`, `[zone] loaded zone N`, `[lifecycle] → AREA_ENTRY`, `[bossZone] trigger line crossed`, `[cam-snap]`.
