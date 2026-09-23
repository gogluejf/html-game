// Petal Panic — central damage routing (design §4/§8).
//
// EVERY combat source funnels through damage(): thorns, melee swings, enemy
// contact, boss attacks, explosions. Keeping HP math in one place means
// defense, telemetry, and death handling are defined exactly once instead of
// being scattered across every attack type.
//
// Contract:
//   - `amt` is the RAW attack value (e.g. hero.stats.attack).
//   - Defense reduces it; the result never drops below 1 (a hit always lands).
//   - The target's energy (hero) or hp (enemy) is drained by the real amount.
//   - Telemetry on the SOURCE is updated when present (traceStats).
//   - Death is flagged (alive = false); the CALLER owns the death pipeline
//     (death anim, sparkles, coin drop, world removal) so this stays pure.
//
// Returns the real (post-defense) damage dealt, or 0 if the target was already
// dead.

import { record } from './stats.js';

/** Hit-landed method buckets that damage() may write (subset of stats HIT_METHODS). */
const HITS_LANDED_METHODS = new Set(['melee', 'projectile', 'special', 'specialMelee', 'superMove', 'explosion']);

/**
 * Apply a single hit from `source` to `target`.
 *
 * @param {object} source   attacker (hero, enemy, explosion...). May carry
 *                          `.traceStats` for telemetry; optional.
 * @param {object} target   victim. Reads `.stats?.defense`, drains `.energy`
 *                          (heroes) or `.hp` (enemies), sets `.alive=false` on
 *                          death.
 * @param {number} amt      raw attack value before defense.
 * @param {string} [method] 'projectile' | 'melee' | 'contact' | 'explosion'...
 * @returns {number} real damage dealt (>=1 if the target was alive), else 0.
 */
export function damage(source, target, amt, method = 'projectile') {
  if (!target.alive) return 0;

  // Defense mitigation, floored at 1 so a hit always registers.
  // Defense belongs to the TARGET: it reads the victim's own stat sheet
  // (`stats.defense`) or an explicit `defense` override (used by placeholder
  // targets / barrels before they have a full stat sheet). A hero's defense
  // protects IT from being hit — it never weakens the hero's own attacks.
  const def = target.defense != null ? target.defense : (target.stats?.defense ?? 0);
  const real = Math.max(1, amt - def);

  // Drain the right resource: heroes use energy, enemies use hp. Fall back
  // sensibly if neither field exists yet (early placeholders).
  if (target.energy != null) {
    target.energy -= real;
  } else if (target.hp != null) {
    target.hp -= real;
  } else {
    target.hp = -real; // brand-new placeholder with no pool: mark as damaged
  }

  // --- Telemetry (only when the source tracks it) ---------------------------
  // Hits-landed is recorded into the trace via record(). damageDealt is no
  // longer tracked in the stats model (dropped per design). Map the raw
  // method onto a known hit-landed bucket; unknown methods are ignored so a
  // new attack type can't throw.
  if (source.traceStats && HITS_LANDED_METHODS.has(method)) {
    record(source, { kind: 'hitLanded', method });
  }

  // --- Death flag (caller runs the actual death pipeline) --------------------
  const remaining = target.energy != null ? target.energy : (target.hp ?? 0);
  if (remaining <= 0) {
    target.alive = false;
  }

  return real;
}
