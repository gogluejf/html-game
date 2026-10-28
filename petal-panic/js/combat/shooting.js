// Shooting (special-weapons.md) — ONE shared shoot path: J fires whatever
// weapon is currently SELECTED on the hero. The default weapon ('thorn') is
// built-in and infinite; a numeric selectedWeapon is a special-weapon slot
// index holding any id from SPECIAL_TYPES. N never fires — it only rotates the
// selection (hero.rotateWeapon, called by the update step).

import { projectilePool, specialPool, SPECIAL_WEAPON_DEFS } from '../objects/projectile.js';
import { specialById, isSpecialType } from '../objects/specialWeapons.js';
import { dirAngle } from '../core/vec.js';
import { damage } from './damage.js';
import { record } from '../stats.js';
import { Effects } from '../effects.js';
import { Debug } from '../debug/debug.js';

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

/** Fire one Thorn (default weapon): projectilePool + fireCooldown. The
 * default weapon is built-in and infinite (special-weapons.md) — no pool. */
function fireThorn(h, input, dt) {
  if (h.fireCooldown > 0) return;

  const dir = h.resolveAim(input);

  const { x: cx, y: cy } = h.bodyCenter();
  const size = 12;
  const ox = Math.cos(dirAngle(dir)) * 16;
  const oy = Math.sin(dirAngle(dir)) * 16;
  const p = projectilePool.spawn(cx - size / 2 + ox, cy - size / 2 + oy, dir, true);
  if (!p) return;

  record(h, { kind: 'projectile', subtype: 'thorn' });

  const base = 1 / h.stats.projectile_freq;
  h.fireCooldown = h.rapidTimer > 0 ? base * 0.5 : base;
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
