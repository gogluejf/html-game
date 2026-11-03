// Barrel / pool sync — keeps the collision world's live set in step with the
// barrel, coin, projectile, and special pools, and advances the VFX pools.
// Extracted from systems/update.js; reads/writes shared state via ctx.
import { ctx } from '../world/context.js';
import { LAYER } from '../consts.js';
import { VIEW_W, VIEW_H } from '../core/view.js';
import { roomFloorTop } from '../world/level.js';
import { Effects } from '../effects.js';
import { particles, coins } from '../effects/particles.js';
import { BARREL_DAMAGE, SUPERCOIN_BARREL_DEF } from './object.js';
import { invoke } from '../combat/attack/engine.js';
import '../combat/attack/primitives/explosion.js'; // registers the 'explosion' primitive
import { isSpecialType } from '../objects/specialWeapons.js';
import { getDamageables } from '../world/accessors.js';
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
    // Engine-owned blast: the explosion primitive resolves damage AND owns all
    // VFX (particle burst, explode sheet art, screen flash, camera shake) —
    // same path as the bomb macro. A barrel is a NEUTRAL blast: it hurts whoever
    // stands in range (hero AND enemies) and shoves everyone radially. The full
    // damageable set is passed; the team flag does the filtering.
    const targets = getDamageables();
    const h = invoke('explosion', {
      x: cx, y: cy,
      radius: barrel.explosion.radius,
      damage: barrel.explosion.damage ?? BARREL_DAMAGE,
      team: barrel.explosion.team ?? 'neutral',
      knockback: barrel.explosion.knockback,
      self: barrel,
      targets,
    }, { attacker: barrel, world: { hero, targets } });
    // Real enemies killed by the blast already ran their internal death pipeline
    // via takeDamage() inside the primitive — no manual die() needed here.
    // track if the hero was hit by the explosion (design §4.1).
    if (h._lastResult?.hit?.includes(hero)) {
      record(hero, { kind: 'hitTaken', source: 'explosion' });
    }
  } else if (barrel.type === SUPERCOIN_BARREL_DEF.id) {
    // Super-coin barrel: big final coin burst launched high into the sky, plus
    // screen shake + white flash (explosion-feel) but NO blast damage and NO
    // explosion art — just the regular barrel-break particles + the coin shower.
    coins.dropCoinsIntense(barrel.coinDrop, cx, cy);
    Effects.fireParticleBurst(cx, cy, 8);   // regular barrel-break particles
    Effects.bigExplosion(0.9);              // white screen flash
    Effects.triggerShake(14);               // camera shake
    // SFX: big coin burst
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

/**
 * Per-hit popcorn for the super-coin barrel: on every landed hit (not just
 * destruction) coins pop out, scaled by the damage dealt (base min-max per
 * `perDamage` points — a bomb pops ~4x a thorn). The killing blow scales by
 * its FULL damage (overkill included), then the fixed final burst fires on top.
 * @param {GameObj} barrel the struck super-coin barrel
 * @param {number} dmg damage actually applied by this hit
 */
export function popSuperCoinHit(barrel, dmg = 0) {
  if (!barrel || barrel.type !== SUPERCOIN_BARREL_DEF.id || !barrel.def?.hitCoins) return;
  const cx = barrel.x + barrel.w / 2;
  const cy = barrel.y + barrel.h / 2;
  const per = barrel.def.hitCoins.perDamage ?? 10;
  const mult = Math.max(1, dmg / per); // never less than one base pop
  coins.popHitCoins({ ...barrel.def.hitCoins, mult }, cx, cy);
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

/** Cull thorns that have flown past the visible camera bounds (lifetime cull is in update). */
export function cullOffScreen(items) {
  const cam = ctx.camera;
  // Camera-relative bounds: works for any zone height (horizontal, vertical, future).
  const top = cam ? cam.y - 40 : -40;
  const bottom = cam ? cam.y + cam.h + 40 : VIEW_H + 40;
  const left = cam ? cam.x - 40 : -40;
  const right = cam ? cam.x + cam.w + 40 : VIEW_W + 40;
  for (const p of items) {
    if (p.x + p.w < left || p.x > right || p.y + p.h < top || p.y > bottom) {
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
    if (isSpecialType(e.type)) {
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
  const _cz = ctx.getActiveZone(ctx.hero);
  const _cr = _cz.rooms.find((r) => r.id === _cz.activeRoom) ?? _cz.rooms[0];
  coins.updateAll(dt, roomFloorTop(_cr, _cz.orientation), _cr.w, platforms);
  // Sync coins into the collision world so HERO×COIN collect works.
  syncCoinsToWorld();
}
