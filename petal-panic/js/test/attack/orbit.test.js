// Task 1.15 — Orbit primitive tests (pure logic, no DOM). Wave-2 revision:
// elliptical orbit with depth (front/behind), even distribution, ejectable flag.
// Run: node js/test/attack/orbit.test.js

import { strict as assert } from 'node:assert';
import { orbitPositions } from '../../combat/attack/primitives/orbit.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 }); // center (116,116)
const P = { count: 3, radius: 80, depth: 0.45, angularSpeed: Math.PI, direction: 1, startAngle: 0, ttl: null };

ok('positions: N satellites evenly distributed (120° apart for 3)', () => {
  const pts = orbitPositions(P, { x: 0, y: 0 }, 0);
  assert.equal(pts.length, 3);
  const angles = pts.map((p) => p.angle).sort((a, b) => a - b);
  assert.ok(Math.abs(angles[1] - angles[0] - (2 * Math.PI) / 3) < 1e-9, 'spacing 120°');
  assert.ok(Math.abs(angles[2] - angles[1] - (2 * Math.PI) / 3) < 1e-9, 'spacing 120°');
});

ok('ellipse: x on full radius, y squashed by depth factor', () => {
  // Use a single satellite at known angles (full P defaults + overrides).
  const one = orbitPositions({ ...P, count: 1 }, { x: 0, y: 0 }, 0);
  assert.ok(Math.abs(one[0].x - 80) < 1e-9, `x=${one[0].x}`);
  assert.ok(Math.abs(one[0].y) < 1e-9, `y=${one[0].y}`);
  const top = orbitPositions({ ...P, count: 1, startAngle: Math.PI / 2 }, { x: 0, y: 0 }, 0);
  assert.ok(Math.abs(top[0].x) < 1e-9, `x=${top[0].x}`);
  assert.ok(Math.abs(top[0].y - 80 * 0.45) < 1e-9, `y=${top[0].y}`);
});

ok('depth: sin(angle) — front (+) when below axis, behind (−) above', () => {
  // One satellite stepped through the cycle must hit both extremes.
  const p = { ...P, count: 1, angularSpeed: Math.PI / 2 };
  let front = null, back = null;
  for (let i = 0; i < 8; i++) {
    const e = orbitPositions(p, { x: 0, y: 0 }, i * 0.5)[0]; // every quarter turn
    if (e.depth > 0.9) front = e;
    if (e.depth < -0.9) back = e;
  }
  assert.ok(front, 'reaches in-front');
  assert.ok(back, 'reaches behind');
  assert.ok(front.y > 0, 'front = below axis');
  assert.ok(back.y < 0, 'behind = above axis');
});

ok('rotation: formation advances by angularSpeed × t', () => {
  const pts = orbitPositions(P, { x: 0, y: 0 }, 1); // 1s at π rad/s
  assert.ok(Math.abs(pts[0].angle - Math.PI) < 1e-9, `angle=${pts[0].angle}`);
});

ok('direction -1 rotates counter-clockwise', () => {
  const pts = orbitPositions({ ...P, direction: -1 }, { x: 0, y: 0 }, 1);
  assert.ok(Math.abs(pts[0].angle + Math.PI) < 1e-9, `angle=${pts[0].angle}`);
});

ok('step updates positions and keeps the ellipse shape', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('orbit', P, ctx);
  for (let i = 0; i < 60; i++) h.step(DT); // 1s
  for (const e of h.state.entities) {
    const dx = (e.x - 116) / 80, dy = (e.y - 116) / (80 * 0.45);
    assert.ok(Math.abs(Math.hypot(dx, dy) - 1) < 1e-6, `on ellipse (${dx.toFixed(2)},${dy.toFixed(2)})`);
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
