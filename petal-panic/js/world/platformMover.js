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
  // ALSO reset djDone: a double jump spent on a FAILED hop must not poison the
  // next attempt — otherwise needsDj goes false forever and every retry is a
  // single jump that can't reach the goal (the classic L/R-flicker-under-goal
  // stall seen in easyPlatformHop / platformHops / gapLanding / pyramid3).
  if (hero.grounded && mem.wantJump) {
    mem.wantJump = false;
    mem.djDone = false;      // fresh DJ budget for the next hop
    mem._releasedAtApex = false;
    mem.vaultRise = null;   // clear any captured obstacle rise from the last vault
    return inp;
  }

  if (world.vertical) return predictVertical(hero, goal, world, params, mem, inp, f, rise, dx);
  return predictHorizontal(hero, goal, world, params, mem, inp, f, rise, gapX, dx);
}

/** Is there solid ground N px ahead at foot level? Only checks one-way platforms. */
function hasGroundAhead(hero, world, distPx){
  const f = feetPos(hero);
  const probeX = f.x + distPx;
  const probeY = f.y;
  for (const s of world.solids) {
    if (!s.oneWay) continue;
    if (probeX >= s.x && probeX <= s.x + s.w && probeY >= s.y - 4 && probeY <= s.y + s.h + 4) {
      return true;
    }
  }
  return false;
}

/** Is there SOLID terrain (blocks/floor) supporting the hero N px ahead?
 *  Used to detect the edge of a solid surface: if nothing solid sits under
 *  the probe point at/below foot level, walking that direction means falling
 *  off — time to jump. Ignores one-way platforms (those are handled by
 *  hasGroundAhead) and anything far below (we only care about the surface
 *  we're standing on ending). */
function hasSolidAhead(hero, world, distPx){
  const f = feetPos(hero);
  const probeX = f.x + distPx;
  for (const s of world.solids) {
    if (s.oneWay) continue;
    if (probeX < s.x || probeX > s.x + s.w) continue;
    // Solid top must be near our foot level (within one cell below): this is
    // the surface continuing ahead, not some deep floor far underneath.
    if (s.y >= f.y - 4 && s.y <= f.y + world.UY) return true;
  }
  return false;
}

/** Single-jump apex height (px) for the given stats. */
function singleApexPx(params){
  return (params.jump * params.jump) / (2 * GRAVITY);
}

// ---------------------------------------------------------------------------
// UNIFIED TAKEOFF CLASSIFIER — one decision for every takeoff point (edge,
// coyote, wall face, under-span). Given the rise to the goal and the
// horizontal gap from the takeoff spot to the goal span, answer: what does
// this hop need?
//
//   jump     — single jump clears it (easy hop / low lip)
//   dj       — jump + double jump (rise above single apex, gap within carry)
//   super    — jump + super dash (gap too wide for a DJ arc to carry; the
//              dash is horizontal, so rise only needs to be survivable)
//   retreat  — unreachable FROM HERE (rise beyond total DJ apex AND no
//              useful gap dash): walk back toward the approach edge and let
//              the next takeoff re-classify. NOT "unreachable period" — that
//              verdict belongs to the BFS envelope (traversalRoute), not here.
// ---------------------------------------------------------------------------

/** Horizontal distance from x to the goal span's near edge along `dir`. */
function gapToNearEdge(f, goal, dir){
  return dir > 0 ? Math.max(0, goal.x0 - f.x) : Math.max(0, f.x - goal.x1);
}

/** How far a jump+DJ arc carries horizontally (ascent + descent to goal top).
 *  The DJ fires when vy reaches -45 (the mover's release threshold), NOT from
 *  rest at the first apex — using the rest assumption makes the discriminant
 *  go negative for rises above the single apex and returns NaN (which then
 *  poisons the super/jump classification). */
function djCarryPxFor(params, rise){
  const G = GRAVITY;
  const v1 = params.jump;
  const v2 = (params.doubleJumpFactor ?? 0.85) * params.jump;
  const apex1 = (v1 * v1) / (2 * G);
  // The mover ALWAYS double-jumps in the airborne branch when wantJump is set
  // (mem.wantJump is armed at every committed takeoff). Sizing the carry with
  // a SINGLE-jump arc understates it badly for small rises (rise=48 → 88px
  // instead of ~330px), which makes the super gate fire on hops a plain DJ
  // arc clears easily — and the dash (intangible, vy=0 flat) then phases
  // THROUGH the platform top and the hero falls past it (newMacro #3).
  if (!params.hasDoubleJump && rise <= apex1) {
    // No DJ available: single-jump carry only.
    if (rise <= 0) return params.speed * (2 * v1 / G);
    const tUp = (v1 - Math.sqrt(Math.max(0, v1 * v1 - 2 * G * rise))) / G;
    const tDown = Math.sqrt((2 * rise) / G);
    return params.speed * (tUp + tDown);
  }
  // Full DJ arc: first jump ascends until vy = -45 (DJ fire), the DJ (impulse
  // v2) carries the remaining height, then fall to the goal top. For rises
  // below the single apex this still models the real sequence (jump held,
  // released near apex, fresh press → DJ) and yields the true ~330px carry.
  if (rise <= 0) {
    // Level or downward: up to DJ fire + DJ ascent + full fall to goal top.
    const tToFire = (v1 - 45) / G;
    const hFire = v1 * tToFire - 0.5 * G * tToFire * tToFire;
    const apexTotal = hFire + (v2 * v2) / (2 * G);
    const tDj = (v2 - Math.sqrt(Math.max(0, v2 * v2 - 2 * G * Math.max(0, -rise)))) / G;
    const tFall = Math.sqrt((2 * (apexTotal - rise)) / G);
    return params.speed * (tToFire + tDj + tFall);
  }
  const tToFire = (v1 - 45) / G;
  // Height at fire: h = v1*t - 0.5*G*t²
  const hFire = v1 * tToFire - 0.5 * G * tToFire * tToFire;
  const rem = rise - hFire;
  if (rem > (v2 * v2) / (2 * G)) return Infinity; // can't make it
  const tDj = (v2 - Math.sqrt(Math.max(0, v2 * v2 - 2 * G * rem))) / G;
  const apexTotal = hFire + (v2 * v2) / (2 * G);
  const tFall = Math.sqrt((2 * (apexTotal - rise)) / G);
  return params.speed * (tToFire + tDj + tFall);
}

/** Classify the hop needed from the current spot. See header comment. */
export function classifyTakeoff(hero, goal, world, params){
  const f = feetPos(hero);
  const rise = riseTo(hero, goal);
  const dx = (goal.x0 + goal.x1) / 2 - f.x;
  const dir = dx >= 0 ? 1 : -1;
  const secondJump = (params.doubleJumpFactor ?? 0.85) * params.jump;
  const totalApex = singleApexPx(params) + (secondJump * secondJump) / (2 * GRAVITY);

  // Beyond the total DJ apex → unreachable FROM HERE. Super does NOT help:
  // it is a pure horizontal burst (verified headless: firing it keeps vy=0,
  // it dashes along the current height and adds zero climb). Such goals need
  // a routing fix — approach from an adjacent elevated surface first.
  if (rise > totalApex + world.UY * 0.5) {
    return { plan: 'retreat', rise, gap: gapToNearEdge(f, goal, dir), dir };
  }

  // Gap only matters when measured from the EDGE we'll actually take off at.
  // Standing on continuous floor 240px before the span is NOT a gap problem —
  // we just run to the edge (the old code called this 'super' from the spawn
  // point, which made no sense). If solid/one-way ground continues under us
  // toward the goal, the effective gap is whatever remains once we reach the
  // takeoff edge ≈ the span's own overhang past that edge, i.e. small.
  const groundAhead = (dir > 0 ? hasSolidAheadOrOneWay(hero, world, 24, 1)
                               : hasSolidAheadOrOneWay(hero, world, 24, -1));
  const gap = groundAhead ? Math.min(gapToNearEdge(f, goal, dir), world.UX * 0.5)
                          : gapToNearEdge(f, goal, dir);

  // NOTE: there is deliberately NO grounded 'super' plan. Super is an AIRBORNE
  // tool — it is fired mid-arc (at the DJ frame or when still short of the
  // span), never committed from the ground. A wide gap from the ground means
  // "run to the edge, jump, and escalate in the air" — nothing else.
  if (rise > singleApexPx(params) + 4) {
    return { plan: 'dj', rise, gap, dir };
  }
  return { plan: 'jump', rise, gap, dir };
}

/** Solid OR one-way ground continuing `distPx` ahead in `dir` at foot level? */
function hasSolidAheadOrOneWay(hero, world, distPx, dir){
  const f = feetPos(hero);
  const probeX = f.x + dir * distPx;
  for (const s of world.solids) {
    if (probeX < s.x || probeX > s.x + s.w) continue;
    if (s.oneWay) {
      if (Math.abs(s.y - f.y) <= 8) return true;
    } else {
      // Wide vertical window: the hero can spawn SUNK below the surface top
      // (feet 12px under the floor line), so a tight `f.y - 4` lower bound
      // misses the very floor we're standing on (newMacro goal #0 got labeled
      // 'super' from the spawn because the floor probe failed).
      if (s.y >= f.y - world.UY && s.y <= f.y + world.UY) return true;
    }
  }
  return false;
}

/** Is there ANY ground (solid or one-way) under the space between the hero
 *  and the goal span's near edge, at or below foot level? If yes, the "gap"
 *  is approachable — run/walk across it, no super needed. Only a TRUE hole
 *  (nothing under the whole interval) justifies arming the dash. */
function groundBetween(hero, world, goal, dx){
  const f = feetPos(hero);
  const xNear = dx > 0 ? f.x : goal.x1;
  const xFar  = dx > 0 ? goal.x0 : f.x;
  // Sample every 24px across the interval.
  for (let x = xNear; x <= xFar; x += 24) {
    for (const s of world.solids) {
      if (x < s.x || x > s.x + s.w) continue;
      // Ground counts if its top is within one cell below our feet (the
      // surface we'd be walking on) — deeper floors don't help the arc.
      if (s.y >= f.y - world.UY && s.y <= f.y + world.UY * 0.5) return true;
    }
  }
  return false;
}

/** Solid wall face directly in front of the hero at body height? Returns the
 *  wall's top y (to compute the climb rise) or null. Ignores one-way platforms
 *  (you walk onto those, not over them). `dir` is the travel direction
 *  (+1 right, -1 left); a wall is only "in front" if it's on that side.
 *  Detection window is generous (~64px ≈ 20 frames at run speed) so the vault
 *  can be committed EARLY enough for the arc to clear the wall with room. */
function wallInFront(hero, world, dir){
  const f = feetPos(hero);
  let best = null;
  for (const s of world.solids) {
    if (s.oneWay) continue;
    // Wall's near face must be ahead of us along `dir`, within the window.
    const face = dir > 0 ? s.x : (s.x + s.w);
    const dist = dir > 0 ? (face - f.x) : (f.x - face);
    if (dist < 2 || dist > 120) continue;
    // Wall must overlap the hero's vertical body span (feet up to ~box height).
    const wallTop = s.y, wallBot = s.y + s.h;
    if (wallBot <= f.y - 4) continue;        // entirely above our head
    if (wallTop >= f.y) continue;           // floor / below us
    if (!best || dist < Math.abs(best.x - f.x)) best = { x: face, top: s.y, dist };
  }
  return best;
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

  // Unified takeoff plan for this spot (edge, under-span, overhead alike):
  // jump / dj / super / retreat. The old scattered rules each answered this
  // with different math, which is why fixing one macro broke another.
  const plan = classifyTakeoff(hero, goal, world, params);

  // --- Grounded decisions -------------------------------------------------
  if (hero.grounded) {
    // Drop-through: goal is a lower surface directly below a one-way platform.
    if (rise < -UY * 0.5 && ride_onOneWay(hero, world)) {
      inp.down = true;
      inp.jump = true;
      return inp;
    }

    // Simple logic: if moving toward the goal and approaching an edge, jump now.
    // No complex takeoff math — just jump at the edge and use DJ/super in air.
    // Works for BOTH one-way platforms AND solid blocks: "no ground ahead"
    // means the surface we're standing on ends within 20px (falling off a
    // block's side counts — newMacro #3: running off #1's solid edge into the
    // gap below used to skip the jump entirely because nearEdge required
    // onOneWay, so the hero fell to the floor and got stuck).
    const movingTowardGoal = (dx > 0 && inp.right) || (dx < 0 && inp.left);
    const onOneWay = ride_onOneWay(hero, world);
    const nearEdge = onOneWay ? !hasGroundAhead(hero, world, 20)
                              : !hasSolidAhead(hero, world, 20);

    if (movingTowardGoal && nearEdge) {
      inp.jump = true;
      mem.wantJump = true;
      // Arm super ONLY for a real hole: no ground between us and the goal
      // span. Measuring raw distance-to-span from the edge is wrong when we
      // approach along continuous floor (spawn → #0 in newMacro: 240px of
      // flat ground ahead is NOT a gap — run to the block's face and DJ over
      // it). A real gap means the surface we're on ends AND nothing solid or
      // one-way sits under the space between the edge and the span.
      const gapToSpan = dx > 0 ? Math.max(0, goal.x0 - f.x) : Math.max(0, f.x - goal.x1);
      if (params.canSuper && gapToSpan > djCarryPxFor(params, rise) + world.UX * 0.25
          && !groundBetween(hero, world, goal, dx)) {
        mem.armSuper = true;
      }
      return inp;
    }

    // Overhead hop: we're grounded BELOW the goal and horizontally under/near
    // its span. The goal is above us — commit a vertical climb jump (the airborne
    // branch sequences the double jump). Without this, dx flickers around the
    // goal center and the hero shuffles L/R forever without ever jumping.
    // Gate on horizontal clearance: if the goal's near edge is close ahead we
    // must take off EARLY enough that the arc lands ON the surface, not past it.
    // The classifier decides whether this spot can actually make the climb:
    // 'retreat' means rise beyond total DJ apex from here — walking toward
    // the approach edge (fall-through below) is the only way out.
    const overhead = plan.plan !== 'retreat' && rise > UY * 0.5 &&
      f.x >= goal.x0 - world.UX * 0.75 && f.x <= goal.x1 + world.UX * 0.75;
    if (overhead) {
      // Distance to the goal's near edge along the approach direction.
      const toNearEdge = dx > 0 ? (goal.x0 - f.x) : (f.x - goal.x1);
      const needClearance = rise > singleApexPx(params) ? world.UX * 0.5 : world.UX * 0.25;
      if (toNearEdge >= -world.UX * 0.25 && toNearEdge <= needClearance) {
        inp.jump = true;
        mem.wantJump = true;
        // Overhead hop: the goal is ABOVE us — DJ-stack territory, never a
        // super dash (a horizontal burst gains no height here).
        return inp;
      }
    }

    // Under-span hop: the hero has OVERRSHOT or landed short on the floor
    // directly beneath the goal span (common after a failed hop). The overhead
    // gate above excludes positions beyond ±0.75 UX from the edges, but a hero
    // standing anywhere under the span (or within one cell outside it) can
    // still reach the goal with a straight-up climb. Without this, dx flickers
    // around the goal center and no grounded branch ever commits a jump →
    // the classic L/R shuffle stall (easyPlatformHop / gapLanding /
    // platformHops / lowRepeated / newMacro / pyramid3).
    // 'retreat' from the classifier = dead end from here: fall through to the
    // default "walk toward the goal" so the hero approaches the near edge and
    // re-classifies from there (edge takeoff + DJ/super takes over).
    const underSpan = plan.plan !== 'retreat' && rise > UY * 0.5 &&
      f.x >= goal.x0 - world.UX && f.x <= goal.x1 + world.UX;
    if (underSpan) {
      inp.jump = true;
      mem.wantJump = true;
      // Under-span: goal is above — DJ-stack, never super.
      return inp;
    }

    // Wall vault: a solid block face is directly ahead in our travel direction.
    // This is GOAL-INDEPENDENT — we vault it even if it isn't the current goal
    // (e.g. crossing over an earlier block to reach a goal further along).
    const travelDir = inp.right ? 1 : inp.left ? -1 : 0;
    if (travelDir !== 0) {
      const wall = wallInFront(hero, world, travelDir);
      if (wall) {
        const climbRise = f.y - wall.top; // how high the wall top sits above our feet
        if (climbRise > UY * 0.3) {       // worth climbing (not a 1px lip)
          inp.jump = true;
          mem.wantJump = true;
          // Capture the OBSTACLE's required rise at takeoff. The airborne DJ
          // decision must use THIS (the wall height), not the live rise to the
          // goal — otherwise a higher goal keeps the live rise large and the
          // DJ re-press mis-times (fires after the apex → wasted impulse).
          mem.vaultRise = climbRise;
          // NEVER arm super for a vault: the wall height decides the jump, not
          // the goal. A super dash into the wall face pins the hero (vx huge,
          // blockedX) and kills the climb. DJ alone clears any wall ≤ ~101px.
          return inp;
        }
      }
    }

    // Retreat: this spot can't make the climb (rise beyond total DJ apex, and
    // super adds no height). Walk to the goal's NEAR EDGE and STOP there — do
    // NOT jump from a dead-end spot (that's the clown bounce). From the edge
    // the next frame re-classifies with the true gap; if it's still 'retreat'
    // the goal needs a different approach surface and the ride should report
    // it, not mash jumps into the floor.
    if (plan.plan === 'retreat') {
      const edgeX = dx > 0 ? goal.x0 : goal.x1;
      const toEdge = edgeX - f.x;
      inp.left = false; inp.right = false;
      if (Math.abs(toEdge) > 4) {
        if (toEdge > 0) inp.right = true; else inp.left = true;
      }
      return inp;
    }

    // Otherwise, keep running toward the goal.
    return inp;
  }

  // --- Airborne decisions -------------------------------------------------
  // Steer toward the goal center (air control exists: AIR_ACCEL in hero.js).
  if (dx > 6) inp.right = true;
  else if (dx < -6) inp.left = true;

  if (!hero.grounded) {
    const singleApex = (params.jump * params.jump) / (2 * GRAVITY);
    // For a wall vault, the DJ decision must key off the OBSTACLE's height
    // (captured at takeoff in mem.vaultRise), NOT the live rise to the goal —
    // a higher goal would keep the live rise large and mis-time the re-press.
    // For non-vault climbs, fall back to the live rise.
    const effectiveRise = mem.vaultRise != null ? mem.vaultRise : rise;
    const djArmed = mem.wantJump && params.hasDoubleJump;
    const needsDj = djArmed || (params.hasDoubleJump && effectiveRise > singleApex);

    if (needsDj && !mem.djDone && hero.jumpsUsed === 1) {
      // Hard climb — we will double jump. Sequence that preserves BOTH full
      // first-jump height AND a fresh edge for the second press:
      //   • while ascending (vy < -40): HOLD jump → no variable-height cut
      //   • near the apex (vy >= -40): RELEASE one frame → no cut (still
      //     ascending), and it clears _prevJumpHeld so the next press is a
      //     fresh edge
      //   • the frame after: PRESS → double jump fires ~2 frames before the
      //     true apex, gaining the extra px needed for tight climbs (e.g. a
      //     2-row rise: DJ from y=425 reaches 386 < goal top 384+tol).
      // The old threshold (-20) released AFTER the apex had already passed
      // (discrete vy steps are 25 px/frame: ...-45 → -20 → +16...), so the
      // DJ impulse landed 1–3 px too low on tight climbs and the hero bounced
      // in place forever (mixedCrossing / blockBridge / easyPlatformHop #1).
      const ascending = hero.vy < -40;
      if (ascending) {
        inp.jump = true;                 // hold for full first-jump height
        mem._releasedAtApex = false;
      } else if (!mem._releasedAtApex) {
        inp.jump = false;                // release exactly at the apex
        mem._releasedAtApex = true;
      } else {
        inp.jump = true;                 // fresh press → double jump
        mem.djDone = true;
        // ESCALATION: the DJ impulse is being committed NOW. Do NOT fire the
        // super on this same frame — the engine processes super first and
        // blocks jump input during an active supermove, so the DJ press gets
        // eaten (trace: J stayed 1, dash ran flat). Instead ARM it; the
        // armSuper block below fires it next frame once jumpsUsed === 2
        // confirms the DJ actually landed.
        if (params.canSuper && !hero.supermoveActive && !mem.superFired) {
          const shortNow = dx > 0 ? (goal.x0 - f.x) : (f.x - goal.x1);
          // Only dash when the DJ arc ALONE provably lands short of the span:
          // djCarryPxFor is the horizontal distance a jump+DJ arc covers from
          // takeoff to landing on the goal top. If shortNow <= that carry, a
          // plain DJ connects — and a super here is actively harmful (the dash
          // is intangible + vy=0 flat, so it phases THROUGH the platform top
          // and the hero falls past it: easyPlatformHop #1, newMacro #3).
          // Also require a real hole: no ground under the way AND no wall face
          // between us and the span (raw distance alone dashes into #1's face
          // on newMacro #0, pinned at x270).
          if (shortNow > djCarryPxFor(params, rise) + world.UX * 0.25
              && !groundBetween(hero, world, goal, dx)
              && !wallInFront(hero, world, dx > 0 ? 1 : -1)) {
            mem.armSuper = true;
          }
        }
      }
    } else if (mem.wantJump && hero.vy < 0) {
      // Easy hop (or no DJ available): HOLD the jump through the whole ascent
      // for full height. This is what keeps a single jump from being cut to 45%.
      inp.jump = true;
    } else {
      inp.jump = false;
    }
  }

  // Super, armed at takeoff by the classifier (wide gap): fire ONLY after the
  // double jump has actually committed (djDone && jumpsUsed === 2). Firing
  // earlier — e.g. at vy≈0 while the DJ's fresh-press edge is still pending —
  // starts the dash first, and the engine blocks jump input during an active
  // supermove, so the DJ gets eaten and the arc loses its second impulse
  // (newMacro #3: j stayed 1, dash ran out 100px short).
  // Fire at the APEX of jump 2 (vy crossing from rising to falling), NOT the
  // frame after the DJ commit — that's still ~15 frames into j2's ascent
  // (vy≈-300), and a dash there flies flat high above low targets. At j2's
  // apex the hero is at maximum height; the dash carries level from there.
  if (mem.armSuper && params.canSuper && !hero.supermoveActive && !mem.superFired &&
      !hero.grounded && mem.djDone && hero.jumpsUsed === 2 && hero.vy >= 0) {
    inp.super = true;
    mem.superFired = true;
    mem.armSuper = false;
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
    // Same early-release threshold as the horizontal branch: vy < -40 keeps
    // the DJ press ~2 frames before the true apex. The old -20 threshold
    // released after the apex on discrete 25 px/frame vy steps, costing the
    // 1–3 px that tight climbs need.
    const ascending = hero.vy < -40;
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
