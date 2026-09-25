// Collision-event handlers for the shared CollisionWorld (combat/).
//
// These five `collisionWorld.on(...)` subscriptions were extracted from
// systems/update.js so combat interaction logic lives with the rest of the
// combat system. They are registered once by registerCollisionHandlers(),
// which update.js calls after the hero is added to the collision world.
//
// Shared mutable state (hero, boss, bossZone, collisionWorld, coins) is read
// through the single context object (world/context.js) rather than importing
// update.js directly — that keeps the dependency graph acyclic.

import { LAYER } from '../consts.js';
import { damage } from './damage.js';
import { applyKnockback } from './knockback.js';
import { explodeSpecial } from './shooting.js';
import { Effects } from '../effects.js';
import { Debug } from '../debug/debug.js';
import { record } from '../stats.js';
import { GameObj, Checkpoint } from '../objects/object.js';
import { Powerup } from '../objects/powerup.js';
import { COIN_TYPES } from '../objects/coin.js';
import { spawnFloatText } from '../hero/floatText.js';
import { formatAreaId } from '../systems/lifecycle.js';
import { onExitFlagReached } from '../world/zoneLifecycle.js';
import { getLiveEnemies } from '../systems/update.js';
import { ctx } from '../world/context.js';

const CONTACT_COOLDOWN = 0.5; // seconds between contact hits from same enemy
const ONEUP_THRESHOLD = 100;  // total coins collected per extra life (design §14)
let oneUpProgress = 0;        // running count toward the next 1up

/**
 * Format the area identifier for the 'X-Y CLEAR' banner. The area being
 * cleared is the one the hero is currently in (heroEnt.currentArea).
 * @param {number} currentArea the area index the hero is in
 * @returns {string} the area id (e.g. '1-1')
 */
function formatAreaIdForClear(currentArea) {
  // Zone-model area (1..4 or AREA_BOSS) is passed straight through to
  // formatAreaId (1..4 → 'X-N', AREA_BOSS → 'X-B').
  return formatAreaIdSafe(ctx.hero.currentLevel, currentArea);
}

/**
 * Safe wrapper around lifecycle's formatAreaId that falls back to a
 * positional id when the level definition is unavailable.
 */
function formatAreaIdSafe(level, area) {
  try {
    // formatAreaId is imported from lifecycle.js at the top of the module.
    return formatAreaId(level, area);
  } catch {
    return area >= 5 ? `${level}-B` : `${level}-${area}`;
  }
}

/**
 * Register all collision-world event handlers. Called once by update.js after
 * the hero is added to the collision world. The CollisionWorld instance is
 * passed in because ctx.collisionWorld is not yet wired at registration time;
 * the other shared state (hero, boss, bossZone, coins) is read through `ctx`
 * inside the handler callbacks, which only fire during gameplay — by then ctx
 * is fully wired.
 */
export function registerCollisionHandlers(collisionWorld) {

  // friendly thorns hit ENEMY/BOSS (PROJ_ALLY rule). Apply damage and
  // cull the projectile on impact. This is the ONLY place a PROJ_ALLY can interact
  // with an enemy; there is no PROJ_ALLY↔HERO rule, so friendly-fire stays off.
  collisionWorld.on('hit', (a, b) => {
    const hero = ctx.hero;
    const boss = ctx.boss;
    const bossZone = ctx.bossZone;

    // --- Friendly thorns (hero → enemy/barrel) --------------------------------
    const allyProj = a.layer === LAYER.PROJ_ALLY ? a : (b.layer === LAYER.PROJ_ALLY ? b : null);
    if (allyProj && allyProj.friendly) {
      const target = allyProj === a ? b : a;

      // friendly thorn hits a barrel (SOLID with an HP pool). Chip its
      // HP; on destruction the barrel explodes (AoE + VFX) and is removed from the
      // world. Thorns are consumed on impact either way.
      if (target instanceof GameObj) {
        const dealt = target.hit(allyProj.damage, hero, 'projectile');
        if (dealt > 0) {
          allyProj.alive = false;
          if (target.destroyed) ctx.handleBarrelDestroyed(target);
        } else {
          allyProj.alive = false; // hit an already-destroyed solid — still consumed
        }
        // Specials explode/fizzle on barrel contact too.
        if (allyProj.type === 'saw' || allyProj.type === 'bomb') {
          explodeSpecial(allyProj);
        }
        return;
      }

      if (target.layer !== LAYER.ENEMY && target.layer !== LAYER.BOSS) return;
      if (target.hp == null) return;       // non-target placeholder (e.g. anim test box)
      // Boss zone flow (boss-arena.md §2): the boss cannot take damage before
      // COMBAT — the presentation must not imply it is attackable. The
      // projectile passes through (is consumed) but deals no damage.
      if (target === boss && !bossZone.bossCanTakeDamage()) {
        allyProj.alive = false;
        return;
      }
      // boss weak point: thorns landing in the head/trunk zone deal
      // WEAK_POINT_MULT× damage. Compute the impact point from the projectile's
      // center and route through the boss's takeDamage() for the bonus.
      if (target.isBoss && typeof target.isWeakPointHit === 'function') {
        const px = allyProj.x + allyProj.w / 2;
        const py = allyProj.y + allyProj.h / 2;
        // takeDamage() owns the death transition internally (hp<=0 -> die()).
        const dealt = target.takeDamage(allyProj.damage, hero, 'projectile', { x: px, y: py });
        if (dealt > 0) target.hitFlash = 0.1;
        allyProj.alive = false;
        return;
      }
      // Central damage routing: defense + telemetry in one place.
      // Real enemies route through takeDamage(), which OWNS the death transition
      // internally (hp<=0 -> die() -> death TTL). Placeholder targets (plain
      // Entity, no death pipeline) use raw damage() and are removed on death.
      const isRealEnemy = typeof target.takeDamage === 'function';
      const dealt = isRealEnemy
        ? target.takeDamage(allyProj.damage, hero, 'projectile')
        : damage(hero, target, allyProj.damage, 'projectile');
      if (dealt > 0 && !isRealEnemy) {
        target.hitFlash = 0.1; // brief white flash on impact
      }
      if (dealt > 0) {
        // red hit sparkles at the impact point + enemy shake
        // (design §12 "Projectile hit on enemy" / "Enemy damaged").
        Effects.spawnHitSparkles(allyProj.x + allyProj.w / 2, allyProj.y + allyProj.h / 2);
        Effects.beginEnemyShake(target);
        const srcName = allyProj.type === 'saw' || allyProj.type === 'bomb' ? allyProj.type : 'thorn';
        if (Debug.enabled) Debug.logEvent(`${srcName} → ${target.type ?? '?'} dmg ${dealt}`);
      }
      allyProj.alive = false;               // projectile is consumed on impact
      // Specials explode/fizzle on contact via the single explodeSpecial().
      if (allyProj.type === 'saw' || allyProj.type === 'bomb') {
        explodeSpecial(allyProj);
      }
      // Placeholders have no death anim: remove immediately when they die. Real
      // enemies play their internal death pipeline (handled by updateRealEnemies).
      if (!isRealEnemy && !target.alive) {
        collisionWorld.remove(target);
      }
      return;
    }

    // --- Foe projectiles (enemy → hero), ----------------------------
    // Violetta's shots and Boris Loon's dive-shots are unfriendly (PROJ_FOE). They
    // only ever hit the hero (PROJ_FOE×HERO rule); there is no PROJ_FOE↔ENEMY rule
    // so they can't self-damage. Route through central damage() and consume the
    // shot on impact. Respects the hero's invincibility window.
    const foeProj = a.layer === LAYER.PROJ_FOE ? a : (b.layer === LAYER.PROJ_FOE ? b : null);
    if (foeProj && !foeProj.friendly) {
      const victim = foeProj === a ? b : a;
      if (victim.layer !== LAYER.HERO) return;
      // Boss zone flow (boss-arena.md §2): the boss is untouchable before
      // COMBAT, so it fires no attacks during the intro either.
      if (foeProj === boss && !bossZone.bossCanTakeDamage()) { foeProj.alive = false; return; }
      // a hero mid-death takes no further damage (skull is playing).
      if (victim.dying) { foeProj.alive = false; return; }
      if (victim.intangible) { foeProj.alive = false; return; } // intangible absorbs it
      const dealt = damage(foeProj, victim, foeProj.damage, 'projectile');
      if (dealt > 0) {
        // Knockback along the projectile's travel direction + hit-stun + i-frames.
        // Contextual profile by source (design §25): ordinary foe shot.
        victim.takeHit({
          source: 'projectile',
          dirX: foeProj.vx, dirY: foeProj.vy,
        });
        // red vignette when the hero takes damage (design §12).
        Effects.heroDamaged();
        // track hits taken from enemy projectiles (design §4.1).
        record(victim, { kind: 'hitTaken', source: 'enemyProjectile' });
      }
      foeProj.alive = false; // consumed on impact
      // SFX: hit
    }
  });

  // ENEMY × HERO contact damage (jester body touching hero drains energy).
  // The COLLISION_RULES table has {a:HERO, b:ENEMY, action:'contact'}; this fires
  // when the hero overlaps an enemy's body box. We drain the hero's energy via
  // central damage() (enemy as source, hero as target). A per-enemy cooldown
  // prevents multi-hit drain every frame while overlapping.
  collisionWorld.on('contact', (a, b) => {
    const boss = ctx.boss;
    const bossZone = ctx.bossZone;

    // the boss is a BOSS-layer entity; treat it like an enemy for
    // contact damage (touching the elephant drains hero energy at its high attack).
    const enemyEnt = a.layer === LAYER.ENEMY ? a : (b.layer === LAYER.ENEMY ? b : null);
    const bossEnt = a.layer === LAYER.BOSS ? a : (b.layer === LAYER.BOSS ? b : null);
    const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
    const source = enemyEnt || bossEnt;
    if (!source || !heroEnt) return;
    // no contact damage while the hero is mid-death.
    if (heroEnt.dying) return;
    if (!source.alive || source.aiState === 'dead') return; // dead enemies don't hurt
    // Boss zone flow (boss-arena.md §2): the boss is untouchable before COMBAT.
    if (source === boss && !bossZone.bossCanTakeDamage()) return;
    // i-frames absorb contact hits (prevents melt while overlapping). takeHit()
    // returns false when invincible, so we skip damage + cooldown in that case.
    if (heroEnt.intangible) return;
    // Self-protection on connect (knockback.md ): a clean sweep or
    // cartwheel connect keeps the hero immune to contact damage until that
    // swing's active+recovery end. The flag is set by the unified hitbox
    // system on first connect and cleared by endSpecialMelee(); whiffs never
    // set it, so a missed swing leaves the hero fully exposed here.
    if (heroEnt.connectProtected) return;
    if (source._contactCd > 0) return;
    source._contactCd = CONTACT_COOLDOWN;
    const amt = source.stats?.attack ?? 10;
    const dealt = damage(source, heroEnt, amt, 'contact');
    // Body-contact knockback (§9): a single velocity-scaled rule carried on the
    // enemy. Idle enemies shove less than charging ones (motion term); bosses
    // read harder through their larger base + speed, not a separate category.
    if (dealt > 0) {
      const hcx = heroEnt.x + heroEnt.w / 2, scx = source.x + source.w / 2;
      const dirX = Math.sign(hcx - scx) || (heroEnt.facing * -1);
      // Build the push normal (horizontal away from attacker + small upward pop).
      const rawLen = Math.hypot(dirX, -0.6) || 1;
      const normal = { x: dirX / rawLen, y: -0.6 / rawLen };
      applyKnockback(heroEnt, source, source.bodyKnockback, normal);
      // Route applyKnockback's plain-field results into the hero's unified timer
      // system so the existing intangible flag + render blink keep working.
      if (heroEnt.hitstunTimer > 0) {
        heroEnt.timers.set('rec', Math.max(heroEnt.timers.get('rec'), heroEnt.hitstunTimer));
        heroEnt.hitstunTimer = 0;
      }
      if (heroEnt.iFrameTimer > 0) {
        heroEnt.intangible = true;
        heroEnt.timers.set('intangible', Math.max(heroEnt.timers.get('intangible'), heroEnt.iFrameTimer));
        heroEnt.iFrameTimer = 0;
      }
      // red vignette on contact damage (design §12 "Hero damaged").
      Effects.heroDamaged();
      // track hits taken from enemy contact (design §4.1).
      record(heroEnt, { kind: 'hitTaken', source: 'enemyContact' });
    }
  });

  // HERO × COIN collection (design §14). Fires when the hero's box
  // overlaps a live coin's box. We credit the coin's value to the hero, bump the
  // per-type + total counters, spawn a small sparkle burst at the pickup point,
  // and remove the coin from both the pool and the collision world. The 1up
  // threshold (every 100 total coins → +1 life) is checked here so it fires the
  // moment the counter crosses the boundary.
  collisionWorld.on('collect', (a, b) => {
    const coins = ctx.coins;

    const coinEnt = a.layer === LAYER.COIN ? a : (b.layer === LAYER.COIN ? b : null);
    const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
    if (!coinEnt || !heroEnt) return;
    if (coinEnt.collected || !coinEnt.alive) return; // already credited (guard)

    // Credit the hero + stats.
    const type = coinEnt.coinType ?? 'bronze';
    const value = coinEnt.value ?? COIN_TYPES.bronze.value;
    heroEnt.coins += value;
    record(heroEnt, { kind: 'coin', type });

    // Pickup VFX: a small sparkle burst at the coin's center (reuses the pooled
    // particle system; no allocation). SFX hook for later audio wiring.
    const cx = coinEnt.x + coinEnt.w / 2;
    const cy = coinEnt.y + coinEnt.h / 2;
    Effects.fireParticleBurst(cx, cy, 4); // engine path (single fire path) — plain sparkle burst
    // SFX: coin

    // Mark collected (latches so the pair can't double-credit next frame) and
    // remove from the pool + collision world.
    coinEnt.collect();
    coins.remove(coinEnt);
    collisionWorld.remove(coinEnt);
    if (Debug.enabled) Debug.logEvent(`coin ${type} +${value}`);

    // 1up check: every ONEUP_THRESHOLD total coins grants +1 life.
    oneUpProgress += 1;
    if (oneUpProgress >= ONEUP_THRESHOLD) {
      oneUpProgress -= ONEUP_THRESHOLD;
      heroEnt.lives += 1;
      // SFX: 1up
    }
  });

  // HERO × PICKUP powerup collection (design §10). Fires when the
  // hero's box overlaps a live powerup. We apply the documented effect via
  // Powerup.collect() (which latches + bumps telemetry), spawn a sparkle pop at
  // the pickup point, float the effect label above it, and remove the powerup
  // from the collision world. The 'clear' effect needs the live enemy list, so
  // we pass it through context.
  collisionWorld.on('pickup', (a, b) => {
    const pu = a.layer === LAYER.PICKUP ? a : (b.layer === LAYER.PICKUP ? b : null);
    const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
    if (!pu || !heroEnt) return;
    if (!(pu instanceof Powerup)) return; // ignore non-powerup pickups
    if (pu.collected || !pu.alive) return; // already collected (guard)

    const cx = pu.x + pu.w / 2;
    const cy = pu.y + pu.h / 2;

    // Apply the effect with access to the live enemy set (for 'clear').
    const applied = pu.collect(heroEnt, { enemies: getLiveEnemies() });
    if (!applied) return;

    // VFX: sparkle pop + floating label text (design §12 "Powerup pickup").
    Effects.fireParticleBurst(cx, cy, 6); // engine path — plain sparkle burst
    Effects.spawnPickupPop(cx, cy, pu.def.color); // colored pop ring
    spawnFloatText(cx, cy - 16, pu.def.label, pu.def.color);
    // SFX: powerup
    if (Debug.enabled) Debug.logEvent(`powerup ${pu.def.label}`);

    collisionWorld.remove(pu);
  });

  // HERO × CHECKPOINT trigger (design §10/§13). Fires when the hero's
  // box overlaps a checkpoint flag. Checkpoint.trigger() stores its position on
  // hero.checkpoint (used by the death-restart pipeline) and latches so re-walking
  // over it is a no-op. A brief flash plays via the entity's flashTimer.
  collisionWorld.on('checkpoint', (a, b) => {
    const cp = a.layer === LAYER.CHECKPOINT ? a : (b.layer === LAYER.CHECKPOINT ? b : null);
    const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
    if (!cp || !heroEnt) return;
    if (!(cp instanceof Checkpoint)) return;
    // Entry flags are naive sprites: zero collision effect, no trigger, no VFX.
    if (cp.isEntry) return;
    if (cp.triggered) return; // already triggered this run
    // DEBUG: log exit-flag overlaps to diagnose trigger issues.
    console.log(`[checkpoint] ${cp.checkpointId} hero.area=${heroEnt.currentArea} hero.x=${Math.round(heroEnt.x)} cp.x=${cp.x}`);

    const fired = cp.trigger(heroEnt);
    if (!fired) return;

    // (checkpoint hits are no longer tracked in the stats model)

    // VFX: flash (entity-driven) + floating id label.
    const cx = cp.x + cp.w / 2;
    const cy = cp.y + cp.h / 2;
    Effects.fireParticleBurst(cx, cy, 5); // engine path — plain sparkle burst
    spawnFloatText(cx, cy - 20, `CHECKPOINT ${cp.checkpointId}`, '#ffd700');
    // SFX: checkpoint

    // checkpoints.md §1/§2, structure.md §2: a checkpoint marks an area
    // boundary. In the sealed-zone model each zone owns its OWN entry flag
    // (index 0 in its checkpoint list) and its OWN exit flag (index 1); the
    // indices restart per zone, so progression must use the ZONE MODEL, not a
    // global checkpoint index. Reaching the active zone's EXIT flag clears the
    // area (flash + 'X-Y CLEAR' banner + fade out) and advances to the next
    // zone. The -4 exit is the boss checkpoint (boss-arena.md §1): it routes
    // into the boss zone, whose content is loaded on the advance.
    const zone = ctx.getActiveZone(heroEnt);
    if (zone.kind !== 'area') return; // boss zone has no exit flag
    // The next area in the zone model: areas 1 → 2 → 3 → 4 → boss.
    // The 4 exit routes into the boss zone (boss-arena.md §1).
    const nextArea = zone.areaIdx === 4 ? ctx.AREA_BOSS : zone.areaIdx + 1;
    const clearedAreaId = formatAreaIdForClear(heroEnt.currentArea);
    // checkpoints.md §2: begin the clear sequence (flash + banner + fade).
    onExitFlagReached(clearedAreaId, nextArea);
  });
}
