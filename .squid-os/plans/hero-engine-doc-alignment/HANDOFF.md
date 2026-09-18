# HANDOFF — hero-engine-doc-alignment

Read this first, then read `orchestrator.md` (the binding execution contract). Do not rely on any chat history.

## Current state (verified at commit 030305b)

- **Code:** clean. All petal-panic js code is at baseline; no plan work has landed yet.
- **Tests:** the active suite is `petal-panic/js/test/*.test.js` (14 files). Eight bit-roted pre-existing tests were archived to `petal-panic/js/test/bck/` (boss, enemies51, jester, lives, object, powerup, screens, screens82) — do NOT run or "fix" them as part of this plan; they are out of scope.
- **Baseline:** `baseline.txt` records the pre-work suite state. Two known stale failures: `heroHit.test.js` and `timers.test.js` (both assert a legacy `'inv'` timer label; tasks 1.3/1.4 fix them as part of their scope). Gate rule: no NEW failures vs baseline.
- **Progress:** `.plan-progress.json` was just flushed — all 13 tasks pending, start at 1.1. Re-init with the plan-runner script if missing.
- **Plan docs:** `hero-engine-doc-alignment.md` contains the TESTING CONVENTION section (binding). `orchestrator.md` v2 contains the full execution policy. Both committed.

## Start command

Run the plan `hero-engine-doc-alignment` per its `orchestrator.md`, autonomously, task after task, no human between tasks. The orchestrator defines: wave order, per-task loop (execute → verify → Review A + B on the uncommitted diff → resolve findings → record verdicts in reviews.md → commit → mark done), executor budgets, reviewer prompts/rubric, wave gates vs baseline, and commit discipline (`hero-align <task-id>: <name>`, post-review only).

## Scars from the previous (aborted) run — do not repeat

1. **Fragile test harnesses.** First run built DOM-key-simulation harnesses against the full input pipeline → key leaks, edge-timing guesswork, agent loops. Fix: direct-intent pattern (`hero.update(DT, intent)`, see jumpslide.test.js) for all mechanic tests. It's now law in the orchestrator's testing convention.
2. **Unbounded executors loop.** An executor with no step budget re-ran one probe 168×. Fix: hard budgets (150 steps / 200 tools / 45m) + anti-loop rule (max 2 identical probes) in every dispatch.
3. **Reviews skipped.** Tasks were marked done on green tests alone; the dual-review stage never ran. Fix: a task is done ONLY when both reviewer verdicts are recorded in `reviews.md`. Green tests ≠ done.
4. **Runner coded directly.** The orchestrating session edited code itself after agent failures. Forbidden now: runner never writes code; two failed executor attempts → stop and surface to user.
5. **Mixed diffs.** Reviewers must judge ONE task's changes, not a pile. Fix: reviewers get the task's uncommitted diff (`git diff` + new test files); the task is committed only AFTER both reviews pass, so each commit is exactly the reviewed state.

## Rules that are easy to forget

- Runner (you) NEVER edits code — delegation only. Plan/orchestrator docs and git ops are fine.
- No inline HTTP servers in any agent work (freezes the host app). Live gameplay feel = user, manually, via server.py at the end.
- Doc wins over code: `petal-panic/docs/hero-mechanics.md` is the single source of truth.
- Commits: per task ONLY after verify green + both reviews recorded + accepted findings fixed (`hero-align <id>: <name>`); wave gate commits for bookkeeping. Never commit a red suite or unreviewed code.
- If an executor exhausts its budget: inspect the leftover diff, re-dispatch ONCE diagnosis-first, else BLOCKED + stop wave + report.
