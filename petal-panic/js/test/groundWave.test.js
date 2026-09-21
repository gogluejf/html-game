// Task 5.3 — node-based unit tests for the ground wave effect
// (js/effects/groundWave.js, effects.md §4). Run: node js/test/groundWave.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Determinism note: the ground wave geometry is fully deterministic (no
// Math.random) — the wavefront x is derived purely from elapsed time
// (origin.x ± speed·elapsed, clamped to distance), so assertions on frontX
// and drawn path coordinates are exact within epsilon.

import { strict as assert } from 'node:assert';
import { groundWave } from '../effects/groundWave.js';
import {
  hasEffect, fireManual, fire, resetEffects, activeCount,
  updateEffects, drawEffects, registerEffect,
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

/** Recording canvas stub: captures transform/style writes and path calls. */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    translate(...a) { calls.push(['translate', ...a]); },
    scale(...a) { calls.push(['scale', ...a]); },
    beginPath() { calls.push(['beginPath']); },
    closePath() { calls.push(['closePath']); },
    moveTo(...a) { calls.push(['moveTo', ...a]); },
    lineTo(...a) { calls.push(['lineTo', ...a]); },
    arc(...a) { calls.push(['arc', ...a]); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    get fillStyle() { return undefined; },
    set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    get strokeStyle() { return undefined; },
    set lineWidth(v) { calls.push(['lineWidth', v]); },
    get lineWidth() { return 1; },
  };
}

/** A carrier whose origin tracks a mutable position. */
function movingCarrier(x = 0, y = 0) {
  let ox = x, oy = y;
  return {
    get x() { return ox; },
    set x(v) { ox = v; },
    get y() { return oy; },
    set y(v) { oy = v; },
    origin() { return { x: ox, y: oy }; },
  };
}

console.log('lifetime');
ok('defaults: duration 0.5s → done exactly at frame 30, not before', () => {
  const b = groundWave({});
  for (let i = 0; i < 29; i++) b.update(DT); // 29 frames ≈ 0.4833s
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT); // frame 30 = 0.5s
  assert.equal(b.done, true, 'done at the duration boundary');
});
ok('explicit duration is honored exactly (total lifetime == duration)', () => {
  const b = groundWave({ duration: 0.4 });
  for (let i = 0; i < 23; i++) b.update(DT); // 23 frames ≈ 0.3833s
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT); // frame 24 = 0.4s
  assert.equal(b.done, true, 'done at the duration boundary');
});
ok('update after done is a no-op (elapsed + frontX frozen)', () => {
  const c = movingCarrier(0);
  const b = groundWave({ duration: 0.1 }, c);
  b.complete();
  const e = b.elapsed, fx = b.frontX;
  c.x = 999;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
  assert.equal(b.frontX, fx, 'front frozen once done');
});

console.log('wavefront travel');
ok('advances in the declared direction (+x default): frontX grows from origin', () => {
  const b = groundWave({ x: 100, y: 0, speed: 300, distance: 150, duration: 1 });
  b.update(DT);
  assert.ok(close(b.frontX, 100 + 300 * DT), `front advanced +x by speed·dt (${b.frontX})`);
  assert.ok(b.frontX > 100, 'front moved right of the origin');
});
ok('direction -1 travels left: frontX shrinks from origin', () => {
  const b = groundWave({ x: 100, y: 0, direction: -1, speed: 300, distance: 150, duration: 1 });
  b.update(DT);
  assert.ok(close(b.frontX, 100 - 300 * DT), `front advanced −x by speed·dt (${b.frontX})`);
  assert.ok(b.frontX < 100, 'front moved left of the origin');
});
ok('non-zero direction values normalize to their sign', () => {
  const b = groundWave({ x: 0, direction: -7, speed: 100, distance: 100, duration: 1 });
  b.update(DT);
  assert.ok(close(b.frontX, -100 * DT), 'direction -7 behaves like -1');
});
ok('reaches exactly the declared distance at the declared time (speed·t = distance)', () => {
  // speed 300 px/s, distance 150 px → arrival at t = 0.5s = 30 frames.
  const b = groundWave({ x: 0, y: 0, speed: 300, distance: 150, duration: 0.5 });
  for (let i = 0; i < 29; i++) b.update(DT);
  assert.ok(!close(b.frontX, 150, 1e-6), 'front short of max travel one frame early');
  b.update(DT); // frame 30 = 0.5s
  assert.ok(close(b.frontX, 150), `front reached exactly distance=150 at t=0.5s (${b.frontX})`);
  assert.equal(b.done, true, 'and completes at that same frame');
});
ok('leftward arrival: front reaches origin.x − distance at the declared time', () => {
  const b = groundWave({ x: 200, y: 0, direction: -1, speed: 300, distance: 150, duration: 0.5 });
  for (let i = 0; i < 30; i++) b.update(DT);
  assert.ok(close(b.frontX, 50), `front reached 200−150=50 at t=0.5s (${b.frontX})`);
});
ok('duration longer than travel time: front HOLDS at max travel until completion', () => {
  // Travel takes 0.5s but the instance lives 1s → the front sits at 150 for
  // the second half of its life.
  const b = groundWave({ x: 0, y: 0, speed: 300, distance: 150, duration: 1 });
  for (let i = 0; i < 30; i++) b.update(DT);
  assert.ok(close(b.frontX, 150), 'front at max travel at t=0.5s');
  assert.equal(b.done, false, 'still alive past arrival');
  for (let i = 0; i < 30; i++) b.update(DT);
  assert.ok(close(b.frontX, 150), 'front held at max travel through t=1s');
  assert.equal(b.done, true, 'completed at duration');
});
ok('duration < distance/speed: front stops short of declared distance (no teleport)', () => {
  // speed 300 px/s, distance 150 px → travel time = 0.5s.
  // duration 0.3s < 0.5s → completes at t=0.3s with frontX = 90 < 150.
  const b = groundWave({ x: 0, y: 0, speed: 300, distance: 150, duration: 0.3 });
  for (let i = 0; i < 18; i++) b.update(DT); // 18 frames = 0.3s
  assert.equal(b.done, true, 'completed at duration');
  assert.ok(close(b.frontX, 300 * 0.3), `front at speed·duration = 90 (got ${b.frontX})`);
  assert.ok(b.frontX < 150, 'front did NOT reach declared distance (no forced arrival)');
});
ok('distance 0: front never leaves the origin', () => {
  const b = groundWave({ x: 42, y: 0, distance: 0, duration: 0.3 });
  for (let i = 0; i < 20; i++) b.update(DT);
  assert.ok(close(b.frontX, 42), 'front pinned at origin when distance is 0');
});
ok('carrier origin() wins over params.x/y', () => {
  const c = movingCarrier(500, 10);
  const b = groundWave({ x: 999, y: 999, speed: 300, distance: 150, duration: 1 }, c);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 10), 'carrier origin resolved');
  b.update(DT);
  assert.ok(close(b.frontX, 500 + 300 * DT), 'front advances from the carrier origin, not params');
});
ok('carrier without origin() falls back to params.x/y', () => {
  const b = groundWave({ x: 77, y: 5, speed: 300, distance: 150, duration: 1 }, { size: () => ({ w: 8, h: 8 }) });
  assert.ok(close(b.origin.x, 77) && close(b.origin.y, 5), 'params fallback used');
  b.update(DT);
  assert.ok(close(b.frontX, 77 + 300 * DT), 'front advances from the params origin');
});

console.log('render');
ok('draws nothing once done', () => {
  const b = groundWave({ duration: 0.1 });
  for (let i = 0; i < 6; i++) b.update(DT); // 6 frames ≈ 0.1s ≥ duration
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('draws a filled crest while active (save/restore bracketed)', () => {
  const b = groundWave({ x: 0, y: 100, speed: 300, distance: 150, duration: 1 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
  const fills = ctx.calls.filter(c => c[0] === 'fill');
  assert.equal(fills.length, 1, 'one filled crest shape');
  // Contract: translate to (frontX, groundY), scale vertically by height/(width/2),
  // then arc at local origin with radius width/2 spanning a semicircle.
  const trans = ctx.calls.find(c => c[0] === 'translate');
  assert.ok(trans, 'translate to (frontX, groundY) present');
  assert.ok(close(trans[1], b.frontX) && close(trans[2], 100),
    `translate targets (frontX, groundY) (got ${trans[1]},${trans[2]})`);
  const scl = ctx.calls.find(c => c[0] === 'scale');
  assert.ok(scl, 'vertical scale present');
  assert.ok(close(scl[1], 1) && close(scl[2], 18 / 12),
    `scale(1, height/(width/2)) = scale(1, 1.5) (got ${scl[1]},${scl[2]})`);
  const arcs = ctx.calls.filter(c => c[0] === 'arc');
  assert.ok(arcs.length >= 1, 'crest bulge drawn via arc');
  const crestArc = arcs.find(a => close(a[1], 0) && close(a[2], 0) && close(a[3], 12));
  assert.ok(crestArc, `crest arc at local origin with radius width/2 (${crestArc && crestArc.slice(1, 4)})`);
  assert.equal(crestArc[6], false, 'rightward crest sweeps clockwise so it bulges upward');
  assert.ok(close(Math.abs(crestArc[5] - crestArc[4]), Math.PI), 'crest arc spans a semicircle (π radians)');
});
ok('trailing base runs back `width` behind the front along the ground line', () => {
  const b = groundWave({ x: 0, y: 100, speed: 300, distance: 150, duration: 1, width: 24 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const move = ctx.calls.find(c => c[0] === 'moveTo');
  assert.ok(move, 'path begins with moveTo');
  // In local coords (after translate to frontX, groundY), the trailing base
  // starts at (-width, 0) for a rightward wave.
  assert.ok(close(move[1], -24) && close(move[2], 0),
    `trailing base at local (-width, 0) (got ${move[1]},${move[2]})`);
});
ok('leftward wave mirrors the crest (arc sweep flipped, trailing base ahead-side)', () => {
  const b = groundWave({ x: 0, y: 100, direction: -1, speed: 300, distance: 150, duration: 1, width: 24 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const move = ctx.calls.find(c => c[0] === 'moveTo');
  // For a leftward wave, trailing base is at local (+width, 0).
  assert.ok(close(move[1], 24) && close(move[2], 0),
    `trailing base at local (+width, 0) for a leftward wave (got ${move[1]},${move[2]})`);
  const crestArc = ctx.calls.find(c => c[0] === 'arc' && close(c[1], 0) && close(c[2], 0) && close(c[3], 12));
  assert.ok(crestArc, `leftward crest arc at local origin with radius width/2 (${crestArc && crestArc.slice(1, 4)})`);
  assert.equal(crestArc[6], true, 'leftward arc sweeps counter-clockwise so it still bulges upward');
  assert.ok(close(Math.abs(crestArc[5] - crestArc[4]), Math.PI), 'leftward crest arc spans a semicircle (π radians)');
});
ok('degenerate geometry (height 0 or width 0) draws nothing but still completes', () => {
  const bH = groundWave({ height: 0, duration: 0.1 });
  const bW = groundWave({ width: 0, duration: 0.1 });
  bH.update(DT); bW.update(DT);
  const ctxH = makeCtx(), ctxW = makeCtx();
  bH.render(ctxH); bW.render(ctxW);
  assert.equal(ctxH.calls.length, 0, 'height 0 → no draw');
  assert.equal(ctxW.calls.length, 0, 'width 0 → no draw');
  for (let i = 0; i < 5; i++) { bH.update(DT); bW.update(DT); }
  assert.equal(bH.done, true, 'height-0 instance still completes at duration');
  assert.equal(bW.done, true, 'width-0 instance still completes at duration');
});
ok('crest vertical extent equals `height` (contract: peak reaches height above ground line)', () => {
  // The scale factor is height/(width/2). With height=36 and width=24, the
  // vertical radius of the ellipse is 36 (not the default 18), proving that
  // `height` drives the crest peak independently of width.
  const b = groundWave({ x: 0, y: 200, speed: 300, distance: 150, duration: 1, height: 36, width: 24 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const scl = ctx.calls.find(c => c[0] === 'scale');
  assert.ok(scl, 'vertical scale present');
  // scale(1, height/(width/2)) = scale(1, 36/12) = scale(1, 3)
  assert.ok(close(scl[2], 36 / 12), `vertical scale = height/(width/2) = 3 (got ${scl[2]})`);
  // The arc radius is width/2 = 12 in local coords; after scale the peak is
  // at local y = -r * scaleY = -12 * 3 = -36, which maps to world y = 200 - 36.
  const trans = ctx.calls.find(c => c[0] === 'translate');
  assert.ok(close(trans[2], 200), 'translate y is groundY');
  const arc = ctx.calls.find(c => c[0] === 'arc' && close(c[3], 12));
  assert.ok(arc, 'arc with radius width/2 present');
  // Effective vertical extent = r * scaleY = 12 * 3 = 36 == height
  const effectiveHeight = 12 * scl[2];
  assert.ok(close(effectiveHeight, 36), `crest peak reaches height=36 above ground (got ${effectiveHeight})`);
});

console.log('registration');
ok('"ground-wave" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('ground-wave'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'ground-wave', params: { speed: 300, distance: 150, duration: 0.5, x: 0, y: 100 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'ground-wave');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['attackActive', 'spawn']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      origin: () => ({ x: 10, y: 100 }),
      effects: [{ on: trigger, type: 'ground-wave', params: { speed: 300, distance: 150, duration: 0.5 } }],
    };
    const spawned = fire(trigger, carrier);
    assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
    assert.equal(activeCount(), 1, 'instance entered the active set');
    resetEffects();
  });
}
ok('attachable via a NON-ENTITY carrier shape (plain marker object) through fire()', () => {
  // Proves generic carrier support: a plain data object with origin() and an
  // effects array — no entity class — drives a real fire().
  resetEffects();
  const marker = {
    kind: 'marker',
    origin: () => ({ x: 5, y: 100 }),
    effects: [{ on: 'spawn', type: 'ground-wave', params: { speed: 300, distance: 150, duration: 0.5 } }],
  };
  const spawned = fire('spawn', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired a ground wave');
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
  const inst = fireManual({ type: 'ground-wave',
    params: { direction: 1, speed: 300, distance: 150, height: 18, width: 24, duration: 0.5, style: 'crest', x: 0, y: 100 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  // Drive the full lifetime: 30 frames = 0.5s.
  for (let i = 1; i <= 30; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'fill')) drew++;
  }
  assert.ok(drew >= 20, `demo actually drew the crest most frames (drew ${drew}/30)`);
  assert.equal(body.done, true, 'demo self-terminated at duration (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects draws a traveling front, then prunes', () => {
  resetEffects();
  const c = movingCarrier(0, 100);
  const inst = fireManual({ type: 'ground-wave', params: { speed: 300, distance: 150, duration: 0.5 } }, c);
  assert.ok(inst !== null, 'fired through the engine');
  let lastFront = null;
  let drew = 0;
  for (let i = 1; i <= 30; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(cc => cc[0] === 'fill')) drew++;
    lastFront = inst.body.frontX;
  }
  assert.ok(drew >= 20, `drew the crest while active (drew ${drew}/30)`);
  assert.ok(close(lastFront, 150), `front reached the declared distance by end of life (${lastFront})`);
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});

console.log(`${passed} passed`);
