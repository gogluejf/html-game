// Task 1.16 — Boomerang primitive tests (pure logic, no DOM).
// Run: node js/test/attack/boomerang.test.js

import { strict as assert } from 'node:assert';
import '../../combat/attack/primitives/boomerang.js'; // registration side effect
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 }); // center (116,116)
const P = { direction: 0, speed: 500, returnSpeed: 700, outboundDuration: 0.6, ttl: 4 };

ok('outbound: moves along the direction at speed', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('boomerang', P, ctx);
  for (let i = 0; i < 30; i++) h.step(DT); // 0.5s outbound
  assert.equal(h.state.phase, 'outbound');
  assert.ok(Math.abs(h.state.x - (116 + 500 * 0.5)) < 1, `x=${h.state.x}`);
  assert.ok(Math.abs(h.state.y - 116) < 1, `y=${h.state.y}`);
});

ok('turnaround: switches to return phase after outboundDuration', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('boomerang', P, ctx);
  for (let i = 0; i < 36; i++) h.step(DT); // 0.6s
  assert.equal(h.state.phase, 'return');
  // Return velocity points back toward origin (negative x).
  assert.ok(h.state.vx < 0, `vx=${h.state.vx}`);
});

ok('returns home and completes with returned=true', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('boomerang', P, ctx);
  let done = null;
  h.on('complete', (i) => { done = i; });
  let finished = false;
  for (let i = 0; i < 300 && !finished; i++) finished = h.step(DT);
  assert.ok(finished, 'came home within ttl');
  assert.deepEqual(done, { returned: true });
  // Ended near the origin.
  assert.ok(Math.hypot(h.state.x - 116, h.state.y - 116) < 12, 'back at origin');
});

ok('outboundDistance caps the outbound leg early', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('boomerang', { ...P, outboundDistance: 200 }, ctx);
  // At 500px/s, 200px takes 0.4s < 0.6s duration → distance wins.
  for (let i = 0; i < 24; i++) h.step(DT); // 0.4s
  assert.equal(h.state.phase, 'return', `phase=${h.state.phase}`);
  assert.ok(Math.abs(Math.hypot(h.state.x - 116, h.state.y - 116) - 200) < 2, 'turned at ~200px');
});

ok('ttl cap: expires without returning if too short', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('boomerang', { ...P, ttl: 0.3 }, ctx);
  let done = null;
  h.on('complete', (i) => { done = i; });
  for (let i = 0; i < 20; i++) h.step(DT);
  assert.equal(h.step(DT), true);
  assert.deepEqual(done, { returned: false });
});

ok('step is idempotent after completion', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('boomerang', { ...P, ttl: 0.2 }, ctx);
  h.step(0.3);
  assert.equal(h.step(DT), true);
  assert.equal(h.step(DT), true);
});

ok('cancel tears down mid-flight', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('boomerang', P, ctx);
  h.step(DT);
  let expired = false;
  h.on('expire', () => { expired = true; });
  h.cancel();
  assert.equal(expired, true);
});

ok('count: simultaneous burst throws N boomerangs at once', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('boomerang', { ...P, count: 3 }, ctx);
  assert.equal(h.states.length, 3, 'three live states');
  // All three move independently; handle completes when ALL are home.
  let finished = false;
  for (let i = 0; i < 400 && !finished; i++) finished = h.step(DT);
  assert.ok(finished, 'completed');
  for (const s of h.states) assert.equal(s.done, true, 'all came home');
});

ok('count + burstInterval: throws are spaced in time', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('boomerang', { ...P, count: 3, burstInterval: 0.5 }, ctx);
  assert.equal(h.states.length, 1, 'first throw immediately');
  // After ~0.5s (30 frames) the second throw exists; after ~1s the third.
  for (let i = 0; i < 31; i++) h.step(DT);
  assert.equal(h.states.length, 2, `second thrown (got ${h.states.length})`);
  for (let i = 0; i < 31; i++) h.step(DT);
  assert.equal(h.states.length, 3, `third thrown (got ${h.states.length})`);
  let finished = false;
  for (let i = 0; i < 400 && !finished; i++) finished = h.step(DT);
  assert.ok(finished, 'all threw and returned');
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
