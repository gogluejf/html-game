// Attack Engine — Predictive Shot (macro). ONE object, one id.
//
// A predictive shot IS aim math + a projectile: solve WHERE the bullet and the
// moving target will meet (if the target keeps its current velocity), then fire
// ONE projectile at that intercept point. Callers invoke 'predictiveShot' and
// get back the live shot handle — no caller solves the quadratic or fires the
// bullet by hand.
//
// The intercept math (interceptPoint) lives here: it's small, and this is the
// only attack that uses it. No solution (target outrunning the bullet) falls
// back to aiming at the target's CURRENT position — the shot still fires.
//
// Handle shape:
//   h.entity     — the spawned projectile entity
//   h.point      — the intercept aim point {x,y} (world space)
//   h.flightTime — seconds the bullet was in flight (null when no solution)
//   h.step(dt)   — advance the shot; returns true when done
//   hit/expire   — forwarded from the underlying projectile

import { registerMacro } from '../registry.js';
import { invoke, AttackHandle } from '../engine.js';
import { stepProjectile } from '../primitives/projectile.js';
import { targetCenter } from '../context.js';

const DEFAULTS = Object.freeze({
  target: null,          // entity being predicted (default ctx.target)
  speed: 600,            // bullet speed px/s (the aim is solved from this)
  ttl: 3,                // projectile lifetime (s)
  damage: 10,            // projectile damage
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

registerMacro('predictiveShot', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Predictive Shot',
    effects: [
      { type: 'hit-sparkle', desc: 'blood sparkles if the shot connects (hit juice)' },
    ],
    desc: 'One projectile fired at the intercept point — where a bullet (at speed) and a moving target meet.',
    invokes: ['projectile'],
    params: [
      { key: 'speed', desc: 'bullet speed px/s (the aim is solved from this)' },
      { key: 'ttl', desc: 'projectile lifetime (s)' },
      { key: 'damage', desc: 'projectile damage' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('predictiveShot');
    const t = p.target ?? ctx.target;
    const o = targetCenter(ctx.attacker) ?? { x: 0, y: 0 };

    // Solve the intercept at firing time. No solution → aim at current pos.
    let pt = null;
    if (t && t.alive !== false) {
      pt = interceptPoint(t, o, p.speed);
      if (!pt) pt = { x: t.x + t.w / 2, y: t.y + t.h / 2, t: null };
    } else {
      pt = { x: o.x + 1, y: o.y, t: null }; // no target: straight ahead
    }
    h.point = { x: pt.x, y: pt.y };
    h.flightTime = pt.t ?? null;
    const dir = Math.atan2(pt.y - o.y, pt.x - o.x);

    // Fire the single shot at the solved point.
    const shot = invoke('projectile', {
      origin: { x: o.x, y: o.y }, direction: dir,
      speed: p.speed, ttl: p.ttl, damage: p.damage,
    }, ctx);
    const ent = shot?.entity;
    if (!ent) {
      h._complete({ tracked: false });
      return h;
    }
    h.entity = ent;
    h.state = { done: false };
    shot.on('hit', (...a) => h._emit('hit', ...a));
    shot.on('expire', () => { h.state.done = true; h._complete({ tracked: true }); });

    h.step = (dt) => {
      if (h.state.done) return true;
      if (stepProjectile(ent, shot)) {
        h.state.done = true;
        return true;
      }
      return false;
    };
    return h;
  },
});
