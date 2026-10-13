// Attack Engine — Predictive Targeting primitive (Task 1.12).
//
// Pure aiming math: given a moving target and a bullet speed, compute WHERE
// the bullet and the target will meet if the target keeps its current
// velocity. It creates nothing — the result feeds into the Projectile
// primitive (or any aimed attack).
//
// Synchronous: impl() completes immediately; results live on the handle as
// `handle.point` ({x,y} world aim point), `handle.direction` (radians from
// origin to that point) and `handle.flightTime` (seconds the bullet is in
// flight).

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  target: null,        // entity being predicted (default: ctx.target)
  speed: 600,          // bullet speed px/s (same param name as projectile)
  origin: null,        // {x,y} aim origin; default = attacker center
});

/**
 * Solve the INTERCEPT point: where the target will be if it keeps its current
 * velocity, AND a bullet fired from origin at `speed` arrives at the same
 * instant. "Where will we meet?" — bullet speed determines the answer.
 *
 * Model: target moves linearly (p + v·t), bullet travels at constant speed.
 * We solve |p + v·t − o| = speed · t for t ≥ 0 (quadratic in t), then return
 * the meeting point p + v·t.
 *
 * @param {object} target entity with x,y,w,h,vx,vy
 * @param {{x:number,y:number}} origin aim origin
 * @param {number} speed px/s (must be > 0)
 * @returns {{x:number,y:number,t:number}|null} meeting point + flight time, or
 *          null if no forward solution exists (target moving away faster than
 *          the bullet).
 */
export function interceptPoint(target, origin, speed) {
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const vx = target.vx ?? 0, vy = target.vy ?? 0;
  // Relative position of target w.r.t. origin.
  const px = cx - origin.x, py = cy - origin.y;
  const v2 = vx * vx + vy * vy;
  const s2 = speed * speed;
  if (v2 >= s2) return null; // target outruns the bullet — no catch-up
  // Quadratic from |p + v·t|² = s²·t²:
  //   (v² − s²)·t² + 2(p·v)·t + |p|² = 0
  const a = v2 - s2;                       // negative (see guard above)
  const b = 2 * (px * vx + py * vy);
  const c = px * px + py * py;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;               // bullet too slow to ever meet
  const sq = Math.sqrt(disc);
  // Two roots: nearest future meeting (smaller positive t).
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  let t = Infinity;
  if (t1 > 0) t = Math.min(t, t1);
  if (t2 > 0) t = Math.min(t, t2);
  if (!isFinite(t)) return null;
  return { x: cx + vx * t, y: cy + vy * t, t };
}

registerPrimitive('predictive', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Predictive Targeting',
    desc: 'Aim-point math: solves where a bullet (at `speed`) and a moving target meet if the target keeps its current velocity. Synchronous — reads handle.point / handle.direction / handle.flightTime.',
    params: [
      { key: 'target', desc: 'entity to lead (default ctx.target)' },
      { key: 'speed', desc: 'bullet speed px/s (same meaning as projectile speed)' },
      { key: 'origin', desc: '{x,y} aim origin (default attacker center)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('predictive');
    const t = params.target ?? ctx.target;
    const a = ctx.attacker;
    const ox = params.origin?.x ?? ((a?.x ?? 0) + (a?.w ?? 0) / 2);
    const oy = params.origin?.y ?? ((a?.x ?? 0) + (a?.h ?? 0) / 2);
    if (!t) {
      // No target: aim straight ahead from origin (direction 0).
      h.point = { x: ox + 1, y: oy };
      h.direction = 0;
      h._complete();
      return h;
    }
    const hit = interceptPoint(t, { x: ox, y: oy }, params.speed ?? 600);
    if (hit) {
      h.point = { x: hit.x, y: hit.y };
      h.flightTime = hit.t; // seconds the bullet is in flight
    } else {
      // No solution (target outrunning the bullet): aim at current position.
      h.point = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
      h.flightTime = null;
    }
    h.direction = Math.atan2(h.point.y - oy, h.point.x - ox);
    h._complete();
    return h;
  },
});
