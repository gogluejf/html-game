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

const DT = 1 / 60;
const TRAIL_MAX = 900; // ~15 s of trail points at 30 Hz

// Ride state (editor-local; never touches app.cur.st).
export const ride = {
  active: false,
  world: null,
  hero: null,
  path: [],          // trail points in world px {x,y}
  status: '',        // 'running' | 'cleared' | 'failed'
  failPoint: null,
  attempts: 0,
  visited: 0,
  totalLandings: 0,
  lap: 0,
  _raf: 0,
  _last: 0,
  _acc: 0,
  _clearPause: 0,
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
  $('testRideBtn')?.classList.add('armed');
  updateRideHint();
  ride._raf = requestAnimationFrame(tick);
}

/** Kill the ride, clear the trail, unlock editing. */
export function stopRide(redraw = true){
  ride.active = false;
  if (ride._raf) cancelAnimationFrame(ride._raf);
  ride._raf = 0;
  ride.hero = null;
  ride.world = null;
  ride.path = [];
  ride.status = '';
  ride.failPoint = null;
  $('testRideBtn')?.classList.remove('armed');
  updateRideHint();
  if (redraw) requestAnimationFrame(() => draw()); // defer: draw.js may not be evaluated yet at import time
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
    draw();
    return;
  }

  ride._acc += frame;
  let guard = 0;
  while (ride._acc >= DT && guard < 8) {
    stepOnce(DT);
    ride._acc -= DT;
    guard++;
  }
  draw();
}

function stepOnce(dt){
  const { world, hero } = ride;
  const inp = rideInput();
  const res = stepHeadless(hero, dt, inp, world.solids);
  ride._onOneWay = res.onOneWay;

  const cx = hero.worldBox().x + hero.worldBox().w / 2;
  const fy = hero.worldBox().y + hero.worldBox().h;
  ride.path.push({ x: cx, y: fy });
  if (ride.path.length > TRAIL_MAX) ride.path.shift();

  // Visit tracking.
  for (const l of world.landings) {
    if (cx >= l.x0 && cx <= l.x1 && Math.abs(l.y - fy) <= 4) {
      if (!ride._visitedSet) ride._visitedSet = new Set();
      ride._visitedSet.add(l.index);
      ride.visited = ride._visitedSet.size;
    }
  }

  // Exit reached → cleared: pause briefly, then loop.
  const atExit = world.vertical ? fy <= world.UY * 1.5 : cx >= world.W - 4;
  if (atExit) {
    ride.status = 'cleared';
    ride._clearPause = 0.35;
    showToast(`CLEARED ✓  (lap ${ride.lap}, visited ${ride.visited}/${ride.totalLandings})`, 'success');
    updateRideHint();
    return;
  }

  // Fell out → smart retry (respawn at entry for v1; rider core keeps its own
  // checkpoint logic for the headless batch runs).
  if (fy > world.H + world.UY * 2 || cx < -world.UX * 2 || cx > world.W + world.UX * 2) {
    ride.attempts++;
    if (ride.attempts > 8) {
      ride.status = 'failed';
      ride.failPoint = { x: cx, y: world.groundY, reason: 'fell' };
      showToast(`ride failed after ${ride.attempts - 1} attempts — fell`, 'error');
      updateRideHint();
      return; // keep the fail marker visible; user edits or presses TEST
    }
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
        if (rise <= djApex * 0.9) inp.jump = true;
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
        if (climb > 0 && climb <= djApex * 0.95) inp.jump = true;
        else if (climb > 0 && climb <= djApex * 1.5 && !ride._superUsed) { inp.super = true; ride._superUsed = true; }
        else inp.jump = true; // vault attempt
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
          if (dist <= world.UX * 1.0) inp.jump = true;
        }
      }
    }
    // Double jump when rising slows.
    if (!hero.grounded && hero.jumpsUsed === 1 && hero.vy > -stats.jump * 0.85 * 0.3) inp.jump = true;
    // Drop-through.
    if (hero.grounded && ride._onOneWay) {
      const below = world.landings.find(l => l.kind === 'platform' && l.x0 <= cx && l.x1 >= cx && l.y > fy + world.UY * 0.8);
      if (below) { inp.down = true; inp.jump = true; }
    }
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
}

function restartLap(){
  ride.lap++;
  ride._clearPause = 0;
  ride.status = 'running';
  respawn();
  updateRideHint();
}

// ---------------------------------------------------------------------------
// Status hint (shared element with validation messages).
// ---------------------------------------------------------------------------

function updateRideHint(){
  const el = document.getElementById('validationHint');
  if (!el || !ride.active) return;
  if (ride.status === 'running') el.textContent = `ride: running · lap ${ride.lap} · visited ${ride.visited}/${ride.totalLandings}`;
  else if (ride.status === 'cleared') el.textContent = `ride: CLEARED · lap ${ride.lap}`;
  else if (ride.status === 'failed') el.textContent = `ride: FAILED — ${ride.failPoint?.reason ?? 'stuck'} (press TEST to retry)`;
  el.classList.toggle('on', !!el.textContent);
  el.classList.toggle('warning', ride.status === 'failed');
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

  // Trail: pale gray dots.
  ctx.save();
  ctx.fillStyle = 'rgba(170,180,200,.28)';
  for (let i = 0; i < ride.path.length; i += 3) {
    const p = ride.path[i];
    const [sx, sy] = toScreen(p.x, p.y);
    ctx.beginPath();
    ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
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
