// Task 1.7 — Movement / Charge primitive tests (pure logic, no DOM).
// Run: node js/test/attack/movement.test.js

import { strict as assert } from 'node:assert';
import { makeChargeState, stepCharge } from '../../combat/attack/primitives/movement.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const EPS = 1e-6;

const P = { direction: 0, speed: 600, distanceType: 'fixed', distance: 300, acceleration: 0 };

ok('instant charge moves at full speed along the direction', () => {
  const a = { x: 0, y: 0 };
  const ctx = makeContext(a, {});
  const st = makeChargeState(P, ctx);
  stepCharge(st, P, ctx, DT);
  assert.ok(Math.abs(a.x - 600 * DT) < EPS, `x=${a.x}`);
  assert.ok(Math.abs(a.y) < EPS);
  assert.ok(Math.abs(st.currentSpeed - 600) < EPS);
});

ok('upward direction produces negative-y motion', () => {
  const a = { x: 0, y: 0 };
  const ctx = makeContext(a, {});
  const st = makeChargeState({ ...P, direction: -Math.PI / 2 }, ctx);
  stepCharge(st, { ...P, direction: -Math.PI / 2 }, ctx, DT);
  assert.ok(Math.abs(a.y + 600 * DT) < EPS, `y=${a.y}`);
});

ok('fixed distance stop: finishes after traveling the declared distance', () => {
  const a = { x: 0, y: 0 };
  const ctx = makeContext(a, {});
  const st = makeChargeState(P, ctx); // P has distanceType:'fixed', distance:300, speed:600
  let frames = 0;
  while (!stepCharge(st, P, ctx, DT) && frames < 1000) frames++;
  // 300px at 600px/s = 0.5s ≈ 30 frames
  assert.ok(frames >= 29 && frames <= 31, `frames=${frames}`);
  assert.ok(Math.abs(a.x - 300) < 600 * DT * 2, `x=${a.x}`);
});

ok('infinit distance: runs until out of screen', () => {
  const a = { x: 0, y: 270 };
  const ctx = makeContext(a, {});
  const p = { ...P, distanceType: 'infinit', speed: 960 }; // 1 screen-width per second
  const st = makeChargeState(p, ctx);
  let frames = 0;
  while (!stepCharge(st, p, ctx, DT) && frames < 200) frames++;
  // Should stop when x > VIEW_W + 60 margin ≈ 1020. At 960px/s that's ~1.06s ≈ 64 frames.
  assert.ok(frames >= 60 && frames <= 70, `frames=${frames} (x=${a.x})`);
  assert.ok(a.x > 960, `exited screen (x=${a.x})`);
});

ok('distance stop: fixed distance ends the charge', () => {
  const a = { x: 0, y: 0 };
  const ctx = makeContext(a, {});
  const p = { ...P, distanceType: 'fixed', distance: 300 };
  const st = makeChargeState(p, ctx);
  let frames = 0;
  while (!stepCharge(st, p, ctx, DT) && frames < 1000) frames++;
  // 300px at 600px/s = 0.5s ≈ 30 frames
  assert.ok(frames >= 29 && frames <= 31, `frames=${frames}`);
  assert.ok(Math.abs(st.traveled - 300) < 600 * DT, `traveled=${st.traveled}`);
});

ok('acceleration ramps speed up gradually', () => {
  const a = { x: 0, y: 0 };
  const ctx = makeContext(a, {});
  const p = { ...P, acceleration: 600, distance: 600 };
  const st = makeChargeState(p, ctx);
  stepCharge(st, p, ctx, DT);
  // After one frame at 600px/s² accel: speed = 600*(1/60) = 10 px/s
  assert.ok(Math.abs(st.currentSpeed - 10) < EPS, `speed=${st.currentSpeed}`);
  stepCharge(st, p, ctx, DT);
  assert.ok(Math.abs(st.currentSpeed - 20) < EPS, `speed=${st.currentSpeed}`);
});

ok('obstacle: blocked input stops the charge early and reports it', () => {
  const a = { x: 0, y: 0 };
  const ctx = makeContext(a, {});
  const p = { ...P, distanceType: 'infinit' }; // long range so only the block ends it
  const st = makeChargeState(p, ctx);
  stepCharge(st, p, ctx, DT);
  const finished = stepCharge(st, p, ctx, DT, { blocked: true });
  assert.equal(finished, true, 'blocked → finished');
  assert.equal(st.blocked, true);
  assert.ok(st.traveled < 50, `stopped well before going far (traveled=${st.traveled})`);
});

ok('stopOnObstacle=false ignores blocked input', () => {
  const a = { x: 0, y: 0 };
  const ctx = makeContext(a, {});
  const p = { ...P, stopOnObstacle: false };
  const st = makeChargeState(p, ctx);
  const finished = stepCharge(st, p, ctx, DT, { blocked: true });
  assert.equal(finished, false, 'keeps moving through obstacles');
});

ok('end-to-end: invoke("charge") handle completes with summary', () => {
  const a = { x: 0, y: 0 };
  const ctx = makeContext(a, {});
  const h = invoke('charge', { ...P, distanceType: 'fixed', distance: 120 }, ctx);
  const seen = [];
  h.on('complete', (r) => seen.push(r));
  while (!h.step(DT)) {}
  assert.equal(seen.length, 1);
  assert.ok(Math.abs(seen[0].traveled - 120) < 600 * DT, `traveled=${seen[0].traveled}`);
  assert.equal(seen[0].blocked, false);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
