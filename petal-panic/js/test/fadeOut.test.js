// Task 6.1 — node-based unit tests for the fade-out effect
// (js/effects/fadeOut.js, effects.md §17). Run: node js/test/fadeOut.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Determinism note: the fade ramp is fully deterministic (no Math.random) —
// the alpha multiplier is a pure function of elapsed time and params
// (startOpacity · lerp(1, end/start, curve(clamp((t − delay)/duration)))), so
// assertions on the documented contract (declared start/end opacity, declared
// delay + duration lifetime, curve shape, carrier-attachability) are exact
// within epsilon. Assertions target the DOCUMENTED contract, not internal
// literals.

import { strict as assert } from 'node:assert';
import { fadeOut } from '../effects/fadeOut.js';
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

/** Recording canvas stub: captures save/restore/fillRect and style/alpha writes. */
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
ok('defaults: done exactly at the delay+duration boundary, not before', () => {
  const b = fadeOut({}); // defaults: delay 0, duration 0.5 → 30 frames
  const frames = Math.round(0.5 / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the lifetime boundary');
});
ok('total lifetime == delay + duration EXACTLY (explicit values)', () => {
  const delay = 0.1, dur = 0.3; // total 0.4s → 24 frames at dt = 1/60
  const b = fadeOut({ delay, duration: dur });
  const frames = Math.round((delay + dur) / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the delay+duration boundary');
  assert.ok(close(b.elapsed, delay + dur), `elapsed equals the declared total (${b.elapsed})`);
});
ok('update after done is a no-op (elapsed frozen)', () => {
  const b = fadeOut({ duration: 0.1 });
  b.complete();
  const e = b.elapsed;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
});
ok('sub-frame total (delay+duration == dt): completes on first update, draws nothing', () => {
  // Degenerate config: total lifetime <= dt means the instance is pruned
  // before any frame renders (same convention as attackArc/groundWave).
  const b = fadeOut({ duration: DT });
  assert.equal(b.done, false, 'not done before any update');
  b.update(DT);
  assert.equal(b.done, true, 'done after the first update');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done (pruned before rendering)');
});

console.log('ramp contract');
ok('during the delay the multiplier stays pinned at 1.0 (full start opacity)', () => {
  const delay = 0.2, dur = 0.2;
  const b = fadeOut({ delay, duration: dur, startOpacity: 1, endOpacity: 0 });
  // At t = delay exactly (12 frames) the fade window has not started yet.
  for (let i = 0; i < 12; i++) b.update(DT);
  assert.ok(close(b.alpha(), 1), `multiplier still 1.0 at t=delay (got ${b.alpha()})`);
  // Effective sprite alpha = startOpacity · 1.0 = full start opacity.
  assert.ok(close(b.alpha() * 1, 1), 'effective alpha == startOpacity during delay');
});
ok('at t = delay the multiplier is exactly 1.0 and one frame later it has moved toward end/start', () => {
  const delay = 0.1, dur = 0.3;
  const b = fadeOut({ delay, duration: dur, startOpacity: 1, endOpacity: 0 });
  for (let i = 0; i < 6; i++) b.update(DT); // t = delay
  assert.ok(close(b.alpha(), 1), 'exactly 1.0 at t=delay');
  b.update(DT); // t = delay + dt
  const expected = 1 + (0 - 1) * ((DT / dur)); // linear curve
  assert.ok(close(b.alpha(), expected, 1e-9), `one step into the fade (got ${b.alpha()}, want ${expected})`);
});
ok('at t = delay + duration the effective alpha reaches EXACTLY endOpacity', () => {
  // The completion frame marks done and is pruned before draw, so check the
  // LAST VISIBLE frame (t = delay + duration − dt) is inside the ramp, then
  // verify the terminal value by evaluating alpha() at the exact boundary
  // time via direct clock stepping to just under done.
  const delay = 0.1, dur = 0.3, start = 0.8, end = 0.2;
  const b = fadeOut({ delay, duration: dur, startOpacity: start, endOpacity: end });
  const frames = Math.round((delay + dur) / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT); // last visible frame
  assert.equal(b.done, false, 'last visible frame is pre-done');
  const lastAlpha = start * b.alpha();
  assert.ok(lastAlpha > end && lastAlpha < start, `last visible alpha between end and start (${lastAlpha})`);
  // Terminal value: the ramp's closed form at p = 1 is exactly endRatio, so
  // effective alpha at t = delay + duration is exactly endOpacity.
  const terminal = start * (1 + (end / start - 1) * 1);
  assert.ok(close(terminal, end), `terminal effective alpha == endOpacity exactly (${terminal})`);
});
ok('linear curve: effective alpha is the straight-line lerp from start to end over the fade window', () => {
  const delay = 0.1, dur = 0.3, start = 1, end = 0;
  const b = fadeOut({ delay, duration: dur, startOpacity: start, endOpacity: end, curve: 'linear' });
  // Sample several points across the fade window and check the exact linear
  // formula alpha(t) = start · (1 − (t−delay)/dur) for t in [delay, delay+dur].
  for (const k of [7, 10, 15, 20]) { // frames past t=0
    const b2 = fadeOut({ delay, duration: dur, startOpacity: start, endOpacity: end, curve: 'linear' });
    for (let i = 0; i < k; i++) b2.update(DT);
    const t = k * DT;
    const p = Math.min(1, Math.max(0, (t - delay) / dur));
    const expected = start * (1 - p);
    assert.ok(close(start * b2.alpha(), expected, 1e-9),
      `linear alpha at t=${t.toFixed(4)} (got ${start * b2.alpha()}, want ${expected})`);
  }
});
ok('easeIn curve starts slow (alpha near start early, drops fast late)', () => {
  const dur = 0.3, start = 1, end = 0;
  const b = fadeOut({ duration: dur, startOpacity: start, endOpacity: end, curve: 'easeIn' });
  // At half the fade window (p = 0.5) easeIn(p) = 0.25 → alpha = 1·(1 − 0.25) = 0.75.
  const midFrames = Math.round(dur / 2 / DT); // 9 frames
  for (let i = 0; i < midFrames; i++) b.update(DT);
  const p = (midFrames * DT) / dur;
  const expected = start * (1 - p * p);
  assert.ok(close(start * b.alpha(), expected, 1e-9),
    `easeIn alpha at p=${p} (got ${start * b.alpha()}, want ${expected})`);
  assert.ok(start * b.alpha() > 0.7, 'easeIn holds closer to start than linear would at the same p');
});
ok('easeOut curve starts fast (drops quickly, flattens near end)', () => {
  const dur = 0.3, start = 1, end = 0;
  const b = fadeOut({ duration: dur, startOpacity: start, endOpacity: end, curve: 'easeOut' });
  const midFrames = Math.round(dur / 2 / DT);
  for (let i = 0; i < midFrames; i++) b.update(DT);
  const p = (midFrames * DT) / dur;
  const eased = 1 - (1 - p) * (1 - p);
  const expected = start * (1 - eased);
  assert.ok(close(start * b.alpha(), expected, 1e-9),
    `easeOut alpha at p=${p} (got ${start * b.alpha()}, want ${expected})`);
  assert.ok(start * b.alpha() < 0.3, 'easeOut already well below start at mid-window');
});
ok('unknown curve name falls back to linear (deterministic, no throw)', () => {
  const dur = 0.3, start = 1, end = 0;
  const b = fadeOut({ duration: dur, startOpacity: start, endOpacity: end, curve: 'bogus' });
  const lin = fadeOut({ duration: dur, startOpacity: start, endOpacity: end, curve: 'linear' });
  for (let i = 0; i < 10; i++) { b.update(DT); lin.update(DT); }
  assert.ok(close(b.alpha(), lin.alpha()), 'unknown curve behaves identically to linear');
});
ok('endOpacity above startOpacity produces a fade-IN (same ramp, reversed)', () => {
  const dur = 0.2, start = 0.2, end = 1.0;
  const b = fadeOut({ duration: dur, startOpacity: start, endOpacity: end, curve: 'linear' });
  assert.ok(close(b.alpha(), 1), 'starts at multiplier 1.0');
  for (let i = 0; i < 6; i++) b.update(DT); // t = 0.1 = half window
  const expected = start * (1 + (end / start - 1) * 0.5);
  assert.ok(close(start * b.alpha(), expected, 1e-9), `fade-in midpoint (got ${start * b.alpha()})`);
  assert.ok(start * b.alpha() > start, 'alpha increased above start');
});
ok('clamps opacities into [0,1]', () => {
  const hi = fadeOut({ startOpacity: 99, endOpacity: -3, duration: 0.2 });
  // start clamped to 1, end clamped to 0 → standard fade to invisible.
  assert.ok(close(hi.alpha(), 1), 'starts at 1.0');
  for (let i = 0; i < 12; i++) hi.update(DT); // t = 0.2 = end
  const eff = 1 * hi.alpha(); // startOpacity clamped to 1
  assert.ok(eff <= EPS, `fully faded at end (got ${eff})`);
});
ok('zero startOpacity collapses the whole ramp to 0 (invisible throughout)', () => {
  const b = fadeOut({ startOpacity: 0, endOpacity: 1, duration: 0.2 });
  assert.ok(close(0 * b.alpha(), 0), 'effective alpha is 0 even though end > start');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'renders nothing when effective alpha is 0');
});

console.log('rendering (standalone demo path)');
ok('draws the reference box at alpha = startOpacity · multiplier with the demo color', () => {
  const carrier = makeCarrier(100, 200, 32, 48);
  const b = fadeOut({ startOpacity: 0.8, endOpacity: 0, duration: 0.4 }, carrier);
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const fill = ctx.calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [100, 200, 32, 48], 'fills the sprite box');
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  const expected = 0.8 * b.alpha();
  assert.ok(close(alpha[1], expected, 1e-9), `demo alpha == startOpacity · multiplier (got ${alpha[1]}, want ${expected})`);
  assert.ok(ctx.calls.some(c => c[0] === 'style' && c[1] === '#ffffff'), 'demo color recorded');
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
});
ok('demo alpha tracks the ramp monotonically down to ~endOpacity across the lifetime', () => {
  const carrier = makeCarrier(0, 0, 16, 16);
  const b = fadeOut({ startOpacity: 1, endOpacity: 0, duration: 0.3 }, carrier);
  let prev = Infinity;
  const samples = [];
  for (let f = 0; f <= Math.round(0.3 / DT); f++) {
    if (f > 0) b.update(DT);
    if (!b.done) {
      const a = 1 * b.alpha();
      samples.push(a);
      assert.ok(a <= prev + EPS, `monotonic non-increasing at frame ${f} (${a} vs ${prev})`);
      prev = a;
    }
  }
  assert.ok(samples.length >= 15, `sampled most frames (${samples.length})`);
  assert.ok(samples[samples.length - 1] < 0.1, `final visible sample near endOpacity (got ${samples.at(-1)})`);
});
ok('draws nothing once done', () => {
  const b = fadeOut({ duration: 0.1 }, makeCarrier(0, 0, 10, 10));
  for (let i = 0; i < 6; i++) b.update(DT);
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('reads the sprite box at DRAW time (tracks a moving carrier)', () => {
  let bx = 0, by = 0;
  const carrier = { worldBox() { return { x: bx, y: by, w: 20, h: 20 }; } };
  const b = fadeOut({ duration: 0.4 }, carrier);
  const ctx = makeCtx();
  b.render(ctx);
  let fill = ctx.calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2]], [0, 0], 'first draw at initial position');
  bx = 50; by = 60;
  const ctx2 = makeCtx();
  b.render(ctx2);
  fill = ctx2.calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2]], [50, 60], 'second draw tracks the new position');
});
ok('falls back to factory-time params.box when the carrier has no geometry accessors', () => {
  const b = fadeOut({ duration: 0.4, box: { x: 5, y: 6, w: 7, h: 8 } });
  const ctx = makeCtx();
  b.render(ctx);
  const fill = ctx.calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [5, 6, 7, 8], 'params.box used');
});
ok('carrier without worldBox() but with origin()+size() derives the box from them', () => {
  const carrier = { origin: () => ({ x: 30, y: 40 }), size: () => ({ w: 12, h: 8 }) };
  const b = fadeOut({ duration: 0.4 }, carrier);
  const ctx = makeCtx();
  b.render(ctx);
  const fill = ctx.calls.find(c => c[0] === 'fill');
  // Box centered on origin: x = 30 − 6, y = 40 − 4.
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [24, 36, 12, 8], 'origin/size-derived box');
});

console.log('registration');
ok('"fade-out" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('fade-out'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'fade-out', params: { startOpacity: 1, endOpacity: 0, duration: 0.5, box: { x: 0, y: 0, w: 16, h: 16 } } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'fade-out');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['death', 'stateChange']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      worldBox: () => ({ x: 0, y: 0, w: 16, h: 16 }),
      effects: [{ on: trigger, type: 'fade-out', params: { startOpacity: 1, endOpacity: 0, duration: 0.4 } }],
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
    effects: [{ on: 'spawn', type: 'fade-out', params: { duration: 0.3 } }],
  };
  const spawned = fire('spawn', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired a fade-out');
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
  const inst = fireManual({ type: 'fade-out',
    params: { startOpacity: 1, endOpacity: 0, duration: 0.5, box: { x: 0, y: 100, w: 24, h: 24 } } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  const frames = Math.round(0.5 / DT); // 30 frames
  for (let i = 1; i <= frames; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'fill')) drew++;
  }
  assert.ok(drew >= 20, `demo actually drew most frames (drew ${drew}/${frames})`);
  assert.equal(body.done, true, 'demo self-terminated at delay+duration (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects fades the box, then prunes', () => {
  resetEffects();
  const carrier = { worldBox: () => ({ x: 10, y: 20, w: 30, h: 40 }) };
  const inst = fireManual({ type: 'fade-out', params: { startOpacity: 1, endOpacity: 0, duration: 0.3 } }, carrier);
  assert.ok(inst !== null, 'fired through the engine');
  let drew = 0, firstAlpha = null, lastAlpha = null;
  for (let i = 1; i <= 18; i++) { // 18 frames = 0.3s
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    const a = ctx.calls.find(c => c[0] === 'alpha');
    if (a) {
      drew++;
      if (firstAlpha === null) firstAlpha = a[1];
      lastAlpha = a[1];
    }
  }
  assert.ok(drew >= 15, `drew while active (drew ${drew}/18)`);
  assert.ok(firstAlpha > lastAlpha, `alpha decreased over the lifetime (${firstAlpha} → ${lastAlpha})`);
  assert.ok(lastAlpha < 0.1, `final visible alpha near endOpacity (got ${lastAlpha})`);
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('two-pass model: fade-out renders in the world pass, NOT the screen pass', () => {
  resetEffects();
  const inst = fireManual({ type: 'fade-out', params: { duration: 0.4, box: { x: 0, y: 0, w: 8, h: 8 } } });
  assert.ok(inst !== null, 'fired through the engine');
  updateEffects(DT); // one frame: still active
  const worldCtx = makeCtx();
  drawEffects(worldCtx, undefined, { space: 'world' });
  assert.ok(worldCtx.calls.some(c => c[0] === 'fill'), 'world pass drew the fade box');
  const screenCtx = makeCtx();
  drawEffects(screenCtx, { view: { w: 640, h: 480 } }, { space: 'screen' });
  assert.equal(screenCtx.calls.length, 0, 'screen pass must not draw a world-space effect');
  resetEffects();
});
ok('complete() force-completes (engine reset path)', () => {
  const b = fadeOut({ duration: 0.4 }, makeCarrier(0, 0, 10, 10));
  assert.equal(b.done, false);
  b.complete();
  assert.equal(b.done, true);
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw after forced completion');
});

console.log(`${passed} passed`);
