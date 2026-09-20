// Petal Panic — pickup-pop effect (migrated from the pre-refactor monolith,
// js/effects.js `Effects.spawnPickupPop`; reference: .squid-os/plans/effect-engine/
// effect-reference.txt). Powerup collect pop (design §12 "Powerup pickup:
// pop/sparkle"): a ring of evenly spaced colored sparkles radiating outward.
//
// One-shot burst: exactly 8 particles spawned at fire time into the shared
// pool; done immediately.
//
// params: { x, y, color? } — color defaults to '#ffffff'.
// Speeds 100..180 px/s; angles evenly spaced (i / 8) * 2π.

import { particles } from '../particles.js';

const PICKUP_POP_COUNT = 8;
const PICKUP_POP_SPEED = [100, 180]; // px/s spread of the pop ring

/**
 * @param {{x:number, y:number, color?:string}} params
 * @returns {{update:Function, render:Function, done:boolean}}
 */
export function pickupPop(params = {}) {
  const { x, y, color = '#ffffff' } = params;
  for (let i = 0; i < PICKUP_POP_COUNT; i++) {
    // Evenly spaced angles give a clean "pop ring".
    const angle = (i / PICKUP_POP_COUNT) * Math.PI * 2;
    const speed = PICKUP_POP_SPEED[0] + Math.random() * (PICKUP_POP_SPEED[1] - PICKUP_POP_SPEED[0]);
    particles.spawnOne(x, y, color, speed, angle);
  }
  return { update() {}, render() {}, done: true };
}
