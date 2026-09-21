// Task 4.2 — node-based unit tests for the dust-cloud effect
// (js/effects/dustCloud.js, effects.md §20). Run: node js/test/dustCloud.test.js
// No DOM needed: the effect is a pure module spawning into the shared pool;
// render() is exercised with a recording stub context. Fixed dt = 1/60 per
// project convention. Math.random is stubbed with deterministic sequences
// (restored in finally) so spread/velocity/lifetime assertions are exact.

import { strict as assert } from 'node:assert';
import { dustCloud } from '../effects/dustCloud.js';
import { particles } from '../particles.js';
import { DUST_COLORS } from '../effects/palettes.js';
import { hasEffect, fireManual, fire, resetEffects, activeCount, updateEffects, drawEffects } from '../effects/index.js';
import '../effects/registry.js'; // side effect: registers the types

const DT = 1 / 60;
const EPS = 1e-9;
// Pool placement convention (particles.js): spawnOne places an item's TOP-LEFT
// at (launchX − SPARKLE_SIZE/2, launchY − SPARKLE_SIZE/2). So a puff's DOCUMENTED
// launch coordinate (the point dustCloud passes to spawnOne) recovers from the
// stored top-left via launchX = it.x + SPARKLE_SIZE/2. The pool keeps this
// constant private, so we mirror its single value here purely to undo that one
// offset — every assertion below is expressed against the documented launch x,
// never against the raw top-left pixel.
const SPARKLE_SIZE = 4; // px — mirrors particles.js' private SPARKLE_SIZE
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

console.log('spawning');
ok('spawns the declared particleCount puffs into the shared pool', () => {
  drainPool();
  const body = dustCloud({ x: 100, y: 100, particleCount: 5 });
  assert.equal(body.done, true, 'one-shot: done at fire time');
  assert.equal(particles.count, 5, `expected 5 live puffs, got ${particles.count}`);
});
ok('default particleCount is 6', () => {
  drainPool();
  dustCloud({ x: 0, y: 0 });
  assert.equal(particles.count, 6);
});
ok('particleCount 0 spawns nothing; negative clamps to 0', () => {
  drainPool();
  dustCloud({ x: 0, y: 0, particleCount: 0 });
  assert.equal(particles.count, 0);
  drainPool();
  dustCloud({ x: 0, y: 0, particleCount: -4 });
  assert.equal(particles.count, 0);
});
ok('cycles DUST_COLORS by index', () => {
  drainPool();
  dustCloud({ x: 0, y: 0, particleCount: 7 });
  const items = particles.activeItems;
  for (let i = 0; i < items.length; i++) {
    assert.equal(items[i].color, DUST_COLORS[i % DUST_COLORS.length], `item ${i} color`);
  }
});

console.log('cluster and velocity envelope');
ok('each puff speed is velocity * uniform[0.5,1] within the ±spread cluster', () => {
  drainPool();
  // Stub rand: each puff consumes EXACTLY 5 Math.random calls — dustCloud dx,
  // dustCloud angle, dustCloud speed, then spawnOne's Sparkle ctor (random
  // angle + random speed, both overridden by the directed vector). For 4 puffs
  // that's 20 draws; the sequence repeats [0.5, 0.5, 0.25, 0.5, 0.5] × 4 so
  // every puff gets: dx multiplier 2*0.5-1 = 0 (on point), angle multiplier
  // 2*0.5-1 = 0 (straight up), speed multiplier 0.5 + 0.25*0.5 = 0.625.
  withRandomSeq([0.5, 0.5, 0.25, 0.5, 0.5,
                 0.5, 0.5, 0.25, 0.5, 0.5,
                 0.5, 0.5, 0.25, 0.5, 0.5,
                 0.5, 0.5, 0.25, 0.5, 0.5], () => {
    dustCloud({ x: 50, y: 80, particleCount: 4, velocity: 60, spread: 12 });
  });
  const items = particles.activeItems;
  assert.equal(items.length, 4);
  for (const it of items) {
    const speed = Math.hypot(it.vx, it.vy);
    assert.ok(close(speed, 60 * 0.625), `speed ${speed}, expected ${60 * 0.625}`);
    // On-point launch (dx mult 0): spawned exactly at the contact x.
    assert.ok(close(it.x, 48), `x ${it.x}, expected 48 (contact 50 − half size)`);
    // Straight-up launch (angle mult 0): purely −y.
    assert.ok(close(it.vx, 0) && close(it.vy, -37.5), `v (${it.vx}, ${it.vy})`);
  }
});
ok('spread bounds: rand 0 → left edge, rand 1 → right edge of the cluster', () => {
  drainPool();
  // Verified draw order per puff (5 randoms each): dustCloud dx (5k+0),
  // dustCloud angle (5k+1), dustCloud speed (5k+2), then spawnOne's Sparkle
  // ctor consumes 2 more (angle 5k+3, speed 5k+4 — both overridden by the
  // directed vector). For 2 puffs that's 10 draws.
  // dx multiplier 2*rand-1: rand 0 → −spread; rand 0.999999 → ≈ +spread.
  withRandomSeq([0, 0.5, 0.5, 0.5, 0.5, 0.999999, 0.5, 0.5, 0.5, 0.5], () => {
    dustCloud({ x: 100, y: 0, particleCount: 2, velocity: 40, spread: 10 });
  });
  const items = particles.activeItems;
  // Assert the DOCUMENTED launch x (contactX + dx, dx ∈ ±spread), not the raw
  // top-left pixel. Recover launch x from the stored top-left by undoing the
  // pool's single placement offset (SPARKLE_SIZE/2):
  //   Puff 0: rand 0 → dx = −spread → launch x = 100 − 10 = 90 (left edge).
  assert.ok(close(items[0].x + SPARKLE_SIZE / 2, 90, 1e-9),
    `puff0 launch x ${items[0].x + SPARKLE_SIZE / 2}, expected contactX − spread = 90`);
  //   Puff 1: rand ≈ 1 → dx ≈ +spread → launch x ≈ 100 + 10 = 110 (right edge).
  // cos/sin leakage at the near-edge angles is covered by the documented 1e-3 tolerance.
  assert.ok(close(items[1].x + SPARKLE_SIZE / 2, 110, 1e-3),
    `puff1 launch x ${items[1].x + SPARKLE_SIZE / 2}, expected ~contactX + spread = 110`);
});
ok('zero velocity produces zero-speed puffs (purely clustered in place)', () => {
  drainPool();
  dustCloud({ x: 0, y: 0, particleCount: 3, velocity: 0 });
  for (const it of particles.activeItems) {
    assert.ok(close(Math.hypot(it.vx, it.vy), 0), 'no motion at zero velocity');
  }
});
ok('all puff speeds stay bounded by the declared velocity', () => {
  drainPool();
  dustCloud({ x: 0, y: 0, particleCount: 12, velocity: 50 });
  for (const it of particles.activeItems) {
    assert.ok(Math.hypot(it.vx, it.vy) <= 50 + EPS, `speed ${Math.hypot(it.vx, it.vy)} within velocity`);
  }
});

console.log('gravity, lifetime, opacity, size');
ok('per-puff gravity overrides the pool default (exact position after 2 frames)', () => {
  drainPool();
  // Launch rightward: seq [0.5, 0.5, 0.5] → dx mult 0, angle mult 0 → straight
  // up... use direction via angle param? No — angle is internal; instead use
  // velocity 0 and check gravity alone moves the puff down.
  withRandomSeq([0.5, 0.5, 0.5], () => {
    dustCloud({ x: 0, y: 0, particleCount: 1, velocity: 0, gravity: 600 });
  });
  const it = particles.activeItems[0];
  assert.ok(close(it.vx, 0) && close(it.vy, 0), `launch at rest (${it.vx}, ${it.vy})`);
  // Real pool integration order per frame: life cull, THEN vy += g*dt,
  // THEN x += vx*dt / y += vy*dt (gravity BEFORE integration). Assert DELTAS
  // from the captured start so the test is robust to the pool's origin
  // convention:
  //   Frame 1: vy = 600/60;        Δy += 600/3600
  //   Frame 2: vy = 1200/60;       Δy += 1200/3600
  //   Δy = 1800/3600 = 1/2
  const x0 = it.x, y0 = it.y;
  particles.updateAll(DT);
  particles.updateAll(DT);
  assert.ok(close(it.x - x0, 0), `Δx=${it.x - x0} (expected 0)`);
  assert.ok(close(it.y - y0, 1 / 2), `Δy=${it.y - y0} (g=600 applied before integration)`);
});
ok('default gravity is 0: puffs drift without settling', () => {
  drainPool();
  withRandomSeq([0.5, 0.5, 0.5], () => {
    dustCloud({ x: 0, y: 0, particleCount: 1, velocity: 0 });
  });
  const it = particles.activeItems[0];
  const y0 = it.y;
  particles.updateAll(DT);
  particles.updateAll(DT);
  assert.ok(close(it.y - y0, 0), `no vertical drift with default gravity (Δy=${it.y - y0})`);
});
ok('negative gravity floats puffs upward', () => {
  drainPool();
  withRandomSeq([0.5, 0.5, 0.5], () => {
    dustCloud({ x: 0, y: 0, particleCount: 1, velocity: 0, gravity: -300 });
  });
  const it = particles.activeItems[0];
  particles.updateAll(DT);
  assert.ok(it.y < 0, `floats up (y=${it.y})`);
});
ok('lifetime overrides the pool default: alive just before, dead just after', () => {
  drainPool();
  withRandomSeq([0.5, 0.5, 0.5], () => {
    dustCloud({ x: 0, y: 0, particleCount: 1, velocity: 0, lifetime: 0.2 });
  });
  const it = particles.activeItems[0];
  assert.ok(close(it.maxLife, 0.2), 'maxLife set from params');
  for (let i = 0; i < 11; i++) particles.updateAll(DT); // 11 frames ≈ 0.1833s
  assert.equal(it.alive, true, 'alive just before the lifetime boundary');
  particles.updateAll(DT); // frame 12 = 0.2s
  assert.equal(it.alive, false, 'dead at the lifetime boundary');
});
ok('size scales the drawn square (w/h set from params)', () => {
  drainPool();
  dustCloud({ x: 0, y: 0, particleCount: 2, size: 8 });
  for (const it of particles.activeItems) {
    assert.ok(close(it.w, 8) && close(it.h, 8), `size ${it.w}x${it.h}`);
  }
});

console.log('rendering');
/** Recording canvas stub (same shape as debris.test.js). */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    translate(...a) { calls.push(['translate', ...a]); },
    rotate(a) { calls.push(['rotate', a]); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
    set fillStyle(v) { calls.push(['style', v]); },
    get fillStyle() { return undefined; },
    fillRect(...a) { calls.push(['fillRect', ...a]); },
  };
}

ok('dustAlpha peak scales the fade: full at t=0, proportional mid-life, 0 at end', () => {
  drainPool();
  withRandomSeq([0.5, 0.5, 0.5], () => {
    dustCloud({ x: 10, y: 20, particleCount: 1, velocity: 0, opacity: 0.8, size: 5, lifetime: 0.2 });
  });
  const it = particles.activeItems[0];
  assert.ok(close(it.dustAlpha, 0.8), 'dustAlpha set from params');
  const ctx = makeCtx();
  it.draw(ctx);
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracketed');
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(close(alpha[1], 0.8), `peak alpha at t=0 (${alpha[1]}, expected 0.8)`);
  const fr = ctx.calls.find(c => c[0] === 'fillRect');
  // Unrotated plain-sparkle path: full-size square at its own x/y.
  assert.ok(close(fr[1], it.x) && close(fr[2], it.y) && close(fr[3], 5) && close(fr[4], 5), `rect ${fr.slice(1)}`);
  // Advance halfway: alpha = 0.8 · 0.5 = 0.4.
  for (let i = 0; i < 6; i++) particles.updateAll(DT); // 6 frames = 0.1s → p=0.5
  const ctx2 = makeCtx();
  it.draw(ctx2);
  const alpha2 = ctx2.calls.find(c => c[0] === 'alpha');
  assert.ok(close(alpha2[1], 0.4), `alpha at p=0.5 (${alpha2[1]}, expected 0.4)`);
});
ok('opacity clamps to [0,1]', () => {
  drainPool();
  withRandomSeq([0.5, 0.5, 0.5], () => {
    dustCloud({ x: 0, y: 0, particleCount: 1, velocity: 0, opacity: 1.7 });
  });
  assert.ok(close(particles.activeItems[0].dustAlpha, 1), 'clamped to 1');
  drainPool();
  withRandomSeq([0.5, 0.5, 0.5], () => {
    dustCloud({ x: 0, y: 0, particleCount: 1, velocity: 0, opacity: -0.5 });
  });
  assert.ok(close(particles.activeItems[0].dustAlpha, 0), 'clamped to 0');
});
ok('plain sparkles (no dustAlpha override) draw with legacy full-alpha fade', () => {
  drainPool();
  particles.spawnBurst(0, 0, 1);
  const it = particles.activeItems[0];
  assert.equal(it.dustAlpha, undefined, 'no dustAlpha on plain sparkles');
  const ctx = makeCtx();
  it.draw(ctx);
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(close(alpha[1], 1), `legacy full alpha at t=0 (${alpha[1]})`);
});
ok('draw is a no-op once the puff is dead', () => {
  drainPool();
  dustCloud({ x: 0, y: 0, particleCount: 1, velocity: 0, lifetime: 0.1 });
  const it = particles.activeItems[0];
  particles.updateAll(1); // far past lifetime
  assert.equal(it.alive, false);
  const ctx = makeCtx();
  it.draw(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once dead');
});

console.log('registration');
ok('"dust-cloud" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('dust-cloud'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'dust-cloud', params: { x: 10, y: 20, particleCount: 4 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'dust-cloud');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 0, 'one-shot: instance completes immediately, never enters the active set');
  resetEffects();
});
for (const trigger of ['stateChange', 'collision']) {
  ok(`attachable via carrier config on its trigger (${trigger})`, () => {
    resetEffects();
    drainPool();
    const carrier = {
      origin: () => ({ x: 10, y: 20 }),
      effects: [{ on: trigger, type: 'dust-cloud', params: { particleCount: 3 } }],
    };
    const spawned = fire(trigger, carrier);
    assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
    assert.equal(particles.count, 3, 'puffs spawned at the carrier origin');
    drainPool();
    resetEffects();
  });
}
ok('reads the carrier origin at fire time (params are the standalone fallback)', () => {
  resetEffects();
  drainPool();
  const carrier = {
    origin: () => ({ x: 500, y: 600 }),
    effects: [{ on: 'stateChange', type: 'dust-cloud', params: { x: 1, y: 2, particleCount: 1, velocity: 0, spread: 0 } }],
  };
  fire('stateChange', carrier);
  const it = particles.activeItems[0];
  // spawnOne places the item's top-left at origin − SPARKLE_SIZE/2 (2px), so
  // the puff's x/y are the origin offset by half the pool's default size.
  assert.ok(close(it.x, 498) && close(it.y, 598), `carrier origin wins (${it.x}, ${it.y})`);
  drainPool();
  resetEffects();
});
ok('end-to-end: fireManual → puffs live in the pool, pruned after lifetime', () => {
  resetEffects();
  drainPool();
  const inst = fireManual({ type: 'dust-cloud', params: { x: 30, y: 40, particleCount: 3, lifetime: 0.2 } });
  assert.ok(inst !== null, 'fired through the engine');
  assert.equal(particles.count, 3, 'three puffs live');
  for (let i = 0; i < 12; i++) { updateEffects(DT); particles.updateAll(DT); } // 0.2s
  assert.equal(particles.count, 0, 'all puffs pruned after their lifetime');
  const ctx = makeCtx();
  drawEffects(ctx, {});
  assert.equal(ctx.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('standalone theater demo driven only by params (null carrier, manual fire)', () => {
  // The debug theater fires effects explicitly with params alone — this must
  // work with a null carrier and produce a bounded, self-terminating run.
  resetEffects();
  drainPool();
  const inst = fireManual({ type: 'dust-cloud',
    params: { x: 160, y: 120, particleCount: 10, spread: 14, size: 6, velocity: 40,
              lifetime: 0.5, opacity: 0.7, gravity: 100 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  assert.equal(inst.done, true, 'one-shot completes at fire time');
  assert.equal(particles.count, 10, 'all 10 puffs spawned');
  // Every puff obeys the declared envelope: speed ≤ velocity, size 6,
  // clustered within ±spread of the contact x.
  for (const it of particles.activeItems) {
    assert.ok(Math.hypot(it.vx, it.vy) <= 40 + EPS, `speed ${Math.hypot(it.vx, it.vy)} within velocity`);
    assert.ok(close(it.w, 6) && close(it.h, 6), 'size honored');
    // Assert the DOCUMENTED launch x directly: dustCloud launches each puff at
    // contactX + dx with dx ∈ ±spread, and spawnOne places the item's top-left
    // at launchX − SPARKLE_SIZE/2. So launch x = it.x + SPARKLE_SIZE/2 must sit
    // within ±spread of the contact x (160) — no size-mismatch tolerance needed.
    const launchX = it.x + SPARKLE_SIZE / 2;
    assert.ok(Math.abs(launchX - 160) <= 14 + EPS, `launch x ${launchX} within ±spread of contact`);
  }
  // Self-terminating: the whole cloud is gone after its lifetime.
  let drew = 0;
  for (let i = 0; i < 30; i++) {
    particles.updateAll(DT); // 30 frames = 0.5s
    const ctx = makeCtx();
    for (const it of particles.activeItems) it.draw(ctx);
    if (ctx.calls.length > 0) drew++;
  }
  assert.equal(particles.count, 0, 'demo terminates: pool empty at the declared lifetime');
  assert.ok(drew >= 1, 'demo actually drew the puffs');
  drainPool();
  resetEffects();
});

console.log(`${passed} passed`);
