// Attack Engine — Predictive Shot (macro). ONE object, one id.
//
// A predictive shot IS aim math + a projectile: solve WHERE the bullet and the
// moving target will meet (if the target keeps its current velocity), then fire
// ONE projectile at that intercept point. Callers invoke 'predictiveShot' and
// get back the live shot handle — no caller solves the quadratic or fires the
// bullet by hand.
//
// The intercept math lives in js/combat/targeting.js (`leadAt`) — the shared
// targeting toolbox AI also uses. No solution (target outrunning the bullet)
// falls back to aiming at the target's CURRENT position — the shot still fires.
//
// Handle shape:
//   h.entity     — the spawned projectile entity
//   h.point      — the intercept aim point {x,y} (world space)
//   h.flightTime — seconds the bullet was in flight (null when no solution)
//   h.step(dt)   — advance the shot; returns true when done
//   hit/expire   — forwarded from the underlying projectile

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { stepProjectile } from '../primitives/projectile.js';
import { targetCenter } from '../context.js';
import { leadAt } from '../../targeting.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read at construction so synchronous fires inside impl()
// see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}
import { getPrimitive, getMacro } from '../registry.js';

const DEFAULTS = Object.freeze({
  target: null,          // entity being predicted (default ctx.target)
  speed: 300,            // bullet speed px/s (the aim is solved from this)
  ttl: 3,                // projectile lifetime (s)
  damage: 10,            // projectile damage
});

/**
 * @deprecated Use `leadAt` from js/combat/targeting.js — same math, single
 * home. Kept as a thin alias so existing imports/tests don't break.
 */
export const interceptPoint = leadAt;

defineMacro('predictiveShot', {
  attacks: [{ id: 'projectile', role: 'payload' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Predictive Shot',
    desc: 'One projectile fired at the intercept point — where a bullet (at speed) and a moving target meet.',
    params: [
      { key: 'speed', desc: 'bullet speed px/s (the aim is solved from this)' },
      { key: 'ttl', desc: 'projectile lifetime (s)' },
      { key: 'damage', desc: 'projectile damage' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('predictiveShot', null, declaredEffectsOf('predictiveShot'));
    const t = p.target ?? ctx.target;
    const o = targetCenter(ctx.attacker) ?? { x: 0, y: 0 };

    // Solve the intercept at firing time. No solution → aim at current pos.
    let pt = null;
    if (t && t.alive !== false) {
      pt = leadAt(t, o, p.speed);
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
