// Task 4.1 — node-based unit tests for the debris effect (js/effects/debris.js,
// effects.md §3). Run: node js/test/debris.test.js
// No DOM needed: the effect is a pure module spawning into the shared pool;
// render() is exercised with a recording stub context. Fixed dt = 1/60 per
// project convention. Math.random is stubbed with deterministic sequences
// (restored in finally) so spread/gravity/lifetime assertions are exact.

import { strict as assert } from 'node:assert';
import { debris } from '../effects/debris.js';
import { particles } from '../particles.js';
import { FIRE_COLORS } from '../effects/palettes.js';
import { hasEffect, fireManual, fire, resetEffects, activeCount, updateEffects, drawEffects } from '../effects/index.js';
import '../effects/registry.js'; // side effect: registers the types

const DT = 1 / 60;
const EPS = 1e-9;
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
ok('spawns the declared fragmentCount fragments into the shared pool', () => {
  drainPool();
  const body = debris({ x: 100, y: 100, fragmentCount: 5 });
  assert.equal(body.done, true, 'one-shot: done at fire time');
  assert.equal(particles.count, 5, `expected 5 live fragments, got ${particles.count}`);
});
ok('default fragmentCount is 8', () => {
  drainPool();
  debris({ x: 0, y: 0 });
  assert.equal(particles.count, 8);
});
ok('fragmentCount 0 spawns nothing; negative clamps to 0', () => {
  drainPool();
  debris({ x: 0, y: 0, fragmentCount: 0 });
  assert.equal(particles.count, 0);
  drainPool();
  debris({ x: 0, y: 0, fragmentCount: -4 });
  assert.equal(particles.count, 0);
});
ok('cycles FIRE_COLORS by index', () => {
  drainPool();
  debris({ x: 0, y: 0, fragmentCount: 9 });
  const items = particles.activeItems;
  for (let i = 0; i < items.length; i++) {
    assert.equal(items[i].color, FIRE_COLORS[i % FIRE_COLORS.length], `item ${i} color`);
  }
});

console.log('velocity spread and direction');
ok('each fragment speed is velocity * uniform[0.5,1] within the scatter cone', () => {
  drainPool();
  // Stub rand: per fragment the draw order is angle first, then speed.
  // Sequence [0.5, 0.25] cycled → angle multiplier 2*0.5-1 = 0 (on-axis),
  // speed multiplier 0.5 + 0.25*0.5 = 0.625.
  withRandomSeq([0.5, 0.25], () => {
    debris({ x: 0, y: 0, fragmentCount: 4, velocity: 200, direction: 0, spread: Math.PI / 2 });
  });
  const items = particles.activeItems;
  assert.equal(items.length, 4);
  for (const it of items) {
    const speed = Math.hypot(it.vx, it.vy);
    assert.ok(close(speed, 200 * 0.625), `speed ${speed}, expected ${200 * 0.625}`);
    // On-axis launch (angle multiplier 0): purely +x.
    assert.ok(close(it.vy, 0), `vy ${it.vy}, expected 0 (on-axis)`);
    assert.ok(close(it.vx, 125), `vx ${it.vx}, expected 125`);
  }
});
ok('spread bounds: rand 0 → on-axis, rand 1 → direction+spread (cone edge)', () => {
  drainPool();
  // Verified draw order per fragment (4 randoms each): debris angle (4k+0),
  // debris speed (4k+1), then spawnOne's Sparkle ctor consumes 2 more
  // (angle 4k+2, speed 4k+3 — overridden by the debris velocity). For 2
  // fragments that's 8 draws: [a0, s0, a1', s1', a1, s1, a2', s2'].
  // angle multiplier 2*rand-1: rand 0 → -spread; speed multiplier
  // 0.5 + rand*0.5: rand 0.5 → 0.75.
  withRandomSeq([0, 0.5, 0.5, 0.5, 0.999999, 0.5, 0.5, 0.5], () => {
    debris({ x: 0, y: 0, fragmentCount: 2, velocity: 100, direction: 0, spread: Math.PI / 2 });
  });
  const items = particles.activeItems;
  // Fragment 0: angle = 0 + (-1)*(PI/2) = -PI/2, speed = 100*0.75 = 75
  //   → straight up (0,-75).
  assert.ok(close(items[0].vx, 0) && close(items[0].vy, -75), `frag0 (${items[0].vx}, ${items[0].vy})`);
  // Fragment 1: angle ≈ +PI/2, speed 75 → straight down (0,+75).
  // cos(+PI/2) ≈ 6e-17 leaks ~3.6e-15 into vx at this near-edge angle; the
  // documented 1e-3 tolerance covers that float leakage with headroom.
  assert.ok(close(items[1].vx, 0, 1e-3) && close(items[1].vy, 75), `frag1 (${items[1].vx}, ${items[1].vy})`);
});
ok('default direction is up with a full-circle spread', () => {
  drainPool();
  // rand 0.5 → angle multiplier 0 → exactly on the default axis (-PI/2).
  withRandomSeq([0.5, 0.5], () => {
    debris({ x: 0, y: 0, fragmentCount: 1 });
  });
  const it = particles.activeItems[0];
  assert.ok(close(it.vx, 0) && close(it.vy, -140 * 0.75), `default launch up (${it.vx}, ${it.vy})`);
});
ok('zero velocity produces zero-speed fragments', () => {
  drainPool();
  debris({ x: 0, y: 0, fragmentCount: 3, velocity: 0 });
  for (const it of particles.activeItems) {
    assert.ok(close(Math.hypot(it.vx, it.vy), 0), 'no motion at zero velocity');
  }
});

console.log('gravity, rotation, lifetime, size');
ok('per-fragment gravity overrides the pool default (exact position after 2 frames)', () => {
  drainPool();
  // Launch rightward: seq [0.5,0.5] → angle mult 0 (on-axis +x), speed mult
  // 0.5+0.5*0.5 = 0.75 → v0 = 120*0.75 = 90 px/s. No gravity param → the
  // per-fragment default of 400 px/s² applies (debrisGravity unset).
  withRandomSeq([0.5, 0.5], () => {
    debris({ x: 0, y: 0, fragmentCount: 1, velocity: 120, direction: 0, spread: 0 });
  });
  const it = particles.activeItems[0];
  assert.ok(close(it.vx, 90) && close(it.vy, 0), `launch (${it.vx}, ${it.vy})`);
  // Real pool integration order per frame: life cull, THEN vy += g*dt,
  // THEN x += vx*dt / y += vy*dt (gravity BEFORE integration).
  // spawnOne places the item at origin - SPARKLE_SIZE/2 = (-2,-2) for
  // cx=cy=0, size 4. Assert DELTAS from that captured start so the test is
  // robust to the pool's internal origin convention:
  //   Δx = 90*(2/60) = 3
  //   Frame 1: vy = 0 + 400/60;      Δy += 400/3600
  //   Frame 2: vy = 800/60;          Δy += 800/3600
  //   Δy = 1200/3600 = 1/3
  const x0 = it.x, y0 = it.y;
  particles.updateAll(DT);
  particles.updateAll(DT);
  assert.ok(close(it.x - x0, 3), `Δx=${it.x - x0} (expected 3)`);
  assert.ok(close(it.y - y0, 1 / 3), `Δy=${it.y - y0} (g=400 applied before integration)`);
});
ok('negative gravity floats fragments upward', () => {
  drainPool();
  withRandomSeq([0.5, 0.5], () => {
    debris({ x: 0, y: 0, fragmentCount: 1, velocity: 0, direction: 0, spread: 0, gravity: -300 });
  });
  const it = particles.activeItems[0];
  particles.updateAll(DT);
  assert.ok(it.y < 0, `floats up (y=${it.y})`);
});
ok('lifetime overrides the pool default: alive just before, dead just after', () => {
  drainPool();
  withRandomSeq([0.5, 0.5], () => {
    debris({ x: 0, y: 0, fragmentCount: 1, velocity: 0, lifetime: 0.2 });
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
  debris({ x: 0, y: 0, fragmentCount: 2, size: 8 });
  for (const it of particles.activeItems) {
    assert.ok(close(it.w, 8) && close(it.h, 8), `size ${it.w}x${it.h}`);
  }
});

console.log('rendering');
/** Recording canvas stub (same shape as impactStar.test.js). */
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

ok('rotating fragment draws a centered rotated square, shrinking toward end of life', () => {
  drainPool();
  withRandomSeq([0.5, 0.5], () => {
    debris({ x: 10, y: 20, fragmentCount: 1, velocity: 0, rotation: 6, size: 8, lifetime: 0.2 });
  });
  const it = particles.activeItems[0];
  const ctx = makeCtx();
  it.draw(ctx);
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracketed');
  const tr = ctx.calls.find(c => c[0] === 'translate');
  assert.ok(tr, 'translated to fragment center');
  const rot = ctx.calls.find(c => c[0] === 'rotate');
  assert.ok(rot && close(rot[1], 0), `rotation 0 at t=0 (${rot?.[1]})`);
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(close(alpha[1], 1), `full alpha at t=0 (${alpha[1]})`);
  const fr = ctx.calls.find(c => c[0] === 'fillRect');
  // Full-size square at t=0: 8x8 centered on origin.
  assert.ok(close(fr[1], -4) && close(fr[2], -4) && close(fr[3], 8) && close(fr[4], 8), `rect ${fr.slice(1)}`);
  // Advance halfway: spin advanced, square shrunk to half size, alpha 0.5.
  for (let i = 0; i < 6; i++) particles.updateAll(DT); // 6 frames = 0.1s → p=0.5
  const ctx2 = makeCtx();
  it.draw(ctx2);
  const rot2 = ctx2.calls.find(c => c[0] === 'rotate');
  assert.ok(close(rot2[1], 6 * 0.1), `spin advanced (${rot2[1]}, expected ${6 * 0.1})`);
  const alpha2 = ctx2.calls.find(c => c[0] === 'alpha');
  assert.ok(close(alpha2[1], 0.5), `alpha at p=0.5 (${alpha2[1]})`);
  const fr2 = ctx2.calls.find(c => c[0] === 'fillRect');
  assert.ok(close(fr2[3], 4) && close(fr2[4], 4), `shrunk rect ${fr2.slice(1)}`);
});
ok('plain sparkles (no debris override) draw unrotated exactly as before', () => {
  drainPool();
  particles.spawnBurst(0, 0, 1);
  const it = particles.activeItems[0];
  assert.equal(it.rot, undefined, 'no rot on plain sparkles');
  const ctx = makeCtx();
  it.draw(ctx);
  assert.ok(!ctx.calls.some(c => c[0] === 'rotate'), 'no rotate call');
  assert.ok(!ctx.calls.some(c => c[0] === 'translate'), 'no translate call');
  const fr = ctx.calls.find(c => c[0] === 'fillRect');
  assert.ok(close(fr[1], it.x) && close(fr[2], it.y) && close(fr[3], 4) && close(fr[4], 4), 'legacy fillRect(x,y,w,h)');
});
ok('draw is a no-op once the fragment is dead', () => {
  drainPool();
  debris({ x: 0, y: 0, fragmentCount: 1, velocity: 0, lifetime: 0.1 });
  const it = particles.activeItems[0];
  particles.updateAll(1); // far past lifetime
  assert.equal(it.alive, false);
  const ctx = makeCtx();
  it.draw(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once dead');
});

console.log('registration');
ok('"debris" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('debris'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'debris', params: { x: 10, y: 20, fragmentCount: 4 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'debris');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 0, 'one-shot: instance completes immediately, never enters the active set');
  resetEffects();
});
for (const trigger of ['death', 'explosion', 'collision']) {
  ok(`attachable via carrier config on its trigger (${trigger})`, () => {
    resetEffects();
    drainPool();
    const carrier = {
      origin: () => ({ x: 10, y: 20 }),
      effects: [{ on: trigger, type: 'debris', params: { fragmentCount: 3 } }],
    };
    const spawned = fire(trigger, carrier);
    assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
    assert.equal(particles.count, 3, 'fragments spawned at the carrier origin');
    drainPool();
    resetEffects();
  });
}
ok('reads the carrier origin at fire time (params are the standalone fallback)', () => {
  resetEffects();
  drainPool();
  const carrier = {
    origin: () => ({ x: 500, y: 600 }),
    effects: [{ on: 'death', type: 'debris', params: { x: 1, y: 2, fragmentCount: 1, velocity: 0 } }],
  };
  fire('death', carrier);
  const it = particles.activeItems[0];
  // spawnOne places the item's top-left at origin - SPARKLE_SIZE/2 (2px), so
  // the fragment's x/y are the origin offset by half the default size.
  assert.ok(close(it.x, 498) && close(it.y, 598), `carrier origin wins (${it.x}, ${it.y})`);
  drainPool();
  resetEffects();
});
ok('end-to-end: fireManual → fragments live in the pool, pruned after lifetime', () => {
  resetEffects();
  drainPool();
  const inst = fireManual({ type: 'debris', params: { x: 30, y: 40, fragmentCount: 3, lifetime: 0.2 } });
  assert.ok(inst !== null, 'fired through the engine');
  assert.equal(particles.count, 3, 'three fragments live');
  for (let i = 0; i < 12; i++) { updateEffects(DT); particles.updateAll(DT); } // 0.2s
  assert.equal(particles.count, 0, 'all fragments pruned after their lifetime');
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
  const inst = fireManual({ type: 'debris',
    params: { x: 160, y: 120, fragmentCount: 10, velocity: 220, direction: -Math.PI / 2,
              spread: Math.PI / 3, gravity: 500, rotation: 8, lifetime: 0.5, size: 6 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  assert.equal(inst.done, true, 'one-shot completes at fire time');
  assert.equal(particles.count, 10, 'all 10 fragments spawned');
  // Every fragment obeys the declared envelope: speed ≤ velocity, size 6.
  for (const it of particles.activeItems) {
    assert.ok(Math.hypot(it.vx, it.vy) <= 220 + EPS, `speed ${Math.hypot(it.vx, it.vy)} within velocity`);
    assert.ok(close(it.w, 6) && close(it.h, 6), 'size honored');
  }
  // Self-terminating: the whole burst is gone after its lifetime.
  let drew = 0;
  for (let i = 0; i < 30; i++) {
    particles.updateAll(DT); // 30 frames = 0.5s
    const ctx = makeCtx();
    for (const it of particles.activeItems) it.draw(ctx);
    if (ctx.calls.length > 0) drew++;
  }
  assert.equal(particles.count, 0, 'demo terminates: pool empty at the declared lifetime');
  assert.ok(drew >= 1, 'demo actually drew the fragments');
  drainPool();
  resetEffects();
});

console.log(`${passed} passed`);
