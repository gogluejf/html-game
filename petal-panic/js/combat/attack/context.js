// Attack Engine — shared context + event contract (Task 1.1).
//
// Every primitive and macro receives an AttackContext bag instead of reaching
// for globals. This keeps primitives pure-ish (testable in node with a stub
// world) and makes the dependency surface explicit: if a primitive needs the
// effect engine, it asks for `effects`; if it needs collision, `collisionWorld`.
//
// The context is NOT frozen — callers may add game-specific fields (e.g.
// `level`, `camera`) without changing the interface. The fields below are the
// guaranteed minimum every primitive can rely on.

/**
 * @typedef {object} AttackContext
 * @property {object} attacker        entity that owns this attack (hero/enemy/boss).
 * @property {object|null} [target]   optional primary target (for aimed attacks).
 * @property {object} world           game world reference (entities, level state...).
 * @property {Array<{label:string,x:number,y:number,radiusOn?:number,radius?:number}>|null} [markers]
 *                                    sprite-crop markers for the attacker's current
 *                                    animation (`attacker.markers`). Primitives resolve
 *                                    origins via `markers.find(m => m.label === origin)`.
 * @property {object} effects         Effect Engine facade (fire/fireManual/hasEffect...).
 * @property {import('../../core/collision.js').CollisionWorld|null} [collisionWorld]
 *                                    live collision registry; null in pure-logic tests.
 */

/**
 * Build a context from an attacker plus whatever the caller has on hand.
 * Convenience wrapper so call sites don't repeat the shape.
 *
 * @param {object} attacker
 * @param {object} [extra] partial context overrides (world, target, effects...)
 * @returns {AttackContext}
 */
export function makeContext(attacker, extra = {}) {
  return {
    attacker,
    target: extra.target ?? null,
    world: extra.world ?? null,
    markers: extra.markers ?? attacker?.markers ?? null,
    effects: extra.effects ?? null,
    collisionWorld: extra.collisionWorld ?? null,
    ...extra,
  };
}

/**
 * Center point of an entity box. The shared "where is the target" helper for
 * aimed attacks and telegraphing effects (which track a live entity by moving
 * the effect instance's origin each frame).
 * @param {object|null} e entity with x/y/w/h
 * @returns {{x:number,y:number}|null} center, or null when no entity
 */
export function targetCenter(e) {
  if (!e) return null;
  return { x: e.x + e.w / 2, y: e.y + e.h / 2 };
}

/**
 * Resolve a named marker to a world-space point.
 * Markers come from the sprite-crop editor schema:
 *   st.markers = [{ label, x, y, radiusOn, radius }] per animation.
 *
 * Coordinates are relative to the entity's anchor; the caller adds the
 * entity position if needed (primitives decide their own convention —
 * see each primitive's doc). Returns null when no marker matches so
 * primitives can fall back to the entity center.
 *
 * @param {AttackContext} ctx
 * @param {string} label marker label (e.g. 'muzzle', 'chest')
 * @returns {{x:number,y:number}|null}
 */
export function resolveMarker(ctx, label) {
  const list = ctx.markers ?? ctx.attacker?.markers;
  if (!list) return null;
  const m = list.find((mk) => mk.label === label);
  return m ? { x: m.x, y: m.y } : null;
}

/**
 * Attack lifecycle events. A handle emits these via `.on(event, cb)`.
 * - hit:      a damaging interaction landed (may fire multiple times)
 * - expire:   the attack ran out of time/range without completing its purpose
 * - detonate: a bomb/explosion payload fired
 * - complete: the attack finished (always fires exactly once, last)
 */
export const ATTACK_EVENTS = Object.freeze(['hit', 'expire', 'detonate', 'complete']);
