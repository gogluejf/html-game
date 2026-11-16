// Petal Panic — pinned-to-die (single owner).
//
// A PINNED body is functionally DEAD with its death SCHEDULED:
//   - takes no damage from anything (the two door guards refuse it)
//   - cannot be killed early by any path (melee, projectile, explosion, zone)
//   - still gets knocked around (chip kicks, shake, hitstop) — a body, not a wall
//   - dies exactly ONCE at release: finisher connect = fancy death
//     (big launch + ghost / fuse); combo end = normal death in place.
//
// Only supermove bursts pin (they are the only multi-hit attack with a
// finisher). Melee / super melee are single-hit — every hit IS the last one,
// so they keep the immediate kill payoff and never touch this module.
//
// Everything else in the game knows "pinned" exists ONLY through the two door
// guards (Enemy.takeDamage, GameObj.takeDamage) and the .pinned flag read here.

import { Debug } from '../debug/debug.js';
import { LAYER } from '../consts.js';
import { armBarrelMeleeFuse } from '../objects/barrelPhysics.js';

/**
 * Pin a victim: mark it dedicated-to-die-at-end-of-sequence. Idempotent —
 * re-pinning an already-pinned body is a no-op. Refuses bodies that are
 * already dead (aiState 'dead') or already gone (alive=false): pinning a
 * corpse races the death pipeline and produces double-death glitches.
 * @returns {boolean} true when the pin was freshly armed.
 */
export function pin(victim) {
  if (!victim || victim.pinned) return false;
  if (victim.alive === false) return false;
  if (victim.aiState === 'dead') return false; // already in the death pipeline
  victim.pinned = true;
  Debug.logEvent(`[pin] ARM ${victim.type ?? '?'} @(${Math.round(victim.x)},${Math.round(victim.y)})`);
  return true;
}

/** True when the body is pinned (death on hold). */
export function isPinned(victim) {
  return !!victim?.pinned;
}

/**
 * Release a pinned body via the FINISHER: the fancy death starts NOW.
 * Enemy → big launch + ghost + normal death sequence. Barrel → big launch +
 * cook fuse (break/boom after the arc). Clears the pin either way, so the
 * body can never be released twice.
 * @param {object} victim the pinned body
 * @param {{impulse:{x:number,y:number},hitstun?:number}} launch big-tier vector
 */
export function releaseFinisher(victim, launch) {
  if (!isPinned(victim)) return;
  victim.pinned = false;
  Debug.logEvent(`[pin] RELEASE ${victim.type ?? '?'} @(${Math.round(victim.x)},${Math.round(victim.y)}) by finisher`);
  if (launch) {
    victim.vx = launch.impulse.x;
    victim.vy = launch.impulse.y;
    if (launch.hitstun > 0) victim.hitstunTimer = Math.max(victim.hitstunTimer ?? 0, launch.hitstun);
  }
  if (victim.layer === LAYER.SOLID) {
    // Barrel: arm the cook fuse; tickFallingBarrelFuse owns detonation.
    // Synchronous import — barrelPhysics does not import pin.js, so no cycle.
    armBarrelMeleeFuse(victim);
  } else {
    // Enemy: start the normal death pipeline, then ghost-flight until despawn.
    victim.die?.();
    victim.intangible = true;
  }
}

/**
 * Unpin every pinned body in scope (combo ended without a finisher connect,
 * or the hero died mid-dash): each dies/breaks NOW, in place, the normal way.
 * Skips bodies already released (releaseFinisher cleared the flag).
 * @param {{barrels?:object[],enemies?:object[]}} scope live entity lists
 */
export function unpinAll(scope) {
  for (const b of scope?.barrels ?? []) {
    if (!isPinned(b)) continue;
    b.pinned = false;
    Debug.logEvent(`[pin] UNPIN barrel ${b.type ?? '?'} @(${Math.round(b.x)},${Math.round(b.y)}) — combo ended, breaking inline`);
    b.destroy?.(); // latched destroy: break + coins/explosion inline
  }
  for (const e of scope?.enemies ?? []) {
    if (!isPinned(e)) continue;
    e.pinned = false;
    Debug.logEvent(`[pin] UNPIN enemy ${e.type ?? '?'} @(${Math.round(e.x)},${Math.round(e.y)}) — combo ended, dying in place`);
    e.die?.(); // normal death sequence from here
  }
}
