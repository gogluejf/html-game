// Attack Engine — Unified child-attack ids + invoke helper (plan 3.1).
//
// Single source of truth for the child attacks macros materialize: the flat
// list of values shared by spawnSplit, clusterBomb, missileRain, skyMissile
// and reticleShot. Those macros' legacy param names (blastType / spawnType /
// weaponType) all name the SAME concept — one child — and each value maps to
// the concrete invoke target the code ALREADY uses today (verified against
// each macro's existing if/else chain):
//
//   projectile → 'projectile'            primitive: plain shot (straight or arcing)
//   bomb       → 'explosiveBomb'         macro: arcing bomb, explodes on impact/fuse
//   mine       → 'throwMine'             macro: lobs a mine that rests
//   molotov    → 'molotov'               macro: arcing fire lobe → fireArea
//   enemy      → 'throwEnemy'            macro: thrown enemy carrier
//   explosion  → 'explosiveProjectile'   macro: carrier → explosion zone on impact
//   shockwave  → 'shockwaveProjectile'   macro: carrier → shockwave zone on impact
//   napalm     → 'napalm'                macro: carrier → fireArea on impact
//
// Note: 'explosion'/'shockwave'/'napalm' are PROJECTILE-CARRIER macros — they
// fly and materialize their zone effect on impact. They are NOT the
// 'explosion'/'shockwave'/'fireArea' zone primitives.
//
// reticleShot's legacy 'plain' default is not a 9th value: it is absorbed
// into 'projectile'.

import { invoke } from './engine.js';

/**
 * All invocable child-attack values (flat list, no families).
 * Frozen single source of truth for the macro `child` param.
 */
export const ATTACK_IDS = Object.freeze([
  'projectile',
  'bomb',
  'mine',
  'molotov',
  'enemy',
  'explosion',
  'shockwave',
  'napalm',
]);

/** child value → the concrete invoke target the code already uses today. */
export const CHILD_TARGETS = Object.freeze({
  projectile: 'projectile',
  bomb: 'explosiveBomb',
  mine: 'throwMine',
  molotov: 'molotov',
  enemy: 'throwEnemy',
  explosion: 'explosiveProjectile',
  shockwave: 'shockwaveProjectile',
  napalm: 'napalm',
});

/**
 * Materialize a child attack by its ATTACK_IDS value.
 *
 * One helper replacing the duplicated if/else chains that mapped
 * blastType/spawnType/weaponType strings to invoke calls. Callers keep
 * shaping their own param objects (each macro passes exactly the keys its
 * target reads); this helper only resolves the id and delegates.
 *
 * @param {string} child   one of ATTACK_IDS
 * @param {object} params  param object for the concrete target
 * @param {object} ctx     AttackContext (see context.js)
 * @returns {import('./engine.js').AttackHandle}
 * @throws {Error} when child is not in ATTACK_IDS
 */
export function invokeChild(child, params = {}, ctx) {
  const target = CHILD_TARGETS[child];
  if (!target) {
    throw new Error(`attack: unknown child '${child}' — expected one of: ${ATTACK_IDS.join(', ')}`);
  }
  return invoke(target, params, ctx);
}
