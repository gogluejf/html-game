// Task 1.12 — Predictive Targeting primitive tests (pure logic, no DOM).
// Run: node js/test/attack/predictive.test.js

import { strict as assert } from 'node:assert';
import { predictPoint } from '../../combat/attack/primitives/predictive.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });

ok('predictPoint: static target → its center', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 0, vy: 0 };
  const p = predictPoint(t, 0.5);
  assert.deepEqual(p, { x: 420, y: 220 });
});

ok('predictPoint: leads by velocity × time', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 200, vy: -100 };
  const p = predictPoint(t, 0.6);
  assert.ok(Math.abs(p.x - (420 + 120)) < 1e-9, `x=${p.x}`);
  assert.ok(Math.abs(p.y - (220 - 60)) < 1e-9, `y=${p.y}`);
});

ok('predictPoint: maxPrediction caps the lead distance', () => {
  const t = { x: 400, y: 200, w: 40, h: 40, vx: 1000, vy: 0 };
  const p = predictPoint(t, 1, 50); // wants 1000px of lead, capped at 50
  assert.ok(Math.abs(p.x - (420 + 50)) < 1e-9, `x=${p.x}`);
  assert.ok(Math.abs(p.y - 220) < 1e-9, `y=${p.y}`);
});

ok('direction: aims from attacker center at the led point', () => {
  const t = { x: 400, y: 100, w: 40, h: 40, vx: 0, vy: 0 };
  const ctx = makeContext(attacker(), { target: t });
  const h = invoke('predictive', { predictionTime: 0 }, ctx);
  // Attacker center (116,116) → target center (420,120): nearly straight right.
  assert.ok(h.direction > -0.05 && h.direction < 0.05, `dir=${h.direction}`);
  assert.deepEqual(h.point, { x: 420, y: 120 });
});

ok('leading a fast target shifts the aim angle', () => {
  const slow = { x: 400, y: 100, w: 40, h: 40, vx: 0, vy: 300 };
  const ctxS = makeContext(attacker(), { target: slow });
  const hS = invoke('predictive', { predictionTime: 0.5 }, ctxS);
  const ctxF = makeContext(attacker(), { target: { ...slow, vy: 900 } });
  const hF = invoke('predictive', { predictionTime: 0.5 }, ctxF);
  // More lead → aim further down (larger positive angle).
  assert.ok(hF.direction > hS.direction, `${hF.direction} > ${hS.direction}`);
});

ok('no target: completes with direction 0', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('predictive', {}, ctx);
  assert.equal(h.direction, 0);
  assert.ok(h.point.x > 116, 'aims ahead of origin');
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
