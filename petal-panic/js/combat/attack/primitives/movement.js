// Attack Engine — Movement / Charge primitive (Task 1.7).
//
// Applies intentional attack movement to the attacker: velocity is driven
// toward a target speed with optional easing, for a duration OR distance.
// This file owns ONLY the motion profile. It never moves entities itself in
// gameplay — the host integrator reads `state.vx/vy` each frame (or calls
// stepCharge() which applies them). Obstacle stopping is the collision
// system's job; this primitive reports when it was blocked so macros can
// react (e.g. trigger an impact payload).
//
// bodyDamageOverride is a DATA flag the host applies to the attacker's
// contact rule while the charge is live (see Body Contact Damage, Task 1.8).

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read lazily at construction so synchronous fires inside
// impl() see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  direction: 0,          // radians
  speed: 500,            // target speed px/s
  duration: 0.4,         // seconds (used when distance is null)
  distance: null,        // px — overrides duration when set
  acceleration: 2000,    // px/s² ramp-up (0 = instant, full speed on frame 1)
  stopOnObstacle: true,  // host stops the charge when the entity is blocked
  bodyDamageOverride: null, // e.g. { damage: 20 } applied while charging
});

/**
 * Internal state bag created by impl(). The host loop calls stepCharge()
 * once per update tick until it returns true.
 */
export function makeChargeState(p, ctx) {
  return {
    vx: Math.cos(p.direction) * 0, // built up below
    vy: Math.sin(p.direction) * 0,
    currentSpeed: 0,
    traveled: 0,
    elapsed: 0,
    done: false,
    blocked: false,
  };
}

/**
 * Advance the charge by dt seconds.
 *
 * @param {object} state   from makeChargeState()
 * @param {object} p       merged params
 * @param {object} ctx     AttackContext
 * @param {number} dt      seconds
 * @param {{blocked?:boolean}} [input] host report: was the entity blocked by
 *                                     terrain this frame?
 * @returns {boolean} true when the charge finished
 */
export function stepCharge(state, p, ctx, dt, input = {}) {
  if (state.done) return true;

  // Fill defaults for partial param objects (direct callers may pass bare
  // params; invoke() merges DEFAULTS, but stepCharge is exported standalone).
  const speed = p.speed ?? 500;
  const duration = p.duration ?? 0.4;
  const distance = p.distance ?? null;
  const acceleration = p.acceleration ?? 2000;
  const stopOnObstacle = p.stopOnObstacle ?? true;

  // Ramp speed toward target (acceleration profile).
  const maxStep = acceleration > 0 ? acceleration * dt : Infinity;
  state.currentSpeed = Math.min(speed, state.currentSpeed + maxStep);
  state.vx = Math.cos(p.direction) * state.currentSpeed;
  state.vy = Math.sin(p.direction) * state.currentSpeed;

  // Apply motion to the attacker (host integrator may skip this in tests by
  // passing a plain object without x/y — we guard).
  const a = ctx.attacker;
  if (a && typeof a.x === 'number') {
    a.x += state.vx * dt;
    a.y += state.vy * dt;
  }
  state.traveled += state.currentSpeed * dt;
  state.elapsed += dt;

  // Stop conditions.
  const hitDistance = distance != null && state.traveled >= distance;
  const hitDuration = distance == null && state.elapsed >= duration;
  const blocked = stopOnObstacle && !!input.blocked;

  if (hitDistance || hitDuration || blocked) {
    state.done = true;
    state.blocked = blocked;
    state.vx = 0;
    state.vy = 0;
    return true;
  }
  return false;
}

registerPrimitive('charge', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Movement / Charge',
    desc: 'Drives the attacker along a direction with eased speed for a duration or distance. Host applies velocity + reports obstacles.',
    params: [
      { key: 'direction', desc: 'movement direction (radians)' },
      { key: 'speed', desc: 'target speed (px/s)' },
      { key: 'duration', desc: 'seconds (when distance is null)' },
      { key: 'distance', desc: 'px — overrides duration' },
      { key: 'acceleration', desc: 'px/s² ramp (0 = instant)' },
      { key: 'stopOnObstacle', desc: 'stop when blocked by terrain' },
      { key: 'bodyDamageOverride', desc: 'contact damage while charging' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('charge', null, declaredEffectsOf('charge'));
    h.state = makeChargeState(params, ctx);
    h.step = (dt, input) => {
      const finished = stepCharge(h.state, params, ctx, dt, input);
      if (finished) h._complete({ traveled: h.state.traveled, blocked: h.state.blocked });
      return finished;
    };
    return h;
  },
});
