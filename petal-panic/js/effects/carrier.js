// Petal Panic — Generic effect carrier interface (spec: docs/architecture/effects.md §Carriers).
//
// A carrier is anything that owns state an effect needs at fire time: a
// projectile, hitbox, collision event, marker, box, or radius. This module
// defines the shared shape carriers satisfy and the helper that normalizes
// declarative effect config onto it. It is decoupled from any specific entity
// class — real entities adopt the shape by exposing these members (or wrap
// their geometry with makeCarrier), and ad-hoc geometry uses makeCarrier.
//
// Carrier contract (what the engine actually consumes):
//   REQUIRED:
//     effects           -> [{ on, type, params, continuous? }]  normalized config
//     isConditionMet(c) -> boolean    required ONLY when the carrier declares
//                                     a continuous effect ('moving' | 'fastMoving');
//                                     ignored by the engine otherwise
//   OPTIONAL (geometry — needed only by effects that read carrier geometry at
//     fire time, e.g. Beam; the engine itself never calls these):
//     origin()          -> { x, y }   world-space anchor point for effects
//     facing()          -> { x, y }   unit direction the carrier points
//     size()            -> { w, h }   carrier extent in px
//
// Any plain object with `effects` (and `isConditionMet` where needed) is a
// valid carrier — no shared class, no base implementation required.
// makeCarrier below is one convenience implementation that provides all of
// the above; M2–M7 may implement either subset directly on their own types.
//
// Pure module — no DOM required.

import { TRIGGERS } from './index.js';

/**
 * Normalize a list of effect configs and attach them to a carrier.
 *
 * Each entry is accepted as `{ on, type, params }` (params optional) and
 * stored as a fresh object so later mutation of the caller's list never
 * affects the carrier. Entries whose `on` is outside the fixed TRIGGERS
 * vocabulary are rejected: they are dropped from the result and reported via
 * the returned `rejected` array (config bugs surface without crashing).
 *
 * Continuous declarations may stand alone: an entry with `continuous` and no
 * `on` is accepted (the spec allows "a continuous declaration can accompany
 * discrete triggers" — i.e. it can also be the only trigger). Entries with
 * neither `on` nor `continuous` are rejected.
 *
 * @param {object} carrier object to receive the normalized `effects` array
 * @param {Array<object>} list raw effect config entries
 * @returns {{ attached: number, rejected: Array<{ index:number, on:string|undefined }> }}
 */
export function attachEffects(carrier, list = []) {
  if (!carrier || typeof carrier !== 'object') throw new Error('attachEffects: carrier must be an object');
  const normalized = [];
  const rejected = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry || typeof entry !== 'object') { rejected.push({ index: i, on: undefined }); continue; }
    const hasDiscrete = TRIGGERS.includes(entry.on);
    const hasContinuous = !!entry.continuous;
    if (!hasDiscrete && !hasContinuous) { rejected.push({ index: i, on: entry.on }); continue; }
    normalized.push({
      ...(hasDiscrete ? { on: entry.on } : {}),
      type: entry.type,
      params: entry.params ?? {},
      ...(hasContinuous ? { continuous: { condition: entry.continuous.condition } } : {}),
    });
  }
  carrier.effects = normalized;
  return { attached: normalized.length, rejected };
}

/**
 * Build a minimal carrier from plain geometry — for markers, radii, boxes,
 * and other ad-hoc shapes that are not full entity classes.
 *
 * @param {object} spec
 * @param {number} [spec.x] anchor x (defaults to center of the box)
 * @param {number} [spec.y] anchor y (defaults to center of the box)
 * @param {number} [spec.w] width in px
 * @param {number} [spec.h] height in px
 * @param {{x:number,y:number}} [spec.dir] facing vector (normalized internally)
 * @param {Array<object>} [spec.effects] raw effect config (normalized via attachEffects)
 * @param {(condition:string)=>boolean} [spec.isConditionMet] continuous-condition evaluator
 * @returns {object} carrier satisfying the carrier contract
 */
export function makeCarrier({ x, y, w = 0, h = 0, dir, effects, isConditionMet } = {}) {
  const cx = x ?? w / 2;
  const cy = y ?? h / 2;
  let fx = 1, fy = 0; // default facing: +x
  const warnings = [];
  if (dir && typeof dir === 'object') {
    const len = Math.hypot(dir.x, dir.y);
    if (len > 0) { fx = dir.x / len; fy = dir.y / len; }
    else warnings.push(`makeCarrier: zero-length dir ${JSON.stringify(dir)} — falling back to +x facing`);
  } else if (dir != null) {
    warnings.push(`makeCarrier: dir must be a {x, y} vector (got ${typeof dir}) — falling back to +x facing`);
  }
  const carrier = {
    origin() { return { x: cx, y: cy }; },
    facing() { return { x: fx, y: fy }; },
    size() { return { w, h }; },
    effects: [],
  };
  if (typeof isConditionMet === 'function') carrier.isConditionMet = isConditionMet;
  if (effects) attachEffects(carrier, effects);
  if (warnings.length) console.warn(warnings.join('\n'));
  return carrier;
}
