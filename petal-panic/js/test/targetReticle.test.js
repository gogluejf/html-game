// Task 5.7 — node-based unit tests for the target reticle effect
// (js/effects/targetReticle.js, effects.md §10). Run:
// node js/test/targetReticle.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Determinism note: the reticle geometry is fully deterministic (no
// Math.random) — the outer-ring radius is derived purely from elapsed time
// (size · (1 + A·sin(2π·pulseRate·t))) and the tick angle is a linear
// function of elapsed time (rotationSpeed·t), so assertions on radius, drawn
// arc coordinates, tick endpoints, and alpha are exact within epsilon.
// Assertions target the DOCUMENTED contract (declared params, declared
// lifetime, carrier-origin rule, follow/fixed semantics), not internal
// literals.

import { strict as assert } from 'node:assert';
import { targetReticle } from '../effects/targetReticle.js';
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
  const b = targetReticle({});
  const frames = Math.round(1.0 / DT); // default duration 1.0s → 60 frames
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
});
ok('explicit duration is honored exactly (total lifetime == duration)', () => {
  const dur = 0.3; // 18 frames at dt = 1/60
  const b = targetReticle({ duration: dur });
  for (let i = 0; i < Math.round(dur / DT) - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
  assert.ok(close(b.elapsed, dur), `elapsed equals the declared duration (${b.elapsed})`);
});
ok('update after done is a no-op (elapsed + radius + angle frozen)', () => {
  const c = movingCarrier(0);
  const b = targetReticle({ duration: 0.1, followMode: true }, c);
  b.complete();
  const e = b.elapsed, r = b.radius, a = b.angle;
  c.x = 999;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
  assert.equal(b.radius, r, 'radius frozen once done');
  assert.equal(b.angle, a, 'angle frozen once done');
  assert.equal(b.origin.x, 0, 'origin frozen once done');
});

console.log('pulsing radius');
ok('starts at the declared base size (sin(0) = 0)', () => {
  const b = targetReticle({ size: 40, pulseRate: 2, duration: 2 });
  assert.ok(close(b.radius, 40), `initial radius == declared base size (${b.radius})`);
});
ok('radius oscillates deterministically between (1−A)·s and (1+A)·s', () => {
  // Documented contract: r(t) = size · (1 + A·sin(2π·pulseRate·t)).
  // Probe every frame of one full pulse period and confirm the exposed radius
  // stays inside the documented bounds and touches both extremes on the grid.
  const s0 = 40, rate = 2; // period = 0.5s = 30 frames
  const b = targetReticle({ size: s0, pulseRate: rate, duration: 2 });
  let minSeen = Infinity, maxSeen = -Infinity;
  for (let i = 1; i <= 30; i++) {
    b.update(DT);
    minSeen = Math.min(minSeen, b.radius);
    maxSeen = Math.max(maxSeen, b.radius);
  }
  assert.ok(minSeen >= s0 * 0.75 - 1e-9 && maxSeen <= s0 * 1.25 + 1e-9,
    `radius stayed inside the documented ±25% band [${minSeen}, ${maxSeen}]`);
  // The pulse actually moves: over a full period it must grow past the base
  // size AND shrink below it.
  assert.ok(maxSeen > s0 + 1e-6, `radius grew past the base size (max ${maxSeen})`);
  assert.ok(minSeen < s0 - 1e-6, `radius shrank below the base size (min ${minSeen})`);
});
ok('peak radius matches the documented formula at each integer frame', () => {
  // The sinusoid value at each fixed-dt sample must be exact to epsilon.
  const s0 = 40, rate = 2;
  const b = targetReticle({ size: s0, pulseRate: rate, duration: 2 });
  for (let i = 1; i <= 8; i++) {
    b.update(DT);
    const expected = s0 * (1 + 0.25 * Math.sin(2 * Math.PI * rate * (i * DT)));
    assert.ok(close(b.radius, expected, 1e-9),
      `frame ${i}: radius == documented formula (got ${b.radius}, want ${expected})`);
  }
});
ok('pulseRate=0 disables the pulse (constant base size)', () => {
  const b = targetReticle({ size: 30, pulseRate: 0, duration: 2 });
  for (let i = 0; i < 30; i++) b.update(DT);
  assert.ok(close(b.radius, 30), `radius stays at the base size (got ${b.radius})`);
});

console.log('rotating ticks');
ok('tick angle starts at 0 and advances linearly at the declared rotationSpeed', () => {
  // Documented contract: angle(t) = rotationSpeed · t, starting at 0.
  const speed = 2; // rad/s
  const b = targetReticle({ size: 30, rotationSpeed: speed, pulseRate: 0, duration: 2 });
  assert.ok(close(b.angle, 0), `angle starts at 0 (got ${b.angle})`);
  for (let i = 1; i <= 30; i++) {
    b.update(DT);
    const expected = speed * (i * DT);
    assert.ok(close(b.angle, expected, 1e-9),
      `frame ${i}: angle == documented formula (got ${b.angle}, want ${expected})`);
  }
});
ok('ticks rotate visibly over time (direction changes across updates)', () => {
  const b = targetReticle({ x: 0, y: 0, size: 40, pulseRate: 0, duration: 2 });
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
ok('rotationSpeed=0 keeps the ticks stationary', () => {
  const b = targetReticle({ x: 0, y: 0, size: 40, rotationSpeed: 0, pulseRate: 0, duration: 2 });
  for (let i = 0; i < 30; i++) b.update(DT);
  assert.ok(close(b.angle, 0), `angle stays at 0 (got ${b.angle})`);
});

console.log('origin resolution');
ok('carrier origin() wins over params.x/y', () => {
  const c = movingCarrier(500, 10);
  const b = targetReticle({ x: 999, y: 999, duration: 1 }, c);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 10), 'carrier origin resolved');
});
ok('carrier without origin() falls back to params.x/y', () => {
  const b = targetReticle({ x: 77, y: 5, duration: 1 }, { size: () => ({ w: 8, h: 8 }) });
  assert.ok(close(b.origin.x, 77) && close(b.origin.y, 5), 'params fallback used');
});
ok('null carrier uses params.x/y (standalone/theater origin)', () => {
  const b = targetReticle({ x: 12, y: -3, duration: 1 });
  assert.ok(close(b.origin.x, 12) && close(b.origin.y, -3), 'params origin used');
});
ok('followMode=false (default): origin captured at fire time and HELD FIXED even if the carrier moves', () => {
  // Documented contract (§10): the "arbitrary XY position" variant — a reticle
  // stamped on a spot does not move with the carrier.
  const c = movingCarrier(10, 20);
  const b = targetReticle({ duration: 1 }, c);
  assert.ok(close(b.origin.x, 10) && close(b.origin.y, 20), 'fire-time origin captured');
  c.x = 500; c.y = 600;
  for (let i = 0; i < 10; i++) b.update(DT);
  assert.ok(close(b.origin.x, 10) && close(b.origin.y, 20), 'origin held fixed despite carrier motion');
});
ok('followMode=true: origin re-resolves from the live carrier every update()', () => {
  // Documented contract (§10): "this effect can follow a moving hero, enemy,
  // projectile, or other entity."
  const c = movingCarrier(10, 20);
  const b = targetReticle({ duration: 1, followMode: true }, c);
  c.x = 500; c.y = 600;
  b.update(DT);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 600), 'origin follows the carrier');
  c.x = -5; c.y = 7;
  b.update(DT);
  assert.ok(close(b.origin.x, -5) && close(b.origin.y, 7), 'origin keeps following');
});
ok('followMode=true with a null carrier holds the params.x/y fallback', () => {
  const b = targetReticle({ x: 12, y: -3, duration: 1, followMode: true });
  for (let i = 0; i < 10; i++) b.update(DT);
  assert.ok(close(b.origin.x, 12) && close(b.origin.y, -3), 'fallback origin held');
});

console.log('offset');
ok('offset shifts the reticle along the carrier facing direction', () => {
  // Documented contract: offset is applied along the carrier's facing() when
  // available. A carrier facing +y with offset 10 parks the reticle 10px
  // below the origin.
  const c = {
    origin: () => ({ x: 100, y: 200 }),
    facing: () => ({ x: 0, y: 1 }),
  };
  const b = targetReticle({ size: 30, pulseRate: 0, offset: 10, duration: 1 }, c);
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const arcs = ctx.calls.filter(cc => cc[0] === 'arc');
  assert.ok(close(arcs[0][1], 100) && close(arcs[0][2], 210),
    `reticle centered at origin + offset·facing (got ${arcs[0][1]},${arcs[0][2]})`);
});
ok('fixed mode with a nonzero offset HOLDS its position even if the carrier rotates after fire', () => {
  // Defect (Review B): fixed mode must freeze BOTH origin and facing at fire
  // time. A carrier that rotates between fire and now must NOT drag the
  // reticle around the captured origin — the offset direction is frozen too.
  const c = {
    origin: () => ({ x: 100, y: 200 }),
    _facing: { x: 0, y: 1 },
    facing() { return this._facing; },
  };
  const b = targetReticle({ size: 30, pulseRate: 0, offset: 10, duration: 1 }, c);
  // Fire while facing +y → reticle parked 10px below the origin.
  b.update(DT);
  const first = makeCtx();
  b.render(first);
  const arc0 = first.calls.find(cc => cc[0] === 'arc');
  assert.ok(close(arc0[1], 100) && close(arc0[2], 210),
    `fire-time position == origin + offset·frozenFacing (got ${arc0[1]},${arc0[2]})`);
  // Rotate the carrier's facing AFTER fire (e.g. it now faces +x).
  c._facing = { x: 1, y: 0 };
  for (let i = 0; i < 20; i++) b.update(DT);
  const second = makeCtx();
  b.render(second);
  const arc1 = second.calls.find(cc => cc[0] === 'arc');
  assert.ok(close(arc1[1], 100) && close(arc1[2], 210),
    `fixed-mode reticle did NOT drift despite carrier rotation (got ${arc1[1]},${arc1[2]})`);
});
ok('followMode=true re-resolves the offset facing live (rotating carrier re-aims the offset)', () => {
  // Counterpart: follow mode tracks BOTH origin and facing live, so a
  // rotating carrier DOES move the offset position (unchanged behavior).
  const c = {
    origin: () => ({ x: 100, y: 200 }),
    _facing: { x: 0, y: 1 },
    facing() { return this._facing; },
  };
  const b = targetReticle({ size: 30, pulseRate: 0, offset: 10, duration: 1, followMode: true }, c);
  b.update(DT);
  const first = makeCtx();
  b.render(first);
  const arc0 = first.calls.find(cc => cc[0] === 'arc');
  assert.ok(close(arc0[1], 100) && close(arc0[2], 210), 'initially parked along the live facing (+y)');
  c._facing = { x: 1, y: 0 };
  b.update(DT);
  const second = makeCtx();
  b.render(second);
  const arc1 = second.calls.find(cc => cc[0] === 'arc');
  assert.ok(close(arc1[1], 110) && close(arc1[2], 200),
    `follow-mode reticle re-aimed along the new facing (got ${arc1[1]},${arc1[2]})`);
});
ok('offset falls back to +x when the carrier has no facing()', () => {
  const c = { origin: () => ({ x: 100, y: 200 }) };
  const b = targetReticle({ size: 30, pulseRate: 0, offset: 10, duration: 1 }, c);
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const arcs = ctx.calls.filter(cc => cc[0] === 'arc');
  assert.ok(close(arcs[0][1], 110) && close(arcs[0][2], 200),
    `reticle centered at origin + offset·(+x) (got ${arcs[0][1]},${arcs[0][2]})`);
});
ok('offset=0 leaves the reticle centered on the origin', () => {
  const c = { origin: () => ({ x: 100, y: 200 }), facing: () => ({ x: 0, y: 1 }) };
  const b = targetReticle({ size: 30, pulseRate: 0, duration: 1 }, c);
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const arcs = ctx.calls.filter(cc => cc[0] === 'arc');
  assert.ok(close(arcs[0][1], 100) && close(arcs[0][2], 200), 'centered on the origin');
});

console.log('render');
ok('draws nothing once done', () => {
  const b = targetReticle({ duration: 0.1 });
  for (let i = 0; i < 6; i++) b.update(DT); // 6 frames ≥ 0.1s
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('draws rings + ticks while active (save/restore bracketed, constant alpha)', () => {
  const b = targetReticle({ x: 30, y: 40, size: 40, pulseRate: 0, rotationSpeed: 0, opacity: 0.7, duration: 2 });
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
    // Tick lies on a radial line through the center (collinear with center).
    const cross = (mx - 30) * (ly - 40) - (my - 40) * (lx - 30);
    assert.ok(Math.abs(cross) < 1e-6, `tick ${k} is radial (collinear with the center)`);
  }
});
ok('ticks honor the current stored angle in the draw (angle advances with time)', () => {
  // Draw twice across updates; the first tick's radial direction must change
  // by exactly the documented angular advance (rotationSpeed · Δt).
  const speed = 2;
  const b = targetReticle({ x: 0, y: 0, size: 40, rotationSpeed: speed, pulseRate: 0, duration: 2 });
  const firstTickAngle = (ctx) => {
    const m = ctx.calls.find(c => c[0] === 'moveTo');
    return Math.atan2(m[2], m[1]);
  };
  const a0 = firstTickAngle((() => { const c = makeCtx(); b.render(c); return c; })());
  for (let i = 0; i < 30; i++) b.update(DT); // Δt = 0.5s → Δangle = 1 rad
  const a1 = firstTickAngle((() => { const c = makeCtx(); b.render(c); return c; })());
  const delta = ((a1 - a0 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  assert.ok(close(delta, speed * 0.5, 1e-6),
    `tick advanced by the documented angle (got ${delta.toFixed(4)}, want ${(speed * 0.5).toFixed(4)})`);
});
ok('degenerate geometry (size 0 or opacity 0) draws nothing but still completes', () => {
  const bR = targetReticle({ size: 0, duration: 0.1 });
  const bO = targetReticle({ opacity: 0, duration: 0.1 });
  bR.update(DT); bO.update(DT);
  const ctxR = makeCtx(), ctxO = makeCtx();
  bR.render(ctxR); bO.render(ctxO);
  assert.equal(ctxR.calls.length, 0, 'size 0 → no draw');
  assert.equal(ctxO.calls.length, 0, 'opacity 0 → no draw');
  for (let i = 0; i < 5; i++) { bR.update(DT); bO.update(DT); }
  assert.equal(bR.done, true, 'size-0 instance still completes at duration');
  assert.equal(bO.done, true, 'opacity-0 instance still completes at duration');
});

console.log('registration');
ok('"target-reticle" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('target-reticle'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'target-reticle', params: { size: 28, rotationSpeed: Math.PI, pulseRate: 3, offset: 0, opacity: 0.9, duration: 1.0, followMode: false, color: '#6ad7ff', x: 0, y: 100 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'target-reticle');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['spawn', 'stateChange']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      origin: () => ({ x: 10, y: 100 }),
      effects: [{ on: trigger, type: 'target-reticle', params: { size: 28, pulseRate: 3, duration: 1.0 } }],
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
    effects: [{ on: 'spawn', type: 'target-reticle', params: { size: 28, pulseRate: 3, duration: 1.0 } }],
  };
  const spawned = fire('spawn', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired a target reticle');
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
  const inst = fireManual({ type: 'target-reticle',
    params: { size: 28, rotationSpeed: Math.PI, pulseRate: 3, offset: 0, opacity: 0.9, duration: 1.0, followMode: false, color: '#6ad7ff', x: 0, y: 100 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  // Drive the full lifetime: 60 frames = 1.0s.
  for (let i = 1; i <= 60; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'stroke')) drew++;
  }
  assert.ok(drew >= 30, `demo actually drew the reticle most frames (drew ${drew}/60)`);
  assert.equal(body.done, true, 'demo self-terminated at duration (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects pulses + rotates the reticle, then prunes', () => {
  resetEffects();
  const c = movingCarrier(0, 100);
  const inst = fireManual({ type: 'target-reticle', params: { size: 40, pulseRate: 2, rotationSpeed: 2, duration: 0.5, followMode: true } }, c);
  assert.ok(inst !== null, 'fired through the engine');
  let drew = 0;
  let sawGrowth = false, sawShrink = false, sawSpin = false;
  const firstTickAngle = (ctx) => {
    const m = ctx.calls.find(cc => cc[0] === 'moveTo');
    return m ? Math.atan2(m[2], m[1]) : 0;
  };
  let prevAngle = null;
  for (let i = 1; i <= 30; i++) { // 30 frames = 0.5s
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(cc => cc[0] === 'stroke')) drew++;
    if (inst.body.radius > 40 + 1e-6) sawGrowth = true;
    if (inst.body.radius < 40 - 1e-6) sawShrink = true;
    const a = firstTickAngle(ctx);
    if (prevAngle !== null && !close(Math.cos(a), Math.cos(prevAngle)) && !close(Math.sin(a), Math.sin(prevAngle))) sawSpin = true;
    prevAngle = a;
  }
  assert.ok(drew >= 15, `drew the reticle while active (drew ${drew}/30)`);
  assert.ok(sawGrowth, 'reticle pulsed outward during its life');
  assert.ok(sawShrink, 'reticle pulsed inward during its life');
  assert.ok(sawSpin, 'reticle ticks rotated during its life');
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: a following reticle rides a moving carrier through the engine loop', () => {
  resetEffects();
  const c = movingCarrier(0, 100);
  const inst = fireManual({ type: 'target-reticle', params: { size: 40, pulseRate: 0, rotationSpeed: 0, duration: 0.5, followMode: true } }, c);
  assert.ok(inst !== null, 'fired through the engine');
  // Move the carrier mid-flight; the drawn reticle center must track it.
  for (let i = 1; i <= 10; i++) {
    c.x += 5; // drift right at 5px/frame
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    const arc = ctx.calls.find(cc => cc[0] === 'arc');
    assert.ok(arc, `frame ${i}: reticle still drawing`);
    assert.ok(close(arc[1], c.x, 1e-6), `frame ${i}: reticle x follows the carrier (${arc[1]} vs ${c.x})`);
  }
  for (let i = 11; i <= 30; i++) updateEffects(DT);
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  resetEffects();
});

console.log(`${passed} passed`);
