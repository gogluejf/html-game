// Attack Engine — Spread Shot (macro). ONE object, one id.
//
// A spread shot IS N projectiles fanned across an angle around a center
// direction. This macro owns both the fan math AND the shots: callers invoke
// 'spreadShot' and get back live projectile handles — no caller loops angles
// or spawns bullets by hand.
//
// The angle-generation math (spreadAngles) lives here: it's small, and this is
// the only attack that uses it as a standalone step (spawnSplit inlines its own
// vector generation). 2π angle = radial burst (the "360° Spread" pattern).
//
// `sequenceInterval` upgrades the simultaneous fan to a SEQUENCED one: when
// > 0, shots launch one at a time, each `sequenceInterval` seconds after the
// previous (like a boss sweeping a ring of bolts around itself). null/0 keeps
// the classic all-at-once behavior. The handle then exposes h.step(dt) — the
// host calls it each frame until true (same contract as timed bursts); the
// terminal events still fire exactly once, after the LAST shot has ended.
//
// Handle shape:
//   h.handles  — live projectile handles (one per angle), all sharing params
//   h.angles   — the generated angles (for inspection/debug)
//   h.step     — present ONLY when sequenceInterval > 0
//   complete   — fires once every shot has ended (hit/expire)
//   hit        — forwarded from any child shot

import { registerMacro } from '../registry.js';
import { invoke, AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  count: 3,              // number of shots
  direction: 0,          // center direction (radians)
  angle: Math.PI / 3,    // total spread width (radians); 2π = radial
  speed: 500,            // projectile speed px/s
  ttl: 2,                // projectile lifetime (s)
  damage: 10,            // projectile damage
  sequenceInterval: null, // s between launches; null/0 = all simultaneous
});

/**
 * Generate `count` angles distributed evenly across `angle`, centered on
 * `direction`. Single-shot spreads collapse to [direction]. Exported for tests.
 */
export function spreadAngles(count, direction, angle) {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return [direction];
  const out = new Array(n);
  const half = angle / 2;
  for (let i = 0; i < n; i++) {
    // Even distribution edge-to-edge: i=0 → -half, i=n-1 → +half.
    out[i] = direction - half + (angle * i) / (n - 1);
  }
  return out;
}

registerMacro('spreadShot', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Spread Shot',
    desc: 'N projectiles fanned across an angle. Simultaneous by default; sequenceInterval > 0 launches them one at a time (boss ring sweeps). 2π angle = radial burst.',
    invokes: ['projectile'],
    params: [
      { key: 'count', desc: 'number of shots' },
      { key: 'direction', desc: 'center direction (radians)' },
      { key: 'angle', desc: 'total spread width (radians); 2π = radial' },
      { key: 'speed', desc: 'projectile speed px/s' },
      { key: 'ttl', desc: 'projectile lifetime (s)' },
      { key: 'damage', desc: 'projectile damage' },
      { key: 'sequenceInterval', desc: 's between launches (null/0 = simultaneous)' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('spreadShot');
    const angles = spreadAngles(p.count, p.direction, p.angle);
    h.angles = angles;

    const spawnOne = (a) => {
      const shot = invoke('projectile', {
        direction: a, speed: p.speed, ttl: p.ttl, damage: p.damage,
      }, ctx);
      if (shot?.entity) {
        h.handles.push(shot);
        shot.on('hit', (...x) => h._emit('hit', ...x));
      }
    };

    const interval = Number.isFinite(p.sequenceInterval) ? p.sequenceInterval : 0;

    if (interval <= 0) {
      // --- Simultaneous fan (classic behavior) --------------------------------
      h.handles = [];
      for (const a of angles) spawnOne(a);
      _wireCompletion(h, angles.length);
      return h;
    }

    // --- Sequenced fan: one shot per interval, host steps h.step(dt) ---------
    h.handles = [];
    h.state = { spawned: 0, t: 0, done: false };
    h.step = (dt) => {
      const s = h.state;
      if (s.done) return true;
      s.t += dt;
      while (s.spawned < angles.length && s.t >= s.spawned * interval) {
        spawnOne(angles[s.spawned]);
        s.spawned++;
      }
      // All launched AND all dead → complete. (Pool exhaustion: fewer live
    // handles than angles — the every() on what exists is still correct.)
      if (s.spawned >= angles.length && h.handles.every((e) => !e.entity.alive)) {
        s.done = true;
        h._complete({ count: angles.length });
        return true;
      }
      return false;
    };
    return h;
  },
});

/**
 * Wire the "complete when every child has ended" bookkeeping for the
 * simultaneous path. Terminal events fire exactly once; already-finished
 * children (synchronous primitives in test harnesses) are counted up front.
 */
function _wireCompletion(h, total) {
  if (h.handles.length === 0) {
    h._complete({ count: total });
    return;
  }
  let remaining = h.handles.length;
  const done = () => {
    remaining -= 1;
    if (remaining <= 0) h._complete({ count: total });
  };
  for (const ch of h.handles) {
    ch.on('complete', done);
    ch.on('expire', done);
  }
  for (const ch of h.handles) {
    if (ch._completed || ch._cancelled) done();
  }
}
