// Task 5.4 — node-based unit tests for the shockwave effect
// (js/effects/shockwave.js, effects.md §5). Run: node js/test/shockwave.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Determinism note: the shockwave geometry is fully deterministic (no
// Math.random) — the ring radius is derived purely from elapsed time
// (startRadius + expansionSpeed·elapsed, clamped to maxRadius), so
// assertions on radius and drawn arc coordinates are exact within epsilon.
// Assertions target the DOCUMENTED contract (declared params, declared
// lifetime, carrier-origin rule), not internal literals.

import { strict as assert } from 'node:assert';
import { shockwave } from '../effects/shockwave.js';
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

/** Recording canvas stub: captures transform/style writes and path calls. */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    closePath() { calls.push(['closePath']); },
    arc(...a) { calls.push(['arc', ...a]); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
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
ok('defaults: done exactly at the duration boundary, not before', () => {
  const b = shockwave({});
  const frames = Math.round(0.4 / DT); // default duration 0.4s → 24 frames
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
});
ok('explicit duration is honored exactly (total lifetime == duration)', () => {
  const dur = 0.3; // 18 frames at dt = 1/60
  const b = shockwave({ duration: dur });
  for (let i = 0; i < Math.round(dur / DT) - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
  assert.ok(close(b.elapsed, dur), `elapsed equals the declared duration (${b.elapsed})`);
});
ok('update after done is a no-op (elapsed + radius frozen)', () => {
  const c = movingCarrier(0);
  const b = shockwave({ duration: 0.1 }, c);
  b.complete();
  const e = b.elapsed, r = b.radius;
  c.x = 999;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
  assert.equal(b.radius, r, 'radius frozen once done');
});

console.log('ring expansion');
ok('starts at the declared startRadius and grows at the declared speed', () => {
  const b = shockwave({ startRadius: 10, maxRadius: 200, expansionSpeed: 120, duration: 2 });
  assert.ok(close(b.radius, 10), `initial radius == startRadius (${b.radius})`);
  b.update(DT);
  assert.ok(close(b.radius, 10 + 120 * DT), `radius grew by expansionSpeed·dt (${b.radius})`);
});
ok('reaches exactly the declared maxRadius at the declared arrival time', () => {
  // travel time = (maxRadius − startRadius)/expansionSpeed = (100−10)/180 s
  const startR = 10, maxR = 100, speed = 180;
  const travelTime = (maxR - startR) / speed;
  const b = shockwave({ startRadius: startR, maxRadius: maxR, expansionSpeed: speed, duration: travelTime });
  const frames = Math.round(travelTime / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.ok(b.radius < maxR - 1e-6, 'ring short of maxRadius one frame early');
  b.update(DT);
  assert.ok(close(b.radius, maxR), `ring reached exactly maxRadius=${maxR} at t=${travelTime}s (${b.radius})`);
  assert.equal(b.done, true, 'and completes at that same frame');
});
ok('duration longer than travel time: ring HOLDS at maxRadius until completion', () => {
  const startR = 0, maxR = 60, speed = 300; // travel time = 0.2s = 12 frames
  const b = shockwave({ startRadius: startR, maxRadius: maxR, expansionSpeed: speed, duration: 0.5 });
  for (let i = 0; i < 12; i++) b.update(DT); // t = 0.2s — arrival frame
  assert.ok(close(b.radius, maxR), 'ring at maxRadius at the travel time');
  assert.equal(b.done, false, 'still alive past arrival');
  for (let i = 0; i < 18; i++) b.update(DT); // 30 frames total = 0.5s
  assert.ok(close(b.radius, maxR), 'ring held at maxRadius through completion');
  assert.equal(b.done, true, 'completed at duration');
});
ok('duration < travel time: ring stops short of maxRadius (no teleport)', () => {
  const startR = 0, maxR = 300, speed = 300; // travel time = 1s
  const b = shockwave({ startRadius: startR, maxRadius: maxR, expansionSpeed: speed, duration: 0.3 });
  for (let i = 0; i < 18; i++) b.update(DT); // 18 frames = 0.3s
  assert.equal(b.done, true, 'completed at duration');
  assert.ok(close(b.radius, speed * 0.3), `ring at speed·duration = 90 (got ${b.radius})`);
  assert.ok(b.radius < maxR, 'ring did NOT reach declared maxRadius (no forced arrival)');
});
ok('sensible config (duration >= travel time): expands to maxRadius then fades to completion', () => {
  // Pins the documented contract "expands to maxRadius at expansionSpeed then
  // fades" for well-formed configs satisfying the header's Config precondition
  // (duration >= travel time). Defaults: startRadius 4, maxRadius 60,
  // expansionSpeed 300 → travel time = 56/300 ≈ 0.187s; default duration 0.4s
  // comfortably exceeds it. Fixed dt = 1/60, exact within epsilon. The ring
  // reaches maxRadius at the FIRST frame whose accumulated time covers the
  // travel time (r(t) is derived from elapsed, so this is the arrival frame —
  // one step past the exact real-valued travel time, per the fixed-dt grid),
  // then holds while its alpha strictly decreases through completion.
  const startR = 4, maxR = 60, speed = 300, dur = 0.4;
  const travelTime = (maxR - startR) / speed; // 56/300 s
  assert.ok(dur >= travelTime, 'precondition: duration >= travel time');
  const b = shockwave({ startRadius: startR, maxRadius: maxR, expansionSpeed: speed, duration: dur });
  const totalFrames = Math.round(dur / DT); // 24 frames = 0.4s
  let arrivedAtFrame = null;
  let prevAlpha = null;
  for (let i = 1; i <= totalFrames; i++) {
    b.update(DT);
    if (arrivedAtFrame === null && b.radius >= maxR - EPS) {
      arrivedAtFrame = i;
      assert.ok(!b.done, 'arrival happens before completion (duration > travel time)');
      assert.ok(close(b.radius, maxR), `ring reached exactly maxRadius at the arrival frame (${b.radius})`);
    } else if (arrivedAtFrame !== null) {
      assert.ok(close(b.radius, maxR), `ring held at maxRadius after arrival (frame ${i}, r=${b.radius})`);
    }
    if (!b.done) {
      const ctx = makeCtx();
      b.render(ctx);
      const alpha = ctx.calls.find(c => c[0] === 'alpha')?.[1];
      assert.ok(alpha !== undefined, 'rendering while active');
      if (prevAlpha !== null) {
        assert.ok(alpha < prevAlpha, `alpha decreased from frame ${i - 1} to ${i} (${prevAlpha} → ${alpha})`);
      }
      prevAlpha = alpha;
    }
  }
  assert.ok(arrivedAtFrame !== null, 'ring reached maxRadius during its life');
  assert.ok(arrivedAtFrame < totalFrames, `arrival frame ${arrivedAtFrame} precedes completion frame ${totalFrames}`);
  assert.equal(b.done, true, 'completed at duration');
  assert.ok(prevAlpha !== null && prevAlpha > 0, 'faded (but not fully gone) just before completion');
});
ok('maxRadius < startRadius: ring never grows (clamped at maxRadius, fades out)', () => {
  const b = shockwave({ startRadius: 50, maxRadius: 20, expansionSpeed: 300, duration: 0.3 });
  for (let i = 0; i < 18; i++) b.update(DT);
  assert.ok(close(b.radius, 20), `ring clamped at maxRadius (${b.radius})`);
  assert.equal(b.done, true, 'still completes at duration');
});
ok('carrier origin() wins over params.x/y', () => {
  const c = movingCarrier(500, 10);
  const b = shockwave({ x: 999, y: 999, duration: 1 }, c);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 10), 'carrier origin resolved');
});
ok('carrier without origin() falls back to params.x/y', () => {
  const b = shockwave({ x: 77, y: 5, duration: 1 }, { size: () => ({ w: 8, h: 8 }) });
  assert.ok(close(b.origin.x, 77) && close(b.origin.y, 5), 'params fallback used');
});

console.log('render');
ok('draws nothing once done', () => {
  const b = shockwave({ duration: 0.1 });
  for (let i = 0; i < 6; i++) b.update(DT); // 6 frames ≈ 0.1s ≥ duration
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('draws a stroked circle while active (save/restore bracketed)', () => {
  const b = shockwave({ x: 30, y: 40, startRadius: 5, maxRadius: 200, expansionSpeed: 120, thickness: 8, duration: 2 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
  const strokes = ctx.calls.filter(c => c[0] === 'stroke');
  assert.equal(strokes.length, 1, 'exactly one stroked ring');
  // Contract: a full circle centered at the origin with the current radius.
  const arc = ctx.calls.find(c => c[0] === 'arc');
  assert.ok(arc, 'ring drawn via arc');
  assert.ok(close(arc[1], 30) && close(arc[2], 40), `arc centered at the origin (got ${arc[1]},${arc[2]})`);
  assert.ok(close(arc[3], b.radius), `arc radius matches the current ring radius (${arc[3]} vs ${b.radius})`);
  assert.ok(close(Math.abs(arc[5] - arc[4]), Math.PI * 2), 'arc spans a full circle (2π radians)');
  // Contract: stroke width equals the declared thickness.
  const lw = ctx.calls.find(c => c[0] === 'lineWidth');
  assert.ok(lw && close(lw[1], 8), `lineWidth == declared thickness (got ${lw && lw[1]})`);
});
ok('alpha fades linearly from the declared opacity toward 0 across the lifetime', () => {
  const dur = 0.3;
  const b = shockwave({ duration: dur, opacity: 0.9, startRadius: 0, maxRadius: 60, expansionSpeed: 300 });
  b.update(DT); // t = 1/60
  const ctx = makeCtx();
  b.render(ctx);
  const alpha = ctx.calls.find(c => c[0] === 'alpha')?.[1];
  assert.ok(alpha !== undefined, 'globalAlpha set during render');
  assert.ok(close(alpha, 0.9 * (1 - DT / dur), 1e-6),
    `alpha == opacity·(1 − t/duration) at t=dt (got ${alpha})`);
  // Halfway through the lifetime the alpha should be ~half the peak.
  const b2 = shockwave({ duration: dur, opacity: 0.9, startRadius: 0, maxRadius: 60, expansionSpeed: 300 });
  for (let i = 0; i < 9; i++) b2.update(DT); // t = 0.15s = half of 0.3s
  const ctx2 = makeCtx();
  b2.render(ctx2);
  const alpha2 = ctx2.calls.find(c => c[0] === 'alpha')?.[1];
  assert.ok(close(alpha2, 0.9 * 0.5, 1e-6), `alpha ≈ half peak at half lifetime (got ${alpha2})`);
});
ok('degenerate geometry (thickness 0 or opacity 0) draws nothing but still completes', () => {
  const bT = shockwave({ thickness: 0, duration: 0.1 });
  const bO = shockwave({ opacity: 0, duration: 0.1 });
  bT.update(DT); bO.update(DT);
  const ctxT = makeCtx(), ctxO = makeCtx();
  bT.render(ctxT); bO.render(ctxO);
  assert.equal(ctxT.calls.length, 0, 'thickness 0 → no draw');
  assert.equal(ctxO.calls.length, 0, 'opacity 0 → no draw');
  for (let i = 0; i < 5; i++) { bT.update(DT); bO.update(DT); }
  assert.equal(bT.done, true, 'thickness-0 instance still completes at duration');
  assert.equal(bO.done, true, 'opacity-0 instance still completes at duration');
});

console.log('registration');
ok('"shockwave" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('shockwave'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'shockwave', params: { startRadius: 4, maxRadius: 60, expansionSpeed: 300, thickness: 6, opacity: 0.9, duration: 0.4, x: 0, y: 100 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'shockwave');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['explosion', 'attackActive']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      origin: () => ({ x: 10, y: 100 }),
      effects: [{ on: trigger, type: 'shockwave', params: { startRadius: 4, maxRadius: 60, expansionSpeed: 300, duration: 0.4 } }],
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
    effects: [{ on: 'spawn', type: 'shockwave', params: { startRadius: 4, maxRadius: 60, expansionSpeed: 300, duration: 0.4 } }],
  };
  const spawned = fire('spawn', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired a shockwave');
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
  const inst = fireManual({ type: 'shockwave',
    params: { startRadius: 4, maxRadius: 60, expansionSpeed: 300, thickness: 6, opacity: 0.9, duration: 0.4, x: 0, y: 100 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  // Drive the full lifetime: 24 frames = 0.4s.
  for (let i = 1; i <= 24; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'stroke')) drew++;
  }
  assert.ok(drew >= 12, `demo actually drew the ring most frames (drew ${drew}/24)`);
  assert.equal(body.done, true, 'demo self-terminated at duration (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects expands the ring, then prunes', () => {
  resetEffects();
  const c = movingCarrier(0, 100);
  const inst = fireManual({ type: 'shockwave', params: { startRadius: 0, maxRadius: 60, expansionSpeed: 300, duration: 0.2 } }, c);
  assert.ok(inst !== null, 'fired through the engine');
  let lastRadius = null;
  let drew = 0;
  for (let i = 1; i <= 12; i++) { // 12 frames = 0.2s
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(cc => cc[0] === 'stroke')) drew++;
    lastRadius = inst.body.radius;
  }
  assert.ok(drew >= 6, `drew the ring while active (drew ${drew}/12)`);
  assert.ok(close(lastRadius, 60), `ring reached the declared maxRadius by end of life (${lastRadius})`);
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});

console.log(`${passed} passed`);
