# Macro Editor Ghost Ride — Debugging & Testing Guide

How the sim-based takeoff picker works, how the goal route is built, and — most
importantly — **how to test it so you don't waste hours chasing ghosts.**

Read this before touching `js/world/takeoffPicker.js` or `macro-editor/js/ghost.js`.

---

## 1. The three layers (don't confuse them)

| Layer | File | Decides | Already correct? |
|-------|------|---------|------------------|
| **Route** | `js/world/macros.js` → `traversalRoute` | The *sequence* of goals (DFS over connected clusters), incl. stepping stones | ✅ Yes. If a hop "shouldn't exist", suspect the route first — but usually it's right. |
| **Pick** | `js/world/takeoffPicker.js` → `pickTakeoff` | For ONE hop: which tool (single / double / +super) + launch point lands ON the current goal | ⚠️ This is where bugs live. |
| **Ride** | `macro-editor/js/ghost.js` → `rideInput`/`stepOnce` | Drives the hero frame-by-frame, calls pick when grounded, replays the winning script | ⚠️ State hand-off between hops lives here. |

If a macro stalls at hop N→M: **first confirm the route actually wants N→M**
(`console.log(order)` in a headless run). Then debug the pick for that pair.

---

## 2. The picker concept (plan 06)

The old code was a **rule ladder**: guess single → if that fails try double →
etc. A wrong guess leaves the hero airborne with no recovery = silent stall.

The new code **simulates instead of guessing**:

1. Build a candidate set for the current grounded state:
   `WALK_OFF`, `SINGLE@k`, `SINGLE_S@k`, `DOUBLE@k`, `DOUBLE_S@k`, `SUPER_ONLY`
   (k ∈ {0,4,8} = walk k frames before arming the jump).
2. For each candidate, clone the hero and run the real physics
   (`stepHeadless` + full `world.solids`) up to ~240 frames.
3. **Score** each: `0` = feet landed on THE goal surface. Otherwise distance
   from the goal span where the hero comes to rest. Landing on any *other*
   surface or the floor = a miss (even if x is close). Wall-pin / fell-out =
   hard miss (Infinity).
4. Lowest score wins; ties broken by preference (cheapest tool first:
   walk < single < double < single+S < double+S < super-only).
5. A closed-form height envelope (`minHeroSuperAssistReachPx`) is a **pre-filter
   only** — it can reject physically impossible rises fast, but never makes the
   final tool call.

**Key invariant:** the sim must start from the *same resting state* the real
hero will be in when it executes the pick. If they diverge, the sim's "score 0"
is a lie (see §4 trap #1).

---

## 3. The goal graph

- `buildRideWorld` converts macro units → pixel AABBs (`world.solids`) and one
  landing record per unit (`world.landings`: `{index, x0, x1, y, kind}`).
- `traversalRoute({orientation, units})` returns `{order, unreachable}`.
  `order` = unit indices in DFS visit order from the entry; `unreachable` =
  surfaces flagged amber-X (excluded from the route, NOT appended as goals).
- `ghost.js buildGoalList` maps `order` onto landing objects. The ride pursues
  `goals[goalIdx]`, advances on landing, respawns on fall-past.

Print the route anytime to sanity-check a stall:
```js
const { order } = traversalRoute({ orientation: st.orientation, units: tagged });
console.log(order.join('→'));
```

---

## 4. 🚨 TEST DISCIPLINE — read this twice

### Rule 1: Test the REAL ride, never just isolation.

An isolated "spawn hero at X, run the pick" test proves the *picker* works for
that state. It does **not** prove the *ride* works, because the ride carries
state across hops. Every bug we shipped came from trusting an isolated pass.

**The acceptance test is a full headless ride that lands ALL goals.** Use
`/tmp/standon_check.mjs` (or keep an equivalent in `js/test/`). It replays the
exact `ghost.js` logic (settle → pick → replay script → advance) end-to-end and
prints `LANDED on #N` per hop + a final `[landed] of [route]` line. **A fix is
done only when that line shows every goal index.**

Isolated tests are still useful — for narrowing *which* hop/state breaks — but
they are necessary, not sufficient.

### Rule 2: Reproduce the user's exact scenario.

"Fresh macro clears, replay stalls" ≠ "fresh always works". Run the ride
twice in a row in the same process if the report mentions replays. Match the
macro id the user named. Don't invent a simpler case and assume it transfers.

### Rule 3: Get trace evidence before claiming a fix.

A claim like "the sim says it works" without a passing full-ride run is not a
claim. Before saying anything works: show the `LANDED` lines for all goals, or
a Chrome trace dump (`~/Downloads/petal-panic-macrotrace-*.json`). No evidence
→ say "not verified yet".

### Rule 4: Don't commit untested work.

Never `git commit` to "save progress" on a fix you haven't seen pass the full
ride (and ideally Chrome). Commit only after Rule 1 + Rule 3 are satisfied.
(Workflow rule: wait for explicit "commit"/"push" anyway.)

---

## 5. The traps we actually hit (so you don't repeat them)

Each of these looked like a picker bug but wasn't — or was in a subtle spot.

1. **Sim/real state divergence (the big one).** The pick clones the hero, but
   the clone only copies `vx, vy, jumpsUsed, supermoveMeter`. The real hero
   also carries `_jumpBuffer`, `_prevJumpHeld`, `_coyote`, `crouching`,
   `supermoveActive`, `_dropTimer`. If those differ from the clone's fresh
   state, the arc diverges and the sim's score-0 lies.
   → **Fix:** `ghost.js` settle block zeroes vx/vy, sets `grounded=true`, and
   clears ALL of the above before every pick. Keep it exhaustive.

2. **Drained super meter rejecting valid candidates.** The ghost ride should
   have infinite supers (it tests geometry, not pacing). But the settle wasn't
   refilling `supermoveMeter`, so after a few SINGLE_S/DOUBLE_S hops the meter
   hit ~10/100 and the sim's DOUBLE_S candidate couldn't dash → it scored a
   miss → the picker fell back to a failing SINGLE.
   → **Fix:** refill `h2.supermoveMeter = h2.SUPERMOVE_MAX` in the settle.

3. **Landing momentum (vx) shifting the takeoff point.** Settle originally only
   ran when `vy != 0 || feet above surface`. A clean landing (vy=0, feet on
   surface) skipped it, so `vx=180` from the previous hop carried into the sim.
   → **Fix:** settle runs whenever the hero is on a known surface, and always
   zeroes `vx`.

4. **Script calling-convention mismatch.** Candidates are called as
   `script(i, hero)` (frame first). `makeJumpScript`/`makeSuperOnly` return
   `(i, h)` closures — correct. But `scriptWalkOff` was passed *directly* with
   signature `(h, goal)` → `feetPos(0)` → `0.worldBox is not a function` crash
   on any drop-hop pick.
   → **Fix:** wrap in `makeWalkOff(goal)` returning `(i, h)`. **Rule: every
   candidate script MUST be an `(i, h)` closure.**

5. **Engine jump timing (off-by-one).** A single-frame `jump=true` on the
   grounded frame gets buffered, then dropped when the next frame releases it
   before the engine fires → the re-press becomes a DJ one frame late.
   → **Fix:** hold `jump=true` for 2 frames after arming (`st._holdFrames`).

6. **`droppingThrough` is a getter.** You cannot do `hero.droppingThrough =
   false` (throws "only a getter"). Clear the underlying `hero._dropTimer = 0`.

7. **Walking off the edge instead of jumping at coyote.** If the script stops
   steering at goal-center (old hysteresis) the hero walks off a long platform
   into the void before the jump arms.
   → **Fix:** keep pressing the travel direction through the whole arc; arm the
   jump at the platform edge / coyote.

---

## 6. How to run the tests

There IS a unit-test suite (`js/test/*.test.js`, `node:test`). Run one file or all:

```bash
cd ~/src/html-game/petal-panic
node --test js/test/pickerRide.test.js     # the picker acceptance + BFS agreement
node js/test/run-all.mjs                    # every *.test.js in js/test/
```

### ⚠️ Which code path do the "clears" tests actually exercise?

- `ghostRider.test.js` → `runGhostRide`/`rideOnce` = the **OLD rule-driven brain**
  (`seekLanding`/`nextAhead`/`doubleJumpApexPx`). It does **NOT** use the picker.
- `pickerRide.test.js` → `runPickerRide` (in `js/world/pickerRide.js`) = the
  **plan-06 picker**, the Node twin of `ghost.js rideInput`. **This is the one
  that proves the picker works.** If you add a "the picker clears macro X"
  assertion, use `runPickerRide`, not `runGhostRide`.

`js/world/pickerRide.js` is the single source of truth for the settle→pick→replay
loop shared by the browser (`ghost.js`) and the tests. Keep them in sync — if you
change the settle in `ghost.js`, change it here too (or better, have ghost.js
import `settleHero` from pickerRide.js).

### The BFS ↔ picker agreement invariant

The sim picker is ground truth for "can the hero reach this surface". It must
AGREE with the BFS reachability proof (`traversalRoute` / `bfsReachableSpans`):

- **BLUE** (BFS-reachable) ⇒ the picker finds a score-0 takeoff for that hop.
  If a blue hop scores >0 / no-candidate, the envelope over-promised → silent
  stall. (Currently failing: lowRepeated #7→#8, newMacro #3.)
- **AMBER** (BFS-unreachable) ⇒ excluded from the route; never asked of the
  picker. If an amber surface appears in the goal list, the route is wrong.

`pickerRide.test.js` encodes both. A red result there is a real bug, not noise.

### Ad-hoc probes (for narrowing a specific N→M failure)

Keep canonical versions under `js/test/`; scratch ones can live in `/tmp`.
A good isolated probe: build the ride world, spawn a settled hero (vx=vy=0,
grounded=true, full super meter) on the source surface, call
`pickTakeoff(hero, goal, world, params, {}, sourceLanding)`, print best + full
scorecard. Remember: isolated pass ≠ ride pass (see §4 Rule 1).

**Chrome ground truth:** hard-reload (Ctrl+Shift+R), start a ride, hold Ctrl to
record a trace, release to dump `petal-panic-macrotrace-*.json` to Downloads.
Read it with:
```python
import json
d = json.load(open('~/Downloads/petal-panic-macrotrace-XXXX.json'))
print(d['result'], d['picker'])        # outcome + last pick/scorecard
for f in d['frames'][::30]:            # sample frames
    print(f['f'], round(f['x']), round(f['y']), 'g' if f['grounded'] else '', 'J' if f['in']['jump'] else '')
```

---

## 7. Debugging checklist (when a hop N→M stalls)

1. Print the route. Does it really want N→M next? (If not → route bug, stop.)
2. Run the full headless ride. Note the exact `PICK ... from N → TOOL (score)`
   line and the hero's feet position at that moment.
3. Reproduce that EXACT state in isolation (same feet x/y, same standingOn,
   full super meter, zeroed velocity). Compare its scorecard to the ride's.
   - Same state, different result → hunt shared mutable state (world mutation,
     module-level cache, stale `candsRef`).
   - Different state → the settle isn't matching; diff vx/vy/meter/jump-state.
4. If the pick is right but the replay misses → the replay script and the sim
   script disagree (check `executePick` vs `simulateCandidate`, and that the
   replayed candidate is the one that actually scored 0).
5. Only then touch the picker. Re-run the FULL ride. Confirm all goals land.
6. Ask the user to hard-reload Chrome. Get a trace if it still fails there.
