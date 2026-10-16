// Attack Engine — Beam primitive (Task 1.9).
//
// A continuous damaging line/ray for a duration. The Effect Engine renders the
// visual (registered 'beam' effect); this primitive owns the damaging AABB and
// its lifetime. Placement/motion is macro-level (horizontal, targeted,
// sweeping macros re-aim or move the beam by updating state each frame).
//
// Usage pattern (host loop):
//   const h = attackEngine.invoke('beam', { direction: 0, length: 300, ... }, ctx);
//   each frame while live: h.step(dt, targets) → true when finished.
// Damage ticks at `tickRate` Hz per target (a target standing in the beam
// takes damage every tick, not every frame).

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { resolveMarker } from '../context.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../hitbox.js';

const DEFAULTS = Object.freeze({
  origin: null,        // marker label | {x,y} | null → attacker center
  direction: 0,        // radians; beam axis
  length: 240,         // reach along the axis (px)
  width: 24,           // damaging thickness (px)
  duration: 0.5,       // seconds active
  damage: 20,          // per tick
  tickRate: 8,         // damage ticks per second while overlapping
  team: 'ally',        // ally | foe | neutral (existing team routing)
  method: 'beam',      // telemetry label
  style: null,         // Effect Engine beam params override (color, opacity...)
});

/**
 * Compute the beam's world-space AABB for the current aim.
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function beamBox(p, ctx) {
  const a = ctx.attacker;
  let cx = (a?.x ?? 0) + (a?.w ?? 0) / 2;
  let cy = (a?.y ?? 0) + (a?.h ?? 0) / 2;
  if (p.origin && typeof p.origin === 'object' && 'x' in p.origin) {
    cx = p.origin.x; cy = p.origin.y;
  } else if (typeof p.origin === 'string') {
    const m = resolveMarker(ctx, p.origin);
    if (m) { cx = (a?.x ?? 0) + m.x; cy = (a?.y ?? 0) + m.y; }
  }
  const ang = p.direction;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  // Axis-aligned bounding box of the rotated beam segment (conservative:
  // full extent so nothing inside the visual is ever missed).
  const ex = cx + cos * p.length, ey = cy + sin * p.length;
  const x = Math.min(cx, ex) - p.width / 2;
  const y = Math.min(cy, ey) - p.width / 2;
  return { x, y, w: Math.abs(ex - cx) + p.width, h: Math.abs(ey - cy) + p.width };
}

/**
 * Fire the beam VFX via the Effect Engine (no-op when effects absent).
 * The effect's lifetime is DERIVED from flashInTime + fadeOutTime, so we pass
 * those (not duration) and anchor it at the beam origin with an explicit
 * orientation — fireManual takes no carrier, so params carry everything.
 */
export function fireBeamEffect(p, ctx) {
  const fx = ctx.effects;
  if (!fx || typeof fx.fireManual !== 'function') return null;
  const a = ctx.attacker;
  const ox = p.origin && typeof p.origin === 'object' ? p.origin.x : (a?.x ?? 0) + (a?.w ?? 0) / 2;
  const oy = p.origin && typeof p.origin === 'object' ? p.origin.y : (a?.y ?? 0) + (a?.h ?? 0) / 2;
  try {
    return fx.fireManual({ type: 'beam', params: {
      ...(p.style ?? {}),
      x: ox, y: oy,
      orientation: p.direction,
      length: p.length, width: p.width,
      flashInTime: Math.min(0.05, p.duration / 4),
      fadeOutTime: Math.max(0.1, p.duration - 0.05),
    } });
  } catch {
    return null;
  }
}

/**
 * Per-frame step: advance the clock, run the damaging hitbox against targets
 * at the configured tick rate. Returns true when the beam ended.
 *
 * @param {object} state internal state bag
 * @param {object} p     merged params
 * @param {object} ctx   AttackContext
 * @param {number} dt    frame delta (s)
 * @param {Array<object>} targets candidate entities
 * @param {AttackHandle} h handle to emit on
 */
export function stepBeam(state, p, ctx, dt, targets, h) {
  if (state.done) return true;
  state.t += dt;
  state.tickAcc += dt;

  const tickInterval = 1 / Math.max(1, p.tickRate);
  let hitsThisTick = 0;
  while (state.tickAcc >= tickInterval) {
    state.tickAcc -= tickInterval;
    state.hb.box = beamBox(p, ctx);
    state.hb.damage = p.damage;
    resetHitbox(state.hb); // fresh tick → same target can be hit again next tick
    const hits = [];
    processHitboxes([state.hb], targets, (hb, t, dealt) => hits.push({ target: t, dealt }));
    for (const hit of hits) h._emit('hit', { target: hit.target, dealt: hit.dealt });
    hitsThisTick = hits.length;
  }

  if (state.t >= p.duration) {
    state.done = true;
    state.hb.active = false;
    h._complete({ ticks: Math.round(state.t * p.tickRate) });
    return true;
  }
  void hitsThisTick;
  return false;
}

registerPrimitive('beam', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Beam',
    effects: [
      { type: 'beam', desc: 'the beam body itself (Effect Engine renders it)' },
    ],
    desc: 'Continuous damaging line for a duration. Effect Engine renders; primitive owns the AABB + tick-rate damage.',
    params: [
      { key: 'origin', desc: "marker label | {x,y} | null → attacker center" },
      { key: 'direction', desc: 'radians (beam axis)' },
      { key: 'length', desc: 'reach (px)' },
      { key: 'width', desc: 'damaging thickness (px)' },
      { key: 'duration', desc: 'seconds active' },
      { key: 'damage', desc: 'damage per tick' },
      { key: 'tickRate', desc: 'damage ticks per second' },
      { key: 'team', desc: 'ally | foe | neutral' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('beam');
    const hb = makeHitbox({ owner: ctx.attacker, team: params.team, box: null, damage: params.damage, method: params.method });
    resetHitbox(hb);
    h.state = { t: 0, tickAcc: 0, done: false, hb };
    fireBeamEffect(params, ctx);
    h.step = (dt, targets) => stepBeam(h.state, params, ctx, dt, targets ?? [], h);
    return h;
  },
});
