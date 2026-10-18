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

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { resolveMarker } from '../context.js';
import { fireDeclared } from '../../../effects/index.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../hitbox.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read lazily at construction so synchronous fires inside
// impl() see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  origin: null,        // marker label | {x,y} | null → attacker facing edge
  direction: 0,        // radians; beam axis
  length: 240,         // reach along the axis (px)
  width: 24,           // damaging thickness (px)
  duration: 1,         // seconds active
  damage: 20,          // per tick
  tickRate: 8,         // damage ticks per second while overlapping
  team: 'ally',        // ally | foe | neutral (existing team routing)
  method: 'beam',      // telemetry label
  style: null,         // Effect Engine beam params override (color, opacity...)
});

/**
 * Compute the beam's world-space AABB for the current aim.
 * @param {object} p params
 * @param {object} ctx AttackContext
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function beamBox(p, ctx) {
  const a = ctx.attacker;
  let cx, cy;
  if (p.origin && typeof p.origin === 'object' && 'x' in p.origin) {
    cx = p.origin.x; cy = p.origin.y;
  } else if (typeof p.origin === 'string') {
    const m = resolveMarker(ctx, p.origin);
    if (m) { cx = (a?.x ?? 0) + m.x; cy = (a?.y ?? 0) + m.y; }
    else { cx = (a?.x ?? 0) + (a?.w ?? 0) / 2; cy = (a?.y ?? 0) + (a?.h ?? 0) / 2; }
  } else {
    // Default: offset to the facing edge (gun tip), not body center.
    const ang = p.direction;
    const cos0 = Math.cos(ang), sin0 = Math.sin(ang);
    const hw = (a?.w ?? 0) / 2, hh = (a?.h ?? 0) / 2;
    const dx = Math.abs(cos0) * hw + Math.abs(sin0) * hh;
    cx = (a?.x ?? 0) + hw + cos0 * dx;
    cy = (a?.y ?? 0) + hh + sin0 * dx;
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
 * The effect's lifetime is DERIVED from flashInTime + holdTime + fadeOutTime.
 * By default we map the primitive's `duration` to the effect's `holdTime`
 * (the full-power shimmer phase) and use fixed tuned values for flash-in and
 * fade-out so the visual always looks good regardless of duration. A caller may
 * override ANY of the three phase times via `style` (e.g. the sweepingBeam
 * macro aligns them to its own choreography); style values win over the
 * derived defaults.
 */
export function fireBeamEffect(p, ctx) {
  const a = ctx.attacker;
  let ox, oy;
  if (p.origin && typeof p.origin === 'object' && 'x' in p.origin) {
    ox = p.origin.x; oy = p.origin.y;
  } else if (typeof p.origin === 'string') {
    const m = resolveMarker(ctx, p.origin);
    ox = (a?.x ?? 0) + (m ? m.x : 0);
    oy = (a?.y ?? 0) + (m ? m.y : 0);
  } else {
    // Default: offset to the facing edge (gun tip), not body center.
    const ang = p.direction;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const hw = (a?.w ?? 0) / 2, hh = (a?.h ?? 0) / 2;
    const dx = Math.abs(cos) * hw + Math.abs(sin) * hh;
    ox = (a?.x ?? 0) + hw + cos * dx;
    oy = (a?.y ?? 0) + hh + sin * dx;
  }
  const style = p.style ?? {};
  try {
    // 'beam' is declared in this primitive's meta.effects; the guard accepts it.
    return fireDeclared({ type: 'beam', params: {
      x: ox, y: oy,
      orientation: p.direction,
      length: p.length, width: p.width,
      // Derived defaults first, then spread style so explicit overrides win.
      flashInTime: 0.04,
      holdTime: Math.max(0, p.duration - 0.6),
      fadeOutTime: 0.6,
      ...style,
    } }, ['beam']); // standalone helper: no handle in scope; 'beam' is this primitive's declared type
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
    // A host (e.g. the sweepingBeam macro) may overwrite the box each frame
    // to move the beam. When `_swept` is set, trust the existing box instead
    // of recomputing the static one.
    if (!state._swept) state.hb.box = beamBox(p, ctx);
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
      { key: 'origin', desc: "marker label | {x,y} | null → attacker facing edge" },
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
    const h = new AttackHandle('beam', null, declaredEffectsOf('beam'));
    const hb = makeHitbox({ owner: ctx.attacker, team: params.team, box: null, damage: params.damage, method: params.method });
    resetHitbox(hb);
    h.state = { t: 0, tickAcc: 0, done: false, hb };
    h.state._fx = fireBeamEffect(params, ctx);
    h.step = (dt, targets) => stepBeam(h.state, params, ctx, dt, targets ?? [], h);
    return h;
  },
});
