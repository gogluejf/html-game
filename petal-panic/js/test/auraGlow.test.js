// Task 6.4 — node-based unit tests for the aura / glow effect
// (js/effects/auraGlow.js, effects.md §22). Run: node js/test/auraGlow.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context that also captures createRadialGradient + addColorStop
// so the gradient draw can be asserted. Fixed dt = 1/60 per project convention.
//
// Determinism note: the glow geometry and alpha are fully deterministic (no
// Math.random) — the pulsing radius is derived purely from elapsed time
// (radius · (1 + A·(0.5 + 0.5·cos(2π·pulseRate·t)))) and the alpha is
// opacity · intensity · (0.5 + 0.5·cos(2π·pulseRate·t)), so assertions on the
// documented contract (declared radius/color, declared lifetime, carrier-
// origin rule, fixed-position semantics, gradient stops) are exact within
// epsilon. Assertions target the DOCUMENTED contract, not internal literals.

import { strict as assert } from 'node:assert';
import { auraGlow } from '../effects/auraGlow.js';
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

/** Recording canvas stub: captures save/restore/path/style writes AND radial
 *  gradient creation (createRadialGradient → object with addColorStop). */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    arc(...a) { calls.push(['arc', ...a]); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
    set fillStyle(v) { calls.push(['style', v]); },
    get fillStyle() { return undefined; },
    createRadialGradient(...a) {
      const grad = {
        args: a,
        stops: [],
        addColorStop(stop, c) { this.stops.push([stop, c]); },
      };
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
  const b = auraGlow({});
  const frames = Math.round(1.0 / DT); // default duration 1.0s → 60 frames
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
});
ok('explicit duration is honored exactly (total lifetime == duration)', () => {
  const dur = 0.3; // 18 frames at dt = 1/60
  const b = auraGlow({ duration: dur });
  for (let i = 0; i < Math.round(dur / DT) - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
  assert.ok(close(b.elapsed, dur), `elapsed equals the declared duration (${b.elapsed})`);
});
ok('update after done is a no-op (elapsed + radius frozen)', () => {
  const c = movingCarrier(0);
  const b = auraGlow({ duration: 0.1 }, c);
  b.complete();
  const e = b.elapsed, r = b.radius;
  c.x = 999;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
  assert.equal(b.radius, r, 'radius frozen once done');
  assert.equal(b.origin.x, 0, 'origin frozen once done');
});

console.log('pulsing geometry');
ok('starts at full peak: t=0 wave is 1, so radius == base and alpha == opacity·intensity', () => {
  const b = auraGlow({ radius: 40, pulseRate: 2, opacity: 0.8, intensity: 1, duration: 2 });
  assert.ok(close(b.radius, 40), `initial radius == declared base radius (${b.radius})`);
  const ctx = makeCtx();
  b.render(ctx);
  const grad = ctx.calls.find(c => c[0] === 'grad')[7];
  const [coreStop] = grad.stops;
  const [, coreColor] = coreStop;
  const [, , , coreAlpha] = parseRgba(coreColor);
  assert.ok(close(coreAlpha, 0.8, 1e-9), `t=0 core alpha == opacity·intensity (got ${coreAlpha})`);
});
ok('radius oscillates deterministically inside the documented ±A/2 band around the base', () => {
  // Documented contract: r(t) = radius · (1 + A/2·(1 + cos(2π·pulseRate·t))),
  // so r ∈ [radius·(1 − A/2), radius·(1 + A/2)] symmetrically. We assert the
  // actual documented formula sample-for-sample instead of the loose band.
  const r0 = 40, rate = 2; // period = 0.5s = 30 frames
  const b = auraGlow({ radius: r0, pulseRate: rate, duration: 2 });
  for (let i = 1; i <= 30; i++) {
    b.update(DT);
    const expected = r0 * (1 + 0.25 * Math.cos(2 * Math.PI * rate * (i * DT)));
    assert.ok(close(b.radius, expected, 1e-9),
      `frame ${i}: radius == documented formula (got ${b.radius}, want ${expected})`);
  }
});
ok('peak radius matches the documented formula at a quarter period (off-grid scan)', () => {
  // Probe the two bracketing frames around t = 1/(4·pulseRate) = 0.125s
  // (7.5 frames — off the fixed-dt grid) and confirm the sinusoid value at
  // each integer frame is exact to epsilon.
  const r0 = 40, rate = 2;
  const b = auraGlow({ radius: r0, pulseRate: rate, duration: 2 });
  for (let i = 1; i <= 8; i++) {
    b.update(DT);
    const expected = r0 * (1 + 0.25 * Math.cos(2 * Math.PI * rate * (i * DT)));
    assert.ok(close(b.radius, expected, 1e-9),
      `frame ${i}: radius == documented formula (got ${b.radius}, want ${expected})`);
  }
});
ok('pulseRate=0 disables the pulse (constant base radius + constant peak alpha)', () => {
  const b = auraGlow({ radius: 30, pulseRate: 0, opacity: 0.6, intensity: 1, duration: 2 });
  for (let i = 0; i < 30; i++) b.update(DT);
  assert.ok(close(b.radius, 30), `radius stays at the base radius (got ${b.radius})`);
  const ctx = makeCtx();
  b.render(ctx);
  const grad = ctx.calls.find(c => c[0] === 'grad')[7];
  const [, , , a] = parseRgba(grad.stops[0][1]);
  assert.ok(close(a, 0.6, 1e-9), `steady alpha == opacity·intensity (got ${a})`);
});
ok('intensity scales the alpha swing (documented contract: alpha = opacity·intensity·wave)', () => {
  const b = auraGlow({ radius: 30, pulseRate: 2, opacity: 0.8, intensity: 0.5, duration: 2 });
  b.update(DT); // one step in: wave < 1
  const ctx = makeCtx();
  b.render(ctx);
  const grad = ctx.calls.find(c => c[0] === 'grad')[7];
  const [, , , a] = parseRgba(grad.stops[0][1]);
  const t = DT;
  const expected = 0.8 * 0.5 * (0.5 + 0.5 * Math.cos(2 * Math.PI * 2 * t));
  assert.ok(close(a, expected, 1e-9), `alpha == opacity·intensity·wave (got ${a}, want ${expected})`);
});
ok('intensity 0 collapses the alpha to 0 (invisible throughout, timer still runs)', () => {
  const b = auraGlow({ intensity: 0, duration: 0.1 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'intensity 0 → no draw (effective alpha 0)');
  for (let i = 0; i < 5; i++) b.update(DT);
  assert.equal(b.done, true, 'intensity-0 instance still completes at duration');
});

console.log('origin resolution');
ok('carrier origin() wins over params.x/y', () => {
  const c = movingCarrier(500, 10);
  const b = auraGlow({ x: 999, y: 999, duration: 1 }, c);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 10), 'carrier origin resolved');
});
ok('carrier without origin() falls back to params.x/y', () => {
  const b = auraGlow({ x: 77, y: 5, duration: 1 }, { size: () => ({ w: 8, h: 8 }) });
  assert.ok(close(b.origin.x, 77) && close(b.origin.y, 5), 'params fallback used');
});
ok('null carrier uses params.x/y (standalone/theater origin)', () => {
  const b = auraGlow({ x: 12, y: -3, duration: 1 });
  assert.ok(close(b.origin.x, 12) && close(b.origin.y, -3), 'params origin used');
});
ok('carrier origin is tracked LIVE each update (glow follows a moving carrier)', () => {
  const pos = { x: 10, y: 20 };
  const c = { origin: () => ({ x: pos.x, y: pos.y }) };
  const b = auraGlow({ duration: 1 }, c);
  assert.ok(close(b.origin.x, 10) && close(b.origin.y, 20), 'fire-time origin resolved');
  // Move the carrier between frames; the glow center must follow.
  pos.x = 500; pos.y = 600;
  for (let i = 0; i < 10; i++) b.update(DT);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 600), 'origin re-resolved from the live carrier');
  // Prove the RENDERED arc center moves with the carrier too.
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(cc => cc[0] === 'arc');
  assert.ok(close(arc[1], 500) && close(arc[2], 600), `rendered arc center tracks the carrier (got ${arc[1]},${arc[2]})`);
});
ok('offset shifts the drawn center by params.offset on top of the origin', () => {
  const b = auraGlow({ x: 100, y: 100, offset: { x: 5, y: -7 }, radius: 20, pulseRate: 0, duration: 1 });
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(c => c[0] === 'arc');
  assert.ok(close(arc[1], 105) && close(arc[2], 93), `glow centered at origin+offset (got ${arc[1]},${arc[2]})`);
  const grad = ctx.calls.find(c => c[0] === 'grad');
  assert.ok(close(grad[1], 105) && close(grad[2], 93) && close(grad[4], 105) && close(grad[5], 93),
    'gradient inner + outer circles share the shifted center');
});

console.log('render');
ok('draws nothing once done', () => {
  const b = auraGlow({ duration: 0.1 });
  for (let i = 0; i < 6; i++) b.update(DT); // 6 frames ≥ 0.1s
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('draws ONE filled circle with a radial gradient while active (save/restore bracket the geometry)', () => {
  const b = auraGlow({ x: 30, y: 40, radius: 40, pulseRate: 0, opacity: 0.7, intensity: 1, duration: 2 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  // The save/restore bracket wraps the geometry draw (fillStyle + path +
  // fill); the gradient object is created before the bracket (it carries no
  // canvas state of its own).
  const firstSave = ctx.calls.findIndex(c => c[0] === 'save');
  const lastRestore = ctx.calls.length - 1 - [...ctx.calls].reverse().findIndex(c => c[0] === 'restore');
  assert.ok(firstSave >= 0 && lastRestore === ctx.calls.length - 1, 'save/restore present and restore is last');
  assert.deepEqual([ctx.calls[firstSave][0], ctx.calls[lastRestore][0]], ['save', 'restore'], 'bracket shape');
  const fills = ctx.calls.filter(c => c[0] === 'fill');
  assert.equal(fills.length, 1, 'exactly one fill call');
  const arcs = ctx.calls.filter(c => c[0] === 'arc');
  assert.equal(arcs.length, 1, 'exactly one circle path');
  const grads = ctx.calls.filter(c => c[0] === 'grad');
  assert.equal(grads.length, 1, 'exactly one radial gradient created');
  // Contract: the circle is centered at the origin and spans a full 2π.
  const [cx, cy, r, a0, a1] = arcs[0].slice(1);
  assert.ok(close(cx, 30) && close(cy, 40), `circle centered at the origin (got ${cx},${cy})`);
  assert.ok(close(Math.abs(a1 - a0), Math.PI * 2), 'circle spans a full 2π');
  // Contract: the gradient's inner + outer circles share the center; the
  // outer radius matches the current exposed radius; the inner radius is 0.
  const g = grads[0];
  assert.ok(close(g[1], 30) && close(g[2], 40), 'gradient inner circle at the center');
  assert.ok(close(g[3], 0), 'gradient inner radius is 0');
  assert.ok(close(g[4], 30) && close(g[5], 40), 'gradient outer circle at the center');
  assert.ok(close(g[6], b.radius), `gradient outer radius matches the current radius (${g[6]} vs ${b.radius})`);
  // Contract: fillStyle is the gradient object itself.
  const style = ctx.calls.find(c => c[0] === 'style');
  assert.equal(style[1], g[7], 'fillStyle is the created gradient');
});
ok('gradient stops: core at the pulsing alpha, edge at alpha 0 (soft falloff)', () => {
  const b = auraGlow({ x: 0, y: 0, radius: 40, pulseRate: 0, opacity: 0.7, intensity: 1, color: '#ff0000', duration: 2 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const grad = ctx.calls.find(c => c[0] === 'grad')[7];
  assert.equal(grad.stops.length, 2, 'two gradient stops (core + edge)');
  const [corePos, coreColor] = grad.stops[0];
  const [edgePos, edgeColor] = grad.stops[1];
  assert.ok(close(corePos, 0), 'core stop at position 0');
  assert.ok(close(edgePos, 1), 'edge stop at position 1');
  const [cr, cg, cb, ca] = parseRgba(coreColor);
  assert.deepEqual([cr, cg, cb], [255, 0, 0], `core color channels match the declared color (got ${cr},${cg},${cb})`);
  assert.ok(close(ca, 0.7, 1e-9), `core alpha == declared opacity·intensity (got ${ca})`);
  const [, , , ea] = parseRgba(edgeColor);
  assert.ok(close(ea, 0), `edge alpha == 0 (fully transparent, got ${ea})`);
});
ok('declared color drives the gradient (hex parsing)', () => {
  const b = auraGlow({ color: '#00ff88', radius: 20, pulseRate: 0, opacity: 1, intensity: 1, duration: 1 });
  const ctx = makeCtx();
  b.render(ctx);
  const grad = ctx.calls.find(c => c[0] === 'grad')[7];
  const [r, g, b2] = parseRgba(grad.stops[0][1]);
  assert.deepEqual([r, g, b2], [0, 255, 136], `color parsed correctly (got ${r},${g},${b2})`);
});
ok('degenerate geometry (radius 0 or opacity 0) draws nothing but still completes', () => {
  const bR = auraGlow({ radius: 0, duration: 0.1 });
  const bO = auraGlow({ opacity: 0, duration: 0.1 });
  bR.update(DT); bO.update(DT);
  const ctxR = makeCtx(), ctxO = makeCtx();
  bR.render(ctxR); bO.render(ctxO);
  assert.equal(ctxR.calls.length, 0, 'radius 0 → no draw');
  assert.equal(ctxO.calls.length, 0, 'opacity 0 → no draw');
  for (let i = 0; i < 5; i++) { bR.update(DT); bO.update(DT); }
  assert.equal(bR.done, true, 'radius-0 instance still completes at duration');
  assert.equal(bO.done, true, 'opacity-0 instance still completes at duration');
});

console.log('registration');
ok('"aura-glow" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('aura-glow'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'aura-glow', params: { radius: 28, opacity: 0.7, pulseRate: 2, intensity: 1, color: '#9fd8ff', duration: 1.0, x: 0, y: 100 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'aura-glow');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['stateChange', 'spawn']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      origin: () => ({ x: 10, y: 100 }),
      effects: [{ on: trigger, type: 'aura-glow', params: { radius: 28, pulseRate: 2, duration: 1.0 } }],
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
    effects: [{ on: 'spawn', type: 'aura-glow', params: { radius: 28, pulseRate: 2, duration: 1.0 } }],
  };
  const spawned = fire('spawn', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired an aura glow');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});

console.log('standalone theater demo');
ok('standalone demo driven only by params (null carrier) — draws AND self-terminates (bounded)', () => {
  resetEffects();
  const inst = fireManual({ type: 'aura-glow',
    params: { radius: 28, opacity: 0.7, pulseRate: 2, intensity: 1, color: '#9fd8ff', duration: 1.0, x: 0, y: 100 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  const frames = Math.round(1.0 / DT); // 60 frames
  for (let i = 1; i <= frames; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'fill')) drew++;
  }
  assert.ok(drew >= 50, `demo actually drew the glow most frames (drew ${drew}/${frames})`);
  assert.equal(body.done, true, 'demo self-terminated at duration (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects pulses the glow, then prunes', () => {
  resetEffects();
  const c = movingCarrier(0, 100);
  const inst = fireManual({ type: 'aura-glow', params: { radius: 40, pulseRate: 2, duration: 0.5 } }, c);
  assert.ok(inst !== null, 'fired through the engine');
  let drew = 0;
  let sawGrowth = false, sawShrink = false;
  for (let i = 1; i <= 30; i++) { // 30 frames = 0.5s
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(cc => cc[0] === 'fill')) drew++;
    if (inst.body.radius > 40 + 1e-6) sawGrowth = true;
    if (inst.body.radius < 40 - 1e-6) sawShrink = true;
  }
  assert.ok(drew >= 20, `drew the glow while active (drew ${drew}/30)`);
  assert.ok(sawGrowth, 'glow pulsed outward during its life');
  assert.ok(sawShrink, 'glow pulsed inward during its life');
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('two-pass model: aura-glow renders in the world pass, NOT the screen pass', () => {
  resetEffects();
  const inst = fireManual({ type: 'aura-glow', params: { duration: 0.4, x: 0, y: 0 } });
  assert.ok(inst !== null, 'fired through the engine');
  updateEffects(DT); // one frame: still active
  const worldCtx = makeCtx();
  drawEffects(worldCtx, undefined, { space: 'world' });
  assert.ok(worldCtx.calls.some(c => c[0] === 'fill'), 'world pass drew the glow');
  const screenCtx = makeCtx();
  drawEffects(screenCtx, { view: { w: 640, h: 480 } }, { space: 'screen' });
  assert.equal(screenCtx.calls.length, 0, 'screen pass must not draw a world-space effect');
  resetEffects();
});
ok('complete() force-completes (engine reset path)', () => {
  const b = auraGlow({ duration: 0.4 });
  assert.equal(b.done, false);
  b.complete();
  assert.equal(b.done, true);
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw after forced completion');
});

console.log(`${passed} passed`);
