// Task 1.3 — Spread primitive tests (pure math, no DOM).
// Run: node js/test/attack/spread.test.js

import { strict as assert } from 'node:assert';
import { spreadAngles } from '../../combat/attack/primitives/spread.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const EPS = 1e-9;
const close = (a, b, tol = EPS) => Math.abs(a - b) < tol;

ok('single shot collapses to [direction]', () => {
  assert.deepEqual(spreadAngles(1, 0.7, Math.PI), [0.7]);
});

ok('3 shots across 60° centered on right', () => {
  const a = spreadAngles(3, 0, Math.PI / 3);
  assert.equal(a.length, 3);
  assert.ok(close(a[0], -Math.PI / 6), `a0=${a[0]}`);
  assert.ok(close(a[1], 0), `a1=${a[1]}`);
  assert.ok(close(a[2], Math.PI / 6), `a2=${a[2]}`);
});

ok('distribution is even and edge-to-edge', () => {
  const a = spreadAngles(5, Math.PI / 2, Math.PI / 2);
  // center ± 45°
  assert.ok(close(a[0], Math.PI / 2 - Math.PI / 4));
  assert.ok(close(a[4], Math.PI / 2 + Math.PI / 4));
  for (let i = 1; i < a.length; i++) {
    const step = a[i] - a[i - 1];
    assert.ok(close(step, (Math.PI / 2) / 4), `step ${i}=${step}`);
  }
});

ok('2π angle produces a radial pattern (full circle)', () => {
  const a = spreadAngles(8, 0, Math.PI * 2);
  assert.equal(a.length, 8);
  // 8 outputs over 360° → 360/(8-1) ≈ 51.43° apart, edge-to-edge from -180°.
  const step = (Math.PI * 2) / 7;
  assert.ok(close(a[0], -Math.PI));
  assert.ok(close(a[1], -Math.PI + step));
  assert.ok(close(a[7], Math.PI));
});

ok('count floors non-integers and clamps to >= 1', () => {
  assert.equal(spreadAngles(2.9, 0, 1).length, 2);
  assert.equal(spreadAngles(0, 0, 1).length, 1);
  assert.equal(spreadAngles(-3, 0, 1).length, 1);
});

ok('end-to-end: invoke("spread") returns handle with angles + completes', () => {
  const h = invoke('spread', { count: 4, direction: Math.PI, angle: Math.PI / 2 }, makeContext({}));
  // Synchronous primitive: complete already fired during invoke(); assert on
  // the produced data (late subscriptions must not replay terminal events).
  assert.equal(h.angles.length, 4);
  assert.ok(close(h.angles[0], Math.PI - Math.PI / 4));
  assert.ok(close(h.angles[3], Math.PI + Math.PI / 4));
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
