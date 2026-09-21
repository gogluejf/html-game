// Task 6.3 — node-based unit tests for the squash & stretch effect
// (js/effects/squashStretch.js, effects.md §19). Run: node js/test/squashStretch.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Determinism note: the X/Y multiplier ramps are fully deterministic (no
// Math.random) — each multiplier is a pure function of elapsed time and
// params (two eased windows: distort toward 1 + intensity·(target − 1), then
// recovery back to exactly 1.0), so assertions on the documented contract
// (neutral at rest, peak reached within the distort window, exact 1.0/1.0
// settle-back, delay + duration + recoveryDuration lifetime,
// carrier-attachability) are exact within epsilon. Assertions target the
// DOCUMENTED contract, not internal literals.

import { strict as assert } from 'node:assert';
import { squashStretch } from '../effects/squashStretch.js';
import {
  hasEffect, fireManual, fire, resetEffects, activeCount,
  updateEffects, drawEffects,
} from '../effects/index.js';
import '../effects/registry.js'; // side effect: registers the types

const DT = 1 / 60;
const EPS = 1e-9;
const close = (a, b, tol = EPS) => Math.abs(a - b) < tol;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Recording canvas stub: captures save/restore/fillRect and style writes. */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    fillRect(...a) { calls.push(['fill', ...a]); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
    set fillStyle(v) { calls.push(['style', v]); },
    get fillStyle() { return undefined; },
  };
}

/** Carrier with a world-space box (Entity contract). */
function makeCarrier(x, y, w, h) {
  return {
    worldBox() { return { x, y, w, h }; },
    origin() { return { x: x + w / 2, y: y + h / 2 }; },
    size() { return { w, h }; },
  };
}

console.log('lifetime');
ok('defaults: done exactly at the delay + duration + recoveryDuration boundary, not before', () => {
  const b = squashStretch({}); // defaults: 0 + 0.1 + 0.15 = 0.25s → 15 frames
  const frames = Math.round((0 + 0.1 + 0.15) / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the lifetime boundary');
});
ok('total lifetime == delay + duration + recoveryDuration EXACTLY (explicit values)', () => {
  const delay = 0.1, dur = 0.2, rec = 0.3; // total 0.6s → 36 frames at dt = 1/60
  const b = squashStretch({ delay, duration: dur, recoveryDuration: rec });
  const frames = Math.round((delay + dur + rec) / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the delay+duration+recovery boundary');
  assert.ok(close(b.elapsed, delay + dur + rec), `elapsed equals the declared total (${b.elapsed})`);
});
ok('update after done is a no-op (elapsed frozen)', () => {
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1 });
  b.complete();
  const e = b.elapsed;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
});
ok('sub-frame total (delay+duration+recovery <= dt): completes on first update, draws nothing', () => {
  // Degenerate config: total lifetime <= dt means the instance is pruned
  // before any frame renders (same convention as attackArc/groundWave).
  const b = squashStretch({ duration: 1 / 120, recoveryDuration: 1 / 120 }); // 1/60 s == dt
  assert.equal(b.done, false, 'not done before any update');
  b.update(DT);
  assert.equal(b.done, true, 'done after the first update');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done (pruned before rendering)');
});

console.log('distort-then-recover contract');
ok('both multipliers start neutral (1.0) at fire time', () => {
  const b = squashStretch({ xScale: 1.4, yScale: 0.6 });
  assert.ok(close(b.xScale(), 1), `x starts neutral (got ${b.xScale()})`);
  assert.ok(close(b.yScale(), 1), `y starts neutral (got ${b.yScale()})`);
});
ok('during the delay both multipliers stay pinned at 1.0', () => {
  const b = squashStretch({ delay: 0.2, duration: 0.1, recoveryDuration: 0.1, xScale: 1.4, yScale: 0.6 });
  for (let i = 0; i < 12; i++) b.update(DT); // t = delay
  assert.ok(close(b.xScale(), 1), `x still neutral at t=delay (got ${b.xScale()})`);
  assert.ok(close(b.yScale(), 1), `y still neutral at t=delay (got ${b.yScale()})`);
});
ok('non-uniform distortion: x moves one way while y moves the other (default landing pose)', () => {
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1, xScale: 1.4, yScale: 0.6 });
  let sawWideShort = false;
  const frames = Math.round((0.1 + 0.1) / DT);
  for (let f = 1; f <= frames; f++) {
    b.update(DT);
    if (b.done) break;
    if (b.xScale() > 1 + 1e-6 && b.yScale() < 1 - 1e-6) sawWideShort = true;
  }
  assert.ok(sawWideShort, 'sampled a frame where x is stretched wide AND y is squashed short');
});
ok('reaches the declared peak distortion (intensity 1.0 → exactly the declared targets)', () => {
  const xTarget = 1.5, yTarget = 0.5;
  const b = squashStretch({ duration: 0.2, recoveryDuration: 0.2, xScale: xTarget, yScale: yTarget, intensity: 1.0 });
  // Peak lands at the end of the distort window (t = delay + duration).
  const peakFrames = Math.round(0.2 / DT); // 12 frames
  for (let i = 0; i < peakFrames; i++) b.update(DT);
  assert.ok(close(b.xScale(), xTarget), `x reaches exactly the declared xScale at the peak (got ${b.xScale()})`);
  assert.ok(close(b.yScale(), yTarget), `y reaches exactly the declared yScale at the peak (got ${b.yScale()})`);
});
ok('the ramp is continuous across the distort→recovery boundary (no step at t = delay+duration)', () => {
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1, xScale: 1.4, yScale: 0.6 });
  const boundaryFrames = Math.round(0.1 / DT); // 6 frames = t = delay + duration
  for (let i = 0; i < boundaryFrames; i++) b.update(DT);
  const xb = b.xScale(), yb = b.yScale();
  assert.ok(close(xb, 1.4), `x at the boundary is the peak (got ${xb})`);
  assert.ok(close(yb, 0.6), `y at the boundary is the peak (got ${yb})`);
  // One frame into the recovery window: the multipliers must have DEPARTED from
  // the peaks along the recovery branch — a discontinuous jump would land far
  // off the eased recovery value. (The fixed-dt accumulator sits ~1e-17 just
  // before the boundary at the 6th update, so the first sampled recovery frame
  // is one full dt in.)
  b.update(DT);
  const e = 1 - (1 - DT / 0.1) ** 2; // easeOut of one frame into recovery
  assert.ok(close(b.xScale(), 1 + (1.4 - 1) * (1 - e), 1e-9), 'x follows the recovery branch continuously');
  assert.ok(close(b.yScale(), 1 + (0.6 - 1) * (1 - e), 1e-9), 'y follows the recovery branch continuously');
});
ok('settles back to EXACTLY 1.0 on BOTH axes at completion (recovery contract)', () => {
  const b = squashStretch({ delay: 0.05, duration: 0.1, recoveryDuration: 0.15, xScale: 1.6, yScale: 0.4 });
  const frames = Math.round((0.05 + 0.1 + 0.15) / DT); // 18 frames
  for (let i = 0; i < frames; i++) b.update(DT); // completion frame
  assert.equal(b.done, true, 'precondition: done');
  assert.ok(close(b.xScale(), 1), `terminal x multiplier == 1.0 exactly (got ${b.xScale()})`);
  assert.ok(close(b.yScale(), 1), `terminal y multiplier == 1.0 exactly (got ${b.yScale()})`);
});
ok('multipliers stay between neutral and the peak throughout (monotone out, monotone back)', () => {
  const xTarget = 1.5, yTarget = 0.5;
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1, xScale: xTarget, yScale: yTarget });
  const frames = Math.round((0.1 + 0.1) / DT);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let f = 0; f <= frames; f++) {
    if (f > 0) b.update(DT);
    if (b.done) break;
    const x = b.xScale(), y = b.yScale();
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  assert.ok(close(maxX, xTarget, 1e-6), `x never exceeds its peak (max ${maxX})`);
  assert.ok(close(minX, 1, 1e-6), `x never drops below neutral (min ${minX})`);
  assert.ok(close(minY, yTarget, 1e-6), `y never drops below its peak (min ${minY})`);
  assert.ok(close(maxY, 1, 1e-6), `y never exceeds neutral (max ${maxY})`);
});
ok('intensity scales how far the multipliers travel from neutral toward the targets', () => {
  const xTarget = 1.5, yTarget = 0.5;
  const half = squashStretch({ duration: 0.1, recoveryDuration: 0.1, xScale: xTarget, yScale: yTarget, intensity: 0.5 });
  const full = squashStretch({ duration: 0.1, recoveryDuration: 0.1, xScale: xTarget, yScale: yTarget, intensity: 1.0 });
  const peakFrames = Math.round(0.1 / DT);
  for (let i = 0; i < peakFrames; i++) { half.update(DT); full.update(DT); }
  // Half intensity travels half the distance from 1.0 toward the target.
  assert.ok(close(half.xScale(), 1 + 0.5 * (xTarget - 1)), `half-intensity x peak (got ${half.xScale()})`);
  assert.ok(close(full.xScale(), xTarget), 'full-intensity x peak hits the target');
  assert.ok(close(half.yScale(), 1 + 0.5 * (yTarget - 1)), `half-intensity y peak (got ${half.yScale()})`);
  assert.ok(close(full.yScale(), yTarget), 'full-intensity y peak hits the target');
});
ok('intensity 0 collapses the whole effect to neutral (degenerate but valid config)', () => {
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1, xScale: 1.5, yScale: 0.5, intensity: 0 });
  const frames = Math.round((0.1 + 0.1) / DT);
  for (let f = 0; f <= frames; f++) {
    if (f > 0) b.update(DT);
    if (b.done) break;
    assert.ok(close(b.xScale(), 1), `x stays neutral at frame ${f} (got ${b.xScale()})`);
    assert.ok(close(b.yScale(), 1), `y stays neutral at frame ${f} (got ${b.yScale()})`);
  }
});
ok('stretch-tall config (xScale < 1, yScale > 1) distorts the opposite way', () => {
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1, xScale: 0.6, yScale: 1.5 });
  let sawTallNarrow = false;
  const frames = Math.round((0.1 + 0.1) / DT);
  for (let f = 1; f <= frames; f++) {
    b.update(DT);
    if (b.done) break;
    if (b.xScale() < 1 - 1e-6 && b.yScale() > 1 + 1e-6) sawTallNarrow = true;
  }
  assert.ok(sawTallNarrow, 'sampled a frame where x narrows AND y stretches tall');
});
ok('non-positive duration/recoveryDuration fall back to named defaults (bounded, self-terminating)', () => {
  const b = squashStretch({ duration: -1, recoveryDuration: 0 });
  // Defaults: 0 + 0.1 + 0.15 = 0.25s → 15 frames.
  const frames = Math.round((0.1 + 0.15) / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done before the default boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the default lifetime');
});
ok('negative delay clamps to 0 (no negative hold)', () => {
  const b = squashStretch({ delay: -5, duration: 0.1, recoveryDuration: 0.1 });
  const frames = Math.round((0.1 + 0.1) / DT); // 12 frames
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done before the clamped boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the clamped lifetime');
});

console.log('rendering (standalone demo path)');
ok('draws the reference box centered on the sprite center, sized by EXACTLY xScale()/yScale()', () => {
  const carrier = makeCarrier(100, 200, 32, 48);
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1, xScale: 1.4, yScale: 0.6 }, carrier);
  b.update(DT);
  const sx = b.xScale(), sy = b.yScale(); // render() uses the queries ALONE
  const ctx = makeCtx();
  b.render(ctx);
  const fill = ctx.calls.find(c => c[0] === 'fill');
  const cx = 100 + 32 / 2, cy = 200 + 48 / 2;
  assert.ok(close(fill[1], cx - (32 * sx) / 2, 1e-9), `box left edge centered (got ${fill[1]})`);
  assert.ok(close(fill[2], cy - (48 * sy) / 2, 1e-9), `box top edge centered (got ${fill[2]})`);
  assert.ok(close(fill[3], 32 * sx, 1e-9), `width scaled by xScale() alone (got ${fill[3]}, want ${32 * sx})`);
  assert.ok(close(fill[4], 48 * sy, 1e-9), `height scaled by yScale() alone (got ${fill[4]}, want ${48 * sy})`);
  assert.ok(ctx.calls.some(c => c[0] === 'style' && c[1] === '#ffffff'), 'demo color recorded');
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
});
ok('demo box peaks at exactly w·xScale / h·yScale and returns to w / h across the lifetime', () => {
  const carrier = makeCarrier(0, 0, 20, 40);
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1, xScale: 1.5, yScale: 0.5 }, carrier);
  const frames = Math.round((0.1 + 0.1) / DT);
  let maxW = 0, minH = Infinity;
  for (let f = 0; f <= frames; f++) {
    if (f > 0) b.update(DT);
    if (b.done) break;
    const ctx = makeCtx();
    b.render(ctx);
    const fill = ctx.calls.find(c => c[0] === 'fill');
    if (fill) { maxW = Math.max(maxW, fill[3]); minH = Math.min(minH, fill[4]); }
  }
  assert.ok(close(maxW, 20 * 1.5, 1e-6), `max width == w·xScale (got ${maxW})`);
  assert.ok(close(minH, 40 * 0.5, 1e-6), `min height == h·yScale (got ${minH})`);
});
ok('draws nothing once done', () => {
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1 }, makeCarrier(0, 0, 10, 10));
  const frames = Math.round((0.1 + 0.1) / DT); // 12 frames
  for (let i = 0; i < frames; i++) b.update(DT);
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('reads the sprite box at DRAW time (tracks a moving carrier)', () => {
  let bx = 0, by = 0;
  const carrier = { worldBox() { return { x: bx, y: by, w: 20, h: 20 }; } };
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1 }, carrier);
  const ctx = makeCtx();
  b.render(ctx);
  let fill = ctx.calls.find(c => c[0] === 'fill');
  const sx0 = b.xScale();
  assert.ok(close(fill[1], 0 + 10 - (20 * sx0) / 2, 1e-9), 'first draw at initial position');
  bx = 50; by = 60;
  const ctx2 = makeCtx();
  b.render(ctx2);
  fill = ctx2.calls.find(c => c[0] === 'fill');
  const sx1 = b.xScale();
  assert.ok(close(fill[1], 50 + 10 - (20 * sx1) / 2, 1e-9), 'second draw tracks the new position');
});
ok('falls back to factory-time params.box when the carrier has no geometry accessors', () => {
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1, box: { x: 5, y: 6, w: 7, h: 8 } });
  const ctx = makeCtx();
  b.render(ctx);
  const fill = ctx.calls.find(c => c[0] === 'fill');
  const sx = b.xScale(), sy = b.yScale();
  assert.ok(close(fill[1], 5 + 3.5 - (7 * sx) / 2, 1e-9), 'params.box used for position');
  assert.ok(close(fill[3], 7 * sx, 1e-9), 'params.box used for width');
  assert.ok(close(fill[4], 8 * sy, 1e-9), 'params.box used for height');
});
ok('carrier without worldBox() but with origin()+size() derives the box from them', () => {
  const carrier = { origin: () => ({ x: 30, y: 40 }), size: () => ({ w: 12, h: 8 }) };
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1 }, carrier);
  const ctx = makeCtx();
  b.render(ctx);
  const fill = ctx.calls.find(c => c[0] === 'fill');
  const sx = b.xScale(), sy = b.yScale();
  assert.ok(close(fill[1], 30 - (12 * sx) / 2, 1e-9), 'origin-centered box left edge');
  assert.ok(close(fill[2], 40 - (8 * sy) / 2, 1e-9), 'origin-centered box top edge');
});

console.log('registration');
ok('"squash-stretch" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('squash-stretch'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'squash-stretch', params: { duration: 0.1, recoveryDuration: 0.1, box: { x: 0, y: 0, w: 16, h: 16 } } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'squash-stretch');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['stateChange', 'hitLanded']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      worldBox: () => ({ x: 0, y: 0, w: 16, h: 16 }),
      effects: [{ on: trigger, type: 'squash-stretch', params: { duration: 0.1, recoveryDuration: 0.1 } }],
    };
    const spawned = fire(trigger, carrier);
    assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
    assert.equal(activeCount(), 1, 'instance entered the active set');
    resetEffects();
  });
}
ok('attachable via a NON-ENTITY carrier shape (plain marker object) through fire()', () => {
  resetEffects();
  const marker = {
    kind: 'marker',
    origin: () => ({ x: 5, y: 100 }),
    size: () => ({ w: 10, h: 10 }),
    effects: [{ on: 'collision', type: 'squash-stretch', params: { duration: 0.1, recoveryDuration: 0.1 } }],
  };
  const spawned = fire('collision', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired a squash-stretch');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});

console.log('standalone theater demo');
ok('standalone demo driven only by params (null carrier) — draws AND self-terminates (bounded)', () => {
  // The debug theater fires effects explicitly with params alone and a null
  // carrier. This drives the REAL engine record/render path (fireManual →
  // updateEffects → drawEffects) with no internal-state mutation, proving the
  // effect renders purely from params and terminates on its own clock.
  resetEffects();
  const inst = fireManual({ type: 'squash-stretch',
    params: { duration: 0.2, recoveryDuration: 0.2, xScale: 1.5, yScale: 0.5, box: { x: 0, y: 100, w: 24, h: 24 } } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  const frames = Math.round((0.2 + 0.2) / DT); // 24 frames
  for (let i = 1; i <= frames; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'fill')) drew++;
  }
  assert.ok(drew >= 20, `demo actually drew most frames (drew ${drew}/${frames})`);
  assert.equal(body.done, true, 'demo self-terminated at delay + duration + recovery (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects distorts the box, settles, then prunes', () => {
  resetEffects();
  const carrier = { worldBox: () => ({ x: 10, y: 20, w: 30, h: 40 }) };
  const inst = fireManual({ type: 'squash-stretch', params: { duration: 0.15, recoveryDuration: 0.15, xScale: 1.5, yScale: 0.5 } }, carrier);
  assert.ok(inst !== null, 'fired through the engine');
  let drew = 0, maxW = 0, minH = Infinity;
  const frames = Math.round((0.15 + 0.15) / DT); // 18 frames
  for (let i = 1; i <= frames; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    const fill = ctx.calls.find(c => c[0] === 'fill');
    if (fill) {
      drew++;
      maxW = Math.max(maxW, fill[3]);
      minH = Math.min(minH, fill[4]);
    }
  }
  assert.ok(drew >= 15, `drew while active (drew ${drew}/${frames})`);
  assert.ok(close(maxW, 30 * 1.5, 1e-6), `max drawn width == w·xScale (got ${maxW})`);
  assert.ok(close(minH, 40 * 0.5, 1e-6), `min drawn height == h·yScale (got ${minH})`);
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('two-pass model: squash-stretch renders in the world pass, NOT the screen pass', () => {
  resetEffects();
  const inst = fireManual({ type: 'squash-stretch', params: { duration: 0.1, recoveryDuration: 0.1, box: { x: 0, y: 0, w: 8, h: 8 } } });
  assert.ok(inst !== null, 'fired through the engine');
  updateEffects(DT); // one frame: still active
  const worldCtx = makeCtx();
  drawEffects(worldCtx, undefined, { space: 'world' });
  assert.ok(worldCtx.calls.some(c => c[0] === 'fill'), 'world pass drew the distortion box');
  const screenCtx = makeCtx();
  drawEffects(screenCtx, { view: { w: 640, h: 480 } }, { space: 'screen' });
  assert.equal(screenCtx.calls.length, 0, 'screen pass must not draw a world-space effect');
  resetEffects();
});
ok('complete() force-completes (engine reset path)', () => {
  const b = squashStretch({ duration: 0.1, recoveryDuration: 0.1 }, makeCarrier(0, 0, 10, 10));
  assert.equal(b.done, false);
  b.complete();
  assert.equal(b.done, true);
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw after forced completion');
});

console.log(`${passed} passed`);
