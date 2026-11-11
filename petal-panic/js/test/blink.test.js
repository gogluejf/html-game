// Unit tests for the plain blink effect (js/effects/blink.js, design §27).
// Run: node js/test/blink.test.js
// No DOM needed: render() is exercised with a recording stub context.
//
// The effect is a DUMB constant-rate on/off blink: given duration + cycles it
// plays N full on/off pairs spread evenly across that duration (self-timed),
// fading between alphaOn and alphaOff. No colors, no wash, no acceleration.
// Sibling to blinkTransition (accelerating, color frames) — different job.

import { strict as assert } from 'node:assert';
import { blink } from '../effects/blink.js';
import { hasEffect, fireManual, resetEffects, activeCount, drawEffects, updateEffects } from '../effects/index.js';
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

ok('update(dt) advances the self-timed clock; invalid dt ignored', () => {
  const fx = blink({ duration: 1 }, makeCarrier());
  fx.update(0.5);
  assert.equal(fx.done, false);
  fx.update(-1); fx.update(NaN); // ignored
  fx.update(0.6);
  assert.equal(fx.done, true); // 0.5 + 0.6 >= 1
});

ok('completes exactly when duration elapses', () => {
  const fx = blink({ duration: 0.6 }, makeCarrier());
  for (let i = 0; i < 35; i++) fx.update(1 / 60); // 35/60 = 0.583 < 0.6
  assert.equal(fx.done, false);
  fx.update(1 / 60); // 36/60 = 0.6
  assert.equal(fx.done, true);
});

// --- Blink semantics --------------------------------------------------------------
ok('t=0 → ON at alphaOn (default 0.8), one normal draw', () => {
  const ctx = makeCtx();
  const fx = blink({}, makeCarrier());
  fx.render(ctx);
  assert.deepEqual(alphas(ctx), [0.8]);
  assert.equal(draws(ctx).length, 1);
});

ok('mid-window OFF beat uses alphaOff (default 0.4)', () => {
  // duration 1s, 6 cycles → 12 beats of ~83ms. t=0.25 → beat 3 → OFF.
  const fx = blink({ duration: 1, cycles: 6 }, makeCarrier());
  fx.update(0.25);
  const ctx = makeCtx();
  fx.render(ctx);
  assert.deepEqual(alphas(ctx), [0.4]);
});

ok('final frame lands ON (visible when the blink ends)', () => {
  const fx = blink({ duration: 1, cycles: 6 }, makeCarrier());
  fx.update(0.999);
  const ctx = makeCtx();
  fx.render(ctx);
  assert.deepEqual(alphas(ctx), [0.8]);
});

ok('constant rate — beats are evenly spaced (no acceleration)', () => {
  // duration 1s, 6 cycles → 12 beats, each 1/12 s. Sample the middle of
  // each beat: even beats ON, odd OFF.
  const fx = blink({ duration: 1, cycles: 6 }, makeCarrier());
  const expect = (t, alpha) => {
    fx.update(0); // fresh instance per sample
    for (let i = 0; i < Math.round(t * 60); i++) fx.update(1 / 60);
    const ctx = makeCtx();
    fx.render(ctx);
    assert.deepEqual(alphas(ctx), [alpha], `t=${t}`);
  };
  const fresh = () => blink({ duration: 1, cycles: 6 }, makeCarrier());
  const check = (t, alpha) => {
    const f = fresh();
    for (let i = 0; i < Math.round(t * 60); i++) f.update(1 / 60);
    const ctx = makeCtx();
    f.render(ctx);
    assert.deepEqual(alphas(ctx), [alpha], `t=${t}`);
  };
  check(0.04, 0.8); // beat 0 (ON)
  check(0.12, 0.4); // beat 1 (OFF)
  check(0.20, 0.8); // beat 2 (ON)
  check(0.29, 0.4); // beat 3 (OFF)
  check(0.37, 0.8); // beat 4 (ON)
  check(0.45, 0.4); // beat 5 (OFF)
  check(0.54, 0.8); // beat 6 (ON)
  check(0.95, 0.8); // final beat (ON)
});

ok('cycles scales the flash count within the same duration', () => {
  // 2 cycles over 1s → 4 beats of 250ms: t=0.1 ON, t=0.3 OFF, t=0.6 ON.
  const check = (cycles, t, alpha) => {
    const f = blink({ duration: 1, cycles }, makeCarrier());
    for (let i = 0; i < Math.round(t * 60); i++) f.update(1 / 60);
    const ctx = makeCtx();
    f.render(ctx);
    assert.deepEqual(alphas(ctx), [alpha], `cycles=${cycles} t=${t}`);
  };
  check(2, 0.1, 0.8);  // beat 0 (ON)
  check(2, 0.3, 0.4);  // beat 1 (OFF)
  check(2, 0.6, 0.8);  // beat 2 (ON)
  check(2, 0.85, 0.8); // beat 3 — final beat forced ON
});

ok('custom alphaOn/alphaOff are honored', () => {
  const fx = blink({ alphaOn: 1, alphaOff: 0.1 }, makeCarrier());
  const ctxOn = makeCtx();
  fx.render(ctxOn);
  assert.deepEqual(alphas(ctxOn), [1]);
  const f2 = blink({ duration: 1, alphaOn: 1, alphaOff: 0.1 }, makeCarrier());
  f2.update(0.25);
  const ctxOff = makeCtx();
  f2.render(ctxOff);
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
ok('engine path: fireManual spawns an active instance, updateEffects steps it', () => {
  resetEffects();
  const inst = fireManual({ type: 'blink', params: { duration: 1, cycles: 6 } }, makeCarrier());
  assert.ok(inst);
  assert.equal(activeCount(), 1);
  for (let i = 0; i < 15; i++) updateEffects(1 / 60); // t = 0.25 → OFF beat
  const ctx = makeCtx();
  drawEffects(ctx, undefined, { space: 'world' });
  assert.deepEqual(alphas(ctx), [0.4]);
  resetEffects();
  assert.equal(activeCount(), 0);
});

console.log(`\n${passed} passed`);
