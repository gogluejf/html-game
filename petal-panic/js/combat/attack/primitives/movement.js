// Attack Engine — Movement / Charge primitive (Task 1.7).
//
// Applies intentional attack movement to the attacker: velocity is driven
// toward a target speed with optional easing, for a fixed distance or until
// out of screen. This file owns ONLY the motion profile. It never moves
// entities itself in gameplay — the host integrator reads `state.vx/vy` each
// frame (or calls stepCharge() which applies them). Obstacle stopping is the
// collision system's job; this primitive reports when it was blocked so
// macros can react (e.g. trigger an impact payload).
//
// bodyDamageOverride is a DATA flag the host applies to the attacker's
// contact rule while the charge is live (see Body Contact Damage, Task 1.8).

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { fireDeclared } from '../../../effects/index.js';
import { announceMarkerPoint } from './beam.js';
import { VIEW_W, VIEW_H } from '../../../core/view.js';

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
  distanceType: 'fixed', // 'fixed' | 'infinit'
  distance: 200,         // px — the value when distanceType is 'fixed'
  acceleration: 2000,    // px/s² ramp-up (0 = instant, full speed on frame 1)
  stopOnObstacle: true,  // host stops the charge when the entity is blocked
  bodyDamageOverride: null, // e.g. { damage: 20 } applied while charging
  announceMarker: false, // boundary telegraph before the charge starts
  announceDelay: 1.0,    // s the marker stays visible
  easing: 'linear',      // linear | easeIn (t²) | easeInCubic (t³) — speed profile over the charge
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
/** Eased progress: maps linear t∈[0,1] to eased t∈[0,1]. Same curves as shockwave. */
function ease(t, mode) {
  if (mode === 'easeInCubic') return t * t * t;
  if (mode === 'easeIn') return t * t;
  return t; // linear (default)
}

export function stepCharge(state, p, ctx, dt, input = {}) {
  if (state.done) return true;

  // Fill defaults for partial param objects (direct callers may pass bare
  // params; invoke() merges DEFAULTS, but stepCharge is exported standalone).
  const speed = p.speed ?? 500;
  const distanceType = p.distanceType ?? 'fixed'; // 'fixed' | 'infinit'
  const distance = (distanceType === 'fixed') ? (p.distance ?? 200) : null;
  const acceleration = p.acceleration ?? 2000;
  const stopOnObstacle = p.stopOnObstacle ?? true;
  const easing = p.easing ?? 'linear';

  // Easing: modulates the effective speed over the charge lifetime.
  // Only applies when acceleration is 0 (instant full speed) AND easing is
  // not 'linear' (linear = constant speed, no modulation needed).
  // Progress is TIME-based (not distance-based — that would deadlock at t=0):
  //   totalTime ≈ distance / speed (for fixed) or unbounded (infinit → skip).
  let easedT = 1;
  if (acceleration <= 0 && easing !== 'linear' && distance != null) {
    const totalTime = distance / speed;
    const t = Math.min(1, state.elapsed / totalTime);
    easedT = ease(t, easing);
  }

  // Ramp speed toward target (acceleration profile), then apply easing.
  const maxStep = acceleration > 0 ? acceleration * dt : Infinity;
  state.currentSpeed = Math.min(speed, state.currentSpeed + maxStep);
  const effSpeed = state.currentSpeed * easedT;
  state.vx = Math.cos(p.direction) * effSpeed;
  state.vy = Math.sin(p.direction) * effSpeed;

  // Apply motion to the attacker (host integrator may skip this in tests by
  // passing a plain object without x/y — we guard).
  const a = ctx.attacker;
  if (a && typeof a.x === 'number') {
    a.x += state.vx * dt;
    a.y += state.vy * dt;
  }
  state.traveled += effSpeed * dt;
  state.elapsed += dt;

  // Stop conditions.
  let hitDistance = false;
  if (distance != null) {
    hitDistance = state.traveled >= distance;
  } else if (distanceType === 'infinit') {
    // Stop when the attacker leaves the visible screen.
    const cam = ctx.camera ?? null;
    const viewX = cam?.x ?? 0;
    const viewY = cam?.y ?? 0;
    const margin = 60; // px grace past the edge
    const ax = a?.x ?? 0, ay = a?.y ?? 0;
    hitDistance = ax < viewX - margin || ax > viewX + VIEW_W + margin ||
                  ay < viewY - margin || ay > viewY + VIEW_H + margin;
  }
  const blocked = stopOnObstacle && !!input.blocked;

  if (hitDistance || blocked) {
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
    effects: [
      { type: 'surface-target-marker', desc: 'optional boundary telegraph before the charge starts (announceMarker)' },
    ],
    desc: 'Drives the attacker along a direction with eased speed for a fixed distance or until out of screen. Optional boundary announcement (announceMarker) telegraphs the entry side. Host applies velocity + reports obstacles.',
    params: [
      { key: 'direction', desc: 'movement direction (radians, full 0–2π)' },
      { key: 'speed', desc: 'target speed (px/s)' },
      { key: 'distanceType', desc: "'fixed' | 'infinit'" },
      { key: 'distance', desc: 'px (used when distanceType is "fixed")' },
      { key: 'acceleration', desc: 'px/s² ramp (0 = instant)' },
      { key: 'easing', desc: 'linear | easeIn | easeInCubic — speed profile over the charge' },
      { key: 'stopOnObstacle', desc: 'stop when blocked by terrain' },
      { key: 'bodyDamageOverride', desc: 'contact damage while charging' },
      { key: 'announceMarker', desc: 'bool (default false) — boundary marker before the charge starts' },
      { key: 'announceDelay', desc: 's the marker stays visible (default 1.0)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('charge', null, declaredEffectsOf('charge'));
    const state = makeChargeState(params, ctx);

    // Announcement window: marker at the boundary → gap → charge begins.
    const ANNOUNCE_GAP = 0.12;
    const announceTotal = params.announceMarker ? Math.max(0, params.announceDelay) + ANNOUNCE_GAP : 0;
    let announceElapsed = 0;
    let started = !params.announceMarker;

    if (params.announceMarker) {
      const pt = announceMarkerPoint(
        { origin: { x: ctx.attacker?.x ?? 0, y: ctx.attacker?.y ?? 0 }, direction: params.direction, length: params.distance ?? 9999 },
        ctx,
      );
      fireDeclared({ type: 'surface-target-marker', params: {
        x: pt.x, y: pt.y,
        angle: params.direction + Math.PI / 2,
        spinRate: 0,
        duration: Math.max(0, params.announceDelay),
      } }, h.declaredEffectTypes());
    }

    h.state = state;
    h.step = (dt, input) => {
      if (state.done) return true;
      // Announcement gate: delay the charge start.
      if (!started) {
        announceElapsed += dt;
        if (announceElapsed < announceTotal) return false;
        started = true;
      }
      const finished = stepCharge(state, params, ctx, dt, input);
      if (finished) h._complete({ traveled: state.traveled, blocked: state.blocked });
      return finished;
    };
    return h;
  },
});
