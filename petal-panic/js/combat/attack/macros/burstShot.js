// Attack Engine — Burst Shot (macro, doc §4). ONE object, one id.
//
// A burst IS the same shot fired repeatedly along one direction with a fixed
// interval between shots — the M16-style fire group. The interval is the
// cool-down INSIDE the attack; pacing BETWEEN separate attacks is AI/attack-
// plan sequencing and never lives here.
//
// Each shot consumes the projectileShot MACRO (not the raw primitive): the
// burst inherits its AIM CONTRACT for free:
//   • `target` → PRIMARY. Every shot re-solves the angle at ITS OWN fire
//     time, so a target burst visibly TRACKS a moving target shot-by-shot
//     instead of firing N bullets at where it used to be.
//   • `direction` → FALLBACK ONLY when target is null (hero aim / patterns);
//     all shots in the group fly the same angle.
//   • Both given → target wins per shot, direction ignored.
//
// Handle shape:
//   h.handles  — live projectileShot handles (one per shot)
//   h.step(dt) — host calls each frame; spawns one shot per `interval` and
//                returns true only when all shots are launched AND dead
//   hit / expire / complete — forwarded/emitted once (terminal, no replay)

import { registerMacro } from '../registry.js';
import { invoke, AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  count: 3,              // shots in the burst
  interval: 0.12,        // s between shots (intra-burst cool-down)
  direction: 0,          // radians; ignored when `target` is given
  target: null,          // live entity — re-aimed at each shot's fire time
  speed: 600,            // projectile speed px/s
  ttl: 2,                // projectile lifetime (s)
  damage: 10,            // projectile damage
});

registerMacro('burstShot', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Burst Shot',
    desc: 'N shots along one direction, one per interval (fire group). Consumes projectileShot per shot, so a target burst tracks the target shot-by-shot.',
    invokes: ['projectileShot'],
    // No native effects: inherits hit-sparkle/debris via projectileShot →
    // projectile. resolveEffects() surfaces them as inherited rows.
    effects: [],
    params: [
      { key: 'count', desc: 'shots in the burst' },
      { key: 'interval', desc: 's between shots (intra-burst cool-down)' },
      { key: 'target', desc: 'PRIMARY aim: live entity, re-aimed at each shot\'s fire time (tracks movement)' },
      { key: 'direction', desc: 'FALLBACK aim (only when target is null): radians, all shots share it' },
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
      // Fresh invoke per shot: projectileShot re-resolves aim NOW, so a
      // moving target gets tracked shot-by-shot.
      const shot = invoke('projectileShot', {
        direction: p.direction, target: p.target,
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
