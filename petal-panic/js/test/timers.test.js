// Unified labeled TTL engine — unit tests.
// Run: node js/test/timers.test.js
// Pure logic; no DOM/canvas needed.

import { strict as assert } from 'node:assert';
import { Timers, TIMER_COLORS } from '../timers.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('Timers (unified labeled TTL)');

ok('set + get returns remaining', () => {
  const t = new Timers();
  t.set('inv', 0.6);
  assert.equal(t.get('inv'), 0.6);
});

ok('absent timer reads 0', () => {
  const t = new Timers();
  assert.equal(t.get('nope'), 0);
});

ok('multiple timers run concurrently', () => {
  const t = new Timers();
  t.set('rec', 0.25);
  t.set('inv', 0.6);
  t.set('rapid', 3);
  assert.equal(t.count, 3);
  t.tick(0.1);
  assert.ok(Math.abs(t.get('rec') - 0.15) < 1e-9);
  assert.ok(Math.abs(t.get('inv') - 0.5) < 1e-9);
  assert.ok(Math.abs(t.get('rapid') - 2.9) < 1e-9);
});

ok('tick removes expired timers and edge-triggers expired()', () => {
  const t = new Timers();
  t.set('fuse', 0.1);
  t.tick(0.05);
  assert.equal(t.expired('fuse'), false); // not yet
  t.tick(0.05);
  assert.equal(t.expired('fuse'), true);  // just crossed zero this frame
  assert.equal(t.has('fuse'), false);     // removed
  t.tick(0.05);
  assert.equal(t.expired('fuse'), false); // only true on the crossing frame
});

ok('fraction goes 1 -> 0 over life', () => {
  const t = new Timers();
  t.set('life', 1.0);
  assert.equal(t.fraction('life'), 1);
  t.tick(0.5);
  assert.ok(Math.abs(t.fraction('life') - 0.5) < 1e-9);
  t.tick(0.5);
  assert.equal(t.fraction('life'), 1); // absent after expiry -> 1 (no bar)
});

ok('set with <=0 clears the timer', () => {
  const t = new Timers();
  t.set('inv', 0.6);
  t.set('inv', 0);
  assert.equal(t.has('inv'), false);
});

ok('active() lists timers sorted by name with frac', () => {
  const t = new Timers();
  t.set('zeta', 1);
  t.set('alpha', 1);
  t.tick(0.5);
  const rows = t.active();
  assert.deepEqual(rows.map(r => r.name), ['alpha', 'zeta']);
  assert.ok(Math.abs(rows[0].frac - 0.5) < 1e-9);
});

ok('clear / clearAll work', () => {
  const t = new Timers();
  t.set('a', 1); t.set('b', 1);
  t.clear('a');
  assert.equal(t.has('a'), false);
  assert.equal(t.has('b'), true);
  t.clearAll();
  assert.equal(t.count, 0);
});

ok('known labels have colors', () => {
  for (const k of ['life', 'fuse', 'death', 'rec', 'intangible', 'rapid']) {
    assert.ok(TIMER_COLORS[k], `missing color for ${k}`);
  }
});

console.log(`\n${passed} passed`);
