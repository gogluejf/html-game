// Unit tests for the invulnerability flicker effect (js/effects/invulnFlicker.js,
// design §27). Run: node js/test/invulnFlicker.test.js
// No DOM needed: render() is exercised with a recording stub context. The
// effect is EXTERNALLY clocked — setProgress(fraction) replaces update(dt).

import { strict as assert } from 'node:assert';
import { invulnFlicker } from '../effects/invulnFlicker.js';
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

// --- Registration -------------------------------------------------------------
ok('registered in the effect registry as "invuln-flicker"', () => {
  assert.ok(hasEffect('invuln-flicker'));
});

// --- Lifecycle ------------------------------------------------------------------
ok('instance starts active, not done', () => {
  const fx = invulnFlicker({ mode: 'hit' }, makeCarrier());
  assert.equal(fx.active, true);
  assert.equal(fx.done, false);
});

ok('complete() deactivates and marks done', () => {
  const fx = invulnFlicker({ mode: 'hit' }, makeCarrier());
  fx.complete();
  assert.equal(fx.done, true);
  assert.equal(fx.active, false);
});

ok('update(dt) is a no-op (externally clocked)', () => {
  const fx = invulnFlicker({ mode: 'hit' }, makeCarrier());
  fx.setProgress(0.5);
  fx.update(1 / 60); // must not throw or change state
  assert.equal(fx.done, false);
});

ok('setProgress clamps to [0,1]', () => {
  const fx = invulnFlicker({ mode: 'hit' }, makeCarrier());
  fx.setProgress(5); fx.render(makeCtx());
  fx.setProgress(-3); fx.render(makeCtx());
  assert.equal(fx.done, false);
});

// --- Hit mode: transparent blink -------------------------------------------------
ok('hit mode: frac=1 → ON alpha (default 0.8), one normal draw', () => {
  const ctx = makeCtx();
  const fx = invulnFlicker({ mode: 'hit' }, makeCarrier());
  fx.setProgress(1);
  fx.render(ctx);
  const alphas = ctx.ops.filter(o => o[0] === 'alpha').map(o => o[1]);
  assert.deepEqual(alphas, [0.8]);
  const draws = ctx.ops.filter(o => o[0] === 'drawImage');
  assert.equal(draws.length, 1);
});

ok('hit mode: mid-window OFF phase uses alphaOff (0.4)', () => {
  // cycles=6: floor(frac*6)%2===0 → on. frac=0.5 → floor(3)=3 → off.
  const ctx = makeCtx();
  const fx = invulnFlicker({ mode: 'hit' }, makeCarrier());
  fx.setProgress(0.5);
  fx.render(ctx);
  const alphas = ctx.ops.filter(o => o[0] === 'alpha').map(o => o[1]);
  assert.deepEqual(alphas, [0.4]);
});

ok('hit mode: last visible state lands at expiry (frac→0 is ON)', () => {
  // frac just above 0: floor(f*6) = 0 → even → ON. The sprite is VISIBLE
  // on the final frame of the window.
  const ctx = makeCtx();
  const fx = invulnFlicker({ mode: 'hit' }, makeCarrier());
  fx.setProgress(0.001);
  fx.render(ctx);
  const alphas = ctx.ops.filter(o => o[0] === 'alpha').map(o => o[1]);
  assert.deepEqual(alphas, [0.8]);
});

ok('hit mode: custom cycles/cycle count changes phase cadence', () => {
  const fx = invulnFlicker({ mode: 'hit', cycles: 2 }, makeCarrier());
  const ctxOn = makeCtx();   // frac=0.75 → floor(1.5)=1 → off for cycles=2
  fx.setProgress(0.75); fx.render(ctxOn);
  assert.deepEqual(ctxOn.ops.filter(o => o[0] === 'alpha').map(o => o[1]), [0.4]);
  const ctxOff = makeCtx();  // frac=0.9 → floor(1.8)=1 → off; frac=0.5 → floor(1)=1 → off... use 0.45 → 0 → on
  fx.setProgress(0.45); fx.render(ctxOff);
  assert.deepEqual(ctxOff.ops.filter(o => o[0] === 'alpha').map(o => o[1]), [0.8]);
});

// --- Powerup mode: fixed-rate multi-phase ---------------------------------------
ok('powerup mode: frac=1 starts at first phase (white tint @0.8)', () => {
  const ctx = makeCtx();
  const fx = invulnFlicker({ mode: 'powerup' }, makeCarrier());
  fx.setProgress(1);
  fx.render(ctx);
  // idx = floor(0 * ...) = 0 → white → tinted silhouette via fillRect fallback?
  // No: carrier has a frame but tintedImage needs a DOM → falls back to box.
  const alphas = ctx.ops.filter(o => o[0] === 'alpha').map(o => o[1]);
  assert.deepEqual(alphas, [0.8]);
  const fills = ctx.ops.filter(o => o[0] === 'fillRect');
  assert.equal(fills.length, 1);
});

ok('powerup mode: gone phase renders at alpha 0', () => {
  // Phase table: white,orange,white,black (idx 0-3), normal (4), gone (5).
  // At hz=12 there are 72 beats per cycle; idx = floor((1-frac)*72).
  // idx ∈ [5,11] → gone. Pick frac so idx=6: (1-frac) = 6/72 → frac = 66/72.
  const ctx = makeCtx();
  const fx = invulnFlicker({ mode: 'powerup' }, makeCarrier());
  fx.setProgress(66 / 72);
  fx.render(ctx);
  const alphas = ctx.ops.filter(o => o[0] === 'alpha').map(o => o[1]);
  assert.deepEqual(alphas, [0]);
});

ok('powerup mode: terminal beat forced visible at expiry', () => {
  // As frac → 0, idx = totalPhases-1 (the last beat). If that beat would be
  // 'gone', it is forced to 'normal' — never vanish exactly at expiry.
  const ctx = makeCtx();
  const fx = invulnFlicker({ mode: 'powerup' }, makeCarrier());
  fx.setProgress(0.0001);
  fx.render(ctx);
  const alphas = ctx.ops.filter(o => o[0] === 'alpha').map(o => o[1]);
  // 'normal' → no alpha write at all (full visibility).
  assert.notDeepEqual(alphas, [0]);
});

ok('powerup mode: fixed rate — same phase index at same elapsed fraction regardless of window', () => {
  // The phase math is a pure function of (1-frac)*hz*N: two windows of
  // different lengths show identical looks at equal remaining fractions.
  const a = makeCtx(), b = makeCtx();
  const fa = invulnFlicker({ mode: 'powerup' }, makeCarrier());
  const fb = invulnFlicker({ mode: 'powerup' }, makeCarrier());
  fa.setProgress(0.5); fa.render(a);
  fb.setProgress(0.5); fb.render(b);
  assert.deepEqual(
    a.ops.filter(o => o[0] === 'alpha'),
    b.ops.filter(o => o[0] === 'alpha'),
  );
});

ok('powerup mode: custom phases list is honored', () => {
  const phases = [{ name: 'black', dur: 100 }]; // single-beat cycle
  const ctx = makeCtx();
  const fx = invulnFlicker({ mode: 'powerup', phases, hz: 1 }, makeCarrier());
  fx.setProgress(0.5); // idx = floor(0.5*1*1)=0 → black
  fx.render(ctx);
  const fills = ctx.ops.filter(o => o[0] === 'fillRect');
  assert.equal(fills.length, 1);
});

// --- Fallbacks --------------------------------------------------------------------
ok('no carrier → render is a safe no-op', () => {
  const fx = invulnFlicker({ mode: 'hit' }, null);
  const ctx = makeCtx();
  fx.render(ctx);
  assert.equal(ctx.ops.length, 0);
});

ok('done instance renders nothing', () => {
  const fx = invulnFlicker({ mode: 'hit' }, makeCarrier());
  fx.complete();
  const ctx = makeCtx();
  fx.render(ctx);
  assert.equal(ctx.ops.length, 0);
});

ok('box fallback: carrier without spriteFrame tints the collision box', () => {
  const carrier = { worldBox: () => ({ x: 10, y: 20, w: 30, h: 40 }) };
  const fx = invulnFlicker({ mode: 'powerup' }, carrier);
  fx.setProgress(1);
  const ctx = makeCtx();
  fx.render(ctx);
  const fills = ctx.ops.filter(o => o[0] === 'fillRect');
  assert.equal(fills.length, 1);
  assert.deepEqual(fills[0].slice(1), [10, 20, 30, 40]);
});

// --- Engine integration ------------------------------------------------------------
ok('engine path: fireManual spawns an active instance', () => {
  resetEffects();
  const inst = fireManual({ type: 'invuln-flicker', params: { mode: 'hit' } }, makeCarrier());
  assert.ok(inst);
  assert.equal(activeCount(), 1);
  inst.body.setProgress(0.5);
  const ctx = makeCtx();
  drawEffects(ctx, undefined, { space: 'world' });
  const alphas = ctx.ops.filter(o => o[0] === 'alpha').map(o => o[1]);
  assert.deepEqual(alphas, [0.4]);
  resetEffects();
  assert.equal(activeCount(), 0);
});

console.log(`\n${passed} passed`);
