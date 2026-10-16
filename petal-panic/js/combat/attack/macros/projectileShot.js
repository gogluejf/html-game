// Attack Engine — Projectile Shot (macro, doc §1). ONE object, one id.
//
// The canonical "fire one shot" entry point: a single Projectile primitive
// with aim resolution on top. Callers may pass `direction` (radians) OR a
// live `target` entity — the macro computes the angle at fire time so enemy
// AI never does trig or touches pools ("shoot at hero" is one line).
//
// Deliberately thin: no phases, no timing, no second primitive. Its value is
// being the NAMED SEAM — hero weapons (Milestone 4) and every enemy/boss
// (Milestone 5) invoke this id instead of duplicating spawn/aim code.
//
// Handle shape:
//   h.entity / h.handles — the underlying projectile handle's data
//   hit / expire / complete — forwarded from the child shot (terminal events
//   fire exactly once; the macro adds nothing to the lifecycle).

import { registerMacro } from '../registry.js';
import { invoke, AttackHandle } from '../engine.js';
import { dirAngle } from '../../../core/vec.js';

const DEFAULTS = Object.freeze({
  direction: 0,        // radians; ignored when `target` is given
  target: null,        // live entity ({x,y,w,h}) → aimed at its center
  speed: 600,          // projectile speed px/s
  ttl: 2,              // projectile lifetime (s)
  damage: 10,          // projectile damage
  origin: null,        // marker label | {x,y} | null → attacker center
});

/**
 * Resolve the firing direction. A live target wins over `direction`: aim at
 * the target's current center (screen-y-down convention — atan2 handles it).
 * Exported for tests.
 */
export function resolveAim(p, ctx) {
  const t = p.target;
  if (t && typeof t === 'object' && Number.isFinite(t.x)) {
    const a = ctx.attacker;
    const ox = (a?.x ?? 0) + (a?.w ?? 0) / 2;
    const oy = (a?.y ?? 0) + (a?.h ?? 0) / 2;
    return Math.atan2((t.y + t.h / 2) - oy, (t.x + t.w / 2) - ox);
  }
  return typeof p.direction === 'number' ? p.direction : dirAngle(p.direction);
}

registerMacro('projectileShot', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Projectile Shot',
    desc: 'One straight shot; aims at `target` center when given, else uses `direction`. The canonical named seam for hero/enemy basic shots.',
    invokes: ['projectile'],
    effects: [
      { type: 'hit-sparkle', desc: 'blood sparkles on enemy impact (inherited from projectile)' },
    ],
    params: [
      { key: 'direction', desc: 'firing direction (radians); ignored when target is set' },
      { key: 'target', desc: 'live entity to aim at (current position)' },
      { key: 'speed', desc: 'projectile speed px/s' },
      { key: 'ttl', desc: 'projectile lifetime (s)' },
      { key: 'damage', desc: 'projectile damage' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('projectileShot');
    const shot = invoke('projectile', {
      direction: resolveAim(p, ctx),
      speed: p.speed, ttl: p.ttl, damage: p.damage, origin: p.origin,
    }, ctx);
    if (!shot || !shot.entity) {
      // Pool exhausted — report cleanly, same soft-cap contract as the primitive.
      h._emit('expire');
      h._complete({ fired: false });
      return h;
    }
    h.entity = shot.entity;
    h.handles = [shot];
    shot.on('hit', (...x) => h._emit('hit', ...x));
    shot.on('expire', () => h._emit('expire'));
    shot.on('complete', (info) => h._complete(info));
    return h;
  },
});
