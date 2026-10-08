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
import { macroEndpoint } from './clearance.js';

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
const requestDraw = () => requestAnimationFrame(() => _redraw());

const DT = 1 / 60;
const TRAIL_MAX = 900; // ~15 s of trail points at 30 Hz

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
  attempts: 0,
  visited: 0,
  totalLandings: 0,
  lap: 0,
  _raf: 0,
  _last: 0,
  _acc: 0,
  _clearPause: 0,
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
};

/** Build the ordered goal list for a ride world: every landing surface in
 *  traversal order. Horizontal: left→right (then lower-first on ties).
 *  Vertical: ground→top, i.e. largest y (lowest surface) first. The mover
 *  rides them in order; the exit check still happens separately. */
function buildGoalList(world){
  const ls = [...world.landings];
  if (world.vertical) ls.sort((a, b) => (b.y - a.y) || (a.x0 - b.x0)); // climb: low (big y) → high (small y)
  else ls.sort((a, b) => (a.x0 - b.x0) || (a.y - b.y));
  return ls;
}

/** Advance to the next unlanded goal after the current one is done. */
function advanceGoal(){
  ride.goalIdx++;
  if (ride.goalIdx >= ride.goals.length) {
    ride.goal = null; // all surfaces done — keep running to the exit
    return;
  }
  ride.goal = ride.goals[ride.goalIdx];
  // Fresh per-hop memory for each new goal.
  ride.mem = { wantJump: false, djDone: false, armSuper: false, superFired: false, _releasedAtApex: false };
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
  const hero = createHeadlessHero('balthazar', { x: world.entry.x - 8, y: world.entry.y - 40 });
  // Smart mover setup (task 4): Balthazar params injected, goals in order.
  const stats = HEROES.balthazar.stats;
  const params = { ...stats, hasDoubleJump: true, canSuper: true };
  const goals = buildGoalList(world);
  Object.assign(ride, {
    active: true,
    world,
    hero,
    path: [],
    status: 'running',
    failPoint: null,
    attempts: 1,
    visited: 0,
    totalLandings: world.landings.length,
    lap: 1,
    _last: performance.now(),
    _acc: 0,
    _clearPause: 0,
    params,
    goals,
    goalIdx: 0,
    goal: goals[0] ?? null,
    mem: { wantJump: false, djDone: false, armSuper: false, superFired: false, _releasedAtApex: false },
    landedSet: new Set(),
    failedSet: new Set(),
    _landFlash: 0,
  });
  ride.trace = null;
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
  const goals = buildGoalList(world);
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

  ride.path = [];
}

/** Kill the ride, clear the trail, unlock editing. Dumps any active trace. */
export function stopRide(redraw = true){
  ride.active = false;
  if (ride._raf) cancelAnimationFrame(ride._raf);
  ride._raf = 0;
  // If a recording is live, end it + dump so nothing is lost on stop.
  if (ride.trace) dumpTrace('stopped');
  ride.hero = null;
  ride.world = null;
  ride.path = [];
  ride.status = '';
  ride.failPoint = null;
  ride.trace = null;
  $('testRideBtn')?.classList.remove('armed');
  updateRideHint();
  if (redraw) requestDraw();
}

/** Toggle from the TEST button. */
export function toggleRide(){
  if (ride.active) stopRide();
  else startRide();
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

  if (ride._clearPause > 0) {
    ride._clearPause -= frame;
    if (ride._clearPause <= 0) restartLap();
    requestDraw();
    return;
  }

  ride._acc += frame;
  let guard = 0;
  while (ride._acc >= DT && guard < 8) {
    stepOnce(DT);
    ride._acc -= DT;
    guard++;
  }
  requestDraw();
}

function stepOnce(dt){
  const { world, hero } = ride;
  const inp = rideInput();
  const res = stepHeadless(hero, dt, inp, world.solids);
  ride._onOneWay = res.onOneWay;

  const cx = hero.worldBox().x + hero.worldBox().w / 2;
  const fy = hero.worldBox().y + hero.worldBox().h; // feet (for physics checks)
  const cy = hero.worldBox().y + hero.worldBox().h * 0.5; // center (for trail)
  ride.path.push({ x: cx, y: cy });
  if (ride.path.length > TRAIL_MAX) ride.path.shift();

  recordTraceFrame(inp, res, cx, fy);

  // Visit tracking (any surface touched counts for the visited readout).
  for (const l of world.landings) {
    if (cx >= l.x0 && cx <= l.x1 && Math.abs(l.y - fy) <= 4) {
      if (!ride._visitedSet) ride._visitedSet = new Set();
      ride._visitedSet.add(l.index);
      ride.visited = ride._visitedSet.size;
    }
  }

  // Goal-landing tracking (smart mover): when the hero is grounded ON the
  // current goal surface, mark it landed, flash green, and advance.
  if (ride.goal && hero.grounded) {
    const g = ride.goal;
    if (cx >= g.x0 - 6 && cx <= g.x1 + 6 && Math.abs(g.y - fy) <= 6) {
      ride.landedSet.add(g.index);
      ride._lastLandedIdx = g.index;
      ride._landFlash = 30; // ~0.5 s green flash
      advanceGoal();
    }
  }
  if (ride._landFlash > 0) ride._landFlash--;

  // Reaching the authored macro endpoint concludes test mode immediately.
  const atExit = world.vertical
    ? (world.H - fy) >= world.macroEndPx
    : cx >= world.macroEndPx;
  if (atExit) {
    _commitClearance();
    showToast('CLEARED ✓ — proof saved to draft', 'success');
    if (ride.trace) dumpTrace('cleared');
    stopRide();
    return;
  }

  // Fell out → retry forever (respawn at entry). Vary super by attempt parity.
  if (fy > world.H + world.UY * 2 || cx < -world.UX * 2 || cx > world.W + world.UX * 2) {
    ride.attempts++;
    respawn();
    updateRideHint();
  }
}

/** Smart-mover input driver (task 4): asks predictFrame for the buttons to
 *  press THIS frame to reach the current goal. When all goals are landed
 *  (ride.goal === null), just run toward the exit. */
function rideInput(){
  const { world, hero } = ride;
  const inp = { left: false, right: false, up: false, down: false, jump: false, super: false };

  if (ride.goal && ride.mem && ride.params) {
    const p = predictFrame(hero, ride.goal, world, ride.params, ride.mem);
    inp.left = p.left; inp.right = p.right; inp.up = p.up;
    inp.down = p.down; inp.jump = p.jump; inp.super = p.super;
  } else {
    // No goal left (all landed or no surfaces): run to the exit.
    if (world.vertical) {
      const cx = hero.worldBox().x + hero.worldBox().w / 2;
      if (cx < world.W / 2 - 6) inp.right = true;
      else if (cx > world.W / 2 + 6) inp.left = true;
    } else {
      inp.right = true;
    }
  }
  inp.onOneWay = !!ride._onOneWay;
  return inp;
}

function respawn(){
  const { world, hero } = ride;
  hero.x = world.entry.x - 8;
  hero.y = world.entry.y - 40;
  hero.vx = 0; hero.vy = 0;
  hero.grounded = false;
  hero.jumpsUsed = 0;
  hero.supermoveActive = false;
  hero.supermoveMeter = hero.SUPERMOVE_MAX;
  ride.path = [];
  ride._superUsed = false;
  ride._onOneWay = false;

  // Vary the approach each retry so it isn't the identical jump forever:
  // even attempts prefer the supermove burst at the wall.
  ride._preferSuper = (ride.attempts % 2 === 0);
  // Reset per-hop mover memory; keep landedSet (surfaces already proven).
  if (ride.mem) {
    ride.mem.wantJump = false;
    ride.mem.djDone = false;
    ride.mem.armSuper = false;
    ride.mem.superFired = false;
    ride.mem._releasedAtApex = false;
  }
}

function restartLap(){
  ride.lap++;
  ride._clearPause = 0;
  ride.status = 'running';
  respawn();
  updateRideHint();
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
    hero: 'balthazar',
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
  t.result = { status: ride.status, attempts: ride.attempts, failPoint: ride.failPoint, visited: ride.visited, totalLandings: ride.totalLandings };
  // Save via browser download → lands in ~/Downloads (same as the game's dumps).
  // No server round-trip: nothing to hang, works even if the editor server is down.
  const name = `petal-panic-macrotrace-${Date.now()}.json`;
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
  if (!el || !ride.active) return;
  if (ride.status === 'running') {
    const goalTxt = ride.goal
      ? `aiming ${ride.goal.kind}#${ride.goal.index}`
      : 'all landed → exit';
    el.textContent = `ride: ${goalTxt} · landed ${ride.landedSet?.size ?? 0}/${ride.totalLandings} · try ${ride.attempts}${ride.trace ? ` · REC ${ride.trace.frames.length}` : ''}`;
  }
  else if (ride.status === 'cleared') el.textContent = `ride: CLEARED · lap ${ride.lap}`;
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
  // Current goal: cyan line across the target surface.
  if (ride.goal) {
    const g = ride.goal;
    const [gx0, gy0] = toScreen(g.x0, g.y);
    const [gx1, gy1] = toScreen(g.x1, g.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(0,229,255,.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(gx0, gy0);
    ctx.lineTo(gx1, gy1);
    ctx.stroke();
    ctx.setLineDash([]);
    // Cyan dot at the goal center.
    ctx.fillStyle = 'rgba(0,229,255,.9)';
    ctx.beginPath();
    ctx.arc((gx0 + gx1) / 2, gy0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Landed surfaces: green flash (brief) then a faint green tick.
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
