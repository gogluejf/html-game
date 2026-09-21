// Task 5.6 — node-based unit tests for the ground target marker effect
// (js/effects/groundMarker.js, effects.md §9). Run:
// node js/test/groundMarker.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Determinism note: the ground marker geometry is fully deterministic (no
// Math.random) — the outer-ring radius is derived purely from elapsed time
// (radius · (1 + A·sin(2π·pulseRate·t))) and the tick angle is a linear
// function of elapsed time (rotation + speed·t), so assertions on radius,
// drawn arc coordinates, tick endpoints, and alpha are exact within epsilon.
// Assertions target the DOCUMENTED contract (declared params, declared
// lifetime, carrier-origin rule, fixed-position semantics), not internal
// literals.

import { strict as assert } from 'node:assert';
import { groundMarker } from '../effects/groundMarker.js';
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
    moveTo(...a) { calls.push(['moveTo', ...a]); },
    lineTo(...a) { calls.push(['lineTo', ...a]); },
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
  const b = groundMarker({});
  const frames = Math.round(1.5 / DT); // default duration 1.5s → 90 frames
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
});
ok('explicit duration is honored exactly (total lifetime == duration)', () => {
  const dur = 0.3; // 18 frames at dt = 1/60
  const b = groundMarker({ duration: dur });
  for (let i = 0; i < Math.round(dur / DT) - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
  assert.ok(close(b.elapsed, dur), `elapsed equals the declared duration (${b.elapsed})`);
});
ok('update after done is a no-op (elapsed + radius frozen)', () => {
  const c = movingCarrier(0);
  const b = groundMarker({ duration: 0.1 }, c);
  b.complete();
  const e = b.elapsed, r = b.radius;
  c.x = 999;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
  assert.equal(b.radius, r, 'radius frozen once done');
  assert.equal(b.origin.x, 0, 'origin frozen once done');
});

console.log('pulsing radius');
ok('starts at the declared base radius (sin(0) = 0)', () => {
  const b = groundMarker({ radius: 40, pulseRate: 2, duration: 2 });
  assert.ok(close(b.radius, 40), `initial radius == declared base radius (${b.radius})`);
});
ok('radius oscillates deterministically between (1−A)·r and (1+A)·r', () => {
  // Documented contract: r(t) = radius · (1 + A·sin(2π·pulseRate·t)).
  // Probe every frame of one full pulse period and confirm the exposed radius
  // stays inside the documented bounds and touches both extremes on the grid.
  const r0 = 40, rate = 2; // period = 0.5s = 30 frames
  const b = groundMarker({ radius: r0, pulseRate: rate, duration: 2 });
  let minSeen = Infinity, maxSeen = -Infinity;
  for (let i = 1; i <= 30; i++) {
    b.update(DT);
    minSeen = Math.min(minSeen, b.radius);
    maxSeen = Math.max(maxSeen, b.radius);
  }
  assert.ok(minSeen >= r0 * 0.75 - 1e-9 && maxSeen <= r0 * 1.25 + 1e-9,
    `radius stayed inside the documented ±25% band [${minSeen}, ${maxSeen}]`);
  // Quarter-period marks sit exactly on the fixed-dt grid (7.5 frames off?
  // no: 0.125s = 7.5 frames — off-grid). Instead probe the peak/trough by
  // scanning: the max over the period must be strictly above the base radius
  // and the min strictly below it (the pulse actually moves).
  assert.ok(maxSeen > r0 + 1e-6, `radius grew past the base radius (max ${maxSeen})`);
  assert.ok(minSeen < r0 - 1e-6, `radius shrank below the base radius (min ${minSeen})`);
});
ok('peak radius matches the documented formula at a quarter period (off-grid scan)', () => {
  // The peak sits at t = 1/(4·pulseRate) = 0.125s = 7.5 frames — off the
  // fixed-dt grid — so sample the two bracketing frames and confirm the
  // documented sinusoid value at each integer frame is exact to epsilon.
  const r0 = 40, rate = 2;
  const b = groundMarker({ radius: r0, pulseRate: rate, duration: 2 });
  for (let i = 1; i <= 8; i++) {
    b.update(DT);
    const expected = r0 * (1 + 0.25 * Math.sin(2 * Math.PI * rate * (i * DT)));
    assert.ok(close(b.radius, expected, 1e-9),
      `frame ${i}: radius == documented formula (got ${b.radius}, want ${expected})`);
  }
});
ok('pulseRate=0 disables the pulse (constant base radius)', () => {
  const b = groundMarker({ radius: 30, pulseRate: 0, duration: 2 });
  for (let i = 0; i < 30; i++) b.update(DT);
  assert.ok(close(b.radius, 30), `radius stays at the base radius (got ${b.radius})`);
});

console.log('origin resolution');
ok('carrier origin() wins over params.x/y', () => {
  const c = movingCarrier(500, 10);
  const b = groundMarker({ x: 999, y: 999, duration: 1 }, c);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 10), 'carrier origin resolved');
});
ok('carrier without origin() falls back to params.x/y', () => {
  const b = groundMarker({ x: 77, y: 5, duration: 1 }, { size: () => ({ w: 8, h: 8 }) });
  assert.ok(close(b.origin.x, 77) && close(b.origin.y, 5), 'params fallback used');
});
ok('null carrier uses params.x/y (standalone/theater origin)', () => {
  const b = groundMarker({ x: 12, y: -3, duration: 1 });
  assert.ok(close(b.origin.x, 12) && close(b.origin.y, -3), 'params origin used');
});
ok('origin captured at fire time and HELD FIXED even if the carrier moves (fixed marker)', () => {
  // Documented contract (§9): "The marker can remain fixed, allowing the
  // player to escape the danger area." Unlike telegraphCircle there is NO
  // follow mode — a moving carrier must NOT drag the marker along.
  const c = movingCarrier(10, 20);
  const b = groundMarker({ duration: 1 }, c);
  assert.ok(close(b.origin.x, 10) && close(b.origin.y, 20), 'fire-time origin captured');
  c.x = 500; c.y = 600;
  for (let i = 0; i < 10; i++) b.update(DT);
  assert.ok(close(b.origin.x, 10) && close(b.origin.y, 20), 'origin held fixed despite carrier motion');
});

console.log('render');
ok('draws nothing once done', () => {
  const b = groundMarker({ duration: 0.1 });
  for (let i = 0; i < 6; i++) b.update(DT); // 6 frames ≥ 0.1s
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('draws rings + ticks while active (save/restore bracketed, constant alpha)', () => {
  const b = groundMarker({ x: 30, y: 40, radius: 40, pulseRate: 0, rotation: 0, opacity: 0.7, duration: 2 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
  const arcs = ctx.calls.filter(c => c[0] === 'arc');
  assert.equal(arcs.length, 2, 'two concentric stroked circles (outer + inner ring)');
  const alphas = ctx.calls.filter(c => c[0] === 'alpha');
  assert.equal(alphas.length, 1, 'single globalAlpha write');
  assert.ok(close(alphas[0][1], 0.7, 1e-6), `alpha == declared constant opacity (got ${alphas[0][1]})`);
  const strokes = ctx.calls.filter(c => c[0] === 'stroke');
  assert.equal(strokes.length, 6, 'outer ring + inner ring + 4 ticks = 6 strokes');
  // Contract: both rings centered at the origin; outer ring radius matches
  // the current exposed radius; inner ring is a proper fraction of it.
  const [outer, inner] = arcs;
  assert.ok(close(outer[1], 30) && close(outer[2], 40), `outer ring centered at the origin (got ${outer[1]},${outer[2]})`);
  assert.ok(close(inner[1], 30) && close(inner[2], 40), `inner ring centered at the origin (got ${inner[1]},${inner[2]})`);
  assert.ok(close(outer[3], b.radius), `outer ring radius matches the current radius (${outer[3]} vs ${b.radius})`);
  assert.ok(inner[3] > 0 && inner[3] < outer[3], `inner ring smaller than outer (${inner[3]} < ${outer[3]})`);
  assert.ok(close(Math.abs(outer[5] - outer[4]), Math.PI * 2), 'outer ring spans a full circle (2π radians)');
  // Contract: four radial tick segments, each starting outside the outer
  // ring and ending further out (length > 0, pointing away from center).
  const moves = ctx.calls.filter(c => c[0] === 'moveTo');
  const lines = ctx.calls.filter(c => c[0] === 'lineTo');
  assert.equal(moves.length, 4, 'four tick start points');
  assert.equal(lines.length, 4, 'four tick end points');
  for (let k = 0; k < 4; k++) {
    const [, mx, my] = moves[k];
    const [, lx, ly] = lines[k];
    const dStart = Math.hypot(mx - 30, my - 40);
    const dEnd = Math.hypot(lx - 30, ly - 40);
    assert.ok(dStart > outer[3], `tick ${k} starts outside the outer ring (${dStart} > ${outer[3]})`);
    assert.ok(dEnd > dStart + 1e-6, `tick ${k} extends outward (end ${dEnd} > start ${dStart})`);
    // Tick lies on a radial line through the origin (collinear with center).
    const cross = (mx - 30) * (ly - 40) - (my - 40) * (lx - 30);
    assert.ok(Math.abs(cross) < 1e-6, `tick ${k} is radial (collinear with the origin)`);
  }
});
ok('ticks rotate deterministically over the lifetime (angle advances with time)', () => {
  // Documented contract: the ticks rotate at a constant angular velocity, so
  // the first tick's radial direction changes monotonically across updates.
  const b = groundMarker({ x: 0, y: 0, radius: 40, pulseRate: 0, rotation: 0, duration: 2 });
  const firstTickAngle = (ctx) => {
    const m = ctx.calls.find(c => c[0] === 'moveTo');
    return Math.atan2(m[2], m[1]);
  };
  const a0 = firstTickAngle((() => { const c = makeCtx(); b.render(c); return c; })());
  for (let i = 0; i < 30; i++) b.update(DT); // t = 0.5s
  const a1 = firstTickAngle((() => { const c = makeCtx(); b.render(c); return c; })());
  assert.ok(!close(Math.cos(a0), Math.cos(a1)) || !close(Math.sin(a0), Math.sin(a1)),
    `first tick direction changed over 0.5s (was ${a0.toFixed(3)}, now ${a1.toFixed(3)})`);
});
ok('declared rotation sets the initial tick orientation', () => {
  // At t=0 the first tick points along `rotation` (documented contract).
  const rot = Math.PI / 3;
  const b = groundMarker({ x: 0, y: 0, radius: 40, pulseRate: 0, rotation: rot, duration: 2 });
  const ctx = makeCtx();
  b.render(ctx);
  const m = ctx.calls.find(c => c[0] === 'moveTo');
  const dir = Math.atan2(m[2], m[1]);
  assert.ok(close(dir, rot, 1e-9), `first tick points along the declared rotation (got ${dir}, want ${rot})`);
});
ok('degenerate geometry (radius 0 or opacity 0) draws nothing but still completes', () => {
  const bR = groundMarker({ radius: 0, duration: 0.1 });
  const bO = groundMarker({ opacity: 0, duration: 0.1 });
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
ok('"ground-target-marker" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('ground-target-marker'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'ground-target-marker', params: { radius: 24, pulseRate: 2, rotation: 0, opacity: 0.85, duration: 1.5, animation: 'pulse', color: '#7dff6a', x: 0, y: 100 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'ground-target-marker');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['spawn', 'stateChange']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      origin: () => ({ x: 10, y: 100 }),
      effects: [{ on: trigger, type: 'ground-target-marker', params: { radius: 24, pulseRate: 2, duration: 1.5 } }],
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
    effects: [{ on: 'spawn', type: 'ground-target-marker', params: { radius: 24, pulseRate: 2, duration: 1.5 } }],
  };
  const spawned = fire('spawn', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired a ground marker');
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
  const inst = fireManual({ type: 'ground-target-marker',
    params: { radius: 24, pulseRate: 2, rotation: 0, opacity: 0.85, duration: 1.5, animation: 'pulse', color: '#7dff6a', x: 0, y: 100 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  // Drive the full lifetime: 90 frames = 1.5s.
  for (let i = 1; i <= 90; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'stroke')) drew++;
  }
  assert.ok(drew >= 45, `demo actually drew the marker most frames (drew ${drew}/90)`);
  assert.equal(body.done, true, 'demo self-terminated at duration (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects pulses the marker, then prunes', () => {
  resetEffects();
  const c = movingCarrier(0, 100);
  const inst = fireManual({ type: 'ground-target-marker', params: { radius: 40, pulseRate: 2, duration: 0.5 } }, c);
  assert.ok(inst !== null, 'fired through the engine');
  let drew = 0;
  let sawGrowth = false, sawShrink = false;
  for (let i = 1; i <= 30; i++) { // 30 frames = 0.5s
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(cc => cc[0] === 'stroke')) drew++;
    if (inst.body.radius > 40 + 1e-6) sawGrowth = true;
    if (inst.body.radius < 40 - 1e-6) sawShrink = true;
  }
  assert.ok(drew >= 15, `drew the marker while active (drew ${drew}/30)`);
  assert.ok(sawGrowth, 'marker pulsed outward during its life');
  assert.ok(sawShrink, 'marker pulsed inward during its life');
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});

console.log(`${passed} passed`);
