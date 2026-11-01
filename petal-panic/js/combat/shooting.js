// Shooting (special-weapons.md) — ONE shared shoot path: J fires whatever
// weapon is currently SELECTED on the hero. The default weapon ('thorn') is
// built-in and infinite; a numeric selectedWeapon is a special-weapon slot
// index holding any id from SPECIAL_TYPES. N never fires — it only rotates the
// selection (hero.rotateWeapon, called by the update step).

import { projectilePool, specialPool, SPECIAL_WEAPON_DEFS, getSpecialSpriteData } from '../objects/projectile.js';
import { fireManual } from '../effects/index.js';
import { specialById, isSpecialType } from '../objects/specialWeapons.js';
import { dirAngle } from '../core/vec.js';
import { damage } from './damage.js';
import { record } from '../stats.js';
import { Effects } from '../effects.js';
import { Debug } from '../debug/debug.js';
import { invoke } from './attack/engine.js';
import '../combat/attack/primitives/projectile.js'; // registers the 'projectile' primitive

import { ctx } from '../world/context.js';

/**
 * Attempt to fire the hero's selected weapon this step. Dispatches on
 * h.selectedWeapon; each branch consumes that weapon's OWN ammo pool and sets
 * its OWN cooldown.
 * @param {Hero} h the firing hero
 * @param {object} input current intent (shoot/lockMove/aimX/aimY/...)
 * @param {number} dt seconds
 */
export function tryFire(h, input, dt) {
  if (!input.shoot) return;
  if (Number.isInteger(h.selectedWeapon)) {
    fireSpecial(h, input);
  } else {
    // Default workhorse: fast, straight thorns — built-in, no pool.
    fireThorn(h, input, dt);
  }
}

/** Fire one Thorn (default weapon): routed through the Attack Engine's
 * `projectile` primitive. The default weapon is built-in and infinite — no
 * ammo pool; only the fireCooldown gates rate of fire.
 *
 * The primitive spawns into the SAME projectilePool with the SAME defaults the
 * old inline path used (speed 600, damage 10, ttl 2, solidBehavior 'phase'), so
 * trajectory/damage/lifetime are identical. Aim comes from resolveAim() (an
 * 8-way index); the engine never takes a target entity. */
function fireThorn(h, input, dt) {
  if (h.fireCooldown > 0) return;

  const dir = h.resolveAim(input);
  const angle = dirAngle(dir);
  const { x: cx, y: cy } = h.bodyCenter();
  // Muzzle point: 16px out along the aim from the body center (matches the old
  // offset). The primitive centers the shot's box on this exact point.
  const ox = Math.cos(angle) * 16;
  const oy = Math.sin(angle) * 16;

  const shot = invoke('projectile', {
    origin: { x: cx + ox, y: cy + oy },
    direction: angle,      // radians (the engine expects radians, NOT an 8-way index)
    speed: 600,            // PROJECTILE_SPEED
    damage: 10,            // PROJECTILE_DAMAGE
    ttl: 2,                // PROJECTILE_LIFETIME
    team: 'ally',
    solidBehavior: 'phase',// thorns fly through terrain (old default)
    size: null,            // keep the entity's natural sheet box (not a forced square)
  }, makeHeroContext(h));
  if (!shot?.entity) return; // pool exhausted (soft cap) → skip, like the old `if (!p)`

  record(h, { kind: 'projectile', subtype: 'thorn' });

  const base = 1 / h.stats.projectile_freq;
  h.fireCooldown = h.rapidTimer > 0 ? base * 0.5 : base;
}

/** Build the Attack Engine context for a hero-fired shot. Supplies the shared
 * pools + collision world so the spawned projectile registers for real gameplay
 * collision (the same routing the bomb host uses). The engine reads
 * ctx.pools.projectilePool and ctx.collisionWorld. */
function makeHeroContext(h) {
  return {
    attacker: h,
    pools: { projectilePool, specialPool },
    collisionWorld: ctx.collisionWorld,
    world: { targets: [...(ctx.realEnemies ?? []), ...(ctx.boss && ctx.boss.alive ? [ctx.boss] : [])] },
  };
}

/**
 * Fire the hero's selected special weapon (special-weapons.md). The selected
 * slot must hold a weapon id from SPECIAL_TYPES — firing is gated by the
 * 'special' labeled cooldown timer on the hero. Holding a special costs
 * nothing: slots are weapons, not ammo, so firing never mutates the slot.
 */
function fireSpecial(h, input) {
  if (h.timers.get('special') > 0) return;
  const type = h.specialSlots?.[h.selectedWeapon];
  if (!type || !isSpecialType(type)) return; // empty/absent slot — fall through safely

  const meta = specialById[type];
  const dir = h.resolveAim(input);
  const { x: cx, y: cy } = h.bodyCenter();
  const baseAngle = dirAngle(dir);
  const halfSize = meta.size / 2;
  const ox = Math.cos(baseAngle) * 20;
  const oy = Math.sin(baseAngle) * 20;

  // Spread weapon: fan out multiple projectiles symmetrically around the aim.
  if (type === 'bomb' && ctx.bombAttacks) {
    const attack = ctx.bombAttacks.spawn('explosiveBomb', {
      origin: { x: cx + ox, y: cy + oy }, direction: baseAngle,
      speed: meta.speed, arc: meta.gravity, ttl: meta.lifetime,
      damage: meta.damage, radius: meta.radius, bounce: true, blastTeam: 'ally',
    }, h);
    if (!attack.entity) return;
  } else if (meta.spread) {
    const { count, angle } = meta.spread;
    const step = count > 1 ? angle / (count - 1) : 0;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * step;
      const a = baseAngle + offset;
      // Spawn with dir 0 (placeholder), then override velocity with the fan angle.
      const s = specialPool.spawn(cx - halfSize + Math.cos(a) * 20, cy - halfSize + Math.sin(a) * 20, 0, type);
      if (!s) break; // pool exhausted — stop spawning remaining shots
      s.vx = Math.cos(a) * s.speed;
      s.vy = Math.sin(a) * s.speed;
      // Re-aim the art nose at the fan angle (spawn dir is a placeholder).
      s.orientSprite(s.vx, s.vy);
    }
  } else {
    const s = specialPool.spawn(cx - halfSize + ox, cy - halfSize + oy, dir, type);
    if (!s) return;
  }

  record(h, { kind: 'projectile', subtype: 'special' });
  record(h, { kind: 'superMove' });
  h.timers.set('special', meta.fireCooldown); // cooldown owned by the WEAPON

  if (Debug.enabled) Debug.logEvent(`special ${type} fired`);
}

/**
 * Explode a special projectile (AoE detonation or fizzle). Called from ANY death
 * path: TTL expiry, enemy contact, barrel contact, off-screen cull. Single
 * source of truth so VFX + damage are identical regardless of trigger.
 */
export function explodeSpecial(s) {
  // Engine payloads are owned by their macro and dispatched after collision.
  if (s._attackId === 'ballistic') {
    s._attackHit = !s.ttlExpired;
    s.alive = false;
    return;
  }
  if (s.exploded) return;
  s.exploded = true;
  const meta = specialById[s.type];
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;

  if (meta?.explode && s.radius > 0) {
    // Detonation art (Step A): real explode sheet when loaded. The particle
    // burst below still runs — it carries the shockwave + shake juice.
    const ex = getSpecialSpriteData('bomb_explode')?.anims.explode;
    if (ex?._frames?.size) fireManual({ type: 'sprite-burst', params: { x: cx, y: cy, size: 64, duration: 0.5, anim: ex } });
    for (const t of ctx.realEnemies) {
      if (!t.alive) continue;
      const dx = (t.x + t.w / 2) - cx;
      const dy = (t.y + t.h / 2) - cy;
      if (Math.sqrt(dx * dx + dy * dy) <= s.radius) {
        const dealt = typeof t.takeDamage === 'function'
          ? t.takeDamage(s.damage, s, 'special')
          : damage(s, t, s.damage, 'special');
        if (Debug.enabled) Debug.logEvent(`bomb → ${t.type} dmg ${dealt}`);
      }
    }
    const bombCount = 12 + Math.floor(Math.random() * 4);
    Effects.spawnExplosion(cx, cy, s.radius, bombCount);
    Effects.bigExplosion();
    Effects.triggerShake(6);
    if (Debug.enabled) Debug.logEvent('bomb exploded');
  } else {
    Effects.fireParticleBurst(cx, cy, 4);
  }
}
