// pickerRide — a headless, plan-06 PICKER-DRIVEN ghost ride.
//
// This is the Node-testable twin of macro-editor/js/ghost.js `rideInput`.
// The existing runGhostRide/rideOnce in ghostRider.js uses the OLD rule-driven
// brain (seekLanding / nextAhead / doubleJumpApexPx) and does NOT exercise the
// sim-based takeoffPicker. Tests that assert "the picker clears the macro" must
// use THIS module, or they're testing the wrong code path.
//
// It replays the exact per-hop logic the browser uses:
//   1. when grounded & pursuing a goal, SETTLE the hero to a clean resting
//      state (zero vx/vy, grounded=true, clear stale jump/super/crouch/drop
//      state, refill super meter) — see DEBUGGING.md trap #1/#2/#3.
//   2. pickTakeoff() → winning candidate.
//   3. replay the winning script frame-by-frame until the goal lands or the
//      hero rests elsewhere.
//
// Pure logic: no DOM, no requestAnimationFrame. Run with node:test.

import { buildRideWorld } from './ghostRider.js';
import { createHeadlessHero, stepHeadless } from '../hero/headless.js';
import { HEROES } from '../hero/heroDefs.js';
import { feetPos } from './platformMover.js';
import { traversalRoute } from './macros.js';
import * as pickerRef from './takeoffPicker.js';

const DT = 1 / 60;
const DEFAULT_MAX_FRAMES = 60 * 90; // ~90 s per lap cap

/** Balthazar governs (weakest hero). Ghost ride = infinite supers. */
export const RIDE_PARAMS = { ...HEROES.balthazar.stats, hasDoubleJump: true, canSuper: true };

/** Build the ordered goal list for a ride world (mirrors ghost.js buildGoalList). */
export function buildGoalList(world, st){
  const ls = [...world.landings];
  let routeOrder = null;
  if (st && st.units?.length){
    const tagged = st.units.map((u, i) => ({ ...u, _editorIndex: u._editorIndex ?? i }));
    const { order, unreachable } = traversalRoute({ orientation: st.orientation, units: tagged });
    routeOrder = order;
    if (unreachable) return { goals: mapOrder(ls, order), unreachable: new Set(unreachable) };
  }
  if (!routeOrder || !routeOrder.length){
    if (world.vertical) ls.sort((a, b) => (b.y - a.y) || (a.x0 - b.x0));
    else ls.sort((a, b) => (a.x0 - b.x0) || (a.y - b.y));
    return { goals: ls, unreachable: new Set() };
  }
  return { goals: mapOrder(ls, routeOrder), unreachable: new Set() };
}

function mapOrder(ls, order){
  const byIdx = new Map(ls.map(l => [l.index, l]));
  const out = [];
  for (const ui of order){ const l = byIdx.get(ui); if (l) out.push(l); }
  return out;
}

/** Zero velocity + clear ALL stale input/jump/super/crouch/drop state so the
 *  sim clone starts from the same resting state the real hero will execute
 *  from. Refills the super meter (geometry test, not meter pacing). */
export function settleHero(hero, world){
  const f = feetPos(hero);
  const surfUnder = world.landings.find(l =>
    f.x >= l.x0 - 8 && f.x <= l.x1 + 8 && Math.abs(l.y - f.y) <= 8);
  if (!surfUnder) return false;
  hero.vy = 0;
  hero.vx = 0;
  if (f.y < surfUnder.y) hero.y = surfUnder.y - hero.worldBox().h;
  hero.grounded = true;
  hero._jumpBuffer = 0;
  hero._prevJumpHeld = false;
  hero._coyote = 0;
  hero.jumpsUsed = 0;
  hero.supermoveActive = false;
  hero.supermovePhase = null;
  hero.supermoveMeter = hero.SUPERMOVE_MAX;
  hero.crouching = false;
  if (hero._dropTimer > 0) hero._dropTimer = 0;
  return true;
}

/**
 * Walk the hero to the edge of its current platform that is NEAREST the goal,
 * so the takeoff point is deterministic (edge-based) instead of wherever the
 * hero happened to land. Without this, identical gap shapes get different
 * tools because the pick depends on the arbitrary arrival position (mid vs
 * edge). Only walks when the goal is BESIDE the surface (a lateral hop), not
 * directly above (a vertical climb — that jumps in place).
 * Returns true if it walked, false if nothing to do.
 */
export function walkToNearestEdge(hero, world, goal, standingOn){
  if (!standingOn || !goal) return false;
  const f = feetPos(hero);
  // Vertical climb? Goal is above AND under our span → jump in place, don't walk.
  const risePx = f.y - goal.y;
  const goalAbove = risePx > world.UY * 0.5 &&
    f.x >= goal.x0 - world.UX * 0.6 && f.x <= goal.x1 + world.UX * 0.6;
  if (goalAbove) return false;
  // Which edge is nearer the goal center?
  const gcx = (goal.x0 + goal.x1) / 2;
  const targetX = gcx >= f.x ? standingOn.x1 : standingOn.x0;
  // Already at (or past) the target edge → nothing to do.
  if (Math.abs(f.x - targetX) < 4) return false;
  const dir = targetX > f.x ? 1 : -1;
  // Walk up to ~60 frames (enough for any platform width) until we reach the
  // edge or can't move further (wall). Keep it grounded the whole way.
  for (let i = 0; i < 60; i++){
    const inp = { left: dir < 0, right: dir > 0, up: false, down: false, jump: false, super: false };
    const prevX = feetPos(hero).x;
    stepHeadless(hero, DT, inp, world.solids);
    const nowX = feetPos(hero).x;
    // Reached the edge (within tolerance) or stopped moving (wall/edge).
    if (Math.abs(nowX - targetX) < 4 || Math.abs(nowX - prevX) < 0.5) break;
    if (!hero.grounded) break; // walked off — stop, the pick will handle it
  }
  // Re-settle so the pick starts from a clean resting state at the new spot.
  settleHero(hero, world);
  return true;
}

/**
 * Run a full picker-driven ride over a macro draft.
 * @returns {{cleared:boolean, landed:number[], goals:number[],
 *            failPoint:{goal:number, reason:string}|null, frames:number}}
 */
export function runPickerRide(macro, opts = {}){
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_FRAMES;
  const world = buildRideWorld(macro, { unitPxX: 72, unitPxY: 48, platformDrawH: 6 });
  const { goals, unreachable } = buildGoalList(world, macro);
  const goalIndices = goals.map(g => g.index);

  const bh = createHeadlessHero('balthazar', { x: 0, y: 0 }).worldBox().h;
  const hero = createHeadlessHero('balthazar', { x: world.entry.x - 8, y: world.entry.y - bh });

  let goalIdx = 0;
  let pick = null, cands = [], pickFrame = 0, pickGoalIdx = null, pickFromKey = null;
  const landedSet = new Set();

  for (let frame = 0; frame < maxFrames; frame++){
    const g = goals[goalIdx] ?? null;
    if (!g) break;
    const f = feetPos(hero);
    const standingOn = world.landings.find(l =>
      f.x >= l.x0 - 8 && f.x <= l.x1 + 8 && Math.abs(l.y - f.y) <= 8) ?? null;
    const stale = !pick
      || pickGoalIdx !== g.index
      || (hero.grounded && pickFromKey !== (standingOn?.index ?? 'FLOOR'));

    let inp = { left: false, right: false, up: false, down: false, jump: false, super: false };
    if (stale){
      settleHero(hero, world);
      // Deterministic takeoff: walk to the edge nearest the goal so identical
      // gap shapes launch from the same spot (not wherever we landed).
      walkToNearestEdge(hero, world, g, standingOn);
      pick = pickerRef.pickTakeoff(hero, g, world, RIDE_PARAMS, {}, standingOn);
      cands = pickerRef.buildCandidates(hero, g, world, RIDE_PARAMS, standingOn);
      pickGoalIdx = g.index;
      pickFromKey = standingOn?.index ?? 'FLOOR';
      pickFrame = 0;
      if (pick.best == null){
        return { cleared: false, landed: [...landedSet], goals: goalIndices,
                 failPoint: { goal: g.index, reason: 'no-candidate' }, frames: frame };
      }
    }
    pickFrame++;
    const cand = cands.find(c => c.id === pick.best?.id);
    if (cand){
      const p = cand.script(pickFrame, hero);
      Object.assign(inp, { left: p.left, right: p.right, up: p.up, down: p.down, jump: p.jump, super: p.super });
    } else {
      const dx = (g.x0 + g.x1) / 2 - f.x;
      if (dx > 4) inp.right = true; else if (dx < -4) inp.left = true;
    }

    stepHeadless(hero, DT, inp, world.solids);
    const cx = hero.worldBox().x + hero.worldBox().w / 2;
    const fy = hero.worldBox().y + hero.worldBox().h;

    if (hero.grounded && cx >= g.x0 - 6 && cx <= g.x1 + 6 && Math.abs(g.y - fy) <= 6){
      landedSet.add(g.index);
      goalIdx++;
      pick = null; pickGoalIdx = null; pickFromKey = null;
      if (goalIdx >= goals.length) break;
    }
    if (fy > world.H + world.UY * 2 || cx < -world.UX * 2 || cx > world.W + world.UX * 2){
      return { cleared: false, landed: [...landedSet], goals: goalIndices,
               failPoint: { goal: g.index, reason: 'fell-out' }, frames: frame };
    }
  }

  const cleared = goalIdx >= goals.length;
  return { cleared, landed: [...landedSet], goals: goalIndices, failPoint: null, frames: maxFrames, unreachable: [...unreachable] };
}
