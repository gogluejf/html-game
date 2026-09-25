// Shooting (+ design §21) — ONE shared shoot path: J fires whatever weapon is
// currently SELECTED on the hero ('thorn' | 'special'). N never fires — it only
// toggles the selection (hero.toggleWeapon, called by the update step). Each
// weapon keeps its own ammo pool and its own cooldown timer.

import { WEAPON_SPECIAL } from '../hero/hero.js';
import { projectilePool, specialPool, dirAngle } from '../objects/projectile.js';
import { damage } from './damage.js';
import { record } from '../stats.js';
import { Effects } from '../effects.js';
import { Debug } from '../debug/debug.js';
import { LAYER } from '../consts.js';
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
  if (h.selectedWeapon === WEAPON_SPECIAL) {
    fireSpecial(h, input);
  } else {
    // Default workhorse: fast, straight thorns (§21).
    fireThorn(h, input, dt);
  }
}

/** Fire one Thorn (default weapon): projectilePool + 'ammo' + fireCooldown. */
function fireThorn(h, input, dt) {
  if (h.fireCooldown > 0) return;
  if (h.ammo <= 0) return;

  const dir = h.resolveAim(input);

  const { x: cx, y: cy } = h.bodyCenter();
  const size = 12;
  const ox = Math.cos(dirAngle(dir)) * 16;
  const oy = Math.sin(dirAngle(dir)) * 16;
  const p = projectilePool.spawn(cx - size / 2 + ox, cy - size / 2 + oy, dir, true);
  if (!p) return;

  h.ammo -= 1;
  record(h, { kind: 'projectile', subtype: 'thorn' });

  const base = 1 / h.stats.projectile_freq;
  h.fireCooldown = h.rapidTimer > 0 ? base * 0.5 : base;
}

/**
 * Fire the hero's Special weapon (design §21). Consumes specialAmmo, gated by
 * special_freq. The cooldown is a labeled timer on the HERO ('special').
 */
function fireSpecial(h, input) {
  if (h.timers.get('special') > 0) return;
  if (h.specialAmmo <= 0) return;

  const type = h.stats.special;
  const dir = h.resolveAim(input);
  const { x: cx, y: cy } = h.bodyCenter();
  const angle = dirAngle(dir);
  const ox = Math.cos(angle) * 20;
  const oy = Math.sin(angle) * 20;

  const s = specialPool.spawn(cx - 10 + ox, cy - 10 + oy, dir, type);
  if (!s) return;

  h.specialAmmo -= 1;
  record(h, { kind: 'projectile', subtype: 'special' });
  record(h, { kind: 'superMove' });
  h.timers.set('special', h.stats.special_freq);

  if (Debug.enabled) Debug.logEvent(`special ${type} fired`);
}

/**
 * Explode a special projectile (bomb AoE or saw fizzle). Called from ANY death
 * path: TTL expiry, enemy contact, barrel contact, off-screen cull. Single
 * source of truth so VFX + damage are identical regardless of trigger.
 */
export function explodeSpecial(s) {
  if (s.exploded) return;
  s.exploded = true;
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;

  if (s.type === 'bomb' && s.radius > 0) {
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
