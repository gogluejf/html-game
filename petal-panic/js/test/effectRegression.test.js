// Task 2.3 — behavior-preservation regression for the migrated effects.
// Run: node js/test/effectRegression.test.js
//
// Asserts the refactored engine path (Effects.* compat shim → fireManual →
// per-effect files) produces the same observable output as the pre-migration
// monolith, against the EXACT reference values captured in
// .squid-os/plans/effect-engine/effect-reference.txt:
//   - hit sparkles: random int count in [3,5] when count omitted; speed [60,140]
//   - death sparkle: max(4, round(8 + size*0.25))
//   - pickup pop: exactly 8, evenly spaced ring, speed [100,180]
//   - explosion: min(24, 12 + round(radius*0.15)); radius 20→15, cap 24
//   - vignette: full-fade 0.5s linear decay (1 → ~0.5 after 0.25s → 0)
//   - screenFlash: full-fade 0.15s linear decay (1 → ~0.5 after 0.075s → 0)
//   - shake: offset within ±3px per axis while hitFlash > 0, else {0,0}
//
// No DOM needed: pure modules only. Fixed dt = 1/60 per project convention.

import { strict as assert } from 'node:assert';
import { Effects } from '../effects.js';
import { particles } from '../particles.js';
import { BLOOD_COLORS, FIRE_COLORS } from '../effects/palettes.js';

const DT = 1 / 60;
const EPS = 1e-9;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Drain the shared particle pool so a test can count spawns deterministically. */
function drainPool() {
  // Force every live sparkle past its lifetime so updateAll splices it out of
  // the active list (it culls by life expiry, not by an alive flag).
  for (const s of particles.activeItems) s.life = 0;
  particles.updateAll(1);
}

// --- Deterministic RNG ---------------------------------------------------------
// The regression must be fully deterministic (no statistical tolerance): we
// stub Math.random with an exact sequence generator, assert the endpoint
// sequences, and restore the original in `finally`. This replaces the old
// 2000-trial sampling that left a nonzero flake risk. Fixed dt stays 1/60.
const realRandom = Math.random;
/** Run fn with Math.random replaced by a sequence of [0,1) values (cycled). */
function withRandomSeq(values, fn) {
  const orig = Math.random;
  let i = 0;
  Math.random = () => values[i++ % values.length];
  try { return fn(); } finally { Math.random = orig; }
}

/** Step the engine at fixed dt for n frames (n * 1/60 seconds). */
function stepFrames(n) {
  for (let i = 0; i < n; i++) Effects.update(DT);
}

console.log('hit sparkles (spawnHitSparkles)');
ok('default count is a random int in [3,5] (old HIT_SPARKLE_COUNT roll)', () => {
  // Deterministic: the roll is 3 + floor(rand * 3). Stub rand to land exactly
  // on each of the three outcomes and assert the exact counts.
  const cases = [[0, 3], [0.5, 4], [0.999, 5]];
  for (const [r, expected] of cases) {
    drainPool();
    const n = withRandomSeq([r], () => Effects.spawnHitSparkles(100, 100));
    assert.ok(Number.isInteger(n), `count ${n} not an integer`);
    assert.equal(n, expected, `rand=${r} → count ${n}, expected ${expected}`);
  }
});
ok('speeds uniform within [60,140] px/s (HIT_SPARKLE_SPEED), both endpoints reached', () => {
  // Deterministic endpoint coverage. Per-sparkle Math.random() draw order:
  //   1. hitSparkle angle    (hitSparkle.js)
  //   2. hitSparkle speed    ← the one that sets the final vx/vy magnitude
  //   3. Sparkle ctor angle  (particles.js — overridden by spawnOne's directed
  //      vector, so this draw is dead for the final |v|)
  //   4. Sparkle ctor speed  (particles.js — likewise overridden, dead)
  // The effect draws its own angle+speed FIRST and passes them to spawnOne;
  // spawnOne then constructs a Sparkle (which consumes two more randoms for a
  // velocity it immediately overrides with cos(angle)*speed / sin(angle)*speed).
  // Net: FOUR randoms per particle, but the EFFECTIVE-speed draw is the
  // effect's own draw #2, landing at index 4k+1 (first at 1, second at 5).
  // Place the low/high endpoint seeds exactly there; the rest are dummies.
  // No statistical tolerance.
  const N = 5;
  drainPool();
  const seq = new Array(4 * N).fill(0.5);
  seq[1] = 0;          // first sparkle's effective-speed draw → 60
  seq[5] = 0.999999;   // second sparkle's effective-speed draw → ~140
  const speeds = withRandomSeq(seq, () => {
    const out = [];
    Effects.spawnHitSparkles(0, 0, N);
    for (const s of particles.activeItems) out.push(Math.hypot(s.vx, s.vy));
    return out;
  });
  assert.equal(speeds.length, N);
  assert.ok(Math.abs(speeds[0] - 60) < 1e-6, `min speed ${speeds[0]} should reach the 60 bound`);
  assert.ok(Math.abs(speeds[1] - 140) < 1e-3, `max speed ${speeds[1]} should reach the 140 bound`);
});

console.log('death sparkle (spawnDeathSparkle)');
ok('count = max(4, round(8 + size*0.25)): size 16 → 12, size 96 → 32', () => {
  drainPool();
  assert.equal(Effects.spawnDeathSparkle(0, 0, 16), 12); // round(8 + 4) = 12
  drainPool();
  assert.equal(Effects.spawnDeathSparkle(0, 0, 96), 32); // round(8 + 24) = 32
});
ok('small sprites floor at max(4, ...) — size 1 → 8', () => {
  drainPool();
  assert.equal(Effects.spawnDeathSparkle(0, 0, 1), 8); // round(8.25) = 8
});
ok('max(4, ...) floor is defensive: no legal input makes it bind', () => {
  // The monolith contract (git show HEAD~3:petal-panic/js/effects.js
  // spawnDeathSparkle) documents `size` as "representative sprite dimension
  // (px)" with default 32; the only in-game caller passes Math.max(e.w, e.h)
  // (systems/update.js:1698), so every real input is >= 1 and yields count
  // >= round(8.25) = 8 > 4. Negative sizes are not a legal param, so the
  // floor can never bind for legal inputs — it guards against a future base
  // change or a bad caller. Assert the smallest legal size stays above the
  // floor, and document that the floor itself is unreachable by contract.
  drainPool();
  const minLegal = Effects.spawnDeathSparkle(0, 0, 1);
  assert.ok(minLegal > 4, `smallest legal size gave ${minLegal}, floor would have bound`);
  // Sanity: the formula's own lower envelope (round(8 + size*0.25) for
  // size >= 1) is 8, strictly above the 4 floor.
  assert.equal(Math.min(...[1, 2, 4, 8, 16].map(s => Math.round(8 + s * 0.25))), 8);
});

console.log('pickup pop (spawnPickupPop)');
ok('exactly 8 sparkles in an evenly spaced ring, speed [100,180] with both endpoints reached', () => {
  drainPool();
  const n = Effects.spawnPickupPop(50, 50, '#ff00ff');
  assert.equal(n, 8);
  assert.equal(particles.count, 8);
  const items = particles.activeItems;
  for (let i = 0; i < items.length; i++) {
    const speed = Math.hypot(items[i].vx, items[i].vy);
    assert.ok(speed >= 100 && speed <= 180, `item ${i} speed ${speed} outside [100,180]`);
    // Evenly spaced angles: item i points at (i/8)*2π (monolith loop order).
    const expectedAngle = (i / 8) * Math.PI * 2;
    const actualAngle = Math.atan2(items[i].vy, items[i].vx);
    let diff = Math.abs(actualAngle - expectedAngle);
    diff = Math.min(diff, Math.PI * 2 - diff);
    assert.ok(diff < EPS, `item ${i} angle off by ${diff}`);
  }
  // Deterministic endpoint coverage. Per-sparkle Math.random() draw order:
  //   1. pickupPop speed     ← the one that sets the final vx/vy magnitude
  //      (pickupPop computes its evenly spaced angle deterministically — no draw)
  //   2. Sparkle ctor angle  (particles.js — overridden by spawnOne's directed
  //      vector, so this draw is dead for the final |v|)
  //   3. Sparkle ctor speed  (particles.js — likewise overridden, dead)
  // The effect draws its speed FIRST and passes it to spawnOne; spawnOne then
  // constructs a Sparkle (which consumes two more randoms for a velocity it
  // immediately overrides with cos(angle)*speed / sin(angle)*speed). Net:
  // THREE randoms per particle, effective-speed draw at index 3k (first at 0,
  // second at 3). Place the low/high endpoint seeds exactly there; the rest
  // are dummies. No statistical tolerance.
  drainPool();
  const N = 8;
  const seq = new Array(3 * N).fill(0.5);
  seq[0] = 0;          // first sparkle's effective-speed draw → 100
  seq[3] = 0.999999;   // second sparkle's effective-speed draw → ~180
  const speeds = withRandomSeq(seq, () => {
    const out = [];
    Effects.spawnPickupPop(0, 0, '#ff00ff');
    for (const s of particles.activeItems) out.push(Math.hypot(s.vx, s.vy));
    return out;
  });
  assert.equal(speeds.length, N);
  assert.ok(Math.abs(speeds[0] - 100) < 1e-6, `min speed ${speeds[0]} should reach the 100 bound`);
  assert.ok(Math.abs(speeds[1] - 180) < 1e-3, `max speed ${speeds[1]} should reach the 180 bound`);
});

console.log('explosion (spawnExplosion)');
ok('count = min(24, 12 + round(radius*0.15)): r20→15, r200→24, r100000→24', () => {
  drainPool();
  assert.equal(Effects.spawnExplosion(0, 0, 20), 15);   // 12 + round(3) = 15
  drainPool();
  assert.equal(Effects.spawnExplosion(0, 0, 200), 24);  // 12 + 30 → capped at 24
  drainPool();
  assert.equal(Effects.spawnExplosion(0, 0, 100000), 24); // capped at 24
});
ok('caps at the pool size (no allocation beyond MAX_PARTICLES)', () => {
  drainPool();
  const n = Effects.spawnExplosion(0, 0, 100000);
  assert.ok(n <= 50, `got ${n}`);
});
ok('legacy bomb/enemy-death/barrel roll is preserved via the count override (rand=0 → 12, rand=0.999 → 15)', () => {
  // The pre-migration spawnExplosionVFX rolled 12 + floor(rand*4) (12–15) at
  // the call site; the gate fix moved that roll back into the update.js call
  // sites and forwards it as an explicit count param. Stub Math.random so the
  // roll lands exactly on both endpoints through the real shim path.
  for (const [r, expected] of [[0, 12], [0.999, 15]]) {
    drainPool();
    const n = withRandomSeq([r], () => Effects.spawnExplosion(0, 0, 20, 12 + Math.floor(Math.random() * 4)));
    assert.equal(n, expected, `rand=${r} → count ${n}, expected ${expected}`);
  }
});
ok('speeds within [120, 120 + radius*1.5], both endpoints reached', () => {
  // Deterministic endpoint coverage: with radius 40 the range is [120, 180]
  // (speed = 120 + rand * radius*1.5). Per-sparkle Math.random() draw order:
  //   1. explosion angle     (explosion.js)
  //   2. explosion speed     ← the one that sets the final vx/vy magnitude
  //   3. Sparkle ctor angle  (particles.js — overridden by spawnOne's directed
  //      vector, so this draw is dead for the final |v|)
  //   4. Sparkle ctor speed  (particles.js — likewise overridden, dead)
  // The effect draws its own angle+speed FIRST and passes them to spawnOne;
  // spawnOne then constructs a Sparkle (which consumes two more randoms for a
  // velocity it immediately overrides with cos(angle)*speed / sin(angle)*speed).
  // Net: FOUR randoms per particle, effective-speed draw at index 4k+1
  // (first at 1, second at 5). Place the low/high endpoint seeds exactly there;
  // the rest are dummies. No statistical tolerance.
  const RADIUS = 40;
  const N = 18; // count for radius 40 = min(24, 12 + round(6)) = 18
  drainPool();
  const seq = new Array(4 * N).fill(0.5);
  seq[1] = 0;          // first sparkle's effective-speed draw → 120
  seq[5] = 0.999999;   // second sparkle's effective-speed draw → ~180
  const speeds = withRandomSeq(seq, () => {
    const out = [];
    Effects.spawnExplosion(0, 0, RADIUS);
    for (const s of particles.activeItems) out.push(Math.hypot(s.vx, s.vy));
    return out;
  });
  assert.equal(speeds.length, N);
  assert.ok(Math.abs(speeds[0] - 120) < 1e-6, `min speed ${speeds[0]} should reach the 120 bound`);
  assert.ok(Math.abs(speeds[1] - (120 + RADIUS * 1.5)) < 1e-3, `max speed ${speeds[1]} should reach the ${120 + RADIUS * 1.5} bound`);
});
ok('hit-sparkle colors cycle BLOOD_COLORS exactly (all values appear)', () => {
  // Single source of truth: the palettes module, not hardcoded literals.
  const seen = new Set();
  for (let trial = 0; trial < 6; trial++) {
    drainPool();
    Effects.spawnHitSparkles(0, 0, 5);
    for (const s of particles.activeItems) seen.add(s.color);
  }
  for (const c of BLOOD_COLORS) {
    assert.ok(seen.has(c), `BLOOD_COLORS value ${c} never appeared; saw ${[...seen]}`);
  }
  assert.equal(seen.size, BLOOD_COLORS.length, `unexpected extra colors: ${[...seen]}`);
});
ok('explosion colors cycle FIRE_COLORS exactly (all four values appear)', () => {
  const seen = new Set();
  for (let trial = 0; trial < 3; trial++) {
    drainPool();
    Effects.spawnExplosion(0, 0, 20); // count 15 ≥ 4 → full palette per burst
    for (const s of particles.activeItems) seen.add(s.color);
  }
  for (const c of FIRE_COLORS) {
    assert.ok(seen.has(c), `FIRE_COLORS value ${c} never appeared; saw ${[...seen]}`);
  }
  assert.equal(seen.size, FIRE_COLORS.length, `unexpected extra colors: ${[...seen]}`);
});

console.log('vignette (heroDamaged) — 0.5s linear fade');
ok('kicks to 1 and decays to ~0.5 after 0.25s, then to 0 after 0.3s more', () => {
  Effects.reset();
  Effects.heroDamaged();
  assert.equal(Effects.vignette, 1);
  stepFrames(15); // 15 * (1/60) = 0.25s
  // Linear decay at VIGNETTE_DECAY = 1/0.5 per second: 1 - 2 * 0.25 = 0.5.
  const expectedMid = 1 - (1 / 0.5) * (15 * DT);
  assert.ok(Math.abs(Effects.vignette - expectedMid) < EPS, `mid-decay ${Effects.vignette} != ${expectedMid}`);
  assert.ok(Math.abs(Effects.vignette - 0.5) < 0.01, `got ${Effects.vignette}`);
  stepFrames(18); // 18 * (1/60) = 0.3s more → past the 0.5s lifetime
  assert.equal(Effects.vignette, 0);
});
ok('kick uses max(): a weaker hit never lowers a running vignette', () => {
  Effects.reset();
  Effects.heroDamaged(1);
  Effects.heroDamaged(0.2);
  assert.equal(Effects.vignette, 1);
});
ok('strength clamps to [0,1]', () => {
  Effects.reset();
  Effects.heroDamaged(99);
  assert.equal(Effects.vignette, 1);
});

console.log('screen flash (bigExplosion) — 0.15s linear fade');
ok('kicks to 1 and decays linearly over 0.15s (≈0.5 at ~0.075s, then 0)', () => {
  Effects.reset();
  Effects.bigExplosion();
  assert.equal(Effects.screenFlash, 1);
  // 0.075s is not a multiple of the fixed dt; check the exact linear curve at
  // each integer frame: after n frames value = 1 - (1/0.15) * n * DT.
  stepFrames(4); // ≈0.0667s → 0.5556
  assert.ok(Math.abs(Effects.screenFlash - (1 - (1 / 0.15) * 4 * DT)) < EPS, `f4 ${Effects.screenFlash}`);
  stepFrames(1); // ≈0.0833s → 0.4444 — bracketing 0.5 within ±0.06 either side
  assert.ok(Math.abs(Effects.screenFlash - 0.5) < 0.06, `~0.5 near 0.075s, got ${Effects.screenFlash}`);
  stepFrames(7); // well past the 0.15s lifetime
  assert.equal(Effects.screenFlash, 0);
});
ok('kick uses max(): a weaker flash never lowers a running one', () => {
  Effects.reset();
  Effects.bigExplosion(1);
  Effects.bigExplosion(0.2);
  assert.equal(Effects.screenFlash, 1);
});

console.log('enemy shake (beginEnemyShake / getShakeOffset) — ±3px bounds');
ok('beginEnemyShake sets hitFlash up to 0.1 (keeps longer existing values)', () => {
  const e = { hitFlash: 0 };
  Effects.beginEnemyShake(e);
  assert.ok(e.hitFlash >= 0.1);
  const e2 = { hitFlash: 0.3 };
  Effects.beginEnemyShake(e2);
  assert.equal(e2.hitFlash, 0.3);
});
ok('getShakeOffset stays within ±3px per axis while hitFlash > 0, both sides reached', () => {
  const e = { hitFlash: 0.1 };
  // Deterministic endpoint coverage: getShakeOffset returns (rand*2-1)*SHAKE_AMT
  // on each axis — TWO randoms per call (x then y). Stub a length-8 sequence so
  // four calls produce x∈{-3,+3} and y∈{-3,+3} exactly — no statistical
  // tolerance. rand=0 → -3; rand≈1 → +3.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  withRandomSeq([0, 0.999999, 0.999999, 0, 0, 0.999999, 0.999999, 0], () => {
    for (let i = 0; i < 4; i++) {
      const o = Effects.getShakeOffset(e);
      assert.ok(Math.abs(o.x) <= 3 && Math.abs(o.y) <= 3, `offset (${o.x}, ${o.y})`);
      minX = Math.min(minX, o.x); maxX = Math.max(maxX, o.x);
      minY = Math.min(minY, o.y); maxY = Math.max(maxY, o.y);
    }
  });
  assert.ok(minX < -2.99, `min x ${minX} never reached the -3 bound`);
  assert.ok(maxX > 2.99, `max x ${maxX} never reached the +3 bound`);
  assert.ok(minY < -2.99, `min y ${minY} never reached the -3 bound`);
  assert.ok(maxY > 2.99, `max y ${maxY} never reached the +3 bound`);
});
ok('getShakeOffset returns {0,0} when hitFlash == 0 or entity is null', () => {
  assert.deepEqual(Effects.getShakeOffset({ hitFlash: 0 }), { x: 0, y: 0 });
  assert.deepEqual(Effects.getShakeOffset(null), { x: 0, y: 0 });
});

console.log('reset');
ok('reset clears both overlays (no bleed between runs)', () => {
  Effects.heroDamaged();
  Effects.bigExplosion();
  Effects.reset();
  assert.equal(Effects.vignette, 0);
  assert.equal(Effects.screenFlash, 0);
});

console.log(`${passed} passed`);
