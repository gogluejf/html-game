# Orchestrator — knockback-system

Execution contract for running the `knockback-system` plan with **no human between tasks**.
The runner (plan-runner / main session) follows this file exactly. Modeled on the
hero-engine-doc-alignment orchestrator, adapted to the knockback system's specifics.

## Source of truth & precedence

1. `petal-panic/docs/architecture/knockback.md` — **wins over existing code** whenever they
   disagree. It is the conceptual spec (strength = fixed weight + motion, mass resistance,
   direction modes, 2D knockback, stun/protection, the two impact-matrix tables §10/§11).
2. This plan (`knockback-system.md`) — task scope, acceptance criteria, verify commands,
   testing convention.
3. This orchestrator — execution policy, budgets, gates, commit discipline.
4. Existing code — preserved unless a task explicitly changes it. **Critically:** the
   existing enemy→hero knockback (contact/projectile/heavyProj/explosion via
   `KNOCKBACK_PROFILES`) must keep behaving identically; task 3.4 is the regression gate
   that proves the refactor is behavior-preserving.

Every executor and reviewer prompt MUST include the `knockback.md` sections referenced by the
task, inlined. Do not make agents hunt for context.

## Runner role (hard rule)

**The runner NEVER writes or edits code.** No exceptions — not "small fixes", not test
harness tweaks, not one-line corrections. All code changes go through an executor agent.
If two executor attempts fail on a task, the runner stops and surfaces the failure to the
user with the diffs and failure output; it does NOT take over.

Runner duties are limited to: dispatching agents, running mechanical verify/gate commands,
recording verdicts, git operations (commit at gates), updating progress files, and editing
plan/orchestrator documents.

Runner anti-loop: when a diagnosis already exists, act on it — max 5 read/inspect calls
before dispatching or acting. No re-deriving what previous agents already reported.

## Models

| Role | Model ref | Notes |
|---|---|---|
| Executor | session default (or strongest available coding model) | writes code + tests |
| Reviewer A (line-level) | `ninfer/qwen3.8-27b` | local, fast, free — runs first |
| Reviewer B (intent-level) | `openai-codex/gpt-5.6-sol` | cloud — provider is `openai-codex`, NOT `openai-coder`; retry 1–2× on "servers overloaded" |
| Test execution | deterministic shell — never an LLM | `node petal-panic/js/test/<file>.test.js` |

Reviewers run as inline agents with the REVIEWER PROMPT below. They judge the diff only —
they do not run tests or edit code.

## Executor budgets (hard caps)

Every executor dispatch uses: **max_steps 150, max_tools 200, max_time 45m.**

On `maximum steps exceeded`:
1. Runner inspects what the executor left behind (git diff + last test output).
2. Re-dispatch ONCE with a diagnosis-first prompt ("here is the current state, here is the
   root cause, make these specific edits"). Max 1 retry.
3. Still failing → mark task BLOCKED, stop the wave, surface to user with diff + failure
   output. Never a third blind retry.

## Testing convention (binding for all executors)

1. **Knockback math tests are pure node unit tests on `knockback.js`** (no DOM): assert exact
   impulse magnitudes/directions for base-only, motion-term (head-on vs sliding-past),
   mass-resistance scaling, and the zero/absent no-op case. Fixed inputs, exact expected
   numbers within epsilon.
2. **Enemy hitstun test drives `enemy.update(DT)` directly**: set `hitstunTimer > 0`,
   assert `ai()` is skipped while physics still integrate (knockback visible), and that the
   enemy resumes its prior AI state after the TTL.
3. **Attack-knockback tests use the direct-intent pattern**: set the hero's attack active
   state, call the hitbox resolver, feed the box into the damage path, assert the enemy's
   vx/vy/hitstunTimer changed as expected. No DOM key simulation.
4. **Behavior-preservation regression (task 3.4)**: for each existing enemy→hero source
   (contact, projectile, heavyProj, explosion), capture the pre-refactor hero reaction
   (vx/vy + `rec` timer + `intangible` timer) and assert the refactored path produces the
   same values within epsilon. This is the gate that proves the migration didn't change
   existing hero-hit feel.
5. **No inline HTTP servers** in any agent work (freezes the host app). Real gameplay feel
   is verified **manually by the user at the end**; no automated acceptance criterion may
   depend on in-game observation.
6. **Executor anti-loop rule (include verbatim in every executor prompt):** max 2 identical
   diagnostic runs; edit-first/verify-after; if a probe repeats identically, read source
   instead of re-probing; if a harness misbehaves twice, rewrite the case in direct-intent
   style before debugging the pipeline.

## Wave structure (strict order)

```
Wave 1: 1.1 → 1.2 → 1.3     (core mechanic: applyKnockback, enemy hitstun, wiring)
Gate 1: full suite vs baseline + wave review + commit
Wave 2: 2.1 → 2.2 → 2.3     (hero attacks carry knockback; 2.3 is the feel/regression pass)
Gate 2: full suite vs baseline + wave review + commit
Wave 3: 3.1 → 3.2 → 3.4 → 3.3  (unify body contact, YAML docs, PRESERVATION regression, then final handoff)
Gate 3: full suite vs baseline + preservation regression green + wave review + commit
Wave 4: 4.1                 (self-protection on connect)
Gate 4: run-all.mjs green + preservation regression green + final review → EPIC DONE
```

Ordering notes:
- 3.4 (preserve existing enemy→hero knockback) runs BEFORE 3.3 (final handoff) so the
  behavior-preservation proof is in place before we declare the refactor complete.
- Do not parallelize within a wave: each task's diff must be isolated so reviewers can
  attribute findings.

## Baseline (recorded once at reset, before task 1.1)

Run the FULL suite `petal-panic/js/test/*.test.js` on clean pre-work code and record
pass/fail per file in `.squid-os/plans/knockback-system/baseline.txt`. Known pre-existing
failures are BASELINE — a gate is green when there are **no NEW failures and no
regressions** vs baseline, not when everything is green.

ALSO at reset: capture the **pre-refactor enemy→hero knockback reference values** (the four
sources' resulting hero vx/vy + rec + intangible timers) into
`.squid-os/plans/knockback-system/knockback-reference.txt`. Task 3.4 asserts against this
captured reference, so it must be recorded BEFORE any refactor lands.

## Per-task loop (no human checkpoint)

1. **Execute.** Inline executor agent receives the EXECUTOR PROMPT (below) with the
   standard budgets. It implements the task AND writes the named test file(s). It does NOT
   commit.
2. **Verify (mechanical).** Runner executes every `Verification:` command of the task, plus
   the task's related existing tests. Capture full stdout/stderr.
3. **Fix cycle.** If red: feed the exact failure output back to a fresh executor
   (diagnosis-first prompt), max **2 retry cycles** total. Still red → mark task BLOCKED,
   stop the wave, surface to user with the failing command + stderr.
4. **Review A** (qwen3.8-27b): line-level pass on the task's UNCOMMITTED diff
   (`git diff` + untracked test files).
5. **Review B** (gpt-5.6-sol): intent/doc-conformance pass on the same uncommitted diff.
6. **Resolve reviews.** Findings are either ACCEPT (executor agent fixes, re-run step 2
   until green) or REJECT (runner notes why in the review log). Disagreement between A and
   B → mechanical tests break the tie if relevant; otherwise surface a one-line question to
   the user (the only allowed human interrupt mid-wave). Iterate reviews if fixes are
   non-trivial (max 2 review rounds per task, then surface to user).
7. **Record.** Append both verdicts + resolution to `.squid-os/plans/knockback-system/reviews.md`
   (one block per task).
8. **Task commit — AFTER review only.** Verify green AND both verdicts recorded AND all
   accepted findings fixed → runner commits the reviewed state: `knockback <task-id>: <task
   name>`. The commit contains exactly what the reviewers approved. Never commit code that
   has not passed both reviews.
9. **Done.** Task marked complete in progress file ONLY after steps 2, 4, 5, 7, 8 are all
   recorded. Next task.

**A task is not done with green tests alone — both reviewer verdicts must be recorded, and
the commit happens only after review.**

## Wave gate (between waves)

1. Run the FULL existing test suite: every `petal-panic/js/test/*.test.js` (or
   `run-all.mjs` once present). Compare against `baseline.txt`: any NEW failure or
   regression → identify the responsible task via its commit, dispatch a fix executor,
   re-run gate. Max 2 gate-fix cycles, then stop and report.
   - From Wave 3 onward ALSO run the preservation regression
     (`knockbackRegression.test.js`) — it must stay green at every gate.
2. WAVE REVIEWER pass (both models, accumulated wave diff since last gate commit) using the
   cross-cutting rubric below. Verdicts appended to `reviews.md`.
3. Gate commit: `knockback: wave <n> gate` (plan/progress/reviews bookkeeping only).

## Cross-cutting quality rubric (identical text for BOTH reviewers)

You are reviewing a diff against the Petal Panic knockback system. The design doc
(`knockback.md`) is the single source of truth and wins over prior code.

Check ONLY these. Report each finding as: file:line — issue — doc § reference — severity
(blocker/major/minor).

1. **Doc conformance**: does the diff implement the cited `knockback.md` behavior exactly?
   Strength = fixed weight + head-on motion term (clamped ≥0); mass acts as a divisor;
   direction matches the declared dirMode; 2D impulse (vertical pop from strong hits);
   stun is a TTL that interrupts the victim's action while physics keep running. Any
   divergence from the doc is a blocker unless the task text explicitly overrides.
2. **Knockback lives on the attacker, not the call site**: knockback is data carried by the
   attacking object (attack hitbox / projectile / explosion / enemy body). No new
   `layer === X ? ... : ...` or per-attack-type branching at the point of impact. The
   single `applyKnockback(victim, attacker, knockback, normal)` is the only consumer.
3. **One mechanism, both directions**: hero and enemy victims use the SAME `applyKnockback`.
   No parallel knockback/stun code path for enemies vs heroes. Enemy hitstun interrupts
   `ai()` but still integrates physics.
4. **Behavior preservation (enemy→hero)**: the existing enemy→hero reactions (contact,
   projectile, heavyProj, explosion) must produce the SAME hero knockback + `rec` +
   `intangible` as before the refactor. Any silent change to those is a blocker.
5. **Scope discipline (v1)**: knockback applies to ENEMIES only, from sweep/cartwheel/supermove.
   Normal melee, Thorn, and special projectiles carry NO knockback in v1. Flag any knockback
   leaking onto out-of-scope attacks.
6. **No duplication**: no second copy of knockback math, knockback application, or stun-TTL
   bookkeeping. New logic routes through `applyKnockback` + the unified timers.
7. **No magic numbers at call sites**: knockback values live in heroDefs.js (per-attack) /
   enemy defs (bodyKnockback) / named constants — never inline in update.js handlers.
8. **No regressions**: existing tested behaviors (hero i-frames, double jump, weapon pools,
   one-hit-per-swing, death pipeline) must remain intact. Flag any change not part of the task.
9. **Test quality**: new tests assert the acceptance criteria as executable checks in the
   DIRECT-INTENT / pure-unit style (fixed dt = 1/60, exact expected values within
   epsilon), not tautologies, implementation details, or fragile full-pipeline harnesses.
   The preservation regression must compare against the captured reference values.

Verdict format: `PASS` or `FAIL` + numbered findings. No prose padding.

## Prompts

### EXECUTOR PROMPT (per task)

```
You are implementing ONE task from the Petal Panic knockback-system plan.

TASK {id}: {name}
Type: {type}
What: {what}
Why: {why}
Files: {files list with +/~ markers}

DESIGN DOC (single source of truth — wins over existing code):
{inline the relevant knockback.md sections, e.g. §2 strength, §4 direction, §10/§11 matrices}

ACCEPTANCE CRITERIA (all must hold):
{acceptance list}

VERIFY COMMANDS (must all exit 0 when you finish):
{verify list}

TESTING CONVENTION (binding):
{the 6-point convention from this orchestrator, verbatim}

RULES:
- Read the current code first; classify what already exists vs what is new. Reuse the
  existing central systems (damage(), Timers, hitbox slots, KNOCKBACK_PROFILES until 3.1
  migrates them) — do not create parallel paths.
- Knockback is DATA on the attacking object; applyKnockback is the ONLY consumer. No
  layer/type branching at the impact site.
- Implement the task AND write the named test file(s) asserting the acceptance criteria as
  executable checks (direct-intent / pure-unit style, fixed dt = 1/60).
- For task 3.4 specifically: capture/assert against the pre-refactor reference values in
  knockback-reference.txt; do not alter the existing hero→(enemy) or enemy→(hero) feel.
- Do not commit. Do not touch files outside the task's Files list except adding the named
  test files.
- Keep tuning values as named constants / data tables. No inline magic numbers.
- Edit-first/verify-after. ANTI-LOOP: max 2 identical diagnostic runs; if a probe repeats
  identically, read source instead of re-probing.
- If the doc and existing code disagree, the doc wins — but note the conflict in your final
  report.
- Final report: changed files, how each acceptance criterion is satisfied, conflicts found,
  anything you deliberately did NOT change and why.
```

### REVIEWER PROMPT A — line-level (ninfer/qwen3.8-27b)

```
{CROSS-CUTTING QUALITY RUBRIC}

CONTEXT: Task {id} "{name}" — acceptance criteria: {list}. Doc sections: {§refs}.
DIFF (uncommitted task diff — git diff + new test files):
{diff output}

Focus: items 2, 4, 5, 7, 9 (knockback-on-attacker, behavior preservation, v1 scope, magic
numbers, test quality) plus concrete bugs (wrong normal direction, missing clamp, sign
error in the motion term, stale flag, wrong timer label, missing facing mirror).
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

Focus: item 1 (exact doc conformance — quote the doc line the code must satisfy), item 3
(one mechanism both directions), item 4 (behavior preservation of enemy→hero), item 8
(regression risk to other mechanics). Judge intent, not style.
You judge the diff only — do not run tests, do not edit code.
On transient API overload, the runner retries you up to 2 times.
Verdict: PASS or FAIL + numbered findings (file:line — issue — §ref — severity).
```

### WAVE REVIEWER PROMPT (both models, at each gate)

```
{CROSS-CUTTING QUALITY RUBRIC}

CONTEXT: End-of-wave review for Wave {n} (tasks {ids}). Full wave diff below.
The mechanical test suite already passed against baseline (and the preservation
regression, from Wave 3 on) — you are checking what tests cannot see: cross-task
duplication introduced by the wave, drift from the doc's knockback rules (§2, §4, §8,
§10, §11), scope leakage beyond v1, and any weakening of the behavior-preservation
guarantee.
WAVE DIFF:
{accumulated diff since last gate}
Verdict: PASS or FAIL + numbered findings.
```

## Failure handling

- **Task blocked after 2 fix cycles** → stop wave, report: task id, failing verify command,
  stderr, reviewer verdicts. Wait for user.
- **Executor budget exhausted** → diagnosis-first re-dispatch (max 1), then BLOCKED per above.
- **Wave gate red vs baseline OR preservation regression red** → bisect the wave's task
  commits, fix the regressing task, re-run gate. Max 2 gate-fix cycles, then stop and report.
- **Reviewer unavailable** (provider error after retries) → proceed with the single
  available reviewer + mechanical tests, and flag the task as "single-reviewed" in
  reviews.md. Never skip the mechanical tests.
- **User interrupt questions** are limited to reviewer disagreements on judgment calls —
  one line each, batched at the next gate if non-blocking.

## Definition of done (epic)

1. All 11 tasks complete (M1: 3, M2: 3, M3: 4, M4: 1), each with: verify green, task
   commit, BOTH reviewer verdicts recorded in reviews.md.
2. `node petal-panic/js/test/run-all.mjs` green vs baseline.
3. Preservation regression (`knockbackRegression.test.js`) green — existing enemy→hero knockback
   provably unchanged.
4. Sweep/cartwheel/supermove visibly shove+stun+loft enemies; Thorn/melee do not (manual
   feel note recorded in 2.3).
5. Self-protection on connect works for sweep + cartwheel (clean connect = safe, whiff =
   exposed).
6. Every v1-scope bullet has a named passing test; hit-stop remains deferred (documented in
   hitstop-proposal.md, NOT implemented).
7. One commit per task (post-review) + gate commits; working tree clean at each gate; plan
   progress file updated.
