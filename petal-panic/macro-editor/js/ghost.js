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
    stopRide();
    return;
  }

  // Genuine dead-end: no vaultable wall and no approach surface. Fail cleanly
  // with a clear reason instead of looping or spamming jumps.
  if (ride._deadEnd) {
    ride.attempts++;
    if (ride.attempts > 2) {
      ride.status = 'failed';
      ride.failPoint = { x: ride._deadEnd.x, y: ride._deadEnd.y, reason: 'unclimbable wall' };
      showToast('ride failed — unclimbable wall ahead', 'error');
      updateRideHint();
      parkHeroAt(world, hero, ride._deadEnd.x);
      return;
    }
  } else {
    ride._deadEnd = null;
  }

  // Fell out → smart retry (respawn at entry for v1).
  if (fy > world.H + world.UY * 2 || cx < -world.UX * 2 || cx > world.W + world.UX * 2) {
    ride.attempts++;
    if (ride.attempts > 8) {
      ride.status = 'failed';
      ride.failPoint = { x: Math.min(Math.max(cx, 0), world.W), y: world.groundY, reason: 'fell' };
      showToast(`ride failed after ${ride.attempts - 1} attempts — fell`, 'error');
      updateRideHint();
      // Park the hero on the floor so it stays visible at the fail point
      // instead of freezing mid-air / drifting off-screen.
      parkHeroAt(world, hero, ride.failPoint.x);
      return;
    }
    respawn();
    updateRideHint();
  }
}

/** Freeze the hero standing on the floor at a given x (fail marker pose). */
function parkHeroAt(world, hero, x){
  hero.x = x - hero.worldBox().w / 2;
  hero.y = world.groundY - hero.worldBox().h;
  hero.vx = 0; hero.vy = 0;
  hero.grounded = true;
  hero.jumpsUsed = 0;
  hero.supermoveActive = false;
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
        } else if (climb > 0 && climb <= djApex * 1.5 && !ride._superUsed) {
          // Needs the supermove burst to vault.
          inp.super = true;
          ride._superUsed = true;
        } else {
          // Too tall to vault head-on. Do NOT spam jumps (that's the "stupid
          // jump in place" bug). Look for a legitimate approach: a platform or
          // lower block top we can stand on just before the wall. If none is
          // reachable, we're at a genuine dead-end — stop and report it.
          const approach = findApproachSurface(world, cx, fy, wall);
          if (approach) {
            // Move toward/onto the approach surface, then jump from there.
            const distToApproach = approach.x0 - cx;
            if (distToApproach < world.UX * 1.2) wantJump = true;
          } else {
            ride._deadEnd = { x: cx, y: fy };
            // Hold position (no input) so the hero waits at the dead-end.
            inp.right = false;
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

/** Find a standable surface just before a wall that we could use to approach it. */
function findApproachSurface(world, cx, fy, wall){
  // Look for a landing whose top is higher than current feet and whose right
  // edge is near the wall's left face (so we can jump from it over the wall).
  let best = null;
  for (const l of world.landings) {
    if (l.x1 > wall.x - 4 || l.x1 < wall.x - world.UX * 3) continue; // must end near wall
    if (l.y >= fy - 4) continue; // must be higher than where we stand
    if (!best || l.x1 > best.x1) best = l;
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
  ride._deadEnd = null;
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
