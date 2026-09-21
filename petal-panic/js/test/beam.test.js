// Task 6.5 — node-based unit tests for the beam effect
// (js/effects/beam.js, effects.md §26). Run:
// node js/test/beam.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context that also captures createLinearGradient + addColorStop
// so the halo gradient draw can be asserted. Fixed dt = 1/60 per project
// convention.
//
// Determinism note: the beam geometry and alpha are fully deterministic (no
// Math.random) — the two-phase envelope (flash-in easeOutCubic ramp, fade-out
// linear decay) and the rotated-rect geometry are derived purely from elapsed
// time and params, so assertions on the documented contract (declared
// length/width/color, total lifetime == flashInTime + fadeOutTime, carrier-
// origin rule, carrier-facing orientation rule, two-phase alpha) are exact
// within epsilon. Assertions target the DOCUMENTED contract, not internal
// literals.

import { strict as assert } from 'node:assert';
import { beam } from '../effects/beam.js';
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

/** Recording canvas stub: captures save/restore/path/style writes, transforms,
 *  AND linear-gradient creation (createLinearGradient → object w/ addColorStop). */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    rect(...a) { calls.push(['rect', ...a]); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    translate(...a) { calls.push(['translate', ...a]); },
    rotate(...a) { calls.push(['rotate', ...a]); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
    set fillStyle(v) { calls.push(['style', v]); },
    get fillStyle() { return undefined; },
    createLinearGradient(...a) {
      const grad = { args: a, stops: [] };
      grad.addColorStop = function (stop, c) { this.stops.push([stop, c]); };
      calls.push(['grad', ...a, grad]);
      return grad;
    },
  };
}

/** Parse an rgba(r, g, b, a) string into [r,g,b,a] numbers. */
function parseRgba(s) {
  const m = s.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/);
  if (!m) throw new Error(`not an rgba() string: ${s}`);
  return [+m[1], +m[2], +m[3], +m[4]];
}

/** A carrier exposing both origin() and a mutable facing() direction. */
function facingCarrier(x = 0, y = 0, fx = 1, fy = 0) {
  let ox = x, oy = y, fxx = fx, fyy = fy;
  return {
    get x() { return ox; }, set x(v) { ox = v; },
    get y() { return oy; }, set y(v) { oy = v; },
    get facingX() { return fxx; }, set facingX(v) { fxx = v; },
    get facingY() { return fyy; }, set facingY(v) { fyy = v; },
    origin() { return { x: ox, y: oy }; },
    facing() { return { x: fxx, y: fyy }; },
  };
}

console.log('factory shape');
ok('factory returns the documented instance shape', () => {
  const b = beam({});
  assert.equal(b.space, 'world', 'world-space effect (two-pass model)');
  assert.equal(typeof b.done, 'boolean', 'done flag present');
  assert.equal(b.done, false, 'not done at spawn');
  assert.equal(typeof b.elapsed, 'number', 'elapsed clock present');
  assert.equal(b.elapsed, 0, 'elapsed starts at 0');
  assert.equal(typeof b.update, 'function', 'update(dt) present');
  assert.equal(typeof b.render, 'function', 'render(ctx) present');
  assert.equal(typeof b.complete, 'function', 'complete() present');
  assert.ok(b.origin && Number.isFinite(b.origin.x) && Number.isFinite(b.origin.y), 'origin resolved');
  assert.ok(Number.isFinite(b.angle), 'angle resolved');
});
ok('default total lifetime == default flashInTime + fadeOutTime exactly', () => {
  const b = beam({});
  assert.ok(close(b.flashInTime, 0.05), `default flashInTime (${b.flashInTime})`);
  assert.ok(close(b.fadeOutTime, 0.15), `default fadeOutTime (${b.fadeOutTime})`);
  assert.ok(close(b.duration, 0.2), `default duration == 0.2 (${b.duration})`);
  assert.ok(close(b.duration, b.flashInTime + b.fadeOutTime), 'duration == flashIn + fadeOut');
});

console.log('lifetime');
ok('total lifetime == flashInTime + fadeOutTime exactly (done at that point)', () => {
  const fin = 0.05, fout = 0.15; // 0.2s total = 12 frames at dt = 1/60
  const b = beam({ flashInTime: fin, fadeOutTime: fout });
  const frames = Math.round((fin + fout) / DT); // 12
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the lifetime boundary');
  assert.ok(close(b.elapsed, fin + fout), `elapsed equals the total lifetime (${b.elapsed})`);
});
ok('explicit non-default phases: done exactly at flashInTime + fadeOutTime', () => {
  const fin = 0.1, fout = 0.2; // 0.3s total = 18 frames
  const b = beam({ flashInTime: fin, fadeOutTime: fout });
  const frames = Math.round((fin + fout) / DT); // 18
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the lifetime boundary');
  assert.ok(close(b.elapsed, 0.3), `elapsed == 0.3 (${b.elapsed})`);
});
ok('update after done is a no-op (elapsed frozen)', () => {
  const c = facingCarrier(0, 0, 1, 0);
  const b = beam({ duration: 0.1 }, c);
  b.complete();
  const e = b.elapsed;
  c.x = 999;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
});

console.log('origin & orientation resolution');
ok('carrier origin() wins over params.x/y', () => {
  const c = facingCarrier(500, 10, 1, 0);
  const b = beam({ x: 999, y: 999 }, c);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 10), 'carrier origin resolved');
});
ok('carrier without origin() falls back to params.x/y', () => {
  const b = beam({ x: 77, y: 5 }, { size: () => ({ w: 8, h: 8 }) });
  assert.ok(close(b.origin.x, 77) && close(b.origin.y, 5), 'params fallback used');
});
ok('null carrier uses params.x/y (standalone/theater origin)', () => {
  const b = beam({ x: 12, y: -3 });
  assert.ok(close(b.origin.x, 12) && close(b.origin.y, -3), 'params origin used');
});
ok('carrier facing() determines the beam axis angle', () => {
  // Facing +y (down) → angle atan2(1, 0) = π/2, regardless of params.orientation.
  const c = facingCarrier(0, 0, 0, 1);
  const b = beam({ orientation: 0 }, c);
  assert.ok(close(b.angle, Math.PI / 2), `angle follows the carrier facing (got ${b.angle})`);
});
ok('carrier facing() wins over params.orientation', () => {
  const c = facingCarrier(0, 0, 1, 1); // facing 45° → angle π/4
  const b = beam({ orientation: 0 }, c);
  assert.ok(close(b.angle, Math.PI / 4), `facing beats params.orientation (got ${b.angle})`);
});
ok('orientation param sets the axis when the carrier has no facing()', () => {
  const b = beam({ orientation: Math.PI / 3 });
  assert.ok(close(b.angle, Math.PI / 3), 'params.orientation used when no facing()');
});
ok('fire-time facing is frozen (later rotation does NOT re-aim the beam)', () => {
  const c = facingCarrier(0, 0, 1, 0); // facing +x at fire time
  const b = beam({}, c);
  const firstAngle = b.angle;
  c.facingX = 0; c.facingY = 1; // carrier rotates AFTER fire
  b.update(DT);
  assert.ok(close(b.angle, firstAngle), 'axis held frozen in committed-strike mode');
});

console.log('flash-in phase (alpha ramps up)');
ok('alpha increases from 0 toward peak across [0, flashInTime]', () => {
  const fin = 0.05, fout = 0.15;
  const b = beam({ flashInTime: fin, fadeOutTime: fout, opacity: 1 });
  // Sample several frames strictly inside the flash-in window and confirm
  // alpha is monotonically increasing and stays below the peak until the
  // boundary frame.
  const frames = Math.round(fin / DT); // 3 frames = 0.05s
  let prev = -1;
  for (let i = 1; i <= frames - 1; i++) {
    b.update(DT);
    const ctx = makeCtx();
    b.render(ctx);
    const alpha = coreAlpha(ctx);
    assert.ok(alpha > prev, `alpha rising at t=${i * DT} (${prev} → ${alpha})`);
    assert.ok(alpha < 1 - EPS, 'alpha below peak before the flash-in boundary');
    prev = alpha;
  }
});
ok('alpha reaches the peak exactly at the flash-in boundary', () => {
  const fin = 0.05, fout = 0.15;
  const b = beam({ flashInTime: fin, fadeOutTime: fout, opacity: 0.9 });
  const frames = Math.round(fin / DT); // 3
  for (let i = 0; i < frames; i++) b.update(DT); // t == flashInTime
  const ctx = makeCtx();
  b.render(ctx);
  const alpha = coreAlpha(ctx);
  assert.ok(close(alpha, 0.9, 1e-9), `alpha == peak at the flash-in boundary (got ${alpha})`);
});
ok('halo expands during flash-in (widest at the peak)', () => {
  const fin = 0.05, fout = 0.15;
  const b = beam({ flashInTime: fin, fadeOutTime: fout, gradientRadius: 20 });
  const frames = Math.round(fin / DT); // 3
  for (let i = 0; i < frames; i++) b.update(DT); // t == flashInTime → haloScale 1
  const ctx = makeCtx();
  b.render(ctx);
  const grad = ctx.calls.find(c => c[0] === 'grad')[5];
  // Gradient spans local Y from −(halfW + haloR) to +(halfW + haloR).
  // args = [x0, y0, x1, y1] = [0, -(halfW+haloR), 0, halfW+haloR].
  // At the peak haloScale == 1, so the outer stop sits at halfW + gradientRadius.
  const halfW = 18 / 2; // default width 18
  const outer = Math.abs(grad.args[3]); // y1 = +(halfW + haloR)
  assert.ok(close(outer, halfW + 20, 1e-9),
    `halo extent == gradientRadius at the peak (got ${outer}, want ${halfW + 20})`);
});

console.log('fade-out phase (alpha decays to 0)');
ok('alpha decreases from peak toward 0 across [flashInTime, lifetime]', () => {
  const fin = 0.05, fout = 0.15;
  const b = beam({ flashInTime: fin, fadeOutTime: fout, opacity: 1 });
  const totalFrames = Math.round((fin + fout) / DT); // 12
  // Advance to just past the flash-in boundary, then sample the decay.
  for (let i = 0; i < Math.round(fin / DT); i++) b.update(DT); // t == flashInTime
  let prev = 2;
  for (let i = 1; i <= totalFrames - Math.round(fin / DT) - 1; i++) {
    b.update(DT);
    const ctx = makeCtx();
    b.render(ctx);
    const alpha = coreAlpha(ctx);
    assert.ok(alpha < prev, `alpha falling at t=${b.elapsed} (${prev} → ${alpha})`);
    assert.ok(alpha > 0, 'alpha still above 0 before completion');
    prev = alpha;
  }
});
ok('alpha decays LINEARLY through the fade-out phase', () => {
  const fin = 0.05, fout = 0.15;
  const b = beam({ flashInTime: fin, fadeOutTime: fout, opacity: 1 });
  // Probe a frame partway through the fade-out and check the linear formula.
  const startFrame = Math.round(fin / DT); // 3
  const probe = startFrame + 3; // t = 6·dt
  for (let i = 0; i < probe; i++) b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const q = (probe * DT - fin) / fout; // fade progress in [0,1]
  const expected = 1 - q;
  const alpha = coreAlpha(ctx);
  assert.ok(close(alpha, expected, 1e-9),
    `alpha == 1 − fadeProgress at t=${probe * DT} (got ${alpha}, want ${expected})`);
});
ok('alpha reaches ~0 near completion (last visible frame just above 0)', () => {
  const fin = 0.05, fout = 0.15;
  const b = beam({ flashInTime: fin, fadeOutTime: fout, opacity: 1 });
  const totalFrames = Math.round((fin + fout) / DT); // 12
  for (let i = 0; i < totalFrames - 1; i++) b.update(DT); // last VISIBLE frame
  assert.equal(b.done, false, 'precondition: last visible frame is one step short');
  const ctx = makeCtx();
  b.render(ctx);
  const alpha = coreAlpha(ctx);
  assert.ok(alpha > 0 && alpha < 0.15, `last visible frame alpha small but > 0 (got ${alpha})`);
});

console.log('render geometry');
ok('draws ONE filled rotated rectangle anchored at the origin, extending forward along the facing', () => {
  const b = beam({ x: 30, y: 40, length: 100, width: 20, gradientRadius: 10, orientation: 0, opacity: 1 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
  const fills = ctx.calls.filter(c => c[0] === 'fill');
  assert.equal(fills.length, 1, 'exactly one fill call');
  const grads = ctx.calls.filter(c => c[0] === 'grad');
  assert.equal(grads.length, 1, 'exactly one linear gradient created');
  // The transform moves to the origin and rotates by the facing angle.
  const tr = ctx.calls.find(c => c[0] === 'translate');
  assert.ok(tr && close(tr[1], 30) && close(tr[2], 40), `translated to the origin (got ${tr && tr[1]},${tr && tr[2]})`);
  const rot = ctx.calls.find(c => c[0] === 'rotate');
  assert.ok(rot && close(rot[1], 0), `rotated by the facing angle (got ${rot && rot[1]})`);
  // The local rect is ANCHORED at the origin and extends forward: x = 0,
  // y = −(halfW + haloR). At t = dt (flash-in frame 1) haloScale = p = dt/fin,
  // so haloR = gradientRadius · (dt / fin).
  const halfW = 20 / 2;             // width 20 → halfW 10
  const haloR = 10 * (DT / 0.05);   // gradientRadius 10 · haloScale(dt/0.05)
  const rect = ctx.calls.find(c => c[0] === 'rect');
  assert.ok(rect, 'rectangle drawn via rect()');
  assert.ok(close(rect[1], 0) && close(rect[2], -(halfW + haloR)),
    `rect anchored at the origin, near edge at local x=0 (got ${rect[1]},${rect[2]})`);
  assert.ok(close(rect[3], 100) && close(rect[4], 20 + 2 * haloR),
    `rect size == declared length × (width + 2·haloR) (got ${rect[3]}×${rect[4]})`);
  // fillStyle is the created gradient object itself.
  const style = ctx.calls.find(c => c[0] === 'style');
  assert.equal(style[1], grads[0][5], 'fillStyle is the created gradient');
});
ok('the rectangle is oriented along the carrier facing (rotation == facing angle)', () => {
  const c = facingCarrier(0, 0, 0, 1); // facing +y → angle π/2
  const b = beam({ length: 100, width: 20, opacity: 1 }, c);
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const rot = ctx.calls.find(cc => cc[0] === 'rotate');
  assert.ok(rot && close(rot[1], Math.PI / 2),
    `beam rotated along the carrier facing (got ${rot && rot[1]}, want π/2)`);
});
ok('halo gradient: symmetric 4-stop profile with flat bright core', () => {
  // Use a frame where haloScale is exactly 1 (the flash-in boundary) so the
  // coreFrac assertion is exact. With width 20 and gradientRadius 10:
  // halfW = 10, span = 20, coreFrac = haloR/span = 10/20 = 0.5.
  const fin = 0.05, fout = 0.15;
  const b = beam({ x: 0, y: 0, length: 100, width: 20, gradientRadius: 10, color: '#ff0000', opacity: 0.8, flashInTime: fin, fadeOutTime: fout });
  for (let i = 0; i < Math.round(fin / DT); i++) b.update(DT); // t == flashInTime → haloScale 1
  const ctx = makeCtx();
  b.render(ctx);
  const grad = ctx.calls.find(c => c[0] === 'grad')[5];
  assert.equal(grad.stops.length, 4, 'four gradient stops (edge, core-start, core-end, edge)');
  const [[p0, c0], [p1, c1], [p2, c2], [p3, c3]] = grad.stops;
  const halfW = 20 / 2, haloR = 10, span = halfW + haloR;
  const coreFrac = haloR / span; // 10/20 = 0.5
  // Stop positions
  assert.ok(close(p0, 0), `stop 0 at position 0 (got ${p0})`);
  assert.ok(close(p1, coreFrac), `core-start stop at coreFrac (got ${p1}, want ${coreFrac})`);
  assert.ok(close(p2, 1 - coreFrac), `core-end stop at 1−coreFrac (got ${p2}, want ${1 - coreFrac})`);
  assert.ok(close(p3, 1), `stop 3 at position 1 (got ${p3})`);
  // Symmetry: the two peak stops mirror around 0.5
  assert.ok(close(p1 + p2, 1), `symmetric: coreFrac + (1−coreFrac) == 1 (got ${p1 + p2})`);
  // Alphas
  const [, , , a0] = parseRgba(c0);
  const [cr, cg, cb, ac1] = parseRgba(c1);
  const [, , , ac2] = parseRgba(c2);
  const [, , , a3] = parseRgba(c3);
  assert.ok(close(a0, 0), `outer edge alpha == 0 (got ${a0})`);
  assert.ok(close(a3, 0), `outer edge alpha == 0 (got ${a3})`);
  assert.ok(ac1 > 0, `core-start alpha > 0 during the life (got ${ac1})`);
  assert.ok(close(ac1, ac2), `both peak stops have equal alpha (got ${ac1} vs ${ac2})`);
  assert.deepEqual([cr, cg, cb], [255, 0, 0], `core color channels match the declared color (got ${cr},${cg},${cb})`);
});
ok('haloR=0: uniform fill (both peak stops at 0 and 1)', () => {
  // When gradientRadius is 0, haloR = 0, span = halfW, coreFrac = 0.
  // The two peak stops collapse to positions 0 and 1 → a solid uniform fill.
  const fin = 0.05, fout = 0.15;
  const b = beam({ x: 0, y: 0, length: 100, width: 20, gradientRadius: 0, color: '#00ff00', opacity: 0.9, flashInTime: fin, fadeOutTime: fout });
  for (let i = 0; i < Math.round(fin / DT); i++) b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const grad = ctx.calls.find(c => c[0] === 'grad')[5];
  assert.equal(grad.stops.length, 4, 'still four stops even with no halo');
  const [[p0, c0], [p1, c1], [p2, c2], [p3, c3]] = grad.stops;
  assert.ok(close(p0, 0), `stop 0 at 0 (got ${p0})`);
  assert.ok(close(p1, 0), `core-start at 0 when haloR=0 (got ${p1})`);
  assert.ok(close(p2, 1), `core-end at 1 when haloR=0 (got ${p2})`);
  assert.ok(close(p3, 1), `stop 3 at 1 (got ${p3})`);
  const [, , , a0] = parseRgba(c0);
  const [, , , a1] = parseRgba(c1);
  const [, , , a2] = parseRgba(c2);
  const [, , , a3] = parseRgba(c3);
  // At the outer edges (positions 0 and 1) there are duplicate stops:
  // position 0 has both alpha-0 and peak-alpha; canvas uses the last one added.
  // But structurally we verify the alphas are as expected.
  assert.ok(close(a0, 0), `stop 0 alpha == 0 (got ${a0})`);
  assert.ok(a1 > 0, `core-start alpha > 0 (got ${a1})`);
  assert.ok(a2 > 0, `core-end alpha > 0 (got ${a2})`);
  assert.ok(close(a3, 0), `stop 3 alpha == 0 (got ${a3})`);
  // Both peak stops carry the same alpha (uniform core)
  assert.ok(close(a1, a2), `peak stops equal (got ${a1} vs ${a2})`);
});
ok('declared color drives the core (hex parsing)', () => {
  const b = beam({ color: '#00ff88', length: 50, width: 10, opacity: 1 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const grad = ctx.calls.find(c => c[0] === 'grad')[5];
  const [r, g, b2] = parseRgba(grad.stops[1][1]);
  assert.deepEqual([r, g, b2], [0, 255, 136], `color parsed correctly (got ${r},${g},${b2})`);
});
ok('degenerate: zero length draws nothing (timer still runs to completion)', () => {
  const b = beam({ length: 0, width: 20 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'zero length → no draw');
  for (let i = 0; i < 11; i++) b.update(DT);
  assert.equal(b.done, true, 'zero-length instance still completes at the lifetime');
});
ok('degenerate: zero width draws nothing (timer still runs to completion)', () => {
  const b = beam({ length: 100, width: 0 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'zero width → no draw');
  for (let i = 0; i < 11; i++) b.update(DT);
  assert.equal(b.done, true, 'zero-width instance still completes at the lifetime');
});
ok('draws nothing once done', () => {
  const b = beam({ flashInTime: 0.05, fadeOutTime: 0.15 });
  for (let i = 0; i < 12; i++) b.update(DT); // 12 frames = 0.2s ≥ lifetime
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});

console.log('registration');
ok('"beam" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('beam'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'beam', params: { length: 120, width: 18, color: '#7df', flashInTime: 0.05, fadeOutTime: 0.15, x: 0, y: 100 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'beam');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
ok('attachable via carrier config on its documented trigger (attackActive)', () => {
  resetEffects();
  const carrier = {
    origin: () => ({ x: 10, y: 100 }),
    facing: () => ({ x: 1, y: 0 }),
    effects: [{ on: 'attackActive', type: 'beam', params: { length: 120, width: 18 } }],
  };
  const spawned = fire('attackActive', carrier);
  assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
ok('attachable via a NON-ENTITY carrier shape (plain marker object) through fire()', () => {
  // Proves generic carrier support: a plain data object with origin() + facing()
  // and an effects array — no entity class — drives a real fire().
  resetEffects();
  const marker = {
    kind: 'marker',
    origin: () => ({ x: 5, y: 100 }),
    facing: () => ({ x: 0, y: 1 }),
    effects: [{ on: 'attackActive', type: 'beam', params: { length: 80, width: 12 } }],
  };
  const spawned = fire('attackActive', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired a beam');
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
  const inst = fireManual({ type: 'beam',
    params: { length: 120, width: 18, gradientRadius: 14, color: '#7df', flashInTime: 0.05, fadeOutTime: 0.15, x: 0, y: 100 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  const frames = Math.round((0.05 + 0.15) / DT); // 12 frames = 0.2s
  for (let i = 1; i <= frames; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'fill')) drew++;
  }
  assert.ok(drew >= 8, `demo actually drew the beam most frames (drew ${drew}/${frames})`);
  assert.equal(body.done, true, 'demo self-terminated at the lifetime (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects plays the beam, then prunes', () => {
  resetEffects();
  const c = facingCarrier(0, 100, 1, 0);
  const inst = fireManual({ type: 'beam', params: { length: 120, width: 18, flashInTime: 0.05, fadeOutTime: 0.15 } }, c);
  assert.ok(inst !== null, 'fired through the engine');
  let drew = 0;
  const frames = Math.round(0.2 / DT); // 12 frames
  for (let i = 1; i <= frames; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(cc => cc[0] === 'fill')) drew++;
  }
  assert.ok(drew >= 8, `drew the beam while active (drew ${drew}/${frames})`);
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('two-pass model: beam renders in the world pass, NOT the screen pass', () => {
  resetEffects();
  const inst = fireManual({ type: 'beam', params: { length: 120, width: 18, flashInTime: 0.05, fadeOutTime: 0.15, x: 0, y: 0 } });
  assert.ok(inst !== null, 'fired through the engine');
  updateEffects(DT); // one frame: still active
  const worldCtx = makeCtx();
  drawEffects(worldCtx, undefined, { space: 'world' });
  assert.ok(worldCtx.calls.some(c => c[0] === 'fill'), 'world pass drew the beam');
  const screenCtx = makeCtx();
  drawEffects(screenCtx, { view: { w: 640, h: 480 } }, { space: 'screen' });
  assert.equal(screenCtx.calls.length, 0, 'screen pass must not draw a world-space effect');
  resetEffects();
});
ok('complete() force-completes (engine reset path)', () => {
  const b = beam({ flashInTime: 0.05, fadeOutTime: 0.15 });
  assert.equal(b.done, false);
  b.complete();
  assert.equal(b.done, true);
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw after forced completion');
});

/** Extract the core (peak) alpha from a recorded render's gradient. */
function coreAlpha(ctx) {
  const grad = ctx.calls.find(c => c[0] === 'grad');
  if (!grad) return -1;
  const obj = grad[5];
  // The core stop is stops[1] (the first peak stop at coreFrac); its alpha is
  // the documented core brightness for this frame. Both peak stops (indices 1
  // and 2) carry equal alpha, so either works.
  const core = obj.stops[1];
  const [, , , a] = parseRgba(core[1]);
  return a;
}

console.log(`${passed} passed`);
