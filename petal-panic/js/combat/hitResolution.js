// Petal Panic — unified hit resolver (unified-hit-resolution plan §3).
// Single entry point `applyHit(context)` for all damage routing: validates,
// checks team eligibility, routes by target class, fires reactions + callbacks.
// M3: the knockback reaction is wired in — context.knockback (a shove vector
// { x, y } px/s) is applied via applyKnockback() AFTER damage, so every
// damaging path gets mass/hitstun/i-frames from the single choke point.

import { Team, TargetClass, AttackProvenance, assertProvenance, getTargetClass } from './targeting.js';
import { applyKnockback } from './knockback.js';

/** What a given attacker team may legally strike. */
const ELIGIBLE = {
  [Team.ALLY]: new Set([TargetClass.ENEMY, TargetClass.BOSS, TargetClass.DESTRUCTIBLE]),
  [Team.FOE]: new Set([TargetClass.HERO]),
  [Team.NEUTRAL]: new Set([TargetClass.HERO, TargetClass.ENEMY, TargetClass.BOSS, TargetClass.DESTRUCTIBLE]),
};

/** Drain hp directly when a target has no dedicated damage method.
 *  Guard: only mutate targets that actually carry a numeric hp pool. A
 *  placeholder/anim box with no hp must not end up with `hp: NaN`. */
function drainHp(target, amt) {
  if (typeof target.hp !== 'number' || !Number.isFinite(target.hp)) return 0;
  target.hp -= amt;
  if (target.hp <= 0) target.alive = false;
  return Math.min(amt, target.hp + amt);
}

/**
 * Apply a single validated hit. See HitContext / HitResult typedefs above.
 * @param {object} context HitContext
 * @returns {object} HitResult
 */
export function applyHit(context) {
  const { provenance, source, target, damage: rawAmt, team, ctx } = context;
  assertProvenance(provenance);

  // --- Validate -----------------------------------------------------------
  if (!target || target.destroyed || target.alive === false) {
    return { accepted: false, dealt: 0, destroyed: false, rejectReason: 'target invalid or dead' };
  }
  // Damage-immune targets absorb the whole hit — no damage, no shove, no
  // callbacks. Heroes in their invincible window (i-frames, star power) and
  // intangible entities (barrel cook) live here; this is the ONE place that
  // decision is made so every damaging path shares it. Zero-damage impulses
  // (stomp / star-barrel launches) are pure physics: they still ride this door
  // and ignore the immunity flags.
  if ((target.invincible || target.intangible) && rawAmt > 0) {
    return { accepted: false, dealt: 0, destroyed: false, rejectReason: 'target immune' };
  }
  // Damage must be a finite number BEFORE any mutation or callback. A missing
  // or undefined damage value (bad def, unmerged params) must never reach the
  // target's takeDamage()/drainHp — that is how `hp: NaN` / `undefined - n`
  // corruption spreads through the world state.
  if (typeof rawAmt !== 'number' || !Number.isFinite(rawAmt)) {
    const id = (e) => e?.type ?? e?.id ?? e?.constructor?.name ?? 'unknown';
    throw new TypeError(`applyHit: invalid damage ${String(rawAmt)} (${typeof rawAmt}); provenance=${provenance}; source=${id(source)}; target=${id(target)}`);
  }
  if (source === target) {
    return { accepted: false, dealt: 0, destroyed: false, rejectReason: 'self-exclusion' };
  }

  // --- Eligibility (3x3 team matrix + provenance exclusions) ---------------
  const tClass = getTargetClass(target);
  const allowed = ELIGIBLE[team] ?? ELIGIBLE[Team.NEUTRAL];
  if (!allowed.has(tClass)) {
    return { accepted: false, dealt: 0, destroyed: false, rejectReason: `team ${team} cannot hit ${tClass}` };
  }
  // Provenance-specific target restrictions (design doc §behavior-preservation):
  // Toxic dust affects living targets only — never destructibles/objects.
  if (provenance === AttackProvenance.HAZARD_DUST &&
      (tClass === TargetClass.DESTRUCTIBLE || tClass === TargetClass.OTHER)) {
    return { accepted: false, dealt: 0, destroyed: false, rejectReason: 'dust does not affect destructibles' };
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

  // --- Reactions (M3: knockback vector via the single choke point) ---------
  // context.knockback is a shove vector { x, y } in px/s (plus optional
  // hitstun / iFrames) — hand-written on the attack def or derived from live
  // motion. applyKnockback() divides by the victim's mass and applies it.
  // Applied AFTER damage so the impulse lands before any death-pipeline
  // velocity wipe. Freshly-killed targets STILL ride the shove: Enemy.takeDamage
  // restores alive=true for the death anim, so the corpse arcs off with the
  // same launch as a survivor — uniform behavior, no special case.
  if (context.knockback) {
    applyKnockback(target, context.knockback);
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
