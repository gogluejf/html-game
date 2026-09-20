// Task 3.1 — node-based unit tests for the screen-overlay effect
// (js/effects/screenOverlay.js, effects.md §23). Run: node js/test/screenOverlay.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.

import { strict as assert } from 'node:assert';
import { screenOverlay } from '../effects/screenOverlay.js';
import { hasEffect, fireManual, fire, resetEffects, activeCount, updateEffects, drawEffects } from '../effects/index.js';
import '../effects/registry.js'; // side effect: registers the types

const DT = 1 / 60;
const EPS = 1e-9;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Recording canvas stub: captures save/restore/fillRect and style/alpha/blend writes. */
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
    set globalCompositeOperation(v) { calls.push(['blend', v]); },
    get globalCompositeOperation() { return 'source-over'; },
  };
}

console.log('fade curve');
ok('defaults: duration 1s, fadeIn 0.2s, fadeOut 0.2s, hold 0.6s at peak 0.5', () => {
  const b = screenOverlay({ viewW: 640, viewH: 480 });
  assert.equal(b.value, 0, 'starts transparent');
  // 1 frame into the fade-in ramp.
  b.update(DT);
  assert.ok(Math.abs(b.value - 0.5 * (DT / 0.2)) < EPS, `frame 1 ${b.value}`);
  // Exactly at the end of fade-in (12 frames = 0.2s): full peak.
  for (let i = 0; i < 11; i++) b.update(DT);
  assert.ok(Math.abs(b.value - 0.5) < EPS, `at fadeIn end ${b.value}`);
  // Mid-hold (frame 30 = 0.5s): still at peak.
  for (let i = 0; i < 18; i++) b.update(DT);
  assert.ok(Math.abs(b.value - 0.5) < EPS, `mid-hold ${b.value}`);
  // Just inside the fade-out window (frame 48 = 0.8s): one frame before done.
  for (let i = 0; i < 18; i++) b.update(DT);
  assert.equal(b.done, false, 'still active at 0.8s');
  assert.ok(Math.abs(b.value - 0.5 * (1 - (0.8 - 0.8) / 0.2)) < 0.01, `start of fade-out ${b.value}`);
  // One more frame (frame 49 ≈ 0.8167s) lands inside the fade-out ramp.
  b.update(DT);
  const t = (49 * DT - 0.8) / 0.2;
  assert.ok(Math.abs(b.value - 0.5 * (1 - t)) < 0.01, `fade-out ${b.value}`);
});
ok('reaches zero and reports done exactly when total lifetime elapses', () => {
  const b = screenOverlay({ viewW: 640, viewH: 480 });
  for (let i = 0; i < 59; i++) b.update(DT); // 0.9833s < 1s
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT); // frame 60 = 1.0s
  assert.equal(b.value, 0);
  assert.equal(b.done, true, 'done at the lifetime boundary');
});
ok('opacity follows the declared params (peak 0.8, fadeIn 0.5s, fadeOut 0.5s, duration 1s → no hold)', () => {
  const b = screenOverlay({ opacity: 0.8, fadeIn: 0.5, fadeOut: 0.5, duration: 1, viewW: 640, viewH: 480 });
  for (let i = 0; i < 30; i++) b.update(DT); // 0.5s → end of fade-in
  assert.ok(Math.abs(b.value - 0.8) < EPS, `peak ${b.value}`);
  for (let i = 0; i < 29; i++) b.update(DT); // ~0.9833s → deep in fade-out
  assert.ok(b.value > 0 && b.value < 0.8, `fading ${b.value}`);
  b.update(DT); // 1.0s
  assert.equal(b.done, true);
  assert.equal(b.value, 0);
});
ok('too-short duration scales ramps to fit: lifetime == duration, peak reached in clamped window', () => {
  // duration 0.3 < fadeIn 0.5 + fadeOut 0.5 → both ramps scaled by 0.3/1.0 = 0.3
  // so fadeIn = fadeOut = 0.15s, hold = 0, total lifetime = exactly 0.3s.
  const b = screenOverlay({ fadeIn: 0.5, fadeOut: 0.5, duration: 0.3, viewW: 640, viewH: 480 });
  // At t ≈ 0.15s (end of scaled fade-in): curve reaches full peak.
  for (let i = 0; i < 9; i++) b.update(DT); // 9 frames ≈ 0.15s
  assert.ok(Math.abs(b.value - 0.5) < 0.01, `peak at clamped fade-in end ${b.value}`);
  // Lifetime is exactly 0.3s; verify it does NOT exceed that.
  // 17 frames ≈ 0.2833s: still active and fading out.
  for (let i = 0; i < 8; i++) b.update(DT); // 17 frames total
  assert.equal(b.done, false, 'not done just before the boundary');
  assert.ok(b.value > 0 && b.value < 0.5, `fading out ${b.value}`);
  // Frame 18 crosses the 0.3s boundary: done with zero value.
  b.update(DT);
  assert.equal(b.done, true, 'done at the lifetime boundary (== duration)');
  assert.equal(b.value, 0);
});
ok('clamps opacity above 1 and below 0', () => {
  assert.equal(screenOverlay({ opacity: 99 }).peak, 1);
  const neg = screenOverlay({ opacity: -3, viewW: 640, viewH: 480 });
  assert.equal(neg.peak, 0, 'negative opacity collapses to 0');
  const ctx = makeCtx();
  neg.render(ctx); // value 0 → guard returns before drawing
  assert.equal(ctx.calls.length, 0, 'no render at value 0');
  // A zero-peak overlay is still a timed effect: it plays out its full
  // (invisible) lifetime and reports done when the duration elapses.
  for (let i = 0; i < 59; i++) neg.update(DT);
  assert.equal(neg.done, false, 'still timing out before the boundary');
  neg.update(DT);
  assert.equal(neg.done, true, 'marks done when the lifetime elapses');
});

console.log('rendering');
ok('renders a viewport fill at alpha = current value with the declared color and blend mode', () => {
  const ctx = makeCtx();
  // Documented path: viewport dims come from renderCtx (effects.md §Lifecycle).
  const b = screenOverlay({ color: '#ff0000', blendMode: 'multiply' });
  b.update(DT); // mid fade-in
  b.render(ctx, { view: { w: 640, h: 480 } });
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(alpha && Math.abs(alpha[1] - 0.5 * (DT / 0.2)) < EPS, `alpha ${alpha?.[1]}`);
  assert.ok(ctx.calls.some(c => c[0] === 'style' && c[1] === '#ff0000'), 'color recorded');
  assert.ok(ctx.calls.some(c => c[0] === 'blend' && c[1] === 'multiply'), 'blend mode recorded');
  assert.ok(ctx.calls.some(c => c[0] === 'fill' && c[1] === 0 && c[2] === 0 && c[3] === 640 && c[4] === 480), 'full-viewport fill');
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
});
ok('defaults to white tint and source-over blending', () => {
  const ctx = makeCtx();
  const b = screenOverlay();
  b.update(DT);
  b.render(ctx, { view: { w: 640, h: 480 } });
  assert.ok(ctx.calls.some(c => c[0] === 'style' && c[1] === '#ffffff'));
  assert.ok(ctx.calls.some(c => c[0] === 'blend' && c[1] === 'source-over'));
});
ok('render prefers the DRAW-TIME view over stale factory-time params', () => {
  const ctx = makeCtx();
  const b = screenOverlay({ viewW: 999, viewH: 777 }); // stale factory-time dims
  b.update(DT);
  b.render(ctx, { view: { w: 1280, h: 720 } });        // authoritative draw-time dims
  const fill = ctx.calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [0, 0, 1280, 720], 'draw-time view wins');
});
ok('falls back to factory-time params when draw-time view is absent (undocumented fallback)', () => {
  // UNDOCUMENTED fallback for direct-body callers only — NOT in §23's param list.
  // The documented path delivers viewport via renderCtx (see tests above).
  const ctx = makeCtx();
  const b = screenOverlay({ viewW: 640, viewH: 480 });
  b.update(DT);
  b.render(ctx, {}); // no draw-time view → undocumented factory-time fallback
  const fill = ctx.calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [0, 0, 640, 480], 'factory-time fallback used');
});
ok('end-to-end: fire → updateEffects → drawEffects propagates the DRAW-TIME viewport', () => {
  // Proves the documented Lifecycle path (effects.md §Lifecycle): the overlay
  // reads its viewport from renderCtx at DRAW time, not from factory-time dims.
  resetEffects();
  const inst = fireManual({ type: 'screen-overlay',
    params: { viewW: 999, viewH: 777 } }); // stale factory-time dims
  assert.ok(inst !== null, 'fired through the engine');
  for (let i = 0; i < 5; i++) updateEffects(DT); // advance mid fade-in
  const ctx = makeCtx();
  drawEffects(ctx, { view: { w: 1280, h: 720 } }); // authoritative draw-time dims
  const fill = ctx.calls.find(c => c[0] === 'fill');
  assert.ok(fill, 'overlay fill was drawn');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [0, 0, 1280, 720],
    'fill used DRAW-TIME dims, not factory-time ones');
  resetEffects();
});
ok('does not render once done', () => {
  const ctx = makeCtx();
  const b = screenOverlay();
  for (let i = 0; i < 60; i++) b.update(DT); // 1.0s → fully faded
  assert.equal(b.done, true);
  b.render(ctx, { view: { w: 640, h: 480 } }); // no-op when done
  assert.equal(ctx.calls.length, 0);
});

console.log('registration');
ok('"screen-overlay" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('screen-overlay'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'screen-overlay', params: {} });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'screen-overlay');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
ok('attachable via carrier config on its trigger (stateChange)', () => {
  resetEffects();
  const carrier = {
    effects: [{ on: 'stateChange', type: 'screen-overlay',
                params: { color: '#0033aa', opacity: 0.4, duration: 0.5 } }],
  };
  const spawned = fire('stateChange', carrier);
  assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
ok('complete() force-completes (engine reset path)', () => {
  const b = screenOverlay();
  assert.equal(b.done, false);
  b.complete();
  assert.equal(b.done, true);
});

console.log(`${passed} passed`);
