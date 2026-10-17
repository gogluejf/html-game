// Attack Engine — Burst Shot (macro, doc §4). ONE object, one id.
//
// A burst IS the same shot fired repeatedly along one direction with a fixed
// interval between shots — the M16-style fire group. The interval is the
// cool-down INSIDE the attack; pacing BETWEEN separate attacks is AI/attack-
// plan sequencing and never lives here.
//
// TARGETING RULE: this macro owns PATTERNS only, never targeting. The caller
// (AI or hero input code) computes the direction — it knows where the target
// is — and passes it. All shots in the group fly the same direction; a burst
// that must track a moving target is AI sequencing (re-invoke with a fresh
// direction), not a macro feature.
//
// Each shot invokes the native PROJECTILE PRIMITIVE directly.
//
// Handle shape:
//   h.handles  — live projectile handles (one per shot)
//   h.step(dt) — host calls each frame; spawns one shot per `interval` and
//                returns true only when all shots are launched AND dead
//   hit / expire / complete — forwarded/emitted once (terminal, no replay)

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  count: 3,              // shots in the burst
  interval: 0.12,        // s between shots (intra-burst cool-down)
  direction: 0,          // radians — caller-computed (AI/input owns targeting)
  speed: 600,            // projectile speed px/s
  ttl: 2,                // projectile lifetime (s)
  damage: 10,            // projectile damage
});

defineMacro('burstShot', {
  attacks: [{ id: 'projectile', role: 'child' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Burst Shot',
    desc: 'N shots along one direction, one per interval (fire group). Pattern-only: the caller computes the direction.',
    // No native effects: inherits hit-sparkle/debris from the projectile
    // primitive it invokes. resolveEffects() surfaces them as inherited rows.
    effects: [],
    params: [
      { key: 'count', desc: 'shots in the burst' },
      { key: 'interval', desc: 's between shots (intra-burst cool-down)' },
      { key: 'direction', desc: 'radians — caller-computed aim, all shots share it' },
      { key: 'speed', desc: 'projectile speed px/s' },
      { key: 'ttl', desc: 'projectile lifetime (s)' },
      { key: 'damage', desc: 'projectile damage' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('burstShot');
    const count = Math.max(1, Math.floor(p.count));
    const interval = Math.max(0, Number.isFinite(p.interval) ? p.interval : 0);

    const spawnOne = () => {
      // Native primitive per shot — the burst owns only the timing pattern.
      const shot = invoke('projectile', {
        direction: p.direction,
        speed: p.speed, ttl: p.ttl, damage: p.damage,
      }, ctx);
      if (shot?.entity) {
        h.handles.push(shot);
        shot.on('hit', (...x) => h._emit('hit', ...x));
      }
    };

    h.handles = [];

    if (interval <= 0) {
      // Degenerate burst: whole group at once (still N distinct shots).
      for (let i = 0; i < count; i++) spawnOne();
      _wireCompletion(h, count);
      return h;
    }

    // Timed burst: one shot per interval; host steps h.step(dt).
    h.state = { spawned: 0, t: 0, done: false };
    h.step = (dt) => {
      const s = h.state;
      if (s.done) return true;
      s.t += dt;
      while (s.spawned < count && s.t >= s.spawned * interval) {
        spawnOne();
        s.spawned++;
      }
      // All launched AND all dead → complete. Completion is owned HERE —
      // a dying shot while later shots are pending must NOT end the burst
      // (theater regression: child-death ≠ macro-done).
      if (s.spawned >= count && h.handles.every((e) => !e.entity.alive)) {
        s.done = true;
        h._complete({ shots: h.handles.length });
        return true;
      }
      return false;
    };
    return h;
  },
});

/**
 * "Complete when every child has ended" bookkeeping for the simultaneous
 * path. Terminal events fire exactly once; already-finished children are
 * counted up front.
 */
function _wireCompletion(h, total) {
  if (h.handles.length === 0) {
    h._complete({ shots: 0 });
    return;
  }
  let remaining = h.handles.length;
  const done = () => {
    remaining -= 1;
    if (remaining <= 0) h._complete({ shots: h.handles.length });
  };
  for (const ch of h.handles) {
    ch.on('complete', done);
    ch.on('expire', done);
  }
  for (const ch of h.handles) {
    if (ch._completed || ch._cancelled) done();
  }
}
