// Attack Engine — Reticle / Telegraph primitive (Task 1.10).
//
// A visual warning that an attack is about to happen at a position or on a
// target. Purely visual + timing: NO damage, no collision. The visual belongs
// to the Effect Engine (this primitive fires it); this file owns placement
// resolution, tracking/lock behavior, and lifecycle events.
//
// Lifecycle:
//   invoke() → handle live; 'complete' fires when the warning window elapses
//   (i.e. NOW is the moment the armed attack should activate). cancel() tears
//   down early. For `tracking` reticles the position follows the target until
//   `lockTime` (seconds from start) then freezes.
//
// Host-loop contract: call stepReticle(state, params, ctx, dt, h) once per
// frame while the handle is live. Returns true when finished.

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { resolveMarker } from '../context.js';

const DEFAULTS = Object.freeze({
  x: null,             // explicit world x (used when target is null)
  y: null,             // explicit world y
  target: null,        // entity to track/anchor (overrides x/y when given)
  duration: 0.6,       // seconds of warning before the attack activates
  style: 'reticle',    // effect type: 'target-reticle' | 'telegraph-circle' | 'ground-target-marker'
  color: '#ff5555',
  radius: 28,          // visual size hint for the effect
  tracking: false,     // follow the target while active
  lockTime: null,      // seconds after start when the position freezes (tracking only)
});

/** Map our style ids onto registered Effect Engine types. */
const STYLE_EFFECT = {
  reticle: 'target-reticle',
  circle: 'telegraph-circle',
  marker: 'ground-target-marker',
};

/**
 * Resolve the current anchor point for the telegraph.
 * Order: tracked target center → explicit {x,y} params → attacker center.
 * @returns {{x:number,y:number}}
 */
export function telegraphPoint(params, ctx, locked = null) {
  if (locked) return locked;
  const t = params.target ?? ctx.target;
  if (t && t.alive !== false) {
    return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  }
  if (params.x != null && params.y != null) return { x: params.x, y: params.y };
  const a = ctx.attacker;
  return { x: (a?.x ?? 0) + (a?.w ?? 0) / 2, y: (a?.y ?? 0) + (a?.h ?? 0) / 2 };
}

/**
 * Fire the warning VFX via the Effect Engine (no-op when effects is absent,
 * e.g. pure-logic tests). Returns the effect instance or null.
 */
export function fireTelegraphEffect(params, pt, ctx) {
  const fx = ctx.effects;
  if (!fx || typeof fx.fireManual !== 'function') return null;
  const type = STYLE_EFFECT[params.style] ?? STYLE_EFFECT.reticle;
  try {
    return fx.fireManual({ type, params: { ...params, x: pt.x, y: pt.y, color: params.color, radius: params.radius } });
  } catch {
    return null; // unknown style in a minimal test context — timing still works
  }
}

/**
 * Per-frame step. Advances the clock, re-fires tracking VFX while unlocked,
 * and completes at the end of the warning window.
 * @returns {boolean} true when the telegraph finished (attack may activate)
 */
export function stepReticle(state, params, ctx, dt, h) {
  if (state.done) return true;
  state.t += dt;

  // Lock the position once past lockTime (default: immediately, i.e. static).
  if (!state.locked && (params.lockTime == null || state.t >= params.lockTime)) {
    state.locked = telegraphPoint(params, ctx);
  }

  // Tracking phase: refresh the visual each frame so it rides the target.
  if (params.tracking && !state.locked) {
    state.pt = telegraphPoint(params, ctx);
    fireTelegraphEffect(params, state.pt, ctx);
  }

  if (state.t >= params.duration) {
    state.done = true;
    h._complete({ point: state.locked ?? state.pt });
    return true;
  }
  return false;
}

registerPrimitive('reticle', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Reticle / Telegraph',
    desc: 'Visual warning before an attack activates. No damage — timing + placement only. complete fires when the attack should go off.',
    params: [
      { key: 'x', desc: 'world x (when no target)' },
      { key: 'y', desc: 'world y (when no target)' },
      { key: 'target', desc: 'entity to anchor/track' },
      { key: 'duration', desc: 'warning window (s)' },
      { key: 'style', desc: "reticle | circle | marker" },
      { key: 'color', desc: 'VFX color' },
      { key: 'radius', desc: 'visual size' },
      { key: 'tracking', desc: 'follow target until lockTime' },
      { key: 'lockTime', desc: 's after start when position freezes' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('reticle');
    const pt = telegraphPoint(params, ctx);
    h.state = { t: 0, done: false, pt, locked: null };
    fireTelegraphEffect(params, pt, ctx);
    h.step = (dt) => stepReticle(h.state, params, ctx, dt, h);
    return h;
  },
});
