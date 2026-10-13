// Task 1.11 — Homing / Steering primitive tests (pure logic, no DOM).
// Run: node js/test/attack/homing.test.js

import { strict as assert } from 'node:assert';
import { steerVelocity } from '../../combat/attack/primitives/homing.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const target = () => ({ x: 400, y: 200, w: 32, h: 32, alive: true });

ok('steerVelocity: turns toward desired by at most maxTurn', () => {
  // Moving right (0 rad), want up (-π/2), max turn π/4 → heading -π/4.
  const v = steerVelocity(100, 0, -Math.PI / 2, Math.PI / 4);
  const ang = Math.atan2(v.vy, v.vx);
  assert.ok(Math.abs(ang - (-Math.PI / 4)) < 1e-9, `angle=${ang}`);
  assert.ok(Math.abs(Math.hypot(v.vx, v.vy) - 100) < 1e-9, 'speed preserved');
});

ok('steerVelocity: small corrections pass through unclamped', () => {
  const v = steerVelocity(100, 0, -0.05, 1);
  const ang = Math.atan2(v.vy, v.vx);
  assert.ok(Math.abs(ang + 0.05) < 1e-9, `angle=${ang}`);
});

ok('steerVelocity: wraps across the ±π seam', () => {
  // Moving left (π), want just past -π → should turn the short way.
  const v = steerVelocity(-100, 0, -Math.PI + 0.1, 1);
  const ang = Math.atan2(v.vy, v.vx);
  assert.ok(Math.abs(ang - (-Math.PI + 0.1)) < 1e-9, `angle=${ang}`);
});

ok('bind applies initialDirection and speed', () => {
  const ctx = makeContext({ x: 0, y: 0, w: 10, h: 10 }, {});
  const ent = { x: 0, y: 0, w: 12, h: 12, vx: 500, vy: 0 };
  const h = invoke('homing', { target: target(), initialDirection: -Math.PI / 2, speed: 300 }, ctx);
  h.bind(ent);
  assert.ok(Math.abs(ent.vx) < 1e-9, 'vx ~ 0');
  assert.ok(Math.abs(ent.vy + 300) < 1e-9, 'vy = -300');
});

ok('steering curves a shot onto a moving target', () => {
  const t = target();
  const ctx = makeContext({ x: 0, y: 0, w: 10, h: 10 }, { target: t });
  const ent = { x: 0, y: 200, w: 12, h: 12, vx: 400, vy: 0 };
  const h = invoke('homing', { target: t, turnRate: 4, ttl: 3 }, ctx);
  h.bind(ent);
  let finished = false;
  for (let i = 0; i < 180 && !finished; i++) {
    finished = h.step(DT);
    ent.x += ent.vx * DT;
    ent.y += ent.vy * DT;
    t.x += 60 * DT; // target drifts right
  }
  // After 3s of steering it must be pointing at (or past) the target's y/x.
  const ang = Math.atan2(ent.vy, ent.vx);
  const toTarget = Math.atan2(t.y + 16 - (ent.y + 6), t.x + 16 - (ent.x + 6));
  let diff = toTarget - ang;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  assert.ok(Math.abs(diff) < 0.35, `heading error ${Math.abs(diff).toFixed(2)} rad`);
});

ok('completes when the target dies', () => {
  const t = target(); t.alive = false;
  const ctx = makeContext({ x: 0, y: 0, w: 10, h: 10 }, { target: t });
  const ent = { x: 0, y: 0, w: 12, h: 12, vx: 100, vy: 0 };
  const h = invoke('homing', { target: t, ttl: 5 }, ctx);
  h.bind(ent);
  assert.equal(h.step(DT), true, 'gives up immediately');
});

ok('completes at ttl with no target bound', () => {
  const ctx = makeContext({ x: 0, y: 0, w: 10, h: 10 }, {});
  const h = invoke('homing', { ttl: 0.2 }, ctx);
  let done = null;
  h.on('complete', (i) => { done = i; });
  for (let i = 0; i < 12; i++) h.step(DT);
  assert.equal(h.step(DT), true);
  assert.deepEqual(done, { tracked: false });
});

ok('step is idempotent after completion', () => {
  const ctx = makeContext({ x: 0, y: 0, w: 10, h: 10 }, {});
  const h = invoke('homing', { ttl: 0.1 }, ctx);
  h.step(0.2);
  assert.equal(h.step(DT), true);
  assert.equal(h.step(DT), true);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
