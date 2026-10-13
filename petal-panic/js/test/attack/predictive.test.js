// Task 1.12 — Predictive Targeting primitive tests (pure logic, no DOM).
// Run: node js/test/attack/predictive.test.js

import { strict as assert } from 'node:assert';
import { interceptPoint } from '../../combat/attack/primitives/predictive.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 }); // center (116,116)

ok('interceptPoint: bullet travel distance equals speed × flight time', () => {
  // Target at center (420,220) walking right at 100 px/s; shooter at (116,116).
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 100, vy: 0 };
  const o = { x: 116, y: 116 };
  const r = interceptPoint(t, o, 500);
  assert.ok(r, 'solution exists');
  const d = Math.hypot(r.x - o.x, r.y - o.y);
  assert.ok(Math.abs(d - 500 * r.t) < 1e-6, `dist=${d} vs s·t=${500 * r.t}`);
});

ok('interceptPoint: aim point equals target position at flight time', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: -160, vy: 0 };
  const o = { x: 116, y: 116 };
  const r = interceptPoint(t, o, 300);
  assert.ok(r, 'solution exists');
  const txAtT = 420 + (-160) * r.t;
  assert.ok(Math.abs(txAtT - r.x) < 1e-9, `target@t=${txAtT} vs aim=${r.x}`);
  assert.ok(Math.abs(220 - r.y) < 1e-9, 'y matches (no vertical motion)');
});

ok('interceptPoint: faster bullet → shorter flight, less lead', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 200, vy: 0 };
  const o = { x: 116, y: 116 };
  const slow = interceptPoint(t, o, 300);
  const fast = interceptPoint(t, o, 800);
  assert.ok(fast.t < slow.t, `fast ${fast.t} < slow ${slow.t}`);
  assert.ok(fast.x < slow.x, 'faster bullet aims closer to current position');
});

ok('interceptPoint: static target → its center, t = distance/speed', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 0, vy: 0 };
  const o = { x: 116, y: 116 };
  const r = interceptPoint(t, o, 400);
  assert.ok(Math.abs(r.x - 420) < 1e-9 && Math.abs(r.y - 220) < 1e-9, 'aims at center');
  const expect = Math.hypot(420 - 116, 220 - 116) / 400;
  assert.ok(Math.abs(r.t - expect) < 1e-9, `t=${r.t} vs ${expect}`);
});

ok('interceptPoint: diagonal target velocity solved in 2D', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 100, vy: -80 };
  const o = { x: 116, y: 116 };
  const r = interceptPoint(t, o, 500);
  assert.ok(r, 'solution exists');
  // Both axes must agree with the target's linear motion at time t.
  assert.ok(Math.abs((420 + 100 * r.t) - r.x) < 1e-9, 'x meets');
  assert.ok(Math.abs((220 - 80 * r.t) - r.y) < 1e-9, 'y meets');
});

ok('interceptPoint: target outrunning bullet → null', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 500, vy: 0 }; // faster than bullet
  const o = { x: 116, y: 116 };
  assert.equal(interceptPoint(t, o, 300), null);
});

ok('invoke predictive: end-to-end with speed param', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: -160, vy: 0 };
  const ctx = makeContext(attacker(), { target: t });
  const h = invoke('predictive', { speed: 300 }, ctx);
  assert.ok(h.flightTime > 0, 'flightTime reported');
  // Bullet from attacker center (116,116) must cover |point−origin| in flightTime.
  const d = Math.hypot(h.point.x - 116, h.point.y - 116);
  assert.ok(Math.abs(d - 300 * h.flightTime) < 1e-6, 'distance = speed × time');
  // And the target (center 420,220, vx −160) is AT that point at flightTime.
  assert.ok(Math.abs((420 - 160 * h.flightTime) - h.point.x) < 1e-9, 'target meets bullet');
});

ok('invoke predictive: no solution falls back to current position', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 500, vy: 0 }; // outruns bullet
  const ctx = makeContext(attacker(), { target: t });
  const h = invoke('predictive', { speed: 300 }, ctx);
  assert.equal(h.flightTime, null);
  assert.deepEqual(h.point, { x: 420, y: 220 });
});

ok('no target: completes with direction 0', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('predictive', {}, ctx);
  assert.equal(h.direction, 0);
  assert.ok(h.point.x > 116, 'aims ahead of origin');
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
