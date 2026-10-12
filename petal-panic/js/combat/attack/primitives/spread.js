// Attack Engine — Spread primitive (Task 1.3).
//
// Direction-generation ONLY: given count + total angle + center direction,
// returns an array of evenly-distributed angles. It is composable — the
// Spread_Shot / Bomb_Spread macros feed its output into the Projectile or
// Bomb primitives. A 2π angle produces a radial pattern.
//
// This primitive is synchronous and stateless: impl() returns the angle list
// directly (wrapped so the handle contract still holds — it completes
// immediately). No pools, no collision, no DOM.

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';

/** Default params. */
const DEFAULTS = Object.freeze({
  count: 3,        // number of outputs
  direction: 0,    // center direction (radians)
  angle: Math.PI / 3, // total spread angle (radians); 2π = radial
});

/**
 * Generate `count` angles distributed evenly across `angle`, centered on
 * `direction`. Single-shot spreads collapse to [direction].
 *
 * @param {number} count
 * @param {number} direction center angle (rad)
 * @param {number} angle     total spread (rad)
 * @returns {number[]} length-`count` array of angles (rad)
 */
export function spreadAngles(count, direction, angle) {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return [direction];
  const out = new Array(n);
  const half = angle / 2;
  for (let i = 0; i < n; i++) {
    // Even distribution edge-to-edge: i=0 → -half, i=n-1 → +half.
    out[i] = direction - half + (angle * i) / (n - 1);
  }
  return out;
}

registerPrimitive('spread', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Spread',
    desc: 'Generates N evenly-distributed angles around a center direction. Feed into Projectile/Bomb. 2π = radial.',
    params: [
      { key: 'count', desc: 'number of outputs' },
      { key: 'direction', desc: 'center direction (radians)' },
      { key: 'angle', desc: 'total spread angle (radians)' },
    ],
  },
  /**
   * @returns {AttackHandle & {angles: number[]}} completes immediately;
   *          the generated angles are on `handle.angles`.
   */
  impl(params) {
    const h = new AttackHandle('spread');
    h.angles = spreadAngles(params.count, params.direction, params.angle);
    h._complete({ angles: h.angles });
    return h;
  },
});
