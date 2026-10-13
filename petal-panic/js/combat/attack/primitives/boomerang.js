// Attack Engine — Boomerang primitive (Task 1.16, Wave-2 revision).
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
// Burst support (like Projectile): `count` boomerangs launched by this action,
// spaced by `burstInterval`. count=1/interval=0 → single immediate throw
// (back-compat). Timed bursts expose h.step(dt); the handle completes when
// ALL throws have come home. Each boomerang's state lives in
// handle.states[i] ({phase, x, y, vx, vy, t, done}).
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
  count: 1,              // boomerangs launched by this action
  burstInterval: 0,      // s between throws (0 = all at once)
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
    desc: 'Outbound → turnaround → deterministic return. count/burstInterval for multi-throws. Motion profile only; host renders + contact-checks.',
    params: [
      { key: 'direction', desc: 'radians (outbound)' },
      { key: 'speed', desc: 'outbound px/s' },
      { key: 'returnSpeed', desc: 'return px/s' },
      { key: 'outboundDuration', desc: 's before turnaround' },
      { key: 'outboundDistance', desc: 'px cap (null = duration wins)' },
      { key: 'ttl', desc: 'hard lifetime cap per throw (s)' },
      { key: 'damage', desc: 'carried for host contact checks' },
      { key: 'count', desc: 'boomerangs thrown by this action' },
      { key: 'burstInterval', desc: 's between throws (0 = simultaneous)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('boomerang');
    const a = ctx.attacker;
    const ox = (a?.x ?? 0) + (a?.w ?? 0) / 2;
    const oy = (a?.y ?? 0) + (a?.h ?? 0) / 2;

    const count = Math.max(1, Math.floor(params.count ?? 1));
    const interval = Math.max(0, params.burstInterval ?? 0);

    /** Advance one boomerang by dt seconds. True when finished. */
    const stepOne = (s, dt) => {
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
    };

    if (count === 1 || interval <= 0) {
      // Single throw or simultaneous burst: all states live immediately.
      const states = [];
      for (let i = 0; i < count; i++) states.push(makeState(params, ox, oy));
      h.states = states;
      h.state = states[0]; // back-compat: primary state on handle.state
      if (count === 1) {
        // Single boomerang keeps the classic contract: h.step drives it and
        // completes the handle when it comes home.
        h.step = (dt) => {
          const done = stepOne(h.state, dt);
          if (done) h._complete({ returned: h.state.phase === 'return' });
          return done;
        };
      } else {
        // Simultaneous multi: complete when ALL are home.
        h.step = (dt) => {
          let all = true;
          for (const s of states) if (!stepOne(s, dt)) all = false;
          if (all) h._complete({ returned: true, throws: states.length });
          return all;
        };
      }
      return h;
    }

    // Timed burst: throw one per interval; complete when all are home.
    h.state = makeState(params, ox, oy); // placeholder until first throw lands
    h.states = [h.state];
    h._burst = { thrown: 1, t: 0 };
    h.step = (dt) => {
      const b = h._burst;
      b.t += dt;
      while (b.thrown < count && b.t >= b.thrown * interval) {
        const s = makeState(params, ox, oy);
        h.states.push(s);
        b.thrown++;
      }
      let all = true;
      for (const s of h.states) if (!stepOne(s, dt)) all = false;
      if (b.thrown >= count && all) h._complete({ returned: true, throws: count });
      return b.thrown >= count && all;
    };
    return h;
  },
});
