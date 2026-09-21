// Task 3.5 — node-based unit tests for the impact-star / hit-pop effect
// (js/effects/impactStar.js, effects.md §16). Run: node js/test/impactStar.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.

import { strict as assert } from 'node:assert';
import { impactStar } from '../effects/impactStar.js';
import { hasEffect, fireManual, fire, resetEffects, activeCount, updateEffects, drawEffects } from '../effects/index.js';
import '../effects/registry.js'; // side effect: registers the types

const DT = 1 / 60;
const EPS = 1e-9;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Recording canvas stub: captures transform/style writes and path calls. */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    translate(...a) { calls.push(['translate', ...a]); },
    rotate(a) { calls.push(['rotate', a]); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(...a) { calls.push(['moveTo', ...a]); },
    lineTo(...a) { calls.push(['lineTo', ...a]); },
    closePath() { calls.push(['closePath']); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
    set fillStyle(v) { calls.push(['style', v]); },
    get fillStyle() { return undefined; },
    set lineWidth(v) { calls.push(['width', v]); },
    get lineWidth() { return 1; },
    set lineCap(v) { calls.push(['cap', v]); },
    get lineCap() { return 'butt'; },
    set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    get strokeStyle() { return undefined; },
  };
}

/**
 * Shape signature: which path/terminal ops were issued (ignoring coordinates).
 * Captures the OBSERVABLE shape distinction between styles — e.g. star is a
 * closed filled path while burst is an open stroked path — without pinning
 * exact vertex counts or raw canvas coordinates.
 */
function shapeSig(calls) {
  return calls.filter(c => ['beginPath', 'closePath', 'fill', 'stroke'].includes(c[0]))
    .map(c => c[0]).join(',');
}

console.log('lifetime');
ok('defaults: duration 0.1s → done exactly at frame 6 (0.1s), not before', () => {
  const b = impactStar({});
  for (let i = 0; i < 5; i++) b.update(DT); // 5 frames ≈ 0.0833s
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT); // frame 6 = 0.1s
  assert.equal(b.done, true, 'done at the lifetime boundary');
});
ok('explicit duration is honored exactly (total lifetime == duration)', () => {
  const b = impactStar({ duration: 0.4 });
  for (let i = 0; i < 23; i++) b.update(DT); // 23 frames ≈ 0.3833s
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT); // frame 24 = 0.4s
  assert.equal(b.done, true, 'done at the lifetime boundary');
});
ok('update after done is a no-op (elapsed frozen)', () => {
  const b = impactStar({ duration: 0.1 });
  b.complete();
  const e = b.elapsed;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
});

console.log('rendering');
ok('draws nothing once done', () => {
  const b = impactStar({ x: 10, y: 20, duration: 0.1 });
  b.complete();
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('zero size or zero opacity draws nothing', () => {
  const zeroSize = impactStar({ size: 0, duration: 0.2 });
  const ctx1 = makeCtx();
  zeroSize.render(ctx1);
  assert.equal(ctx1.calls.length, 0, 'size 0 → no draw');
  const zeroOp = impactStar({ opacity: 0, duration: 0.2 });
  const ctx2 = makeCtx();
  zeroOp.render(ctx2);
  assert.equal(ctx2.calls.length, 0, 'opacity 0 → no draw');
});
ok('star style: full-size white star at t=0 at the params origin, save/restore bracketed', () => {
  const b = impactStar({ x: 100, y: 200, size: 20, rotation: Math.PI / 4, duration: 0.4 });
  const ctx = makeCtx();
  b.render(ctx);
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
  const tr = ctx.calls.find(c => c[0] === 'translate');
  assert.ok(Math.abs(tr[1] - 100) < EPS && Math.abs(tr[2] - 200) < EPS, `translated to impact point (${tr[1]}, ${tr[2]})`);
  const rot = ctx.calls.find(c => c[0] === 'rotate');
  assert.ok(Math.abs(rot[1] - Math.PI / 4) < EPS, 'rotation applied');
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(Math.abs(alpha[1] - 1) < EPS, `full alpha at t=0 (${alpha[1]})`);
  // Doc-conformance (effects.md §16): 'star' renders as a FILLED white shape.
  assert.ok(ctx.calls.some(c => c[0] === 'style' && c[1] === '#ffffff'), "doc §16: star color is #ffffff");
  // Shape contract: a closed, filled path (the star silhouette), distinct from burst.
  assert.equal(shapeSig(ctx.calls), 'beginPath,closePath,fill', 'star is a closed filled path');
});
ok('scales down and fades over the lifetime (linear curve: alpha = 1 - p)', () => {
  const b = impactStar({ x: 0, y: 0, size: 20, duration: 0.4, scaleCurve: 'linear' });
  for (let i = 0; i < 12; i++) b.update(DT); // 12 frames = 0.2s → p = 0.5
  const ctx = makeCtx();
  b.render(ctx);
  // Doc §16: alpha follows the documented linear curve at this sampled progress.
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(Math.abs(alpha[1] - 0.5) < EPS, `alpha at p=0.5 (${alpha[1]})`);
  // Scale contract: the shape is drawn smaller than its t=0 full size.
  const starFull = impactStar({ x: 0, y: 0, size: 20, duration: 0.4, scaleCurve: 'linear' });
  const ctxFull = makeCtx();
  starFull.render(ctxFull);
  const extent = (c) => Math.max(...c.filter(v => v[0] === 'moveTo' || v[0] === 'lineTo')
    .map(v => Math.hypot(v[1], v[2])));
  assert.ok(extent(ctx.calls) < extent(ctxFull.calls), 'shape scaled down from t=0');
});
ok('easeOut curve holds near-full early and shrinks fast late', () => {
  const b = impactStar({ size: 20, duration: 0.4, scaleCurve: 'easeOut' });
  for (let i = 0; i < 12; i++) b.update(DT); // p = 0.5 → (1-p)^2 = 0.25
  const ctx = makeCtx();
  b.render(ctx);
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(Math.abs(alpha[1] - 0.25) < EPS, `easeOut alpha at p=0.5 (${alpha[1]})`);
});
ok('easeIn curve starts small and grows toward the end', () => {
  const b = impactStar({ size: 20, duration: 0.4, scaleCurve: 'easeIn' });
  for (let i = 0; i < 12; i++) b.update(DT); // p = 0.5 → 1 - p^2 = 0.75
  const ctx = makeCtx();
  b.render(ctx);
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(Math.abs(alpha[1] - 0.75) < EPS, `easeIn alpha at p=0.5 (${alpha[1]})`);
});
ok('unknown scaleCurve falls back to linear', () => {
  const b = impactStar({ size: 20, duration: 0.4, scaleCurve: 'bogus' });
  for (let i = 0; i < 12; i++) b.update(DT); // p = 0.5 → 0.5
  const ctx = makeCtx();
  b.render(ctx);
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(Math.abs(alpha[1] - 0.5) < EPS, `fallback alpha (${alpha[1]})`);
});
ok('opacity param clamps above 1 and below 0', () => {
  const hi = impactStar({ opacity: 99, duration: 0.2 });
  const ctxHi = makeCtx();
  hi.render(ctxHi);
  assert.ok(Math.abs(ctxHi.calls.find(c => c[0] === 'alpha')[1] - 1) < EPS, 'clamped to 1');
  const neg = impactStar({ opacity: -3, duration: 0.2 });
  const ctxNeg = makeCtx();
  neg.render(ctxNeg);
  assert.equal(ctxNeg.calls.length, 0, 'negative opacity collapses to 0 → no draw');
});
ok('burst style draws radial spokes instead of a filled star', () => {
  const b = impactStar({ style: 'burst', size: 20, duration: 0.4 });
  const ctx = makeCtx();
  b.render(ctx);
  // Doc-conformance (effects.md §16): 'burst' renders as yellow stroked spokes.
  assert.ok(ctx.calls.some(c => c[0] === 'style' && c[1] === '#ffd93b'), "doc §16: burst color is #ffd93b");
  // Shape contract: an open, stroked path — observably distinct from the star's
  // closed filled silhouette (no closePath, no fill).
  assert.equal(shapeSig(ctx.calls), 'beginPath,stroke', 'burst is an open stroked path');
  assert.ok(!ctx.calls.some(c => c[0] === 'fill'), 'no fill in burst style');
});
ok('star and burst produce observably different canvas call sequences', () => {
  const ctxStar = makeCtx();
  impactStar({ style: 'star', size: 20, duration: 0.4 }).render(ctxStar);
  const ctxBurst = makeCtx();
  impactStar({ style: 'burst', size: 20, duration: 0.4 }).render(ctxBurst);
  // Shape distinction without pinning vertex counts: star closes+fills, burst strokes.
  assert.notEqual(shapeSig(ctxStar.calls), shapeSig(ctxBurst.calls), 'different path/terminal op sequences');
});
ok('reads the carrier origin at DRAW time (tracks a moving carrier)', () => {
  let ox = 0, oy = 0;
  const carrier = { origin() { return { x: ox, y: oy }; } };
  const b = impactStar({ x: 5, y: 6, duration: 0.4 }, carrier);
  const ctx1 = makeCtx();
  b.render(ctx1);
  let tr = ctx1.calls.find(c => c[0] === 'translate');
  assert.ok(Math.abs(tr[1] - 0) < EPS && Math.abs(tr[2] - 0) < EPS, 'carrier origin wins over params');
  ox = 50; oy = 60;
  const ctx2 = makeCtx();
  b.render(ctx2);
  tr = ctx2.calls.find(c => c[0] === 'translate');
  assert.ok(Math.abs(tr[1] - 50) < EPS && Math.abs(tr[2] - 60) < EPS, 'second draw tracks the new position');
});
ok('complete() force-completes (engine reset path)', () => {
  const b = impactStar({ duration: 0.4 });
  assert.equal(b.done, false);
  b.complete();
  assert.equal(b.done, true);
});

console.log('registration');
ok('"impact-star" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('impact-star'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'impact-star', params: { x: 10, y: 20, size: 16, duration: 0.2 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'impact-star');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['hitLanded', 'collision']) {
  ok(`attachable via carrier config on its trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      origin: () => ({ x: 10, y: 20 }),
      effects: [{ on: trigger, type: 'impact-star', params: { size: 14, duration: 0.15 } }],
    };
    const spawned = fire(trigger, carrier);
    assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
    assert.equal(activeCount(), 1, 'instance entered the active set');
    resetEffects();
  });
}
ok('end-to-end: fire → updateEffects → drawEffects pops at the impact origin', () => {
  // Proves the lifecycle contract through the real engine path.
  resetEffects();
  const inst = fireManual({ type: 'impact-star', params: { x: 30, y: 40, size: 20, duration: 0.4 } });
  assert.ok(inst !== null, 'fired through the engine');
  updateEffects(DT); // one frame: still active
  const ctx = makeCtx();
  drawEffects(ctx, {});
  const tr = ctx.calls.find(c => c[0] === 'translate');
  assert.ok(Math.abs(tr[1] - 30) < EPS && Math.abs(tr[2] - 40) < EPS, 'pops at the declared impact origin');
  // Advance past the lifetime: pruned from the active set, no further draws.
  for (let i = 0; i < 24; i++) updateEffects(DT);
  assert.equal(activeCount(), 0, 'pruned after lifetime');
  const ctx2 = makeCtx();
  drawEffects(ctx2, {});
  assert.equal(ctx2.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('standalone theater demo driven only by params (null carrier, manual fire)', () => {
  // The debug theater fires effects explicitly with params alone — this must
  // work with a null carrier and produce a full, bounded, self-terminating run.
  resetEffects();
  const inst = fireManual({ type: 'impact-star',
    params: { x: 160, y: 120, size: 18, duration: 0.2, rotation: 0.3, opacity: 0.9, style: 'star', scaleCurve: 'easeOut' } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  let drew = 0;
  for (let i = 0; i < 11; i++) {
    updateEffects(DT); // 0.2s = 12 frames
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.length > 0) drew++;
  }
  updateEffects(DT); // frame 12 = 0.2s → done
  assert.equal(inst.done, true, 'demo terminates at the declared duration');
  assert.ok(drew >= 1, 'demo actually drew the pop');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});

console.log(`${passed} passed`);
