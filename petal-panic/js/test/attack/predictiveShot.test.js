// Predictive Shot macro tests (pure logic, no DOM).
// Run: node js/test/attack/predictiveShot.test.js

import { strict as assert } from 'node:assert';
import { interceptPoint } from '../../combat/attack/macros/predictiveShot.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import '../../combat/attack/primitives/projectile.js'; // the macro composes it
import '../../combat/attack/macros/predictiveShot.js';  // registers the macro

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 }); // center (116,116)

// Minimal pool stubs satisfying the projectile spawn contract.
import { LAYER } from '../../consts.js';
function pools() {
  const mk = (size) => {
    const items = [];
    return {
      activeItems: items,
      spawn(...args) {
        const e = { alive: true, x: args[0], y: args[1], w: 12, h: 12, vx: 0, vy: 0, layer: LAYER.PROJ_ALLY, setLife() {}, timers: new Map() };
        items.push(e);
        return e;
      },
      updateAll() {},
    };
  };
  return { projectilePool: mk(64), specialPool: mk(16) };
}

ok('interceptPoint: bullet travel distance equals speed × flight time', () => {
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
  assert.ok(Math.abs((420 - 160 * r.t) - r.x) < 1e-9, 'x matches target pos at t');
  assert.ok(Math.abs(220 - r.y) < 1e-9, 'y matches target pos at t');
});

ok('interceptPoint: faster bullet → shorter flight, less lead', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 100, vy: 0 };
  const o = { x: 116, y: 116 };
  const slow = interceptPoint(t, o, 300);
  const fast = interceptPoint(t, o, 800);
  assert.ok(fast.t < slow.t, `fast=${fast.t} < slow=${slow.t}`);
  assert.ok(fast.x < slow.x, 'less lead for faster bullet');
});

ok('interceptPoint: static target → its center, t = distance/speed', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 0, vy: 0 };
  const o = { x: 116, y: 116 };
  const r = interceptPoint(t, o, 400);
  assert.ok(r, 'solution exists');
  assert.equal(r.x, 420);
  assert.equal(r.y, 220);
  const d = Math.hypot(r.x - o.x, r.y - o.y);
  assert.ok(Math.abs(r.t - d / 400) < 1e-9, 't = distance/speed');
});

ok('interceptPoint: diagonal target velocity solved in 2D', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 100, vy: -50 };
  const o = { x: 116, y: 116 };
  const r = interceptPoint(t, o, 500);
  assert.ok(r, 'solution exists');
  assert.ok(Math.abs((420 + 100 * r.t) - r.x) < 1e-9, 'x');
  assert.ok(Math.abs((220 - 50 * r.t) - r.y) < 1e-9, 'y');
});

ok('interceptPoint: target outrunning bullet → null', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 400, vy: 0 };
  const o = { x: 116, y: 116 };
  assert.equal(interceptPoint(t, o, 300), null);
});

ok('invoke predictiveShot: end-to-end with speed param', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: -160, vy: 0 };
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const h = invoke('predictiveShot', { speed: 300 }, ctx);
  assert.ok(h.entity, 'shot spawned');
  assert.ok(h.flightTime > 0, 'flightTime reported');
  // Bullet from attacker center (116,116) must cover |point−origin| in flightTime.
  const d = Math.hypot(h.point.x - 116, h.point.y - 116);
  assert.ok(Math.abs(d - 300 * h.flightTime) < 1e-6, 'distance = speed × time');
  // And the target (center 420,220, vx −160) is AT that point at flightTime.
  assert.ok(Math.abs((420 - 160 * h.flightTime) - h.point.x) < 1e-9, 'target meets bullet');
});

ok('invoke predictiveShot: no solution falls back to current position', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 500, vy: 0 }; // outruns bullet
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const h = invoke('predictiveShot', { speed: 300 }, ctx);
  assert.equal(h.flightTime, null);
  assert.deepEqual(h.point, { x: 420, y: 220 });
  assert.ok(h.entity, 'still fires a shot');
});

ok('no target: completes aiming straight ahead', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const h = invoke('predictiveShot', {}, ctx);
  assert.ok(h.entity, 'shot spawned');
  assert.ok(h.point.x > 116, 'aims ahead of origin');
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
