# Orchestrator — petal-panic-level-engine-v1

Execution contract for the `petal-panic-level-engine-v1` plan. The runner (plan-runner)
drives the loop; the executor (task-executor) does the work. This file is just the loop +
two short prompts. No human between tasks.

## Runner rules
- The runner NEVER writes or edits code. All code work goes through the executor agent.
  If the executor crashes or a fix is needed, re-dispatch the executor — do not patch inline.
- Do NOT wait for user authorization between tasks. Crush all tasks one after the other
  without pausing for confirmation. Only stop at wave gates or when a task cannot proceed.

## The loop (per task, strict order)

1. `progress.py mark-in-progress`
2. **Execute** — inline agent, `task-executor` skill, EXECUTOR PROMPT below.
   Budgets: max_steps 150, max_tools 200, max_time 15m.
3. **Review** — two independent reviewers, SAME prompt (intent + code quality), different
   models (two eyes on the same question). REVIEWER PROMPT below.
4. **Resolve:**
   - Both PASS → commit.
   - Either FAILS with a **major/blocker** finding → re-dispatch the SAME executor with the
     findings verbatim (EXECUTOR PROMPT, "fix these findings" mode). It fixes + re-runs until
     green, then re-review.
   - Only **minor** findings → note them in reviews.md and commit anyway (minors don't block).
   - Reviewers disagree on whether something is a problem → the test suite breaks the tie if
     it covers the case; otherwise one-line question to user.
   - **Max 2 review→fix→re-review rounds total.** After round 2, commit what's green and note
     any remaining findings.
5. **Record** — append verdicts + resolution to `reviews.md`.
6. **Commit** — `levels <task-id>: <task name>`.
7. `progress.py mark-done` **after** the summary is persisted (the executor stores it via
   the task-executor skill's `set-summary.py`). If the executor crashed and never ran it,
   the runner runs `set-summary.py` before `mark-done`. Never leave a done task without a
   summary in `.plan-progress.json`.

A task is NOT done until committed. No next task before the commit lands.

## EXECUTOR PROMPT

```
Your job: execute plan `{plan}`, task **{id} — {name}** using the task-executor skill.
Follow the skill's workflow (extract task, code, verify, store summary via set-summary.py,
display summary). Working directory: ~/src/html-game

CONTRACT (from .plan.json):
- what: {what}
- files: {files}
- acceptance: {acceptance}
- verify: {verify}

DOCS FOR THIS TASK (source of truth — they win over code):
{the specific docs/levels/*.md files + § sections this task settles}

PLAN-SPECIFIC RULES (on top of the skill's own rules):
- TESTS: meaningful logic tests only — assert the behavior the docs require and that the
  code complies with the docs. Do NOT write over-engineered tests checking mathematical
  precision of every duration, frame, or pixel. Determinism (same seed → same world) IS
  worth an exact test; presentation timing is not.
- Run the task's verify command AND the full suite `node --test petal-panic/js/test/*.test.js`
  (glob form) until green. Known baseline flakes (barrel.solid, Space-jump pause,
  effectTheater c2d.ellipse, input tabs) are ignored — compare failure sets, never chase them.
- Scope: this task changes only what its contract says. Hero/enemy/combat/effects/art/music
  are out of scope unless the task explicitly includes them.
- Do NOT commit (git read-only for you).

BEFORE YOU FINISH:
- Store your summary (per the task-executor skill).
- Return your final report (per the task-executor skill format).
```

## REVIEWER PROMPT (identical for both reviewers — only the model differs)

```
You are a reviewer for plan `{plan}`, task **{id} — {name}`. Working directory:
~/src/html-game. Do NOT modify files. Judge the diff only — do not run tests.

Steps:
1. bash: git diff
2. read_file {the docs/levels/*.md files this task settles}
3. read_file {the source files in the diff}
4. Verdict.

CHECK (both of these):
- INTENT: does the code do what the task contract says, and align with the docs?
- CODE QUALITY: is the architecture clean (one owner per rule, no duplication, no magic
  numbers)? Is the logic consistent with the task description?
- Any silent behavior change to out-of-scope systems? (blocker)

Output (strict):
Verdict: PASS or FAIL
Numbered findings: file:line — issue — doc § ref — severity (blocker/major/minor)
```

## Models

Two different models run the SAME review (two independent eyes on the same question).

| Role | Model |
|---|---|
| Executor | session default via `task-executor` skill |
| Reviewer 1 | `vllm/unsloth/Qwen3.8-27B-NVFP4` |
| Reviewer 2 | `openai-codex/gpt-5.6-sol` (or a second `vllm/unsloth/Qwen3.8-27B-NVFP4` if the cloud model is unavailable) |

## Wave gate (between waves)

1. Full suite `node --test petal-panic/js/test/*.test.js` (glob form) vs `baseline.txt`.
   Any NEW deterministic failure → fix before the gate commit. Known baseline flakes ignored.
2. Gate commit: `levels: wave <n> gate`. Clean tree required.

## Source of truth & precedence

1. `petal-panic/docs/levels/*.md` — the design contract. Wins over code.
2. `petal-panic/docs/story/levels.md` — Level 1 content.
3. `petal-panic-level-engine-v1.md` — task scope/acceptance/verify.
4. This orchestrator — execution policy only.
5. Existing prototype code — preserved unless a task explicitly changes it.

## Scope exclusions (every executor)

Level system ONLY. Do not touch: hero mechanics, enemy AI, combat, effects (reuse only),
art/sprites (placeholder rectangles), music. Level 1 content only.

## Wave structure

```
Wave 1: M1 Game Rules Core        (1.1 → 1.2 → 1.3)      Gate 1
Wave 2: M2 Zone & Transition      (2.1 → 2.2 → 2.3)      Gate 2
Wave 3: M3 Terrain Generation     (3.1 → 3.2 → 3.3)      Gate 3
Wave 4: M4 Population             (4.1 → 4.2)            Gate 4
Wave 5: M5 Vertical Areas         (5.1 → 5.2)            Gate 5
Wave 6: M6 Boss Zone              (6.1 → 6.2)            Gate 6
Wave 7: M7 Integration + Polish   (7.1 → 7.2 → 7.3 → 7.4 → 7.5)  Gate 7 → EPIC DONE
```
