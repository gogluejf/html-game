// Petal Panic — plow shield (single shared predicate).
//
// A hero mid-supermove is an INVINCIBLE WALL (plow mode): his body pushes
// enemies positionally and cannot be hit. The design invariant is that a
// plowing hero does NOT count as a "collision" for foe contact-triggers
// (self-detonation, proximity launch, etc.) — carrying a body around is not
// bumping into it.
//
// This is the ONE place that rule lives. Every foe contact-trigger consults
// isPlowShielded(victim) instead of each enemy growing its own plow check.
// It reads a stable property of the HERO (hero.plow), set/cleared by the
// supermove lifecycle — no per-frame flags, no ordering hazards.

/**
 * True when `entity` is a hero currently plowing (supermove wall active).
 * Foe contact-triggers must stay inert against a plowed hero.
 * @param {object} entity the would-be collision target (usually the hero)
 * @returns {boolean}
 */
export function isPlowShielded(entity) {
  return !!(entity && entity.plow);
}
