// Task 5.8 (revised) — node-based unit tests for the slash effect
// (js/effects/slash.js, effects.md §21). Run:
// node js/test/slash.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Determinism note: the slash geometry is fully deterministic (no
// Math.random) — three parallel traces at a fixed angle relative to carrier
// facing, positioned at forwardOffset ahead of origin, fading linearly over
// duration. Assertions target the DOCUMENTED contract (declared params,
// declared lifetime, carrier-origin rule, carrier-facing orientation rule,
// fixed vs follow semantics), not internal literals.

import { strict as assert } from 'node:assert';
import { slash } from '../effects/slash.js';
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

/** Recording canvas stub: captures path/style writes. */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    closePath() { calls.push(['closePath']); },
    moveTo(...a) { calls.push(['moveTo', ...a]); },
    lineTo(...a) { calls.push(['lineTo', ...a]); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    get fillStyle() { return undefined; },
    set lineWidth(v) { calls.push(['lineWidth', v]); },
    get lineWidth() { return 1; },
    set lineCap(v) { calls.push(['lineCap', v]); },
    get lineCap() { return 'butt'; },
  };
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

console.log('lifetime');
ok('defaults: done exactly at the duration boundary, not before', () => {
  const s = slash({});
  const frames = Math.round(0.1 / DT); // default duration 0.1s → 6 frames
  for (let i = 0; i < frames - 1; i++) s.update(DT);
  assert.equal(s.done, false, 'not done just before the boundary');
  s.update(DT);
  assert.equal(s.done, true, 'done at the duration boundary');
});
ok('explicit duration is honored exactly', () => {
  const dur = 0.3;
  const s = slash({ duration: dur });
  for (let i = 0; i < Math.round(dur / DT) - 1; i++) s.update(DT);
  assert.equal(s.done, false, 'not done just before the boundary');
  s.update(DT);
  assert.equal(s.done, true, 'done at the duration boundary');
  assert.ok(close(s.elapsed, dur), `elapsed equals the declared duration (${s.elapsed})`);
});
ok('update after done is a no-op (elapsed frozen)', () => {
  const c = facingCarrier(0);
  const s = slash({ duration: 0.1 }, c);
  s.complete();
  const e = s.elapsed;
  c.x = 999;
  s.update(DT);
  assert.equal(s.elapsed, e, 'no further accumulation once done');
});

console.log('geometry');
ok('carrier origin() wins over params.x/y', () => {
  const c = facingCarrier(500, 10);
  const s = slash({ x: 999, y: 999, duration: 1 }, c);
  assert.ok(close(s.origin.x, 500) && close(s.origin.y, 10), 'carrier origin resolved');
});
ok('carrier without origin() falls back to params.x/y', () => {
  const s = slash({ x: 77, y: 5, duration: 1 }, { size: () => ({ w: 8, h: 8 }) });
  assert.ok(close(s.origin.x, 77) && close(s.origin.y, 5), 'params fallback used');
});
ok('draws traceCount filled triangles via moveTo/lineTo/fill', () => {
  const count = 4;
  const s = slash({ x: 30, y: 40, traceCount: count, length: 50, spacing: 8, thickness: 3, duration: 2 });
  s.update(DT);
  const ctx = makeCtx();
  s.render(ctx);
  const moves = ctx.calls.filter(c => c[0] === 'moveTo');
  const fills = ctx.calls.filter(c => c[0] === 'fill');
  assert.equal(moves.length, count, `${count} moveTo calls (one per trace base-left vertex)`);
  assert.equal(fills.length, count, `${count} fill calls (one per trace)`);
});
ok('trace length matches declared param (base to tip)', () => {
  const len = 52;
  const s = slash({ x: 0, y: 0, length: len, traceCount: 1, duration: 1 });
  s.update(DT);
  const ctx = makeCtx();
  s.render(ctx);
  // Triangle vertices: moveTo(baseLeft), lineTo(tip), lineTo(baseRight)
  const moves = ctx.calls.filter(c => c[0] === 'moveTo');
  const lines = ctx.calls.filter(c => c[0] === 'lineTo');
  // Base center is midpoint of first and last vertex; tip is the middle vertex
  const baseX = (moves[0][1] + lines[1][1]) / 2;
  const baseY = (moves[0][2] + lines[1][2]) / 2;
  const tipX = lines[0][1];
  const tipY = lines[0][2];
  const dist = Math.hypot(tipX - baseX, tipY - baseY);
  assert.ok(close(dist, len, 1e-6), `trace base-to-tip == ${len} (got ${dist})`);
});
ok('traces are spaced by the declared spacing perpendicular to the trace direction', () => {
  const spacing = 9;
  const s = slash({ x: 0, y: 0, length: 40, spacing, traceCount: 3, angle: -Math.PI / 4, duration: 1 });
  s.update(DT);
  const ctx = makeCtx();
  s.render(ctx);
  // Per trace: moveTo(baseLeft), lineTo(tip), lineTo(baseRight)
  // Trace i: moves[i], lines[2i](tip), lines[2i+1](baseRight)
  const moves = ctx.calls.filter(c => c[0] === 'moveTo');
  const lines = ctx.calls.filter(c => c[0] === 'lineTo');
  // Base center of trace 0: midpoint of moves[0] and lines[1]
  const b0x = (moves[0][1] + lines[1][1]) / 2, b0y = (moves[0][2] + lines[1][2]) / 2;
  // Base center of trace 1: midpoint of moves[1] and lines[3]
  const b1x = (moves[1][1] + lines[3][1]) / 2, b1y = (moves[1][2] + lines[3][2]) / 2;
  const dist = Math.hypot(b1x - b0x, b1y - b0y);
  assert.ok(close(dist, spacing, 1e-6), `adjacent trace bases separated by spacing (got ${dist}, want ${spacing})`);
});
ok('forwardOffset positions traces ahead of the carrier origin', () => {
  const off = 38;
  const s = slash({ x: 0, y: 0, forwardOffset: off, length: 40, traceCount: 1, duration: 1 });
  s.update(DT);
  const ctx = makeCtx();
  s.render(ctx);
  // Triangle: moveTo(baseLeft), lineTo(tip), lineTo(baseRight)
  const moves = ctx.calls.filter(c => c[0] === 'moveTo');
  const lines = ctx.calls.filter(c => c[0] === 'lineTo');
  // Trace center = midpoint of base-center and tip
  const baseCx = (moves[0][1] + lines[1][1]) / 2;
  const baseCy = (moves[0][2] + lines[1][2]) / 2;
  const tipX = lines[0][1], tipY = lines[0][2];
  const midX = (baseCx + tipX) / 2;
  const midY = (baseCy + tipY) / 2;
  // Default facing is +x (angle 0), so forward offset is along +x
  assert.ok(close(midX, off, 1e-6), `trace center at forwardOffset along facing (got x=${midX}, want ${off})`);
  assert.ok(close(midY, 0, 1e-6), `trace center at y=0 (got y=${midY})`);
});
ok('angle param offsets trace direction from carrier facing', () => {
  // Carrier faces +x (0 rad), angle = -PI/4 → traces go at -45°
  const ang = -Math.PI / 4;
  const s = slash({ x: 0, y: 0, angle: ang, length: 40, traceCount: 1, duration: 1 });
  s.update(DT);
  const ctx = makeCtx();
  s.render(ctx);
  // Direction from base center to tip
  const moves = ctx.calls.filter(c => c[0] === 'moveTo');
  const lines = ctx.calls.filter(c => c[0] === 'lineTo');
  const baseCx = (moves[0][1] + lines[1][1]) / 2;
  const baseCy = (moves[0][2] + lines[1][2]) / 2;
  const tipX = lines[0][1], tipY = lines[0][2];
  const dx = tipX - baseCx;
  const dy = tipY - baseCy;
  const actualAngle = Math.atan2(dy, dx);
  assert.ok(close(actualAngle, ang, 1e-6), `trace direction == facing + angle (got ${actualAngle}, want ${ang})`);
});

console.log('orientation & following');
ok('carrier facing() sets the base direction', () => {
  // Carrier faces +y (down): traces should be oriented relative to +y
  const c = facingCarrier(0, 0, 0, 1);
  const s = slash({ angle: 0, length: 40, traceCount: 1, duration: 1 }, c);
  assert.ok(close(s.facingAngle, Math.PI / 2), `facingAngle == atan2(1,0) = π/2 (got ${s.facingAngle})`);
});
ok('orientation param is fallback when carrier has no facing()', () => {
  const s = slash({ orientation: Math.PI / 3, length: 40, traceCount: 1, duration: 1 }, {});
  assert.ok(close(s.facingAngle, Math.PI / 3), `fallback orientation used (got ${s.facingAngle})`);
});
ok('fixed mode freezes facing at fire time', () => {
  const c = facingCarrier(0, 0, 1, 0);
  const s = slash({ length: 40, traceCount: 1, duration: 1 }, c);
  const firstFacing = s.facingAngle;
  c.facingX = 0; c.facingY = 1; // rotate AFTER fire
  s.update(DT);
  assert.ok(close(s.facingAngle, firstFacing), 'facing held frozen in fixed mode');
});
ok('followEntity re-resolves origin AND facing each frame', () => {
  const c = facingCarrier(0, 0, 1, 0);
  const s = slash({ length: 40, traceCount: 1, duration: 1, followEntity: true }, c);
  c.x = 120; c.y = -30; c.facingX = 0; c.facingY = 1;
  s.update(DT);
  assert.ok(close(s.origin.x, 120) && close(s.origin.y, -30), 'origin follows the live carrier');
  assert.ok(close(s.facingAngle, Math.PI / 2), 'facing follows the live carrier');
});

console.log('render');
ok('draws nothing once done', () => {
  const s = slash({ duration: 0.1 });
  for (let i = 0; i < 7; i++) s.update(DT);
  assert.equal(s.done, true, 'precondition: done');
  const ctx = makeCtx();
  s.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('alpha fades linearly from declared opacity toward 0', () => {
  const dur = 0.3;
  const s = slash({ duration: dur, opacity: 0.9, x: 0, y: 0 });
  s.update(DT);
  const ctx = makeCtx();
  s.render(ctx);
  const alpha = ctx.calls.find(c => c[0] === 'alpha')?.[1];
  assert.ok(alpha !== undefined, 'globalAlpha set during render');
  assert.ok(close(alpha, 0.9 * (1 - DT / dur), 1e-6),
    `alpha == opacity·(1 − t/duration) at t=dt (got ${alpha})`);
});
ok('fillStyle matches declared color', () => {
  const s = slash({ x: 0, y: 0, color: '#ff00aa', duration: 1 });
  s.update(DT);
  const ctx = makeCtx();
  s.render(ctx);
  const style = ctx.calls.find(c => c[0] === 'fillStyle');
  assert.ok(style, 'fillStyle set');
  assert.equal(style[1], '#ff00aa', 'color matches param');
});
ok('thickness controls the base width of each trace', () => {
  const s = slash({ x: 0, y: 0, thickness: 6, duration: 1 });
  s.update(DT);
  const ctx = makeCtx();
  s.render(ctx);
  // Base width = distance between the two base vertices (moveTo and last lineTo)
  const moves = ctx.calls.filter(c => c[0] === 'moveTo');
  const lines = ctx.calls.filter(c => c[0] === 'lineTo');
  const bLx = moves[0][1], bLy = moves[0][2];
  const bRx = lines[1][1], bRy = lines[1][2];
  const baseW = Math.hypot(bRx - bLx, bRy - bLy);
  assert.ok(close(baseW, 6, 1e-6), `base width == thickness (got ${baseW})`);
});
ok('degenerate geometry (length 0 or opacity 0) draws nothing but still completes', () => {
  const sL = slash({ length: 0, duration: 0.1 });
  const sO = slash({ opacity: 0, duration: 0.1, x: 0, y: 0 });
  for (let i = 0; i < 7; i++) { sL.update(DT); sO.update(DT); }
  for (const s of [sL, sO]) {
    const ctx = makeCtx();
    s.render(ctx);
    assert.equal(ctx.calls.length, 0, 'degenerate instance draws nothing');
  }
  assert.equal(sL.done, true, 'length-0 instance still completes');
  assert.equal(sO.done, true, 'opacity-0 instance still completes');
});

console.log('registration');
ok('"slash" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('slash'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'slash', params: { x: 0, y: 100, duration: 0.1, length: 50 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'slash');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['attackActive', 'hitLanded']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      origin: () => ({ x: 10, y: 100 }),
      facing: () => ({ x: 1, y: 0 }),
      effects: [{ on: trigger, type: 'slash', params: { duration: 0.1, length: 50 } }],
    };
    const spawned = fire(trigger, carrier);
    assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
    assert.equal(activeCount(), 1, 'instance entered the active set');
    resetEffects();
  });
}

console.log('standalone theater demo');
ok('standalone demo driven only by params (null carrier) — draws AND self-terminates', () => {
  resetEffects();
  const inst = fireManual({ type: 'slash',
    params: { x: 0, y: 100, duration: 0.1, length: 50, traceCount: 3, spacing: 9, thickness: 4, opacity: 0.95 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  const frames = Math.round(0.1 / DT);
  for (let i = 1; i <= frames; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'fill')) drew++;
  }
  assert.ok(drew >= 3, `demo actually drew the slash most frames (drew ${drew}/${frames})`);
  assert.equal(body.done, true, 'demo self-terminated at duration (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects draws traces, then prunes', () => {
  resetEffects();
  const c = facingCarrier(0, 100, 1, 0);
  const inst = fireManual({ type: 'slash', params: { duration: 0.2, length: 50, traceCount: 3 } }, c);
  assert.ok(inst !== null, 'fired through the engine');
  let drew = 0;
  const frames = Math.round(0.2 / DT);
  for (let i = 1; i <= frames; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(cc => cc[0] === 'fill')) drew++;
  }
  assert.ok(drew >= 5, `drew the slash while active (drew ${drew}/${frames})`);
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});

console.log(`${passed} passed`);
