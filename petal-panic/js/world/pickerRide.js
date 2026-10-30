// pickerRide — a headless, plan-06 PICKER-DRIVEN ghost ride.
//
// Node-testable twin of macro-editor/js/ghost.js. The per-frame logic is NOT
// duplicated here: this module only sets up the world/hero/brain and calls THE
// shared driver (js/world/rideDriver.js stepRide) in a fixed-DT loop. The
// browser editor calls the SAME stepRide from its rAF accumulator, so browser
// and node are pixel-identical by construction — one decideInput, one landing
// credit; no respawn/retry.
//
// Pure logic: no DOM, no requestAnimationFrame. Run with node:test.

import { buildRideWorld } from './ghostRider.js';
import { createHeadlessHero, stepHeadless } from '../hero/headless.js';
import { HEROES } from '../hero/heroDefs.js';
import { UNIT_PX_X, UNIT_PX_Y } from '../consts.js';
import { traversalRoute } from './macros.js';
import { createRideBrain } from './rideBrain.js';
import { createRideState, stepRide } from './rideDriver.js';

const DT = 1 / 60;
const DEFAULT_MAX_FRAMES = 60 * 90; // ~90 s per lap cap

/** Balthazar governs (weakest hero). Ghost ride = infinite supers. */
// UNIT→PX conversion point (pixel-hardcode-audit.md Tier 2): def stats are unit-native;
// the mover math is px-based.
export const RIDE_PARAMS = { ...HEROES.balthazar.stats, speed: HEROES.balthazar.stats.speed * UNIT_PX_X, jump: HEROES.balthazar.stats.jump * UNIT_PX_Y, hasDoubleJump: true, canSuper: true };

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
  // Authoritative grid constants — the ride world shares the game's 48×48 cell.
  const world = buildRideWorld(macro);
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

  const state = createRideState();
  state.world = world;
  state.hero = hero;
  state.brain = brain;
  state.goals = goals;
  state.failedSet = unreachable;
  state.path = null; // node doesn't render a trail

  let frames = 0;
  let fellOut = false;
  for (frames = 0; frames < maxFrames; frames++){
    const ev = stepRide(state, DT);
    if (ev.cleared) break;
    if (ev.outOfWorld){ fellOut = true; break; } // proven jump missed → report, don't retry
  }

  const cleared = !brain.goal; // advanced past the last goal
  return {
    cleared,
    landed: [...state.landedSet],
    goals: goalIndices,
    failPoint: cleared ? null : { goal: brain.goal?.index ?? -1, reason: fellOut ? 'fell-out' : 'stalled' },
    frames,
    unreachable: [...unreachable],
  };
}
