// Petal Panic — particle-burst effect (catalog #1 "Particle Burst / Sparks",
// docs/architecture/effects.md). Generic sparkle burst from a point: the shared
// pool's spawnBurst() picks random warm colors and outward velocities. This is
// the engine-side home of the plain `particles.spawnBurst(x, y, n)` calls that
// still live in systems/update.js; the migration-era one-shots (hit sparkles,
// death sparkle, pickup pop, explosion) are their own types with directed
// palettes/speeds.
//
// One-shot burst: spawned at fire time into the shared pool; done immediately.
//
// params: { x, y, count? } — count defaults to 6 (pool default).

import { particles } from '../particles.js';

/**
 * @param {{x:number, y:number, count?:number}} params
 * @returns {{update:Function, render:Function, done:boolean}}
 */
export function particleBurst(params = {}) {
  const { x, y, count = 6 } = params;
  particles.spawnBurst(x, y, count);
  return { update() {}, render() {}, done: true };
}
