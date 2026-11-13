// Petal Panic — Knockback.
//
// The whole contract is ONE vector: { x, y } in px/s. The numbers ARE the
// force — no magnitude, no angle, no separate "pop" axis (a lobe is just a
// negative y). Whoever declares the hit decides the shove:
//
//   - static attacks  → hand-write the vector on the attack def
//   - motion-driven   → calculateKnockback(attacker, pop?) derives it from the
//                       attacker's live velocity + weight
//
// applyKnockback(victim, kb) is the single applier: it finishes the math with
// the VICTIM's mass (knockbackResist divides the impulse) and sets the stun /
// protection timers. Pure functions: no DOM, no globals.


/**
 * Offense helper: derive a knockback vector from the attacker's live state.
 * The attacker's velocity IS the direction AND the force — a charging body
 * shoves harder than a standing one, exactly along where it's going.
 *
 * @param {object} attacker  Entity dealing the hit (reads vx, vy, stats.weight).
 * @param {number} [pop]     Optional small upward chunk (px/s) folded into y.
 * @returns {{x:number,y:number}|null} raw shove vector (pre-victim-mass), or
 *          null for a stationary/weightless attacker with no pop.
 */
export function calculateKnockback(attacker, pop = 0) {
  const vx = attacker?.vx ?? 0;
  const vy = (attacker?.vy ?? 0) - pop;
  if (!vx && !vy) return null;
  const w = attacker?.stats?.weight ?? 1;
  return { x: vx * w, y: vy * w };
}

/**
 * Apply a knockback vector to a victim.
 *
 * @param {object} victim  Entity being hit. Reads/writes vx, vy; reads
 *                         knockbackResist (mass divisor, default 1); writes
 *                         hitstunTimer, iFrameTimer.
 * @param {{x?:number,y?:number,hitstun?:number,iFrames?:number}|null|undefined} kb
 *        The shove vector (px/s) plus optional stun / protection durations (s).
 * @returns {boolean} true if applied, false if no-op.
 */
export function applyKnockback(victim, kb) {
  if (!kb) return false;
  const fx = kb.x ?? 0, fy = kb.y ?? 0;
  if (!fx && !fy && !(kb.hitstun > 0) && !(kb.iFrames > 0)) return false;

  // Mass resists knockback as a divisor (§3). Default resist 1 → unchanged.
  const resist = victim.knockbackResist ?? 1;
  victim.vx = (victim.vx ?? 0) + fx / resist;
  victim.vy = (victim.vy ?? 0) + fy / resist;

  // Stun (§6): never shorten an existing longer stun.
  victim.hitstunTimer = Math.max(victim.hitstunTimer ?? 0, kb.hitstun ?? 0);

  // Protection window (§6): optional.
  if ((kb.iFrames ?? 0) > 0) {
    victim.iFrameTimer = Math.max(victim.iFrameTimer ?? 0, kb.iFrames);
  }
  return true;
}
