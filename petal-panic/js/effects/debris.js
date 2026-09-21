// Petal Panic — debris effect (effects.md §3, catalog #3). Projects small
// visual fragments away from an impact or destroyed object — barrels,
// scenery, enemies, armor, platforms, boss components.
//
// Particle-based one-shot: all fragments are spawned at fire time into the
// shared pool (js/particles.js) via spawnOne() with a directed velocity and
// per-fragment gravity; the instance reports done immediately and the pool
// owns their lifetime (same pattern as explosion.js / particleBurst.js).
//
// params: { x, y, fragmentCount?, velocity?, direction?, spread?, gravity?,
//           rotation?, lifetime?, size? }
//   x, y          — impact point in world space. When the carrier exposes
//                   origin(), the FIRE-time carrier position wins over
//                   params.x/y (params are the standalone fallback the
//                   theater fires with a null carrier).
//   fragmentCount — number of fragments to project (default 8)
//   velocity      — base initial speed in px/s (default 140); each fragment
//                   gets a uniform random multiplier in [0.5, 1] so the
//                   burst has a natural speed spread while staying bounded
//                   by the declared velocity
//   direction     — launch axis in radians (default -PI/2, i.e. up); every
//                   fragment is scattered around this axis within `spread`
//   spread        — half-angle of the scatter cone in radians (default PI/2
//                   → a full 360° burst when no direction is given)
//   gravity       — downward acceleration applied to the fragments in
//                   px/s² (default 400); negative values float upward
//   rotation      — spin rate in rad/s applied to each fragment's draw
//                   rotation (default 6); sign sets spin direction
//   lifetime      — seconds each fragment lives before fading out (default
//                   0.6); overrides the pool's SPARKLE_LIFETIME
//   size          — fragment side length in px (default 4); scales the
//                   drawn square down linearly toward the end of life

import { particles } from '../particles.js';
import { FIRE_COLORS } from './palettes.js';

const DEFAULT_COUNT = 8;
const DEFAULT_VELOCITY = 140; // px/s base speed
const SPEED_SPREAD = [0.5, 1]; // per-fragment multiplier range (bounded by velocity)
const DEFAULT_DIRECTION = -Math.PI / 2; // up
const DEFAULT_SPREAD = Math.PI / 2;     // half-angle; PI/2 → full circle
const DEFAULT_GRAVITY = 400;            // px/s²
const DEFAULT_ROTATION = 6;             // rad/s
const DEFAULT_LIFETIME = 0.6;           // s
const DEFAULT_SIZE = 4;                 // px

/**
 * @param {{x?:number, y?:number, fragmentCount?:number, velocity?:number,
 *          direction?:number, spread?:number, gravity?:number,
 *          rotation?:number, lifetime?:number, size?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, done:boolean, complete:Function}}
 */
export function debris(params = {}, carrier = null) {
  const count = Math.max(0, Math.floor(params.fragmentCount ?? DEFAULT_COUNT));
  const velocity = Math.max(0, params.velocity ?? DEFAULT_VELOCITY);
  const direction = params.direction ?? DEFAULT_DIRECTION;
  const spread = Math.max(0, params.spread ?? DEFAULT_SPREAD);
  const gravity = params.gravity ?? DEFAULT_GRAVITY;
  const rotation = params.rotation ?? DEFAULT_ROTATION;
  const lifetime = Math.max(0, params.lifetime ?? DEFAULT_LIFETIME);
  const size = Math.max(0, params.size ?? DEFAULT_SIZE);

  // Impact point: prefer the live carrier anchor at fire time; params are
  // the standalone/fallback position (theater fires with a null carrier).
  let x = params.x ?? 0;
  let y = params.y ?? 0;
  if (carrier && typeof carrier.origin === 'function') {
    const o = carrier.origin();
    x = o.x; y = o.y;
  }

  for (let i = 0; i < count; i++) {
    const angle = direction + (Math.random() * 2 - 1) * spread;
    const speed = velocity * (SPEED_SPREAD[0] + Math.random() * (SPEED_SPREAD[1] - SPEED_SPREAD[0]));
    const color = FIRE_COLORS[i % FIRE_COLORS.length];
    const frag = particles.spawnOne(x, y, color, speed, angle);
    if (!frag) break; // pool exhausted (soft cap): stop spawning, no allocation
    // Per-fragment overrides on top of the pool defaults:
    frag.life = lifetime;
    frag.maxLife = lifetime;
    frag.w = size;
    frag.h = size;
    frag.debrisGravity = gravity;
    frag.debrisRotation = rotation;
    frag.rot = 0;
  }

  return { update() {}, render() {}, done: true, complete() {} };
}
