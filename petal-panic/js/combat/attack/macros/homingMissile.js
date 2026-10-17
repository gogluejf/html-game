// Attack Engine — Homing Missile (macro). ONE object, one id.
//
// A homing missile IS a projectile + per-frame steering toward a target. This
// macro owns both: it spawns the bullet AND steers it each frame. Callers just
// invoke 'homingMissile' and step the returned handle — no bind(), no separate
// projectile, no scattered composition.
//
// The steering math (steerVelocity) lives here, not in a standalone primitive:
// a "math-only homing" has no use outside this attack, so it's inlined (same
// call as consolidating spawnSplit). Steering strength = turnRate: low makes
// wide dodgeable arcs, high makes agile missiles. Perfect tracking is NOT
// implied.
//
// Handle shape:
//   h.entity  — the spawned projectile entity (for rendering / contact checks)
//   h.step(dt)— advance flight + steering; returns true when done
//   complete  — fires when ttl elapses or the target dies
//   hit/expire— forwarded from the underlying projectile

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { stepProjectile } from '../primitives/projectile.js';

const DEFAULTS = Object.freeze({
  direction: 0,          // initial launch direction (radians)
  speed: 400,            // bullet speed px/s
  ttl: 2,                // seconds before steering gives up
  damage: 10,            // projectile damage
  target: null,          // entity to chase (default ctx.target)
  turnRate: 3,           // rad/s max heading correction
});

/** Rotate a velocity vector toward desiredAngle by at most maxTurn. */
export function steerVelocity(vx, vy, desiredAngle, maxTurn) {
  const speed = Math.hypot(vx, vy);
  if (speed < 1e-9) return { vx: Math.cos(desiredAngle) * 10, vy: Math.sin(desiredAngle) * 10 };
  const cur = Math.atan2(vy, vx);
  let diff = desiredAngle - cur;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  const clamped = Math.max(-maxTurn, Math.min(maxTurn, diff));
  const next = cur + clamped;
  return { vx: Math.cos(next) * speed, vy: Math.sin(next) * speed };
}

defineMacro('homingMissile', {
  attacks: [{ id: 'projectile', role: 'carrier' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Homing Missile',
    desc: 'A projectile that steers toward a target each frame. Spawns + steers in one handle.',
    params: [
      { key: 'direction', desc: 'initial launch direction (radians)' },
      { key: 'speed', desc: 'bullet speed px/s' },
      { key: 'ttl', desc: 'seconds before giving up' },
      { key: 'damage', desc: 'projectile damage' },
      { key: 'turnRate', desc: 'rad/s max heading correction' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const tgt = () => p.target ?? ctx.target;

    // 1. Spawn the bullet (the projectile primitive owns flight + collision).
    const shot = invoke('projectile', {
      direction: p.direction, speed: p.speed, ttl: p.ttl, damage: p.damage,
    }, ctx);
    const ent = shot?.entity;
    if (!ent) {
      // No pool slot: return a completed no-op handle (caller guards on entity).
      const dead = new AttackHandle('homingMissile');
      dead._complete({ tracked: false });
      return dead;
    }

    // 2. Wrap it: our handle steps BOTH the projectile flight and the steering.
    const h = new AttackHandle('homingMissile');
    h.entity = ent;
    h.state = { t: 0, done: false };
    // Forward the projectile's terminal events so hosts see hit/expire once.
    shot.on('hit', (...a) => h._emit('hit', ...a));
    shot.on('expire', () => { h.state.done = true; h._complete({ tracked: true }); });

    h.step = (dt) => {
      const s = h.state;
      if (s.done) return true;
      // Projectile death check (hit/expire) — same as the theater does for a
      // plain projectile. stepProjectile emits the terminal event + completes
      // the inner shot handle, which we forwarded above.
      if (stepProjectile(ent, shot)) {
        s.done = true;
        return true;
      }
      s.t += dt;
      const t = tgt();
      if (!t || t.alive === false || s.t >= p.ttl) {
        s.done = true;
        h._complete({ tracked: true });
        return true;
      }
      // Steer the bullet's velocity toward the target center.
      const tx = t.x + t.w / 2, ty = t.y + t.h / 2;
      const ex = ent.x + ent.w / 2, ey = ent.y + ent.h / 2;
      const desired = Math.atan2(ty - ey, tx - ex);
      const v = steerVelocity(ent.vx, ent.vy, desired, p.turnRate * dt);
      ent.vx = v.vx;
      ent.vy = v.vy;
      return false;
    };

    return h;
  },
});
