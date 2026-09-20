# Orchestrator — effect-engine

Execution contract for running the `effect-engine` plan with **no human between tasks**.
Simplified from the knockback-system orchestrator: each coding task is delegated to a
**task-executor** agent; the runner does mechanical verify + one review pass and commits at
gates. No dual-reviewer ceremony.

## Source of truth & precedence

1. `petal-panic/docs/architecture/effects.md` — **wins over existing code** whenever they
   disagree. It is the conceptual spec (effects are `{ type, params }` data objects attached
   to carriers and fired on trigger events; the trigger table; §26 Beam; extensibility rules).
2. This plan (`effect-engine.md`) — task scope, acceptance criteria, verify commands.
3. This orchestrator — execution policy, budgets, gates, commit discipline.
4. Existing code — preserved unless a task explicitly changes it. **Critically:** the current
   `Effects.*` behavior (vignette/flash decay curves, sparkle counts, shake bounds) must keep
   behaving identically; task 2.3 is the regression gate that proves the migration is
   behavior-preserving.

Every executor prompt MUST include the relevant `effects.md` sections inlined. Do not make
agents hunt for context.

## Runner role (hard rule)

**The runner NEVER writes or edits game code.** All code changes go through a task-executor
agent. If two executor attempts fail on a task, the runner stops and surfaces the failure to
the user with the diff and failure output; it does NOT take over.

Runner duties: dispatching task-executor agents, running mechanical verify/gate commands,
recording verdicts, git operations (commit at gates), updating progress files, and editing
plan/orchestrator documents.

Runner anti-loop: when a diagnosis already exists, act on it — max 5 read/inspect calls before
dispatching or acting.

## Execution model (simplified)

Each coding task = **one task-executor call**. The runner builds the prompt from the task
(What / Why / Files / Snippet / Acceptance / Verify) plus the inlined `effects.md` sections and
the testing convention below, then:

1. Dispatches the task-executor agent (budgets below).
2. Runs the task's `Verification:` commands mechanically.
3. If red: feeds the exact failure back to a fresh task-executor (diagnosis-first), max 2
   retry cycles. Still red → mark BLOCKED, stop the wave, surface to user.
4. One REVIEWER pass (line + intent combined) on the uncommitted diff.
5. Resolve findings (executor fixes, re-verify) or note why rejected.
6. Commit the reviewed state, then mark the task done.

A task is not done with green tests alone — the review must be recorded and the commit made
after review.

## Models

| Role | Model ref | Notes |
|---|---|---|
| Executor | session default (or strongest available coding model) via `task-executor` | writes code + tests |
| Reviewer | `ninfer/qwen3.8-27b` (local, fast) — single combined pass | judges the diff only |
| Test execution | deterministic shell — never an LLM | `node petal-panic/js/test/<file>.test.js` |

If a cloud reviewer is wanted, `openai-codex/gpt-5.6-sol` may be added as a second opinion, but
it is optional for this epic.

## Executor budgets (hard caps)

Every task-executor dispatch uses: **max_steps 150, max_tools 200, max_time 45m.**

On budget exhaustion: inspect what was left (git diff + last test output), re-dispatch ONCE
with a diagnosis-first prompt. Still failing → BLOCKED, stop the wave, surface to user. Never a
third blind retry.

## Testing convention (binding for all executors)

1. **Effect engine tests are pure node unit tests** (no DOM): `effects/index.js`,
   `carrier.js`, and each effect file import cleanly under node and expose deterministic
   behavior. Fixed inputs, exact expected values within epsilon.
2. **Per-effect catalog tests** (`effectCatalog.test.js`) assert each new effect spawns/draws
   from its params alone (correct particle counts/ranges, correct geometry bounds, correct
   timing curves) without any real gameplay entity.
3. **Behavior-preservation regression (task 2.3)**: capture the pre-refactor `Effects.*`
   reference values (sparkle count ranges, vignette/flash decay at fixed dt, shake offset
   bounds) into `.squid-os/plans/effect-engine/effect-reference.txt` BEFORE the refactor lands,
   then assert the engine path reproduces them within epsilon. This is the gate proving the
   migration didn't change existing feel.
4. **No inline HTTP servers** in any agent work (freezes the host app). Real in-game feel is
   verified manually by the user at the end; no automated acceptance criterion may depend on
   in-game observation.
5. **Executor anti-loop rule (include verbatim in every executor prompt):** max 2 identical
   diagnostic runs; edit-first/verify-after; if a probe repeats identically, read source
   instead of re-probing.

## Wave structure (strict order)

```
Wave 1: M1 (1.1 doc → 1.2 core → 1.3 carrier)
Gate 1: full suite vs baseline + review + commit
Wave 2: M2 (2.1 split → 2.2 shim → 2.3 regression)
Gate 2: full suite vs baseline + preservation regression green + commit
Wave 3: M3 (screen-space/overlay effects)
Gate 3: full suite vs baseline + catalog tests green + commit
Wave 4: M4 (particle/burst effects)
Gate 4: full suite vs baseline + catalog tests green + commit
Wave 5: M5 (motion/telegraph/marker effects)
Gate 5: full suite vs baseline + catalog tests green + commit
Wave 6: M6 (sprite-state + Beam)
Gate 6: full suite vs baseline + catalog tests green + commit
Wave 7: M7 (7.1 demos → 7.2 theater → 7.3 YAML → 7.4 handoff)
Gate 7: run-all.mjs green + final review → EPIC DONE
```

Ordering notes:
- M2 (migration + preservation regression) completes before ANY new effect is added, so the
  engine is proven stable before the catalog grows.
- Within a milestone, run tasks in listed order; each task's diff stays isolated so the
  reviewer can attribute findings. New-effect tasks in M3–M6 are independent and MAY be
  parallelized only if their diffs remain separable (separate files); otherwise run serially.

## Baseline (recorded once at reset, before task 1.1)

Run the FULL suite `petal-panic/js/test/*.test.js` on clean pre-work code and record pass/fail
per file in `.squid-os/plans/effect-engine/baseline.txt`. Known pre-existing failures are
BASELINE — a gate is green when there are **no NEW failures and no regressions** vs baseline.

ALSO at reset: capture the **pre-refactor `Effects.*` reference values** (sparkle count ranges,
vignette/flash decay at fixed dt, shake offset bounds) into
`.squid-os/plans/effect-engine/effect-reference.txt`. Task 2.3 asserts against this captured
reference, so it must be recorded BEFORE the monolith is split.

## Per-task loop (no human checkpoint)

1. **Execute.** task-executor receives the EXECUTOR PROMPT with standard budgets. It implements
   the task AND writes/updates the named test file(s). It does NOT commit.
2. **Verify (mechanical).** Runner executes every `Verification:` command of the task plus the
   task's related existing tests. Capture full stdout/stderr.
3. **Fix cycle.** If red: feed the exact failure output back to a fresh task-executor
   (diagnosis-first prompt), max 2 retry cycles total. Still red → BLOCKED, stop the wave,
   surface to user with the failing command + stderr.
4. **Review** (qwen3.8-27b): combined line-level + intent pass on the task's UNCOMMITTED diff
   (`git diff` + untracked files) using the rubric below.
5. **Resolve reviews.** Findings ACCEPT (executor fixes, re-run step 2 until green) or REJECT
   (runner notes why). Iterate max 2 review rounds per task, then surface to user.
6. **Record.** Append the verdict + resolution to `.squid-os/plans/effect-engine/reviews.md`
   (one block per task).
7. **Task commit — AFTER review only.** Verify green AND review recorded AND accepted findings
   fixed → runner commits: `effects <task-id>: <task name>`. Never commit code that has not
   passed review.
8. **Done.** Mark complete ONLY after steps 2, 4, 6, 7 are recorded. Next task.

## Wave gate (between waves)

1. Run the FULL existing test suite (every `petal-panic/js/test/*.test.js` or `run-all.mjs`).
   Compare against `baseline.txt`: any NEW failure or regression → identify the responsible
   task via its commit, dispatch a fix executor, re-run gate. Max 2 gate-fix cycles, then stop.
   - From Wave 2 onward ALSO run the preservation regression (`effectRegression.test.js`) — it
     must stay green at every gate.
   - From Wave 3 onward also run `effectCatalog.test.js`.
2. WAVE REVIEWER pass (single model, accumulated wave diff since last gate) using the rubric.
   Verdict appended to `reviews.md`.
3. Gate commit: `effects: wave <n> gate` (bookkeeping only).

## Quality rubric (single reviewer, both line + intent)

You are reviewing a diff against the Petal Panic Effect Engine. The design doc
(`effects.md`) is the single source of truth and wins over prior code. Report each finding as:
file:line — issue — doc § reference — severity (blocker/major/minor).

1. **Doc conformance**: does the diff implement the cited `effects.md` behavior exactly? An
   effect is a `{ type, params }` data object; it renders from params alone; it fires on its
   declared trigger. Any divergence is a blocker unless the task text overrides.
2. **One mechanism, no branching**: effects attach to carriers via declarative config and fire
   through the single registry/trigger path. No per-effect or per-call-site branching at the
   point of impact. New logic routes through the registry.
3. **One file per effect**: each effect lives in its own `js/effects/<name>.js`; effect files
   import only `index.js` + `particles.js`, never another effect file.
4. **Behavior preservation (existing effects)**: the migrated effects must produce the SAME
   observable output (counts, decay curves, shake bounds) as before the refactor. Any silent
   change is a blocker.
5. **Extensibility**: adding a new effect must require NO engine change — one file + one
   registration + one demo. Flag any change that forces touching `index.js` to add an effect.
6. **No duplication**: no second copy of particle spawning, overlay drawing, or timer
   bookkeeping outside the shared systems.
7. **No magic numbers at call sites**: tuning lives in the effect file or named constants /
   data tables — never inline in `update.js` handlers.
8. **No regressions**: existing tested behaviors (hero i-frames, weapon pools, one-hit-per-swing,
   death pipeline, debug mode) must remain intact. F1/F2 still exits debug even from the theater.
9. **Test quality**: new tests assert the acceptance criteria as executable checks in the
   direct-intent / pure-unit style (fixed dt = 1/60, exact expected values within epsilon), not
   tautologies or fragile full-pipeline harnesses.

Verdict format: `PASS` or `FAIL` + numbered findings. No prose padding.

## Prompts

### EXECUTOR PROMPT (per task)

```
You are implementing ONE task from the Petal Panic effect-engine plan.

TASK {id}: {name}
Type: {type}
What: {what}
Why: {why}
Files: {files list with +/~ markers}

DESIGN DOC (single source of truth — wins over existing code):
{inline the relevant effects.md sections}

ACCEPTANCE CRITERIA (all must hold):
{acceptance list}

VERIFY COMMANDS (must all exit 0 when you finish):
{verify list}

TESTING CONVENTION (binding):
{the 5-point convention from this orchestrator, verbatim}

RULES:
- Read the current code first; classify what exists vs what is new. Reuse the shared particle
  pool, the registry/trigger path, and the carrier interface — do not create parallel paths.
- An effect is DATA ({ type, params }); it renders from params alone and fires on its declared
  trigger. No layer/type branching at the impact site.
- One file per effect under js/effects/; effect files import only index.js + particles.js.
- Implement the task AND write/update the named test file(s) asserting the acceptance criteria
  as executable checks (direct-intent / pure-unit style, fixed dt = 1/60).
- For task 2.3 specifically: assert against the pre-refactor reference values in
  effect-reference.txt; do not alter existing Effects.* feel.
- Do not commit. Do not touch files outside the task's Files list except adding the named test
  files.
- Keep tuning values as named constants / data tables. No inline magic numbers.
- Edit-first/verify-after. ANTI-LOOP: max 2 identical diagnostic runs; if a probe repeats
  identically, read source instead of re-probing.
- If the doc and existing code disagree, the doc wins — note the conflict in your final report.
- Final report: changed files, how each acceptance criterion is satisfied, conflicts found,
  anything you deliberately did NOT change and why.
```

### REVIEWER PROMPT (single combined pass — ninfer/qwen3.8-27b)

```
{QUALITY RUBRIC}

CONTEXT: Task {id} "{name}" — acceptance criteria: {list}. Doc sections: {§refs}.
DIFF (uncommitted task diff — git diff + new files):
{diff output}

Judge both line-level correctness (wrong normal/angle, missing clamp, sign error, stale flag,
missing facing mirror, duplicated spawn/timer logic) and intent (exact doc conformance,
one-mechanism/no-branching, one-file-per-effect, behavior preservation, extensibility).
You judge the diff only — do not run tests, do not edit code.
Verdict: PASS or FAIL + numbered findings (file:line — issue — §ref — severity).
```

### WAVE REVIEWER PROMPT (at each gate)

```
{QUALITY RUBRIC}

CONTEXT: End-of-wave review for Wave {n} (tasks {ids}). Full wave diff below.
The mechanical test suite already passed against baseline (and the preservation/catalog tests
where applicable) — check what tests cannot see: cross-task duplication introduced by the
wave, drift from the doc's effect model (§model, trigger table, Beam), behavior-preservation
weakening, and any change that breaks the "add an effect = one file" extensibility rule.
WAVE DIFF:
{accumulated diff since last gate}
Verdict: PASS or FAIL + numbered findings.
```

## Failure handling

- **Task blocked after 2 fix cycles** → stop wave, report: task id, failing verify command,
  stderr, reviewer verdict. Wait for user.
- **Executor budget exhausted** → diagnosis-first re-dispatch (max 1), then BLOCKED per above.
- **Wave gate red vs baseline OR preservation/catalog regression red** → bisect the wave's task
  commits, fix the regressing task, re-run gate. Max 2 gate-fix cycles, then stop and report.
- **Reviewer unavailable** → proceed with mechanical tests and flag the task "single-reviewed /
  mechanical-only" in reviews.md. Never skip the mechanical tests.
- **User interrupt questions** are limited to reviewer judgment calls — one line each, batched
  at the next gate if non-blocking.

## Definition of done (epic)

1. All 31 tasks complete (M1: 3, M2: 3, M3: 5, M4: 3, M5: 8, M6: 5, M7: 4), each with: verify
   green, task commit, review verdict recorded in reviews.md.
2. `node petal-panic/js/test/run-all.mjs` green vs baseline.
3. Preservation regression (`effectRegression.test.js`) green — existing `Effects.*` provably
   unchanged.
4. All 25 implemented effects (catalog §1–§24 + Beam; Heat Distortion excluded) have a passing
   catalog test and a working standalone theater demo.
5. The Effect Theater opens from a debug shortcut, steps all 25 in catalog order showing
   name + id + live demo, navigates via keyboard AND gamepad, Esc/cancel returns to debug, and
   F1/F2 exits to gameplay.
6. Adding a new effect requires no engine change (one file + one registration + one demo).
7. Every v1-scope bullet has a named passing test; Heat Distortion remains deferred (documented
   in effects.md, NOT implemented).
8. One commit per task (post-review) + gate commits; working tree clean at each gate; plan
   progress file updated.
