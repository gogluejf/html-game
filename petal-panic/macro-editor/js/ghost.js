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

// Edge-triggered jump state: the engine only fires a jump on a FRESH press
// (input.jump && !prevJumpHeld). We must release between jumps or the second
// press is ignored — this is what caused the "holds jump in place" bug.
let _jumpWasDown = false;

// Ride state (editor-local; never touches app.cur.st).
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
};

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
  });
  _jumpWasDown = false;
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

  // Visit tracking.
  for (const l of world.landings) {
    if (cx >= l.x0 && cx <= l.x1 && Math.abs(l.y - fy) <= 4) {
      if (!ride._visitedSet) ride._visitedSet = new Set();
      ride._visitedSet.add(l.index);
      ride.visited = ride._visitedSet.size;
    }
  }

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

function rideInput(){
  const { world, hero } = ride;
  const stats = HEROES.balthazar.stats;
  const cx = hero.worldBox().x + hero.worldBox().w / 2;
  const fy = hero.worldBox().y + hero.worldBox().h;
  const inp = { left: false, right: false, jump: false, down: false, super: false, onOneWay: !!ride._onOneWay };
  let wantJump = false;

  if (world.vertical) {
    const targetX = world.W / 2;
    if (cx < targetX - 6) inp.right = true;
    else if (cx > targetX + 6) inp.left = true;
    if (hero.grounded) {
      // Nearest platform above with overlapping x-range.
      let nextAbove = null;
      for (const l of world.landings) {
        if (l.y >= fy - 4) continue;
        if (l.x1 < cx - world.UX * 1.5 || l.x0 > cx + world.UX * 1.5) continue;
        if (!nextAbove || l.y > nextAbove.y) nextAbove = l;
      }
      if (nextAbove) {
        const rise = fy - nextAbove.y;
        const djApex = doubleJumpApex(stats);
        if (rise <= djApex * 0.9) wantJump = true;
        else if (!ride._superUsed && rise <= djApex * 1.3) { inp.super = true; ride._superUsed = true; }
      }
    }
  } else {
    inp.right = true;
    if (hero.grounded) {
      // Wall directly ahead?
      const wall = findWall(world, cx, fy);
      if (wall) {
        const climb = fy - wall.y;
        const djApex = doubleJumpApex(stats);
        if (climb > 0 && climb <= djApex * 0.95) {
          // Low enough to clear with a jump: hop over it.
          wantJump = true;
        } else if (climb > 0 && climb <= djApex * 1.5 && (!ride._superUsed || ride._preferSuper)) {
          // Needs the supermove burst to vault (or this retry prefers it).
          inp.super = true;
          ride._superUsed = true;
        } else {
          // Too tall to vault head-on in one clean arc. Don't give up and don't
          // stop — keep trying: jump (double jump) AND fire the supermove burst
          // to push through. A human would mash jump + super here; we do the
          // same, every frame, until it gets over or the user kills the ride.
          wantJump = true;
          if (!ride._superUsed || ride._preferSuper) {
            inp.super = true;
            ride._superUsed = true;
          }
        }
      } else {
        // Seek a higher landing ahead.
        let target = null;
        for (const l of world.landings) {
          if (l.x0 < cx - world.UX * 0.5) continue;
          if (l.x0 > cx + 14 * world.UX) continue;
          const rise = fy - l.y;
          if (rise < world.UY * 0.3) continue;
          if (rise > doubleJumpApex(stats) * 0.92) continue;
          if (!target || l.x0 < target.x0) target = l;
        }
        if (target) {
          const dist = target.x0 - cx;
          if (dist <= world.UX * 1.0) wantJump = true;
        }
      }
    }
    // Double jump when rising slows.
    if (!hero.grounded && hero.jumpsUsed === 1 && hero.vy > -stats.jump * 0.85 * 0.3) wantJump = true;
    // Drop-through.
    if (hero.grounded && ride._onOneWay) {
      const below = world.landings.find(l => l.kind === 'platform' && l.x0 <= cx && l.x1 >= cx && l.y > fy + world.UY * 0.8);
      if (below) { inp.down = true; wantJump = true; }
    }
  }

  // Convert "want to jump" into a proper jump sequence: PRESS on the trigger
  // frame, then HOLD while ascending (vy < 0) so variable-jump-height doesn't
  // cut the arc to 45%. Release once we start falling (vy >= 0) or land.
  if (wantJump && !_jumpWasDown) {
    inp.jump = true;
    _jumpWasDown = true;
  } else if (_jumpWasDown && hero.vy < 0) {
    // Still ascending: keep holding for full height.
    inp.jump = true;
  } else {
    inp.jump = false;
    _jumpWasDown = false;
  }
  return inp;
}

function findWall(world, cx, fy){
  const noseX = cx + 18;
  let best = null;
  for (const s of world.solids) {
    if (s.oneWay) continue;
    if (s.x > noseX - 4 && s.x < noseX + 24) {
      if (s.y + s.h > fy - 4 && s.y < fy + world.UY * 0.5) {
        if (!best || s.x < best.x) best = s;
      }
    }
  }
  return best;
}

function doubleJumpApex(stats){
  const G = 1500; // GRAVITY from consts (avoid extra import churn)
  const first = (stats.jump * stats.jump) / (2 * G);
  const second = 0.85 * stats.jump;
  return first + (second * second) / (2 * G);
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
  _jumpWasDown = false;
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
  if (ride.status === 'running') el.textContent = `ride: running · try ${ride.attempts} · visited ${ride.visited}/${ride.totalLandings}${ride.trace ? ` · REC ${ride.trace.frames.length}` : ''}`;
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
