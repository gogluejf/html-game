# Handoff — Macro Editor Test Ride Breaks After Dynamic Sprite-Size / Speed / Jump Change

**Status:** box-sync fix DONE & verified (uncommitted). First-hop stall bug OPEN.
**Date:** 2026-11-12
**Repo:** `~/src/html-game` · project `petal-panic/`
**Acceptance test:** `node tools/ride-report.mjs` (same brain as browser TEST mode)

## 0. TL;DR for a fresh agent (read this first)

One paragraph: the user changed THREE things at once — the hero's collision box
is now **dynamic per animation** (sheet-authored boxes: idle 59px / run 73px /
jump 84px wide, was a fixed 91×91 square), AND **run speed**, AND **jump height**
were retuned (`js/hero/heroDefs.js` stats + `js/consts.js`). The macro editor's
TEST-mode puzzle solver runs a HEADLESS copy of the hero that never loaded the
sheets, so it kept simulating jumps with the old fat square body → its "will I
land?" answers no longer match the real game → rides stall/fall out. **Fixed
this session (uncommitted):** the headless path now attaches the same sheets and
calls the same per-frame anim binding as the game (`headless.js`:
`attachHeroSprites` + `setAnim('idle')` at creation, `updateHeroLocomotionAnim`
inside `stepHeadless`; entry points prime the async sheet cache via new
`ensureHeadlessSprites()`). Verified: `climbingDense` flipped to PASS, two
macros progressed further. **Still open:** 6 of 11 failing macros die on the
FIRST hop (#0→#1). IMPORTANT attribution: the pick is made from a settled
grounded state where old and new boxes are identical, so the BOX fix is NOT the
first-hop cause. Speed/jump DO flow into the picker automatically (RIDE_PARAMS
+ envelope math read live `HEROES[*].stats`), so the suspects are: (a) the
closed-form arc MODEL in `js/world/macros.js` assuming the old body/airtime
(tucked mid-air body changes airtime & contact point even though stats are
live), (b) BFS `MAX_CLEARABLE_GAP` over-promising reach under the new numbers,
(c) clone anim-state divergence in `takeoffPicker.makeClone` (fell-out class).
Next move: ONE scorecard probe on `stretchedPyramid` #0→#1 (§3), max 3 debug
iterations, then report. Do NOT commit anything without explicit user
instruction. Do NOT re-run whole suites in a loop while narrowing — one probe
per hypothesis.

---

---

## 1. Origin — what the user changed and when it broke

The user recently retuned the hero in ONE change: **collision-box size became
dynamic per animation** (sheet-authored collision boxes; "the art IS the box"),
AND **run speed**, AND **jump height** were changed (`heroDefs.js` stats,
`consts.js`). Before this the headless ride shared everything with the game, so
the macro editor's TEST-mode puzzle solver worked. After it, the engine started
**stalling/failing in TEST mode**.

Two distinct breakage channels came out of that one change:

**Channel A — the box (FIXED this session).** The dynamic box lives in the
sprite layer, which the headless ride never used to touch:

| Layer | File | Shared by test ride? |
|-------|------|----------------------|
| Physics (gravity, jump impulse, run speed, dash) | `js/hero/hero.js` `update()`, `js/core/collision.js` | ✅ always was |
| Stat numbers | `js/hero/heroDefs.js` (unit-native → px at construction) | ✅ always was |
| **Sheet load + sheet-owned width** | `attachHeroSprites()` in `js/hero/heroSprites.js`, called only by `js/systems/lifecycle.js` / `js/systems/update.js` | ❌ **was skipped** |
| **Per-frame anim switch → box resize (idle/run/jump tuck)** | `updateHeroLocomotionAnim()` in `js/hero/heroSprites.js`, called only by `js/systems/update.js:1096` | ❌ **was skipped** |

Result: the real game hero's box changes shape per anim, but the headless ride
hero kept a **static square fallback box**:

```
no-sprite worldBox:  { w: 91.2, h: 91.2 }   ← what the picker simulated
with sprites idle:   { w: 59.4, h: 91.2 }
with sprites run:    { w: 73.0, h: 91.2 }
with sprites jump:   { w: 84.7, h: 91.2 }
```

The takeoff picker (`js/world/takeoffPicker.js`) simulates every candidate jump
in a private clone via `stepHeadless` and scores "did feet land on the goal?".
Simulating with a ~30–54% wider body than the real hero makes ledge catches,
wall pins, and near-miss landings resolve differently → sim says "lands ✅",
replay falls out ❌ (or rejects jumps the real hero could make). That is the
sim/replay divergence class documented in `macro-editor/DEBUGGING.md` §5 trap #1.

**Channel B — speed & jump height (STILL OPEN, likely the first-hop cause).**
These flow into the ride AUTOMATICALLY — `RIDE_PARAMS` (`pickerRide.js:25`) and
the envelope math (`macros.js:173,219,314`) all read live `HEROES[*].stats`, so
no copy went stale. The breakage is subtler: the closed-form arc MODEL assumes
the OLD body behavior. Concretely:
- `doubleJumpReachForStats` / `superAssistReachForStats` compute airtime from
  impulse + gravity for a CONSTANT full-height body. With the new per-anim box,
  the airborne body is TUCKED (jump anim, half height) → different contact
  point, different effective airtime over ledges, different wall-pin behavior.
  The model's predicted landing x no longer matches the simulated one.
- `MAX_CLEARABLE_GAP = floor(minHeroSuperAssistReachPx(0)/UX)` feeds BFS
  reachability. If the new speed/jump numbers changed true reach but the model
  over-promises, BFS marks surfaces blue (reachable) that the deterministic
  edge-takeoff physically cannot make → picker honestly returns null → stall.
- Supermove constants (`SUPERMOVE_SPEED=920`, `SUPERMOVE_DUR=0.6` in consts.js)
  are hardcoded px values — if the user's retune implied different dash
  distance at the new run speed, the super-assist term is off too.

## 2. Work done this session (UNCOMMITTED — 7 files, +56 lines)

Goal: make the headless ride wear the SAME dynamic per-anim box as the game.
No physics was duplicated or changed — only the two missing wiring calls were
added to the shared headless path, so browser TEST ride and node tests both get
it (there is ONE brain / ONE stepper).

### 2.1 `js/hero/headless.js` (the core fix)
- New export `ensureHeadlessSprites(heroKey = 'balthazar')` — async prime of the
  sheet cache (`loadHeroSprites`). Node tests/tools await it once before
  creating heroes; in the browser the game loop has already loaded sheets so it
  is a cache-hit no-op.
- `createHeadlessHero()` now calls `attachHeroSprites(hero, HERO_SPRITE_DIRS[heroKey])`
  (try/catch, keeps default box if unprimed) AND `hero.setAnim('idle')` so the
  box starts sheet-owned instead of the square fallback.
- `stepHeadless()` now calls `updateHeroLocomotionAnim(hero, input, dt)` right
  after `hero.update(dt, input)` — the exact same call `systems/update.js` makes
  after physics. This one call does all anim switching (idle/run/jump/crouch)
  AND the box resize + jump-tuck, so the sim hero tracks the real hero frame
  for frame.

### 2.2 Entry-point priming (one line each + comment)
Await `ensureHeadlessSprites('balthazar')` at top level before any ride:
- `tools/ride-report.mjs`
- `js/test/pickerRide.test.js` (THE acceptance test)
- `js/test/ghostRider.test.js`
- `js/test/platformMover.test.js`
- `js/test/takeoffPicker.test.js`
- `js/test/pixelSpeedRideGrid.test.js`

### 2.3 Verified results
Before fix: `8 pass / 11 fail`. After fix: still `8 pass / 11 fail` BUT the
composition changed — proof the sim now matches reality better:

- `climbingDense`: ❌ fell-out@#1 → ✅ **PASS**
- `blockBridge`: died @#2 → now dies later @#3 (progress)
- `newMacro_3`: stalled @#0 → now stalls @#2 (progress)
- `takeoffPicker.test.js` 8/8, `platformMover`/`pixelSpeedRideGrid` unaffected.

Note: `js/test/ghostRider.test.js` rider-clears failures are EXPECTED there —
that file drives the OLD legacy rule-driven rider (`runGhostRide`), not the
picker brain. Don't chase those (see DEBUGGING.md §6 "which code path").

## 3. The remaining bug — first-hop stalls (OPEN)

Live status after the box fix (`node tools/ride-report.mjs --fail`):

```
blockPlatformBridge  stalled@#1   ← first hop
mixedCrossing        stalled@#1   ← first hop
newMacro             stalled@#1   ← first hop
pyramid3             stalled@#1   ← first hop
stretchedPyramid     stalled@#1   ← first hop
newMacro_2           fell-out@#1  ← first hop (jumped, missed)
blockBridge          fell-out@#3
gapLanding           stalled@#2
lowRepeated          stalled@#4
lowRepeated_2        stalled@#8
newMacro_3           stalled@#2
```

**6 of 11 die on the very first hop (#0→#1)** → one shared cause, not six bugs.

Semantics: `stalled@#1` = hero settles on #0, walks to edge, then
`pickTakeoff` returns NO candidate scoring 0 (honest-picker contract: it never
returns a known-short jump) → brain gives up immediately. `fell-out@#1` = a
sim-"proven" jump still missed in replay (residual sim/replay divergence).

### Why the box fix didn't cure hop 1
The pick is made from a **grounded, settled state** (`rideBrain.settleHero`
zeroes velocity, full super meter). While standing still the box is the idle
box in BOTH old and new code — so the rejection of every candidate at hop 1
points at math that is STILL stale relative to the user's new speed/jump values:

1. **Closed-form envelope / pre-filter** — `minHeroSuperAssistReachPx`,
   `MAX_CLEARABLE_GAP`, `doubleJumpReachForStats` in `js/world/macros.js`.
   These read `HEROES[*].stats.speed/.jump` (so they track stat changes) but
   model the arc with fixed assumptions (e.g. constant full-height body, DJ-at-
   apex timing). If the user's commit also changed how jump height/speed behave
   per anim (tucked mid-air body = different airtime/contact), the envelope
   over- or under-promises reach. BFS uses `MAX_CLEARABLE_GAP` to decide which
   surfaces are reachable (blue vs amber) — an over-promise here creates goals
   the deterministic edge-takeoff physically cannot make ("BLUE but MISSED",
   DEBUGGING.md §6 invariant).
2. **Walk-to-edge launch position** — `makeJumpScript` arms the jump at the
   platform edge/coyote. With a narrower run box the hero's center at the edge
   differs slightly; combined with (1) can push every candidate just short.
3. **Residual clone divergence (fell-out class)** — `takeoffPicker.makeClone`
   copies only `vx, vy, jumpsUsed, supermoveMeter`. Now that boxes are
   anim-dependent, the clone also needs the SAME anim state as the source hero
   (`_spriteAnim`, `_targetHScale`, `_fallAnimGrace`, `_coyote`, `_jumpBuffer`,
   `_prevJumpHeld`, `crouching`, `supermoveActive`, `_dropTimer`) — settleHero
   clears most of these on the REAL hero, but the clone is built fresh; verify
   the fresh clone's anim defaults equal the settled hero's.

### Next experiment (ONE probe, per DEBUGGING.md §4 discipline)
Dump the full scorecard for the smallest failing case, `stretchedPyramid`
#0→#1: build the ride world, spawn a settled hero on #0 (exact ride pre-pick
state), call `pickTakeoff(hero, goal, world, params, {}, sourceLanding)`, print
best + every candidate's score/detail. Then answer exactly one question:
- candidates rejected by the **envelope pre-filter** (never simulated) → fix
  the closed-form math in `macros.js`;
- candidates **simulated but near-miss** (small dx/dy in detail string) → fix
  launch position / clone anim state;
- all candidates hard-miss (land wrong surface / wall-pin) → route/BFS bug,
  print `traversalRoute` order first.

Do NOT re-run whole suites repeatedly while narrowing — one probe per hypothesis
(anti-spin rule: max 3 debug iterations per bug, then report).

## 4. Commands cheat-sheet

```bash
cd ~/src/html-game/petal-panic
node tools/ride-report.mjs            # THE status table (exit 0 = all pass)
node tools/ride-report.mjs --fail     # only failing macros
node tools/ride-report.mjs stretchedPyramid
node --test js/test/pickerRide.test.js 2>&1 \
  | grep -E "classified|❌ MISSED|❌ GHOST|stalled after"
node js/test/run-all.mjs              # full unit suite (pre-existing unrelated
                                      # failures: attackKnockback constants 0.45≠0.28,
                                      # barrel.momentum Δ=1.5px, barrel.solid
                                      # walk-through, propaneFan 4≠5 handles)
```

### Where to start, in order
1. Read §0 (TL;DR), then this section.
2. `git diff` in `~/src/html-game` — see the exact uncommitted box-sync fix.
3. `node tools/ride-report.mjs --fail` — confirm you reproduce the 11 failures
   (expect 6 of them at #1). If the table differs, something changed since
   2026-11-12 — re-derive before trusting §3.
4. Read `petal-panic/macro-editor/DEBUGGING.md` — the architecture map
   (route / pick / brain / ride shell), the honest-picker contract, the trap
   list, and test discipline. It is the authoritative doc for this subsystem.
5. Then run the §3 probe on `stretchedPyramid`.

Chrome ground truth: hard-reload (Ctrl+Shift+R), start TEST ride, hold Ctrl to
record, release to dump `petal-panic-macrotrace-*.json` (see DEBUGGING.md §6).

## 5. Rules for whoever continues

- **Never commit without explicit user instruction** (standing workflow rule).
- One brain: change per-hop behavior in `js/world/rideBrain.js` only — browser
  and node share it. No twin copies.
- Honest picker: `pickTakeoff` must keep returning `null` when nothing scores 0.
  Do not make it return best-effort misses.
- Every candidate script must be an `(i, h)` closure (trap #4).
- Acceptance = every expected-touch platform ✅ in `pickerRide.test.js` /
  `ride-report.mjs`, plus Chrome trace for the previously-failing macros.
  Isolated probes narrow; they never prove.
- The 4 pre-existing unrelated unit-test failures (knockback/barrel/propane)
  predate this work — don't conflate them with the ride bug, but do note them
  if asked about `run-all.mjs` totals.
