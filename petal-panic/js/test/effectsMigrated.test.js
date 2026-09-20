// Task 2.1 — node-based unit tests for the per-effect files under js/effects/.
// Run: node js/test/effectsMigrated.test.js
// No DOM needed: every effect file is a pure module (particles pool + params).
// Fixed dt = 1/60 per project convention.

import { strict as assert } from 'node:assert';
import { particles } from '../particles.js';
import { hitSparkle } from '../effects/hitSparkle.js';
import { deathSparkle } from '../effects/deathSparkle.js';
import { pickupPop } from '../effects/pickupPop.js';
import { explosion } from '../effects/explosion.js';
import { particleBurst } from '../effects/particleBurst.js';
import { vignette } from '../effects/vignette.js';
import { screenFlash } from '../effects/screenFlash.js';
import { spriteShake } from '../effects/spriteShake.js';

const DT = 1 / 60;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Drain the shared particle pool so a test can count spawns deterministically. */
function drainPool() {
  for (const s of particles.activeItems) s.alive = false;
  // Sparkles live SPARKLE_LIFETIME (0.5s); one full-lifetime step culls them.
  particles.updateAll(1);
}

console.log('hitSparkle');
ok('spawns 3-5 by default (old HIT_SPARKLE_COUNT roll)', () => {
  drainPool();
  const body = hitSparkle({ x: 100, y: 100 });
  assert.equal(body.done, true, 'one-shot: done at fire time');
  assert.ok(particles.count >= 3 && particles.count <= 5, `got ${particles.count}`);
});
ok('respects explicit count', () => {
  drainPool();
  hitSparkle({ x: 100, y: 100, count: 4 });
  assert.equal(particles.count, 4);
});
ok('cycles BLOOD_COLORS by index and stays within [60,140] px/s', () => {
  drainPool();
  hitSparkle({ x: 0, y: 0, count: 9 });
  const items = particles.activeItems;
  const BLOOD = ['#e74c3c', '#c0392b', '#ff6b6b'];
  assert.equal(items.length, 9);
  for (let i = 0; i < items.length; i++) {
    assert.equal(items[i].color, BLOOD[i % BLOOD.length], `item ${i} color`);
    const speed = Math.hypot(items[i].vx, items[i].vy);
    assert.ok(speed >= 60 && speed <= 140, `item ${i} speed ${speed}`);
  }
});

console.log('deathSparkle');
ok('count = max(4, round(8 + size*0.25)) via spawnBurst', () => {
  drainPool();
  deathSparkle({ x: 0, y: 0, size: 16 }); // → max(4, round(8+4)) = 12
  assert.equal(particles.count, 12);
  drainPool();
  deathSparkle({ x: 0, y: 0, size: 96 }); // → 32
  assert.equal(particles.count, 32);
  drainPool();
  deathSparkle({ x: 0, y: 0, size: 1 });  // → max(4, round(8.25)) = 8 (floor of the formula)
  assert.equal(particles.count, 8);
});

console.log('pickupPop');
ok('spawns exactly 8 in an even ring with the given color', () => {
  drainPool();
  const body = pickupPop({ x: 50, y: 50, color: '#ff00ff' });
  assert.equal(body.done, true);
  assert.equal(particles.count, 8);
  const items = particles.activeItems;
  for (let i = 0; i < items.length; i++) {
    assert.equal(items[i].color, '#ff00ff');
    const speed = Math.hypot(items[i].vx, items[i].vy);
    assert.ok(speed >= 100 && speed <= 180, `item ${i} speed ${speed}`);
    // Evenly spaced angles: item i points at (i/8)*2π.
    const expectedAngle = (i / 8) * Math.PI * 2;
    const actualAngle = Math.atan2(items[i].vy, items[i].vx);
    let diff = Math.abs(actualAngle - expectedAngle);
    diff = Math.min(diff, Math.PI * 2 - diff);
    assert.ok(diff < 1e-9, `item ${i} angle off by ${diff}`);
  }
});
ok('defaults color to #ffffff', () => {
  drainPool();
  pickupPop({ x: 0, y: 0 });
  assert.ok(particles.activeItems.every(s => s.color === '#ffffff'));
});

console.log('explosion');
ok('count = min(24, 12 + round(radius*0.15))', () => {
  drainPool();
  explosion({ x: 0, y: 0, radius: 20 });   // → 12 + round(3) = 15
  assert.equal(particles.count, 15);
  drainPool();
  explosion({ x: 0, y: 0, radius: 200 });  // → 24 (cap)
  assert.equal(particles.count, 24);
  drainPool();
  explosion({ x: 0, y: 0, radius: 100000 });// → 24 (cap)
  assert.equal(particles.count, 24);
});
ok('defaults to radius 60 (count 21), cycles FIRE_COLORS, speeds 120..210', () => {
  drainPool();
  const body = explosion({ x: 0, y: 0 });
  assert.equal(body.done, true);
  assert.equal(particles.count, 21);
  const FIRE = ['#e74c3c', '#f39c12', '#ff6ec7', '#ffffff'];
  const items = particles.activeItems;
  for (let i = 0; i < items.length; i++) {
    assert.equal(items[i].color, FIRE[i % FIRE.length], `item ${i} color`);
    const speed = Math.hypot(items[i].vx, items[i].vy);
    assert.ok(speed >= 120 && speed <= 120 + 60 * 1.5, `item ${i} speed ${speed}`);
  }
});

ok('caps at the pool size (no allocation)', () => {
  drainPool();
  explosion({ x: 0, y: 0, radius: 100000 });
  assert.ok(particles.count <= 50);
});

console.log('particleBurst');
ok('spawns the declared count via spawnBurst and reports done', () => {
  drainPool();
  const body = particleBurst({ x: 0, y: 0, count: 12 });
  assert.equal(body.done, true);
  assert.equal(particles.count, 12);
});
ok('defaults count to 6 (pool default)', () => {
  drainPool();
  particleBurst({ x: 0, y: 0 });
  assert.equal(particles.count, 6);
});

console.log('vignette');
ok('kicks to strength (clamped 0..1) and decays linearly over 0.5s', () => {
  const b = vignette({ viewW: 640, viewH: 480 });
  assert.equal(b.value, 1);
  for (let i = 0; i < 15; i++) b.update(DT); // 15 frames = 0.25s
  // Mid-decay: exactly half the 0.5s lifetime elapsed → value ≈ 0.5 (linear).
  const expectedMid = 1 - (1 / 0.5) * (15 * DT); // = 0.5
  assert.ok(Math.abs(b.value - expectedMid) < 1e-9, `mid-decay ${b.value} != ${expectedMid}`);
  assert.ok(Math.abs(b.value - 0.5) < 0.01, `got ${b.value}`);
  for (let i = 0; i < 18; i++) b.update(DT); // 0.3s more
  assert.equal(b.value, 0);
  assert.equal(b.done, true, 'reports done once fully faded');
});
ok('clamps strength above 1', () => {
  assert.equal(vignette({ strength: 99 }).value, 1);
});
ok('negative strength clamps to 0 → no render + done immediately', () => {
  const b = vignette({ strength: -3, viewW: 640, viewH: 480 });
  assert.equal(b.value, 0, 'negative strength collapses to 0');
  const calls = [];
  const ctx = { createRadialGradient() { throw new Error('should not draw'); }, save() { calls.push(1); }, restore() {}, fillRect() {} };
  b.render(ctx); // value 0 → guard returns before drawing
  assert.equal(calls.length, 0, 'no render at value 0');
  b.update(DT);
  assert.equal(b.done, true, 'marks done on first update');
});
ok('renders the radial gradient overlay while active', () => {
  const calls = [];
  const ctx = {
    createRadialGradient(...a) { calls.push(['grad', ...a]); return { addColorStop(stop, c) { calls.push(['stop', stop, c]); } }; },
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); },
    fillRect(...a) { calls.push(['fill', ...a]); },
    set fillStyle(v) { this._fs = v; }, get fillStyle() { return this._fs; },
  };
  const b = vignette({ viewW: 640, viewH: 480 });
  b.render(ctx);
  assert.deepEqual(calls[0], ['grad', 320, 240, Math.hypot(320, 240) * 0.45, 320, 240, Math.hypot(320, 240)]);
  assert.deepEqual(calls[1], ['stop', 0, 'rgba(180, 20, 20, 0)']);
  assert.deepEqual(calls[2], ['stop', 0.7, 'rgba(180, 20, 20, 0.15)']);
  assert.deepEqual(calls[3], ['stop', 1, 'rgba(150, 10, 10, 0.55)']);
  assert.ok(calls.some((c) => c[0] === 'fill' && c[1] === 0 && c[2] === 0 && c[3] === 640 && c[4] === 480), 'full-viewport fill recorded');
});
ok('does not render once done', () => {
  const calls = [];
  const ctx = { createRadialGradient() { throw new Error('should not draw'); }, save() { calls.push(1); }, restore() {}, fillRect() {} };
  const b = vignette({ viewW: 640, viewH: 480 });
  for (let i = 0; i < 30; i++) b.update(DT); // 0.5s → fully faded
  assert.equal(b.done, true);
  b.render(ctx); // no-op when done
  assert.equal(calls.length, 0);
});
ok('render prefers the DRAW-TIME view over stale factory-time params', () => {
  // Gate fix: a declaratively-fired overlay has no fire-time view context, so
  // its viewport must come from the draw-time renderCtx.view that drawEffects
  // hands every instance — NOT from factory-time params. Assert draw-time wins
  // even when factory-time params carry different (stale) dims.
  const calls = [];
  const ctx = {
    createRadialGradient(...a) { calls.push(['grad', ...a]); return { addColorStop() {} }; },
    save() {}, restore() {}, fillRect(...a) { calls.push(['fill', ...a]); },
    set fillStyle(v) {}, get fillStyle() { return undefined; },
  };
  const b = vignette({ viewW: 999, viewH: 777 }); // stale factory-time dims
  b.render(ctx, { view: { w: 1280, h: 720 } });   // authoritative draw-time dims
  const fill = calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [0, 0, 1280, 720], 'draw-time view wins');
  const grad = calls.find(c => c[0] === 'grad');
  assert.equal(grad[1], 640, 'gradient centered on draw-time width/2');
  assert.equal(grad[2], 360, 'gradient centered on draw-time height/2');
});
ok('falls back to factory-time params when draw-time view is absent', () => {
  const calls = [];
  const ctx = {
    createRadialGradient(...a) { calls.push(['grad', ...a]); return { addColorStop() {} }; },
    save() {}, restore() {}, fillRect(...a) { calls.push(['fill', ...a]); },
    set fillStyle(v) {}, get fillStyle() { return undefined; },
  };
  const b = vignette({ viewW: 640, viewH: 480 });
  b.render(ctx, {}); // no draw-time view → factory-time fallback
  const fill = calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [0, 0, 640, 480], 'factory-time fallback used');
});

console.log('screenFlash');
ok('kicks to strength and decays linearly over 0.15s', () => {
  const b = screenFlash({ viewW: 640, viewH: 480 });
  assert.equal(b.value, 1);
  for (let i = 0; i < 5; i++) b.update(DT);   // ~0.0833s
  assert.ok(Math.abs(b.value - (1 - (1 / 0.15) * (5 * DT))) < 0.01, `got ${b.value}`);
  for (let i = 0; i < 10; i++) b.update(DT);  // well past full fade
  assert.equal(b.value, 0);
  assert.equal(b.done, true);
});
ok('negative strength clamps to 0 → no render + done immediately', () => {
  const b = screenFlash({ strength: -1, viewW: 640, viewH: 480 });
  assert.equal(b.value, 0, 'negative strength collapses to 0');
  const calls = [];
  const ctx = { save() { calls.push(1); }, restore() {}, fillRect() {} };
  b.render(ctx); // value 0 → guard returns before drawing
  assert.equal(calls.length, 0, 'no render at value 0');
  b.update(DT);
  assert.equal(b.done, true, 'marks done on first update');
});
ok('renders a white viewport fill at globalAlpha = value', () => {
  const calls = [];
  const ctx = {
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    fillRect(...a) { calls.push(['fill', ...a]); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    set fillStyle(v) { calls.push(['style', v]); },
  };
  const b = screenFlash({ viewW: 640, viewH: 480 });
  b.update(DT); // value now 1 - (1/0.15)/60
  const expected = 1 - (1 / 0.15) * DT;
  b.render(ctx);
  assert.ok(calls.some((c) => c[0] === 'alpha' && Math.abs(c[1] - expected) < 1e-9), `alpha ~${expected} recorded`);
  assert.ok(calls.some((c) => c[0] === 'style' && c[1] === '#ffffff'));
  assert.ok(calls.some((c) => c[0] === 'fill' && c[1] === 0 && c[2] === 0 && c[3] === 640 && c[4] === 480));
});
ok('render prefers the DRAW-TIME view over stale factory-time params', () => {
  // Gate fix: a declaratively-fired overlay has no fire-time view context, so
  // its viewport must come from the draw-time renderCtx.view that drawEffects
  // hands every instance — NOT from factory-time params. Assert draw-time wins
  // even when factory-time params carry different (stale) dims.
  const calls = [];
  const ctx = {
    save() {}, restore() {}, fillRect(...a) { calls.push(['fill', ...a]); },
    set globalAlpha(v) {}, get globalAlpha() { return 1; },
    set fillStyle(v) {}, get fillStyle() { return undefined; },
  };
  const b = screenFlash({ viewW: 999, viewH: 777 }); // stale factory-time dims
  b.render(ctx, { view: { w: 1280, h: 720 } });      // authoritative draw-time dims
  const fill = calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [0, 0, 1280, 720], 'draw-time view wins');
});
ok('falls back to factory-time params when draw-time view is absent', () => {
  const calls = [];
  const ctx = {
    save() {}, restore() {}, fillRect(...a) { calls.push(['fill', ...a]); },
    set globalAlpha(v) {}, get globalAlpha() { return 1; },
    set fillStyle(v) {}, get fillStyle() { return undefined; },
  };
  const b = screenFlash({ viewW: 640, viewH: 480 });
  b.render(ctx, {}); // no draw-time view → factory-time fallback
  const fill = calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [0, 0, 640, 480], 'factory-time fallback used');
});

console.log('spriteShake');
ok('firing bumps carrier hitFlash up to 0.1 (keeps longer existing values)', () => {
  const e = { hitFlash: 0 };
  spriteShake({}, e);
  assert.ok(e.hitFlash >= 0.1);
  const e2 = { hitFlash: 0.3 };
  spriteShake({}, e2);
  assert.equal(e2.hitFlash, 0.3);
});
ok('getOffset stays within ±amount while flashing, else {0,0}', () => {
  const e = { hitFlash: 0.1 };
  const b = spriteShake({}, e);
  let sawNonZero = false;
  for (let i = 0; i < 50; i++) {
    const o = b.getOffset();
    assert.ok(Math.abs(o.x) <= 3 && Math.abs(o.y) <= 3, `offset (${o.x}, ${o.y})`);
    if (o.x !== 0 || o.y !== 0) sawNonZero = true;
  }
  assert.ok(sawNonZero, 'expected at least one non-zero offset in 50 rolls');
  e.hitFlash = 0;
  assert.deepEqual(b.getOffset(), { x: 0, y: 0 });
});
ok('handles null carrier (no throw, zero offsets)', () => {
  const b = spriteShake({});
  assert.deepEqual(b.getOffset(), { x: 0, y: 0 });
});
ok('respects custom amount param', () => {
  const e = { hitFlash: 0.1 };
  const b = spriteShake({ amount: 1 }, e);
  for (let i = 0; i < 50; i++) {
    const o = b.getOffset();
    assert.ok(Math.abs(o.x) <= 1 && Math.abs(o.y) <= 1);
  }
});
ok('complete() marks done (engine reset path)', () => {
  const b = spriteShake({}, { hitFlash: 0.1 });
  assert.equal(b.done, false);
  b.complete();
  assert.equal(b.done, true);
});
ok('update() reports done once carrier hitFlash fully decays', () => {
  const e = { hitFlash: 0 };
  const b = spriteShake({}, e); // firing bumps hitFlash to 0.1
  assert.equal(b.done, false, 'active while the flash is running');
  // Advance past the 0.1s hitFlash lifetime at fixed dt; the effect does not
  // own the countdown — the carrier does — so we decay it here to mirror the
  // engine step, then update() must notice the expiry and report done.
  for (let i = 0; i < 8; i++) { e.hitFlash = Math.max(0, e.hitFlash - DT); b.update(DT); }
  assert.ok(e.hitFlash <= 0, 'hitFlash expired');
  assert.equal(b.done, true, 'instance prunes itself when the flash ends');
});

console.log(`${passed} passed`);
