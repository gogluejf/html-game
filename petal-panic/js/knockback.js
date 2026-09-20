// Petal Panic — Knockback (design: docs/architecture/knockback.md, §2–§6).
//
// Knockback is DATA on the thing that is hitting. Whatever deals the blow carries a
// `knockback` setting describing how hard it lands, how long the victim is stunned,
// whether the victim briefly absorbs further hits, and which way the push goes. This
// module is the SINGLE consumer of that data: applyKnockback() reads the setting off
// the attacker and applies the physical reaction to the victim. No attack type is
// special-cased at the point of impact — adding a new shove is a matter of describing
// its character, not branching logic here.
//
// Pure function: no DOM, no globals. Unit-testable with plain objects.

/**
 * A knockback setting carried by the source of a hit.
 * @typedef {object} KnockbackSetting
 * @property {number} base          Inherent weight (px/s): how hard it lands when nothing moves (§2).
 * @property {number} scaleBySpeed  Multiplier on the head-on relative velocity (§2 motion term).
 * @property {number} hitstun       Stun duration in seconds (§6).
 * @property {number} [iFrames]     Protection window in seconds; 0/absent = none (§6).
 * @property {'fromAttacker'|'alongVelocity'|'radial'} dirMode Direction mode (§4) — informational here;
 *                                   the caller derives the normalized direction from it.
 * @property {number} [pop]         Fixed upward launch (px/s) added on top of the directional
 *                                   impulse (§5): hard hits pop the victim off the ground so it
 *                                   falls back under existing gravity. Independent of the push
 *                                   normal, because these attacks shove horizontally at ground
 *                                   level and would otherwise impart no vertical motion. 0/absent
 *                                   = no pop. Scales with mass like the rest of the shove.
 */

/**
 * Apply a knockback reaction to a victim from an attacker's hit.
 *
 * Strength = inherent weight + motion contribution, then divided by the victim's
 * mass resistance:
 *   - base        : fixed heft, present even when nothing is moving (§2).
 *   - motionTerm  : how fast the attacker is moving INTO the victim along the push
 *                   normal. Only the head-on component counts — an attacker sliding
 *                   past sideways adds ~0, one charging straight in adds a lot (§2).
 *   - resist      : heavier victims move less; mass acts as a DIVISOR on the final
 *                   shove (§3). knockbackResist defaults to 1 (no change).
 *
 * The result is applied as a 2D impulse (so strong hits loft the victim upward, §5),
 * plus an optional fixed upward `pop` launch (§5) for attacks that shove horizontally
 * at ground level and would otherwise impart no vertical motion. Both fall back under
 * existing gravity — there is no separate bounce system.
 * and the victim's stun / protection TTLs are set (never shortened by a weaker follow-up).
 *
 * @param {object} victim    Entity being hit. Reads/writes vx, vy; reads knockbackResist
 *                           (mass divisor, default 1); writes hitstunTimer, iFrameTimer.
 * @param {object} attacker  Entity dealing the hit. Reads vx, vy for the motion term.
 * @param {KnockbackSetting|null|undefined} knockback  The setting (or null/undefined = no-op).
 * @param {{x:number,y:number}} normal  Push direction. Caller normalizes it per dirMode (§4).
 * @returns {boolean} true if a knockback was applied, false if it was a no-op.
 */
export function applyKnockback(victim, attacker, knockback, normal) {
  // Absent or zero-strength knockback is a pure no-op (e.g. friendly Thorn): it must
  // change NOTHING — no velocity, no timers. Guard before touching the victim.
  if (!knockback || (!knockback.base && !knockback.scaleBySpeed)) return false;

  const base = knockback.base ?? 0;
  const scaleBySpeed = knockback.scaleBySpeed ?? 0;

  // Motion term: project the attacker's velocity onto the push normal. The dot gives
  // exactly the into-victim component (head-on charging → large positive; sliding
  // past perpendicular → ~0; retreating → negative). Clamp to >= 0 so only forward
  // momentum ever ADDS to the impact — a receding attacker can't amplify a hit.
  const nx = normal?.x ?? 0;
  const ny = normal?.y ?? 0;
  const headOn = (attacker?.vx ?? 0) * nx + (attacker?.vy ?? 0) * ny;
  const motionTerm = Math.max(0, headOn) * scaleBySpeed;

  // Mass resists knockback as a divisor (§3). Default resist 1 → unchanged.
  const resist = victim.knockbackResist ?? 1;
  const mag = (base + motionTerm) / resist;

  // 2D impulse along the (caller-normalized) push direction (§5).
  victim.vx += nx * mag;
  victim.vy += ny * mag;

  // Vertical pop (§5): a fixed upward launch on top of the directional impulse.
  // These attacks shove horizontally at ground level, so the normal alone carries
  // little/no vertical component — without this, hard hits would slide victims
  // sideways but never loft them. Negative y = up in screen coords. Scales with
  // mass like the rest of the shove; absent/0 leaves vy untouched by the pop.
  const pop = (knockback.pop ?? 0) / resist;
  if (pop > 0) victim.vy -= pop;

  // Stun (§6): never shorten an existing longer stun. Physics keep running during it.
  victim.hitstunTimer = Math.max(victim.hitstunTimer ?? 0, knockback.hitstun ?? 0);

  // Protection window (§6): optional. Enemies typically leave this off (0).
  if ((knockback.iFrames ?? 0) > 0) {
    victim.iFrameTimer = Math.max(victim.iFrameTimer ?? 0, knockback.iFrames);
  }

  return true;
}
