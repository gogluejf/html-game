// Petal Panic — hit-sparkle effect (migrated from the pre-refactor monolith,
// js/effects.js `Effects.spawnHitSparkles`; reference: .squid-os/plans/effect-engine/
// effect-reference.txt). Small red "blood" sparkles at a projectile→enemy impact
// point (design §12 "Projectile hit on enemy: small red sparkle").
//
// One-shot burst: all particles are spawned from the shared pool at fire time;
// the instance reports done immediately and the pool owns their lifetime.
//
// params: { x, y, count? } — count omitted → random int in [3, 5] (old roll).
// Speeds uniform [60, 140] px/s; colors cycle BLOOD_COLORS by index.

import { particles } from '../particles.js';
import { BLOOD_COLORS } from './palettes.js';

const HIT_SPARKLE_COUNT = [3, 5];   // design §12: 3–5 red sparkles per hit
const HIT_SPARKLE_SPEED = [60, 140];

/**
 * @param {{x:number, y:number, count?:number}} params
 * @returns {{update:Function, render:Function, done:boolean}}
 */
export function hitSparkle(params = {}) {
  const { x, y, count } = params;
  const n = count ?? (HIT_SPARKLE_COUNT[0] + Math.floor(Math.random() * (HIT_SPARKLE_COUNT[1] - HIT_SPARKLE_COUNT[0] + 1)));
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = HIT_SPARKLE_SPEED[0] + Math.random() * (HIT_SPARKLE_SPEED[1] - HIT_SPARKLE_SPEED[0]);
    const color = BLOOD_COLORS[i % BLOOD_COLORS.length];
    particles.spawnOne(x, y, color, speed, angle);
  }
  return { update() {}, render() {}, done: true };
}
