// Task 1.10 — Reticle / Telegraph primitive tests (pure logic, no DOM).
// Run: node js/test/attack/reticle.test.js

import { strict as assert } from 'node:assert';
import { telegraphPoint, stepReticle } from '../../combat/attack/primitives/reticle.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });
const target = () => ({ x: 400, y: 200, w: 40, h: 40, alive: true });

ok('anchor: explicit x/y wins when no target', () => {
  const ctx = makeContext(attacker(), {});
  const pt = telegraphPoint({ x: 500, y: 300 }, ctx);
  assert.equal(pt.x, 500); assert.equal(pt.y, 300);
});

ok('anchor: target center overrides x/y', () => {
  const ctx = makeContext(attacker(), { target: target() });
  const pt = telegraphPoint({ x: 500, y: 300 }, ctx);
  assert.equal(pt.x, 420); assert.equal(pt.y, 220);
});

ok('anchor: falls back to attacker center', () => {
  const ctx = makeContext(attacker(), {});
  const pt = telegraphPoint({}, ctx);
  assert.equal(pt.x, 116); assert.equal(pt.y, 116);
});

ok('completes after duration with the final point', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('reticle', { x: 500, y: 300, duration: 0.6 }, ctx);
  let done = null;
  h.on('complete', (i) => { done = i; });
  for (let i = 0; i < 35; i++) assert.equal(h.step(1 / 60), false, `frame ${i} still warning`);
  assert.equal(h.step(1 / 60), true, 'finishes at ~0.6s');
  assert.deepEqual(done.point, { x: 500, y: 300 });
});

ok('step is idempotent after completion', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('reticle', { x: 0, y: 0, duration: 0.1 }, ctx);
  h.step(0.2); // over-duration → done
  assert.equal(h.step(0.1), true);
  assert.equal(h.step(0.1), true);
});

ok('tracking: follows the target each frame until lockTime', () => {
  const t = target();
  const ctx = makeContext(attacker(), { target: t });
  const h = invoke('reticle', { duration: 1, tracking: true, lockTime: 0.5 }, ctx);
  // Frame 1: unlocked → point tracks target.
  assert.equal(h.step(1 / 60), false);
  assert.deepEqual(h.state.pt, { x: 420, y: 220 });
  // Move the target; next frame must follow.
  t.x += 50;
  assert.equal(h.step(1 / 60), false);
  assert.equal(h.state.pt.x, 470, 'tracks the moving target');
  // Advance past lockTime → position freezes.
  t.x += 50;
  for (let i = 0; i < 32; i++) h.step(1 / 60); // t ≈ 0.53s > lockTime 0.5
  assert.ok(h.state.locked, 'locked after lockTime');
  const frozen = { ...h.state.locked };
  t.x += 999;
  h.step(1 / 60);
  assert.equal(h.state.pt.x, frozen.x, 'no longer follows after lock');
});

ok('static (no tracking): locks immediately on first step', () => {
  const t = target();
  const ctx = makeContext(attacker(), { target: t });
  const h = invoke('reticle', { duration: 1 }, ctx);
  h.step(1 / 60);
  assert.ok(h.state.locked, 'locks on frame 1');
  t.x += 999;
  h.step(1 / 60);
  assert.equal(h.state.pt.x, h.state.locked.x, 'stays put');
});

ok('dead target falls back to explicit x/y', () => {
  const t = target(); t.alive = false;
  const ctx = makeContext(attacker(), { target: t });
  const pt = telegraphPoint({ x: 10, y: 20 }, ctx);
  assert.deepEqual(pt, { x: 10, y: 20 });
});

ok('cancel tears down without complete', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('reticle', { x: 0, y: 0, duration: 5 }, ctx);
  let completed = false, expired = false;
  h.on('complete', () => { completed = true; });
  h.on('expire', () => { expired = true; });
  h.cancel();
  assert.equal(completed, false);
  assert.equal(expired, true);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
