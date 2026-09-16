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

import { LAYER } from './consts.js';

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

      // Skip hero if intangible, invincible (i-frames), or mid-death.
      if (t.layer === LAYER.HERO) {
        if (t.intangible) continue;
        if (t.dying) continue;
        if (t.timers && t.timers.get('inv') > 0) continue;
      }

      // Route damage: prefer takeDamage (enemies run death pipeline),
      // fall back to .hit() (objects/barrels), then central damage().
      let dealt = 0;
      if (typeof t.takeDamage === 'function') {
        dealt = t.takeDamage(hb.damage, hb.owner, hb.method);
      } else if (typeof t.hit === 'function') {
        dealt = t.hit(hb.damage, hb.owner, hb.method);
      } else {
        // Fallback: central damage (shouldn't happen for real entities)
        dealt = 0;
      }

      if (dealt > 0) {
        hb.hitSet.add(t);
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
