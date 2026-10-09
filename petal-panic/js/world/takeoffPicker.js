// takeoffPicker — sim-based takeoff decision (plan 06).
//
// Replaces the rule ladder's FINAL call: instead of guessing which tool
// (single / double / +super) will land on the goal, we SIMULATE each
// candidate action against the real physics (stepHeadless + full world.solids)
// and pick the one whose feet land ON the goal surface. Collisions, wall
// pins, and phase-throughs come for free because it's the same pipeline as
// the ghost ride.
//
// Pure logic: Node-testable, zero DOM. The closed-form envelope in macros.js
// stays as a pre-filter (rules out impossible rises fast) but never makes the
// tool call.
//
// Candidate set (grounded takeoff):
//   WALK_OFF   walk toward the goal edge until airborne (drop hops)
//   SINGLE     jump after k walk frames
//   SINGLE_S   jump after k, super at j1 apex
//   DOUBLE     jump after k, DJ at standard release
//   DOUBLE_S   jump after k, DJ, super at j2 apex
//   SUPER_ONLY walk + super immediately (level/low wide gaps)
//
// Scoring: 0 = landed on goal. Otherwise horizontal distance from the goal
// span center where the hero first comes to rest / goes out of range. Hard
// miss (+Infinity) when the hero lands on a DIFFERENT landing surface or gets
// pinned against a wall face — those are exactly the silent-stall bugs the
// ladder produced.

import { stepHeadless } from '../hero/headless.js';
import { feetPos } from './platformMover.js';
import { minHeroSuperAssistReachPx } from './macros.js';

const DT = 1 / 60;
const MAX_SIM_FRAMES = 240;      // ~1.5 s per candidate — enough for any arc
const LANDING_TOL = 8;          // px, matches editor goal-landing tolerance
// Tie-break preference when multiple candidates land (score 0): lower wins.
// Order: walk-off < single < DOUBLE < SINGLE_S < DOUBLE_S < super-only.
// Rationale: prefer the simplest tool that works; when a plain double jump
// clears the same gap as single+super, DJ wins (no meter spend, reads as a
// committed path). Single+super is the fallback for gaps a DJ can't reach.
const PREF = { WALK_OFF: 0, SINGLE: 1, DOUBLE: 2, SINGLE_S: 3, DOUBLE_S: 4, SUPER_ONLY: 5 };

/** Which landing surface (if any) are feet resting on? */
function surfaceUnder(hero, world){
  if (!hero.grounded) return null;
  const f = feetPos(hero);
  for (const l of world.landings){
    if (f.x >= l.x0 - LANDING_TOL && f.x <= l.x1 + LANDING_TOL && Math.abs(l.y - f.y) <= LANDING_TOL){
      return l;
    }
  }
  // Floor counts as a surface too (index -1 sentinel).
  if (Math.abs(f.y - world.groundY) <= LANDING_TOL) return { index: -1, x0: 0, x1: world.W, y: world.groundY };
  return null;
}

/**
 * Simulate ONE candidate action from the hero's CURRENT state.
 * `script` produces the button inputs for frame i given live hero state.
 * Returns { score, detail } — lower is better, Infinity = hard miss.
 */
function simulateCandidate(hero, goal, world, params, script){
  // Clone state so candidates don't pollute each other. We re-create the hero
  // at the same position (cheap, and avoids deep-copying engine internals).
  const spawn = { x: hero.x, y: hero.y };
  const h = makeClone(hero, spawn);
  let bestRest = null; // best (closest-to-goal) grounded rest seen so far

  for (let i = 0; i < MAX_SIM_FRAMES; i++){
    const inp = script(i, h);
    stepHeadless(h, DT, inp, world.solids);
    const f = feetPos(h);

    // Out of world → hard miss.
    if (f.y > world.H + world.UY * 2 || f.x < -world.UX * 2 || f.x > world.W + world.UX * 2){
      return { score: Infinity, detail: 'fell-out' };
    }

    // Pinned against a WALL face while grounded → hard miss. Only counts if
    // the blocking solid is actually a wall (top above our feet), not the
    // floor we're walking on (_blockedX is true for any horizontal stop).
    if (h.grounded && h._blockedX){
      const f = feetPos(h);
      let isWall = false;
      for (const s of world.solids){
        if (s.oneWay) continue;
        if (f.x < s.x || f.x > s.x + s.w) continue;
        if (s.y < f.y - 4 && s.y + s.h > f.y) { isWall = true; break; }
      }
      if (isWall) return { score: Infinity, detail: 'wall-pin' };
    }

    if (h.grounded){
      const surf = surfaceUnder(h, world);
      // Landed on THE goal → perfect.
      if (surf && surf.index === goal.index){
        return { score: 0, detail: `landed-on-goal@f${i}` };
      }
      // Landed somewhere else: record as a rest point (the arc is over).
      if (surf){
        const cx = (goal.x0 + goal.x1) / 2;
        const off = Math.abs(f.x - cx);
        if (!bestRest || off < bestRest.off) bestRest = { off, x: f.x, y: f.y, surf: surf.index, frame: i };
        // If we've been resting for a while, the arc is done — stop early.
        if (i > 30 && Math.abs(h.vx) < 5 && bestRest.frame === i - 1){
          break;
        }
      }
    }
  }

  if (!bestRest) return { score: Infinity, detail: 'no-rest' };
  // Soft miss: how far from the goal span (not just center — being within the
  // span horizontally but on the wrong height is still a miss).
  const inSpan = bestRest.x >= goal.x0 - LANDING_TOL && bestRest.x <= goal.x1 + LANDING_TOL;
  const dx = inSpan ? 0 : Math.min(Math.abs(bestRest.x - goal.x0), Math.abs(bestRest.x - goal.x1));
  const dy = Math.abs(bestRest.y - goal.y);
  const score = dx + dy * 2; // vertical error costs more (wrong tier = stuck)
  return { score, detail: `rest#${bestRest.surf} dx=${Math.round(dx)} dy=${Math.round(dy)}@f${bestRest.frame}` };
}

/** Shallow clone: fresh hero at the same spot with the same velocity/budget. */
function makeClone(src, spawn){
  // The ride always uses balthazar (ghost + tests); keep it simple.
  const h = headlessRef.createHeadlessHero('balthazar', spawn);
  h.vx = src.vx; h.vy = src.vy;
  h.jumpsUsed = src.jumpsUsed;
  h.supermoveMeter = src.supermoveMeter;
  return h;
}
// Lazy import holder (filled at module load below).
import * as headlessRef from '../hero/headless.js';

// ---------------------------------------------------------------------------
// Input scripts — each returns {left,right,up,down,jump,super} for frame i.
// ---------------------------------------------------------------------------

/** Direction toward the goal center from the hero. Hysteresis: once moving
 *  in a direction, keep it until the hero crosses the goal center by >4px.
 *  Without this, a hero arriving near center oscillates L/R every frame and
 *  the jump trigger never stably arms (lowRepeated #5→#2 stall). */
function dirTo(h, goal, st){
  const f = feetPos(h);
  const dx = (goal.x0 + goal.x1) / 2 - f.x;
  if (st && st._dir){
    // Keep current direction unless we've crossed center by the margin.
    if (st._dir > 0 && dx < -4) return -1;
    if (st._dir < 0 && dx > 4) return 1;
    return st._dir;
  }
  const d = dx > 4 ? 1 : dx < -4 ? -1 : 0;
  if (st) st._dir = d;
  return d;
}

function baseWalk(h, goal, st){
  const d = dirTo(h, goal, st);
  return { left: d < 0, right: d > 0, up: false, down: false, jump: false, super: false };
}

/** WALK_OFF: walk toward the goal; never jump. For drop hops.
 *  Returns a script closure matching the (i, h) calling convention used by
 *  simulateCandidate/executePick (first arg = frame index, second = hero). */
function makeWalkOff(goal){
  return (i, h) => baseWalk(h, goal, {});
}

/** Distance (px) from the hero's feet to the nearest WALL face ahead in
 *  direction `dir` (+1 right, -1 left). A wall = a non-oneWay solid whose
 *  vertical span overlaps the hero's body AND whose top is above the feet
 *  (i.e. it can actually block horizontal movement, not the floor we stand
 *  on). Returns Infinity when nothing blocks — the hero walks off into air. */
function nearestWallFacePx(h, world, dir){
  const wb = h.worldBox();
  const f = feetPos(h);
  let best = Infinity;
  for (const s of world.solids){
    if (s.oneWay) continue;
    // Skip the floor under our feet: its top == feet y, it doesn't block X.
    if (s.y >= f.y - 2) continue;
    // Vertical overlap with the hero body required to be a real blocker.
    if (s.y + s.h <= wb.y || s.y >= wb.y + wb.h) continue;
    const face = dir > 0 ? s.x : s.x + s.w;
    const d = dir > 0 ? face - f.x : f.x - face;
    if (d > 0 && d < best) best = d;
  }
  return best;
}

/** Walk toward the goal; jump at the platform edge (coyote time).
 *  Keep pressing direction through the entire arc. DJ at max height,
 *  super at apex if needed. `k` is an optional min-frame delay before arming. */
function makeJumpScript(goal, k, useDj, useSuper, paramsRef, st, surfRef, world){
  const goalRef = goal;
  return (i, h) => {
    const f = feetPos(h);
    // Direction toward the goal center — KEEP PRESSING THROUGH THE ARC.
    const dx = (goalRef.x0 + goalRef.x1) / 2 - f.x;
    const dir = dx > 4 ? 1 : dx < -4 ? -1 : 0;
    
    const inp = { left: dir < 0, right: dir > 0, up: false, down: false, jump: false, super: false };
    
    // Trigger measures distance to the CURRENT SURFACE's edge in the travel
    // direction — the point where the hero would walk off and fall. Jumping
    // here (not at the goal's edge) makes the arc launch from the right spot.
    let toEdge;
    const risePx = f.y - goalRef.y; // >0 = goal higher
    
    // Vertical climb: goal is above AND we're under its span → jump in place.
    const goalAboveOverlap = risePx > world.UY * 0.5 &&
      Math.abs(f.x - (goalRef.x0 + goalRef.x1) / 2) <= world.UX * 0.6;
    
    if (goalAboveOverlap){
      toEdge = 0;
    } else if (surfRef){
      toEdge = dir > 0 ? Math.max(0, surfRef.x1 - f.x) : Math.max(0, f.x - surfRef.x0);
    } else if (world){
      toEdge = nearestWallFacePx(h, world, dir);
    } else {
      toEdge = dir > 0 ? Math.max(0, goalRef.x0 - f.x) : Math.max(0, f.x - goalRef.x1);
    }
    
    const triggerPx = 30 + k * 10; // k=0→30px, k=4→70px, k=8→110px
    
    // GROUNDED: arm the jump when close to the edge.
    if (h.grounded && !st._armed && (toEdge <= triggerPx || toEdge === 0)){
      inp.jump = true;
      st._armed = true;
      st._holdFrames = 2; // hold for 2 frames to ensure it fires
    }
    
    // AIRBORNE: manage the jump sequence.
    if (st._holdFrames > 0){
      inp.jump = true;
      st._holdFrames--;
    } else if (!h.grounded && st._armed){
      if (useDj && h.jumpsUsed === 1){
        // DJ sequence: hold through ascent, release near apex, re-press for DJ.
        if (h.vy < -40) inp.jump = true;           // hold for full j1 height
        else if (!st._rel){ inp.jump = false; st._rel = true; }  // release at apex
        else { inp.jump = true; st._djDone = true; }              // fresh press → DJ
      } else if (useDj && st._djDone && h.jumpsUsed === 2 && h.vy < 0){
        // Hold through the SECOND arc's ascent too.
        inp.jump = true;
      } else if (!useDj && h.jumpsUsed === 1 && h.vy < 0){
        inp.jump = true;                            // hold single for full height
      }
    }
    
    // Super: fire at apex if needed.
    if (useSuper && !h.grounded && !st._superFired){
      const atApex = useDj ? (st._djDone && h.jumpsUsed === 2 && h.vy >= 0)
                           : (h.jumpsUsed === 1 && h.vy >= 0);
      if (atApex && !h.supermoveActive){ 
        inp.super = true; 
        st._superFired = true; 
      }
    }
    
    return inp;
  };
}

/** SUPER_ONLY: walk + fire super immediately (level/low wide gaps). */
function makeSuperOnly(goal){
  return (i, h) => {
    const inp = baseWalk(h, goal, {});
    if (i === 2 && h.grounded && !h.supermoveActive) inp.super = true;
    return inp;
  };
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Build the candidate list for a grounded takeoff toward `goal`.
 * @returns {Array<{id:string, pref:number, script:Function}>}
 */
export function buildCandidates(hero, goal, world, params, fromSurface){
  const f = feetPos(hero);
  const rise = f.y - goal.y; // >0 goal higher
  const cands = [];
  const K = [0, 4, 8]; // trigger distances (px): 8 / 16 / 32 from the edge

  // Drop hop: goal at or below our level → walking off the edge is the natural
  // move. No rise threshold: a 1-row pyramid step (rise=-48) must walk off,
  // not hop — with no WALK_OFF candidate the cheapest option was a SINGLE
  // jump, so the ride "jumped" down stairs it could simply drop (pyramid3).
  if (rise <= 0) cands.push({ id: 'WALK_OFF', pref: PREF.WALK_OFF, script: makeWalkOff(goal) });

  for (const k of K){
    cands.push({ id: `SINGLE@${k}`, pref: PREF.SINGLE, script: makeJumpScript(goal, k, false, false, params, {}, fromSurface, world), state: {} });
    if (params.canSuper) cands.push({ id: `SINGLE_S@${k}`, pref: PREF.SINGLE_S, script: makeJumpScript(goal, k, false, true, params, {}, fromSurface, world), state: {} });
    if (params.hasDoubleJump) cands.push({ id: `DOUBLE@${k}`, pref: PREF.DOUBLE, script: makeJumpScript(goal, k, true, false, params, {}, fromSurface, world), state: {} });
    if (params.hasDoubleJump && params.canSuper) cands.push({ id: `DOUBLE_S@${k}`, pref: PREF.DOUBLE_S, script: makeJumpScript(goal, k, true, true, params, {}, fromSurface, world), state: {} });
  }
  if (params.canSuper && rise < world.UY * 0.5) cands.push({ id: 'SUPER_ONLY', pref: PREF.SUPER_ONLY, script: makeSuperOnly(goal) });
  return cands;
}

/**
 * Pick the best takeoff action by simulation.
 * @returns {{best:{id,score,detail}|null, scorecard:Array<{id,score,detail}>, pruned:boolean}}
 *   best=null means every candidate hard-missed (caller should report the
 *   scorecard — that's the "genuinely unclearable from here" signal).
 */
export function pickTakeoff(hero, goal, world, params, opts = {}, fromSurface){
  // Envelope pre-filter: if even the super-assisted rise is impossible, skip
  // the sim entirely (cheap, and matches the validator's unreachable verdict).
  const f = feetPos(hero);
  const rise = f.y - goal.y;
  if (minHeroSuperAssistReachPx(rise) < 0){
    return { best: null, scorecard: [{ id: 'ENVELOPE', score: Infinity, detail: `rise ${Math.round(rise)}px beyond super apex` }], pruned: true };
  }

  const cands = buildCandidates(hero, goal, world, params, fromSurface);
  const scorecard = [];
  let best = null;

  for (const c of cands){
    const r = simulateCandidate(hero, goal, world, params, c.script);
    scorecard.push({ id: c.id, score: r.score, detail: r.detail });
    // NOTE: do NOT break on the first score-0. Several candidates often land
    // (e.g. SINGLE_S and DOUBLE both clear the same gap) — run them all so
    // the PREF tie-break can choose the preferred tool (DJ over single+super).
    if (!best || r.score < best.score || (r.score === best.score && c.pref < best.pref)){
      best = { id: c.id, score: r.score, detail: r.detail };
    }
  }
  return { best, scorecard, pruned: false };
}

/**
 * Execute the picked candidate on the REAL hero (not a clone): replays the
 * winning script frame-by-frame via stepHeadless until it lands on the goal,
 * rests, or times out. Returns the same shape as stepAndCorrect so callers
 * can swap it in directly.
 */
export function executePick(hero, goal, world, params, pick, opts = {}, fromSurface){
  const maxFrames = opts.maxFrames ?? MAX_SIM_FRAMES + 30;
  const cand = buildCandidates(hero, goal, world, params, fromSurface).find(c => c.id === pick.best.id);
  if (!cand) return { landed: false, reason: 'no-candidate', frames: 0 };
  const path = [];
  for (let i = 0; i < maxFrames; i++){
    const inp = cand.script(i, hero);
    inp.onOneWay = !!opts.onOneWay;
    stepHeadless(hero, DT, inp, world.solids);
    const f = feetPos(hero);
    path.push({ x: +f.x.toFixed(2), y: +f.y.toFixed(2) });
    if (hero.grounded){
      const surf = surfaceUnder(hero, world);
      if (surf && surf.index === goal.index) return { landed: true, frames: i + 1, reason: 'landed', path };
    }
    if (f.y > world.H + world.UY * 2) return { landed: false, reason: 'fell', frames: i + 1, path };
  }
  return { landed: false, reason: 'timeout', frames: maxFrames, path };
}
