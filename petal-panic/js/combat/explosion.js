// Petal Panic — Explosion (design: docs/architecture/explosion.md).
//
// An explosion is ONE generic structure resolved by ONE path, regardless of what
// detonated it. A blast describes five independent knobs: where (center), how far
// (radius), how much it hurts (damage), which side it hurts (alignment), and how
// hard it shoves (a knockback setting from knockback.md §7). No source type is
// special-cased at the moment of detonation — a barrel, a rolling enemy that blows
// up, and a hero-thrown bomb are all the same resolveExplosion() call with a
// different alignment + knockback character.
//
// This module owns WHAT an explosion is and WHO it affects. The shove/stun math
// belongs to applyKnockback() (knockback.js); damage mitigation/death belongs to
// damage()/takeDamage(). resolveExplosion() is deliberately PURE with respect to
// the world: it mutates HP/energy + velocity/timers on targets and returns a
// summary, leaving VFX / screen shake / telemetry / world removal to the caller.
// That keeps the acceptance criteria unit-testable in node without a DOM.

import { damage } from './damage.js';
import { applyKnockback } from './knockback.js';

// --- Alignment (explosion.md §2) --------------------------------------------
// Which side does the blast hurt? This is the single field that decides target
// eligibility before anything else is applied.
export const ALIGNMENT = Object.freeze({
  FOE: 'foe',       // enemy-side blast: hurts the hero (+ hero-owned objects), spares other enemies
  ALLY: 'ally',     // hero-side blast: hurts enemies, spares the hero
  NEUTRAL: 'neutral',// no side: hurts everything in range except the detonator itself
});

// --- Knockback characters (explosion.md §4; each lives on the blast, never inline) ---
// A barrel is a neutral hazard: it shoves everyone radially. base 380 matches the
// hero's pre-refactor 'explosion' profile strength so the hero's feel is preserved
// exactly when routed through takeHit(); enemies get shoved by this same radial shove.
export const BARREL_EXPLOSION_KNOCKBACK = Object.freeze({
  base: 380, scaleBySpeed: 0, hitstun: 0.30, iFrames: 0.60, dirMode: 'radial', pop: 60,
});

// A Jack-O-Lantern is a foe-side self-detonation: it threatens the player but spares
// its own kind. Foe-appropriate shove — a bit softer than a barrel.
export const JACKO_EXPLOSION_KNOCKBACK = Object.freeze({
  base: 300, scaleBySpeed: 0, hitstun: 0.25, iFrames: 0.40, dirMode: 'radial', pop: 50,
});

/**
 * Build the radial push normal for a victim: the unit vector pointing FROM the
 * blast center TO the victim's center. A zero-length offset (victim exactly at
 * center) yields {x:0,y:0} — applyKnockback then adds no directional impulse
 * (only any fixed pop), which is the correct "at the epicenter" degenerate case.
 *
 * @param {{cx:number,cy:number}} center blast center
 * @param {{cx:number,cy:number}} targetCenter victim center
 * @returns {{x:number,y:number}} normalized outward direction (or zero)
 */
function radialNormal(center, targetCenter) {
  const dx = targetCenter.cx - center.cx;
  const dy = targetCenter.cy - center.cy;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

/** Center point of an entity's box. */
function centerOf(e) {
  return { cx: e.x + e.w / 2, cy: e.y + e.h / 2 };
}

/** True when two centers are within `radius` px (center-to-center, circular AoE). */
function withinRadius(aCx, aCy, bCx, bCy, radius) {
  const dx = aCx - bCx;
  const dy = aCy - bCy;
  return Math.sqrt(dx * dx + dy * dy) <= radius;
}

/**
 * Is `target` a valid target for this explosion? Encodes the alignment filter
 * (explosion.md §2) plus self-exclusion, dead-skip, and i-frame absorption.
 * Radius is checked separately by the caller (it needs the computed centers).
 *
 * - FOE    → only the hero (and hero-owned objects) are valid; other enemies never are.
 * - ALLY   → only enemies are valid; the hero never is.
 * - NEUTRAL→ everyone is valid except the detonator itself.
 *
 * Self-damage is excluded by construction across all alignments: the thing that
 * detonated is never a target for its own blast.
 *
 * @param {object} explosion { cx, cy, radius, damage, alignment, knockback }
 * @param {object} target candidate entity
 * @param {object} source the detonating entity (self-exclusion reference)
 * @returns {boolean}
 */
export function isValidTarget(explosion, target, source) {
  if (!target || target === source) return false;   // never self-hit
  if (target.alive === false) return false;          // skip already-dead
  if (target.intangible) return false;               // i-frames absorb the blast

  const hero = ctxHero(explosion);
  switch (explosion.alignment) {
    case ALIGNMENT.FOE:
      // Enemy-side: only the hero is a valid target.
      return target === hero;
    case ALIGNMENT.ALLY:
      // Hero-side: only enemies are valid; the hero is spared.
      return target !== hero && isEnemy(target);
    case ALIGNMENT.NEUTRAL:
    default:
      // No side: everyone in range except self (already excluded above).
      return true;
  }
}

/** Pull the hero out of the explosion's ctx (may be undefined in pure tests). */
function ctxHero(explosion) {
  return explosion.ctx?.hero ?? null;
}

/** Heuristic: is this entity an enemy (as opposed to the hero)? */
function isEnemy(target) {
  // Real enemies carry bodyKnockback (set in Enemy ctor) and/or takeDamage(); the
  // hero carries neither. This mirrors how the rest of the code distinguishes them.
  return !!(target.bodyKnockback || typeof target.takeDamage === 'function');
}

/**
 * Resolve a single explosion against a set of candidate targets.
 *
 * For each valid target within the radius (per alignment + self/dead/intangible
 * filters):
 *   1. Apply damage through the central damage system — real enemies route via
 *      their own takeDamage() (which runs their internal death pipeline); every
 *      other target routes via damage(). Defense mitigation, resource pools
 *      (energy vs hp), telemetry, and death flagging all apply uniformly.
 *   2. If the target was actually damaged, apply radial knockback:
 *        - HERO: routed through hero.takeHit({source:'explosion', dirX, dirY}) so
 *          the existing rec + intangible timer semantics are preserved EXACTLY
 *          (behavior preservation — see knockbackRegression.test.js).
 *        - ENEMY: routed through applyKnockback() with the blast's radial knockback
 *          setting (shove + stun + pop via hitstunTimer/iFrameTimer).
 *
 * Pure with respect to the world: mutates HP/energy + velocity/timers, returns a
 * summary. VFX / screen shake / telemetry / coin drops / world.remove stay with
 * the caller.
 *
 * @param {object} explosion
 *   { cx, cy, radius, damage, alignment, knockback, [ctx] }
 *   - cx/cy   : blast center (world coords)
 *   - radius  : blast reach (px)
 *   - damage  : raw damage dealt to each valid target
 *   - alignment: one of ALIGNMENT.{FOE,ALLY,NEUTRAL}
 *   - knockback: a KnockbackSetting (knockback.md §7) with dirMode 'radial'
 *   - ctx     : { hero } — the live hero, used for hero-target detection + routing
 * @param {Array<object>} targets candidate entities (hero, enemies, ...)
 * @returns {{center:{cx,cy}, radius:number, hit:object[]}} explosion summary
 */
export function resolveExplosion(explosion, targets) {
  const { cx, cy, radius, damage: dmg, alignment, knockback } = explosion;
  const hero = ctxHero(explosion);
  const hit = [];

  for (const t of targets) {
    if (!isValidTarget(explosion, t, /* source */ explosion.self)) continue;

    const tc = centerOf(t);
    if (!withinRadius(cx, cy, tc.cx, tc.cy, radius)) continue;

    // Damage: real enemies run their own death pipeline via takeDamage(); others
    // use central damage(). Source is the detonator (explosion.self) for telemetry.
    const source = explosion.self ?? null;
    const dealt = typeof t.takeDamage === 'function'
      ? t.takeDamage(dmg, source, 'explosion')
      : damage(source, t, dmg, 'explosion');
    if (dealt <= 0) continue;

    hit.push(t);

    // Radial knockback away from the blast center.
    if (t === hero) {
      // Preserve the hero's exact pre-refactor behavior: takeHit('explosion') sets
      // vx/vy from the profile strength along the normalized dir + rec + intangible.
      hero.takeHit({ source: 'explosion', dirX: tc.cx - cx, dirY: tc.cy - cy });
    } else if (isEnemy(t)) {
      const normal = radialNormal({ cx, cy }, tc);
      applyKnockback(t, { vx: 0, vy: 0 }, knockback, normal);
    }
  }

  return { center: { cx, cy }, radius, hit };
}
