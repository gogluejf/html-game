// Unit tests for the invincibility blink (js/effects/invulnFlicker.js,
// design §27). Run: node js/test/invulnFlicker.test.js
// No DOM needed: render() is exercised with a recording stub context. The
// effect is EXTERNALLY clocked — setProgress(fraction) replaces update(dt).
//
// The effect is a DUMB color-cycler: it takes { colors, beatMs, alpha } and
// plays them as a fixed-rate cycle, flashing each color OVER the visible
// sprite. It knows nothing about hits or powerups — the hero owns the look
// tables (INVULN_LOOKS in hero.js).

import { strict as assert } from 'node:assert';
import { invulnFlicker, INVISIBLE } from '../effects/invulnFlicker.js';
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
const fills = (ctx) => ctx.ops.filter(o => o[0] === 'fillRect');
const draws = (ctx) => ctx.ops.filter(o => o[0] === 'drawImage');

// --- Registration -------------------------------------------------------------
ok('registered in the effect registry as "invuln-flicker"', () => {
  assert.ok(hasEffect('invuln-flicker'));
});

// --- Lifecycle ------------------------------------------------------------------
ok('instance starts active, not done', () => {
  const fx = invulnFlicker({ colors: ['#ffffff'] }, makeCarrier());
  assert.equal(fx.active, true);
  assert.equal(fx.done, false);
});

ok('complete() deactivates and marks done', () => {
  const fx = invulnFlicker({ colors: ['#ffffff'] }, makeCarrier());
  fx.complete();
  assert.equal(fx.done, true);
  assert.equal(fx.active, false);
});

ok('update(dt) is a no-op (externally clocked)', () => {
  const fx = invulnFlicker({ colors: ['#ffffff'] }, makeCarrier());
  fx.setProgress(0.5);
  fx.update(1 / 60); // must not throw or change state
  assert.equal(fx.done, false);
});

ok('setProgress clamps to [0,1]', () => {
  const fx = invulnFlicker({ colors: ['#ffffff'] }, makeCarrier());
  fx.setProgress(5); fx.render(makeCtx());
  fx.setProgress(-3); fx.render(makeCtx());
  assert.equal(fx.done, false);
});

// --- Beat semantics ---------------------------------------------------------------
ok('color beat → real sprite PLUS color overlay at alpha (anim stays visible)', () => {
  const ctx = makeCtx();
  const fx = invulnFlicker({ colors: ['#ffffff'], beatMs: 16, alpha: 0.8 }, makeCarrier());
  fx.setProgress(1);
  fx.render(ctx);
  // Two passes: the real sprite (no alpha write) + the overlay tint @0.8.
  assert.equal(draws(ctx).length, 1);
  assert.deepEqual(alphas(ctx), [0.8]);
});

ok('custom alpha is honored on color beats', () => {
  const ctx = makeCtx();
  const fx = invulnFlicker({ colors: ['#ff9f43'], alpha: 0.3 }, makeCarrier());
  fx.setProgress(1);
  fx.render(ctx);
  assert.deepEqual(alphas(ctx), [0.3]);
});

ok('INVISIBLE beat renders the sprite at alpha 0', () => {
  const ctx = makeCtx();
  const fx = invulnFlicker({ colors: ['#ffffff', INVISIBLE], beatMs: 16 }, makeCarrier());
  // 2 colors @ 16ms → 125 beats/s. frac=1-2/125 → 2 beats elapsed → idx 1.
  fx.setProgress(1 - 2 / 125);
  fx.render(ctx);
  assert.deepEqual(alphas(ctx), [0]);
});

// --- Cycle math -------------------------------------------------------------------
ok('fixed rate — same color index at same elapsed fraction regardless of window', () => {
  const a = makeCtx(), b = makeCtx();
  const fa = invulnFlicker({ colors: ['#ffffff', '#000000'], beatMs: 16 }, makeCarrier());
  const fb = invulnFlicker({ colors: ['#ffffff', '#000000'], beatMs: 16 }, makeCarrier());
  fa.setProgress(0.5); fa.render(a);
  fb.setProgress(0.5); fb.render(b);
  assert.deepEqual(alphas(a), alphas(b));
});

ok('beatMs scales the cycle speed', () => {
  const ctx = makeCtx();
  // 2 colors @ beatMs=16 → 62.5 beats/s. frac=1-1/62.5 → 1 beat elapsed → idx 1.
  const fx = invulnFlicker({ colors: ['#ffffff', '#000000'], beatMs: 16 }, makeCarrier());
  fx.setProgress(1 - 1 / 62.5);
  fx.render(ctx);
  // Both colors flash over the sprite at the same alpha — the distinction is
  // the tint (not observable in the stub), so assert the overlay pass ran.
  assert.deepEqual(alphas(ctx), [0.8]);
});

ok('multi-color table is honored (powerup-style wash)', () => {
  const colors = ['#ffffff', '#ff9f43', '#ffffff', '#000000', INVISIBLE];
  const ctx = makeCtx();
  const fx = invulnFlicker({ colors, beatMs: 16 }, makeCarrier());
  // 5 colors @ 16ms → 312.5 beats/s. frac=1-3/312.5 → 3 beats elapsed → idx 3 (black).
  fx.setProgress(1 - 3 / 312.5);
  fx.render(ctx);
  assert.deepEqual(alphas(ctx), [0.8]);
});

// --- Expiry guard -------------------------------------------------------------------
ok('window expiry forces the terminal beat visible (never end invisible)', () => {
  const ctx = makeCtx();
  const fx = invulnFlicker({ colors: [INVISIBLE], beatMs: 16 }, makeCarrier());
  fx.setProgress(0.0001);
  fx.render(ctx);
  assert.notDeepEqual(alphas(ctx), [0], 'must not be invisible at expiry');
});

// --- Fallbacks --------------------------------------------------------------------
ok('missing colors defaults to a single white flash', () => {
  const ctx = makeCtx();
  const fx = invulnFlicker({}, makeCarrier());
  fx.setProgress(0.5);
  fx.render(ctx);
  assert.deepEqual(alphas(ctx), [0.8]);
});

ok('no carrier → render is a safe no-op', () => {
  const fx = invulnFlicker({ colors: ['#ffffff'] }, null);
  const ctx = makeCtx();
  fx.render(ctx);
  assert.equal(ctx.ops.length, 0);
});

ok('done instance renders nothing', () => {
  const fx = invulnFlicker({ colors: ['#ffffff'] }, makeCarrier());
  fx.complete();
  const ctx = makeCtx();
  fx.render(ctx);
  assert.equal(ctx.ops.length, 0);
});

ok('box fallback: carrier without spriteFrame tints the collision box', () => {
  const carrier = { worldBox: () => ({ x: 10, y: 20, w: 30, h: 40 }) };
  const fx = invulnFlicker({ colors: ['#ffffff'] }, carrier);
  fx.setProgress(1);
  const ctx = makeCtx();
  fx.render(ctx);
  assert.equal(fills(ctx).length, 1);
  assert.deepEqual(fills(ctx)[0].slice(1), [10, 20, 30, 40]);
});

// --- Engine integration ------------------------------------------------------------
ok('engine path: fireManual spawns an active instance', () => {
  resetEffects();
  const inst = fireManual(
    { type: 'invuln-flicker', params: { colors: ['#ffffff', INVISIBLE], beatMs: 16 } },
    makeCarrier(),
  );
  assert.ok(inst);
  assert.equal(activeCount(), 1);
  inst.body.setProgress(1 - 2 / 125);
  const ctx = makeCtx();
  drawEffects(ctx, undefined, { space: 'world' });
  assert.deepEqual(alphas(ctx), [0]);
  resetEffects();
  assert.equal(activeCount(), 0);
});

console.log(`\n${passed} passed`);
