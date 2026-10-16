// Spread Shot macro tests (pure logic, no DOM).
// Run: node js/test/attack/spreadShot.test.js

import { strict as assert } from 'node:assert';
import { spreadAngles } from '../../combat/attack/macros/spreadShot.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import '../../combat/attack/primitives/projectile.js'; // the macro composes it
import '../../combat/attack/macros/spreadShot.js';     // registers the macro

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const close = (a, b) => Math.abs(a - b) < 1e-9;

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

ok('single shot collapses to the center direction', () => {
  assert.deepEqual(spreadAngles(1, 0.7, Math.PI), [0.7]);
});

ok('three shots across 60° centered on 0', () => {
  const a = spreadAngles(3, 0, Math.PI / 3);
  assert.equal(a.length, 3);
  assert.ok(close(a[0], -Math.PI / 6));
  assert.ok(close(a[1], 0));
  assert.ok(close(a[2], Math.PI / 6));
});

ok('five shots across 90° centered on π/2', () => {
  const a = spreadAngles(5, Math.PI / 2, Math.PI / 2);
  assert.equal(a.length, 5);
  assert.ok(close(a[0], Math.PI / 4));
  assert.ok(close(a[4], 3 * Math.PI / 4));
});

ok('2π angle produces a full radial ring', () => {
  const a = spreadAngles(8, 0, Math.PI * 2);
  assert.equal(a.length, 8);
  for (let i = 0; i < 8; i++) {
    assert.ok(close(a[i], -Math.PI + (Math.PI * 2 * i) / 7), `angle[${i}]`);
  }
});

ok('count is floored and clamped to at least 1', () => {
  assert.equal(spreadAngles(2.9, 0, 1).length, 2);
  assert.equal(spreadAngles(0, 0, 1).length, 1);
  assert.equal(spreadAngles(-3, 0, 1).length, 1);
});

ok('end-to-end: invoke("spreadShot") returns live projectile handles + completes', () => {
  const h = invoke('spreadShot', { count: 4, direction: Math.PI, angle: Math.PI / 2 }, makeContext({}, { pools: pools() }));
  // Synchronous completion: all four shots spawned at invoke time.
  assert.equal(h.angles.length, 4);
  assert.equal(h.handles.length, 4);
  for (const s of h.handles) assert.ok(s.entity, 'each shot has an entity');
  assert.ok(close(h.angles[0], Math.PI - Math.PI / 4));
  assert.ok(close(h.angles[3], Math.PI + Math.PI / 4));
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
