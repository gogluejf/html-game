// Barrel / pool sync — keeps the collision world's live set in step with the
// barrel, coin, projectile, and special pools, and advances the VFX pools.
// Extracted from systems/update.js; reads/writes shared state via ctx.
import { ctx } from '../world/context.js';
import { LAYER } from '../consts.js';
import { VIEW_H } from '../core/view.js';
import { Effects } from '../effects.js';
import { particles, coins } from '../effects/particles.js';
import { resolveExplosion } from '../combat/explosion.js';
import { record } from '../stats.js';
import { Debug } from '../debug/debug.js';

/** Rebuild the dynamic solid registry (world boxes of every LIVE barrel). */
export function refreshBarrelSolidBoxes() {
  const boxes = ctx.barrelSolidBoxes;
  boxes.length = 0;
  for (const b of [...ctx.barrels, ...ctx.woodBarrels, ...ctx.coinBarrels]) {
    if (b.alive) boxes.push(b.worldBox());
  }
}

/**
 * Handle a barrel that just reached 0 HP. Runs the explosion AoE (damaging
 * barrel only), spawns VFX, drops coins for coin barrels, shakes the screen,
 * and removes the barrel from the collision world.
 * @param {GameObj} barrel the destroyed object
 */
export function handleBarrelDestroyed(barrel) {
  const hero = ctx.hero;
  const { cx, cy } = { cx: barrel.x + barrel.w / 2, cy: barrel.y + barrel.h / 2 };

  if (barrel.explosion) {
    // AoE damage to every live entity in radius (enemies + hero). The pure
    // resolveExplosion() routes through central damage(); we pass the full live set.
    // A barrel is a NEUTRAL blast: it hurts whoever stands in range (hero AND enemies)
    // and shoves everyone radially. Hero knockback is routed through takeHit('explosion')
    // inside resolveExplosion, preserving the exact pre-refactor rec/intangible behavior.
    // Same generic path as any other detonating entity — only the trigger differs.
    const targets = [hero, ...ctx.enemies, ...ctx.realEnemies];
    const result = resolveExplosion({
      ...barrel.explosion,
      cx, cy,
      self: barrel,
      ctx: { hero },
    }, targets);
    // Real enemies killed by the blast already ran their internal death pipeline
    // via takeDamage() inside resolveExplosion — no manual die() needed here.
    // track if the hero was hit by the explosion (design §4.1).
    if (result.hit.includes(hero)) {
      record(hero, { kind: 'hitTaken', source: 'explosion' });
    }
    // Legacy barrel explosion roll (pre-migration spawnExplosionVFX, preserved
    // verbatim): 12 + floor(rand*4) → 12–15 particles.
    const barrelCount = 12 + Math.floor(Math.random() * 4);
    Effects.spawnExplosion(cx, cy, result.radius, barrelCount); // engine path — warm fire burst sized to AoE
    Effects.bigExplosion(); // brief white screen flash (design §12)
    Effects.triggerShake(8); // engine path — barrel explosion shake
    // SFX: explosion
  } else if (barrel.coinDrop) {
    // Coin barrel (or any object with a coinDrop config): spawn the burst.
    coins.dropCoins(barrel.coinDrop, cx, cy);
    Effects.fireParticleBurst(cx, cy, 6); // engine path — plain sparkle burst
    // SFX: coin
  } else {
    // Wood barrel (plain): just breaks into wood-chip particles. No damage, no coins.
    Effects.fireParticleBurst(cx, cy, 8); // engine path — plain sparkle burst
    // SFX: break
  }

  // Remove the dead barrel from the collision world so it stops blocking.
  ctx.collisionWorld.remove(barrel);
  // Telemetry: count the destroyed barrel by type (design §4.1 barrelsDestroyed).
  const bkey = barrel.type; // 'woodBarrel' | 'barrel' | 'coinBarrel'
  record(hero, { kind: 'barrel', type: bkey });
  if (Debug.enabled) Debug.logEvent(`barrel destroyed (${bkey})`);
}

/** Keep the collision world's coin set in sync with the pool. */
export function syncCoinsToWorld() {
  const live = coins.activeItems;
  for (const e of ctx.collisionWorld.entities) {
    if (e.layer === LAYER.COIN && !live.includes(e)) ctx.collisionWorld.remove(e);
  }
  for (const c of live) {
    if (!ctx.collisionWorld.entities.has(c)) ctx.collisionWorld.add(c);
  }
}

/** Cull thorns that have flown past the level bounds (lifetime cull is in update). */
export function cullOffScreen(items) {
  for (const p of items) {
    const _zw = ctx.getActiveZone(ctx.hero).bounds; if (p.x + p.w < _zw.x || p.x > _zw.x + _zw.w || p.y + p.h < -40 || p.y > VIEW_H + 40) {
      p.alive = false;
    }
  }
}

/**
 * Keep the collision world's live set in sync with the pool: add newly-spawned
 * thorns, drop ones that died since last frame. The world skips !alive entities
 * each pass, so this only needs to handle membership churn.
 */
export function syncProjectilesToWorld() {
  const live = ctx.projectilePool.activeItems;
  // Remove dead projectiles still registered in the world.
  for (const e of ctx.collisionWorld.entities) {
    if (e.friendly && (e.layer === LAYER.PROJ_ALLY || e.layer === LAYER.PROJ_FOE) && !live.includes(e)) {
      ctx.collisionWorld.remove(e);
    }
  }
  // Add any live thorn not yet registered.
  for (const p of live) {
    if (!ctx.collisionWorld.entities.has(p)) ctx.collisionWorld.add(p);
  }
}

/** Sync live specials into the collision world (same pattern as projectiles). */
export function syncSpecialsToWorld() {
  const live = ctx.specialPool.activeItems;
  for (const e of ctx.collisionWorld.entities) {
    if (e.type === 'saw' || e.type === 'bomb') {
      if (!live.includes(e)) ctx.collisionWorld.remove(e);
    }
  }
  for (const s of live) {
    if (!ctx.collisionWorld.entities.has(s)) ctx.collisionWorld.add(s);
  }
}

// Advance particle + coin pools (called each frame regardless of jester state).
export function updateEffects(dt) {
  Effects.update(dt); // decay vignette / screen flash timers
  particles.updateAll(dt);
  // Coins bounce off the floor AND any air platform top they land on. We pass
  // the SOLIDS list minus the floor itself (the floor is handled by floorTop).
  const platforms = ctx.solids.slice(1); // index 0 is the full-length floor
  coins.updateAll(dt, ctx.FLOOR_TOP, ctx.getActiveZone(ctx.hero).bounds.w, platforms);
  // Sync coins into the collision world so HERO×COIN collect works.
  syncCoinsToWorld();
}
