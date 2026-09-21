// Task 5.5 — node-based unit tests for the telegraph circle effect
// (js/effects/telegraphCircle.js, effects.md §8). Run:
// node js/test/telegraphCircle.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Determinism note: the telegraph circle geometry is fully deterministic (no
// Math.random) — the ring radius is derived purely from elapsed time
// (radius − shrinkRate·elapsed, clamped to minRadius) and the pulsing alpha
// is a pure function of elapsed time (opacity · (0.5 + 0.5·cos(2π·pulseRate·t))),
// so assertions on radius, drawn arc coordinates, and alpha are exact within
// epsilon. Assertions target the DOCUMENTED contract (declared params,
// declared lifetime, carrier-origin rule, followTarget semantics), not
// internal literals.

import { strict as assert } from 'node:assert';
import { telegraphCircle } from '../effects/telegraphCircle.js';
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
  const b = telegraphCircle({});
  const frames = Math.round(0.4 / DT); // default duration 0.4s → 24 frames
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
});
ok('explicit duration is honored exactly (total lifetime == duration)', () => {
  const dur = 0.3; // 18 frames at dt = 1/60
  const b = telegraphCircle({ duration: dur });
  for (let i = 0; i < Math.round(dur / DT) - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
  assert.ok(close(b.elapsed, dur), `elapsed equals the declared duration (${b.elapsed})`);
});
ok('update after done is a no-op (elapsed + radius frozen)', () => {
  const c = movingCarrier(0);
  const b = telegraphCircle({ duration: 0.1, followTarget: true }, c);
  b.complete();
  const e = b.elapsed, r = b.radius;
  c.x = 999;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
  assert.equal(b.radius, r, 'radius frozen once done');
  assert.equal(b.origin.x, 0, 'origin frozen once done (followTarget does not re-resolve)');
});

console.log('circle shrink');
ok('starts at the declared radius and shrinks at the declared rate', () => {
  const b = telegraphCircle({ radius: 100, minRadius: 0, shrinkRate: 120, duration: 2 });
  assert.ok(close(b.radius, 100), `initial radius == declared radius (${b.radius})`);
  b.update(DT);
  assert.ok(close(b.radius, 100 - 120 * DT), `radius shrank by shrinkRate·dt (${b.radius})`);
});
ok('reaches exactly the declared minRadius at the declared arrival time', () => {
  // travel time = (radius − minRadius)/shrinkRate = (100−20)/160 s
  const r0 = 100, minR = 20, speed = 160;
  const travelTime = (r0 - minR) / speed;
  const b = telegraphCircle({ radius: r0, minRadius: minR, shrinkRate: speed, duration: travelTime });
  const frames = Math.round(travelTime / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.ok(b.radius > minR + 1e-6, 'circle larger than minRadius one frame early');
  b.update(DT);
  assert.ok(close(b.radius, minR), `circle reached exactly minRadius=${minR} at t=${travelTime}s (${b.radius})`);
  assert.equal(b.done, true, 'and completes at that same frame');
});
ok('duration longer than travel time: circle HOLDS at minRadius until completion', () => {
  const r0 = 48, minR = 12, speed = 96; // travel time = 36/96 = 0.375s = 22.5 frames
  const b = telegraphCircle({ radius: r0, minRadius: minR, shrinkRate: speed, duration: 0.5 });
  for (let i = 0; i < 23; i++) b.update(DT); // t = 23/60 ≈ 0.383s — past arrival
  assert.ok(close(b.radius, minR), 'circle at minRadius after the travel time');
  assert.equal(b.done, false, 'still alive past arrival');
  for (let i = 0; i < 7; i++) b.update(DT); // 30 frames total = 0.5s
  assert.ok(close(b.radius, minR), 'circle held at minRadius through completion');
  assert.equal(b.done, true, 'completed at duration');
});
ok('duration < travel time: circle stops short of minRadius (no teleport)', () => {
  const r0 = 200, minR = 0, speed = 300; // travel time = 200/300 ≈ 0.667s
  const b = telegraphCircle({ radius: r0, minRadius: minR, shrinkRate: speed, duration: 0.3 });
  for (let i = 0; i < 18; i++) b.update(DT); // 18 frames = 0.3s
  assert.equal(b.done, true, 'completed at duration');
  assert.ok(close(b.radius, r0 - speed * 0.3), `circle at radius − shrinkRate·duration = 110 (got ${b.radius})`);
  assert.ok(b.radius > minR, 'circle did NOT reach declared minRadius (no forced arrival)');
});
ok('minRadius > radius: circle never shrinks (clamped at minRadius, still pulses out)', () => {
  const b = telegraphCircle({ radius: 20, minRadius: 50, shrinkRate: 96, duration: 0.3 });
  for (let i = 0; i < 18; i++) b.update(DT);
  assert.ok(close(b.radius, 50), `circle clamped at the declared minRadius (${b.radius})`);
  assert.equal(b.done, true, 'still completes at duration');
});
ok('sensible config (duration >= travel time): shrinks to minRadius then holds while pulsing', () => {
  // Pins the documented contract "may shrink toward its center as the
  // countdown completes" for well-formed configs satisfying the header's
  // precondition (duration >= travel time). Defaults: radius 48, minRadius
  // 12, shrinkRate 96 → travel time = 36/96 = 0.375s; default duration 0.4s
  // comfortably exceeds it. Fixed dt = 1/60, exact within epsilon. The circle
  // reaches minRadius at the FIRST frame whose accumulated time covers the
  // travel time (r(t) is derived from elapsed, so this is the arrival frame —
  // one step past the exact real-valued travel time, per the fixed-dt grid),
  // then holds at minRadius through completion.
  const r0 = 48, minR = 12, speed = 96, dur = 0.4;
  const travelTime = (r0 - minR) / speed; // 0.375s
  assert.ok(dur >= travelTime, 'precondition: duration >= travel time');
  const b = telegraphCircle({ radius: r0, minRadius: minR, shrinkRate: speed, duration: dur });
  const totalFrames = Math.round(dur / DT); // 24 frames = 0.4s
  let arrivedAtFrame = null;
  for (let i = 1; i <= totalFrames; i++) {
    b.update(DT);
    if (arrivedAtFrame === null && b.radius <= minR + EPS) {
      arrivedAtFrame = i;
      assert.ok(!b.done, 'arrival happens before completion (duration > travel time)');
      assert.ok(close(b.radius, minR), `circle reached exactly minRadius at the arrival frame (${b.radius})`);
    } else if (arrivedAtFrame !== null) {
      assert.ok(close(b.radius, minR), `circle held at minRadius after arrival (frame ${i}, r=${b.radius})`);
    }
  }
  assert.ok(arrivedAtFrame !== null, 'circle reached minRadius during its life');
  assert.ok(arrivedAtFrame < totalFrames, `arrival frame ${arrivedAtFrame} precedes completion frame ${totalFrames}`);
  assert.equal(b.done, true, 'completed at duration');
});

console.log('origin resolution');
ok('carrier origin() wins over params.x/y', () => {
  const c = movingCarrier(500, 10);
  const b = telegraphCircle({ x: 999, y: 999, duration: 1 }, c);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 10), 'carrier origin resolved');
});
ok('carrier without origin() falls back to params.x/y', () => {
  const b = telegraphCircle({ x: 77, y: 5, duration: 1 }, { size: () => ({ w: 8, h: 8 }) });
  assert.ok(close(b.origin.x, 77) && close(b.origin.y, 5), 'params fallback used');
});
ok('null carrier uses params.x/y (standalone/theater origin)', () => {
  const b = telegraphCircle({ x: 12, y: -3, duration: 1 });
  assert.ok(close(b.origin.x, 12) && close(b.origin.y, -3), 'params origin used');
});
ok('followTarget=false (default): origin captured at fire time, held even if the carrier moves', () => {
  const c = movingCarrier(10, 20);
  const b = telegraphCircle({ duration: 1 }, c);
  assert.ok(close(b.origin.x, 10) && close(b.origin.y, 20), 'fire-time origin captured');
  c.x = 500; c.y = 600;
  b.update(DT);
  assert.ok(close(b.origin.x, 10) && close(b.origin.y, 20), 'origin held fixed despite carrier motion');
});
ok('followTarget=true: origin tracks the moving carrier every update()', () => {
  const c = movingCarrier(10, 20);
  const b = telegraphCircle({ duration: 1, followTarget: true }, c);
  c.x = 500; c.y = 600;
  b.update(DT);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 600), 'origin follows the carrier');
  c.x = 510;
  b.update(DT);
  assert.ok(close(b.origin.x, 510), 'origin keeps following across updates');
});
ok('followTarget=true with a null carrier: origin stays at the params.x/y fallback', () => {
  const b = telegraphCircle({ x: 33, y: 44, duration: 1, followTarget: true });
  b.update(DT);
  assert.ok(close(b.origin.x, 33) && close(b.origin.y, 44), 'fallback origin held');
});

console.log('render');
ok('draws nothing once done', () => {
  const b = telegraphCircle({ duration: 0.1 });
  for (let i = 0; i < 6; i++) b.update(DT); // 6 frames ≥ 0.1s
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('draws a stroked circle while active (save/restore bracketed)', () => {
  const b = telegraphCircle({ x: 30, y: 40, radius: 100, minRadius: 0, shrinkRate: 120, thickness: 8, duration: 2 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
  const strokes = ctx.calls.filter(c => c[0] === 'stroke');
  assert.equal(strokes.length, 1, 'exactly one stroked circle');
  // Contract: a full circle centered at the origin with the current radius.
  const arc = ctx.calls.find(c => c[0] === 'arc');
  assert.ok(arc, 'circle drawn via arc');
  assert.ok(close(arc[1], 30) && close(arc[2], 40), `arc centered at the origin (got ${arc[1]},${arc[2]})`);
  assert.ok(close(arc[3], b.radius), `arc radius matches the current circle radius (${arc[3]} vs ${b.radius})`);
  assert.ok(close(Math.abs(arc[5] - arc[4]), Math.PI * 2), 'arc spans a full circle (2π radians)');
  // Contract: stroke width equals the declared thickness.
  const lw = ctx.calls.find(c => c[0] === 'lineWidth');
  assert.ok(lw && close(lw[1], 8), `lineWidth == declared thickness (got ${lw && lw[1]})`);
});
ok('alpha pulses deterministically: full peak at t=0 and each period, bounded between half-peak and peak', () => {
  // Documented contract: alpha = opacity · (0.5 + 0.5·cos(2π·pulseRate·t)).
  // At t=0 (before any update) the cos term is 1 → alpha == full peak.
  const b = telegraphCircle({ duration: 1, opacity: 0.8, pulseRate: 4 });
  const ctx0 = makeCtx();
  b.render(ctx0);
  const alpha0 = ctx0.calls.find(c => c[0] === 'alpha')?.[1];
  assert.ok(close(alpha0, 0.8, 1e-6), `alpha == full peak opacity at t=0 (got ${alpha0})`);
  // One full pulse period later (t = 1/pulseRate = 0.25s = 15 frames) the cos
  // term is back to 1 → alpha returns to the full peak exactly.
  const b2 = telegraphCircle({ duration: 1, opacity: 0.8, pulseRate: 4 });
  for (let i = 0; i < 15; i++) b2.update(DT); // t = 15/60 = 0.25s
  const ctxQ = makeCtx();
  b2.render(ctxQ);
  const alphaQ = ctxQ.calls.find(c => c[0] === 'alpha')?.[1];
  assert.ok(close(alphaQ, 0.8, 1e-6), `alpha back to full peak one full pulse period later (t=0.25s, got ${alphaQ})`);
  // The trough (cos term −1 → half peak) sits at t = 1/(2·pulseRate) = 0.125s
  // = 7.5 frames — off the fixed-dt grid — so probe every frame of the first
  // half-period and confirm the alpha stays strictly BETWEEN the half-peak
  // floor and the full peak (deterministic oscillation, bounded).
  const b3 = telegraphCircle({ duration: 1, opacity: 0.8, pulseRate: 4 });
  let sawMidPulse = false;
  for (let i = 0; i < 7; i++) { // frames 1..6: t in (0, 0.1s), inside the half-period
    b3.update(DT);
    const ctxM = makeCtx();
    b3.render(ctxM);
    const alphaM = ctxM.calls.find(c => c[0] === 'alpha')?.[1];
    if (i > 0 && alphaM > 0.4 + 1e-6 && alphaM < 0.8 - 1e-6) sawMidPulse = true;
  }
  assert.ok(sawMidPulse, 'alpha oscillates between half-peak and peak mid-pulse');
});
ok('followTarget=true: render re-resolves the live carrier origin at draw time (not the stale update-time position)', () => {
  // Review gap (A): the documented contract says followTarget re-resolves the
  // live carrier at BOTH update() and render(). The update() half is covered
  // above; this proves the RENDER half. After an update, the carrier moves
  // WITHOUT any further update(); render() must stroke the arc centered at the
  // carrier's NEW (live) origin — not the position captured during the last
  // update(). Fixed dt = 1/60, exact within epsilon on the arc center coords.
  const c = movingCarrier(10, 20);
  const b = telegraphCircle({ duration: 1, followTarget: true }, c);
  b.update(DT); // update() resolves origin → (10, 20)
  assert.ok(close(b.origin.x, 10) && close(b.origin.y, 20), 'precondition: update() captured the fire-time origin');
  c.x = 500; c.y = 600; // carrier moves AFTER the last update — no further update() call
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(cc => cc[0] === 'arc');
  assert.ok(arc, 'circle drawn via arc');
  assert.ok(close(arc[1], 500) && close(arc[2], 600),
    `arc centered at the carrier's NEW live origin (got ${arc[1]},${arc[2]} — expected 500,600)`);
  assert.ok(!close(arc[1], 10) || !close(arc[2], 20), 'arc NOT centered at the stale update-time origin');
});
ok('pulseRate=0 disables the pulse (constant peak opacity)', () => {
  const b = telegraphCircle({ duration: 1, opacity: 0.7, pulseRate: 0 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const alpha = ctx.calls.find(c => c[0] === 'alpha')?.[1];
  assert.ok(close(alpha, 0.7, 1e-6), `alpha stays at peak with pulseRate 0 (got ${alpha})`);
});
ok('degenerate geometry (thickness 0 or opacity 0) draws nothing but still completes', () => {
  const bT = telegraphCircle({ thickness: 0, duration: 0.1 });
  const bO = telegraphCircle({ opacity: 0, duration: 0.1 });
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
ok('"telegraph-circle" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('telegraph-circle'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'telegraph-circle', params: { radius: 48, minRadius: 12, shrinkRate: 96, pulseRate: 4, thickness: 5, opacity: 0.85, duration: 0.4, x: 0, y: 100 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'telegraph-circle');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['stateChange', 'spawn']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      origin: () => ({ x: 10, y: 100 }),
      effects: [{ on: trigger, type: 'telegraph-circle', params: { radius: 48, minRadius: 12, shrinkRate: 96, duration: 0.4 } }],
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
    effects: [{ on: 'spawn', type: 'telegraph-circle', params: { radius: 48, minRadius: 12, shrinkRate: 96, duration: 0.4 } }],
  };
  const spawned = fire('spawn', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired a telegraph circle');
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
  const inst = fireManual({ type: 'telegraph-circle',
    params: { radius: 48, minRadius: 12, shrinkRate: 96, pulseRate: 4, thickness: 5, opacity: 0.85, duration: 0.4, x: 0, y: 100 } });
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
  assert.ok(drew >= 12, `demo actually drew the circle most frames (drew ${drew}/24)`);
  assert.equal(body.done, true, 'demo self-terminated at duration (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects shrinks the circle, then prunes', () => {
  resetEffects();
  const c = movingCarrier(0, 100);
  const inst = fireManual({ type: 'telegraph-circle', params: { radius: 48, minRadius: 12, shrinkRate: 96, duration: 0.4 } }, c);
  assert.ok(inst !== null, 'fired through the engine');
  let lastRadius = null;
  let drew = 0;
  for (let i = 1; i <= 24; i++) { // 24 frames = 0.4s
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(cc => cc[0] === 'stroke')) drew++;
    lastRadius = inst.body.radius;
  }
  assert.ok(drew >= 12, `drew the circle while active (drew ${drew}/24)`);
  assert.ok(close(lastRadius, 12), `circle reached the declared minRadius by end of life (${lastRadius})`);
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});

console.log(`${passed} passed`);
