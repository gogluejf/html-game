// rideBrain — THE shared per-hop AI decision for the macro-editor ghost ride.
//
// Single source of truth for "what buttons does the AI press this frame".
// Used by BOTH:
//   - macro-editor/js/ghost.js  (browser TEST ride, rAF loop, real hero)
//   - js/world/pickerRide.js    (headless node ride used by tests)
// There is no second copy of the choreography: settle → walk-to-edge →
// pickTakeoff → backtrack-on-no-candidate → replay winning script. Drift
// between browser and node is impossible because there is one code path.
//
// Environment-specific concerns stay at the edges:
//   - manual play mode (keyboard/DS5 via the game input engine): ghost.js only
//   - respawn-on-fall / fell-past-goal recovery: ghost.js only
//   - fixed-DT loop vs rAF accumulator: caller's problem
//
// Pure logic: no DOM, no requestAnimationFrame. Node-safe.

import { feetPos } from './platformMover.js';
import * as pickerRef from './takeoffPicker.js';
import { findPathBetween } from './macros.js';

/** Zero velocity + clear ALL stale input/jump/super/crouch/drop state so the
 *  pick starts from a clean resting state. Refills the super meter (geometry
 *  test, not meter pacing). Returns false if the hero is not on a surface. */
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

/** Walk the hero (up to ~60 frames) to the edge of its current platform that
 *  is NEAREST the goal, so the takeoff point is deterministic (edge-based)
 *  instead of wherever the hero happened to land. Only walks when the goal is
 *  BESIDE the surface (a lateral hop), not directly above (vertical climb —
 *  jump in place) or directly below overlapping (drop case — let the picker
 *  handle DROP_THRU/DROP_L/DROP_R). Re-settles at the end. */
export function walkToNearestEdge(hero, world, goal, standingOn, stepFn, dt = 1 / 60){
  if (!standingOn || !goal) return false;
  const f = feetPos(hero);
  const risePx = f.y - goal.y;
  // Vertical climb? Goal above AND under our span → jump in place.
  const goalAbove = risePx > world.UY * 0.5 &&
    f.x >= goal.x0 - world.UX * 0.6 && f.x <= goal.x1 + world.UX * 0.6;
  if (goalAbove) return false;
  // Drop case: goal directly below with horizontal overlap → don't walk.
  const goalBelowOverlap = risePx < -world.UY * 0.5 &&
    goal.x1 > standingOn.x0 && goal.x0 < standingOn.x1;
  if (goalBelowOverlap) return false;
  const gcx = (goal.x0 + goal.x1) / 2;
  const targetX = gcx >= f.x ? standingOn.x1 : standingOn.x0;
  if (Math.abs(f.x - targetX) < 4) return false;
  const dir = targetX > f.x ? 1 : -1;
  for (let i = 0; i < 60; i++){
    const inp = { left: dir < 0, right: dir > 0, up: false, down: false, jump: false, super: false };
    const prevX = feetPos(hero).x;
    stepFn(hero, dt, inp, world.solids);
    const nowX = feetPos(hero).x;
    if (Math.abs(nowX - targetX) < 4 || Math.abs(nowX - prevX) < 0.5) break;
    if (!hero.grounded) break;
  }
  settleHero(hero, world);
  return true;
}

/** Create a fresh brain state for a ride over `goals` (ordered landing list).
 *  @param {object} opts
 *   stepFn(hero, dt, inp, solids) — the physics stepper (stepHeadless).
 *   dt — fixed timestep for internal walks (default 1/60).
 *   units — raw macro units (for findPathBetween backtracking); optional.
 *   orientation — macro orientation; optional.
 *   params — hero stats for the picker (e.g. RIDE_PARAMS).
 */
export function createRideBrain(goals, opts = {}){
  const DT = opts.dt ?? 1 / 60;
  const stepFn = opts.stepFn;
  const b = {
    goals: goals ?? [],
    goalIdx: 0,
    mem: {},
    _pick: null,
    _pickGoalIdx: null,
    _pickFromKey: null,
    _pickFrame: 0,
    _cands: [],
    _fallbackDir: null,
    _stepFn: stepFn,
    _dt: DT,
    _units: opts.units ?? null,
    _orientation: opts.orientation ?? null,
    _params: opts.params ?? null,
  };
  b.goal = b.goals[0] ?? null;
  return b;
}

function freshMem(){
  return { wantJump: false, djDone: false, armSuper: false, superFired: false,
           _releasedAtApex: false, _walkEdge: null };
}

/** Advance to the next goal after the current one landed. Resets per-hop mem
 *  and invalidates the pick cache. Skips any goal already in `landedSet` so
 *  out-of-order manual clears are never re-targeted when control returns to
 *  the AI (the brain must aim at the NEXT unlanded goal, not one the player
 *  already walked over). If a backtrack target is pending (set when the
 *  brain re-routed through an intermediate surface), restore THAT goal
 *  instead of advancing forward in the route array. */
export function advanceGoal(b){
  // If we backtracked through an intermediate, the real target is stored in
  // _backtrackTarget. Restore it now that the intermediate has been landed.
  if (b._backtrackTarget && !b.landedSet?.has(b._backtrackTarget.index)){
    b.goal = b._backtrackTarget;
    b._backtrackTarget = null;
  } else {
    b._backtrackTarget = null;
    // Walk forward to the first goal NOT already landed. Without this, an
    // out-of-order manual clear leaves brain.goal pointing at a platform the
    // player already touched, and the AI re-plans toward it (re-clearing a
    // done surface) instead of moving on.
    let i = b.goalIdx + 1;
    while (i < b.goals.length && b.landedSet?.has(b.goals[i].index)) i++;
    b.goalIdx = i;
    b.goal = b.goals[i] ?? null;
  }
  b.mem = freshMem();
  b._pick = null;
  b._pickGoalIdx = null;
  b._pickFromKey = null;
  b._pickFrame = 0;
  b._fallbackDir = null;
  b._hopFrom = null; // fresh hop: re-capture the start surface on next decideInput
}

/** Find which landing surface (if any) the hero's feet are currently on. */
export function surfaceUnder(hero, world){
  const f = feetPos(hero);
  return world.landings.find(l =>
    f.x >= l.x0 - 8 && f.x <= l.x1 + 8 && Math.abs(l.y - f.y) <= 8) ?? null;
}

/** True when the hero is grounded ON the given goal (landing tolerance). */
export function isLandedOn(hero, world, g){
  if (!g || !hero.grounded) return false;
  const box = hero.worldBox();
  const cx = box.x + box.w / 2;
  const fy = box.y + box.h;
  return cx >= g.x0 - 6 && cx <= g.x1 + 6 && Math.abs(g.y - fy) <= 6;
}

/**
 * THE per-frame AI decision. Returns an input object
 * {left,right,up,down,jump,super} for this frame.
 *
 * Sequence (identical for browser and node):
 *   1. no goal → run toward the exit (caller may override for vertical).
 *   2. grounded & pick stale → settle, walk-to-edge, pickTakeoff.
 *      - no candidate → backtrack via findPathBetween to the next
 *        intermediate surface (retargets b.goal); else plain-walk fallback.
 *   3. replay the winning candidate's script frame-by-frame (grounded AND
 *      airborne) until the goal lands or the hero rests elsewhere.
 */
export function decideInput(b, hero, world){
  const inp = { left: false, right: false, up: false, down: false, jump: false, super: false };
  const g = b.goal;
  if (!g) return inp; // run-to-exit handled by the caller (needs world.W etc.)

  const f = feetPos(hero);
  const standingOn = surfaceUnder(hero, world);
  // Remember the surface we STARTED this hop on, BEFORE walk-to-edge can move
  // the hero off it. The backtrack re-plan needs a valid `fromUnit`; using the
  // live standingOn here fails once walk-to-edge has walked the hero off the
  // source lip (standingOn → null → fromUnit -1 → backtrack skipped). This is
  // why "go back to an intermediate to reach the goal" stopped working after
  // the square-grid migration made more hops hard-miss.
  if (standingOn && b._hopFrom == null) b._hopFrom = standingOn.index;

  // A pick is stale when: none yet, goal changed, OR the hero is grounded and
  // the surface-under changed. NOTE: we must NOT require "grounded" for the
  // no-pick case — after landing, the stale flag can clear mid-air, and if the
  // hero then comes to rest grounded with _pick still null, a grounded-only
  // check would never re-pick (infinite fallback walk). So: no pick + grounded
  // always re-picks.
  const pickStale = !b._pick
    || b._pickGoalIdx !== g.index
    || (hero.grounded && b._pickFromKey !== (standingOn?.index ?? 'FLOOR'));

  // WALK-TO-EDGE PHASE (across frames, so the trail shows walking not
  // teleporting): track mem._walkEdge = {targetX, dir} until reached.
  if (hero.grounded && standingOn && !b._pick){
    const gcx = (g.x0 + g.x1) / 2;
    const risePx = f.y - g.y;
    const goalAbove = risePx > world.UY * 0.5 &&
      f.x >= g.x0 - world.UX * 0.6 && f.x <= g.x1 + world.UX * 0.6;
    const goalBelowOverlap = risePx < -world.UY * 0.5 &&
      g.x1 > standingOn.x0 && g.x0 < standingOn.x1;
    // Goal is ABOVE the current surface's span (not just directly over the
    // hero). The correct move is to WALK TO THE GOAL'S CENTER and jump in
    // place — NOT walk to the surface's far edge and fall off. The old code
    // only caught this when the hero was already under the goal (±0.6·UX),
    // but by then walk-to-edge had committed to the far edge (lowRepeated
    // #1→#7: walked to x3168 instead of jumping at x2736).
    const goalAboveSpan = risePx > world.UY * 0.5 &&
      g.x1 > standingOn.x0 && g.x0 < standingOn.x1;
    if (!goalAbove && !goalBelowOverlap){
      // Walk to the goal's center if it's above our span (in-place jump spot);
      // otherwise walk to the nearest edge (lateral hop).
      let targetX = goalAboveSpan ? gcx : (gcx >= f.x ? standingOn.x1 : standingOn.x0);
      // A SOLID BLOCK can sit ON the source surface between us and the goal
      // center (newMacro #3→#7: a 1-row block stacked on the platform). Walking
      // to the goal center then runs straight into the block's face and
      // wall-pins before any pick is made → every candidate hard-misses. When a
      // solid face blocks the path to targetX, clamp the walk target just in
      // front of that face so the hero stops where it can actually launch over
      // the block (the picker's jump trigger now arms there too).
      if (world.solids?.length){
        const wb = hero.worldBox();
        const dirToTarget = targetX > f.x ? 1 : targetX < f.x ? -1 : 0;
        if (dirToTarget !== 0){
          let blockFace = null;
          for (const s of world.solids){
            if (s.oneWay) continue;
            if (s.y >= f.y - 2) continue;                 // floor under feet doesn't block X
            if (s.y + s.h <= wb.y || s.y >= wb.y + wb.h) continue; // no vertical overlap
            const face = dirToTarget > 0 ? s.x : s.x + s.w;
            const d = dirToTarget > 0 ? face - f.x : f.x - face;
            if (d > 0 && (blockFace == null || d < blockFace.d)) blockFace = { d, face };
          }
          if (blockFace && (dirToTarget > 0 ? blockFace.face < targetX : blockFace.face > targetX)){
            targetX = blockFace.face - dirToTarget * 6; // stop ~6px short of the face
          }
        }
      }
      if (!b.mem._walkEdge || Math.abs(f.x - b.mem._walkEdge.targetX) > 4){
        b.mem._walkEdge = { targetX, dir: targetX > f.x ? 1 : -1 };
      }
      if (Math.abs(f.x - b.mem._walkEdge.targetX) > 4){
        inp.left = b.mem._walkEdge.dir < 0;
        inp.right = b.mem._walkEdge.dir > 0;
        return inp;
      }
      // At the edge: settle to a clean resting pose ON the source surface and
      // make the pick NOW (grounded). Picking after the hero walks off into a
      // fall degrades every candidate's sim — the arc launches from a lower,
      // moving state, so a tool that would land cleanly from rest (e.g.
      // SINGLE_S for lowRepeated #7→#8) scores a near-miss and the brain falls
      // back to a weaker single jump that falls short. Pick at rest, then
      // replay the winning script next frame.
      b.mem._walkEdge = null;
      settleHero(hero, world);
      const { pickTakeoff, buildCandidates } = pickerRef;
      b._pick = pickTakeoff(hero, g, world, b._params, {}, standingOn);
      b._cands = buildCandidates(hero, g, world, b._params, standingOn);
      b._pickGoalIdx = g.index;
      b._pickFromKey = standingOn?.index ?? 'FLOOR';
      b._pickFrame = 0;
      b.mem._fallbackDir = null;
      b.scorecard = b._pick.scorecard;
      return inp; // next frame replays the picked script
    }
  }

  if (pickStale){
    settleHero(hero, world);
    const { pickTakeoff, buildCandidates } = pickerRef;
    b._pick = pickTakeoff(hero, g, world, b._params, {}, standingOn);
    b._cands = buildCandidates(hero, g, world, b._params, standingOn);
    b._pickGoalIdx = g.index;
    b._pickFromKey = standingOn?.index ?? 'FLOOR';
    b._pickFrame = 0;
    b.mem._fallbackDir = null;
    b.scorecard = b._pick.scorecard; // exposed for debug/trace
    if (b._pick.best == null || b._pick.best.score > 150){
      // Can't reach the current goal cleanly: hard miss (null) OR a poor
      // near-miss (score > 150 = lands far off). Find the real path via
      // findPathBetween and retarget to the next step on that path. Use the
      // hop's START surface (_hopFrom) when the hero has already walked off
      // the source lip — that's the surface the route should re-plan FROM.
      const fromUnit = standingOn?.index ?? b._hopFrom ?? -1;
      if (fromUnit >= 0 && b._units?.length){
        const tagged = b._units.map((u, i) => ({ ...u, _editorIndex: u._editorIndex ?? i }));
        const path = findPathBetween({ orientation: b._orientation, units: tagged }, fromUnit, g.index);
        if (path && path.length > 2){
          const nextLanding = world.landings.find(l => l.index === path[1]);
          if (nextLanding){
            // Remember the ORIGINAL goal so we can restore it after landing
            // the intermediate surface. Without this, advanceGoal() after
            // landing the intermediate skips past the real target.
            b._backtrackTarget = g;
            b.goal = nextLanding;
            b._pick = null;
            b._pickGoalIdx = null;
            b._pickFromKey = null;
            b._pickFrame = 0;
            b._cands = [];
            b.backtrackedTo = nextLanding.index; // exposed for logging
            return inp;
          }
        }
      }
      b.noCandidateFor = g.index; // exposed for logging
    }
  }
  b._pickFrame++;
  const cand = b._cands.find(c => c.id === b._pick.best?.id);
  if (cand){
    const p = cand.script(b._pickFrame, hero);
    inp.left = p.left; inp.right = p.right; inp.up = p.up;
    inp.down = p.down; inp.jump = p.jump; inp.super = p.super;
  } else {
    // Fallback: plain walk toward the goal. Latch direction so the hero
    // doesn't flip-flop when it crosses the goal center (oscillation).
    if (b.mem._fallbackDir == null){
      const dx = (g.x0 + g.x1) / 2 - f.x;
      b.mem._fallbackDir = dx > 4 ? 1 : dx < -4 ? -1 : 0;
    }
    inp.left = b.mem._fallbackDir < 0;
    inp.right = b.mem._fallbackDir > 0;
  }
  return inp;
}
