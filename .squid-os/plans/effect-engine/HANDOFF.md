# HANDOFF — effect-engine

Fresh session: run this plan with plan-runner. Follow the orchestrator exactly.

- **Orchestrator (execution contract):** `.squid-os/plans/effect-engine/orchestrator.md`
- **Plan (tasks/acceptance/verify):** `.squid-os/plans/effect-engine/effect-engine.md`
- **Source of truth (arch spec):** `petal-panic/docs/architecture/effects.md`

## Start (at reset, before task 1.1)
1. Record full test-suite baseline → `baseline.txt`.
2. Capture pre-refactor `Effects.*` reference values (sparkle count ranges, vignette/flash decay at fixed dt, shake offset bounds) → `effect-reference.txt`. Task 2.3 asserts against it.
3. Begin Wave 1 (M1): 1.1 doc → 1.2 engine core → 1.3 carrier interface.

## Rules that matter most
- Runner never writes game code — every coding task goes through a task-executor agent.
- M2 (migration + preservation regression) must be green before ANY new effect lands.
- One file per effect under `js/effects/`; adding an effect = one file + one registration + one demo, no engine change.
- Heat Distortion is OUT (stays experimental in the doc). 25 effects implemented + demoed.
- Commit only after review; one commit per task + gate commits.

## Open item
- Theater shortcut key: task 7.2 leaves it as "a new debug key (e.g. KeyE)". Pick an unused letter if you have a preference.
