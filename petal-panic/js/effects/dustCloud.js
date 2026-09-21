// Petal Panic — dust-cloud effect (effects.md §20, catalog #20). Soft,
// low-velocity dust/smoke puffs clustered at a ground contact point for
// landings, running starts, slides, boss stomps, and impacts.
//
// Particle-based one-shot: all puffs are spawned at fire time into the shared
// pool (js/particles.js) via spawnOne() with per-puff overrides; the instance
// reports done immediately and the pool owns their stepping, culling, and
// rendering for their lifetime (same pattern as explosion.js / debris.js).
//
// params: { x, y, particleCount?, spread?, size?, velocity?, lifetime?,
//           opacity?, gravity? }
//   x, y          — contact point in world space. When the carrier exposes
//                   origin(), the FIRE-time carrier position wins over
//                   params.x/y (params are the standalone fallback the
//                   theater fires with a null carrier).
//   particleCount — number of dust puffs to spawn (default 6); 0 or negative
//                   spawns nothing
//   spread        — horizontal half-width of the cluster in px (default 10);
//                   each puff's launch x is offset uniformly from the contact
//                   point within ±spread
//   size          — puff side length in px (default 5)
//   velocity      — base initial speed in px/s (default 30); each puff gets a
//                   uniform random multiplier in [0.5, 1] so the cloud stays
//                   bounded by the declared velocity while keeping natural
//                   spread
//   lifetime      — seconds each puff lives before fading out (default 0.4);
//                   overrides the pool's SPARKLE_LIFETIME
//   opacity       — peak alpha, clamped to [0,1] (default 0.8); the drawn
//                   alpha is opacity · (remaining/lifetime), so every puff
//                   fades to exactly 0 at its end of life
//   gravity       — downward acceleration applied to the puffs in px/s²
//                   (default 0 → gentle drift, no fall); positive values make
//                   the cloud settle back down, negative floats it upward

import { particles } from '../particles.js';
import { DUST_COLORS } from './palettes.js';

const DEFAULT_COUNT = 6;
const DEFAULT_SPREAD = 10; // px half-width of the contact cluster
const DEFAULT_SIZE = 5;    // px
const DEFAULT_VELOCITY = 30; // px/s base speed (soft, low-velocity)
const SPEED_SPREAD = [0.5, 1]; // per-puff multiplier range (bounded by velocity)
const DEFAULT_LIFETIME = 0.4;  // s
const DEFAULT_OPACITY = 0.8;   // peak alpha
const DEFAULT_GRAVITY = 0;     // px/s² (0 = drift, no settling)

/**
 * @param {{x?:number, y?:number, particleCount?:number, spread?:number,
 *          size?:number, velocity?:number, lifetime?:number, opacity?:number,
 *          gravity?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, done:boolean, complete:Function}}
 */
export function dustCloud(params = {}, carrier = null) {
  const count = Math.max(0, Math.floor(params.particleCount ?? DEFAULT_COUNT));
  const spread = Math.max(0, params.spread ?? DEFAULT_SPREAD);
  const size = Math.max(0, params.size ?? DEFAULT_SIZE);
  const velocity = Math.max(0, params.velocity ?? DEFAULT_VELOCITY);
  const lifetime = Math.max(0, params.lifetime ?? DEFAULT_LIFETIME);
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const gravity = params.gravity ?? DEFAULT_GRAVITY;

  // Contact point: prefer the live carrier anchor at fire time; params are
  // the standalone/fallback position (theater fires with a null carrier).
  let x = params.x ?? 0;
  let y = params.y ?? 0;
  if (carrier && typeof carrier.origin === 'function') {
    const o = carrier.origin();
    x = o.x; y = o.y;
  }

  for (let i = 0; i < count; i++) {
    // Clustered at the contact point: horizontal jitter within ±spread,
    // launched mostly upward with a wide cone so the puffs billow up and
    // outward around the landing spot.
    const dx = (Math.random() * 2 - 1) * spread;
    const angle = -Math.PI / 2 + (Math.random() * 2 - 1) * (Math.PI / 2);
    const speed = velocity * (SPEED_SPREAD[0] + Math.random() * (SPEED_SPREAD[1] - SPEED_SPREAD[0]));
    const color = DUST_COLORS[i % DUST_COLORS.length];
    const puff = particles.spawnOne(x + dx, y, color, speed, angle);
    if (!puff) break; // pool exhausted (soft cap): stop spawning, no allocation
    // Per-puff overrides on top of the pool defaults:
    puff.life = lifetime;
    puff.maxLife = lifetime;
    puff.w = size;
    puff.h = size;
    puff.debrisGravity = gravity;
    puff.dustAlpha = opacity;
  }

  return { update() {}, render() {}, done: true, complete() {} };
}
