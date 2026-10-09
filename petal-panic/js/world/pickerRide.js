// pickerRide — a headless, plan-06 PICKER-DRIVEN ghost ride.
//
// This is the Node-testable twin of macro-editor/js/ghost.js `rideInput`.
// The existing runGhostRide/rideOnce in ghostRider.js uses the OLD rule-driven
// brain (seekLanding / nextAhead / doubleJumpApexPx) and does NOT exercise the
// sim-based takeoffPicker. Tests that assert "the picker clears the macro" must
// use THIS module, or they're testing the wrong code path.
//
// Per-hop AI decisions come from js/world/rideBrain.js — THE shared brain used
// by BOTH this module and the browser editor (macro-editor/js/ghost.js). There
// is no duplicated choreography here: settle → walk-to-edge → pick → backtrack
// → replay all live in rideBrain.decideInput. This file only drives the fixed-DT
// loop, detects landings, and reports the result.
//
// Pure logic: no DOM, no requestAnimationFrame. Run with node:test.

import { buildRideWorld } from './ghostRider.js';
import { createHeadlessHero, stepHeadless } from '../hero/headless.js';
import { HEROES } from '../hero/heroDefs.js';
import { feetPos } from './platformMover.js';
import { traversalRoute } from './macros.js';
import {
  createRideBrain, advanceGoal, decideInput, isLandedOn,
} from './rideBrain.js';

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

  const brain = createRideBrain(goals, {
    stepFn: stepHeadless,
    dt: DT,
    units: macro.units,
    orientation: macro.orientation,
    params: RIDE_PARAMS,
  });
  // Attach the stepper the brain's internal walks need.
  world._stepFn = stepHeadless;

  const landedSet = new Set();

  for (let frame = 0; frame < maxFrames; frame++){
    const inp = decideInput(brain, hero, world);
    // No goal left: run to the exit (horizontal: right; vertical: toward center).
    if (!brain.goal){
      const cx = hero.worldBox().x + hero.worldBox().w / 2;
      if (world.vertical){
        if (cx < world.W / 2 - 6) inp.right = true;
        else if (cx > world.W / 2 + 6) inp.left = true;
      } else {
        inp.right = true;
      }
    }
    stepHeadless(hero, DT, inp, world.solids);
    const box = hero.worldBox();
    const cx = box.x + box.w / 2;
    const fy = box.y + box.h;

    if (isLandedOn(hero, world, brain.goal)){
      landedSet.add(brain.goal.index);
      advanceGoal(brain);
      if (!brain.goal) break;
    }
    if (fy > world.H + world.UY * 2 || cx < -world.UX * 2 || cx > world.W + world.UX * 2){
      return { cleared: false, landed: [...landedSet], goals: goalIndices,
               failPoint: { goal: brain.goal?.index ?? -1, reason: 'fell-out' }, frames: frame,
               unreachable: [...unreachable] };
    }
  }

  const cleared = !brain.goal; // advanced past the last goal
  return { cleared, landed: [...landedSet], goals: goalIndices, failPoint: null, frames: maxFrames, unreachable: [...unreachable] };
}
