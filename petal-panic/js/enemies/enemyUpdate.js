// Real-enemy update — drives every real Enemy's AI state machine, physics
// integration, per-type attack hitbox check, solid collision, and death
// pipeline (sparkle burst + coin drop on full death). The jester-specific whip
// logic is generalized into a per-enemy "attack hitbox" accessor so one loop
// covers all six types.
// All shared mutable state is read/written through ctx (world/context.js) to
// avoid a circular import back into systems/update.js.

import { ctx } from '../world/context.js';
import { resolve } from '../core/collision.js';
import { LAYER } from '../consts.js';
import { Effects } from '../effects.js';
import { resolveExplosion } from '../combat/explosion.js';
import { record } from '../stats.js';
import { Debug } from '../debug/debug.js';
import { coins } from '../effects/particles.js';

/**
 * Per-frame step for a single real enemy. Called from updateRealEnemies().
 * @param {Enemy} e the enemy entity
 * @param {number} dt seconds
 */
function updateRealEnemy(e, dt) {
  // Decay contact cooldown (shared by all real enemies via the 'contact' rule).
  if (e._contactCd > 0) e._contactCd -= dt;

  // AI + gravity + integrate (base Enemy.update handles all of this). Flyers
  // have gravity 0 so they never fall; grounders do not.
  // BLOCKER 5: the AI receives the collision world, not the buildWorld record.
  e.update(dt, ctx.hero, ctx.collisionWorld);

  // Resolve against solids (static platforms + live barrels) so grounders
  // don't walk through platforms or barrels. Flyers skip solid resolution
  // (they fly over/through them by design). Dying enemies (aiState === 'dead')
  // still resolve: their death pipeline integrates vx/vy + gravity, so a body
  // knocked back mid-death must land on platforms and slide along the ground
  // instead of ghosting through floors. Resolution stops only when alive
  // flips to false (death fade complete), at which point updateRealEnemy()
  // removes the entity from the collision world.
  if (e.alive && e.gravity > 0) {
    resolve(e, [...ctx.solids, ...ctx.barrelSolidBoxes]);
  }

  // Lethal fall cull (mirrors the hero's isBelowVerticalBottom rule): an enemy
  // that drops below the active zone's floor has no surface left — kill it
  // immediately so it can't linger as a phantom in the collision world
  // (observed: a Jack-O-Lantern fell to y≈24,000 while staying registered).
  // The normal death pipeline (sparkles + coins + world removal) still runs
  // via the !e.alive branch below; _deathHandled guards against double-credit.
  const zw = ctx.getActiveZone(ctx.hero)?.bounds;
  if (zw && e.alive && e.y > zw.y + zw.h + 200) {
    e.alive = false;
  }

  // Attack hitbox: now handled by the unified processAllHitboxes() system.
  // The old inline check is removed; enemy hitboxes register as team:'foe'
  // and the generic loop routes them against the hero.
  const atkHb = getAttackHitbox(e);
  if (!atkHb) e._atkHitDone = false; // reset when window closes (hitbox system uses its own hitSet)

  // Explosion (generic): any entity that carries an `explosion` property and has
  // latched its detonation fires the AoE blast here — the SAME path a barrel uses.
  // The only per-source difference is WHEN the trigger fires: barrels detonate on
  // destruction, the Jack-O-Lantern latches `exploded` when it blows up. No
  // instanceof checks; the engine reads e.explosion and resolves uniformly.
  if (e.explosion && e.exploded && !e._explodeHandled) {
    e._explodeHandled = true;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const targets = [ctx.hero, ...ctx.enemies, ...ctx.realEnemies];
    const result = resolveExplosion({
      ...e.explosion,
      cx, cy,
      self: e,
      ctx: { hero: ctx.hero },
    }, targets);
    // Legacy enemy-death explosion roll (pre-migration spawnExplosionVFX,
    // preserved verbatim): 12 + floor(rand*4) → 12–15 particles.
    const deathCount = 12 + Math.floor(Math.random() * 4);
    Effects.spawnExplosion(cx, cy, result.radius, deathCount); // engine path — warm fire burst sized to AoE
    Effects.bigExplosion(); // screen flash on big explosion
    Effects.triggerShake(6); // engine path — camera-shake singleton
    // SFX: explosion
  }

  // Death pipeline completion: when alive flips to false after the anim,
  // spawn sparkles + coins and remove from the collision world.
  if (!e.alive && !e._deathHandled) {
    e._deathHandled = true;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    Effects.fireParticleBurst(cx, cy, 7);          // engine path — plain sparkle burst
    Effects.spawnDeathSparkle(cx, cy, Math.max(e.w, e.h)); // sprite-sized burst
    coins.dropCoins(e.coinDrop, cx, cy);      // coin drop per config
    ctx.collisionWorld.remove(e);                          // drop from play
    // Telemetry: count the kill by type (design §4.1 enemiesKilled).
    record(ctx.hero, { kind: 'enemyKilled', type: e.type });
    ctx.hero.wallet.current.kills += 1; // farming-safe wallet tally (resets on death)
    if (Debug.enabled) Debug.logEvent(`kill ${e.type}`);
  }
}

/**
 * Resolve the current active attack hitbox for a real enemy, or null when no
 * damage should be dealt this frame. Each type stores its own getter name; the
 * jester uses whipHitboxWorld, the vine hound lungeHitboxWorld, violetta
 * meleeHitboxWorld. Boris Loon has no melee hitbox (it attacks via dive/contact
 * + projectile).
 * @param {Enemy} e
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
function getAttackHitbox(e) {
  if (e.whipHitboxWorld != null) return e.whipHitboxWorld;       // jester
  if (e.lungeHitboxWorld != null) return e.lungeHitboxWorld;     // vine hound
  if (e.meleeHitboxWorld != null) return e.meleeHitboxWorld;     // violetta
  return null;
}

/**
 * Advance every real enemy this step. Called from update() in place of the old
 * single-jester call.
 * @param {number} dt seconds
 */
export function updateRealEnemies(dt) {
  for (const e of ctx.realEnemies) {
    if (e === undefined || e === null) continue;
    updateRealEnemy(e, dt);
  }
}
