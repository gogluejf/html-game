import { wouldKill } from './damage.js';

// One impact profile per move; target type and animation duration do not tune it.
export const MELEE_IMPACTS = {
  melee: { chipHitstop: 0, lethalHitstop: 0, chipShake: 2, lethalShake: 6 },
  specialMelee: { chipHitstop: 0, lethalHitstop: 0, chipShake: 2, lethalShake: 6 },
  supermove: { chipHitstop: 4, lethalHitstop: 8, chipShake: 4, lethalShake: 6 },
};

export function meleeImpact(hb, target) {
  const profile = hb.impact;
  if (!profile) return { hitstop: hb.hitstop, shake: null };
  const lethal = (!hb.multiHit || hb.lastHit)
    && (target.pinned || wouldKill(target, hb.damage));
  return {
    hitstop: lethal ? profile.lethalHitstop : profile.chipHitstop,
    shake: lethal ? profile.lethalShake : profile.chipShake,
  };
}
