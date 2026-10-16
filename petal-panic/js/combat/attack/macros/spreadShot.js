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
// Handle shape:
//   h.handles  — live projectile handles (one per angle), all sharing params
//   h.angles   — the generated angles (for inspection/debug)
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
    effects: [
      { type: 'hit-sparkle', desc: 'blood sparkles per connecting shot (hit juice)' },
    ],
    desc: 'N projectiles fired simultaneously across an angle. 2π angle = radial burst.',
    invokes: ['projectile'],
    params: [
      { key: 'count', desc: 'number of shots' },
      { key: 'direction', desc: 'center direction (radians)' },
      { key: 'angle', desc: 'total spread width (radians); 2π = radial' },
      { key: 'speed', desc: 'projectile speed px/s' },
      { key: 'ttl', desc: 'projectile lifetime (s)' },
      { key: 'damage', desc: 'projectile damage' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('spreadShot');
    const angles = spreadAngles(p.count, p.direction, p.angle);
    h.angles = angles;

    const handles = [];
    for (const a of angles) {
      const shot = invoke('projectile', {
        direction: a, speed: p.speed, ttl: p.ttl, damage: p.damage,
      }, ctx);
      if (shot?.entity) {
        handles.push(shot);
        shot.on('hit', (...x) => h._emit('hit', ...x));
      }
    }
    h.handles = handles;

    if (handles.length === 0) {
      h._complete({ count: angles.length });
    } else {
      let remaining = handles.length;
      const done = () => {
        remaining -= 1;
        if (remaining <= 0) h._complete({ count: angles.length });
      };
      for (const ch of handles) {
        ch.on('complete', done);
        ch.on('expire', done);
      }
      for (const ch of handles) {
        if (ch._completed || ch._cancelled) done();
      }
    }
    return h;
  },
});
