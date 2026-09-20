// Task 2.2 — node-based end-to-end tests for the Effects.* compat shim
// (js/effects.js over the Effect Engine). Run: node js/test/effectsShim.test.js
// No DOM needed: mock canvas ctx + pure modules. Fixed dt = 1/60 per project
// convention. These exercise the shim's public surface exactly as
// systems/update.js and systems/render.js use it.

import { strict as assert } from 'node:assert';
import { Effects } from '../effects.js';
import { particles } from '../particles.js';

const DT = 1 / 60;

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

/** Minimal mock CanvasRenderingContext2D recording the calls drawOverlay issues. */
function mockCtx() {
  const calls = [];
  const grad = { addColorStop: (o, c) => calls.push(['grad.addColorStop', o, c]) };
  return {
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    fillRect: (x, y, w, h) => calls.push(['fillRect', x, y, w, h]),
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    get fillStyle() { return undefined; },
    set globalAlpha(v) { calls.push(['globalAlpha', v]); },
    get globalAlpha() { return 1; },
    createRadialGradient: (...a) => { calls.push(['createRadialGradient', ...a]); return grad; },
  };
}

console.log('Screen-space lifecycle through the shim (kick → step → read)');
ok('vignette ≈ 0.5 after 15 frames at fixed dt', () => {
  Effects.reset();
  Effects.heroDamaged(); // kicks to 1
  for (let i = 0; i < 15; i++) Effects.update(DT); // 15 * (1/60) = 0.25s of a 0.5s decay
  assert.ok(Math.abs(Effects.vignette - 0.5) < 1e-9, `got ${Effects.vignette}`);
});
ok('screenFlash decays linearly over ~0.15s', () => {
  Effects.reset();
  Effects.bigExplosion(); // kicks to 1
  for (let i = 0; i < 3; i++) Effects.update(DT); // 3 frames = 0.05s → 1 - 0.05/0.15
  assert.ok(Math.abs(Effects.screenFlash - (1 - (3 * DT) / 0.15)) < 1e-9, `got ${Effects.screenFlash}`);
  for (let i = 0; i < 10; i++) Effects.update(DT); // 13 frames total > 0.15s
  assert.equal(Effects.screenFlash, 0, 'flash fully faded');
});
ok('heroDamaged(0.2) while vignette is up never lowers it', () => {
  Effects.reset();
  Effects.heroDamaged(); // 1
  for (let i = 0; i < 10; i++) Effects.update(DT); // still well above 0.2
  const before = Effects.vignette;
  Effects.heroDamaged(0.2); // weaker hit mid-decay
  assert.equal(Effects.vignette, before, `weaker kick must not lower (${before})`);
});
ok('reset clears tracked overlays between runs', () => {
  Effects.heroDamaged();
  Effects.bigExplosion();
  Effects.reset();
  assert.equal(Effects.vignette, 0);
  assert.equal(Effects.screenFlash, 0);
});

console.log('drawOverlay issues real canvas calls via the engine path');
ok('vignette overlay issues gradient + fill on the viewport', () => {
  Effects.reset();
  Effects.heroDamaged();
  const ctx = mockCtx();
  Effects.drawOverlay(ctx, 960, 540);
  const kinds = ctx.calls.map(c => c[0]);
  assert.ok(kinds.includes('createRadialGradient'), 'expected a radial gradient');
  assert.ok(kinds.includes('fillRect'), 'expected a fillRect');
  const fill = ctx.calls.find(c => c[0] === 'fillRect');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [0, 0, 960, 540], 'fills the whole viewport');
});
ok('screen-flash overlay issues alpha + white fill on the viewport', () => {
  Effects.reset();
  Effects.bigExplosion();
  const ctx = mockCtx();
  Effects.drawOverlay(ctx, 960, 540);
  const kinds = ctx.calls.map(c => c[0]);
  assert.ok(kinds.includes('globalAlpha'), 'expected a globalAlpha set');
  const fill = ctx.calls.find(c => c[0] === 'fillRect');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [0, 0, 960, 540], 'fills the whole viewport');
  assert.ok(ctx.calls.some(c => c[0] === 'fillStyle' && c[1] === '#ffffff'), 'white flash color');
});
ok('both overlays render in one pass when both are active', () => {
  Effects.reset();
  Effects.heroDamaged();
  Effects.bigExplosion();
  const ctx = mockCtx();
  Effects.drawOverlay(ctx, 960, 540);
  const fills = ctx.calls.filter(c => c[0] === 'fillRect');
  assert.equal(fills.length, 2, `expected vignette + flash fills, got ${fills.length}`);
});
ok('no canvas calls when no overlay is active', () => {
  Effects.reset();
  const ctx = mockCtx();
  Effects.drawOverlay(ctx, 960, 540);
  assert.equal(ctx.calls.length, 0, `expected zero calls, got ${ctx.calls.length}`);
});

console.log('Particle pool advances exactly once per frame (shim does not double-step)');
ok('Effects.update(dt) leaves the particle pool untouched', () => {
  drainPool();
  Effects.spawnHitSparkles(100, 100, 4);
  const items = [...particles.activeItems];
  assert.ok(items.length >= 1, 'pool has live sparkles');
  const lifeBefore = items.map(s => s.life);
  Effects.update(DT); // shim step only
  assert.deepEqual(items.map(s => s.life), lifeBefore, 'shim update must not advance particles');
  particles.updateAll(DT); // the single owner of pool stepping
  assert.ok(items.every((s, i) => s.life < lifeBefore[i]), 'pool advanced by its own call site');
});

console.log('Shake constant is owned by spriteShake.js');
ok('getShakeOffset stays within ±SHAKE_AMT while flashing', () => {
  const e = { hitFlash: 0.1 };
  let sawNonZero = false;
  for (let i = 0; i < 50; i++) {
    const o = Effects.getShakeOffset(e);
    assert.ok(Math.abs(o.x) <= 3 && Math.abs(o.y) <= 3, `out of range: ${JSON.stringify(o)}`);
    if (o.x !== 0 || o.y !== 0) sawNonZero = true;
  }
  assert.ok(sawNonZero, 'expected at least one non-zero offset in 50 rolls');
});
ok('beginEnemyShake fires the engine type AND bumps hitFlash', () => {
  const e = { hitFlash: 0 };
  Effects.beginEnemyShake(e);
  assert.ok(e.hitFlash >= 0.1);
});

console.log(`${passed} passed`);
