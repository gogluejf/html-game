// Petal Panic — Hitbox system (design: unified attack hitboxes).
//
// A Hitbox is a transient, ownerless-in-world damage zone. It is NOT an Entity
// (no position of its own, no layer in the collision world, no pool lifetime).
// It's a plain object registered for one or more frames by its owner (hero melee,
// hero super, enemy whip, enemy lunge, etc.). The engine processes all active
// hitboxes in one generic loop — no per-attack-type special casing.
//
// Team routing:
//   - 'ally'  → hits ENEMY + BOSS + SOLID (barrels)
//   - 'foe'   → hits HERO
//   - 'neutral' → hits everything alive (explosions, hazards)
//
// The engine never asks "who owns this" or "how did it come about." It reads
// team + box + damage + method and routes accordingly.

import { LAYER } from '../consts.js';
import { Effects } from '../effects.js';
import { damage } from './damage.js';
import { applyKnockback } from './knockback.js';

/** Methods whose connect deals blood (melee-family strikes). */
const BLOOD_METHODS = new Set(['melee', 'specialMelee', 'super']);

/** Target layer masks per team. */
const TEAM_TARGETS = {
  ally:    [LAYER.ENEMY, LAYER.BOSS, LAYER.SOLID],
  foe:     [LAYER.HERO],
  neutral: [LAYER.HERO, LAYER.ENEMY, LAYER.BOSS, LAYER.SOLID],
};

/**
 * Create a hitbox. Call each frame your attack is active; pass null/undefined
 * to deactivate.
 *
 * @param {object} opts
 * @param {object} opts.owner   entity dealing damage (hero, enemy, ...)
 * @param {string} opts.team    'ally' | 'foe' | 'neutral'
 * @param {{x:number,y:number,w:number,h:number}} opts.box  world-space AABB
 * @param {number} opts.damage  raw damage amount (target defense still applies)
 * @param {string} [opts.method='melee']  telemetry label
 * @returns {object} hitbox instance (reuse the same object each frame)
 */
export function makeHitbox({ owner, team, box, damage, method = 'melee' }) {
  return {
    owner,
    team,
    box,
    damage,
    method,
    hitSet: new Set(),
    active: true,
  };
}

/**
 * Reset a hitbox's hit set (call when a new swing/dash begins).
 * @param {object} hb
 */
export function resetHitbox(hb) {
  hb.hitSet.clear();
  hb.active = true;
}

/**
 * Process all active hitboxes against the target set. One generic loop.
 *
 * @param {Array<object>} hitboxes  all registered hitboxes (active or not)
 * @param {Array<object>} targets   all live entities to check against
 * @param {function} [onHit]        callback(hb, target, dealt) for VFX/shake
 */
export function processHitboxes(hitboxes, targets, onHit) {
  for (const hb of hitboxes) {
    if (!hb.active || !hb.box) continue;
    const layers = TEAM_TARGETS[hb.team];
    if (!layers) continue;

    for (const t of targets) {
      if (!t || t.alive === false) continue;
      if (t === hb.owner) continue;           // never self-hit
      if (hb.hitSet.has(t)) continue;         // already struck this swing
      if (!layers.includes(t.layer)) continue; // team routing

      const tb = t.worldBox ? t.worldBox() : { x: t.x, y: t.y, w: t.w, h: t.h };
      if (!aabbOverlap(hb.box, tb)) continue;

      // Skip hero if intangible or mid-death.
      if (t.layer === LAYER.HERO) {
        if (t.intangible) continue;
        if (t.dying) continue;
      }

      // Knockback BEFORE damage: the impulse must land on a still-alive victim
      // so its physics integrate it. takeDamage() → die() zeroes vx/vy, and a
      // corpse's velocity is wiped before the death slide plays — applying the
      // shove after damage meant same-frame kills never flew off. The hitbox
      // carries the setting (hb.knockback); direction follows dirMode, with the
      // attacker's velocity as the motion term. Hero victims keep their own
      // reaction path (takeHit) — this only shoves enemy/boss/solid targets.
      if (hb.knockback && t.layer !== LAYER.HERO) {
        const kb = hb.knockback;
        let nx, ny;
        if (kb.dirMode === 'alongVelocity') {
          const len = Math.hypot(hb.owner?.vx || 0, hb.owner?.vy || 0) || 1;
          nx = (hb.owner?.vx || 0) / len;
          ny = (hb.owner?.vy || 0) / len;
        } else {
          // 'fromAttacker' or 'radial': source center → target center.
          const scx = hb.owner.x + (hb.owner.w || 0) / 2;
          const scy = hb.owner.y + (hb.owner.h || 0) / 2;
          const dx = (tb.x + tb.w / 2) - scx, dy = (tb.y + tb.h / 2) - scy;
          const len = Math.hypot(dx, dy) || 1;
          nx = dx / len; ny = dy / len;
        }
        applyKnockback(t, hb.owner, kb, { x: nx, y: ny });
      }

      // Route damage: prefer takeDamage (enemies run death pipeline, set their
      // own flash), fall back to .hit() (objects/barrels, same). The HERO has
      // neither — like the blast path (explosion.js) it routes through central
      // damage(), which drains energy/shield and flags death. Without this
      // branch the hero fell into a 0-damage fallback and zones never hurt it.
      let dealt = 0;
      const pipeline = typeof t.takeDamage === 'function' || typeof t.hit === 'function';
      if (typeof t.takeDamage === 'function') {
        dealt = t.takeDamage(hb.damage, hb.owner, hb.method);
      } else if (typeof t.hit === 'function') {
        dealt = t.hit(hb.damage, hb.owner, hb.method);
      } else {
        dealt = damage(hb.owner, t, hb.damage, hb.method);
      }

      if (dealt > 0) {
        hb.hitSet.add(t);
        // Hero hit reaction — parity with the blast path (explosion.js): a
        // damaging tick on the hero arms i-frames via the zone's method
        // profile ('dust' falls back to contact). Without this, persistent
        // zones melt the hero every tick while enemies get their own
        // iFrameTimer from applyKnockback.
        if (t.layer === LAYER.HERO) {
          t.takeHit({ source: hb.method, dirX: 0, dirY: 0 });
          Effects.heroDamaged();
        }
        // Hit juice lives in the ENGINE, not in host callbacks: every caller
        // of processHitboxes (gameplay hitbox registry AND attack primitives
        // like meleeHitbox/beam/spike) gets the same reaction. Blood sparkles
        // on melee-family connects; shake + flash on everything else. Pipeline
        // targets already flashed themselves inside takeDamage()/hit() — the
        // engine must not double-set or INVENT a flash for non-pipeline
        // placeholders (hitFlashOwnership contract), so the shake (which
        // bumps hitFlash) runs only for pipeline targets.
        if (t.layer !== LAYER.HERO && pipeline) {
          if (BLOOD_METHODS.has(hb.method)) {
            const tb = t.worldBox ? t.worldBox() : t;
            Effects.spawnHitSparkles(tb.x + tb.w / 2, tb.y + tb.h / 2);
          }
          Effects.beginEnemyShake(t);
        }
        if (onHit) onHit(hb, t, dealt);
      }
    }
  }
}

/** Simple AABB overlap test. */
function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}
