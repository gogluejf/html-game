// Ghost test ride — editor UI skin over the headless rider core.
// Spawns a green hero rect that physically rides the current draft macro at
// real speed, leaves a pale gray trail, loops on clear, retries on failure.
// Any other editor action kills the ride and restores normal editing.

import { app } from './state.js';
import { cv, s2c as s2cLocal, $ } from './viewport.js';
import { showToast } from './toast.js';
import { buildRideWorld } from '../../js/world/ghostRider.js';
import { createHeadlessHero, stepHeadless } from '../../js/hero/headless.js';
import { HEROES } from '../../js/hero/heroDefs.js';
import { predictFrame, feetPos } from '../../js/world/platformMover.js';
import { traversalRoute } from '../../js/world/macros.js';
import { macroEndpoint } from './clearance.js';
import { settleHero, createRideBrain } from '../../js/world/rideBrain.js';
import { stepRide } from '../../js/world/rideDriver.js';

// Manual-play input (plan 07): the SAME engine as the real game — the `input`
// singleton from js/core/input.js. It owns keyboard listeners AND gamepad
// polling (navigator.getGamepads) with the user's saved mapping/layout
// (localStorage 'petal_panic_mapping'). No duplicated key handling here: we
// only poll() each ride tick and read the normalized state. Keyboard works
// through the same engine, so both sources merge automatically.
import { input } from '../../js/core/input.js';

// Local alias so rideInput can call feetPos without shadowing.
const feetPosLocal = feetPos;
// Candidate list is rebuilt per pick; cache the last one for execute replay.
let candsRef = [];

// Redraw hook: draw.js registers its draw() here so ghost.js never imports
// draw.js directly (that would be a circular dependency: draw.js → ghost.js).
let _redraw = () => {};
let _commitClearance = () => {};
export function setRedrawHook(fn){ _redraw = fn; }
export function setClearanceCommitHook(fn){ _commitClearance = fn; }

// Space-trigger arming: main.js arms the start/stop toggle on space keydown;
// pointer.js cancels it when a real edit-drag starts inside the zone. The
// toggle fires on space KEYUP only if still armed — i.e. no drag happened.
let _spaceArm = null;
export function armSpaceToggle(fn){ _spaceArm = fn || null; }
export function cancelSpaceToggle(){ _spaceArm = null; }
/** Fire the armed toggle (called on space keyup). Returns true if it fired. */
export function fireSpaceToggle(){
  const fn = _spaceArm;
  _spaceArm = null;
  if (fn) { fn(); return true; }
  return false;
}
// Manual-play input (plan 07): the SAME engine as the real game — the `input`
// singleton from js/core/input.js. It owns keyboard listeners AND gamepad
// polling (navigator.getGamepads) with the user's saved mapping/layout
// (localStorage 'petal_panic_mapping'). No duplicated key handling here: we
// only poll() each ride tick and read the normalized state. Keyboard works
// through the same engine, so both sources merge automatically.
const requestDraw = () => requestAnimationFrame(() => _redraw());

const DT = 1 / 60;
const TRAIL_MAX = 900; // ~15 s of trail points at 30 Hz (matches rideDriver)

// ---------------------------------------------------------------------------
// Fixed-timestep driver (real game speed, independent of display rate).
// ---------------------------------------------------------------------------
export const ride = {
  active: false,
  world: null,
  hero: null,
  path: [],          // trail points in world px {x,y}
  status: '',        // 'running' | 'cleared'
  failPoint: null,
  visited: 0,
  totalLandings: 0,
  _raf: 0,
  _last: 0,
  _acc: 0,
  trace: null,       // frame trace buffer while Ctrl is held (null when off)
  // --- smart mover state (task 4) -----------------------------------------
  goal: null,        // current target landing surface {x0,x1,y,index,kind}
  goals: [],         // BFS-ordered list of reachable surfaces to land on
  goalIdx: 0,        // index into goals currently being pursued
  mem: null,         // per-hop mover memory (predictFrame scratch)
  params: null,      // injected movement stats (Balthazar for the ghost)
  landedSet: null,   // Set of landed surface indices (green flashes)
  failedSet: null,   // Set of surfaces reported unreachable (amber X)
  _landFlash: 0,     // frames remaining of the green land flash
  manual: false,     // plan 07: true = player-controlled (keyboard), false = AI
  brain: null,       // shared rideBrain state (THE per-hop AI, shared with node tests)
};

/** Build the ordered goal list for a ride world: BFS traversal order from
 *  the validator's own reachability math (traversalRoute). Surfaces the BFS
 *  can't reach are marked in failedSet (amber X) and excluded from the route.
 *  Fallback: left→right sort if the draft has no units yet. */
function buildGoalList(world, st){
  const ls = [...world.landings];
  let routeOrder = null;
  if (st && st.units?.length){
    // traversalRoute expects _editorIndex on units; landings carry index into
    // the units array already (buildRideWorld maps units → landings 1:1 by
    // unitIndex). Tag units with their index so the route maps back.
    const tagged = st.units.map((u, i) => ({ ...u, _editorIndex: u._editorIndex ?? i }));
    const { order, unreachable } = traversalRoute({ orientation: st.orientation, units: tagged });
    routeOrder = order;
    // Compute the unreachable set LOCALLY first, then assign. Mutating
    // ride.failedSet in place used to lose marks when startRide's
    // Object.assign replaced it with a fresh Set afterwards (the amber X
    // only reappeared after the next rebuild re-added entries).
    const failSet = new Set();
    for (const ui of unreachable){
      const l = ls.find(x => x.index === ui);
      if (l) failSet.add(l.index);
    }
    ride.failedSet = failSet;
  }
  if (!routeOrder || !routeOrder.length){
    if (world.vertical) ls.sort((a, b) => (b.y - a.y) || (a.x0 - b.x0));
    else ls.sort((a, b) => (a.x0 - b.x0) || (a.y - b.y));
    return ls;
  }
  // Map BFS unit-index order onto landing objects. Surfaces the BFS flagged
  // unreachable are NOT goals — they get the amber X (failedSet) and the ride
  // skips them. (The old catch-all "append anything missing" re-queued them
  // as final goals, forcing the mover to attempt physically impossible hops.)
  const byIdx = new Map(ls.map(l => [l.index, l]));
  const ordered = [];
  for (const ui of routeOrder){
    const l = byIdx.get(ui);
    if (l) ordered.push(l);
  }
  return ordered;
}

/** Advance to the next unlanded goal after the current one is done. */
function advanceGoal(){
  // Advance THE shared brain (single source of truth for goal progression).
  if (ride.brain) {
    const brainAdvance = () => {
      ride.brain.goalIdx++;
      ride.brain.goal = ride.brain.goals[ride.brain.goalIdx] ?? null;
      ride.brain.mem = { wantJump: false, djDone: false, armSuper: false, superFired: false, _releasedAtApex: false };
      ride.brain._pick = null;
      ride.brain._pickGoalIdx = null;
      ride.brain._pickFromKey = null;
      ride.brain._pickFrame = 0;
      ride.brain._fallbackDir = null;
    };
    brainAdvance();
    ride.goal = ride.brain.goal;
    ride.goalIdx = ride.brain.goalIdx;
    ride.mem = ride.brain.mem;
    return;
  }
  ride.goalIdx++;
  if (ride.goalIdx >= ride.goals.length) {
    ride.goal = null; // all surfaces done — keep running to the exit
    return;
  }
  ride.goal = ride.goals[ride.goalIdx];
  // Fresh per-hop memory for each new goal.
  ride.mem = { wantJump: false, djDone: false, armSuper: false, superFired: false, _releasedAtApex: false };
  // Invalidate the picker cache so the next grounded frame re-sims for this goal.
  ride._pick = null;
  ride._pickGoalIdx = null;
  ride._pickFromKey = null;
}

/** Start (or restart) the test ride for the current macro draft. */
export function startRide(){
  if (!app.cur || !app.cur.st) return;
  stopRide(false); // kill any existing ride + trail
  const st = app.cur.st;
  const c = app.consts;
  const world = buildRideWorld(st, {
    unitPxX: c.unitPxX, unitPxY: c.unitPxY, platformDrawH: c.platformDrawH,
  });
  const endpoint = macroEndpoint(st);
  world.macroEndPx = endpoint.value * (endpoint.orientation === 'vertical' ? c.unitPxY : c.unitPxX);
  // Spawn with FEET on the entry surface: anchor by the real box height so
  // the rect isn't sunk into the ground (box h comes from the hero def).
  // Manual play (plan 07) uses the player's actual game hero (same selection
  // as the game: window.__selectedHero, default scarlet); AI test rides keep
  // balthazar — it's a geometry probe, and the picker/tuning is calibrated to
  // those stats.
  const heroKey = ride.manual ? (window.__selectedHero || 'scarlet') : 'balthazar';
  const _spawnHero = () => {
    const h = createHeadlessHero(heroKey, { x: 0, y: 0 });
    const bh = h.worldBox().h;
    return createHeadlessHero(heroKey, { x: world.entry.x - 8, y: world.entry.y - bh });
  };
  const hero = _spawnHero();
  // Smart mover setup (task 4): injected params match the spawned hero.
  const stats = HEROES[heroKey].stats;
  const params = { ...stats, hasDoubleJump: true, canSuper: true };
  // buildGoalList marks BFS-unreachable surfaces into ride.failedSet — it
  // must exist BEFORE the call (module default is null; the Object.assign
  // below used to create it too late → "can't access property 'add',
  // ride.failedSet is null" on the first startRide).
  ride.failedSet = new Set();
  ride.landedSet = new Set();
  const goals = buildGoalList(world, st);  // THE shared per-hop AI brain — same module the node tests drive. Browser and
  // node can't drift because there is one decideInput() implementation.
  ride.brain = createRideBrain(goals, {
    stepFn: stepHeadless,
    dt: DT,
    units: st.units,
    orientation: st.orientation,
    params,
  });
  Object.assign(ride, {
    active: true,
    world,
    hero,
    path: [],
    status: 'running',
    failPoint: null,
    visited: 0,
    totalLandings: world.landings.length,
    _last: performance.now(),
    _acc: 0,
    params,
    goals,
    goalIdx: 0,
    goal: goals[0] ?? null,
    mem: { wantJump: false, djDone: false, armSuper: false, superFired: false, _releasedAtApex: false },
    landedSet: new Set(),
    _landFlash: 0,
  });
  ride.trace = null;
  // Wire the shared driver (js/world/rideDriver.js) to this browser ride:
  // manualInput feeds plan-07 play. AI rides never call _manualInputFn
  // (stepRide checks state.manual first).
  ride._manualInputFn = manualInput;
  // Clear ALL picker cache from any previous ride: startRide must not inherit
  // a stale _pick/_pickFrame/candsRef (the "retest after clear" stall — the
  // new ride replayed the old ride's exhausted script because pickStale was
  // false for the same goal+fromKey).
  ride._pick = null;
  ride._pickGoalIdx = null;
  ride._pickFromKey = null;
  ride._pickFrame = 0;
  ride._scorecard = null;
  candsRef = [];
  $('testRideBtn')?.classList.add('armed');
  updateRideHint();
  ride._raf = requestAnimationFrame(tick);
}

/** Rebuild the ride world from the CURRENT draft while a ride is running.
 *  Called after an edit commits mid-test so the ghost rides the new geometry
 *  instead of the stale snapshot it was built with. Hero keeps its position. */
export function rebuildRideWorld(){
  if (!ride.active || !app.cur || !app.cur.st) return;
  const c = app.consts;
  const world = buildRideWorld(app.cur.st, {
    unitPxX: c.unitPxX, unitPxY: c.unitPxY, platformDrawH: c.platformDrawH,
  });
  const endpoint = macroEndpoint(app.cur.st);
  world.macroEndPx = endpoint.value * (endpoint.orientation === 'vertical' ? c.unitPxY : c.unitPxX);
  ride.world = world;
  ride.totalLandings = world.landings.length;
  ride._visitedSet = null;
  ride.visited = 0;
  ride._onOneWay = false;

  // Rebuild the goal list + mover state for the new geometry. The hero keeps
  // its position; the mover re-plans from wherever it is.
  const goals = buildGoalList(world, app.cur.st);
  ride.goals = goals;
  // Resume at the first goal not yet landed (or the first one ahead of hero).
  const cx = hero.worldBox().x + hero.worldBox().w / 2;
  let resumeIdx = 0;
  for (let i = 0; i < goals.length; i++){
    if (ride.landedSet?.has(goals[i].index)) continue;
    if (!world.vertical && goals[i].x0 < cx - world.UX) continue; // already behind
    resumeIdx = i;
    break;
  }
  ride.goalIdx = resumeIdx;
  ride.goal = goals[resumeIdx] ?? null;
  ride.mem = { wantJump: false, djDone: false, armSuper: false, superFired: false, _releasedAtApex: false };
  // Rebuild the shared brain for the new geometry, resuming at the same goal.
  if (ride.brain){
    ride.brain.goals = goals;
    ride.brain.goalIdx = resumeIdx;
    ride.brain.goal = goals[resumeIdx] ?? null;
    ride.brain.mem = { wantJump: false, djDone: false, armSuper: false, superFired: false, _releasedAtApex: false };
    ride.brain._pick = null;
    ride.brain._pickGoalIdx = null;
    ride.brain._pickFromKey = null;
    ride.brain._pickFrame = 0;
    ride.brain._fallbackDir = null;
  }

  ride.path = [];
}

/** Kill the ride, clear the trail, unlock editing. Dumps any active trace. */
export function stopRide(redraw = true){
  ride.active = false;
  if (ride._raf) cancelAnimationFrame(ride._raf);
  ride._raf = 0;
  // If a recording is live, end it + dump so nothing is lost on stop.
  if (ride.trace) dumpTrace('stopped');
  // Reset trace button state even if no trace was active.
  document.getElementById('dumpTraceBtn')?.classList.remove('recording');
  // Plan 07: reset manual-play state. Input is owned by the shared engine —
  // nothing to unbind here; stop polling on next tick (ride.active = false).
  ride.manual = false;
  $('playBtn')?.classList.remove('armed');
  ride.hero = null;
  ride.world = null;
  ride.path = [];
  ride.status = '';
  ride.failPoint = null;
  ride.trace = null;
  // Kill the picker cache too — a stopped ride must not leak _pick/candsRef
  // into the next startRide (same stale-script stall as the clear→retest bug).
  ride._pick = null;
  ride._pickGoalIdx = null;
  ride._pickFromKey = null;
  ride._pickFrame = 0;
  ride._scorecard = null;
  candsRef = [];
  $('testRideBtn')?.classList.remove('armed');
  updateRideHint();
  if (redraw) requestDraw();
}

/** Toggle from the TEST button.
 *  - No ride running → start a fresh AI test ride.
 *  - Manual play running → STOP manual and RESUME the AI from wherever the
 *    hero currently is (fresh pick for the goal ahead; hero keeps position). */
export function toggleRide(){
  if (!ride.active){
    startRide();
    return;
  }
  if (ride.manual){
    // Hand control back to the AI mid-ride. The hero stays where it is; the
    // picker re-plans from the current surface toward the next unlanded goal.
    ride.manual = false;
    input.barrier();
    $('playBtn')?.classList.remove('armed');
    const h = ride.hero;
    if (h){ h._prevJumpHeld = false; h._prevMeleeJumpHeld = false; h._jumpBuffer = 0; }
    // Resume at the first goal not yet landed (same logic as rebuildRideWorld).
    const world = ride.world;
    const cx = h.worldBox().x + h.worldBox().w / 2;
    let resumeIdx = 0;
    for (let i = 0; i < ride.goals.length; i++){
      if (ride.landedSet?.has(ride.goals[i].index)) continue;
      if (!world.vertical && ride.goals[i].x0 < cx - world.UX) continue; // already behind
      resumeIdx = i;
      break;
    }
    ride.goalIdx = resumeIdx;
    ride.goal = ride.goals[resumeIdx] ?? null;
    ride.mem = { wantJump: false, djDone: false, armSuper: false, superFired: false, _releasedAtApex: false };
    // Invalidate picker cache so the AI re-sims from the current spot.
    ride._pick = null;
    ride._pickGoalIdx = null;
    ride._pickFromKey = null;
    ride._pickFrame = 0;
    candsRef = [];
    if (ride.brain){
      ride.brain.goalIdx = resumeIdx;
      ride.brain.goal = ride.goals[resumeIdx] ?? null;
      ride.brain.mem = { wantJump: false, djDone: false, armSuper: false, superFired: false, _releasedAtApex: false };
      ride.brain._pick = null;
      ride.brain._pickGoalIdx = null;
      ride.brain._pickFromKey = null;
      ride.brain._pickFrame = 0;
      ride.brain._fallbackDir = null;
    }
    updateRideHint();
    requestDraw();
    return;
  }
  stopRide(); // AI test running → stop it
}

// ---------------------------------------------------------------------------
// Plan 07 — Manual play mode: player controls the ghost with keyboard input.
// Reuses the ride infrastructure (world, hero, fixed-timestep loop, trail).
// No goals, no landing detection, no clearance commit. ESC stops it.
// ---------------------------------------------------------------------------

/** Toggle manual play from the PLAY button.
 *  - No ride running → spawn a fresh manual ride at entry.
 *  - AI test ride running → TAKE OVER in place: same hero position, same
 *    world snapshot, trail kept. Goals/picker state is inert while manual
 *    (stepOnce skips goal logic), and stopping manual play just stops the
 *    ride — no attempt to resume the AI mid-hop (that would replay stale
 *    picker scripts). */
export function toggleManualPlay(){
  if (!app.cur || !app.cur.st){ showToast('load a macro first', 'warn'); return; }
  if (ride.active && ride.manual){
    stopRide(); // stop manual play
  } else if (ride.active) {
    // Take over the running AI ride wherever it currently is.
    ride.manual = true;
    input.barrier(); // drop stale held state from editing before the first poll
    // The AI script may have left jump/super HELD on its last frame — the
    // hero's edge detectors (_prevJumpHeld/_prevMeleeJumpHeld) would swallow
    // the player's first press ("already held" → no new edge → no jump).
    // Reset them so the first manual press always fires.
    const h = ride.hero;
    if (h){ h._prevJumpHeld = false; h._prevMeleeJumpHeld = false; h._jumpBuffer = 0; }
    $('playBtn')?.classList.add('armed');
    updateRideHint();
    requestDraw();
  } else {
    stopRide(false); // kill any leftover state (no redraw yet — we start immediately)
    startRide();     // reuse existing spawn/world setup
    ride.manual = true;
    input.barrier();
    $('playBtn')?.classList.add('armed');
    updateRideHint();
    requestDraw();
  }
}

/** Called by pointer/tools when the user does ANY other editor action. */
export function killRideIfActive(){
  if (ride.active) stopRide();
}

// ---------------------------------------------------------------------------
// Fixed-timestep driver (real game speed, independent of display rate).
// ---------------------------------------------------------------------------

function tick(now){
  if (!ride.active) return;
  ride._raf = requestAnimationFrame(tick);
  const frame = Math.min(0.1, (now - ride._last) / 1000);
  ride._last = now;

  ride._acc += frame;
  let guard = 0;
  while (ride._acc >= DT && guard < 8) {
    try {
      stepOnce(DT);
    } catch (err) {
      // A single-frame throw must not silently kill the whole ride loop —
      // surface it and stop cleanly so the user sees WHY it froze.
      console.error('[ride] step error:', err);
      showToast(`ride error: ${err.message}`, 'error');
      stopRide();
      return;
    }
    ride._acc -= DT;
    guard++;
    // stepOnce may have ended the ride (cleared → stopRide nulls hero/world).
    // Stop stepping this batch rather than running again on a dead ride.
    if (!ride.active) break;
  }
  requestDraw();
}

function stepOnce(dt){
  // The ride may have just stopped (cleared / killed) on a prior step in this
  // same tick batch — stopRide() nulls hero/world and flips active. Bail out
  // before touching them so a multi-step frame never crashes on a dead ride.
  if (!ride.active || !ride.hero || !ride.world) return;
  const { world, hero } = ride;
  // THE shared per-frame step (js/world/rideDriver.js) — identical to the node
  // test ride. decideInput → exit-run → stepHeadless → landing credit →
  // fell-past / fell-out recovery all live there; no duplicated choreography.
  const ev = stepRide(ride, dt);

  const cx = hero.worldBox().x + hero.worldBox().w / 2;
  const fy = hero.worldBox().y + hero.worldBox().h; // feet (for physics checks)

  recordTraceFrame(ride._lastIn ?? {}, ride._lastRes ?? {}, cx, fy);

  // Visit tracking (any surface touched counts for the visited readout).
  for (const l of world.landings) {
    if (cx >= l.x0 && cx <= l.x1 && Math.abs(l.y - fy) <= 4) {
      if (!ride._visitedSet) ride._visitedSet = new Set();
      ride._visitedSet.add(l.index);
      ride.visited = ride._visitedSet.size;
    }
  }

  // Keep the legacy debug fields in sync (trace dump / console / goal overlay
  // read ride.goal + ride.mem from the brain after each step).
  if (ride.brain){
    ride.goal = ride.brain.goal;
    const gi = ride.goals.findIndex(g => g.index === ride.goal?.index);
    if (gi >= 0) ride.goalIdx = gi;
    ride.mem = ride.brain.mem;
    ride._pick = ride.brain._pick;
    ride._scorecard = ride.brain.scorecard ?? null;
    ride._pickFrame = ride.brain._pickFrame;
  }

  // Reaching the authored macro endpoint concludes the ride in EITHER mode:
  // commit the clearance proof (sidebar flag) and PARK. The ride stops
  // stepping but the world/hero/trail stay alive so the gray trail + goal
  // icons remain visible FOREVER — until a new test starts or any other
  // editor action kills the ride (killRideIfActive → stopRide).
  if (ev.cleared) {
    _commitClearance();
    showToast('CLEARED ✓ — proof saved to draft', 'success');
    if (ride.trace) dumpTrace('cleared');
    parkRide();
    return;
  }
}
/** Park after a clear: stop stepping, keep rendering indefinitely.
 *  The trail + goal icons stay on screen until a new test or any other
 *  editor action kills the ride. Held input state is dropped so nothing
 *  leaks into the next ride. */
function parkRide(){
  const h = ride.hero;
  if (h){ h._prevJumpHeld = false; h._prevMeleeJumpHeld = false; h._jumpBuffer = 0; }
  input.barrier();
  ride.status = 'cleared';
  updateRideHint();
  requestDraw();
}

/** Manual-play input provider (plan 07): the game's own input engine
 *  (keyboard + DS5/etc. gamepad via navigator.getGamepads, user's saved
 *  mapping). Wired into the shared driver as state._manualInputFn — the ONLY
 *  browser-specific input path. AI rides get their input from decideInput
 *  inside stepRide; this function is never called for them. */
function manualInput(){
  const s = input.poll({ facing: ride.hero.facing || 1 });
  return {
    left: s.moveX < -0.2,
    right: s.moveX > 0.2,
    down: !!s.crouch,          // pure Down / D-pad down / L-stick down
    jump: !!s.jump,            // Space / ✕ (edge-triggered by hero)
    super: !!s.supermove,      // K / △ (edge-triggered by meter+press)
    onOneWay: !!ride._onOneWay,
  };
}

// ---------------------------------------------------------------------------
// Frame trace — hold Ctrl during a ride to record every physics frame.
// On release (or when the ride ends) the full trace is dumped to disk via
// PUT /petal-panic/macro-editor/trace → petal-panic/macro-editor/traces/.
// Each frame: hero state, input, driver decisions, collision result.
// Metadata: macro draft + ride world config so the dump is self-contained.
// ---------------------------------------------------------------------------

const TRACE_MAX_FRAMES = 60 * 60; // hard cap: 1 minute of frames

function recordTraceFrame(inp, res, cx, fy){
  if (!ride.trace) return;
  const { world, hero } = ride;
  ride.trace.frames.push({
    f: ride.trace.frames.length,
    x: +cx.toFixed(2),
    y: +fy.toFixed(2),
    vx: +hero.vx.toFixed(2),
    vy: +hero.vy.toFixed(2),
    grounded: hero.grounded,
    in: { left: inp.left, right: inp.right, up: false, down: inp.down, jump: inp.jump, supermove: inp.super },
    hit: res.hit ? { axis: res.hit.axis, dir: res.hit.dir } : null,
    blockedX: !!hero._blockedX,

  });
  if (ride.trace.frames.length >= TRACE_MAX_FRAMES) {
    showToast(`trace capped at ${TRACE_MAX_FRAMES} frames — releasing`, 'warn');
    dumpTrace('capped');
  }
}

/** Begin recording (called on Ctrl keydown while a ride is active). */
export function startTrace(){
  if (!ride.active || ride.trace) return;
  const st = app.cur?.st;
  const c = app.consts;
  ride.trace = {
    startedAt: new Date().toISOString(),
    macroId: st?.id ?? null,
    macro: st,                       // full draft = zone configuration
    picker: {                        // debug: what the sim-picker decided per goal
      lastGoal: ride.goal?.index ?? null,
      best: ride._pick?.best?.id ?? null,
      score: ride._pick?.best ? Math.round(ride._pick.best.score) : null,
      scorecard: ride._scorecard ?? null,
    },
    world: {
      orientation: ride.world.vertical ? 'vertical' : 'horizontal',
      W: ride.world.W, H: ride.world.H, groundY: ride.world.groundY,
      UX: ride.world.UX, UY: ride.world.UY,
      unitPxX: c?.unitPxX, unitPxY: c?.unitPxY, platformDrawH: c?.platformDrawH,
      entry: ride.world.entry, exit: ride.world.exit,
      macroEndPx: ride.world.macroEndPx,
      solids: ride.world.solids.map(s => ({ ...s })),
      landings: ride.world.landings.map(l => ({ ...l })),
    },
    hero: ride.hero?.heroDef?.id ?? 'balthazar',
    dt: DT,
    frames: [],
  };
  showToast('trace REC — press X or click TRACE again to stop + save', 'info');
  const btn = document.getElementById('dumpTraceBtn');
  if (btn) btn.classList.add('recording');
  updateRideHint();
}

/** Manual dump trigger (button). */
export function dumpTraceNow(){
  if (!ride.trace){ showToast('nothing to dump — press X (or TRACE) during a ride first', 'warn'); return; }
  console.log('[trace] manual dump →', ride.trace.frames.length, 'frames');
  dumpTrace('manual-button');
}

/** Toggle recording. Off→start; on→stop + dump to disk. Bound to X and the TRACE button. */
export function toggleTrace(){
  if (!ride.active || ride.status !== 'running'){ showToast('start a ride first (Space / T)', 'warn'); return; }
  if (ride.trace){
    console.log('[trace] toggle stop → dumping', ride.trace.frames.length, 'frames');
    dumpTrace('toggled-off');
  } else {
    startTrace();
  }
}

/** Stop recording and POST the trace to disk. Returns the saved path or null. */
export function dumpTrace(reason = 'manual'){
  const t = ride.trace;
  ride.trace = null;
  if (!t) return null;
  const btn = document.getElementById('dumpTraceBtn');
  if (btn) btn.classList.remove('recording');
  console.log('[trace] dumping', t.frames.length, 'frames, reason:', reason);
  t.endedAt = new Date().toISOString();
  t.reason = reason;
  t.result = { status: ride.status, failPoint: ride.failPoint, visited: ride.visited, totalLandings: ride.totalLandings };
  // Save via browser download → lands in ~/Downloads (same as the game's dumps).
  // No server round-trip: nothing to hang, works even if the editor server is down.
  const macroName = t.macroId ?? 'unknown';
  const name = `petal-panic-macrotrace-${macroName}-${Date.now()}.json`;
  const blob = new Blob([JSON.stringify(t, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
  showToast(`trace saved → Downloads/${name} (${t.frames.length} frames)`, 'success');
  return name;
}

/** Called from main.js on Ctrl keyup: stop + dump if recording. */
export function stopTraceAndDump(){
  if (!ride.trace) return;
  dumpTrace('released');
}

// ---------------------------------------------------------------------------
// Status hint (shared element with validation messages).
// ---------------------------------------------------------------------------

function updateRideHint(){
  const el = document.getElementById('validationHint');
  const traceBtn = document.getElementById('dumpTraceBtn');
  // Sync trace button: disabled when no ride, recording class only when tracing.
  if (traceBtn){
    traceBtn.disabled = !ride.active;
    traceBtn.classList.toggle('recording', !!ride.trace);
  }
  // Plan 07: TEST and PLAY are mutually exclusive modes of ONE ride toggle —
  // exactly one shows armed while a ride runs (the active mode); neither when
  // idle. TRACE is independent (recording class).
  $('testRideBtn')?.classList.toggle('armed', ride.active && !ride.manual);
  $('playBtn')?.classList.toggle('armed', ride.active && ride.manual);
  if (!el || !ride.active) return;
  if (ride.status === 'running' && ride.manual) {
    const cx = Math.round(ride.hero.worldBox().x + ride.hero.worldBox().w / 2);
    const cy = Math.round(ride.hero.worldBox().y + ride.hero.worldBox().h);
    el.textContent = `manual play · x=${cx} y=${cy}${ride.trace ? ` · REC ${ride.trace.frames.length}` : ''} · ESC to stop`;
  }
  else if (ride.status === 'running') {
    const goalTxt = ride.goal
      ? `aiming ${ride.goal.kind}#${ride.goal.index}`
      : 'all landed → exit';
    el.textContent = `ride: ${goalTxt} · landed ${ride.landedSet?.size ?? 0}/${ride.totalLandings}${ride.trace ? ` · REC ${ride.trace.frames.length}` : ''}`;
  }
  else if (ride.status === 'cleared') el.textContent = `ride: CLEARED ✓ — trail on screen until next action`;
  el.classList.toggle('on', !!el.textContent);
  el.classList.toggle('warning', false);
}

// ---------------------------------------------------------------------------
// Rendering hook — called from drawEditorOverlay via setDrawHook-style export.
// Kept as an explicit call so draw.js stays the single canvas owner.
// ---------------------------------------------------------------------------

export function drawRide(ctx, macro){
  if (!ride.active || !ride.world || !ride.hero) return;
  const { world } = ride;
  // Coordinate mapping: ride world is screen-px with y DOWN, origin at zone
  // top-left. The editor's W() expects world coords with y UP (unit*px).
  // Convert: editorWorldX = rideX, editorWorldY = -(rideY) + world.H ... but
  // the editor viewport for a macro uses bodyOffset + unit space. Simplest
  // correct mapping: use the same transform the grid uses.
  const off = macro.orientation === 'vertical' ? (app.consts.vEntryClear ?? 0) : (app.consts.hEntryClear ?? 3);
  const ux = app.consts.unitPxX, uy = app.consts.unitPxY;
  const toScreen = (rx, ry) => {
    // ride y is measured down from zone top; editor world y is up from ground.
    const wx = rx / ux + off;
    const wy = (world.H - ry) / uy;
    return s2cLocal(wx * ux, wy * uy);
  };

  // Trail: pale gray dots at hero-center height, drawn as a connected path
  // so it's visible even when running flat (not just during jumps).
  ctx.save();
  if (ride.path.length > 1) {
    ctx.strokeStyle = 'rgba(180,190,210,.35)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const [sx0, sy0] = toScreen(ride.path[0].x, ride.path[0].y);
    ctx.moveTo(sx0, sy0);
    for (let i = 1; i < ride.path.length; i += 2) {
      const [sx, sy] = toScreen(ride.path[i].x, ride.path[i].y);
      ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }
  // Dots every few points for texture.
  ctx.fillStyle = 'rgba(200,210,230,.4)';
  for (let i = 0; i < ride.path.length; i += 6) {
    const p = ride.path[i];
    const [sx, sy] = toScreen(p.x, p.y);
    ctx.beginPath();
    ctx.arc(sx, sy, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Hero rect (green, Balthazar debug color).
  const hb = ride.hero.worldBox();
  const [hx, hy] = toScreen(hb.x + hb.w / 2, hb.y); // top-center
  ctx.save();
  ctx.fillStyle = '#2ecc71';
  ctx.strokeStyle = '#0a3d20';
  ctx.lineWidth = 1.5;
  const wpx = hb.w * app.zoom, hpx = hb.h * app.zoom;
  ctx.fillRect(hx - wpx / 2, hy, wpx, hpx);
  ctx.strokeRect(hx - wpx / 2, hy, wpx, hpx);
  ctx.restore();

  // --- Smart-mover overlays (task 4) --------------------------------------
  // Current goal: TARGET icon at the surface center (same visual weight as
  // the amber X), plus a faint dashed line across the whole surface.
  if (ride.goal) {
    const g = ride.goal;
    const [gx0, gy0] = toScreen(g.x0, g.y);
    const [gx1, gy1] = toScreen(g.x1, g.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(0,229,255,.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(gx0, gy0);
    ctx.lineTo(gx1, gy1);
    ctx.stroke();
    ctx.setLineDash([]);
    // Target icon: concentric circles + crosshair at the goal center.
    const tcx = (gx0 + gx1) / 2, tcy = gy0;
    ctx.strokeStyle = 'rgba(0,229,255,.95)';
    ctx.fillStyle = 'rgba(0,229,255,.95)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tcx, tcy, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(tcx, tcy, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tcx - 14, tcy); ctx.lineTo(tcx - 5, tcy);
    ctx.moveTo(tcx + 5, tcy); ctx.lineTo(tcx + 14, tcy);
    ctx.moveTo(tcx, tcy - 14); ctx.lineTo(tcx, tcy - 5);
    ctx.moveTo(tcx, tcy + 5); ctx.lineTo(tcx, tcy + 14);
    ctx.stroke();
    ctx.restore();
  }
  // Landed surfaces: green flash (brief) + persistent GREEN CHECKMARK at the
  // surface center (mirror of the amber X on unreachable).
  if (ride.landedSet) {
    for (const idx of ride.landedSet) {
      const l = world.landings.find(x => x.index === idx);
      if (!l) continue;
      const [lx0, ly0] = toScreen(l.x0, l.y);
      const [lx1, ly1] = toScreen(l.x1, l.y);
      ctx.save();
      if (idx === ride._lastLandedIdx && ride._landFlash > 0) {
        ctx.strokeStyle = `rgba(90,255,138,${(ride._landFlash / 30).toFixed(2)})`;
        ctx.lineWidth = 4;
      } else {
        ctx.strokeStyle = 'rgba(90,255,138,.35)';
        ctx.lineWidth = 2;
      }
      ctx.beginPath();
      ctx.moveTo(lx0, ly0);
      ctx.lineTo(lx1, ly1);
      ctx.stroke();
      // Persistent checkmark at the surface center.
      const ccx = (lx0 + lx1) / 2, ccy = ly0;
      ctx.strokeStyle = '#5aff8a';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ccx - 7, ccy);
      ctx.lineTo(ccx - 2, ccy + 6);
      ctx.lineTo(ccx + 8, ccy - 6);
      ctx.stroke();
      ctx.restore();
    }
  }
  // Failed/unreachable surfaces: amber X.
  if (ride.failedSet) {
    for (const idx of ride.failedSet) {
      const l = world.landings.find(x => x.index === idx);
      if (!l) continue;
      const [ax, ay] = toScreen((l.x0 + l.x1) / 2, l.y);
      ctx.save();
      ctx.strokeStyle = '#ffbf00';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ax - 8, ay - 8); ctx.lineTo(ax + 8, ay + 8);
      ctx.moveTo(ax + 8, ay - 8); ctx.lineTo(ax - 8, ay + 8);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Fail marker.
  if (ride.failPoint) {
    const [fx, fy] = toScreen(ride.failPoint.x, ride.failPoint.y);
    ctx.save();
    ctx.strokeStyle = '#ff4545';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fx - 8, fy - 8); ctx.lineTo(fx + 8, fy + 8);
    ctx.moveTo(fx + 8, fy - 8); ctx.lineTo(fx - 8, fy + 8);
    ctx.stroke();
    ctx.restore();
  }
}

// Local s2c is imported at the top (s2cLocal).
