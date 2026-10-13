// Attack Engine — Boomerang primitive (Task 1.16, Wave-2 revision 3).
//
// A projectile that travels outward, turns around at a trigger point, and
// returns to the owner. The return path is DETERMINISTIC (straight back along
// the outbound line), not homing — per the doc: "recognizable rather than
// generic homing unless a macro explicitly combines the two."
//
// Phases (per boomerang):
//   outbound: constant velocity in `direction` for `outboundDuration` (or
//             until `outboundDistance` is covered, whichever comes first)
//   return:   constant velocity back toward the spawn point at `returnSpeed`;
//             completes when it reaches within `returnRadius` of the origin.
//
// Concurrency: `count` = MAXIMUM SIMULTANEOUSLY ALIVE boomerangs (cap).
// This is NOT burst-shot semantics (that belongs to Projectile's
// count/burstInterval). Each call to h.throw() spawns one more boomerang as
// long as fewer than `count` are alive; at the cap, throw() is a no-op.
// The handle stays open while any boomerang is alive and completes when the
// last one comes home. h.states[i] holds each boomerang's state
// ({phase, x, y, vx, vy, t, done}).
//
// This primitive owns the MOTION PROFILE only (like charge). The host renders
// each state and does contact checks; nothing here touches pools or DOM.

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  direction: 0,          // radians (outbound heading)
  speed: 500,            // outbound px/s
  returnSpeed: 700,      // return px/s (faster return reads better)
  outboundDuration: 0.8, // s before turnaround
  outboundDistance: null,// px cap; null = duration wins
  ttl: 4,                // hard cap on total flight per boomerang (s)
  damage: 12,            // carried for the host's contact checks
  count: 3,              // max simultaneously alive boomerangs (cap)
});

/** Build one boomerang's initial state at the attacker center. */
function makeState(params, ox, oy) {
  const cos = Math.cos(params.direction), sin = Math.sin(params.direction);
  return {
    phase: 'outbound',
    t: 0,
    x: ox, y: oy,
    vx: cos * params.speed, vy: sin * params.speed,
    ox, oy,
    done: false,
  };
}

/** Advance one boomerang state by dt seconds (exported for tests/hosts). */
export function stepBoomerangState(s, params, dt) {
  if (s.done) return true;
  s.t += dt;
  if (s.t >= params.ttl) {
    s.done = true;
    return true;
  }
  if (s.phase === 'outbound') {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const traveled = Math.hypot(s.x - s.ox, s.y - s.oy);
    const distHit = params.outboundDistance != null && traveled >= params.outboundDistance;
    if (s.t >= params.outboundDuration || distHit) {
      s.phase = 'return';
      const dx = s.ox - s.x, dy = s.oy - s.y;
      const d = Math.hypot(dx, dy) || 1;
      s.vx = (dx / d) * params.returnSpeed;
      s.vy = (dy / d) * params.returnSpeed;
    }
  } else {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const distHome = Math.hypot(s.x - s.ox, s.y - s.oy);
    if (distHome <= Math.max(8, params.returnRadius ?? 8)) {
      s.done = true;
      return true;
    }
  }
  return false;
}

registerPrimitive('boomerang', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Boomerang',
    desc: 'Outbound → turnaround → deterministic return. count = max alive at once (h.throw() spawns up to the cap). Motion profile only; host renders + contact-checks.',
    params: [
      { key: 'direction', desc: 'radians (outbound)' },
      { key: 'speed', desc: 'outbound px/s' },
      { key: 'returnSpeed', desc: 'return px/s' },
      { key: 'outboundDuration', desc: 's before turnaround' },
      { key: 'outboundDistance', desc: 'px cap (null = duration wins)' },
      { key: 'ttl', desc: 'hard lifetime cap per throw (s)' },
      { key: 'damage', desc: 'carried for host contact checks' },
      { key: 'count', desc: 'max simultaneously alive boomerangs (cap)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('boomerang');
    const a = ctx.attacker;
    const ox = (a?.x ?? 0) + (a?.w ?? 0) / 2;
    const oy = (a?.y ?? 0) + (a?.h ?? 0) / 2;

    const cap = Math.max(1, Math.floor(params.count ?? 1));
    // Live param bag: h.throw() reads CURRENT values (theater re-throws use the
    // adjusted params — a second throw can fly a different direction/duration).
    h.params = { ...params };
    const states = [];
    h.states = states;

    /** Spawn one more boomerang if under the cap. Returns the state or null. */
    h.throw = () => {
      if (h._completed || h._cancelled) return null;
      const alive = states.filter((s) => !s.done).length;
      if (alive >= cap) return null; // at the cap: no-op
      const s = makeState(h.params, ox, oy);
      states.push(s);
      h.state = s; // primary state tracks the newest throw
      return s;
    };

    h.throw(); // first throw immediately (back-compat: invoke = one throw)

    /**
     * Re-arm: trigger another throw while this action is still live.
     * Engine-level contract for additive attacks — hosts (gameplay input,
     * theater replay) call rearm() instead of re-invoking; the primitive
     * owns the cap semantics. Returns { spawned, alive, cap } or null when
     * the action already completed.
     */
    h.rearm = () => {
      if (h._completed || h._cancelled) return null;
      const before = states.filter((s) => !s.done).length;
      const s = h.throw();
      return { spawned: !!s, alive: states.filter((x) => !x.done).length, cap, wasAlive: before };
    };

    h.step = (dt) => {
      let allDone = states.length > 0;
      for (const s of states) if (!stepBoomerangState(s, h.params, dt)) allDone = false;
      if (allDone) h._complete({ returned: states.every((s) => s.phase === 'return'), throws: states.length });
      return allDone;
    };
    return h;
  },
});
