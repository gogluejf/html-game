// Task 1.15 — Orbit primitive tests (pure logic, no DOM). Wave-2 revision 2:
// 2D pulsing ring (radius breathes min→max, cosine), even distribution,
// rotation, ejectable flag, rearm.
// Run: node js/test/attack/orbit.test.js

import { strict as assert } from 'node:assert';
import { orbitPositions, orbitRadius } from '../../combat/attack/primitives/orbit.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 }); // center (116,116)
const P = { count: 3, minRadius: 40, maxRadius: 90, pulseSpeed: 1, speed: Math.PI, ttl: null };

ok('positions: N satellites evenly distributed (120° apart for 3)', () => {
  const pts = orbitPositions(P, { x: 0, y: 0 }, 0);
  assert.equal(pts.length, 3);
  const angles = pts.map((p) => p.angle).sort((a, b) => a - b);
  assert.ok(Math.abs(angles[1] - angles[0] - (2 * Math.PI) / 3) < 1e-9, 'spacing 120°');
  assert.ok(Math.abs(angles[2] - angles[1] - (2 * Math.PI) / 3) < 1e-9, 'spacing 120°');
});

ok('pulse: radius at MAXIMUM at t=0 (cosine starts at +1)', () => {
  assert.ok(Math.abs(orbitRadius(P, 0) - 90) < 1e-9, `r=${orbitRadius(P, 0)}`);
});

ok('pulse: radius at MINIMUM at half period', () => {
  // pulseSpeed 1 Hz → half period = 0.5s
  assert.ok(Math.abs(orbitRadius(P, 0.5) - 40) < 1e-9, `r=${orbitRadius(P, 0.5)}`);
});

ok('pulse: full cycle returns to max after one period', () => {
  assert.ok(Math.abs(orbitRadius(P, 1.0) - 90) < 1e-9, `r=${orbitRadius(P, 1.0)}`);
});

ok('pulse: pulseSpeed 0 = static at max radius', () => {
  const p = { ...P, pulseSpeed: 0 };
  assert.ok(Math.abs(orbitRadius(p, 0) - 90) < 1e-9);
  assert.ok(Math.abs(orbitRadius(p, 5) - 90) < 1e-9, 'never moves');
});

ok('rotation: formation advances by speed × t', () => {
  const pts = orbitPositions(P, { x: 0, y: 0 }, 1); // 1s at π rad/s
  assert.ok(Math.abs(pts[0].angle - Math.PI) < 1e-9, `angle=${pts[0].angle}`);
});

ok('step updates positions on the current pulse circle', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('orbit', P, ctx);
  for (let i = 0; i < 30; i++) h.step(DT); // 0.5s → minimum radius
  const r = orbitRadius(P, 0.5);
  for (const e of h.state.entities) {
    const d = Math.hypot(e.x - 116, e.y - 116);
    assert.ok(Math.abs(d - r) < 1e-6, `on circle d=${d.toFixed(2)} r=${r.toFixed(2)}`);
  }
});

ok('ttl ends the orbit', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('orbit', { ...P, ttl: 0.5 }, ctx);
  let done = null;
  h.on('complete', (i) => { done = i; });
  for (let i = 0; i < 30; i++) h.step(DT);
  assert.equal(h.step(DT), true);
  assert.deepEqual(done, { ejected: false });
});

ok('eject: not allowed unless ejectable=true', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('orbit', P, ctx); // ejectable defaults false
  assert.deepEqual(h.eject(), [], 'blocked');
  const h2 = invoke('orbit', { ...P, ejectable: true }, ctx);
  assert.equal(h2.eject().length, 3, 'allowed');
});

ok('eject: tangential launches with ejectTtl', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('orbit', { ...P, ejectable: true, ejectTtl: 1.5 }, ctx);
  for (let i = 0; i < 30; i++) h.step(DT);
  const launches = h.eject(300);
  assert.equal(launches.length, 3);
  for (const l of launches) {
    assert.ok(Math.abs(Math.hypot(l.vx, l.vy) - 300) < 1e-6, 'speed = eject speed');
    assert.equal(l.ttl, 1.5, 'carries ejectTtl');
  }
  assert.equal(h.step(DT), true, 'done after eject');
});

ok('eject twice returns empty the second time', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('orbit', { ...P, ejectable: true }, ctx);
  h.eject();
  assert.deepEqual(h.eject(), []);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
