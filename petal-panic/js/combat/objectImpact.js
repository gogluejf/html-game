// Combat — shared destructible-object impact operation (GameObj contract).
//
// ONE code path for "a friendly projectile struck a destructible solid",
// used by BOTH the broadphase dispatch (side hits) and the swept terrain
// pass (top landings). The op is deliberately generic over the GameObj base
// (hp / hit() / destroyed / alive / worldBox()) — no barrel-type checks, no
// explosive-flag inference. Barrel-specific rewards (super-coin popcorn) and
// destruction aftermath (explosion AoE, coin bursts, VFX, world removal) are
// host callbacks supplied by gameplay wiring; future destructibles reuse this
// same contact with their own hooks.
//
// Shared by gameplay side dispatch and owned-surface top contact.

import { entryImpactPoint } from './entryImpact.js';
import { explodeSpecial } from './shooting.js';
import { isSpecialType } from '../objects/specialWeapons.js';
import { applyHit } from './hitResolution.js';
import { Team, AttackProvenance } from './targeting.js';

/**
 * Apply one projectile impact to a destructible object.
 *
 * Mirrors the PROJ_ALLY×GameObj handler semantics exactly (top and side hits
 * must behave identically):
 *  - arcing carriers record `_attackHit` + the entry-edge `_impactPoint`
 *    (tunneling correction for detonation placement);
 *  - damage is routed through the unified resolver (applyHit), which calls
 *    `target.hit(dmg, source, 'projectile')` for DESTRUCTIBLE targets;
 *  - the projectile is consumed on impact either way;
 *  - `onObjectReward(target, dealt)` fires when damage landed (host-owned
 *    per-hit rewards, e.g. super-coin popcorn);
 *  - `onObjectDestroyed(target)` fires exactly once when this impact
 *    destroyed the target (host owns the aftermath pipeline);
 *  - special weapons still explode/fizzle on object contact.
 *
 * @param {object} proj     the striking projectile (friendly)
 * @param {object} target   the struck GameObj (must expose hit/worldBox/destroyed)
 * @param {object} [source] attacker entity for telemetry (the hero)
 * @param {object} [hooks]
 * @param {(target:object, dealt:number)=>void} [hooks.onObjectReward]
 * @param {(target:object)=>void} [hooks.onObjectDestroyed]
 */
export function applyObjectImpact(proj, target, source = null, hooks = {}) {
  if (!proj?.alive || !target || !proj.friendly || proj._bombRetainOnContact) return;
  if (proj._arcRecipe) {
    proj._attackHit = true;
    proj._impactPoint = entryImpactPoint(proj, target.worldBox());
  }
  const res = applyHit({
    provenance: AttackProvenance.PROJECTILE,
    source,
    target,
    damage: proj.damage,
    team: Team.ALLY,
    method: 'projectile',
  });
  // Projectile is consumed on impact either way.
  // Rewards and destruction payloads are owned by the target's own
  // onHit/onDestroyed hooks (wired via GameObj.prototype in update.js).
  proj.alive = false;
  if (isSpecialType(proj.type)) explodeSpecial(proj);
}
