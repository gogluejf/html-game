// Task 4.3 — node-based unit tests for the composite explosion burst
// (js/effects/compositeExplosion.js, effects.md §24). Run:
// node petal-panic/js/test/compositeExplosion.test.js
// No DOM needed: the compositor is a pure STATE effect that routes every child
// through the engine's single spawn path (fireManual from ./index.js), so each
// child enters the active set with its own lifecycle and pushes into the shared
// pool / screen-space overlay. Fixed dt = 1/60 per project convention.
// Math.random is stubbed with deterministic sequences (restored in finally) so
// position/timing assertions are exact.
//
// MEASURED per-spawn-tick draw order (instrumented before writing these stubs):
//   compositeExplosion per tick: posX (1), posY (1), size (1), then the CHILD
//   factory's own draws, then — if not the last child — ONE timing-jitter draw.
//   The drawn size value maps onto the child's SIZE param (CHILD_SIZE_KEY:
//   explosion→radius, debris→size, dust-cloud→size, particle-burst→size,
//   screen-flash→strength); it does NOT change particle count. Count comes
//   from `density` via CHILD_COUNT_KEY (explosion→count, debris→fragmentCount,
//   dust-cloud→particleCount, particle-burst→count; count = floor(density) —
//   density IS the absolute per-child count, not a multiplier). screen-flash
//   has no count key — density is a no-op there.
//   Child per-particle draws: explosion & debris = 4/particle (angle + speed in
//   the factory + Sparkle ctor's 2 consumed by spawnOne); dust-cloud = 5
//   (dx + angle + speed + Sparkle ctor's 2); particle-burst = 3/particle (color
//   pick + Sparkle ctor's 2, via spawnBurst); screen-flash = 0.
//   So total draws for N children of count c each:
//     explosion/debris:      N*(3 + 4c) + (N−1) jitters
//     dust-cloud:            N*(3 + 5c) + (N−1) jitters
//     particle-burst:        N*(3 + 3c) + (N−1) jitters
//     screen-flash:          N*3        + (N−1) jitters

import { strict as assert } from 'node:assert';
import { compositeExplosion } from '../effects/compositeExplosion.js';
import { particles, MAX_PARTICLES } from '../particles.js';
import { hasEffect, fireManual, fire, resetEffects, activeCount, activeInstances, updateEffects, drawEffects } from '../effects/index.js';
import '../effects/registry.js'; // side effect: registers the types

const DT = 1 / 60;
const EPS = 1e-9;
// Pool placement convention (particles.js): spawnOne places an item's TOP-LEFT
// at (launchX − SPARKLE_SIZE/2, launchY − SPARKLE_SIZE/2). Mirror the private
// constant to recover documented launch coordinates from stored top-left.
const SPARKLE_SIZE = 4;
const close = (a, b, tol = EPS) => Math.abs(a - b) < tol;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Drain the shared particle pool so a test can count spawns deterministically. */
function drainPool() {
  for (const s of particles.activeItems) s.life = 0;
  particles.updateAll(1);
}

/** Run fn with Math.random replaced by a sequence of [0,1) values (cycled). */
function withRandomSeq(values, fn) {
  const orig = Math.random;
  let i = 0;
  Math.random = () => values[i++ % values.length];
  try { return fn(); } finally { Math.random = orig; }
}

/** Drive a body through N fixed-dt frames, returning the body. */
function step(body, n) {
  for (let i = 0; i < n; i++) body.update(DT);
  return body;
}

console.log('spawning');
ok('fires the declared explosionCount children over the duration', () => {
  drainPool();
  // 3 explosion children, default density 1 → exactly 1 particle each.
  // Per tick: 2 pos + 1 size + 4·1 child = 7 draws; plus 2 timing jitters
  // between ticks → 7+1+7+1+7 = 23 draws. All 0.5 → midpoints everywhere.
  const seq = Array(23).fill(0.5);
  withRandomSeq(seq, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 3,
      spawnInterval: 0.5, timingVariance: 0.1, duration: 1.8 });
    step(body, 108); // 1.8s
  });
  assert.equal(particles.count, 3, `expected 3 live child particles, got ${particles.count}`);
});
ok('default explosionCount is 6 and all six fire within the default 2s lifetime', () => {
  drainPool();
  // Defaults: interval derived = 2/6 ≈ 0.3333s; 6 children × 1 particle each.
  // Draws: 6*7 + 5 jitters = 47. All 0.5 → zero jitter, exact periodicity.
  const seq = Array(47).fill(0.5);
  withRandomSeq(seq, () => {
    const body = compositeExplosion({ x: 0, y: 0 });
    step(body, 120); // 2.0s
  });
  assert.equal(particles.count, 6, `expected 6 live child particles, got ${particles.count}`);
});
ok('B-4: declared count still fires when accumulated positive jitter would push past duration', () => {
  drainPool();
  // 3 children, interval 0.5, timingVariance 0.2 (max +0.198), duration 1.6.
  // Every jitter draw is 0.99 → max positive jitter (+0.198) each tick.
  //   slot1 = 0.5 + 0.198 = 0.698  (< 1.6, no clamp)
  //   slot2 = 0.698 + 0.5 + 0.198 = 1.396  (< 1.6, no clamp)
  //   slot3 = 1.396 + 0.5 + 0.198 = 2.094  (> 1.6 — WOULD be dropped unclamped)
  // The B-4 jitter clamp bounds the third slot to exactly 1.6, so all 3 fire
  // inside the lifetime. Draws: 3*7 + 2 jitters = 23.
  const seq = Array(23).fill(0.99);
  let body;
  withRandomSeq(seq, () => {
    body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 3,
      spawnInterval: 0.5, timingVariance: 0.2, duration: 1.6 });
    step(body, 96); // 1.6s
  });
  assert.equal(body.done, true, 'lifetime completed');
  assert.equal(particles.count, 3, `all 3 children fired despite worst-case jitter (got ${particles.count})`);
});
ok('B-4: declared count still fires when the interval alone exceeds the budget', () => {
  drainPool();
  // 3 children, explicit interval 1.0, duration 1.8: naive schedule is
  // t=0, 1.0, 2.0 — the third lands PAST the 1.8s boundary. B-4 collapses the
  // tail so all 3 fire on/before the done-frame. Zero variance keeps the
  // first two slots exact. Draws: 3*7 + 2 jitters = 23.
  const seq = Array(23).fill(0.5);
  withRandomSeq(seq, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 3,
      spawnInterval: 1.0, timingVariance: 0, duration: 1.8 });
    step(body, 108); // 1.8s
  });
  assert.equal(particles.count, 3, `all 3 children fired despite interval > budget (got ${particles.count})`);
});
ok('pool exhaustion (soft cap) never breaks the lifetime contract', () => {
  // Fill the pool so every child factory call hits the soft cap and spawns
  // nothing; the compositor must still schedule exactly `count` ticks and
  // complete at the duration boundary.
  resetEffects();
  drainPool();
  for (let i = 0; i < MAX_PARTICLES; i++) particles.spawnOne(0, 0, '#fff', 0, 0);
  assert.equal(particles.count, MAX_PARTICLES, 'pool pre-filled to capacity');
  const body = compositeExplosion({ x: 0, y: 0, explosionCount: 3,
    spawnInterval: 0.5, duration: 1.8 });
  step(body, 107);
  assert.equal(body.done, false, 'still active before the boundary');
  body.update(DT); // frame 108 = 1.8s
  assert.equal(body.done, true, 'lifetime contract holds under exhaustion');
  assert.equal(particles.count, MAX_PARTICLES, 'no allocation past the cap');
  drainPool();
});
ok('explosionCount 0 fires nothing but still lives out the duration', () => {
  drainPool();
  const body = compositeExplosion({ x: 0, y: 0, explosionCount: 0, duration: 0.2 });
  assert.equal(body.done, false, 'not done at fire time');
  step(body, 11); // 11/60 < 0.2
  assert.equal(body.done, false, 'still active just before the boundary');
  body.update(DT); // frame 12 = 0.2s
  assert.equal(body.done, true, 'done at the duration boundary');
  assert.equal(particles.count, 0, 'no children spawned');
});
ok('negative explosionCount clamps to 0', () => {
  drainPool();
  const body = compositeExplosion({ x: 0, y: 0, explosionCount: -4, duration: 0.2 });
  step(body, 12);
  assert.equal(body.done, true);
  assert.equal(particles.count, 0, 'nothing spawned');
});

console.log('position variance');
ok('children land at DIFFERENT positions, each within ±radius of the center (B-7)', () => {
  drainPool();
  // 3 children. Per-child pos draws vary per axis so offsets differ; size
  // pinned by range [1,1] → 1 particle each. To observe the LAUNCH position
  // (not a physics-drifted one), capture each new particle right after its
  // child fires — before any pool step has moved it. Draws per tick: 2 pos +
  // 1 size + 4·1 child = 7, plus 1 jitter between ticks.
  // Per-child pos draws chosen so each child lands on a DISTINCT corner of the
  // ±radius square (offset = (rand*2−1)·radius):
  //   child 1 → (−20, +20)  [posX 0.25, posY 0.75]
  //   child 2 → (+20, −20)  [posX 0.75, posY 0.25]
  //   child 3 → (−20, −20)  [posX 0.25, posY 0.25]
  const posDraws = [[0.25, 0.75], [0.75, 0.25], [0.25, 0.25]];
  const seq = [];
  for (let c = 0; c < 3; c++) {
    seq.push(posDraws[c][0], posDraws[c][1], 0.5); // posX, posY, size (pinned)
    for (let p = 0; p < 4; p++) seq.push(0.5);     // 1 particle
    if (c < 2) seq.push(0.5);                      // jitter
  }
  const launches = [];
  withRandomSeq(seq, () => {
    const body = compositeExplosion({ x: 100, y: 200, radius: 40, explosionCount: 3,
      spawnInterval: 0.5, timingVariance: 0, childSizeRange: [1, 1], duration: 1.8 });
    let seen = 0;
    for (let f = 0; f < 108 && seen < 3; f++) {
      body.update(DT);
      // Capture newly-spawned particles at their exact launch coords (no
      // pool step yet this frame, so x/y are still the spawn point).
      while (seen < particles.count) {
        const it = particles.activeItems[seen];
        launches.push([it.x + SPARKLE_SIZE / 2, it.y + SPARKLE_SIZE / 2]);
        seen++;
      }
    }
  });
  assert.equal(launches.length, 3, `captured 3 launch points (got ${launches.length})`);
  const pts = new Set(launches.map(([x, y]) => `${x},${y}`));
  assert.equal(pts.size, 3, `children launched at distinct points (got ${pts.size} unique)`);
  for (const [lx, ly] of launches) {
    assert.ok(Math.abs(lx - 100) <= 40 + EPS, `x ${lx} within ±40 of center`);
    assert.ok(Math.abs(ly - 200) <= 40 + EPS, `y ${ly} within ±40 of center`);
  }
});
ok('every child stays inside the ±radius square (envelope check, unstubbed random)', () => {
  drainPool();
  // Real Math.random: whatever the draws are, offsets are mathematically
  // bounded by ±(posVariance·radius) — must hold for any sequence.
  const body = compositeExplosion({ x: 50, y: 50, radius: 30, explosionCount: 8,
    spawnInterval: 0.1, timingVariance: 0.05, duration: 1.0 });
  step(body, 60);
  assert.equal(body.done, true, 'burst ran out its full duration');
  assert.equal(particles.count, 8, `all 8 children fired (got ${particles.count})`);
  for (const it of particles.activeItems) {
    const lx = it.x + SPARKLE_SIZE / 2;
    const ly = it.y + SPARKLE_SIZE / 2;
    assert.ok(Math.abs(lx - 50) <= 30 + EPS, `x ${lx} within ±30 of center`);
    assert.ok(Math.abs(ly - 50) <= 30 + EPS, `y ${ly} within ±30 of center`);
  }
});
ok('posVariance < 1 clusters spawns tighter around the center', () => {
  drainPool();
  // rand 0.75 → offset multiplier +0.5 → +0.5·(posVariance·radius) = +10.
  const seq = Array(7).fill(0.75); // one child: 2 pos + 1 size + 4 child
  withRandomSeq(seq, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 40, posVariance: 0.5,
      explosionCount: 1, childSizeRange: [1, 1], duration: 0.2 });
    step(body, 12);
  });
  const it = particles.activeItems[0];
  const lx = it.x + SPARKLE_SIZE / 2;
  assert.ok(close(lx, 10), `clustered offset ${lx}, expected +10 (half of half-radius)`);
});

console.log('timing variance');
ok('jitter shifts the second spawn by ±timingVariance around the base interval', () => {
  drainPool();
  // 2 children, interval 0.5, timingVariance 0.1, 1 particle each.
  // Tick 1: 7 draws (pos .25/.75 → −10/+10, size .5, 4 child draws).
  // Jitter draw 0.9 → nextAt = 0.5 + (0.9*2−1)*0.1 = 0.58s.
  // Frame 34 = 34/60 ≈ 0.5667 < 0.58 → only child 1 fired.
  // Frame 35 = 35/60 ≈ 0.5833 ≥ 0.58 → child 2 fires.
  const seq = [0.25, 0.75, 0.5, 0.5, 0.5, 0.5, 0.5,   // child 1: 7 draws
               0.9,                                     // jitter
               0.25, 0.75, 0.5, 0.5, 0.5, 0.5, 0.5];    // child 2: 7 draws
  withRandomSeq(seq, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 2,
      spawnInterval: 0.5, timingVariance: 0.1, childSizeRange: [1, 1], duration: 1.2 });
    step(body, 34);
    assert.equal(particles.count, 1, `only child 1 by frame 34 (got ${particles.count})`);
    body.update(DT); // frame 35 = 0.5833s ≥ 0.58 → child 2 fires
    assert.equal(particles.count, 2, 'child 2 fires at the jittered time');
    step(body, 36); // run out the 1.2s duration
  });
  assert.equal(particles.count, 2);
});
ok('zero timingVariance gives exact periodic spawning', () => {
  drainPool();
  // 2 children at t=0 and t=0.5 exactly (interval 0.5, variance 0), 1 particle
  // each: 2*(2 pos + 1 size + 4 child) + 1 jitter = 15 draws.
  const seq = Array(15).fill(0.5);
  withRandomSeq(seq, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 2,
      spawnInterval: 0.5, timingVariance: 0, childSizeRange: [1, 1], duration: 1.0 });
    step(body, 29); // 29/60 < 0.5
    assert.equal(particles.count, 1, 'second child not yet due');
    body.update(DT); // frame 30 = exactly 0.5s
    assert.equal(particles.count, 2, 'second child fires exactly at the interval');
    step(body, 30);
  });
  assert.equal(particles.count, 2);
});

console.log('size vs density');
ok('childSizeRange maps onto the child SIZE param, NOT its count', () => {
  drainPool();
  // Default density 1 → each child gets count = floor(1) = 1 particle, no
  // matter how wide the size envelope is. A wide [8, 24] range must NOT
  // inflate the particle count (the stale model conflated size with count).
  // 2 children: 2*(3 + 4·1) + 1 jitter = 15 draws.
  const seq = Array(15).fill(0.5);
  withRandomSeq(seq, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 2,
      spawnInterval: 0.5, timingVariance: 0, childSizeRange: [8, 24], duration: 1.2 });
    step(body, 72);
  });
  assert.equal(particles.count, 2, `wide size range still yields 1 particle per child (got ${particles.count})`);
});
ok('density scales the child COUNT: 3 → 3, fractional 2.7 → floor → 2, default → 1', () => {
  drainPool();
  // density 3 → count = floor(3) = 3 particles. 1 child: 3 + 4·3 = 15 draws.
  const seq3 = Array(15).fill(0.5);
  withRandomSeq(seq3, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 1,
      density: 3, duration: 0.2 });
    step(body, 12);
  });
  assert.equal(particles.count, 3, `density 3 → 3 particles (got ${particles.count})`);
  drainPool();
  // density 2.7 → count = floor(2.7) = 2 particles. 1 child: 3 + 4·2 = 11 draws.
  const seqF = Array(11).fill(0.5);
  withRandomSeq(seqF, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 1,
      density: 2.7, duration: 0.2 });
    step(body, 12);
  });
  assert.equal(particles.count, 2, `density 2.7 → floor → 2 particles (got ${particles.count})`);
  drainPool();
  // default density 1 → 1 particle. 1 child: 3 + 4·1 = 7 draws.
  const seq1 = Array(7).fill(0.5);
  withRandomSeq(seq1, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 1,
      duration: 0.2 });
    step(body, 12);
  });
  assert.equal(particles.count, 1, `default density → 1 particle (got ${particles.count})`);
});

console.log('child types');
ok('childType "debris" dispatches via fireManual: fragments carry the rot override', () => {
  drainPool();
  // Debris children: density 2 → fragmentCount = 2. 1 child: 3 + 4·2 = 11 draws.
  const seq = Array(11).fill(0.5);
  withRandomSeq(seq, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 1,
      childType: 'debris', density: 2, duration: 0.2 });
    step(body, 12);
  });
  assert.equal(particles.count, 2, `two fragments (got ${particles.count})`);
  for (const it of particles.activeItems) {
    assert.notEqual(it.rot, undefined, 'debris fragments carry the spin override');
  }
});
ok('childType "particle-burst" dispatches via fireManual and honors size/density', () => {
  drainPool();
  // particle-burst (catalog #1) is a registered type with SIZE param 'size'
  // (ignored by the factory — spawnBurst uses its own random velocities) and
  // COUNT param 'count'. density 3 → count = floor(3) = 3 sparkles per child.
  // 1 child: 3 draws (pos, pos, size) + 3·3 child draws (color + Sparkle ctor×2)
  // = 3 + 9 = 12 draws; no trailing jitter (last child).
  const seq = Array(12).fill(0.5);
  withRandomSeq(seq, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 1,
      childType: 'particle-burst', density: 3, duration: 0.2 });
    step(body, 12);
  });
  assert.equal(particles.count, 3, `density 3 → 3 burst sparkles (got ${particles.count})`);
});
ok('childType "dust-cloud" dispatches via fireManual: puffs carry dustAlpha', () => {
  drainPool();
  // Dust children: density 2 → particleCount = 2. 1 child: 3 + 5·2 = 13 draws.
  const seq = Array(13).fill(0.5);
  withRandomSeq(seq, () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 1,
      childType: 'dust-cloud', density: 2, duration: 0.2 });
    step(body, 12);
  });
  assert.equal(particles.count, 2, `two puffs (got ${particles.count})`);
  for (const it of particles.activeItems) {
    assert.ok(close(it.dustAlpha, 0.8), 'dust puffs carry the alpha override');
  }
});
ok('childType "screen-flash" dispatches via fireManual: instance is observable in the active set', () => {
  resetEffects();
  drainPool();
  // Screen flash is a STATE overlay: it stays in the engine's active set for
  // its own ~0.15s decay. This proves the previously-discarded-body bug is
  // fixed — the child is routed through fireManual, not called directly.
  // 1 child: 3 draws (pos, pos, strength); no child draws, no trailing jitter.
  withRandomSeq([0.5, 0.5, 0.5], () => {
    const body = compositeExplosion({ x: 0, y: 0, radius: 20, explosionCount: 1,
      childType: 'screen-flash', childSizeRange: [0.4, 0.4], duration: 0.2 });
    step(body, 12);
  });
  const flashes = activeInstances().filter(i => i.type === 'screen-flash');
  assert.equal(flashes.length, 1, `one screen-flash instance active (got ${flashes.length})`);
  const inst = flashes[0];
  assert.equal(inst.body.space, 'screen', 'flash body is a screen-space overlay');
  assert.ok(close(inst.body.value, 0.4), `body.value == drawn strength (${inst.body.value})`);
  assert.equal(particles.count, 0, 'screen-flash spawns no pool particles');
  resetEffects();
});
ok('unknown childType is ignored per tick: no crash, no particles, warn surfaces the type', () => {
  drainPool();
  const warned = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warned.push(args.join(' ')); };
  try {
    const body = compositeExplosion({ x: 0, y: 0, explosionCount: 3,
      childType: 'does-not-exist', spawnInterval: 0.5, duration: 1.8 });
    step(body, 108);
    assert.equal(body.done, true, 'lifetime contract holds regardless');
    assert.equal(particles.count, 0, 'nothing spawned');
    assert.equal(warned.length, 3, `warned once per tick (got ${warned.length})`);
    for (const w of warned) {
      assert.ok(w.includes('does-not-exist'), `warning names the bad type: "${w}"`);
    }
  } finally { console.warn = origWarn; }
});

console.log('lifetime');
ok('done exactly when duration elapses (epsilon done-detection)', () => {
  const body = compositeExplosion({ x: 0, y: 0, explosionCount: 0, duration: 0.2 });
  step(body, 11); // 11/60 ≈ 0.1833s < 0.2
  assert.equal(body.done, false, 'alive just before the boundary');
  body.update(DT); // frame 12 = 0.2s (FP residue ~4.9e-17 absorbed by epsilon)
  assert.equal(body.done, true, 'done at the boundary');
});
ok('duration 0 completes immediately', () => {
  const body = compositeExplosion({ x: 0, y: 0, duration: 0 });
  body.update(DT);
  assert.equal(body.done, true);
});
ok('complete() force-completes early (resetEffects path)', () => {
  const body = compositeExplosion({ x: 0, y: 0, explosionCount: 4, duration: 2 });
  body.update(DT);
  assert.equal(body.done, false);
  body.complete();
  assert.equal(body.done, true, 'force-completed');
  body.update(DT); // further updates are no-ops
  assert.equal(body.done, true);
});

console.log('registration');
ok('"composite-explosion" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('composite-explosion'), 'type registered');
  resetEffects();
  drainPool();
  const inst = fireManual({ type: 'composite-explosion',
    params: { x: 0, y: 0, explosionCount: 2, spawnInterval: 0.5, duration: 1.2 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'composite-explosion');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'state effect: enters the active set');
  resetEffects();
});
for (const trigger of ['death', 'explosion']) {
  ok(`attachable via carrier config on its trigger (${trigger})`, () => {
    resetEffects();
    drainPool();
    const carrier = {
      origin: () => ({ x: 10, y: 20 }),
      effects: [{ on: trigger, type: 'composite-explosion',
        params: { explosionCount: 2, spawnInterval: 0.5, childSizeRange: [1, 1], duration: 1.2 } }],
    };
    const spawned = fire(trigger, carrier);
    assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
    assert.equal(activeCount(), 1, 'instance is active');
    // Run the full duration through the engine step. 2 children × 1 particle:
    // 2*7 + 1 jitter = 15 draws.
    const seq = Array(15).fill(0.5);
    withRandomSeq(seq, () => { for (let i = 0; i < 72; i++) updateEffects(DT); });
    assert.equal(particles.count, 2, 'both children fired while attached');
    drainPool();
    resetEffects();
  });
}
ok('reads the carrier origin at fire time (params are the standalone fallback)', () => {
  resetEffects();
  drainPool();
  const carrier = {
    origin: () => ({ x: 500, y: 600 }),
    effects: [{ on: 'death', type: 'composite-explosion',
      params: { x: 1, y: 2, explosionCount: 1, radius: 20, childSizeRange: [1, 1], duration: 0.2 } }],
  };
  fire('death', carrier);
  const seq = Array(7).fill(0.5); // offset 0 → child lands exactly on the center
  withRandomSeq(seq, () => { for (let i = 0; i < 12; i++) updateEffects(DT); });
  const it = particles.activeItems[0];
  const lx = it.x + SPARKLE_SIZE / 2;
  const ly = it.y + SPARKLE_SIZE / 2;
  assert.ok(close(lx, 500) && close(ly, 600), `carrier origin wins (${lx}, ${ly})`);
  drainPool();
  resetEffects();
});
ok('standalone theater demo driven only by params (null carrier, manual fire)', () => {
  // The debug theater fires effects explicitly with params alone — this must
  // work with a null carrier and produce a bounded, self-terminating run.
  resetEffects();
  drainPool();
  const inst = fireManual({ type: 'composite-explosion',
    params: { x: 160, y: 120, radius: 60, explosionCount: 6, spawnInterval: 0.3,
              timingVariance: 0.08, posVariance: 0.8, childType: 'explosion',
              childSizeRange: [6, 14], duration: 2 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  assert.equal(inst.done, false, 'active at fire time');
  // Bounded: never reports done before the declared duration.
  for (let i = 0; i < 119; i++) updateEffects(DT);
  assert.equal(inst.done, false, 'still active just before 2s');
  updateEffects(DT); // frame 120 = 2.0s
  assert.equal(inst.done, true, 'self-terminates exactly at duration');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  // B-8: the DECLARED number of children emitted (default density 1 → 1
  // particle each; childSizeRange [6,14] does NOT scale the count).
  assert.equal(particles.count, 6, `declared 6 children emitted (got ${particles.count})`);
  // Every child landed inside the declared envelope around (160, 120).
  const off = 0.8 * 60;
  for (const it of particles.activeItems) {
    const lx = it.x + SPARKLE_SIZE / 2;
    const ly = it.y + SPARKLE_SIZE / 2;
    assert.ok(Math.abs(lx - 160) <= off + EPS, `x ${lx} within ±${off}`);
    assert.ok(Math.abs(ly - 120) <= off + EPS, `y ${ly} within ±${off}`);
  }
  // Children are pool-owned: after their sparkles die the scene is clean.
  for (let i = 0; i < 60; i++) particles.updateAll(DT);
  assert.equal(particles.count, 0, 'all children pruned after their lifetimes');
  const ctx = makeCtx();
  drawEffects(ctx, {});
  assert.equal(ctx.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('render() is a no-op (pure compositor delegates to children)', () => {
  resetEffects();
  const body = compositeExplosion({ x: 0, y: 0, explosionCount: 1, duration: 0.2 });
  const ctx = makeCtx();
  body.render(ctx, {});
  assert.equal(ctx.calls.length, 0, 'compositor itself draws nothing');
  resetEffects();
});

/** Recording canvas stub (same shape as debris.test.js). */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    fillRect(...a) { calls.push(['fillRect', ...a]); },
  };
}

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
