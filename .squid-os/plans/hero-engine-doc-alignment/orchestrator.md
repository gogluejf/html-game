# Orchestrator — hero-engine-doc-alignment

Execution contract for running this plan with **no human between tasks**.
The runner (plan-runner / main session) follows this file exactly.

## Source of truth & precedence

1. `petal-panic/docs/hero-mechanics.md` — **wins over existing code** whenever they disagree.
2. This plan (`hero-engine-doc-alignment.md`) — task scope, acceptance criteria, verify commands, testing convention.
3. This orchestrator — execution policy, budgets, gates, commit discipline.
4. Existing code — preserved unless a task explicitly changes it.

Every executor and reviewer prompt MUST include the doc sections referenced by the task, inlined. Do not make agents hunt for context.

## Runner role (hard rule)

**The runner NEVER writes or edits code.** No exceptions — not "small fixes", not test harness tweaks, not one-line corrections. All code changes go through an executor agent. If two executor attempts fail on a task, the runner stops and surfaces the failure to the user with the diffs and failure output; it does NOT take over.

Runner duties are limited to: dispatching agents, running mechanical verify/gate commands, recording verdicts, git operations (commit at gates), updating progress files, and editing plan/orchestrator documents.

Runner anti-loop: when a diagnosis already exists, act on it — max 5 read/inspect calls before dispatching or acting. No re-deriving what previous agents already reported.

## Models

| Role | Model ref | Notes |
|---|---|---|
| Executor | session default (or strongest available coding model) | writes code + tests |
| Reviewer A (line-level) | `ninfer/qwen3.8-27b` | local, fast, free — runs first |
| Reviewer B (intent-level) | `openai-codex/gpt-5.6-sol` | cloud — provider is `openai-codex`, NOT `openai-coder`; retry 1–2× on "servers overloaded" |
| Test execution | deterministic shell — never an LLM | `node petal-panic/js/test/<file>.test.js` |

Reviewers run as inline agents with the REVIEWER PROMPT below. They judge the diff only — they do not run tests or edit code.

## Executor budgets (hard caps)

Every executor dispatch uses: **max_steps 150, max_tools 200, max_time 45m.**

On `maximum steps exceeded`:
1. Runner inspects what the executor left behind (git diff + last test output).
2. Re-dispatch ONCE with a diagnosis-first prompt ("here is the current state, here is the root cause, make these specific edits"). Max 1 retry.
3. Still failing → mark task BLOCKED, stop the wave, surface to user with diff + failure output. Never a third blind retry.

## Testing convention (binding for all executors)

From the plan's TESTING CONVENTION section — restated here because it is part of the execution contract:

1. **Mechanic tests use the direct-intent pattern** (reference: `petal-panic/js/test/jumpslide.test.js`): call `hero.update(DT, intent)` with plain intent objects. No DOM key simulation, no input.js polling, no full `update()` pipeline, no document/window stubs. Assert behavior invariants (dir index, flags, velocity sign/magnitude, phase names, anim names) — not pixel offsets or tuning constants.
2. **One small wiring test per new input surface** (readInput/input.js edge cases) may use the full pipeline with stubbed DOM listeners — few in number, full key release + `processInput()` before/after every case, poll-until-condition instead of fixed frame counts.
3. **No inline HTTP servers** in any agent work (freezes the host app). Real gameplay feel is verified **manually by the user at the end** via `server.py`; no automated acceptance criterion may depend on in-game observation.
4. **Executor anti-loop rule (include verbatim in every executor prompt):** max 2 identical diagnostic runs; edit-first/verify-after; if a probe repeats identically, read source instead of re-probing; if a harness misbehaves twice, rewrite the case in direct-intent style before debugging the pipeline.

## Wave structure (strict order)

```
Wave 1: 1.1 → 1.2 → 1.3 → 1.4 → 1.5     (independent fixes; sequential for isolated diffs)
Gate 1: full suite vs baseline + wave review + commit
Wave 2: 2.1 → 2.2 → 2.3                  (2.3 hitbox pattern feeds 4.1)
Gate 2: full suite vs baseline + wave review + commit
Wave 3: 3.1 → 3.2                        (cancel builds on buffer — strict order)
Gate 3: full suite vs baseline + wave review + commit
Wave 4: 4.1 → 4.2 → 4.3                  (4.3 is the final §33 invariant gate)
Gate 4: run-all.mjs green + final review → EPIC DONE
```

Do not parallelize within a wave: each task's diff must be isolated so reviewers can attribute findings.

## Baseline (recorded once at reset, before task 1.1)

Run the FULL suite `petal-panic/js/test/*.test.js` on clean pre-work code and record pass/fail per file in `.squid-os/plans/hero-engine-doc-alignment/baseline.txt`. Known pre-existing failures (boss/enemies/jester/lives/etc.) are BASELINE — a gate is green when there are **no NEW failures and no regressions** vs baseline, not when everything is green.

## Per-task loop (no human checkpoint)

1. **Execute.** Inline executor agent receives the EXECUTOR PROMPT (below) with the standard budgets. It implements the task AND writes the named test file(s). It does NOT commit.
2. **Verify (mechanical).** Runner executes every `Verification:` command of the task, plus the task's related existing tests. Capture full stdout/stderr.
3. **Fix cycle.** If red: feed the exact failure output back to a fresh executor (diagnosis-first prompt), max **2 retry cycles** total. Still red → mark task BLOCKED, stop the wave, surface to user with the failing command + stderr.
4. **Review A** (qwen3.8-27b): line-level pass on the task's UNCOMMITTED diff (`git diff` + untracked test files).
5. **Review B** (gpt-5.6-sol): intent/doc-conformance pass on the same uncommitted diff.
6. **Resolve reviews.** Findings are either ACCEPT (executor agent fixes, re-run step 2 until green) or REJECT (runner notes why in the review log). Disagreement between A and B → mechanical tests break the tie if relevant; otherwise surface a one-line question to the user (the only allowed human interrupt mid-wave). Iterate reviews if fixes are non-trivial (max 2 review rounds per task, then surface to user).
7. **Record.** Append both verdicts + resolution to `.squid-os/plans/hero-engine-doc-alignment/reviews.md` (one block per task).
8. **Task commit — AFTER review only.** Verify green AND both verdicts recorded AND all accepted findings fixed → runner commits the reviewed state: `hero-align <task-id>: <task name>`. The commit contains exactly what the reviewers approved. Never commit code that has not passed both reviews.
9. **Done.** Task marked complete in progress file ONLY after steps 2, 4, 5, 7, 8 are all recorded. Next task.

**A task is not done with green tests alone — both reviewer verdicts must be recorded, and the commit happens only after review.**

## Wave gate (between waves)

1. Run the FULL existing test suite: every `petal-panic/js/test/*.test.js` (until task 4.3 lands `run-all.mjs`, then that single command). Compare against `baseline.txt`: any NEW failure or regression → identify the responsible task via its commit, dispatch a fix executor, re-run gate. Max 2 gate-fix cycles, then stop and report.
2. WAVE REVIEWER pass (both models, accumulated wave diff since last gate commit) using the cross-cutting rubric below. Verdicts appended to `reviews.md`.
3. Gate commit: `hero-align: wave <n> gate` (plan/progress/reviews bookkeeping only).

## Cross-cutting quality rubric (identical text for BOTH reviewers)

You are reviewing a diff against the Petal Panic hero engine. The design doc
(`hero-mechanics.md`) is the single source of truth and wins over prior code.

Check ONLY these. Report each finding as: file:line — issue — doc § reference — severity (blocker/major/minor).

1. **Doc conformance**: does the diff implement the cited § behavior exactly? Any divergence from the doc is a blocker unless the task text explicitly overrides.
2. **No duplication**: no second copy of aim resolution, damage routing, knockback math, timer bookkeeping, or hitbox rect math. New logic must route through the existing central systems (`damage()`, `Timers`, hitbox slots, the shared melee phase machine).
3. **No state-flag soup (§31)**: no new scattered booleans that consumers re-interpret. State must stay composable (airborne + facing + locked-aim + intangible can coexist).
4. **No magic numbers at call sites**: tuning values live in hero.js feel-knob constants or heroDefs.js data tables — never inline in update.js handlers.
5. **Animation/state sync (§29)**: any new state must be reflected in `heroAnimName()` / domain getters; no visual state may outlive its gameplay state.
6. **Hitboxes only in intended windows (§30)**: attack damage exists only on configured active frames; mirrored correctly when facing left.
7. **Cancellation > buffering (§19)**: where both apply, cancel is evaluated before buffer execution and clears the buffer.
8. **No regressions**: existing tested behaviors (double jump, coyote, jump buffer, variable height, slide, i-frames, weapon pools) must remain intact. Flag any change to them that isn't part of the task.
9. **Test quality**: the task's new test file asserts the acceptance criteria as executable checks in the DIRECT-INTENT style (plain intent objects over fixed dt = 1/60, per the testing convention), not tautologies, implementation details, or fragile full-pipeline harnesses.

Verdict format: `PASS` or `FAIL` + numbered findings. No prose padding.

## Prompts

### EXECUTOR PROMPT (per task)

```
You are implementing ONE task from the Petal Panic hero-engine alignment plan.

TASK {id}: {name}
Type: {type}
What: {what}
Why: {why}
Files: {files list with +/~ markers}

DESIGN DOC (single source of truth — wins over existing code):
{inline the relevant hero-mechanics.md sections, e.g. §4, §32}

ACCEPTANCE CRITERIA (all must hold):
{acceptance list}

VERIFY COMMANDS (must all exit 0 when you finish):
{verify list}

TESTING CONVENTION (binding):
{the 4-point convention from this orchestrator, verbatim}

RULES:
- Read the current code first; classify what already exists vs what is new. Reuse existing systems (damage(), Timers, hitbox slots, phase machine) — do not create parallel paths.
- Implement the task AND write the named test file(s) asserting the acceptance criteria as executable checks (direct-intent style, fixed dt = 1/60).
- Do not commit. Do not touch files outside the task's Files list except adding the named test files.
- Keep tuning values as named constants (doc §35). No inline magic numbers.
- Edit-first/verify-after. ANTI-LOOP: max 2 identical diagnostic runs; if a probe repeats identically, read source instead of re-probing.
- If the doc and existing code disagree, the doc wins — but note the conflict in your final report.
- Final report: changed files, how each acceptance criterion is satisfied, conflicts found, anything you deliberately did NOT change and why.
```

### REVIEWER PROMPT A — line-level (ninfer/qwen3.8-27b)

```
{CROSS-CUTTING QUALITY RUBRIC}

CONTEXT: Task {id} "{name}" — acceptance criteria: {list}. Doc sections: {§refs}.
DIFF (uncommitted task diff — git diff + new test files):
{diff output}

Focus: items 2, 4, 5, 7, 9 (duplication, magic numbers, anim sync, cancel-order, test quality) plus concrete bugs (off-by-one frames, stale flags, wrong timer name, missing mirror case).
You judge the diff only — do not run tests, do not edit code.
Verdict: PASS or FAIL + numbered findings (file:line — issue — §ref — severity).
```

### REVIEWER PROMPT B — intent-level (openai-codex/gpt-5.6-sol)

```
{CROSS-CUTTING QUALITY RUBRIC}

CONTEXT: Task {id} "{name}" — acceptance criteria: {list}.
DOC SECTIONS (authoritative):
{inline the doc sections}
DIFF (uncommitted task diff — git diff + new test files):
{diff output}

Focus: item 1 (exact doc conformance — quote the doc line the code must satisfy), item 3 (state composition), item 6 (hitbox windows), item 8 (regression risk to other hero mechanics). Judge intent, not style.
You judge the diff only — do not run tests, do not edit code.
On transient API overload, the runner retries you up to 2 times.
Verdict: PASS or FAIL + numbered findings (file:line — issue — §ref — severity).
```

### WAVE REVIEWER PROMPT (both models, at each gate)

```
{CROSS-CUTTING QUALITY RUBRIC}

CONTEXT: End-of-wave review for Wave {n} (tasks {ids}). Full wave diff below.
The mechanical test suite already passed against baseline — you are checking what tests cannot see:
cross-task duplication introduced by the wave, drift from the doc's interaction
rules (§19, §31, §32, §33), and any weakening of existing feel invariants.
WAVE DIFF:
{accumulated diff since last gate}
Verdict: PASS or FAIL + numbered findings.
```

## Failure handling

- **Task blocked after 2 fix cycles** → stop wave, report: task id, failing verify command, stderr, reviewer verdicts. Wait for user.
- **Executor budget exhausted** → diagnosis-first re-dispatch (max 1), then BLOCKED per above.
- **Wave gate red vs baseline** → bisect the wave's task commits, fix the regressing task, re-run gate. Max 2 gate-fix cycles, then stop and report.
- **Reviewer unavailable** (provider error after retries) → proceed with the single available reviewer + mechanical tests, and flag the task as "single-reviewed" in reviews.md. Never skip the mechanical tests.
- **User interrupt questions** are limited to reviewer disagreements on judgment calls — one line each, batched at the next gate if non-blocking.

## Definition of done (epic)

1. All 12 tasks complete, each with: verify green, task commit, BOTH reviewer verdicts recorded in reviews.md.
2. `node petal-panic/js/test/run-all.mjs` (task 4.3) green — includes the full §33 invariant suite.
3. Every §33 bullet has a named passing test.
4. Final wave review PASS from both reviewers.
5. One commit per task (post-review) + gate commits; working tree clean at each gate; plan progress file updated.
