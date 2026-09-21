// Task 6.2 — node-based unit tests for the scale / pulse effect
// (js/effects/scalePulse.js, effects.md §18). Run: node js/test/scalePulse.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Determinism note: the scale ramp is fully deterministic (no Math.random) —
// the multiplier is a pure function of elapsed time and params
// (minScale + span·(1 − cos(phase))/2, phase = 2π · frequency · (t − delay)),
// so assertions on the documented contract (declared bounds, declared pulse
// frequency, delay + loopCount·(1/pulseFrequency) lifetime, settle-back-to-
// minScale terminal value, carrier-attachability) are exact within epsilon.
// Assertions target the DOCUMENTED contract, not internal literals.

import { strict as assert } from 'node:assert';
import { scalePulse } from '../effects/scalePulse.js';
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
ok('defaults: done exactly at the delay + loopCount·(1/pulseFrequency) boundary, not before', () => {
  const b = scalePulse({}); // defaults: delay 0, freq 1, loops 3 → 3s → 180 frames
  const frames = Math.round((0 + 3 * (1 / 1)) / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the lifetime boundary');
});
ok('total lifetime == delay + loopCount·(1/pulseFrequency) EXACTLY (explicit values)', () => {
  const delay = 0.1, freq = 2, loops = 4; // total 0.1 + 4·(1/2) = 2.1s → 126 frames at dt = 1/60
  const b = scalePulse({ delay, pulseFrequency: freq, loopCount: loops });
  const frames = Math.round((delay + loops * (1 / freq)) / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the delay+loopCount·(1/freq) boundary');
  assert.ok(close(b.elapsed, delay + loops * (1 / freq)), `elapsed equals the declared total (${b.elapsed})`);
});
ok('duration param is redundant: it does NOT affect the lifetime (ignored at runtime)', () => {
  // Same timing knobs, wildly different `duration` values → identical completion frame.
  const a = scalePulse({ pulseFrequency: 2, loopCount: 1, duration: 0.05 });
  const b = scalePulse({ pulseFrequency: 2, loopCount: 1, duration: 99 });
  const frames = Math.round((1 * (1 / 2)) / DT); // 30 frames
  for (let i = 0; i < frames; i++) { a.update(DT); b.update(DT); }
  assert.equal(a.done, true, 'instance A done at the loopCount-derived lifetime');
  assert.equal(b.done, true, 'instance B done at the SAME lifetime despite duration=99');
  assert.ok(close(a.elapsed, b.elapsed), 'both clocks advanced identically');
});
ok('update after done is a no-op (elapsed frozen)', () => {
  const b = scalePulse({ pulseFrequency: 2, loopCount: 1 });
  b.complete();
  const e = b.elapsed;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
});
ok('sub-frame total (delay+loopCount·(1/freq) <= dt): completes on first update, draws nothing', () => {
  // Degenerate config: total lifetime <= dt means the instance is pruned
  // before any frame renders (same convention as attackArc/groundWave).
  const b = scalePulse({ pulseFrequency: 120, loopCount: 1 }); // 1/120 s < dt
  assert.equal(b.done, false, 'not done before any update');
  b.update(DT);
  assert.equal(b.done, true, 'done after the first update');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done (pruned before rendering)');
});

console.log('ramp contract');
ok('during the delay the multiplier stays pinned at startScale', () => {
  const delay = 0.2, freq = 1, start = 1.0;
  const b = scalePulse({ delay, pulseFrequency: freq, startScale: start, maxScale: 1.5, minScale: 0.5 });
  for (let i = 0; i < 12; i++) b.update(DT); // t = delay
  assert.ok(close(b.scale(), start), `multiplier still startScale at t=delay (got ${b.scale()})`);
});
ok('at t = delay the multiplier is exactly startScale and one frame later it is inside the band moving toward maxScale', () => {
  const delay = 0.1, freq = 1, start = 1.0, maxS = 1.5, minS = 0.5;
  const b = scalePulse({ delay, pulseFrequency: freq, startScale: start, maxScale: maxS, minScale: minS });
  for (let i = 0; i < 6; i++) b.update(DT); // t = delay
  assert.ok(close(b.scale(), start), 'exactly startScale at t=delay');
  b.update(DT); // t = delay + dt, phase small → ramp just off the rest value
  const s1 = b.scale();
  assert.ok(s1 >= minS - EPS && s1 <= maxS + EPS, `inside the band one step in (got ${s1})`);
  assert.ok(s1 > minS, `ramp has moved off the resting value (got ${s1})`);
});
ok('the multiplier reaches EXACTLY maxScale at a half cycle and EXACTLY minScale at a full cycle', () => {
  const freq = 1, maxS = 1.5, minS = 0.5;
  // One full cycle takes 1/freq = 1s; a half cycle is 1/(2·freq) = 0.5s.
  const b = scalePulse({ pulseFrequency: freq, startScale: 1.0, maxScale: maxS, minScale: minS, loopCount: 1 });
  // Half cycle: t = 1/(2·freq) → phase = π → cos = −1 → exactly maxScale.
  const hFrames = Math.round((1 / (2 * freq)) / DT); // 30 frames
  for (let i = 0; i < hFrames; i++) b.update(DT);
  assert.ok(close(b.scale(), maxS), `reaches exactly maxScale at a half cycle (got ${b.scale()})`);
  const b2 = scalePulse({ pulseFrequency: freq, startScale: 1.0, maxScale: maxS, minScale: minS, loopCount: 1 });
  const fFrames = Math.round((1 / freq) / DT); // completion frame
  for (let i = 0; i < fFrames; i++) b2.update(DT);
  assert.equal(b2.done, true, 'done at one full cycle');
  assert.ok(close(b2.scale(), minS), `back to exactly minScale at a full cycle (got ${b2.scale()})`);
});
ok('stays within [minScale, maxScale] across the whole lifetime (sampled every frame)', () => {
  const freq = 1, loops = 3, maxS = 1.4, minS = 0.6;
  const b = scalePulse({ pulseFrequency: freq, loopCount: loops, maxScale: maxS, minScale: minS });
  const frames = Math.round((loops * (1 / freq)) / DT);
  let sawMax = false, sawMin = false;
  for (let f = 0; f <= frames; f++) {
    if (f > 0) b.update(DT);
    if (b.done) break;
    const s = b.scale();
    assert.ok(s >= minS - EPS && s <= maxS + EPS, `within band at frame ${f} (got ${s})`);
    if (close(s, maxS, 1e-6)) sawMax = true;
    if (close(s, minS, 1e-6)) sawMin = true;
  }
  assert.ok(sawMax, 'sampled a frame at the max bound');
  assert.ok(sawMin, 'sampled a frame at the min bound');
});
ok('settles back to EXACTLY minScale at completion (resting-value contract)', () => {
  const freq = 1, loops = 3, minS = 0.5;
  const b = scalePulse({ pulseFrequency: freq, loopCount: loops, startScale: 1.0, maxScale: 1.5, minScale: minS });
  const frames = Math.round((loops * (1 / freq)) / DT);
  for (let i = 0; i < frames; i++) b.update(DT); // completion frame
  assert.equal(b.done, true, 'precondition: done');
  assert.ok(close(b.scale(), minS), `terminal multiplier == minScale exactly (got ${b.scale()})`);
});
ok('continuous ramp when startScale == minScale (no step at window open)', () => {
  const freq = 1, minS = 0.5;
  const b = scalePulse({ pulseFrequency: freq, startScale: minS, maxScale: 1.5, minScale: minS });
  assert.ok(close(b.scale(), minS), 'pinned at startScale during hold');
  b.update(DT); // first frame inside the window
  assert.ok(b.scale() >= minS - EPS && b.scale() <= 1.5 + EPS, 'inside band immediately after the window opens');
  assert.ok(b.scale() > minS, 'ramp has moved off the rest value (continuous, no jump)');
});
ok('pulseFrequency 2 produces two full cycles per second (peak at 1/(2·freq), two peaks over 2 cycles)', () => {
  const freq = 2, maxS = 1.5, minS = 0.5;
  const b = scalePulse({ pulseFrequency: freq, maxScale: maxS, minScale: minS, loopCount: 2 });
  // With freq = 2 the first peak lands at t = 1/(2·freq) = 0.25s (half of cycle 1).
  const peakFrames = Math.round((1 / (2 * freq)) / DT); // 15 frames
  for (let i = 0; i < peakFrames; i++) b.update(DT);
  assert.ok(close(b.scale(), maxS), `first peak at t=1/(2·freq) (got ${b.scale()})`);
  // Count peaks over the full lifetime: expect exactly 2 maxima (one per cycle).
  const b2 = scalePulse({ pulseFrequency: freq, maxScale: maxS, minScale: minS, loopCount: 2 });
  const frames = Math.round((2 * (1 / freq)) / DT); // 60 frames
  let peaks = 0;
  let prev = b2.scale();
  for (let f = 1; f <= frames; f++) {
    b2.update(DT);
    if (b2.done) break;
    const s = b2.scale();
    if (prev < maxS - 1e-6 && s >= maxS - 1e-6) peaks++;
    prev = s;
  }
  assert.equal(peaks, 2, `two full cycles → two peaks (got ${peaks})`);
});
ok('loopCount 1 completes after exactly one cycle and returns to the resting value', () => {
  const freq = 1, maxS = 1.5, minS = 0.5;
  const b = scalePulse({ pulseFrequency: freq, loopCount: 1, startScale: 1.0, maxScale: maxS, minScale: minS });
  const frames = Math.round((1 * (1 / freq)) / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at one cycle');
  assert.ok(close(b.scale(), minS), 'back at the resting value (minScale) at completion');
});
ok('fractional loopCount is integerized (contract: always lands on an integer number of cycles)', () => {
  const b = scalePulse({ pulseFrequency: 1, loopCount: 2.4 });
  // 2.4 rounds to 2 → lifetime 2s → 120 frames.
  const frames = Math.round((2 * (1 / 1)) / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done before the integerized boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the integerized lifetime');
  assert.ok(close(b.scale(), 0.8), 'lands exactly on the resting value (integer cycles)');
});
ok('startScale above the band ("charge up" config): pinned at startScale during hold, swells within the band, ends at minScale', () => {
  // startScale = 1.2, band [1, 1.5]: the sprite holds at 1.2×, then swells
  // within [1, 1.5]× and settles back onto the band's rest value (minScale = 1).
  // loopCount: 1 → lifetime == ONE full cycle (1/freq), so it is done exactly at t = 1/freq.
  const freq = 1, start = 1.2, minS = 1.0;
  const b = scalePulse({ pulseFrequency: freq, startScale: start, maxScale: 1.5, minScale: minS, loopCount: 1 });
  assert.ok(close(b.scale(), start), 'starts at startScale');
  const frames = Math.round((1 * (1 / freq)) / DT); // completion frame
  let sawPeak = false;
  for (let i = 0; i < frames; i++) {
    b.update(DT);
    if (!b.done && close(b.scale(), 1.5, 1e-6)) sawPeak = true;
  }
  assert.equal(b.done, true, 'done at one cycle');
  assert.ok(sawPeak, 'swelled to maxScale mid-pulse');
  assert.ok(close(b.scale(), minS), `ends exactly at minScale at completion (got ${b.scale()})`);
});
ok('minScale >= maxScale collapses to a constant equal to the collapsed value', () => {
  const b = scalePulse({ pulseFrequency: 1, maxScale: 1.2, minScale: 1.2, startScale: 1.0 });
  for (let i = 0; i < 10; i++) b.update(DT);
  assert.ok(close(b.scale(), 1.2), 'zero-width band → multiplier is the collapsed value throughout the window');
});
ok('non-positive duration/frequency/loopCount fall back to named defaults (bounded, self-terminating)', () => {
  const b = scalePulse({ duration: -1, pulseFrequency: 0, loopCount: 0 });
  // Defaults: freq 1, loops 3 → 3s → 180 frames (duration ignored).
  const frames = Math.round((3 * (1 / 1)) / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done before the default boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the default lifetime');
});

console.log('rendering (standalone demo path)');
ok('draws the reference box centered on the sprite center, scaled by EXACTLY scale() (no double-applied startScale)', () => {
  const carrier = makeCarrier(100, 200, 32, 48);
  const b = scalePulse({ pulseFrequency: 1, maxScale: 1.5, minScale: 0.5 }, carrier);
  b.update(DT);
  const m = b.scale(); // render() uses scale() ALONE — never startScale · scale()
  const ctx = makeCtx();
  b.render(ctx);
  const fill = ctx.calls.find(c => c[0] === 'fill');
  const cx = 100 + 32 / 2, cy = 200 + 48 / 2;
  assert.ok(close(fill[1], cx - (32 * m) / 2, 1e-9), `box left edge centered (got ${fill[1]})`);
  assert.ok(close(fill[2], cy - (48 * m) / 2, 1e-9), `box top edge centered (got ${fill[2]})`);
  assert.ok(close(fill[3], 32 * m, 1e-9), `width scaled by scale() alone (got ${fill[3]}, want ${32 * m})`);
  assert.ok(close(fill[4], 48 * m, 1e-9), `height scaled by scale() alone (got ${fill[4]}, want ${48 * m})`);
  assert.ok(ctx.calls.some(c => c[0] === 'style' && c[1] === '#ffffff'), 'demo color recorded');
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
});
ok('demo box NEVER exceeds maxScale (or drops below minScale) across the lifetime', () => {
  const carrier = makeCarrier(0, 0, 20, 20);
  const b = scalePulse({ pulseFrequency: 1, maxScale: 1.5, minScale: 0.5 }, carrier);
  const frames = Math.round((3 * (1 / 1)) / DT); // default loopCount 3
  let minW = Infinity, maxW = 0;
  for (let f = 0; f <= frames; f++) {
    if (f > 0) b.update(DT);
    if (b.done) break;
    const ctx = makeCtx();
    b.render(ctx);
    const fill = ctx.calls.find(c => c[0] === 'fill');
    if (fill) { minW = Math.min(minW, fill[3]); maxW = Math.max(maxW, fill[3]); }
  }
  assert.ok(close(maxW, 20 * 1.5, 1e-6), `max width == w·maxScale (got ${maxW})`);
  assert.ok(close(minW, 20 * 0.5, 1e-6), `min width == w·minScale (got ${minW})`);
});
ok('charge-up config (startScale > maxScale): standalone demo never exceeds maxScale once the pulse window opens', () => {
  // Hold pins the multiplier at startScale (1.2); once the window opens the
  // demo box must stay within [w·minScale, w·maxScale] — never 1.2·scale().
  const carrier = makeCarrier(0, 0, 20, 20);
  const b = scalePulse({ pulseFrequency: 1, startScale: 1.2, maxScale: 1.5, minScale: 1.0, loopCount: 1 }, carrier);
  const frames = Math.round((1 * (1 / 1)) / DT);
  let maxW = 0;
  for (let f = 1; f <= frames; f++) {
    b.update(DT);
    if (b.done) break;
    const ctx = makeCtx();
    b.render(ctx);
    const fill = ctx.calls.find(c => c[0] === 'fill');
    if (fill) maxW = Math.max(maxW, fill[3]);
  }
  assert.ok(close(maxW, 20 * 1.5, 1e-6), `demo box max == w·maxScale, not w·startScale (got ${maxW})`);
});
ok('draws nothing once done', () => {
  const b = scalePulse({ pulseFrequency: 2, loopCount: 1 }, makeCarrier(0, 0, 10, 10));
  const frames = Math.round((1 * (1 / 2)) / DT); // 30 frames
  for (let i = 0; i < frames; i++) b.update(DT);
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('reads the sprite box at DRAW time (tracks a moving carrier)', () => {
  let bx = 0, by = 0;
  const carrier = { worldBox() { return { x: bx, y: by, w: 20, h: 20 }; } };
  const b = scalePulse({ pulseFrequency: 1 }, carrier);
  const ctx = makeCtx();
  b.render(ctx);
  let fill = ctx.calls.find(c => c[0] === 'fill');
  const m0 = b.scale();
  assert.ok(close(fill[1], 0 + 10 - (20 * m0) / 2, 1e-9), 'first draw at initial position');
  bx = 50; by = 60;
  const ctx2 = makeCtx();
  b.render(ctx2);
  fill = ctx2.calls.find(c => c[0] === 'fill');
  const m1 = b.scale();
  assert.ok(close(fill[1], 50 + 10 - (20 * m1) / 2, 1e-9), 'second draw tracks the new position');
});
ok('falls back to factory-time params.box when the carrier has no geometry accessors', () => {
  const b = scalePulse({ pulseFrequency: 1, box: { x: 5, y: 6, w: 7, h: 8 } });
  const ctx = makeCtx();
  b.render(ctx);
  const fill = ctx.calls.find(c => c[0] === 'fill');
  const m = b.scale();
  assert.ok(close(fill[1], 5 + 3.5 - (7 * m) / 2, 1e-9), 'params.box used for position');
  assert.ok(close(fill[3], 7 * m, 1e-9), 'params.box used for size');
});
ok('carrier without worldBox() but with origin()+size() derives the box from them', () => {
  const carrier = { origin: () => ({ x: 30, y: 40 }), size: () => ({ w: 12, h: 8 }) };
  const b = scalePulse({ pulseFrequency: 1 }, carrier);
  const ctx = makeCtx();
  b.render(ctx);
  const fill = ctx.calls.find(c => c[0] === 'fill');
  const m = b.scale();
  assert.ok(close(fill[1], 30 - (12 * m) / 2, 1e-9), 'origin-centered box left edge');
  assert.ok(close(fill[2], 40 - (8 * m) / 2, 1e-9), 'origin-centered box top edge');
});

console.log('registration');
ok('"scale-pulse" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('scale-pulse'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'scale-pulse', params: { pulseFrequency: 2, loopCount: 2, box: { x: 0, y: 0, w: 16, h: 16 } } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'scale-pulse');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['stateChange', 'spawn']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      worldBox: () => ({ x: 0, y: 0, w: 16, h: 16 }),
      effects: [{ on: trigger, type: 'scale-pulse', params: { pulseFrequency: 1, loopCount: 2 } }],
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
    effects: [{ on: 'pickup', type: 'scale-pulse', params: { pulseFrequency: 1, loopCount: 1 } }],
  };
  const spawned = fire('pickup', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired a scale-pulse');
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
  const inst = fireManual({ type: 'scale-pulse',
    params: { pulseFrequency: 2, loopCount: 2, maxScale: 1.5, minScale: 0.5, box: { x: 0, y: 100, w: 24, h: 24 } } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  const frames = Math.round((2 * (1 / 2)) / DT); // 60 frames
  for (let i = 1; i <= frames; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'fill')) drew++;
  }
  assert.ok(drew >= 40, `demo actually drew most frames (drew ${drew}/${frames})`);
  assert.equal(body.done, true, 'demo self-terminated at delay + loopCount·(1/freq) (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects pulses the box, then prunes', () => {
  resetEffects();
  const carrier = { worldBox: () => ({ x: 10, y: 20, w: 30, h: 40 }) };
  const inst = fireManual({ type: 'scale-pulse', params: { pulseFrequency: 1, loopCount: 2, maxScale: 1.5, minScale: 0.5 } }, carrier);
  assert.ok(inst !== null, 'fired through the engine');
  let drew = 0, minW = Infinity, maxW = 0;
  for (let i = 1; i <= 120; i++) { // 120 frames = 2s = 2 full cycles at 1 Hz
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    const fill = ctx.calls.find(c => c[0] === 'fill');
    if (fill) {
      drew++;
      minW = Math.min(minW, fill[3]);
      maxW = Math.max(maxW, fill[3]);
    }
  }
  assert.ok(drew >= 100, `drew while active (drew ${drew}/120)`);
  assert.ok(close(maxW, 30 * 1.5, 1e-6), `max drawn width == w·maxScale (got ${maxW})`);
  assert.ok(close(minW, 30 * 0.5, 1e-6), `min drawn width == w·minScale (got ${minW})`);
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('two-pass model: scale-pulse renders in the world pass, NOT the screen pass', () => {
  resetEffects();
  const inst = fireManual({ type: 'scale-pulse', params: { pulseFrequency: 1, loopCount: 1, box: { x: 0, y: 0, w: 8, h: 8 } } });
  assert.ok(inst !== null, 'fired through the engine');
  updateEffects(DT); // one frame: still active
  const worldCtx = makeCtx();
  drawEffects(worldCtx, undefined, { space: 'world' });
  assert.ok(worldCtx.calls.some(c => c[0] === 'fill'), 'world pass drew the pulse box');
  const screenCtx = makeCtx();
  drawEffects(screenCtx, { view: { w: 640, h: 480 } }, { space: 'screen' });
  assert.equal(screenCtx.calls.length, 0, 'screen pass must not draw a world-space effect');
  resetEffects();
});
ok('complete() force-completes (engine reset path)', () => {
  const b = scalePulse({ pulseFrequency: 1 }, makeCarrier(0, 0, 10, 10));
  assert.equal(b.done, false);
  b.complete();
  assert.equal(b.done, true);
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw after forced completion');
});

console.log(`${passed} passed`);
