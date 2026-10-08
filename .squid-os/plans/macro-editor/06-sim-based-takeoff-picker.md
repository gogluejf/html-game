# 06 — Sim-Based Takeoff Picker

Replace the rule ladder (single → double → double+super) with a closed-loop
search: simulate candidate actions against the REAL physics, pick the one
whose feet land on the goal. The ladder becomes a pre-filter only.

## Why

Every mover fix so far was fitted to one failing macro, then broke another
(super timing, gap gates, BFS→DFS...). The ladder GUESSES the tool before
jumping; when the guess is wrong the hero is airborne with no recovery →
silent stalls (#6→#0 lowRepeated_2, #7→#8 lowRepeated). A simulator turns
"why didn't it work?" into a scorecard: every option's landing point is known
in advance.

Division of labor (unchanged):
- **traversalRoute** (macros.js) — decides the SEQUENCE of goals, including
  intermediate stepping stones. Already correct (DFS over connected clusters).
- **This module** — decides the ACTION for each hop: which input sequence,
  launched from where, that lands ON the current goal.
- Blocks / movers / enemies later = more solids in `world.solids`. No
  architecture change.

## Principles

1. **Sim is ground truth.** `stepHeadless` + full `world.solids` (blocks,
   one-way platforms, floor) — same pipeline as the ghost ride and the tests.
   Collisions, wall blocks, phase-throughs all come for free.
2. **Score, don't guess.** Each candidate gets a numeric score. Best wins.
   Ties broken by preference order (cheapest tool first: walk < single <
   single+S < double < double+S).
3. **Failures are visible.** On a failed/stalled hop, dump the scorecard
   (every option + its landing offset) to the trace/console. Debugging =
   reading numbers, not frame archaeology.
4. **Closed-form stays as pre-filter only.** Height envelope
   (`minHeroSuperAssistReachPx`) still rules out physically impossible rises
   fast. It never makes the final tool call.
5. **Landing must be on THE goal.** Feet ending on any other landing surface
   (or the floor) scores as a miss, even if x is close. This kills the
   "dashed through the platform top" class of bugs automatically.

## Candidate set (grounded takeoff)

Generated per decision frame while grounded & pursuing a goal:

| id | action | notes |
|----|--------|-------|
| WALK_OFF | stop jumping, walk toward goal edge until airborne | for drop hops (goal below) |
| SINGLE | jump at frame k | k ∈ {0, ±5, ±10} launch offsets |
| SINGLE_S | jump at k, super at j1 apex | flat dash at max single height |
| DOUBLE | jump at k, DJ at standard release | current behavior |
| DOUBLE_S | jump at k, DJ, super at j2 apex | current behavior |
| SUPER_ONLY | super while walking (if meter allows) | for level/low gaps |

Launch offset k: walk `k` frames before pressing jump (covers "take off
earlier/later than the edge"). Keep k small (≤3 options) — total candidates
≈ 15–20, each ≤ 90 sim frames ≈ ~1500 physics steps. Trivial cost at 60fps
for the ghost; cacheable per (surface, goal) pair for enemies later.

In-air escalation (already mid-jump, arc provably short) reuses the SAME
scorer with the reduced candidate set {continue, DJ now, super now}.

## Scoring

For each candidate simulation:
- `landedOnGoal`: feet inside goal span (±tol) AND on goal y (±tol) AND
  grounded → score = 0 (perfect).
- else score = distance from ideal landing point:
  - horizontal offset from goal span center (px), weighted ×1
  - wrong-surface penalty: +∞ if landed on a different landing/floor
    (hard miss)
  - wall-pin penalty: +∞ if final state is blockedX against a solid face
- Early exit: stop simulating a candidate once it's already > 2× the best
  score found (prune).

Preference tiebreak on equal score: cheaper tool first (table above).

## Integration

- `js/world/takeoffPicker.js` (new): pure logic, Node-testable, zero DOM.
  Exports `pickTakeoff(hero, goal, world, params) → {inputs-per-frame plan,
  scorecard}`.
- `platformMover.js` grounded branch calls the picker INSTEAD of the ladder
  when `plan.plan !== 'retreat'`. Airborne branch keeps current DJ/super
  sequencing but arms via the scorer's verdict.
- `ghost.js` failure path: attach `scorecard` to the trace dump + console.
  Hint line gains `best: single+S @+30px` style readout.
- Config flag `mover.useSimPicker` (default true) so we can A/B against the
  old ladder during validation.

## Phases

### Phase 1 — picker core + unit tests
- [ ] `takeoffPicker.js`: candidate generator, simulator loop (reuses
      `stepHeadless`), scorer, prune.
- [ ] Unit tests (`js/test/takeoffPicker.test.js`): synthetic worlds —
      wide-low gap (needs SINGLE_S), tall-tight climb (needs DOUBLE),
      drop hop (WALK_OFF), wall-in-the-way (all options pinned → hard miss),
      overshoot trap (DOUBLE lands past span, SINGLE_S lands on it).
- Exit: all green, no platformMover changes yet.

### Phase 2 — wire into mover + ghost
- [ ] Grounded branch delegates to picker (behind `useSimPicker`).
- [ ] Scorecard on failure: trace dump + hint readout.
- [ ] Re-run `/tmp/caseTable5.mjs` matrix on lowRepeated + lowRepeated_2:
      record which cells flip ❌→✅ and which regress.
- Exit: #6→#0 and #7→#8 pass; no regression on the 13/17 passing macros.

### Phase 3 — full suite + cleanup
- [ ] Run all 17 macros headless (extend test harness to use the matrix
      script as a permanent test: `js/test/macroMatrix.test.js`).
- [ ] If stable: delete the dead ladder branches the picker supersedes
      (keep retreat pre-filter + drop-through).
- [ ] Update 05-pass4-smart-mover.md with the new decision flow.

## Known risks

- **Cost on dense macros:** 20 candidates × 90 frames × N decisions/frame.
  Mitigate: only run the picker when grounded AND within UX*2 of the goal's
  approach edge; otherwise plain walk. Cache per (fromSurface, goal).
- **Sim vs runtime drift:** picker uses the same `stepHeadless` as the ride,
  so drift should be nil. Verify in Phase 2 by comparing picked-action
  predicted landing vs actual (log delta).
- **Super meter:** ghost has infinite meter; real heroes don't. Picker takes
  `params.canSuper` as today — meter-aware filtering is a later enemy-AI
  concern, not this pass.
