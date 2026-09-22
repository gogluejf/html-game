# Orchestrator — petal-panic-level-engine-v1

Execution contract for the `petal-panic-level-engine-v1` plan. No human between tasks.
Modeled on the effect-engine orchestrator, adapted to the level engine's specifics.

## How we run

- **plan-runner** drives the loop: init progress → next-task → mark-in-progress → delegate → verify → review → commit → mark-done → next.
- **task-executor** executes each task: receives the plan path + task id, reads its own context from the plan file, writes code + tests, reports back.
- The runner NEVER codes. It dispatches, verifies mechanically, reviews, commits, tracks progress.

## Per-task loop (strict order)

1. `progress.py mark-in-progress`
2. **Execute** — inline agent with `task-executor` skill, passed the plan path + task id. Budgets: max_steps 150, max_tools 200, max_time 15m.
   Every executor prompt MUST inline the relevant `docs/levels/*.md` sections referenced by the task. Do not make agents hunt for context.
3. **Verify** — run every `Verify:` command from the task + the full existing suite (`node --test petal-panic/js/test/*.test.js`).
4. **Fix cycle** — if red: fresh task-executor with diagnosis-first prompt. Max 2 retries. Still red → BLOCKED, stop wave, surface to user.
5. **Review A** (qwen3.8-27b, line-level) on uncommitted diff.
6. **Review B** (gpt-5.6-sol, intent/doc-conformance) on same diff.
7. **Resolve** — ACCEPT (executor fixes, re-verify) or REJECT (note why). Disagreement → mechanical tests break tie; else one-line question to user. Max 2 rounds.
8. **Record** — append both verdicts + resolution to `reviews.md`.
9. **Commit** — `levels <task-id>: <task name>`. Only after steps 3–8 complete.
10. `progress.py mark-done`.

**A task is NOT done until committed. No next task before the commit lands.**

## Wave gate (between waves)

1. Full test suite vs `baseline.txt`. Any NEW failure → fix executor, re-run. Max 2 cycles.
   - From Wave 3+: also assert determinism — generate Level 1 twice with the same seed, diff the world layouts (must be identical).
   - From Wave 5+: also run the vertical-zone tests explicitly.
   - From Wave 6+: also run the boss-zone sequence tests explicitly.
2. **Wave review** — both reviewers on accumulated wave diff since last gate.
3. Gate commit: `levels: wave <n> gate`. Clean tree required at every gate.

## Models

| Role | Model | Notes |
|---|---|---|
| Executor | session default via `task-executor` skill | writes code + tests |
| Reviewer A | `ninfer/qwen3.8-27b` | local, line-level; max_steps 75, max_time 15m |
| Reviewer B | `openai-codex/gpt-5.6-sol` | cloud, intent/doc-conformance; max_steps 75, max_time 15m; retry 1–2× if overloaded |
| Tests | deterministic shell | never an LLM |

## Source of truth & precedence

1. `petal-panic/docs/levels/*.md` (the 8-file design contract) — wins over code.
   In particular: `game-rules.md`, `lifecycle.md`, `structure.md`, `generation.md`,
   `populate.md`, `checkpoints.md`, `boss-arena.md`.
2. `petal-panic/docs/story/levels.md` — Level 1 roster/boss/theme content.
3. `petal-panic-level-engine-v1.md` — task scope, acceptance, verify commands.
4. This orchestrator — execution policy, budgets, gates.
5. Existing prototype code — preserved unless a task explicitly changes it.
   Critically: hero movement/shooting/enemy AI/projectile/collision systems must keep
   working unchanged against the new world refs; the engine replaces WORLD CONSTRUCTION,
   not entity behavior.

## Baseline (once at reset, before task 1.1)

- Full suite → `baseline.txt` (known pre-existing failures recorded: `c2d.ellipse` mock gap in
  effectTheater.test.js, tabs focusable row in input.test.js — these are fixed by task 7.3,
  so they may disappear but no OTHER test may newly fail).
- Measure and record the prototype length baseline (current area segment lengths in px) →
  `length-baseline.txt`. Task 3.3 asserts ~2× against this number.

## Scope exclusions (hard rules for every executor)

This epic builds the LEVEL SYSTEM ONLY. Out of scope — do not touch, redesign, or
"improve" any of these in any task:

- **Hero mechanics** (movement, jumps, slide, weapons, supermove) — unchanged.
- **Enemy AI and behavior** — population only PLACES existing enemies; their logic is untouched.
- **Combat systems** (damage, knockback, hitboxes, projectiles, barrel explosions) — unchanged.
- **Effects** (js/effects/) — reuse existing ones as-is; no new or edited effect files.
- **Art/sprites** — geometry stays drawn rectangles; placeholder visuals only; no image loading.
- **Level 1 content only** — engine is config-driven/N-level, but only The Circus ships.
- **Music/sound** — deferred; silence is fine.

If a task seems to require touching any of the above, it is scoped wrong — stop and
surface to the user instead of working around it.

## Wave structure

```
Wave 1: M1 Game Rules Core        (1.1 → 1.2 → 1.3)      Gate 1
Wave 2: M2 Zone & Transition      (2.1 → 2.2 → 2.3)      Gate 2
Wave 3: M3 Terrain Generation     (3.1 → 3.2 → 3.3)      Gate 3 (+ determinism check)
Wave 4: M4 Population             (4.1 → 4.2)            Gate 4 (+ determinism check)
Wave 5: M5 Vertical Areas         (5.1 → 5.2)            Gate 5 (+ vertical tests)
Wave 6: M6 Boss Zone              (6.1 → 6.2)            Gate 6 (+ boss sequence tests)
Wave 7: M7 Integration + Polish   (7.1 → 7.2 → 7.3)      Gate 7 → EPIC DONE
```

Tasks within a milestone run in listed order. M1 (lifecycle ops) completes before any zone
work; M2 (zones) before M3 (terrain); M3 before M4 (population needs placement slots);
M5/M6 build on M2–M4; M7 integrates everything.

## Quality rubric (both reviewers)

Report findings as: file:line — issue — doc § ref — severity (blocker/major/minor).

1. **Doc conformance**: implements the `docs/levels/*.md` contract exactly. Sealed zones,
   entry/exit flag rules, continue semantics, intro sequence order — per the docs, not per
   the prototype's habits.
2. **One owner per rule**: lifecycle ops own start/reset semantics; gameRules owns global
   numbers; terrain/macros own geometry; populate owns budgets. No module outside its owner
   assigns lives/continues or scatters spawnables.
3. **Determinism**: all randomness flows from the per-game seeded RNG. Same seed → identical
   worlds. Death/continue rebuild the SAME arrangement, never reroll.
4. **Config-driven, N-level**: nothing hardcodes "4 levels" or Level 1 specifics outside
   `levelConfigs.js`. Adding a level = one config entry.
5. **Behavior preservation**: hero, enemies, projectiles, collision, knockback behave
   identically as before; only world construction changed. Silent behavior change = blocker.
6. **No magic numbers at call sites**: tuning values live in `GAME_RULES` / `levelConfigs.js`
   with a comment citing the doc section they settle.
7. **No duplication**: one transition path, one camera-clamp source, one reward-crediting
   site (credited exactly once regardless of redraws).
8. **Placeholder-only visuals**: any new screen/zone uses drawn rectangles or existing
   effects; no image loading introduced.
9. **Test quality**: pure-unit where possible (level.js-style, no DOM), fixed dt = 1/60,
   exact values within epsilon; integration tests simulate full flows headlessly.

Verdict: `PASS` or `FAIL` + numbered findings. No prose padding.

## Failure handling

- Task blocked after 2 fix cycles → stop wave, report to user. Wait.
- Executor budget exhausted → diagnosis-first re-dispatch (max 1), then BLOCKED.
- Wave gate red → bisect, fix, re-run. Max 2 cycles, then stop.
- Reviewer A unavailable → proceed with B only, flag "A-unavailable" in reviews.md.
- Reviewer B unavailable → retry 1–2×, then proceed with A only, flag "B-unavailable".
- User interrupts limited to reviewer disagreement — one line, batched at next gate if non-blocking.

## Definition of done (epic)

1. All 14 tasks: verify green, both reviews recorded, committed.
2. Full suite green vs baseline (the 2 known pre-existing failures fixed by 7.3, none new).
3. Determinism proven: same seed twice → identical Level 1 world layouts.
4. Full Level 1 run completable headlessly: entry screen → 4 areas (one vertical) with clear
   banners → boss approach/intro/fight → reward screen crediting continues → next-level entry.
5. Death mid-area restarts the same area with identical arrangement; continue from any area
   lands in area -1 of the current level with restored starting lives.
6. Continue pool is a growable balance (starts 3, credited by reward screen at 1 per 1000
   coins, never coin-spent).
7. Vertical zone: up-only camera, fall-off-bottom death, bottom-platform restart.
8. Every "design-plan decision" marker in the docs has a concrete cited value in
   `GAME_RULES` / `levelConfigs.js`.
9. One commit per task + gate commits; clean tree at each gate; progress file updated.
