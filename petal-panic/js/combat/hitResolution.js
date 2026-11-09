// Petal Panic — unified hit resolver (unified-hit-resolution plan §3).
// Single entry point `applyHit(context)` for all damage routing: validates,
// checks team eligibility, routes by target class, fires reactions + callbacks.
// This is the M2 skeleton; M3 wires real knockback / death pipelines in.

import { Team, TargetClass, AttackProvenance, assertProvenance, getTargetClass } from './targeting.js';

/** What a given attacker team may legally strike. */
const ELIGIBLE = {
  [Team.ALLY]: new Set([TargetClass.ENEMY, TargetClass.BOSS, TargetClass.DESTRUCTIBLE]),
  [Team.FOE]: new Set([TargetClass.HERO]),
  [Team.NEUTRAL]: new Set([TargetClass.HERO, TargetClass.ENEMY, TargetClass.BOSS, TargetClass.DESTRUCTIBLE]),
};

/** Drain hp directly when a target has no dedicated damage method. */
function drainHp(target, amt) {
  target.hp -= amt;
  if (target.hp <= 0) target.alive = false;
  return amt;
}

/**
 * Apply a single validated hit. See HitContext / HitResult typedefs above.
 * @param {object} context HitContext
 * @returns {object} HitResult
 */
export function applyHit(context) {
  const { provenance, source, target, damage: rawAmt, team, knockback, ctx } = context;
  assertProvenance(provenance);

  // --- Validate -----------------------------------------------------------
  if (!target || target.destroyed || target.alive === false) {
    return { accepted: false, dealt: 0, destroyed: false, rejectReason: 'target invalid or dead' };
  }
  if (source === target) {
    return { accepted: false, dealt: 0, destroyed: false, rejectReason: 'self-exclusion' };
  }

  // --- Eligibility (3x3 team matrix) --------------------------------------
  const tClass = getTargetClass(target);
  const allowed = ELIGIBLE[team] ?? ELIGIBLE[Team.NEUTRAL];
  if (!allowed.has(tClass)) {
    return { accepted: false, dealt: 0, destroyed: false, rejectReason: `team ${team} cannot hit ${tClass}` };
  }

  // --- Route by target class ----------------------------------------------
  const method = context.method ?? provenance.toLowerCase();
  // Uniform interface: every target class exposes takeDamage(amt, source, method).
  // Hero → heroDamage (shield/energy), Enemy/Boss → HP + death pipeline,
  // Destructible/Other → HP + destruction latch.
  const dealt = typeof target.takeDamage === 'function'
    ? target.takeDamage(rawAmt, source, method)
    : drainHp(target, rawAmt);

  const destroyed = !!(target.destroyed || target.alive === false);

  // --- Reactions (knockback: M3 placeholder — set vx/vy) -------------------
  if (knockback && !destroyed) {
    target.vx = (target.vx ?? 0) + (knockback.vx ?? 0);
    target.vy = (target.vy ?? 0) + (knockback.vy ?? 0);
  }

  const result = { accepted: true, dealt, destroyed };

  // --- Callbacks (each exactly once) --------------------------------------
  if (typeof target.onHit === 'function') target.onHit(context, result);
  if (destroyed) {
    target.destroyed = true;
    if (typeof target.onDestroyed === 'function') target.onDestroyed(context, result);
  }

  return result;
}
