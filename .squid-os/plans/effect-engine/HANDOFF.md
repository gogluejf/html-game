# HANDOFF — effect-engine

Fresh session: run this plan with plan-runner. Follow the orchestrator exactly.

- **Orchestrator (execution contract):** `.squid-os/plans/effect-engine/orchestrator.md`
- **Plan (tasks/acceptance/verify):** `.squid-os/plans/effect-engine/effect-engine.md`
- **Source of truth (arch spec):** `petal-panic/docs/architecture/effects.md`
- **Review log (all verdicts + resolutions):** `.squid-os/plans/effect-engine/reviews.md`

## Where we are (as of handoff)

- **Waves 1–3 complete + committed** (M1 engine core, M2 migration, M3 screen-space/overlay). Wave gate commits: `effects: wave 1 gate`, `wave 2 gate`, `wave 3 gate`.
- **Task 4.1 (Debris) complete + committed** (`effects 4.1: debris ...`).
- **Task 4.2 (Dust Cloud) IN PROGRESS — uncommitted work in the tree.** The executor was interrupted mid-run. State:
  - New files: `petal-panic/js/effects/dustCloud.js`, `petal-panic/js/test/dustCloud.test.js` (20/21 passing)
  - Modified: `js/particles.js` (additive pool extension — check the diff), `js/effects/registry.js` (dust-cloud registration), `js/effects/palettes.js` (+dust palette), `docs/architecture/effects.md` (§ implementation notes added)
  - **One failing test:** `standalone theater demo driven only by params (null carrier, manual fire)` — "x 171.1 within ±spread of contact". Diagnose first (likely a spread/bounds expectation or stub-alignment issue, same class as the 4.1 debris fixes); fix via task-executor, then run the FULL per-task loop (verify → Review A qwen3.8-27b → Review B gpt-5.6-sol → resolve → record in reviews.md → commit `effects 4.2: dust cloud ...`).
  - Suite baseline right now: 43/44 (only dustCloud red; contextualAim/barrel.solid have pre-existing ~25% flakes — re-run once before judging).

## Resume procedure

1. Finish 4.2 per the strict per-task loop in orchestrator.md (execute → verify → fix cycle max 2 → Review A → Review B → resolve → record → commit → mark-done).
2. Then 4.3 (Composite Explosion Burst) → Gate 4 (full suite vs baseline.txt + effectRegression.test.js + effectCatalog if it exists yet + wave review + gate commit).
3. Continue Waves 5–7 (M5 particles continued, M6 transform effects incl. Beam §26, M7 theater + final regression).

## Rules that matter most
- Runner never writes game code — every coding task AND every fix cycle goes through a task-executor agent (inline agent with task-executor skill). Budgets: max_time 15m, max_steps up to 150. Reviews: max_steps 75, max_time 15m.
- M2 is done and green — behavior preservation is locked by `effectRegression.test.js`; any change to migrated behavior = blocker.
- One file per effect under `js/effects/`; adding an effect = one file + one registration + one demo (M7), no engine change. Pool/engine extensions must be strictly additive AND documented in effects.md (precedent: 4.1 debris pool extension + epsilon cull).
- Heat Distortion is OUT (stays experimental in the doc). 25 effects implemented + demoed.
- Commit only after both reviews recorded in reviews.md; one commit per task + gate commits.

## Conventions baked in during this run (follow them)
- Epsilon 1e-9 done-detection for fixed-dt decay (FP residue ~1e-16 at exact boundaries); pool cull uses the same epsilon (documented in effects.md §3).
- Total lifetime always equals the documented duration/lifetime param exactly (ramps scale to fit when they'd exceed it).
- Two-pass rendering: body.space 'world'|'screen' (default world); world pass inside camera transform (render.js), screen pass post-restore via Effects.drawOverlay; drawEffects(ctx, renderCtx, { space }).
- Screen-space effects prefer draw-time renderCtx.view over factory-time params (fallback clearly labeled undocumented).
- Frequency params: Hz, 0 = per-frame mode, any positive f works verbatim (no clamping), hold-between-rolls, first roll on first update.
- STATE effects expose getters on the instance body (getOffset pattern); camera shake = shim singleton with max-kick merge + unconditional timer reset (legacy parity); getShakeOffset() sums ALL active camera-shake instances; per-entity shake = Effects.getEntityShakeTotal(e) applied at every drawable carrier site in render.js.
- Shim naming: per-entity sprite shake = `getEntityShakeOffset(e)` (the no-arg `getShakeOffset()` is the CAMERA path — object-literal key collision bit us once; never add two methods with the same name to the Effects literal).
- Tests: direct-intent/pure-unit, fixed dt = 1/60, exact values within epsilon via close()/EPS helpers; deterministic Math.random stubs — MEASURE the actual per-particle draw order empirically first (debris: effect angle, effect speed, then spawnOne ctor consumes 2 more = 4 draws/fragment; sequence must be long enough not to cycle), account for the (2·rand−1) factor in expected offsets, and remember spawnOne creates items at (cx − size/2, cy − size/2) so assert deltas or offset-aware positions.
- Doc wins over code: when the executor fills a spec gap, add an "Implementation notes" block to the doc section (§3, §12–§16 density).
- Task verify commands may reference `effectCatalog.test.js` (M7 deliverable) — fall back to `node js/test/run-all.mjs` and note it.

## Open item
- Theater shortcut key: task 7.2 leaves it as "a new debug key (e.g. KeyE)". Pick an unused letter if you have a preference.
