// Attack Engine — Melee Hitbox primitive (Task 1.6).
//
// A temporary damaging AABB, usually synchronized with active animation
// frames. Reuses the EXISTING unified hitbox system (combat/hitbox.js):
// makeHitbox() + processHitboxes() own team routing, self-exclusion, and
// per-swing hit dedup. This file owns: box computation from params/marker,
// frame counting, and lifecycle events.
//
// Usage pattern (host loop):
//   const h = attackEngine.invoke('meleeHitbox', { activeFrames: 8, ... }, ctx);
//   each frame while h is live: stepMelee(h.entity, p, ctx, targets, h)
// The handle completes when activeFrames elapse or cancel() is called.

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../hitbox.js';
import { resolveMarker } from '../context.js';

const DEFAULTS = Object.freeze({
  activeFrames: 8,     // how many update ticks the box stays live
  w: 40, h: 32,        // box size
  offset: null,        // {x,y} world offset from attacker center, OR marker label
  damage: 10,
  knockback: null,     // KnockbackSetting applied on impact (routed by host)
  hitLimit: 1,         // hits per target during this action (hitSet enforces it)
  team: 'ally',        // ally | foe | neutral (existing team routing)
  method: 'melee',     // telemetry label
});

/**
 * Compute the world-space AABB for this frame.
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function meleeBox(p, ctx) {
  const a = ctx.attacker;
  let cx = (a?.x ?? 0) + (a?.w ?? 0) / 2;
  let cy = (a?.y ?? 0) + (a?.h ?? 0) / 2;
  if (typeof p.offset === 'string') {
    const m = resolveMarker(ctx, p.offset);
    if (m) { cx = (a?.x ?? 0) + m.x; cy = (a?.y ?? 0) + m.y; }
  } else if (p.offset && typeof p.offset === 'object') {
    cx += p.offset.x; cy += p.offset.y;
  }
  return { x: cx - p.w / 2, y: cy - p.h / 2, w: p.w, h: p.h };
}

/**
 * Per-frame step: keep the hitbox live for `activeFrames` ticks, processing
 * it against `targets` each tick. Returns true when the action finished.
 *
 * @param {object} state  internal state bag (created by impl)
 * @param {object} p      merged params
 * @param {object} ctx    AttackContext
 * @param {Array<object>} targets candidate entities
 * @param {AttackHandle} h  handle to emit on
 */
export function stepMelee(state, p, ctx, targets, h) {
  if (state.done) return true;
  state.frame++;

  const box = meleeBox(p, ctx);
  state.hb.box = box;
  state.hb.damage = p.damage;
  state.hb.knockback = p.knockback ?? null;
  state.hb.active = true;

  // Process just THIS hitbox against the target set (the generic loop does
  // team routing, self-exclusion, hitSet dedup, damage routing).
  const hits = [];
  processHitboxes([state.hb], targets, (hb, target, dealt) => {
    hits.push({ target, dealt });
  });
  for (const hit of hits) {
    h._emit('hit', { target: hit.target, dealt: hit.dealt });
  }

  if (state.frame >= p.activeFrames) {
    state.done = true;
    state.hb.active = false;
    h._complete({ hits: hits.length });
    return true;
  }
  return false;
}

registerPrimitive('meleeHitbox', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Melee Hitbox',
    desc: 'Temporary damaging AABB via the unified hitbox system. Frame-synced; hitLimit per target per swing.',
    params: [
      { key: 'activeFrames', desc: 'ticks the box stays live' },
      { key: 'w', desc: 'box width (px)' },
      { key: 'h', desc: 'box height (px)' },
      { key: 'offset', desc: '{x,y} from attacker center, or marker label' },
      { key: 'damage', desc: 'raw damage (defense still applies)' },
      { key: 'knockback', desc: 'KnockbackSetting on impact' },
      { key: 'hitLimit', desc: 'hits per target this swing' },
      { key: 'team', desc: 'ally | foe | neutral' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('meleeHitbox');
    const hb = makeHitbox({ owner: ctx.attacker, team: params.team, box: null, damage: params.damage, method: params.method });
    resetHitbox(hb);
    h.state = { hb, frame: 0, done: false };
    h.step = (targets) => stepMelee(h.state, params, ctx, targets, h);
    return h;
  },
});
