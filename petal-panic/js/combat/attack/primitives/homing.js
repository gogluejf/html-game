// Attack Engine — Homing / Steering primitive (Task 1.11).
//
// A MODIFIER on an existing projectile entity: each frame it rotates the
// entity's velocity toward a target by at most `turnRate` radians, while
// keeping speed constant. It does NOT spawn anything — the Projectile
// primitive creates the entity, then this primitive steers it.
//
// Usage pattern (host loop):
//   const shot = attackEngine.invoke('projectile', { ... }, ctx);
//   const homing = attackEngine.invoke('homing', { target, turnRate, ttl }, ctx);
//   homing.bind(shot.entity);
//   each frame: homing.step(dt) until it returns true.
//
// Steering strength determines how recoverable the trajectory is — low
// turnRate makes wide, dodgeable arcs; high turnRate makes agile missiles.
// Perfect tracking is intentionally NOT implied.

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  target: null,        // entity to chase (default: ctx.target)
  turnRate: 3,         // rad/s max heading correction
  speed: null,         // optional constant speed override (null = keep current)
  initialDirection: null, // rad; set immediately on bind if given
  ttl: 2,              // seconds before steering gives up
});

/**
 * Rotate a velocity vector toward the desired direction by at most maxTurn.
 * @returns {{vx:number,vy:number}} new velocity
 */
export function steerVelocity(vx, vy, desiredAngle, maxTurn) {
  const speed = Math.hypot(vx, vy);
  if (speed < 1e-9) return { vx: Math.cos(desiredAngle) * 10, vy: Math.sin(desiredAngle) * 10 };
  const cur = Math.atan2(vy, vx);
  let diff = desiredAngle - cur;
  // Normalize to (-π, π].
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  const clamped = Math.max(-maxTurn, Math.min(maxTurn, diff));
  const next = cur + clamped;
  return { vx: Math.cos(next) * speed, vy: Math.sin(next) * speed };
}

registerPrimitive('homing', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Homing / Steering',
    desc: 'Per-frame steering modifier on a spawned projectile. Binds via handle.bind(entity); step(dt) until complete.',
    params: [
      { key: 'target', desc: 'entity to chase (default ctx.target)' },
      { key: 'turnRate', desc: 'rad/s max heading correction' },
      { key: 'speed', desc: 'constant speed override (null = keep current)' },
      { key: 'initialDirection', desc: 'rad; applied on bind' },
      { key: 'ttl', desc: 'seconds before giving up' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('homing');
    h.state = { t: 0, done: false, ent: null };
    h.params = params;
    h.ctx = ctx;

    /** Attach to a spawned projectile entity. */
    h.bind = (ent) => {
      h.state.ent = ent;
      if (params.initialDirection != null && ent) {
        const sp = params.speed ?? Math.hypot(ent.vx, ent.vy);
        ent.vx = Math.cos(params.initialDirection) * sp;
        ent.vy = Math.sin(params.initialDirection) * sp;
      }
      return h;
    };

    /** Per-frame step. Returns true when steering ended (ttl or no target/ent). */
    h.step = (dt) => {
      const s = h.state;
      if (s.done) return true;
      s.t += dt;
      const ent = s.ent;
      const tgt = params.target ?? ctx.target;
      if (!ent || !tgt || tgt.alive === false || s.t >= params.ttl) {
        s.done = true;
        h._complete({ tracked: !!ent });
        return true;
      }
      const tx = tgt.x + tgt.w / 2, ty = tgt.y + tgt.h / 2;
      const ex = ent.x + ent.w / 2, ey = ent.y + ent.h / 2;
      const desired = Math.atan2(ty - ey, tx - ex);
      const maxTurn = params.turnRate * dt;
      const v = steerVelocity(ent.vx, ent.vy, desired, maxTurn);
      if (params.speed != null) {
        v.vx = (v.vx / Math.hypot(v.vx, v.vy)) * params.speed;
        v.vy = (v.vy / Math.hypot(v.vx, v.vy)) * params.speed;
      }
      ent.vx = v.vx;
      ent.vy = v.vy;
      return false;
    };

    return h;
  },
});
