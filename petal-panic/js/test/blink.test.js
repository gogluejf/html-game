// Unit tests for the plain blink effect (js/effects/blink.js, design §27).
// Run: node js/test/blink.test.js
// No DOM needed: render() is exercised with a recording stub context. The
// effect is EXTERNALLY clocked — setProgress(fraction) replaces update(dt).
//
// The effect is a DUMB constant-rate on/off blink: N even cycles of the real
// sprite across the whole window, fading between alphaOn and alphaOff. No
// colors, no wash, no acceleration. Sibling to blinkTransition (self-timed,
// accelerating, color frames) — different job, different file.

import { strict as assert } from 'node:assert';
import { blink } from '../effects/blink.js';
import { hasEffect, fireManual, resetEffects, activeCount, drawEffects } from '../effects/index.js';
import '../effects/registry.js'; // side effect: registers the types

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Recording canvas stub: captures globalAlpha writes + draw calls. */
function makeCtx() {
  const ops = [];
  return {
    ops,
    save() { ops.push(['save']); },
    restore() { ops.push(['restore']); },
    translate() {}, scale() {}, rotate() {},
    set globalAlpha(v) { ops.push(['alpha', v]); },
    get globalAlpha() { return this._a ?? 1; },
    fillRect(x, y, w, h) { ops.push(['fillRect', x, y, w, h]); },
    drawImage(img, ...rest) { ops.push(['drawImage', img && img.__tag, rest.length]); },
  };
}

/** Carrier with a fake sheet frame (FRAME mode). */
function makeCarrier() {
  const img = { __tag: 'frame', naturalWidth: 32, naturalHeight: 32 };
  return {
    spriteFrame: () => ({
      img, w: 32, h: 32, dx: -16, dy: -32, scale: 1,
      anchorX: 100, anchorY: 50, mirrorX: false, rotation: 0,
    }),
    worldBox: () => ({ x: 84, y: 18, w: 32, h: 64 }),
  };
}

const alphas = (ctx) => ctx.ops.filter(o => o[0] === 'alpha').map(o => o[1]);
const draws = (ctx) => ctx.ops.filter(o => o[0] === 'drawImage');

// --- Registration -------------------------------------------------------------
ok('registered in the effect registry as "blink"', () => {
  assert.ok(hasEffect('blink'));
});

// --- Lifecycle ------------------------------------------------------------------
ok('instance starts active, not done', () => {
  const fx = blink({}, makeCarrier());
  assert.equal(fx.active, true);
  assert.equal(fx.done, false);
});

ok('complete() deactivates and marks done', () => {
  const fx = blink({}, makeCarrier());
  fx.complete();
  assert.equal(fx.done, true);
  assert.equal(fx.active, false);
});

ok('update(dt) is a no-op (externally clocked)', () => {
  const fx = blink({}, makeCarrier());
  fx.setProgress(0.5);
  fx.update(1 / 60);
  assert.equal(fx.done, false);
});

ok('setProgress clamps to [0,1]', () => {
  const fx = blink({}, makeCarrier());
  fx.setProgress(5); fx.render(makeCtx());
  fx.setProgress(-3); fx.render(makeCtx());
  assert.equal(fx.done, false);
});

// --- Blink semantics --------------------------------------------------------------
ok('frac=1 → ON at alphaOn (default 0.8), one normal draw', () => {
  const ctx = makeCtx();
  const fx = blink({}, makeCarrier());
  fx.setProgress(1);
  fx.render(ctx);
  assert.deepEqual(alphas(ctx), [0.8]);
  assert.equal(draws(ctx).length, 1);
});

ok('mid-window OFF beat uses alphaOff (default 0.4)', () => {
  // cycles=6: idx = floor(0.5*6)=3 → odd → off.
  const ctx = makeCtx();
  const fx = blink({}, makeCarrier());
  fx.setProgress(0.5);
  fx.render(ctx);
  assert.deepEqual(alphas(ctx), [0.4]);
});

ok('tail of the window stays ON (visible when protection ends)', () => {
  // Terminal visibility: even cycles widen the final ON beat to frac < 1/6.
  const ctx = makeCtx();
  const fx = blink({}, makeCarrier());
  fx.setProgress(0.001);
  fx.render(ctx);
  assert.deepEqual(alphas(ctx), [0.8]);
});

ok('constant rate — beats are evenly spaced (no acceleration)', () => {
  // 6 cycles: each beat spans exactly 1/6 of the window.
  const fx = blink({ cycles: 6 }, makeCarrier());
  const expect = (frac, alpha) => {
    const ctx = makeCtx();
    fx.setProgress(frac);
    fx.render(ctx);
    assert.deepEqual(alphas(ctx), [alpha], `frac=${frac}`);
  };
  expect(0.95, 0.8); // beat 0 (ON)
  expect(0.80, 0.4); // beat 1 (OFF)
  expect(0.65, 0.8); // beat 2 (ON)
  expect(0.50, 0.4); // beat 3 (OFF)
  expect(0.32, 0.8); // beat 4 (ON)
  expect(0.18, 0.8); // terminal widened ON (frac < 1/6)
  expect(0.10, 0.8); // terminal widened ON
});

ok('custom cycles change the cadence', () => {
  const fx = blink({ cycles: 2 }, makeCarrier());
  // 2 cycles: beat 0 spans frac [0.5,1] (ON), beat 1 spans [0,0.5) — but
  // the terminal widening makes frac < 0.5 ON too, so use the upper half.
  const ctxOn = makeCtx();
  fx.setProgress(0.75); fx.render(ctxOn);
  assert.deepEqual(alphas(ctxOn), [0.8]);
  const ctxMid = makeCtx();
  fx.setProgress(0.6); fx.render(ctxMid);
  assert.deepEqual(alphas(ctxMid), [0.8]);
});

ok('odd cycles end on a natural ON beat (no widening needed)', () => {
  const fx = blink({ cycles: 3 }, makeCarrier());
  const ctx = makeCtx();
  fx.setProgress(0.001);
  fx.render(ctx);
  // idx = floor(0.999*3)=2 → even → ON naturally.
  assert.deepEqual(alphas(ctx), [0.8]);
});

ok('custom alphaOn/alphaOff are honored', () => {
  const fx = blink({ alphaOn: 1, alphaOff: 0.1 }, makeCarrier());
  const ctxOn = makeCtx();
  fx.setProgress(1); fx.render(ctxOn);
  assert.deepEqual(alphas(ctxOn), [1]);
  const ctxOff = makeCtx();
  fx.setProgress(0.5); fx.render(ctxOff);
  assert.deepEqual(alphas(ctxOff), [0.1]);
});

// --- Fallbacks --------------------------------------------------------------------
ok('no carrier → render is a safe no-op', () => {
  const fx = blink({}, null);
  const ctx = makeCtx();
  fx.render(ctx);
  assert.equal(ctx.ops.length, 0);
});

ok('done instance renders nothing', () => {
  const fx = blink({}, makeCarrier());
  fx.complete();
  const ctx = makeCtx();
  fx.render(ctx);
  assert.equal(ctx.ops.length, 0);
});

// --- Engine integration ------------------------------------------------------------
ok('engine path: fireManual spawns an active instance', () => {
  resetEffects();
  const inst = fireManual({ type: 'blink', params: {} }, makeCarrier());
  assert.ok(inst);
  assert.equal(activeCount(), 1);
  inst.body.setProgress(0.5);
  const ctx = makeCtx();
  drawEffects(ctx, undefined, { space: 'world' });
  assert.deepEqual(alphas(ctx), [0.4]);
  resetEffects();
  assert.equal(activeCount(), 0);
});

console.log(`\n${passed} passed`);
