// World accessors — read-only getters over the shared mutable state context.
// Extracted from systems/update.js so render/debug/lifecycle modules can read
// world state without importing the orchestrator (which would be circular).
import { ctx } from './context.js';
import { projectilePool, specialPool } from '../objects/projectile.js';
import { particles, coins } from '../effects/particles.js';
import { Effects } from '../effects.js';
import { floatTexts } from '../hero/floatText.js';

export function getShakeOffset() { return Effects.getShakeOffset(); }

export function getHero() { return ctx.hero; }
export function getSolids() { return ctx.solids; }
export function getCollisionWorld() { return ctx.collisionWorld; }
export function getEnemies() { return []; }
// all live enemy entities (placeholder targets + jester) used by
// the 'clear' powerup effect. Excludes dead/dead-animating enemies.
export function getLiveEnemies() {
  const out = [];
  for (const e of ctx.realEnemies) {
    if (e.alive !== false && e.aiState !== 'dead') out.push(e);
  }
  return out;
}
// live thorns come from the shared pool (pooled, no allocation).
export function getProjectiles() { return projectilePool.activeItems; }
export function getSpecials() { return specialPool.activeItems; }
export function getPickups() { return []; }
export function getCamera() { return ctx.camera; }
// full real-enemy list (from generateLevel) for render/debug.
export function getRealEnemies() { return ctx.realEnemies; }
// the boss entity for render + debug.
export function getBoss() { return ctx.boss; }
/** The kind of the zone the hero is currently in ('area' | 'boss'). Used by
 *  render.js to gate boss-only visuals (debug box, HP bar) to the boss zone. */
export function getActiveZoneKind() { return ctx.getActiveZone(ctx.hero).kind; }
export function getParticles() { return particles; }
export function getCoins() { return coins; }
// barrels (explosive + coin) + explosion screen shake for render.
export function getBarrels() { return [...ctx.barrels, ...ctx.woodBarrels, ...ctx.coinBarrels]; }
export function getCoinBarrels() { return ctx.coinBarrels; }
// powerups, checkpoints, floating text for render + debug.
export function getPowerups() { return ctx.powerups; }
export function getCheckpoints() { return ctx.checkpoints; }
export function getFloatTexts() { return floatTexts; }
