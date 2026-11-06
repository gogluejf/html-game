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
//   expl_proj  → 'explosiveProjectile'   macro: carrier → explosion zone on impact
//   shock_proj  → 'shockwaveProjectile'   macro: carrier → shockwave zone on impact
//   rock         → 'rock'                  macro: arcing carrier, decay bounce, contact damage, no explosion
//   napalm     → 'napalm'                macro: carrier → fireArea on impact
//
// Note: 'expl_proj'/'shock_proj'/'napalm' are PROJECTILE-CARRIER
// macros — they fly and materialize their zone effect on impact. They are NOT the
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
  'expl_proj',
  'shock_proj',
  'shock_bomb',
  'rock',
  'napalm',
]);

/** child value → the concrete invoke target the code already uses today. */
export const CHILD_TARGETS = Object.freeze({
  projectile: 'projectile',
  bomb: 'explosiveBomb',
  mine: 'throwMine',
  molotov: 'molotov',
  enemy: 'throwEnemy',
  expl_proj: 'explosiveProjectile',
  shock_proj: 'shockwaveProjectile',
  shock_bomb: 'shockwaveBomb',
  rock: 'rock',
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

/**
 * Per-child param surface — the "sub-payload" contract (M3 completion).
 *
 * Every child-consuming macro reads the SAME shape:
 *
 *   child:   '<ATTACK_IDS value>'   — scalar selector
 *   payload: { ... }                — one nested object, keys per the child
 *
 * Only ONE child materializes per invoke, so only ONE payload is ever read —
 * the target macro reads the keys it wants and ignores the rest. No flat
 * namespace merge -> no cross-child key collisions (mine's ttl vs bomb's ttl
 * vs shockwave's radius never coexist in a live resolve).
 *
 * This table is METADATA ONLY (key + desc + kind for panels). It holds NO
 * defaults — defaults live in the target macro (single owner, no drift).
 * The attack theater derives the child panel rows from this spec: pick
 * child=mine, the panel shows exactly the mine payload keys.
 *
 * kind: 'num' | 'enum' | 'enemy' — the theater's TWEAKABLE kinds.
 * enum values are inlined here (stable vocabularies); 'enemy' references
 * ENEMY_TYPE_IDS at panel-build time.
 */
export const CHILD_PARAM_SPECS = Object.freeze({
  projectile: Object.freeze([
    { key: 'damage', kind: 'num', step: 2, desc: 'thorn contact damage' },
  ]),
  bomb: Object.freeze([
    { key: 'ttl', kind: 'num', step: 0.5, desc: 'fuse seconds' },
    { key: 'arc', kind: 'num', step: 100, desc: 'gravity px/s2' },
    { key: 'bounce', kind: 'enum', values: [false, true], desc: 'reflect off surfaces' },
    { key: 'damage', kind: 'num', step: 5, desc: 'blast damage' },
    { key: 'radius', kind: 'num', step: 10, desc: 'blast radius (px)' },
  ]),
  mine: Object.freeze([
    { key: 'ttl', kind: 'num', step: 0.5, null: true, desc: 'resting fuse seconds; null = contact only' },
    { key: 'blinkDuration', kind: 'num', step: 0.25, desc: 'warning seconds before detonation' },
    { key: 'mineType', kind: 'enum', values: ['explosion', 'shockwave'], desc: 'payload type' },
    { key: 'radius', kind: 'num', step: 10, desc: 'payload radius (px)' },
  ]),
  molotov: Object.freeze([
    { key: 'arc', kind: 'num', step: 100, desc: 'gravity px/s2 (lobe fall)' },
    { key: 'bounce', kind: 'enum', values: [false, true], desc: 'reflect off surfaces before shattering' },

    { key: 'damage', kind: 'num', step: 2, desc: 'carrier contact damage' },
    { key: 'fireWidth', kind: 'num', step: 8, desc: 'burn area width (px)' },
    { key: 'fireDuration', kind: 'num', step: 0.5, desc: 'how long the area burns (s)' },
    { key: 'fireTickRate', kind: 'num', step: 1, desc: 'damage ticks per second in the area' },
    { key: 'fireDamage', kind: 'num', step: 2, desc: 'damage per tick in the area' },
  ]),
  enemy: Object.freeze([
    { key: 'enemyType', kind: 'enemy', desc: 'enemy id when the carrier lands' },
    { key: 'mineType', kind: 'enum', values: ['explosion', 'shockwave'], desc: 'landed payload type' },
  ]),
  expl_proj: Object.freeze([
    { key: 'damage', kind: 'num', step: 5, desc: 'blast damage' },
    { key: 'radius', kind: 'num', step: 10, desc: 'blast radius (px)' },
  ]),
  shock_proj: Object.freeze([
    { key: 'damage', kind: 'num', step: 5, desc: 'ring damage' },
    { key: 'radius', kind: 'num', step: 10, desc: 'ring max radius (px)' },
  ]),
  shock_bomb: Object.freeze([
    { key: 'arc', kind: 'num', step: 100, desc: 'gravity px/s2' },
    { key: 'bounce', kind: 'enum', values: [false, true], desc: 'reflect off surfaces' },
    { key: 'ttl', kind: 'num', step: 0.5, desc: 'fuse seconds' },
    { key: 'damage', kind: 'num', step: 5, desc: 'ring-pass damage' },
    { key: 'radius', kind: 'num', step: 10, desc: 'shockwave max radius (px)' },
    { key: 'duration', kind: 'num', step: 0.1, desc: 'ring expansion time (s)' },
  ]),
  rock: Object.freeze([
    { key: 'arc', kind: 'num', step: 100, desc: 'gravity px/s2' },
    { key: 'damage', kind: 'num', step: 5, desc: 'contact damage' },
    { key: 'ttl', kind: 'num', step: 0.5, desc: 'fuse seconds' },
    { key: 'spin', kind: 'num', step: 0.5, desc: 'tumble rate (rad/s)' },
  ]),
  napalm: Object.freeze([
    { key: 'fireWidth', kind: 'num', step: 8, desc: 'burn area width (px)' },
    { key: 'fireDuration', kind: 'num', step: 0.5, desc: 'how long the area burns (s)' },
  ]),
});

/** True when `child` is a valid ATTACK_IDS value. */
export function isChild(child) {
  return typeof child === 'string' && CHILD_TARGETS[child] != null;
}
