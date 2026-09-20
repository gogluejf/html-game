// Task 7.1 — node-based unit tests for the central effects module (design §12).
// Run: node js/test/effects.test.js
// No DOM needed: effects.js + particles.js are pure modules.

import { strict as assert } from 'node:assert';
import { Effects } from '../effects.js';
import { particles } from '../particles.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Drain the shared particle pool so a test can count spawns deterministically. */
function drainPool() {
  for (const s of particles.activeItems) s.alive = false;
  particles.updateAll(1);
}

console.log('Screen-space state');
ok('vignette starts at 0', () => assert.equal(Effects.vignette, 0));
ok('heroDamaged sets vignette to 1', () => { Effects.heroDamaged(); assert.equal(Effects.vignette, 1); });
ok('vignette decays linearly over ~0.5s', () => {
  Effects.update(0.25);
  assert.ok(Math.abs(Effects.vignette - 0.5) < 0.01, `got ${Effects.vignette}`);
  Effects.update(0.3);
  assert.equal(Effects.vignette, 0);
});
ok('heroDamaged clamps strength to [0,1]', () => { Effects.heroDamaged(99); assert.equal(Effects.vignette, 1); });
ok('heroDamaged never lowers an existing value', () => {
  Effects.heroDamaged(1);
  Effects.heroDamaged(0.2); // weaker hit while vignette is up
  assert.equal(Effects.vignette, 1);
});

ok('screenFlash starts at 0', () => assert.equal(Effects.screenFlash, 0));
ok('bigExplosion sets flash to 1', () => { Effects.bigExplosion(); assert.equal(Effects.screenFlash, 1); });
ok('flash decays linearly over ~0.15s', () => {
  Effects.update(0.075);
  assert.ok(Math.abs(Effects.screenFlash - 0.5) < 0.02, `got ${Effects.screenFlash}`);
  Effects.update(0.1);
  assert.equal(Effects.screenFlash, 0);
});

console.log('Entity-space spawners');
ok('spawnHitSparkles spawns 3-5 by default', () => {
  drainPool();
  const n = Effects.spawnHitSparkles(100, 100);
  assert.ok(n >= 3 && n <= 5, `got ${n}`);
  assert.equal(particles.count, n);
});
ok('spawnHitSparkles respects explicit count', () => {
  drainPool();
  const n = Effects.spawnHitSparkles(100, 100, 4);
  assert.equal(n, 4);
  assert.equal(particles.count, 4);
});
ok('spawnDeathSparkle scales with sprite size', () => {
  drainPool();
  const small = Effects.spawnDeathSparkle(0, 0, 16);
  drainPool();
  const big = Effects.spawnDeathSparkle(0, 0, 96);
  assert.ok(big > small, `small=${small} big=${big}`);
});
ok('spawnPickupPop spawns up to 8 in a ring', () => {
  drainPool();
  const n = Effects.spawnPickupPop(50, 50, '#ff00ff');
  assert.equal(n, 8);
  assert.equal(particles.count, 8);
});
ok('spawnExplosion spawns >=12 and scales with radius', () => {
  drainPool();
  const s = Effects.spawnExplosion(0, 0, 20);
  assert.ok(s >= 12, `small=${s}`);
  drainPool();
  const b = Effects.spawnExplosion(0, 0, 200);
  assert.ok(b > s, `small=${s} big=${b}`);
});
ok('spawners cap at the pool size (no allocation)', () => {
  drainPool();
  const cap = 50; // MAX_PARTICLES
  const n = Effects.spawnExplosion(0, 0, 100000); // would want way more than 50
  assert.ok(n <= cap, `got ${n}`);
});

console.log('Enemy shake');
ok('beginEnemyShake sets hitFlash to >= 0.1', () => {
  const e = { hitFlash: 0 };
  Effects.beginEnemyShake(e);
  assert.ok(e.hitFlash >= 0.1);
});
ok('beginEnemyShake keeps a longer existing flash', () => {
  const e = { hitFlash: 0.3 };
  Effects.beginEnemyShake(e);
  assert.equal(e.hitFlash, 0.3);
});
ok('getEntityShakeOffset returns zero when no flash', () => {
  assert.deepEqual(Effects.getEntityShakeOffset({ hitFlash: 0 }), { x: 0, y: 0 });
});
ok('getEntityShakeOffset stays within ±3px while flashing', () => {
  const e = { hitFlash: 0.1 };
  let sawNonZero = false;
  for (let i = 0; i < 50; i++) {
    const o = Effects.getEntityShakeOffset(e);
    assert.ok(Math.abs(o.x) <= 3 && Math.abs(o.y) <= 3);
    if (o.x !== 0 || o.y !== 0) sawNonZero = true;
  }
  assert.ok(sawNonZero, 'expected at least one non-zero offset in 50 rolls');
});
ok('getEntityShakeOffset handles null entity', () => {
  assert.deepEqual(Effects.getEntityShakeOffset(null), { x: 0, y: 0 });
});

console.log('Reset');
ok('reset clears both timers', () => {
  Effects.heroDamaged();
  Effects.bigExplosion();
  Effects.reset();
  assert.equal(Effects.vignette, 0);
  assert.equal(Effects.screenFlash, 0);
});

console.log(`${passed} passed`);
