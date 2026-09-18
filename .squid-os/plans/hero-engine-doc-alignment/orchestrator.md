# Orchestrator — hero-engine-doc-alignment

Execution contract for running this plan with **no human between tasks**.
The runner (plan-runner / inline agents) follows this file exactly.

## Source of truth & precedence

1. `petal-panic/docs/hero-mechanics.md` — **wins over existing code** whenever they disagree.
2. This plan (`hero-engine-doc-alignment.md`) — task scope, acceptance criteria, verify commands.
3. Existing code — preserved unless a task explicitly changes it.

Every executor and reviewer prompt MUST include the doc sections referenced by the task, inlined. Do not make agents hunt for context.

## Models

| Role | Model ref | Notes |
|---|---|---|
| Executor | session default (or strongest available coding model) | writes code + tests |
| Reviewer A (line-level) | `ninfer/qwen3.8-27b` | local, fast, free — runs first |
| Reviewer B (intent-level) | `openai-codex/gpt-5.6-sol` | cloud — provider is `openai-codex`, NOT `openai-coder`; retry 1–2× on "servers overloaded" |
| Test execution | deterministic shell — never an LLM | `node petal-panic/js/test/<file>.test.js` |

## Wave structure (strict order)

```
Wave 1: 1.1 → 1.2 → 1.3 → 1.4 → 1.5     (independent fixes; run sequentially to keep diffs reviewable)
Gate 1: full existing suite green + wave review
Wave 2: 2.1 → 2.2 → 2.3                  (2.3 hitbox pattern feeds 4.1)
Gate 2: full suite green + wave review
Wave 3: 3.1 → 3.2                        (cancel builds on buffer — strict order)
Gate 3: full suite green + wave review
Wave 4: 4.1 → 4.2 → 4.3                  (4.3 is the final §33 invariant gate)
Gate 4: run-all.mjs green + final review → EPIC DONE
```

Do not parallelize within a wave: each task's diff must be isolated so reviewers can attribute findings.

## Per-task loop (no human checkpoint)

1. **Execute.** Inline agent receives the EXECUTOR PROMPT (below). It implements the task AND writes the named test file(s). It does NOT commit.
2. **Verify (mechanical).** Runner executes every `Verification:` command of the task, plus the task's related existing tests. Capture full stdout/stderr.
3. **Fix cycle.** If red: feed the exact failure output back to the same executor, max **2 retry cycles**. Still red → mark task BLOCKED, stop the wave, surface to user with the failing command + stderr.
4. **Review A** (qwen3.8-27b): line-level pass on the task diff.
5. **Review B** (gpt-5.6-sol): intent/doc-conformance pass on the task diff.
6. **Resolve reviews.** Findings are either ACCEPT (executor fixes, re-run step 2) or REJECT (runner notes why). Disagreement between A and B → mechanical tests break the tie if relevant; otherwise surface a one-line question to the user (the only allowed human interrupt mid-wave).
7. **Done.** Task marked complete. Next task. No commits per task.

Commits: one commit per wave at its gate, message `hero-align: <wave summary>`, only after the gate is green. Never commit a red suite.

## Wave gate (between waves)

1. Run the FULL existing test suite: every `petal-panic/js/test/*.test.js` (until task 4.3 lands `run-all.mjs`, then that single command).
2. Any failure → treat as regression: identify the task responsible via `git diff`, fix before continuing. The "don't break existing mechanics" rule is enforced here, mechanically.
3. WAVE REVIEWER pass (both models, accumulated wave diff) using the cross-cutting rubric below.
4. Commit the wave.

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
9. **Test quality**: the task's new test file asserts the acceptance criteria as executable checks (scripted inputs over fixed dt), not tautologies or implementation details.

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

RULES:
- Read the current code first; classify what already exists vs what is new. Reuse existing systems (damage(), Timers, hitbox slots, phase machine) — do not create parallel paths.
- Implement the task AND write the named test file(s) asserting the acceptance criteria as executable checks (scripted input sequences over fixed dt = 1/60).
- Do not commit. Do not touch files outside the task's Files list except adding the named test files.
- Keep tuning values as named constants (doc §35). No inline magic numbers.
- If the doc and existing code disagree, the doc wins — but note the conflict in your final report.
- Final report: changed files, how each acceptance criterion is satisfied, conflicts found, anything you deliberately did NOT change and why.
```

### REVIEWER PROMPT A — line-level (ninfer/qwen3.8-27b)

```
{CROSS-CUTTING QUALITY RUBRIC}

CONTEXT: Task {id} "{name}" — acceptance criteria: {list}. Doc sections: {§refs}.
DIFF:
{task diff}

Focus: items 2, 4, 5, 7, 9 (duplication, magic numbers, anim sync, cancel-order, test quality) plus concrete bugs (off-by-one frames, stale flags, wrong timer name, missing mirror case).
Verdict: PASS or FAIL + numbered findings (file:line — issue — §ref — severity).
```

### REVIEWER PROMPT B — intent-level (openai-codex/gpt-5.6-sol)

```
{CROSS-CUTTING QUALITY RUBRIC}

CONTEXT: Task {id} "{name}" — acceptance criteria: {list}.
DOC SECTIONS (authoritative):
{inline the doc sections}
DIFF:
{task diff}

Focus: item 1 (exact doc conformance — quote the doc line the code must satisfy), item 3 (state composition), item 6 (hitbox windows), item 8 (regression risk to other hero mechanics). Judge intent, not style.
On transient API overload, the runner retries you up to 2 times.
Verdict: PASS or FAIL + numbered findings (file:line — issue — §ref — severity).
```

### WAVE REVIEWER PROMPT (both models, at each gate)

```
{CROSS-CUTTING QUALITY RUBRIC}

CONTEXT: End-of-wave review for Wave {n} (tasks {ids}). Full wave diff below.
The mechanical test suite already passed — you are checking what tests cannot see:
cross-task duplication introduced by the wave, drift from the doc's interaction
rules (§19, §31, §32, §33), and any weakening of existing feel invariants.
WAVE DIFF:
{accumulated diff since last gate}
Verdict: PASS or FAIL + numbered findings.
```

## Failure handling

- **Task blocked after 2 fix cycles** → stop wave, report: task id, failing verify command, stderr, reviewer verdicts. Wait for user.
- **Wave gate red** → bisect the wave's tasks via git, fix the regressing task, re-run gate. Max 2 gate-fix cycles, then stop and report.
- **Reviewer unavailable** (provider error after retries) → proceed with the single available reviewer + mechanical tests, and flag the task as "single-reviewed" in the wave report. Never skip the mechanical tests.
- **User interrupt questions** are limited to reviewer disagreements on judgment calls — one line each, batched at the next gate if non-blocking.

## Definition of done (epic)

1. All 12 tasks complete, each with its verify commands green.
2. `node petal-panic/js/test/run-all.mjs` (task 4.3) green — includes the full §33 invariant suite.
3. Every §33 bullet has a named passing test.
4. Final wave review PASS from both reviewers.
5. One commit per wave; working tree clean; plan file updated with completion status.
