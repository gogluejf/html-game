// Hit-stop unit tests (dash-combo-hitstop HANDOFF Part B).
// Run: node petal-panic/js/test/hitstop.test.js
// No DOM needed: core/hitstop.js is a pure time-layer module.

import { strict as assert } from 'node:assert';
import { hitstop, consumeHitstop, hitstopActive, resetHitstop } from '../core/hitstop.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('Hit-stop (time-layer hook)');

ok('hitstop(n) then n consecutive consume calls freeze, then release', () => {
  resetHitstop();
  hitstop(5);
  assert.equal(hitstopActive(), true);
  for (let i = 0; i < 5; i++) assert.equal(consumeHitstop(), true, `frame ${i + 1} frozen`);
  assert.equal(consumeHitstop(), false, 'released after n frames');
  assert.equal(hitstopActive(), false);
});

ok('overlapping requests use max, not sum', () => {
  resetHitstop();
  hitstop(4);
  hitstop(6); // larger → wins
  let frozen = 0;
  while (consumeHitstop()) frozen++;
  assert.equal(frozen, 6, `expected 6 frozen frames, got ${frozen}`);
  resetHitstop();
  hitstop(6);
  hitstop(3); // smaller → ignored
  let frozen2 = 0;
  while (consumeHitstop()) frozen2++;
  assert.equal(frozen2, 6, `expected 6 frozen frames, got ${frozen2}`);
});

ok('invalid requests are ignored (bare call still defaults to 5)', () => {
  resetHitstop();
  hitstop(0);
  hitstop(-3);
  hitstop(NaN);
  assert.equal(consumeHitstop(), false, 'no freeze armed by invalid input');
  // A bare hitstop() call is the default request — must arm 5 frames.
  hitstop();
  let frozen = 0;
  while (consumeHitstop()) frozen++;
  assert.equal(frozen, 5, `bare call arms the default window, got ${frozen}`);
});

ok('stub loop: exactly n skipped updates, no accumulated drift', () => {
  resetHitstop();
  const DT = 1 / 60;
  let accumulator = 0;
  let steps = 0;
  let frozenSteps = 0;
  // Simulate 30 fixed frames of wall-clock time arriving in one chunk.
  accumulator += 30 * DT;
  hitstop(5);
  while (accumulator >= DT) {
    if (consumeHitstop()) {
      frozenSteps++;
      accumulator -= DT; // frozen step still consumes its time — no drift
      continue;
    }
    steps++;
    accumulator -= DT;
  }
  assert.equal(frozenSteps, 5, `5 frozen steps, got ${frozenSteps}`);
  assert.equal(steps, 25, `25 live steps, got ${steps}`);
  assert.ok(Math.abs(accumulator) < 1e-9, `no leftover drift, got ${accumulator}`);
});

ok('reset clears a pending window', () => {
  hitstop(10);
  assert.equal(hitstopActive(), true);
  resetHitstop();
  assert.equal(consumeHitstop(), false);
});

console.log(`\n${passed} passed`);
