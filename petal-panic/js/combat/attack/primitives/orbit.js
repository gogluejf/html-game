// Attack Engine — Orbit primitive (Task 1.15, Wave-2 revision).
//
// Keeps N attack entities orbiting the owner on an ELLIPSE (3D-ish depth):
// each satellite passes IN FRONT of, then BEHIND, the nucleus axis as it
// rotates. Depth is derived from the orbit angle: `depth = sin(angle)` where
// +1 = fully in front, -1 = fully behind. The host renders satellites with
// scale/alpha/layering from `e.depth` (in-front drawn after the owner sprite,
// behind drawn before it) — no hideBehindOwner flag needed; depth IS the data.
//
// Satellites are evenly distributed around the ellipse (count 3 → 120° apart)
// and all share one startAngle offset + direction. There is no per-entity
// start-angle param: distribution is always even by design.
//
// Eject: when a host triggers `h.eject()`, every entity leaves the orbit
// along its current tangential direction as a linear projectile vector.
// Ejected entities carry their own lifetime (`ejectTtl`) so the host can
// spawn pool projectiles with that ttl.
//
// Usage pattern (host loop):
//   const h = attackEngine.invoke('orbit', { count: 3, radius: 70, ... }, ctx);
//   each frame: h.step(dt) → true when finished.
//   render: for each e of h.state.entities — draw BEHIND owner if e.depth < 0,
//           in FRONT if e.depth > 0, scaled by (1 + 0.25 * e.depth).
//   to release: h.eject() → [{x, y, vx, vy, angle, ttl}] per entity.

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  count: 3,            // number of orbiting entities (evenly distributed)
  radius: 60,          // horizontal semi-axis of the ellipse (px)
  depth: 0.45,         // vertical squash: 0 = flat line, 1 = full circle
  angularSpeed: 1.5,   // rad/s
  direction: 1,        // 1 = clockwise (screen coords), -1 = counter
  startAngle: 0,       // phase offset of the whole formation (rad)
  ttl: null,           // orbit lifetime (s); null = until cancel/eject
  damage: 10,          // contact damage if the host checks overlaps
  ejectable: false,    // whether eject() is allowed for this orbit
  ejectTtl: 2,         // lifetime (s) of ejected projectiles
});

/**
 * Compute entity positions/depth for the given elapsed time.
 * Ellipse: x = cos(a) * radius, y = sin(a) * radius * depthFactor.
 * Depth convention: sin(a) > 0 → in front (lower on screen, larger),
 *                   sin(a) < 0 → behind  (upper on screen, smaller).
 * @returns {Array<{x:number,y:number,angle:number,depth:number}>}
 */
export function orbitPositions(p, ownerCenter, t) {
  const n = Math.max(1, Math.floor(p.count));
  const squash = p.depth ?? 0.45;
  const out = new Array(n);
  const base = (p.startAngle ?? 0) + p.direction * (p.angularSpeed ?? 1.5) * t;
  for (let i = 0; i < n; i++) {
    const a = base + (2 * Math.PI * i) / n;
    const rx = p.radius ?? 60;
    const ry = rx * squash;
    const x = ownerCenter.x + Math.cos(a) * rx;
    const y = ownerCenter.y + Math.sin(a) * ry;
    out[i] = { x, y, angle: a, depth: Math.sin(a) };
  }
  return out;
}

registerPrimitive('orbit', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Orbit',
    desc: 'N satellites on an elliptical orbit around the owner (passing in front / behind via e.depth). eject() releases them as tangential projectiles.',
    params: [
      { key: 'count', desc: 'satellites (evenly distributed)' },
      { key: 'radius', desc: 'horizontal semi-axis (px)' },
      { key: 'depth', desc: 'vertical squash 0..1 (1 = circle)' },
      { key: 'angularSpeed', desc: 'rad/s' },
      { key: 'direction', desc: '1 = CW, -1 = CCW' },
      { key: 'startAngle', desc: 'formation phase offset (rad)' },
      { key: 'ttl', desc: 'lifetime (s), null = ∞' },
      { key: 'damage', desc: 'contact damage (host applies)' },
      { key: 'ejectable', desc: 'allow eject()' },
      { key: 'ejectTtl', desc: 'ejected projectile lifetime (s)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('orbit');
    const a = ctx.attacker;
    const center = () => ({
      x: (a?.x ?? 0) + (a?.w ?? 0) / 2,
      y: (a?.y ?? 0) + (a?.h ?? 0) / 2,
    });
    h.state = { t: 0, done: false, ejected: false, entities: [] };
    h.state.entities = orbitPositions(params, center(), 0);

    /**
     * Re-arm: spawn ANOTHER ring while this action is live (additive attack).
     * Engine-level contract — hosts call rearm() instead of re-invoking.
     * The new ring steps independently; the handle completes when ALL rings
     * are done. Returns { spawned, rings } or null when already completed.
     */
    h.rearm = () => {
      if (h._completed || h._cancelled) return null;
      const rings = h._rings ?? (h._rings = [h.state]);
      const ns = { t: 0, done: false, ejected: false, entities: [] };
      ns.entities = orbitPositions(params, center(), 0);
      rings.push(ns);
      h.state = ns; // primary state tracks the newest ring
      return { spawned: true, rings: rings.length };
    };

    /** Per-frame step. Returns true when ALL rings ended. */
    h.step = (dt) => {
      const rings = h._rings ?? [h.state];
      let allDone = true;
      for (const s of rings) {
        if (s.done) continue;
        s.t += dt;
        if (params.ttl != null && s.t >= params.ttl) {
          s.done = true;
        } else {
          s.entities = orbitPositions(params, center(), s.t);
          allDone = false;
        }
      }
      if (allDone) h._complete({ ejected: rings.every((s) => s.ejected) });
      return allDone;
    };

    /**
     * Release all entities as linear projectiles along their tangent at the
     * current angle. Tangent of the ellipse at angle a:
     *   (-sin(a) * rx, cos(a) * ry) normalized × speed × orbit direction.
     * Ends the handle. Returns launch vectors (or [] if not ejectable).
     */
    h.eject = (speed = 400) => {
      // Eject the NEWEST live ring (the one the user is looking at).
      const rings = h._rings ?? [h.state];
      const s = [...rings].reverse().find((r) => !r.done && !r.ejected);
      if (!s || !params.ejectable) return [];
      s.ejected = true;
      s.done = true;
      const rx = params.radius ?? 60;
      const ry = rx * (params.depth ?? 0.45);
      const launches = s.entities.map((e) => {
        // Ellipse tangent, oriented with the rotation direction.
        let tx = -Math.sin(e.angle) * rx * params.direction;
        let ty = Math.cos(e.angle) * ry * params.direction;
        const len = Math.hypot(tx, ty) || 1;
        tx /= len; ty /= len;
        return {
          x: e.x, y: e.y,
          vx: tx * speed,
          vy: ty * speed,
          angle: Math.atan2(ty, tx),
          ttl: params.ejectTtl ?? 2,
        };
      });
      h._complete({ ejected: true, launches });
      return launches;
    };

    return h;
  },
});
