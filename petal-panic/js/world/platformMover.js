// platformMover — smart movement brain for the macro editor ghost (and, later,
// enemy AI). Given a headless hero and a goal surface, it produces the BUTTON
// INPUTS ({left,right,up,down,jump,super}) needed to travel there and LAND ON
// it, verified by real simulation via stepHeadless. It never writes hero.x/y/
// vx/vy directly — the engine integrates; the mover only decides buttons.
//
// Architecture: PREDICT (closed-form plan) → EXECUTE (stepHeadless sim) →
// CORRECT (re-predict on drift). Works identically for horizontal and vertical
// macros (the goal is just a target surface; the axis comes from world.vertical).
// All movement stats are injected via `params`, so the same module drives the
// Balthazar ghost now and weaker/stronger enemies later.
//
// Pure logic: importable from Node tests and the browser editor. Zero DOM.

import { doubleJumpReachForStats, superAssistReachForStats } from './macros.js';
import { stepHeadless } from '../hero/headless.js';
import { GRAVITY } from '../consts.js';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Geometry helpers (screen px, y DOWN — same as buildRideWorld / game runtime)
// ---------------------------------------------------------------------------

/** Feet position (bottom-center) of the hero's collision box. */
export function feetPos(hero){
  const wb = hero.worldBox();
  return { x: wb.x + wb.w / 2, y: wb.y + wb.h };
}

/** Horizontal distance from a point x to the nearest edge of [x0,x1]. */
function distToSpan(x, x0, x1){
  if (x < x0) return x0 - x;
  if (x > x1) return x - x1;
  return 0; // already over the span
}

/** True when the hero's feet are resting on the goal surface. */
function isOnGoal(hero, goal, world, tol = 6){
  const f = feetPos(hero);
  if (!hero.grounded) return false;
  if (f.x < goal.x0 - tol || f.x > goal.x1 + tol) return false;
  return Math.abs(f.y - goal.y) <= tol;
}

/** Signed rise from current feet to the goal top (positive = goal higher). */
function riseTo(hero, goal){
  const f = feetPos(hero);
  return f.y - goal.y; // y down: goal above ⇒ goal.y smaller ⇒ positive rise
}

// ---------------------------------------------------------------------------
// PREDICT — closed-form plan for one hop from current state to the goal.
// Returns a coarse input hint; the execute/correct loop refines it live.
// ---------------------------------------------------------------------------

/**
 * Decide the raw intent for this frame given current hero state + goal.
 * This is the "brain": it looks at where the hero is vs. the goal and emits
 * which buttons to press THIS frame. The caller (stepAndCorrect) feeds the
 * result into stepHeadless and re-calls this every frame, so prediction is
 * continuously re-evaluated against reality (that IS the correct-on-drift).
 *
 * @returns {{left,right,up,down,jump,super}}
 */
export function predictFrame(hero, goal, world, params, mem){
  const f = feetPos(hero);
  const inp = { left: false, right: false, up: false, down: false, jump: false, super: false };
  const rise = riseTo(hero, goal);          // >0 goal higher, <0 goal lower
  const gapX = distToSpan(f.x, goal.x0, goal.x1);
  const goalCenterX = (goal.x0 + goal.x1) / 2;
  const dx = goalCenterX - f.x;              // >0 goal is to the right

  // If we just landed (grounded) but are still holding jump from the previous
  // goal, release for one frame to create a fresh press edge for the next jump.
  if (hero.grounded && mem.wantJump) {
    mem.wantJump = false;
    return inp;
  }

  if (world.vertical) return predictVertical(hero, goal, world, params, mem, inp, f, rise, dx);
  return predictHorizontal(hero, goal, world, params, mem, inp, f, rise, gapX, dx);
}

function predictHorizontal(hero, goal, world, params, mem, inp, f, rise, gapX, dx){
  // Already standing on the goal? Done (caller checks isOnGoal).
  // Face + move toward the goal center.
  if (dx > 4) inp.right = true;
  else if (dx < -4) inp.left = true;

  const UY = world.UY;
  // Effective rise to stand ON the goal top, with landing tolerance. The raw
  // spawn→goal rise overstates the climb (hero spawns with feet below groundY),
  // so compare against the apex with margin rather than a hard envelope cut.
  const secondJump = (params.doubleJumpFactor ?? 0.85) * params.jump;
  const totalApex = (params.jump * params.jump) / (2 * GRAVITY) +
                    (secondJump * secondJump) / (2 * GRAVITY);
  // Only spend super when the rise is genuinely beyond the double-jump apex.
  // (A rise within the apex is a normal double-jump clear — no super needed.)
  const needsSuper = params.canSuper && rise > totalApex + world.UY * 0.5;

  // --- Grounded decisions -------------------------------------------------
  if (hero.grounded) {
    // Drop-through: goal is a lower surface directly below a one-way platform.
    if (rise < -UY * 0.5 && ride_onOneWay(hero, world)) {
      inp.down = true;
      inp.jump = true; // down+jump drops through a one-way platform
      return inp;
    }

    // Climb onto a higher goal: JUMP at the exact takeoff distance computed
    // from the obstacle's rise and the hero's real stats. This launches the
    // arc early enough (with run-up) that the hero is still above the target
    // height while crossing the obstacle — no fuzzy windows, no clipping.
    if (rise > UY * 0.4) {
      const takeoff = takeoffDistanceForRise(params, rise);
      if (takeoff > 0 && gapX <= takeoff) {
        inp.jump = true;
        mem.wantJump = true;
        // Super only if the rise is beyond even the double-jump apex.
        if (needsSuper) mem.armSuper = true;
      }
      return inp;
    }

    // Same-height (or slightly lower) goal across a gap → hop across. Use the
    // FULL takeoff distance, not a tiny fixed window: at run speed the hero
    // covers ~3px/frame, so a 27px window is crossed in <10 frames and the
    // hero walks off the ledge before the jump ever triggers (observed: easy
    // PlatformHop, f110→f140). The takeoff formula with rise≈0 gives the
    // correct "jump this far before the edge" distance for a flat hop.
    if (gapX > 0 && rise <= UY * 0.4) {
      const hopDist = takeoffDistanceForRise(params, Math.max(0, rise));
      if (hopDist > 0 && gapX <= hopDist) {
        inp.jump = true;
        mem.wantJump = true;
      }
    }
    return inp;
  }

  // --- Airborne decisions -------------------------------------------------
  // Steer toward the goal center (air control exists: AIR_ACCEL in hero.js).
  if (dx > 6) inp.right = true;
  else if (dx < -6) inp.left = true;

  if (!hero.grounded) {
    const singleApex = (params.jump * params.jump) / (2 * GRAVITY);
    // needsDj is computed from the LIVE rise, which shrinks as the hero
    // climbs (and hits zero-ish when pinned against the obstacle face).
    // Once we've committed to a climb jump (wantJump set on the ground),
    // keep the DJ sequence armed for the whole hop — otherwise the branch
    // flips off mid-air and the double jump never fires.
    const djArmed = mem.wantJump && params.hasDoubleJump;
    const needsDj = djArmed || (params.hasDoubleJump && rise > singleApex);

    if (needsDj && !mem.djDone && hero.jumpsUsed === 1) {
      // Hard climb — we will double jump. Sequence that preserves BOTH full
      // first-jump height AND a fresh edge for the second press:
      //   • while ascending (vy < 0): HOLD jump → no variable-height cut
      //   • near the apex (vy >= -20): RELEASE one frame → no cut (still
      //     ascending but tiny), and it clears _prevJumpHeld so the next
      //     press is a fresh edge
      //   • the frame after: PRESS → double jump fires ~1 frame before the
      //     true apex, gaining the extra px needed for tight climbs (e.g. a
      //     2-row rise: DJ from y=425 reaches 386 < goal top 384+tol).
      const ascending = hero.vy < -20;
      if (ascending) {
        inp.jump = true;                 // hold for full first-jump height
        mem._releasedAtApex = false;
      } else if (!mem._releasedAtApex) {
        inp.jump = false;                // release exactly at the apex
        mem._releasedAtApex = true;
      } else {
        inp.jump = true;                 // fresh press → double jump
        mem.djDone = true;
      }
    } else if (mem.wantJump && hero.vy < 0) {
      // Easy hop (or no DJ available): HOLD the jump through the whole ascent
      // for full height. This is what keeps a single jump from being cut to 45%.
      inp.jump = true;
    } else {
      inp.jump = false;
    }
  }

  // Super: armed by a grounded "needs super" decision, fire near the second
  // apex (when rising has nearly stopped) to convert the arc into a burst.
  if (mem.armSuper && params.canSuper && !hero.supermoveActive) {
    const nearApex = hero.vy > -params.jump * 0.85 * 0.3;
    if (nearApex) {
      inp.super = true;
      mem.superFired = true;
      mem.armSuper = false;
    }
  }

  return inp;
}

/** Unit cell width in px (world carries UX). */
function UX_local(world){ return world.UX; }

// ---------------------------------------------------------------------------
// Exact takeoff geometry — replaces fuzzy "jump within N px" windows.
//
// Given a rise `risePx` to clear and the hero's real stats, compute the
// horizontal distance BEFORE the obstacle face at which to launch the jump so
// the arc is still at/above the target height while crossing the obstacle.
// This is per-obstacle and uses the current sprite's actual jump/speed, so the
// brain kicks the jump at the physically-correct spot instead of guessing.
// ---------------------------------------------------------------------------

/**
 * Distance from the obstacle face at which to start the jump so the double-
 * jump apex lands over (or just past) the face. Returns -1 if even a full
 * double jump can't reach the rise.
 *
 * Model: the first jump takes tA1 = jump/G to reach its apex; the double jump
 * fires ~1 frame later and adds v0d upward, reaching the combined apex after
 * another v0d/G. So the apex is ~tA1 + v0d/G after takeoff. We want that apex
 * to occur AT or slightly PAST the face, so we take off (tA1 + v0d/G) * speed
 * px before the face — minus a small margin so we're not jumping on top of
 * the wall. This is MUCH tighter than the old "full airtime" formula, which
 * launched the hero so early he drifted into the wall face while still rising
 * and got pinned, killing the climb.
 */
export function takeoffDistanceForRise(params, risePx){
  const G = GRAVITY;
  const { speed, jump } = params;
  const v0d = (params.doubleJumpFactor ?? 0.85) * jump;
  const apex1 = (jump * jump) / (2 * G);
  const totalApex = apex1 + (v0d * v0d) / (2 * G);
  if (risePx > totalApex) return -1; // can't reach even with double jump

  // Time from takeoff to combined apex (first-jump ascent + DJ ascent).
  const tToApex = jump / G + v0d / G;
  // Take off this far before the face. Subtract a margin so the hero is
  // CLOSE to the wall when the arc peaks over it — jumping too early lets
  // the hero drift into the wall face while still rising and get pinned.
  // ~40px before the face works for Balthazar's stats (verified by trace);
  // scale with speed so other param sets stay proportional.
  const dist = speed * tToApex;
  const margin = Math.min(dist - 12, speed * 0.22);
  return Math.max(12, dist - margin);
}

function predictVertical(hero, goal, world, params, mem, inp, f, rise, dx){
  // Vertical: traverse upward (-y). "Forward" is up-bias; land on tops.
  // Center-x alignment first.
  if (dx > 4) inp.right = true;
  else if (dx < -4) inp.left = true;

  if (hero.grounded) {
    if (rise > 0) {
      // Goal is above: jump (double) to climb. Super if beyond double reach.
      const djReach = doubleJumpReachForStats(params, rise);
      const fullReach = superAssistReachForStats(params, rise);
      inp.jump = true;
      mem.wantJump = true;
      if (rise > djReach && rise <= fullReach && params.canSuper) mem.armSuper = true;
    }
    return inp;
  }
  // Airborne: same hold/release/fresh-press sequence as horizontal. Holding
  // the first jump keeps its full height; releasing one frame near the apex
  // creates the fresh edge the engine requires for the double jump. (The old
  // code pressed jump every airborne frame, which never released → the DJ
  // edge never existed → the hero bounced in place forever.)
  const singleApex = (params.jump * params.jump) / (2 * GRAVITY);
  const needsDj = (mem.wantJump && params.hasDoubleJump) ||
                  (params.hasDoubleJump && rise > singleApex);
  if (needsDj && !mem.djDone && hero.jumpsUsed === 1) {
    const ascending = hero.vy < -20;
    if (ascending) {
      inp.jump = true;
      mem._releasedAtApex = false;
    } else if (!mem._releasedAtApex) {
      inp.jump = false;
      mem._releasedAtApex = true;
    } else {
      inp.jump = true;
      mem.djDone = true;
    }
  } else if (mem.wantJump && hero.vy < 0) {
    inp.jump = true; // easy hop: hold through ascent for full height
  } else {
    inp.jump = false;
  }
  if (mem.armSuper && params.canSuper && !hero.supermoveActive && hero.vy > -params.jump * 0.85 * 0.25) {
    inp.super = true;
    mem.superFired = true;
    mem.armSuper = false;
  }
  return inp;
}

/** Is the hero currently standing on a one-way platform (for drop-through)? */
function ride_onOneWay(hero, world){
  const f = feetPos(hero);
  for (const s of world.solids) {
    if (!s.oneWay) continue;
    if (f.x < s.x || f.x > s.x + s.w) continue;
    const gap = s.y - f.y;
    if (gap >= -2 && gap <= 4) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// EXECUTE + CORRECT — simulate the hop frame by frame, re-predicting each
// frame (predictFrame reads live hero state, so correction is implicit).
// ---------------------------------------------------------------------------

/**
 * Drive the hero from its current state until it lands on `goal` (or gives up).
 * Pure: mutates only the passed hero (via stepHeadless) and returns a report.
 *
 * @param {object} hero      headless hero (mutated in place)
 * @param {object} goal      target landing {x0,x1,y,index,kind} or exit-like
 * @param {object} world     buildRideWorld output
 * @param {object} params    injected movement stats
 * @param {object} [opts]    { dt, maxFrames, recordInputs, onFrame }
 * @returns {{landed:boolean, frames:number, reason:string, path:Array, inputs?:Array}}
 */
export function stepAndCorrect(hero, goal, world, params, opts = {}){
  const dt = opts.dt ?? DT;
  const maxFrames = opts.maxFrames ?? 60 * 20; // 20 s per hop — runaway guard
  const record = !!opts.recordInputs;
  const path = [];
  const inputs = record ? [] : null;

  // Per-hop memory (reset each call): tracks jump/super intent across frames.
  const mem = { wantJump: false, djDone: false, armSuper: false, superFired: false, jumpPhase: null, _heldPrevFrame: false, _releasedAtApex: false };

  let lastSafe = { ...feetPos(hero) };
  let lastSafeFrame = 0;

  for (let i = 0; i < maxFrames; i++) {
    const inp = predictFrame(hero, goal, world, params, mem);
    inp.onOneWay = ride_onOneWay(hero, world);
    if (record) inputs.push({ left: inp.left, right: inp.right, up: inp.up, down: inp.down, jump: inp.jump, super: inp.super });

    stepHeadless(hero, dt, inp, world.solids);
    const f = feetPos(hero);
    path.push({ x: +f.x.toFixed(2), y: +f.y.toFixed(2) });
    if (opts.onFrame) opts.onFrame(i, f, inp);

    // Landed on the goal?
    if (isOnGoal(hero, goal, world)) {
      return { landed: true, frames: i + 1, reason: 'landed', path, inputs };
    }

    // Track last safe grounded position (for a recoverable backtrack).
    if (hero.grounded) { lastSafe = { ...f }; lastSafeFrame = i; }

    // Fell out of the world → miss.
    if (f.y > world.H + world.UY * 2 || f.x < -world.UX * 2 || f.x > world.W + world.UX * 2) {
      return { landed: false, frames: i + 1, reason: 'fell', path, inputs, safeX: lastSafe.x, safeY: lastSafe.y };
    }
  }
  return { landed: false, frames: maxFrames, reason: 'timeout', path, inputs };
}

// ---------------------------------------------------------------------------
// PUBLIC API — moveToward: try the hop; on a recoverable miss, backtrack to
// the last safe edge and retry (bounded). Give up only when the goal is
// envelope-unreachable (matches the validator BFS verdict).
// ---------------------------------------------------------------------------

/**
 * Move the hero to `goal`, retrying from the last safe position on a miss.
 * Only returns 'unreachable' when the reach envelope says no arc can reach the
 * goal (so it never mashes forever on a genuinely impossible surface).
 *
 * @returns {{landed:boolean, reason:string, attempts:number, path:Array, inputs?:Array}}
 */
export function moveToward(hero, goal, world, params, opts = {}){
  const maxAttempts = opts.maxAttempts ?? 4;
  const dt = opts.dt ?? DT;

  // Envelope pre-check: only short-circuit on rises CLEARLY beyond even the
  // super-assisted apex (with margin). Borderline rises go to the simulator —
  // the sim is the source of truth, and the raw spawn→goal rise can overstate
  // the effective climb (the hero spawns with feet below groundY). This keeps
  // us from mashing forever on genuinely impossible surfaces while never
  // falsely rejecting a climb the sim could actually make.
  const rise = riseTo(hero, goal);
  const secondJump = (params.doubleJumpFactor ?? 0.85) * params.jump;
  const totalApex = (params.jump * params.jump) / (2 * GRAVITY) +
                    (secondJump * secondJump) / (2 * GRAVITY);
  if (rise > totalApex + world.UY * 0.5) {
    return { landed: false, reason: 'unreachable', attempts: 0, path: [], inputs: null };
  }

  let bestPath = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = stepAndCorrect(hero, goal, world, params, { ...opts, dt });
    bestPath = res.path.length > bestPath.length ? res.path : bestPath;

    if (res.landed) {
      return { landed: true, reason: 'landed', attempts: attempt, path: res.path, inputs: res.inputs };
    }
    if (res.reason === 'unreachable') {
      return { landed: false, reason: 'unreachable', attempts: attempt, path: bestPath, inputs: res.inputs };
    }

    // Recoverable miss (fell / timeout): reset the hero to the last safe
    // grounded spot and vary the approach (prefer super on even attempts),
    // then retry. If we have no safe spot, we can't recover → stop.
    if (res.safeX == null) break;
    respawnAt(hero, res.safeX, res.safeY, world, params);
    // Nudge the next attempt: alternate super preference so retries differ.
    params._preferSuper = attempt % 2 === 0;
  }

  return { landed: false, reason: 'failed', attempts: maxAttempts, path: bestPath, inputs: null };
}

/** Reset hero to a standing pose at a given feet position (retry recovery). */
function respawnAt(hero, x, y, world, params){
  const wb = hero.worldBox();
  hero.x = x - wb.w / 2 - hero.box.ox;
  hero.y = y - wb.h - hero.box.oy;
  hero.vx = 0; hero.vy = 0;
  hero.grounded = true;
  hero.jumpsUsed = 0;
  hero.supermoveActive = false;
  hero.supermoveMeter = hero.SUPERMOVE_MAX;
  hero.droppingThrough = false;
}
