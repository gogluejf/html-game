# HANDOFF — effect-engine

Fresh session: **load the orchestrator and continue immediately.** Do not re-ask the user for rules — everything you need is here + in `orchestrator.md`. The only thing to confirm with the user is a go/no-go at wave boundaries if they interrupt; otherwise just keep running the loop.

## Load order (do this first)
1. Read `.squid-os/plans/effect-engine/orchestrator.md` — it is the execution contract. Follow it exactly.
2. Read this file for current state + conventions.
3. Source of truth: `petal-panic/docs/architecture/effects.md` (HIGH-LEVEL CONCEPT doc — intent only, see "Doc rule" below).
4. Review log: `.squid-os/plans/effect-engine/reviews.md` (all verdicts + resolutions).
5. Progress tracker: `.squid-os/plans/effect-engine/.plan-progress.json` (via progress.py).

## Where we are (as of this handoff)
- **Waves 1–4 complete + committed** (M1 engine core, M2 migration, M3 screen-space/overlay, M4 particle/burst: debris, dust cloud, composite explosion). Gate commits exist through `effects: wave 4 gate`.
- **Wave 5 (M5) in progress:** Task **5.1 Trail is DONE + committed** (`effects 5.1: trail ...`). Task **5.2 (Afterimage / Ghost Frames) is marked in_progress but NOT started** — that's your next task.
- Suite baseline right now: `run-all.mjs` = **46/46** when the two known pre-existing flakes don't trip (see "Flakes"). `effectRegression.test.js` = 21/21.
- Working tree should be clean except possibly `.plan-progress.json` (harness state). Verify with `git status --short` before starting.

## Resume procedure
Continue the strict per-task loop from the orchestrator, starting at **5.2**, then 5.3 → 5.8 → **Gate 5**, then Waves 6–7.

Remaining tasks:
- **Wave 5 (M5) — Motion, Telegraph & Marker:** 5.2 Afterimage/Ghost Frames, 5.3 Ground Wave, 5.4 Shockwave, 5.5 Telegraph Circle, 5.6 Ground Target Marker, 5.7 Target Reticle, 5.8 Attack Arc/Slash → Gate 5.
- **Wave 6 (M6) — Sprite-State & Beam:** 6.1 Fade Out, 6.2 Scale/Pulse, 6.3 Squash & Stretch, 6.4 Aura/Glow, 6.5 Beam (§26) → Gate 6.
- **Wave 7 (M7) — Theater & Handoff:** 7.1 Per-effect theater demos, 7.2 Effect Theater overlay + debug shortcut, 7.3 Document effect config in entity YAML, 7.4 Final regression + scope handoff → Gate 7 → EPIC DONE.

## THE RULES (read once, follow always)

### You NEVER write game code or tests yourself
The runner (you) dispatches, verifies mechanically, reviews, records, commits, tracks progress. **Every coding task AND every fix cycle goes through a task-executor agent** (an inline agent with the `task-executor` skill). If you catch yourself about to edit a `.js`/`.test.js` file directly — stop, dispatch instead. (Docs-only edits like this handoff or effects.md concept rewrites are the one exception, and even those were delegated.)

### Per-task loop (strict order, from orchestrator.md)
1. `progress.py mark-in-progress --task-id <id>`
2. **Execute** — inline agent with `task-executor` skill, passed plan path + task id. Budgets: max_steps 150, max_tools 200, max_time 15m.
3. **Verify** — run the task's `Verification:` command + related existing tests. NOTE: most M5/M6/M7 tasks list `node petal-panic/js/test/effectCatalog.test.js`, which does NOT exist yet (it's an M7 deliverable). **Fall back to `node petal-panic/js/test/run-all.mjs` and note it.**
4. **Fix cycle** — if red: fresh task-executor with a diagnosis-first prompt (state the exact failing assertions + root cause you found). Max 2 retries. Still red → BLOCKED, stop wave, surface to user.
5. **Review A** — `ninfer/qwen3.8-27b` (local, line-level) on the uncommitted diff. Budgets: max_steps 75, max_time 15m.
6. **Review B** — `openai-codex/gpt-5.6-sol` (cloud, intent/acceptance-conformance) on the same diff. Budgets: max_steps 75, max_time 15m. Retry 1–2× if overloaded. Run both in parallel.
7. **Resolve** — ACCEPT (executor fixes, re-verify) or REJECT (note why). Disagreement → mechanical tests break the tie; else one-line question to user. Max 2 rounds.
8. **Record** — append both verdicts + resolution to `reviews.md` (insert after the previous task's block, before the "Wave 1 gate" section — the file appends newest-tasks upward toward that anchor).
9. **Commit** — `effects <task-id>: <task name>`. Only after steps 3–8. One commit per task.
10. `progress.py mark-done --task-id <id>`.

**A task is NOT done until committed. No next task before the commit lands.**

### Agent call labeling
When you call any agent, put the task in the label, e.g. `5.2 afterimage — implement effect`, `5.2 afterimage — Review A (line-level)`, `5.2 afterimage — resolve review findings`. This keeps the transcript readable.

### Keep going without waiting
Run the full loop end-to-end (execute → verify → review A/B → resolve → record → commit → mark-done → next task) **without pausing for the user between tasks**. Only stop to ask the user on: a reviewer disagreement that needs a human tie-break, a BLOCKED task after 2 fix cycles, or a wave boundary if they've asked for a checkpoint. Otherwise continuous. **NEVER ask "want me to continue?" or wait for go-ahead at a task boundary — just dispatch the next task immediately.** The user has explicitly called out pausing as a time-waster; do not pause.

## Doc rule (IMPORTANT — changed mid-run)
`effects.md` was **restored to a high-level concept catalog** (commit `effects: restore effects.md to a high-level concept catalog`). It states INTENT only: what each effect is, what it's for, "Parameters may include" as ideas, lifecycle/triggers/composition in plain language. **It contains NO implementation detail** — no function names, no numeric defaults, no formulas, no code snippets, no "Implementation notes" blocks. Effects 1–25 are verbatim from the original concept source; Beam is #26 in the same style.

Consequences:
- **Do NOT add implementation notes / defaults / formulas / function names to effects.md.** Your concrete param choices live in the effect file's header comment, not the doc.
- **"Doc wins over code" now means intent/behavior wins**, not constants. Judge conformance against (a) the conceptual intent in the relevant § and (b) the plan task's acceptance criteria — NOT against doc-stated numbers (there are none).
- When briefing Review B, tell it explicitly that effects.md is a concept doc and to judge against intent + plan acceptance, and NOT to raise missing-doc-notes or doc-vs-code constant findings. (This removed most of the prior review noise.)

## Conventions baked in during this run (follow them)
- **Epsilon 1e-9 done-detection** for fixed-dt decay (FP residue ~1e-16 at exact boundaries); pool cull uses the same epsilon (documented in code). Total lifetime always equals the documented duration/lifetime param exactly (ramps scale to fit when they'd exceed it).
- **Two-pass rendering:** body.space 'world'|'screen' (default world); world pass inside camera transform (render.js), screen pass post-restore via Effects.drawOverlay; drawEffects(ctx, renderCtx, { space }). Screen-space effects prefer draw-time renderCtx.view over factory-time params.
- **Carrier origin wins:** if carrier exposes origin(), its FIRE-time position beats params.x/y (params are the standalone/theater fallback fired with a null carrier). Same block across all effects.
- **One file per effect** under `js/effects/<name>.js`; imports only `./index.js` (+ siblings if composing). Adding an effect = one file + one registration line in `registry.js` + one demo (M7). **No engine change.** Pool/engine extensions must be strictly additive AND documented in the effect file header (precedent: 4.1/4.2 additive Sparkle fields debrisGravity/debrisRotation/rot/dustAlpha, cleared on slot recycle).
- **Compositors route children through the single spawn path** `fireManual({type, params})` from index.js (NOT direct factory calls) so overlay/STATE children get a real lifecycle and ANY registered type is a valid child (precedent: 4.3 composite explosion).
- **STATE vs one-shot:** one-shot bursts report done at fire time and are pruned immediately (pool owns their stepping). STATE/DRAW effects (trail, afterimage, markers, beam, overlays) stay active over their lifetime, own a timer, and complete at elapsed >= duration - 1e-9. Continuous-activation effects (trail 'moving', afterimage 'fastMoving') persist while the carrier satisfies the condition and terminate when idle/stopped (the 5.1 trail "fresh-point" rule is the model: complete at lifetime ONLY if no fresh point recorded that frame).
- **Frequency params:** Hz, 0 = per-frame mode, any positive f works verbatim (no clamping), hold-between-rolls, first roll on first update.
- **Shim naming:** per-entity sprite shake = `getEntityShakeOffset(e)`; the no-arg `getShakeOffset()` is the CAMERA path. Never add two same-named methods to the Effects literal (object-literal key collision bit us once).
- **No magic numbers at call sites:** named constants for defaults/tuning.

## Test conventions (this is where flakes come from — read carefully)
- Direct-intent / pure-unit style, **fixed dt = 1/60**, exact values within epsilon via `close(a,b,tol=EPS)` helpers.
- **Deterministic Math.random stubs — MEASURE the actual per-particle/per-child draw order empirically FIRST** (instrument a single spawn, count `Math.random()` calls, remove instrumentation) before writing stub sequences. This is the exact flake class that bit 4.1, 4.2, 4.3, and will hit 5.x/6.x again. Account for the `(2·rand−1)` factor in expected offsets, and remember `spawnOne` creates items at `(cx − SPARKLE_SIZE/2, cy − SPARKLE_SIZE/2)` (SPARKLE_SIZE=4) so assert deltas or offset-aware positions (recover launch coord as `it.x + 2`).
- **Geometry/DRAW effects (5.x, 6.x) should be deterministic — avoid Math.random where possible.** Use a recording canvas stub ctx (capture save/restore/fill/stroke/path/alpha/lineWidth) to assert what was drawn. Prefer asserting the documented/accepted CONTRACT (fades over lifetime, expands to maxRadius, sweeps the declared arc) over internal pixel counts.
- **Read launch positions BEFORE physics drifts them:** particles fly fast (~120 px/s), so capture a spawn's x/y on the frame it appears (drive `body.update(DT)` only, no `particles.updateAll` in the capture loop) or the "within ±radius" assertion breaks.
- **Standalone theater demo test must drive the REAL record/render path** (e.g. via a public method like trail's `addPoint(x,y)`) with a null carrier — do NOT poke `body.points` internals or hand-maintain buffer caps. Assert it draws AND self-terminates (bounded).
- **Avoid NaN at small N:** guard denominators like `n-2` with `Math.max(1, n-2)`; add a test asserting finite alpha/width at exactly 2 points.
- Re-run the suite ~10× on the new test file to confirm zero flakes before declaring green.

## Flakes (pre-existing, NOT yours to fix)
`barrel.solid.test.js` and `contextualAim.test.js` each fail intermittently (~25%) even on the untouched baseline (timing-sensitive physics sims). They're unrelated to this plan. **Re-run once before judging a failure** — if only these two are red and everything else passes, treat the suite as green and note it.

## Failure handling
- Task blocked after 2 fix cycles → stop wave, report to user, wait.
- Executor budget exhausted (max steps/time) → check what landed on disk first (it often did substantial work), then a diagnosis-first re-dispatch (max 1), then BLOCKED. Clean up any `tmp/` or `/tmp` debug scripts the executor left behind.
- Wave gate red → bisect, fix, re-run. Max 2 cycles, then stop.
- Reviewer A unavailable → proceed with B only, flag "A-unavailable" in reviews.md. Reviewer B unavailable → retry 1–2×, then proceed with A only, flag "B-unavailable".

## Wave gate (between waves)
1. Full suite vs `baseline.txt` (31/31 at reset) + `effectRegression.test.js` (from W2+) + `effectCatalog.test.js` (from W3+, once it exists in M7). Any NEW failure → fix executor, re-run, max 2 cycles.
2. **Wave review** — both reviewers on the accumulated wave diff since last gate (`git diff <last-gate-commit> HEAD`).
3. Gate commit: `effects: wave <n> gate`.

## Open item
- Theater shortcut key: task 7.2 leaves it as "a new debug key (e.g. KeyE)". Pick an unused letter when you get there.
