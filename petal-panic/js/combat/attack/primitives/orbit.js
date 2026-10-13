// Attack Engine — Orbit primitive (Task 1.15, Wave-2 revision 2).
//
// A 2D PULSING RING of N satellites around the owner. The ring breathes
// between `minRadius` and `maxRadius` in a smooth cosine cycle (same pulse
// model as the shield-pulse effect §27): at t=0 the ring is at MAXIMUM
// radius and contracts toward minRadius at half-period, then expands back.
// Satellites are evenly distributed around the circle and rotate together at
// `speed` rad/s. Pure 2D — no ellipse squash, no depth/layering.
//
// Pulse model:
//   r(t) = midR + ampR · cos(2π · pulseSpeed · t)
// where midR = (maxRadius + minRadius) / 2 and ampR = (maxRadius - minRadius) / 2.
//
// Eject: when a host triggers `h.eject()`, every satellite leaves the ring
// along its current tangential direction as a linear projectile vector.
// Ejected entities carry their own lifetime (`ejectTtl`) so the host can
// spawn pool projectiles with that ttl.
//
// Re-arm: h.rearm() spawns ANOTHER independent ring while this action is
// live (additive attack); the handle completes when ALL rings are done.
//
// Usage pattern (host loop):
//   const h = attackEngine.invoke('orbit', { count: 3, minRadius: 40, maxRadius: 90, ... }, ctx);
//   each frame: h.step(dt) → true when finished.
//   render: for each e of h.state.entities — draw at (e.x, e.y), optionally
//           scaled by e.radius vs maxRadius (near = larger reads well).
//   to release: h.eject() → [{x, y, vx, vy, angle, ttl}] per entity.

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  count: 3,            // number of orbiting entities (evenly distributed)
  minRadius: 40,       // inner bound of the pulse (px)
  maxRadius: 90,       // outer bound of the pulse (px)
  pulseSpeed: 1.5,     // pulse frequency in Hz (cycles per second; 0 = static at max)
  speed: 1.5,          // rotation speed (rad/s)
  ttl: null,           // orbit lifetime (s); null = until cancel/eject
  damage: 10,          // contact damage if the host checks overlaps
  ejectable: false,    // whether eject() is allowed for this orbit
  ejectTtl: 2,         // lifetime (s) of ejected projectiles
});

/** Ring radius at time t (cosine pulse, max at t=0). */
export function orbitRadius(p, t) {
  const maxR = p.maxRadius ?? 90;
  const minR = Math.min(Math.max(0, p.minRadius ?? 40), maxR);
  const midR = (maxR + minR) / 2;
  const ampR = (maxR - minR) / 2;
  const freq = Math.max(0, p.pulseSpeed ?? 1.5);
  return midR + ampR * Math.cos(2 * Math.PI * freq * t);
}

/**
 * Compute entity positions for the given elapsed time.
 * @returns {Array<{x:number,y:number,angle:number,radius:number}>}
 */
export function orbitPositions(p, ownerCenter, t) {
  const n = Math.max(1, Math.floor(p.count));
  const r = orbitRadius(p, t);
  const base = (p.speed ?? 1.5) * t;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = base + (2 * Math.PI * i) / n;
    out[i] = {
      x: ownerCenter.x + Math.cos(a) * r,
      y: ownerCenter.y + Math.sin(a) * r,
      angle: a,
      radius: r,
    };
  }
  return out;
}

registerPrimitive('orbit', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Orbit',
    desc: 'N satellites on a 2D pulsing ring around the owner (radius breathes min→max, cosine). eject() releases them as tangential projectiles.',
    params: [
      { key: 'count', desc: 'satellites (evenly distributed)' },
      { key: 'minRadius', desc: 'pulse inner bound (px)' },
      { key: 'maxRadius', desc: 'pulse outer bound (px)' },
      { key: 'pulseSpeed', desc: 'pulse frequency Hz (0 = static at max)' },
      { key: 'speed', desc: 'rotation speed (rad/s)' },
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
     * Release all satellites as linear projectiles along their tangent at
     * the current angle (circle tangent: perpendicular to the radius).
     * Ends the ring. Returns launch vectors (or [] if not ejectable).
     */
    h.eject = (speed = 400) => {
      // Eject the NEWEST live ring (the one the user is looking at).
      const rings = h._rings ?? [h.state];
      const s = [...rings].reverse().find((r) => !r.done && !r.ejected);
      if (!s || !params.ejectable) return [];
      s.ejected = true;
      s.done = true;
      const launches = s.entities.map((e) => {
        // Circle tangent at angle a: (-sin a, cos a) — counter-clockwise.
        const tx = -Math.sin(e.angle);
        const ty = Math.cos(e.angle);
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
