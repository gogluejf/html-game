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

import { retainBombContact } from './attack/primitives/projectile.js';
import { LAYER } from '../consts.js';
import { heroDamage as damage, flashTarget } from './damage.js';
import { applyKnockback } from './knockback.js';
import { applyHit } from './hitResolution.js';
import { Team, AttackProvenance } from './targeting.js';
import { explodeSpecial } from './shooting.js';
import { isSpecialType } from '../objects/specialWeapons.js';
import { Effects } from '../effects.js';
import { Debug } from '../debug/debug.js';
import { record } from '../stats.js';
import { GameObj, Checkpoint } from '../objects/object.js';
import { applyObjectImpact } from './objectImpact.js';
import { SolidBox } from '../core/solidBox.js';
import { aabbOverlap } from '../core/collision.js';
import { Powerup } from '../objects/powerup.js';
import { COIN_TYPES } from '../objects/coin.js';
import { spawnFloatText } from '../hero/floatText.js';
import { formatAreaId } from '../systems/lifecycle.js';
import { onExitFlagReached } from '../world/zoneLifecycle.js';
import { getLiveEnemies } from '../systems/update.js';
import { ctx } from '../world/context.js';

// Top contacts are resolved before CollisionWorld dispatch. Only reflect a
// remaining overlap: never run minimum-penetration reflection on a resolved
// top (especially at corners). PLATFORM-layer one-way tops never dispatch here.

// Entry-edge impact point (tunneling correction) lives in the leaf module
// combat/entryImpact.js so the Attack Theater sandbox can import it without
// pulling in the gameplay chain. Imported here for local use; re-exported for
// existing consumers.
import { entryImpactPoint, snapToImpact } from './entryImpact.js';
export { entryImpactPoint, snapToImpact };

/** Star-power launch (mario star): how hard a touched enemy/boss gets flung.
 *  Vector = px/s: 420 horizontal away from the hero + 260 upward loft. */
const STAR_POWER_KNOCKBACK = Object.freeze({ x: 900, y: -450, hitstun: 0.5 });
/** Screen shake magnitude for a star-power kill. */
const STAR_POWER_SHAKE = 6;
/** Hit-stop length in fixed frames (~83ms at 60Hz — HANDOFF Part B default). */
const STAR_POWER_HITSTOP_FRAMES = 5;

/**
 * Star power (mario star): one-shot kill on contact while the star powerup is
 * active. Called from the ENEMY×HERO contact handler when hero.starPower is
 * set. The victim takes lethal damage through its normal pipeline
 * (Enemy.takeDamage → die() → death anim + sparkles + coins + kill count),
 * then gets a big launch impulse so the corpse flies off before it fades.
 * Juice: global hit-stop freeze + screen shake per kill.
 *
 * The boss is included deliberately: touching the elephant during star power
 * drains it like any other body (bossCanTakeDamage() was already checked by
 * the caller before this runs).
 * @param {object} hero  the star-powered hero (source of the kill)
 * @param {object} victim the touched enemy/boss body
 */
export function starPowerKill(hero, victim) {
  if (!victim || !victim.alive || victim.aiState === 'dead') return;
  // Lethal through the unified resolver (M3): one applyHit() carries damage +
  // knockback vector. CONTACT provenance is first-class in the eligibility
  // matrix (ALLY may strike ENEMY/BOSS/DESTRUCTIBLE), so the kill now fires
  // onHit/onDestroyed callbacks like every other hit. The launch — away from
  // the hero horizontally + strong upward loft — rides as context.knockback
  // and is applied by applyHit's reaction block via applyKnockback().
  // Defense-aware: takeDamage floors at (amt - defense), so a victim with
  // defense 1 would survive a "lethal" amt of maxHp by exactly 1 — add the
  // defense back in so the star truly one-shots.
  const def = victim.defense ?? victim.stats?.defense ?? 0;
  const amt = Math.max(victim.hp ?? 1, victim.stats?.stamina ?? 1) + def;
  const hcx = hero.x + hero.w / 2, vcx = victim.x + victim.w / 2;
  const dirX = Math.sign(vcx - hcx) || 1;
  // Popcorn scatter: ±15% per-axis jitter on the star launch vector. The star
  // is a chaos power — identical mirror-image arcs on every kick read
  // mechanical; small per-kick variation reads explosive. Center of mass is
  // unchanged (jitter is multiplicative around the tuned value).
  const jx = 0.85 + Math.random() * 0.3;
  const jy = 0.85 + Math.random() * 0.3;
  const res = applyHit({
    provenance: AttackProvenance.CONTACT,
    source: hero,
    target: victim,
    damage: amt,
    team: Team.ALLY,
    method: 'contact',
    knockback: { impulse: { x: STAR_POWER_KNOCKBACK.x * dirX * jx, y: STAR_POWER_KNOCKBACK.y * jy }, hitstun: STAR_POWER_KNOCKBACK.hitstun, ignoreVictimResistance: true },
    // Juice: freeze the whole sim for ~83ms. Rides the context so ONLY a
    // connected kill freezes time (rejected hits return before reactions).
    // Max-merge semantics mean overlapping kills hold the larger window.
    hitstop: STAR_POWER_HITSTOP_FRAMES,
  });
  // Ghost flight: ONLY star kills phase through terrain for the death anim —
  // the crazy pop is a star-power thing. Normal deaths keep plain physics
  // (gravity, ground friction, solid collision). Flag clears at despawn in
  // enemyUpdate's !alive branch.
  if (victim.aiState === 'dead') {
    victim.intangible = true;
  }
  Effects.triggerShake(STAR_POWER_SHAKE);
}

function hitSolidTerrain(projectile, target) {
  const box = target.worldBox();
  projectile._impactPoint = null;
  if (!aabbOverlap(projectile.worldBox(), box)) return;
  if (projectile.solidBehavior === 'reflect') {
    projectile.reflectVelocity(box);
  } else if (projectile.solidBehavior === 'stop') {
    projectile._impactPoint = entryImpactPoint(projectile, box);
    if (projectile._arcRecipe) projectile._attackHit = true;
    projectile.alive = false;
    if (projectile.type === 'bomb') snapToImpact(projectile, projectile._impactPoint);
    if (isSpecialType(projectile.type)) explodeSpecial(projectile);
  }
}

const CONTACT_COOLDOWN = 0.5; // seconds between contact hits from same enemy
// HERO-KICK forces (px/s). ONE RULE everywhere a hero gets kicked (bumper,
// stomp, explosion): normalize the line attacker-center → victim-center ×
// fixed force + ignoreVictimResistance — the kick IS the final velocity,
// geometry picks the angle for free. No if-top / if-side branches, no
// penetration axes, no hand-written shove vectors.
const BUMPER_FORCE = 420;   // i-frame contact: push you out, cleanly, any angle
const STOMP_FORCE = 493;    // head-bonk bounce (≈ the old 160/420 vector length)
const SIDE_HIT_FORCE = 420; // real contact hit, not on the head: same shape, tuned
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

    // --- Coins vs TERRAIN (COIN×SOLID rule). Same policy contract as
    // projectiles: solidBehavior is DATA on the entity. 'reflect' → bounce
    // off the surface via the shared reflectVelocity primitive. The floor
    // SolidBox is included here ON PURPOSE — this replaces the old hand-
    // rolled solid loop in CoinPool.updateAll (single engine path).
    const coinEnt = a.layer === LAYER.COIN ? a : (b.layer === LAYER.COIN ? b : null);
    if (coinEnt && coinEnt.solidBehavior === 'reflect') {
      const solid = coinEnt === a ? b : a;
      if (solid instanceof SolidBox) {
        coinEnt.reflectVelocity(solid.worldBox());
      }
      return;
    }

    // --- Friendly thorns (hero → enemy/barrel) --------------------------------
    const allyProj = a.layer === LAYER.PROJ_ALLY ? a : (b.layer === LAYER.PROJ_ALLY ? b : null);
    if (allyProj && allyProj.friendly) {
      if (!allyProj.alive) return;
      const target = allyProj === a ? b : a;

      // Friendly shot vs TERRAIN (SolidBox). Policy is DATA on the projectile
      // (solidBehavior), not a type check here:
      //   • 'phase'   — thorns/spread: no effect, they fly through terrain
      //   • 'stop'    — saws: the blade dies on impact (+ fizzle effect)
      //   • 'reflect' — bombs: bounce off the surface, keep flying; the fuse
      //                keeps running so they still detonate on timer/barrel
      if (target instanceof SolidBox) {
        hitSolidTerrain(allyProj, target);
        return;
      }

      if (retainBombContact(allyProj, target)) return;

      // Friendly shot hits a destructible solid (SOLID with an HP pool). The
      // shared object-impact op owns the whole contact: chip HP, consume the
      // shot, per-hit rewards and destruction aftermath (host callbacks via
      // ctx). Side hits arrive here through broadphase dispatch; TOP landings
      // arrive from stepBombTerrain's pre-terrain surface contact — both run
      // this exact operation, so top and side behave identically.
      if (target instanceof GameObj) {
        applyObjectImpact(allyProj, target, hero);
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
        allyProj.alive = false;
        return;
      }
      // Central damage routing: defense + telemetry in one place.
      // Real enemies route through takeDamage(), which OWNS the death transition
      // internally (hp<=0 -> die() -> death TTL). Placeholder targets (plain
      // Entity, no death pipeline) use raw damage() and are removed on death.
      const isRealEnemy = typeof target.takeDamage === 'function';
      // Entry-edge impact point for engine carriers (tunneling correction):
      // a fast shot is already inside the victim when this fires; rewind to
      // the contact edge so telegraphs/rings center where it actually hit.
      const ip = entryImpactPoint(allyProj, target.worldBox ? target.worldBox() : target);
      allyProj._impactPoint = ip ?? null;
      if (allyProj._arcRecipe) allyProj._attackHit = true;
      const dealt = isRealEnemy
        ? target.takeDamage(allyProj.damage, hero, 'projectile')
        : damage(hero, target, allyProj.damage, 'projectile');
      if (dealt > 0 && !isRealEnemy) {
        // Placeholder targets (plain Entity, no takeDamage pipeline): the
        // central damage() call above did not own the flash for them.
        flashTarget(target);
      }
      if (dealt > 0) {
        // red hit sparkles at the impact point + enemy shake
        // (design §12 "Projectile hit on enemy" / "Enemy damaged").
        Effects.spawnHitSparkles(allyProj.x + allyProj.w / 2, allyProj.y + allyProj.h / 2);
        Effects.beginEnemyShake(target);
        const srcName = isSpecialType(allyProj.type) ? allyProj.type : 'thorn';
        if (Debug.enabled) Debug.logEvent(`${srcName} → ${target.type ?? '?'} dmg ${dealt}`);
      }
      allyProj.alive = false;               // projectile is consumed on impact
      // Bomb detonation reads position; other carriers use the payload snapshot.
      if (allyProj.type === 'bomb') snapToImpact(allyProj, ip);
      // Specials explode/fizzle on contact via the single explodeSpecial().
      if (isSpecialType(allyProj.type)) {
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
      if (!foeProj.alive) return;
      const victim = foeProj === a ? b : a;
      // Match ally bomb terrain without changing ordinary enemy shots or
      // allowing foe projectiles to damage barrels.
      if (victim instanceof SolidBox && foeProj._arcRecipe) {
        hitSolidTerrain(foeProj, victim);
        return;
      }
      if (victim.layer !== LAYER.HERO) return;
      if (retainBombContact(foeProj, victim)) return;
      if (foeProj._arcRecipe) {
        foeProj._attackHit = true;
        foeProj._impactPoint = entryImpactPoint(foeProj, victim.worldBox ? victim.worldBox() : victim);
      }
      // Boss zone flow (boss-arena.md §2): the boss is untouchable before
      // COMBAT, so it fires no attacks during the intro either.
      if (foeProj === boss && !bossZone.bossCanTakeDamage()) { foeProj.alive = false; return; }
      // a hero mid-death takes no further damage (skull is playing).
      if (victim.dying) { foeProj.alive = false; return; }
      if (victim.invincible) { foeProj.alive = false; return; } // invincible absorbs it
      const dealt = damage(foeProj, victim, foeProj.damage, 'projectile');
      if (dealt > 0) {
        // Special loss (special-weapons.md): a hit that costs damage drops the
        // selected special. i-frame/protected paths early-return above (dealt==0).
        victim.loseSelectedSpecial();
        // Knockback along the projectile's travel direction + hit-stun + i-frames.
        // Only flinch/stun if actual energy was lost (shield-only = no reaction).
        if ((victim._lastEnergyLost ?? 0) > 0) {
          victim.takeHit({
            source: 'projectile',
            dirX: foeProj.vx, dirY: foeProj.vy,
          });
        }
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
    // Self-protection on connect (knockback.md ): a clean sweep connect
    // keeps the hero immune to contact damage until that
    // swing's active+recovery end. The flag is set by the unified hitbox
    // system on first connect and cleared by endSpecialMelee(); whiffs never
    // set it, so a missed swing leaves the hero fully exposed here.
    if (heroEnt.connectProtected) return;
    const amt = source.stats?.attack ?? 10;
    // STAR POWER still one-shots on touch even while blinking.
    if (heroEnt.starPower) starPowerKill(heroEnt, source);
    // ONE cooldown per enemy, shared by the real hit and the i-frame bump:
    // exactly one bump/hit per re-contact — never a per-frame slingshot.
    if (source._contactCd > 0) return;
    source._contactCd = CONTACT_COOLDOWN;
    // ONE RULE for every hero-kick (same shape as explosion): normalize the
    // line attacker-center to victim-center, multiply by a fixed force, and
    // ignoreVictimResistance so the kick IS the final velocity. Geometry picks
    // the angle for free. Force varies by case only:
    //   invincible contact -> BUMPER_FORCE (no damage, no i-frame refresh)
    //   stomp (feet in upper half, falling) -> STOMP_FORCE
    //   any other real contact -> SIDE_HIT_FORCE
    // No teleports, no penetration axes, no hand-written shove vectors: the
    // contact rule RE-FIRES every frame while boxes overlap (spaced by
    // _contactCd), so re-bumps shove you out until you clear.
    const hb3 = heroEnt.worldBox(), sb3 = source.worldBox();
    const dx = (hb3.x + hb3.w / 2) - (sb3.x + sb3.w / 2);
    const dy = (hb3.y + hb3.h / 2) - (sb3.y + sb3.w / 2);
    const len = Math.hypot(dx, dy) || 1;
    const feetInHead = hb3.y + hb3.h <= sb3.y + sb3.h * 0.5;
    const stomp = !heroEnt.invincible && feetInHead && (heroEnt.vy ?? 0) >= 0;
    const force = heroEnt.invincible ? BUMPER_FORCE : stomp ? STOMP_FORCE : SIDE_HIT_FORCE;
    const kb = {
      impulse: { x: (dx / len) * force, y: (dy / len) * force },
      ignoreVictimResistance: true,
    };
    if (heroEnt.invincible) {
      // I-FRAME BUMPER: same kick as a real hit but NO damage, NO i-frame
      // refresh. Rides applyKnockback() directly.
      kb.hitstun = 0.3;
      applyKnockback(heroEnt, kb);
      return;
    }
    // ONE door: applyHit() owns the damage AND the shove. The vector rides the
    // context and lands exactly when damage lands (immune heroes absorb both
    // via the resolver's immunity gate).
    if (stomp) {
      kb.hitstun = 0.15; kb.iFrames = 0.9;
    } else {
      kb.hitstun = 0.25; kb.iFrames = 0.60;
    }
    const res = applyHit({
      provenance: AttackProvenance.CONTACT,
      source,
      target: heroEnt,
      damage: amt,
      team: Team.FOE,
      method: 'contact',
      knockback: kb,
    });
    const dealt = res.dealt;
    if (dealt > 0) {
      // Special loss (special-weapons.md): a hit that costs damage drops the
      // selected special. i-frame/connect-protected paths early-return above.
      heroEnt.loseSelectedSpecial();
      // HEAD-LANDING BOUNCE: the velocity is already set by the stomp knockback
      // above (ignoreVictimResistance — impulse IS the final velocity). What's
      // left is what knockback can't do: snap the hero fully off the body so
      // the arc starts clean, and cover the ~0.56s round-trip arc with
      // invincibility so the fall-back never re-hits.
      if (stomp) {
        heroEnt.y = sb3.y - hb3.h;
        heroEnt.setInvincible('hit', Math.max(heroEnt.timers.get('invincible') ?? 0, 0.9));
      }
      // system so the existing invincible flag + render blink keep working.
      if (heroEnt.hitstunTimer > 0) {
        heroEnt.timers.set('rec', Math.max(heroEnt.timers.get('rec'), heroEnt.hitstunTimer));
        heroEnt.hitstunTimer = 0;
      }
      if (heroEnt.iFrameTimer > 0) {
        heroEnt.setInvincible('hit', Math.max(heroEnt.timers.get('invincible'), heroEnt.iFrameTimer));
        heroEnt.iFrameTimer = 0;
      }
      // Stamp the hit time so the HUD plays the 'hit' expression briefly.
      // (Contact damage doesn't route through takeHit(), which is the only
      // other place lastHitAt is set.)
      heroEnt.lastHitAt = performance.now();
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
