# Orchestrator — effect-engine

Execution contract for the `effect-engine` plan. No human between tasks.

## How we run

- **plan-runner** drives the loop: init progress → next-task → mark-in-progress → delegate → verify → review → commit → mark-done → next.
- **task-executor** executes each task: receives the plan path + task id, reads its own context from the plan file, writes code + tests, reports back.
- The runner NEVER codes. It dispatches, verifies mechanically, reviews, commits, tracks progress.

## Per-task loop (strict order)

1. `progress.py mark-in-progress`
2. **Execute** — inline agent with `task-executor` skill, passed the plan path + task id. Budgets: max_steps 150, max_tools 200, max_time 15m.
3. **Verify** — run every `Verification:` command from the task + related existing tests.
4. **Fix cycle** — if red: fresh task-executor with diagnosis-first prompt. Max 2 retries. Still red → BLOCKED, stop wave, surface to user.
5. **Review A** (qwen3.8-27b, line-level) on uncommitted diff.
6. **Review B** (gpt-5.6-sol, intent/doc-conformance) on same diff.
7. **Resolve** — ACCEPT (executor fixes, re-verify) or REJECT (note why). Disagreement → mechanical tests break tie; else one-line question to user. Max 2 rounds.
8. **Record** — append both verdicts + resolution to `reviews.md`.
9. **Commit** — `effects <task-id>: <task name>`. Only after steps 3–8 complete.
10. `progress.py mark-done`.

**A task is NOT done until committed. No next task before the commit lands.**

## Wave gate (between waves)

1. Full test suite vs `baseline.txt`. Any NEW failure → fix executor, re-run. Max 2 cycles.
   - From Wave 2+: also run `effectRegression.test.js`.
   - From Wave 3+: also run `effectCatalog.test.js`.
2. **Wave review** — both reviewers on accumulated wave diff since last gate.
3. Gate commit: `effects: wave <n> gate`.

## Models

| Role | Model | Notes |
|---|---|---|
| Executor | session default via `task-executor` skill | writes code + tests |
| Reviewer A | `ninfer/qwen3.8-27b` | local, line-level; max_steps 75, max_time 15m |
| Reviewer B | `openai-codex/gpt-5.6-sol` | cloud, intent/doc-conformance; max_steps 75, max_time 15m; retry 1–2× if overloaded |
| Tests | deterministic shell | never an LLM |

## Source of truth & precedence

1. `petal-panic/docs/architecture/effects.md` — wins over code.
2. `effect-engine.md` — task scope, acceptance, verify commands.
3. This orchestrator — execution policy, budgets, gates.
4. Existing code — preserved unless a task explicitly changes it.

## Baseline (once at reset, before task 1.1)

- Full suite → `baseline.txt`.
- Pre-refactor `Effects.*` reference values → `effect-reference.txt` (task 2.3 asserts against it).

## Wave structure

```
Wave 1: M1 (1.1 → 1.2 → 1.3)          Gate 1
Wave 2: M2 (2.1 → 2.2 → 2.3)          Gate 2 (+ regression)
Wave 3: M3 (3.1–3.5)                  Gate 3 (+ catalog)
Wave 4: M4 (4.1–4.3)                  Gate 4 (+ catalog)
Wave 5: M5 (5.1–5.8)                  Gate 5 (+ catalog)
Wave 6: M6 (6.1–6.5)                  Gate 6 (+ catalog)
Wave 7: M7 (7.1–7.4)                  Gate 7 → EPIC DONE
```

M2 completes before ANY new effect. Tasks within a milestone run in listed order.

## Quality rubric (both reviewers)

Report findings as: file:line — issue — doc § ref — severity (blocker/major/minor).

1. **Doc conformance**: implements `effects.md` behavior exactly. Effect = `{ type, params }`, renders from params alone, fires on declared trigger.
2. **One mechanism, no branching**: single registry/trigger path. No per-effect or per-call-site branching.
3. **One file per effect**: `js/effects/<name>.js`; imports only `index.js` + `particles.js`.
4. **Behavior preservation**: migrated effects produce SAME output as before. Silent change = blocker.
5. **Extensibility**: adding an effect = one file + one registration + one demo. No engine change.
6. **No duplication**: no second copy of particle spawning, overlay drawing, or timer bookkeeping.
7. **No magic numbers at call sites**: tuning in effect files or named constants.
8. **No regressions**: existing tested behaviors intact. F1/F2 exits debug even from theater.
9. **Test quality**: direct-intent / pure-unit style, fixed dt = 1/60, exact values within epsilon.

Verdict: `PASS` or `FAIL` + numbered findings. No prose padding.

## Failure handling

- Task blocked after 2 fix cycles → stop wave, report to user. Wait.
- Executor budget exhausted → diagnosis-first re-dispatch (max 1), then BLOCKED.
- Wave gate red → bisect, fix, re-run. Max 2 cycles, then stop.
- Reviewer A unavailable → proceed with B only, flag "A-unavailable" in reviews.md.
- Reviewer B unavailable → retry 1–2×, then proceed with A only, flag "B-unavailable".
- User interrupts limited to reviewer disagreement — one line, batched at next gate if non-blocking.

## Definition of done (epic)

1. All 31 tasks: verify green, both reviews recorded, committed.
2. `run-all.mjs` green vs baseline.
3. Preservation regression green.
4. All 25 effects have passing catalog test + theater demo.
5. Theater: debug shortcut, steps 25 effects, kbd + gamepad, Esc returns, F1/F2 exits.
6. Adding an effect = one file + one registration + one demo.
7. Heat Distortion deferred (documented, NOT implemented).
8. One commit per task + gate commits; clean tree at each gate; progress file updated.
