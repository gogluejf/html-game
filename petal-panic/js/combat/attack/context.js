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

import { Effects } from '../../effects.js';

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
 *                                    Defaults to the real Effects facade in makeContext.
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
    // Default to the real Effect Engine facade so VFX (explosion bursts,
    // shake) fire without every caller passing effects explicitly. Callers
    // may still override (tests pass minimal stubs).
    effects: extra.effects ?? Effects,
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
 * Returns world-space coordinates with full transform applied:
 *   sheet → pivot-relative → scaled → mirrored (facing) → hero anchor.
 * The hero's bottom-center is the anchor (same as sprite draw).
 *
 * @param {AttackContext} ctx
 * @param {string} label marker label (e.g. 'muzzle', 'chest')
 * @returns {{x:number,y:number}|null}
 */
export function resolveMarker(ctx, label) {
  const a = ctx.attacker;
  if (!a) return null;

  // Get markers from the active anim's parsed data
  const animData = a.sprite?.anims?.[a._spriteAnim];
  const list = animData?.markers ?? ctx.markers ?? a.markers;
  if (!list || list.length === 0) return null;
  const m = list.find((mk) => mk.label === label);
  if (!m) return null;

  const scale = a._spriteScale ?? 1;

  // The game anchors the sprite so the collision box bottom-center lands on
  // the hero's (x + w/2, y + h). Markers are in the same sprite-space as the
  // collision box, so we offset from the collision box bottom-center.
  const cb = animData?.collisionBox;
  let anchorX, anchorY;
  if (cb) {
    anchorX = cb.x + cb.w / 2;   // collision box horizontal center
    anchorY = cb.y + cb.h;       // collision box bottom edge
  } else {
    anchorX = 0;
    anchorY = 0;
  }

  // Offset from anchor, scaled
  let dx = (m.x - anchorX) * scale;
  const dy = (m.y - anchorY) * scale;

  // Mirror X when facing left
  const facing = a.facing ?? 1;
  if (facing < 0) dx = -dx;

  // World position: hero bottom-center is (a.x + a.w/2, a.y + a.h)
  return {
    x: a.x + (a.w ?? 0) / 2 + dx,
    y: a.y + (a.h ?? 0) + dy,
  };
}

/**
 * Attack lifecycle events. A handle emits these via `.on(event, cb)`.
 * - contact:  non-consuming carrier contact (opt-in bomb lifecycle)
 * - hit:      a damaging interaction landed (may fire multiple times)
 * - expire:   the attack ran out of time/range without completing its purpose
 * - detonate: a bomb/explosion payload fired
 * - complete: the attack finished (always fires exactly once, last)
 */
export const ATTACK_EVENTS = Object.freeze(['hit', 'contact', 'expire', 'detonate', 'land', 'vanish', 'complete']);
