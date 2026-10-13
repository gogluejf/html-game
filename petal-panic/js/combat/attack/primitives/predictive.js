// Attack Engine — Predictive Targeting primitive (Task 1.12).
//
// Pure aiming math: given a moving target, compute the point it will occupy
// after `predictionTime` seconds (clamped to `maxPrediction` distance), and
// the direction from an origin to that point. It creates nothing — the result
// feeds into the Projectile primitive (or any aimed attack).
//
// Synchronous: impl() completes immediately; results live on the handle as
// `handle.point` ({x,y} world aim point) and `handle.direction` (radians from
// origin to that point).

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  target: null,        // entity being predicted (default: ctx.target)
  predictionTime: 0.3, // seconds of lead
  maxPrediction: null, // optional cap on lead distance (px); null = unlimited
  origin: null,        // {x,y} aim origin; default = attacker center
});

/**
 * Compute the predicted aim point for a target with velocity (vx, vy).
 * @returns {{x:number,y:number}}
 */
export function predictPoint(target, predictionTime, maxPrediction = null) {
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  let dx = (target.vx ?? 0) * predictionTime;
  let dy = (target.vy ?? 0) * predictionTime;
  if (maxPrediction != null) {
    const d = Math.hypot(dx, dy);
    if (d > maxPrediction) {
      dx = (dx / d) * maxPrediction;
      dy = (dy / d) * maxPrediction;
    }
  }
  return { x: cx + dx, y: cy + dy };
}

registerPrimitive('predictive', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Predictive Targeting',
    desc: 'Aim-point math: leads a moving target by predictionTime (capped at maxPrediction). Synchronous — reads handle.point / handle.direction.',
    params: [
      { key: 'target', desc: 'entity to lead (default ctx.target)' },
      { key: 'predictionTime', desc: 'seconds of lead' },
      { key: 'maxPrediction', desc: 'max lead distance px (null = ∞)' },
      { key: 'origin', desc: '{x,y} aim origin (default attacker center)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('predictive');
    const t = params.target ?? ctx.target;
    const a = ctx.attacker;
    const ox = params.origin?.x ?? ((a?.x ?? 0) + (a?.w ?? 0) / 2);
    const oy = params.origin?.y ?? ((a?.y ?? 0) + (a?.h ?? 0) / 2);
    if (!t) {
      // No target: aim straight ahead from origin (direction 0).
      h.point = { x: ox + 1, y: oy };
      h.direction = 0;
      h._complete();
      return h;
    }
    h.point = predictPoint(t, params.predictionTime, params.maxPrediction);
    h.direction = Math.atan2(h.point.y - oy, h.point.x - ox);
    h._complete();
    return h;
  },
});
