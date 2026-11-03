# HANDOFF — projectile-unification task 1.3 (in progress)

Session: 2026-11-03, html-game repo, plan `plans/projectile-unification/`
Progress file: `plans/projectile-unification/.plan-progress.json` (1.1 ✓ done+committed, 1.2 ✓ done+committed, **1.3 in_progress**, rest not_started)

## What task 1.3 is
Delete the Special class + specialPool; fold everything into Projectile (single class, single pool). Spec: `plans/projectile-unification/projectile-unification.md` §TASK 1.3. Acceptance: `grep -rn 'specialPool|class Special' petal-panic/js/ --include='*.js' | wc -l` → 0 (note: `ctx.specialPool` alias usages are legitimate and stay — they point at projectilePool).

## State of the working tree (UNCOMMITTED — do not lose it)
~34 files modified. All structural work is DONE:
- Special class folded into Projectile (`objects/projectile.js`): optional 5th ctor param `type` (null = thorn, byte-identical old behavior), per-type registry via specialById, bomb orientation, fuse relabel, unified draw, `this.dir` restored.
- All non-test code repointed (update.js single-step merge, accessors getProjectiles/getSpecials partitions, attack-theater dedupe, shooting.js, comments).
- All test files repointed to Projectile/projectilePool.
- Two spawner signature fixes: `primitives/ballistic.js:86` and `primitives/projectile.js:92` now call `spawn(x, y, 0, true, type)` (friendly before type).

## Test matrix (use this exact script — one shot, don't run suites individually)
```bash
cd ~/src/html-game && for f in petal-panic/js/test/*.test.js petal-panic/js/test/attack/*.test.js; do node "$f" >/dev/null 2>&1 && echo "PASS $f" || echo "FAIL $f"; done | grep FAIL
```
**Baseline on HEAD (stashed): 9 pre-existing failures** — fullscreenSurface, input, menuRunFlow, pickerRide, projectileSprite (T4 fps 97≠250), attack/bombHost, attack/meleeHitbox, attack/shockwaveImpact, attack/theaterParity. Do NOT try to fix these.

**Current tree: those 9 + 2 regressions remaining:**
1. `petal-panic/js/test/attack/skyMissile.test.js` — "detonates ON the platform top": carrier dies at bottom=415.6 vs platTop=410 (tolerance 400*DT+1 ≈ 7.7px; off by ~5.6px).
2. `petal-panic/js/test/attack/missileRain.test.js` — "target under marked spot takes a blast": hp stays 100.

Already fixed this session (were failing before): entryImpact, bombGameplay, contextualAim, weaponStyleComposition.

## Root causes already found (trust these, don't re-derive)
### A. The stepping architecture (FIXED in update.js, keep it)
Old arch had TWO pools each with its own `updateAll`. Unified pool needs every entity stepped exactly once. Current correct shape in `systems/update.js` (~line 1014):
- Pass 1: iterate `projectilePool.active` backwards, SKIP entities with `_attackId === 'ballistic' || 'projectile'`, update+splice the rest.
- Pass 2: explicit `s.update(dt)` for active items where `(_attackId === 'ballistic' || 'projectile') && !s._attackDone` (host-stepped carriers — their hosts call stepBomb/stepProjectile which are lifecycle-only, no integration).
Also: `collisionHandlers.js hitSolidTerrain` — the early-return `if (projectile._attackId === 'ballistic') return;` was REMOVED (it blocked side-wall reflection; engine's stepBombTerrain only handles TOP surfaces, side walls come exclusively from hitSolidTerrain). Classic reflect/stop path must run for ALL projectiles.

### B. skyMissile regression (remaining #1)
Test loop order: `pool.updateAll(DT)` THEN `h.step(DT)`. skyMissile's surface-landing check (in `macros/skyMissile.js` h.step drop phase) reads `ent.y + ent.h >= pt.y` AFTER integration already happened this frame, so the kill happens one frame late (bottom 415.6 vs line 410; frame travel 6.67px). On HEAD the carrier was a Special stepped by the separate specialPool pass — same order, but the math landed within tolerance (likely because Special's box/size differed slightly, or the check ran against a pre-integration position due to pool ordering).
Likely minimal fix options (pick cleanest after reading ~30 lines):
- (a) In skyMissile's drop-phase check, compare against `pt.y + p.fallSpeed * dt` margin (i.e. allow one frame of overshoot) — but that changes gameplay semantics slightly.
- (b) Check the OLD Special path: on HEAD, was the missile carrier spawned via the projectile primitive (typeless) or special? If it was in specialPool, the test's `c.pools.projectilePool.updateAll(DT)` did NOT integrate it — only `c.pools.specialPool.updateAll(DT)` did, and that ran BEFORE h.step too… verify with `git show HEAD:petal-panic/js/combat/attack/primitives/projectile.js` which pool the skyMissile carrier used. If it was the projectilePool (plain path), then on HEAD the check ALSO saw post-integration positions and passed — meaning something else changed (e.g. spawnY/size). Diff the carrier's spawn params between HEAD and now.
- (c) Widen nothing — find the actual 5px delta source (box height change from sheet-owned sizing vs old natural square?). The carrier is typeless explosive: check `ent.h` now vs HEAD.

### C. missileRain regression (remaining #2)
Center missile carrier NEVER MOVES: `bottom=-4.4` constant, `vy=600`, alive=true, for all 300 frames. It's a plain `_attackId === 'projectile'` entity in projectilePool. Debug showed `m1.state.missile.entity` is UNDEFINED at f20 in one probe but an entity in others — the `state.missile` handle may be getting replaced/re-invoked. KEY SUSPECT: my update.js pass-2 skips `_attackDone` entities, but ALSO the pool's `spawn()` guard: `!(item._attackId === 'ballistic' && ...)` only protects ballistic slots. More likely: the carrier IS being updated (other missiles move) but THIS one has vy=600 yet y frozen → check if `ent.update(dt)` early-returns (e.g. `visible === false`, or `alive` toggling, or the entity got swapped out of the pool slot mid-flight by another spawn reusing it — Pool.spawn wipes ALL keys of a reused slot! If the pool (32 slots) recycled this live carrier because `alive` was momentarily false or the guard missed it, its state resets to parked position y≈-4).
Verify: log `ent` identity across frames (`const id = ent; ... console.log(ent === id)`) — if identity changes, a slot recycle is happening. Check Pool.spawn guard in objects/projectile.js (~line 379) — it only guards `_attackId === 'ballistic'`; extend it to also guard `'projectile'` carriers with a live `_attackHandle` (same condition as pass-1 skip). That is probably THE fix for both remaining tests.

## Exact next steps
1. Apply the Pool.spawn guard extension in `petal-panic/js/objects/projectile.js`: reuse-guard should be `!( (item._attackId === 'ballistic' || item._attackId === 'projectile') && !item._attackDone && item._attackHandle && !item._attackHandle._cancelled && !item._attackHandle._completed )`.
2. Run the matrix script. If missileRain passes, tackle skyMissile (option B above — first diff carrier spawn params HEAD vs now with `git show HEAD:...`).
3. When matrix shows ONLY the 9 baseline failures: reviews for 1.3.
   - Reviewers: BOTH A and B on `ninfer/qwen3.8-27b` (user override for this run — NOT openai-codex). Use the reviewer template from `/home/goglue/.config/squid-os/skills/plan-runner/references/reviewer.md`, rendered with task 1.3 context. Budgets max_steps 75 / max_time 15m. NOTE: qwen inline reviewers have repeatedly hit max-steps this session — give them a TIGHT prompt ("do exactly these 3 tool calls then answer") like the one that worked for task 1.2.
   - Record verdicts in `plans/projectile-unification/reviews.md` (1.1 and 1.2 entries already there).
4. Commit: `git add -A && git commit -m "refactor(petal-panic) 1.3: Delete Special class + specialPool"` (per-task commits are authorized by the plan-runner workflow itself; user said don't stop until entire plan complete).
5. `python3 ~/.config/squid-os/skills/plan-runner/scripts/progress.py mark-done --progress plans/projectile-unification/.plan-progress.json --task-id 1.3`
6. Continue tasks 1.4, 1.5, milestone 2 (outline config), milestone 3 (ATTACK_IDS + child rename + invokeChild) with the same cycle: executor inline_agent (skill task-executor, diagnosis-first prompts, tight budgets) → matrix verify → dual qwen review → record → commit → mark-done.
7. User rules for this run: NO stopping until entire plan complete; reviewers on qwen not codex; per-task commits allowed (workflow authorization); do NOT ask questions.

## Anti-spin rules (user-enforced, I broke them this session — don't)
- One debug experiment per hypothesis. Max 3 iterations per bug, then report.
- NEVER repeat a tool call with identical/near-identical args (I looped a sed read ~10× — that's the spin signal).
- Use the ONE-SHOT matrix script for test runs, never individual suites repeatedly.
- Keep debug scripts in /tmp (dbg_*.mjs pattern works; loadTestMacros + document/window stubs header shown in dbg_sm2.mjs).

## Resume instruction
Start the next session with: "read plans/projectile-unification/HANDOFF.md and continue"
