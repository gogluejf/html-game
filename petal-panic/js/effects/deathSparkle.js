// Petal Panic — death-sparkle effect (migrated from the pre-refactor monolith,
// js/effects.js `Effects.spawnDeathSparkle`; reference: .squid-os/plans/effect-engine/
// effect-reference.txt). Sprite-sized sparkle burst (design §12 "sparkle burst
// (sized to sprite)"): count scales with the sprite's pixel size so a big boss
// pops harder than a small flyer.
//
// One-shot burst via the shared pool's spawnBurst(); done at fire time.
//
// params: { x, y, size? } — size defaults to 32px.
// Count formula (unchanged): max(4, round(8 + size * 0.25)).

import { particles } from '../particles.js';

const DEATH_SPARKLE_BASE = 8; // baseline sparkle count at 32px sprite width

/**
 * @param {{x:number, y:number, size?:number}} params
 * @returns {{update:Function, render:Function, done:boolean}}
 */
export function deathSparkle(params = {}) {
  const { x, y, size = 32 } = params;
  const count = Math.max(4, Math.round(DEATH_SPARKLE_BASE + size * 0.25));
  particles.spawnBurst(x, y, count);
  return { update() {}, render() {}, done: true };
}
