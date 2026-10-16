// rideDriver — THE single per-frame ride step for the macro-editor ghost ride.
//
// One code path for BOTH consumers:
//   - macro-editor/js/ghost.js  (browser TEST ride, rAF accumulator)
//   - js/world/pickerRide.js    (headless node ride used by tests)
//
// Everything that can drift between browser and node lives here:
//   decideInput → exit-run fallback → stepFn → landing credit. The callers
//   only own: who ticks it (rAF vs for-loop), rendering, and UI side-effects
//   (toasts, trace dumps, clearance commit).
//
// NO respawn, NO retry, NO fell-past recovery. The picker only commits a jump
// its simulation PROVED lands (score 0). So a fall-out means either the sim
// lied (a real bug) or the geometry is genuinely unreachable — both are things
// to REPORT, not to respawn-and-hope your way out of. A deterministic optimal
// picker either clears the hop or it doesn't; replaying the identical decision
// after a teleport can never turn a miss into a hit.
//
// Pure logic: no DOM, no requestAnimationFrame. Node-safe.

import { stepHeadless } from '../hero/headless.js';
import { decideInput, isLandedOn, advanceGoal } from './rideBrain.js';

// Fallback stepper when a state has no brain._stepFn wired (shouldn't happen
// in practice — both callers wire it). Kept so the driver never crashes.
let stepFnRef = stepHeadless;
export function setStepFn(fn){ stepFnRef = fn; }

/** Create a fresh mutable ride state. Callers fill hero/world/brain/goals. */
export function createRideState(){
  return {
    active: true,
    world: null,
    hero: null,
    brain: null,
    goals: [],
    manual: false,
    landedSet: new Set(),
    failedSet: new Set(),
    // Browser-only extras (harmless in node): trail, flash, trace hooks.
    path: [],
    _lastLandedIdx: null,
    _landFlash: 0,
    _onOneWay: false,
    _manualInputFn: null,// injected: () => input object (plan-07 manual play)
    _events: null,      // filled by stepRide each call
  };
}

/** Per-frame events returned by stepRide so callers react without re-deriving. */
function freshEvents(){
  return { landed: null, cleared: false, outOfWorld: false };
}

/** Run-to-exit input when no goal remains (horizontal: right; vertical: center). */
function exitRunInput(state){
  const { world, hero } = state;
  const inp = { left: false, right: false, up: false, down: false, jump: false, super: false };
  const cx = hero.worldBox().x + hero.worldBox().w / 2;
  if (world.vertical){
    if (cx < world.W / 2 - 6) inp.right = true;
    else if (cx > world.W / 2 + 6) inp.left = true;
  } else {
    inp.right = true;
  }
  return inp;
}

/**
 * ONE fixed-timestep frame of the ride. Shared by browser and node.
 * Returns the events object ({landed, cleared, outOfWorld}).
 *
 * @param {object} state  createRideState() result (+ stepFn/dt wired on brain)
 * @param {number} dt     fixed timestep (1/60)
 */
export function stepRide(state, dt){
  const ev = freshEvents();
  state._events = ev;
  const { world, hero, brain } = state;
  if (!state.active || !world || !hero) return ev;

  // Input: manual play (browser plan-07) overrides the AI brain entirely.
  let inp;
  if (state.manual && state._manualInputFn){
    inp = state._manualInputFn();
  } else {
    inp = brain ? decideInput(brain, hero, world) : exitRunInput(state);
    if (!brain?.goal) Object.assign(inp, exitRunInput(state));
  }
  // Thread the one-way flag INTO the input so down+jump triggers a drop-through
  // (hero.update gates startDropThrough on input.onOneWay). Without this the
  // DROP_THRU script's down+jump degrades to a normal upward jump — the
  // browser/node merge dropped the onOneWay feed-back that ghost.js used to do.
  inp.onOneWay = !!state._onOneWay;
  state._lastIn = inp;

  const res = (brain?._stepFn ?? stepFnRef)(hero, dt, inp, world.solids);
  state._lastRes = res;
  state._onOneWay = !!res.onOneWay;

  const box = hero.worldBox();
  const cx = box.x + box.w / 2;
  const fy = box.y + box.h; // feet

  // Trail (browser renders this; node ignores it — cheap to always record).
  if (state.path){
    state.path.push({ x: cx, y: box.y + box.h * 0.5 });
    const TRAIL_MAX = 900; // ~15 s of trail points at 30 Hz
    if (state.path.length > TRAIL_MAX) state.path.shift();
  }

  // Goal-landing tracking. Manual play has no goals — skip (exit check still applies).
  if (!state.manual && brain && brain.goal){
    if (isLandedOn(hero, world, brain.goal)){
      const idx = brain.goal.index;
      state.landedSet.add(idx);
      state._lastLandedIdx = idx;
      state._landFlash = 30;
      ev.landed = idx;
      advanceGoal(brain);
    }
  }
  if (state._landFlash > 0) state._landFlash--;

  // Reaching the authored macro endpoint concludes the ride in EITHER mode —
  // but ONLY after every goal surface has been landed. "Completely crossed"
  // means the hero's TRAILING edge is past the line: horizontal = left edge
  // past macroEndPx; vertical = feet at/above the end height (whole body
  // across, not just the top corner touching).
  const allLanded = state.goals.length === 0 || state.landedSet.size >= state.goals.length;
  const boxW = box.w / 2;
  const atExit = world.vertical
    ? (world.H - fy) >= world.macroEndPx
    : (cx - boxW) >= world.macroEndPx;
  if (atExit && allLanded){
    ev.cleared = true;
    return ev;
  }

  // Fell out of the world → the proven jump did NOT land. Report it; do NOT
  // respawn. The caller decides how to surface the failure.
  if (fy > world.H + world.UY * 2 || cx < -world.UX * 2 || cx > world.W + world.UX * 2){
    ev.outOfWorld = true;
  }
  return ev;
}
