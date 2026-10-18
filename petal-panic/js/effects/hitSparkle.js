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

import { particles } from './particles.js';
import { BLOOD_COLORS } from './palettes.js';

const HIT_SPARKLE_COUNT = [3, 5];   // design §12: 3–5 red sparkles per hit
const HIT_SPARKLE_SPEED = [60, 140];
// How long the engine keeps this instance alive so it participates in the
// uniform update/render lifecycle. The pooled sparkles own their own visual
// lifetime (SPARKLE_LIFETIME); this just bounds the wrapper's active window to
// roughly the same span so the engine prunes it when the burst has faded.
const INSTANCE_LIFE = 0.5;

/**
 * @param {{x:number, y:number, count?:number}} params
 * @returns {{update:Function, render:Function, done:boolean, complete:Function}}
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
  // Real engine citizen: self-terminates over the burst's visual life instead
  // of reporting done immediately. The particles themselves are drawn by the
  // shared pool pass; this instance exists so the effect is tracked uniformly.
  let t = 0;
  return {
    update(dt) { t += dt; if (t >= INSTANCE_LIFE) this.complete(); },
    render() {}, // pool owns the draw
    done: false,
    complete() { this.done = true; },
  };
}
