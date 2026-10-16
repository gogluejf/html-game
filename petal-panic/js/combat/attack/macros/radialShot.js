// Attack Engine — Radial Shot (macro, doc §6). ONE object, one id.
//
// A radial shot IS a spread shot with the angle computed for an even full
// ring: N projectiles distributed 360° around the attacker. This macro is a
// THIN WRAPPER over 'spreadShot' — it only computes the distribution angle
// and forwards params; all fan/sequencing logic lives in the spread macro.
//
// Why compute instead of hardcoding 2π? With `count` shots evenly spaced
// edge-to-edge across a total width W, the gap between neighbors is
// W / (count - 1). For a seamless ring that gap must be exactly 2π/count,
// so W = 2π * (count - 1) / count. (count = 1 collapses to a single shot.)
//
// Callers pass ONLY `count` (plus startAngle + projectile tuning) — never
// `angle`: the ring owns its own geometry. `sequenceInterval` passes straight
// through, so a boss can sweep the ring bolt-by-bolt instead of firing it
// all at once.
//
// Handle shape: identical to spreadShot's (h.handles, h.angles, optional
// h.step when sequenced; hit/complete forwarded).

import { registerMacro } from '../registry.js';
import { invoke, AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  count: 24,             // projectiles around the circle
  startAngle: 0,         // rotation of the pattern (radians)
  speed: 400,            // projectile speed px/s
  ttl: 2.5,              // projectile lifetime (s)
  damage: 10,            // projectile damage
  sequenceInterval: 0.15, // s between launches; null/0 = all simultaneous
});

/**
 * Total spread width for an even full ring of `count` shots (see header math).
 * Exported for tests.
 */
export function radialAngle(count) {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return 0;
  return (Math.PI * 2 * (n - 1)) / n;
}

registerMacro('radialShot', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Radial Shot (360° Spread)',
    desc: 'N projectiles evenly distributed in a full ring around the attacker. Wraps spreadShot with computed ring geometry; sequenceInterval sweeps the ring one bolt at a time.',
    invokes: ['spreadShot'],
    // No native effects: inherits hit-sparkle/debris via spreadShot →
    // projectile. resolveEffects() surfaces them as inherited rows.
    effects: [],
    params: [
      { key: 'count', desc: 'projectiles around the circle' },
      { key: 'startAngle', desc: 'rotation of the pattern (radians)' },
      { key: 'speed', desc: 'projectile speed px/s' },
      { key: 'ttl', desc: 'projectile lifetime (s)' },
      { key: 'damage', desc: 'projectile damage' },
      { key: 'sequenceInterval', desc: 's between launches (null/0 = simultaneous)' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('radialShot');
    const inner = invoke('spreadShot', {
      count: p.count,
      direction: p.startAngle,
      angle: radialAngle(p.count),
      speed: p.speed, ttl: p.ttl, damage: p.damage,
      sequenceInterval: p.sequenceInterval,
    }, ctx);
    // Mirror the inner handle's data + lifecycle onto this wrapper handle so
    // hosts treat both uniformly (theater steps h.step when present).
    // `handles` is a LIVE view of the inner array: the sequenced path pushes
    // children over time, and the theater iterates h.handles each frame.
    h.handles = inner.handles;
    Object.defineProperty(h, 'angles', {
      get: () => inner.angles,
      enumerable: true,
    });
    if (typeof inner.step === 'function') h.step = inner.step;
    inner.on('hit', (...x) => h._emit('hit', ...x));
    inner.on('expire', () => h._emit('expire'));
    inner.on('complete', (info) => h._complete(info));
    return h;
  },
});
