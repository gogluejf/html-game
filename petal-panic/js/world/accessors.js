// World accessors — read-only getters over the shared mutable state context.
// Extracted from systems/update.js so render/debug/lifecycle modules can read
// world state without importing the orchestrator (which would be circular).
import { ctx } from './context.js';
import { roomFloorTop } from './level.js';
import { projectilePool } from '../objects/projectile.js';
import { isSpecialType } from '../objects/specialWeapons.js';
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
// Unified pool (Special folded into Projectile, task 1.3): thorns and typed
// specials live in the SAME pool, partitioned by `type`. getProjectiles() is
// the typeless shots; getSpecials() is the typed ones — the two partitions are
// disjoint and together cover every live entity in projectilePool.
export function getProjectiles() { return projectilePool.activeItems.filter(e => e.type == null); }
export function getSpecials() { return projectilePool.activeItems.filter(e => e.type != null && isSpecialType(e.type)); }
export function getPickups() { return []; }
export function getCamera() { return ctx.camera; }
// full real-enemy list (from generateLevel) for render/debug.
export function getRealEnemies() { return ctx.realEnemies; }
// the boss entity for render + debug.
export function getBoss() { return ctx.boss; }
/** The kind of the zone the hero is currently in ('area' | 'boss'). Used by
 *  render.js to gate boss-only visuals (debug box, HP bar) to the boss zone. */
export function getActiveZoneKind() { return ctx.getActiveZone(ctx.hero).kind; }
/** Top Y (screen px) of the ACTIVE room's floor — single source of truth for
 *  floor-anchored placement (lane sequences, spawns, debug tools). Returns
 *  null when no zone/hero context exists yet (e.g. attack theater pre-boot). */
export function getActiveFloorY() {
  const zone = ctx.getActiveZone?.(ctx.hero);
  if (!zone?.rooms?.length) return null;
  const room = zone.rooms.find((r) => r.id === zone.activeRoom) ?? zone.rooms[0];
  return roomFloorTop(room, zone.orientation);
}
export function getParticles() { return particles; }
export function getCoins() { return coins; }
// barrels (explosive + coin) + explosion screen shake for render.
export function getBarrels() { return [...ctx.barrels, ...ctx.woodBarrels, ...ctx.coinBarrels]; }
/**
 * Every damageable entity in the active zone — the single candidate set for
 * blast/explosion resolution. The blast's `team` flag does the filtering
 * (ally/foe/neutral); callers must NOT pre-filter this list by hand.
 */
export function getDamageables() {
  const out = [];
  if (ctx.hero?.alive) out.push(ctx.hero);
  for (const e of ctx.realEnemies) if (e.alive) out.push(e);
  if (ctx.boss?.alive) out.push(ctx.boss);
  for (const b of getBarrels()) if (b.alive) out.push(b);
  return out;
}
export function getCoinBarrels() { return ctx.coinBarrels; }
// powerups, checkpoints, floating text for render + debug.
export function getPowerups() { return ctx.powerups; }
export function getCheckpoints() { return ctx.checkpoints; }
export function getFloatTexts() { return floatTexts; }
