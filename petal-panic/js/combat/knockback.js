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
 * Apply a knockback impulse to a victim.
 *
 * Factors:
 *   - impulse: the force from the attacker (kb.x, kb.y in px/s)
 *   - victim velocity: current vx/vy (added to, unless ignoreVictimResistance)
 *   - victim mass: knockbackResist divisor (divides impulse, unless ignoreVictimResistance)
 *
 * @param {object} victim  Entity being hit. Reads/writes vx, vy; reads
 *                         knockbackResist (mass, default 1); writes
 *                         hitstunTimer, iFrameTimer.
 * @param {{x?:number,y?:number,hitstun?:number,iFrames?:number,ignoreVictimResistance?:boolean}|null|undefined} kb
 *        The impulse vector (px/s) plus optional stun / protection durations (s).
 *        ignoreVictimResistance: skip BOTH victim mass AND victim current
 *        velocity. The impulse becomes the final velocity (attacker owns it).
 * @returns {boolean} true if applied, false if no-op.
 */
export function applyKnockback(victim, kb) {
  if (!kb) return false;
  const impulse = kb.impulse ?? { x: kb.x ?? 0, y: kb.y ?? 0 };
  const fx = impulse.x, fy = impulse.y;
  if (!fx && !fy && !(kb.hitstun > 0) && !(kb.iFrames > 0)) return false;

  if (kb.ignoreVictimResistance) {
    // Attacker owns the final velocity: no mass division, no old velocity.
    victim.vx = fx;
    victim.vy = fy;
  } else {
    // Normal: victim mass divides the impulse, victim velocity is added to.
    const mass = victim.knockbackResist ?? 1;
    victim.vx = (victim.vx ?? 0) + fx / mass;
    victim.vy = (victim.vy ?? 0) + fy / mass;
  }

  // Stun: never shorten an existing longer stun.
  victim.hitstunTimer = Math.max(victim.hitstunTimer ?? 0, kb.hitstun ?? 0);

  // Protection window: optional.
  if ((kb.iFrames ?? 0) > 0) {
    victim.iFrameTimer = Math.max(victim.iFrameTimer ?? 0, kb.iFrames);
  }
  return true;
}
