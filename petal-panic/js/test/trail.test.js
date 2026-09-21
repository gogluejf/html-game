// Task 5.1 — node-based unit tests for the trail effect (js/effects/trail.js,
// effects.md §6). Run: node js/test/trail.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Determinism note: the trail geometry is fully deterministic (no Math.random),
// so draw order is stable and no empirical draw-order measurement is required.

import { strict as assert } from 'node:assert';
import { trail } from '../effects/trail.js';
import {
  hasEffect, fireManual, fire, resetEffects, activeCount,
  updateEffects, drawEffects, updateContinuous, registerEffect,
} from '../effects/index.js';
import '../effects/registry.js'; // side effect: registers the types

const DT = 1 / 60;
const EPS = 1e-9;

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
    rotate(a) { calls.push(['rotate', a]); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(...a) { calls.push(['moveTo', ...a]); },
    lineTo(...a) { calls.push(['lineTo', ...a]); },
    closePath() { calls.push(['closePath']); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
    set fillStyle(v) { calls.push(['style', v]); },
    get fillStyle() { return undefined; },
    set lineWidth(v) { calls.push(['width', v]); },
    get lineWidth() { return 1; },
    set lineCap(v) { calls.push(['cap', v]); },
    get lineCap() { return 'butt'; },
    set lineJoin(v) { calls.push(['join', v]); },
    get lineJoin() { return 'miter'; },
    set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    get strokeStyle() { return undefined; },
  };
}

/** Number of ribbon segments actually stroked in a ctx's recorded calls. */
function segmentCount(calls) {
  return calls.filter(c => c[0] === 'stroke').length;
}

/** Perpendicular distance between two parallel lines through p1/p2 and q1/q2. */
function perpDistance(p1, p2, q1, q2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return 0;
  // Signed distance of q1 from the infinite line through p1→p2.
  return Math.abs((q1.x - p1.x) * dy - (q1.y - p1.y) * dx) / len;
}

console.log('lifetime');
ok('defaults: lifetime 0.5s → done exactly at frame 30, not before', () => {
  const b = trail({});
  for (let i = 0; i < 29; i++) b.update(DT); // 29 frames ≈ 0.4833s
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT); // frame 30 = 0.5s
  assert.equal(b.done, true, 'done at the lifetime boundary');
});
ok('explicit lifetime is honored exactly (total lifetime == duration)', () => {
  const b = trail({ lifetime: 0.4 });
  for (let i = 0; i < 23; i++) b.update(DT); // 23 frames ≈ 0.3833s
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT); // frame 24 = 0.4s
  assert.equal(b.done, true, 'done at the lifetime boundary');
});
ok('update after done is a no-op (elapsed frozen, no further recording)', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const b = trail({ lifetime: 0.1 }, carrier);
  b.complete();
  const e = b.elapsed, n = b.points.length;
  ox = 999;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
  assert.equal(b.points.length, n, 'no recording once done');
});

console.log('recording + fading ribbon');
ok('records recent positions as the carrier moves (density-gated)', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const b = trail({ length: 40, width: 4, lifetime: 1, density: 5 }, carrier);
  // Move the carrier in 5px steps (== density) so every step is recorded.
  for (let i = 0; i <= 6; i++) { ox = i * 5; b.update(DT); }
  assert.equal(b.points.length, 7, 'one point per spaced step');
  assert.ok(Math.abs(b.points[0].x - 0) < EPS && Math.abs(b.points.at(-1).x - 30) < EPS,
    'points track the carrier\'s changing origin');
});
ok('draws a ribbon whose segment count grows as more points are recorded', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const b = trail({ length: 100, width: 4, lifetime: 1, density: 5 }, carrier);
  const segCounts = [];
  for (let i = 0; i <= 8; i++) {
    ox = i * 5;
    b.update(DT);
    const ctx = makeCtx();
    b.render(ctx);
    segCounts.push(segmentCount(ctx.calls));
  }
  // Segment count should be monotonically non-decreasing and end up > start.
  for (let i = 1; i < segCounts.length; i++) {
    assert.ok(segCounts[i] >= segCounts[i - 1], `segments grow (${segCounts.join(',')})`);
  }
  assert.ok(segCounts.at(-1) > segCounts[0], 'more segments as the path lengthens');
  // 9 points → 8 candidate segments; all have alpha>0 (age < lifetime), so
  // exactly 8 strokes. Exact assertion, no magic threshold.
  assert.equal(segCounts.at(-1), 8, `expected exactly 8 segments by the end (got ${segCounts.at(-1)})`);
});
ok('alpha decreases for older points (head brightest, tail fades to ~0)', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const b = trail({ length: 100, width: 4, lifetime: 1, opacity: 0.9, density: 5 }, carrier);
  for (let i = 0; i <= 10; i++) { ox = i * 5; b.update(DT); }
  const ctx = makeCtx();
  b.render(ctx);
  const alphas = ctx.calls.filter(c => c[0] === 'alpha').map(c => c[1]);
  assert.ok(alphas.length >= 2, 'multiple segments each set an alpha');
  // Drawn oldest→newest (tail→head), so alpha must be non-decreasing along
  // the call order: the tail is dimmest, the head brightest.
  for (let i = 1; i < alphas.length; i++) {
    assert.ok(alphas[i] >= alphas[i - 1] - EPS, `alpha non-decreasing toward the head (${alphas.map(v => v.toFixed(3)).join(',')})`);
  }
  // Head (newest) is bright; tail (oldest) is strictly dimmer.
  assert.ok(alphas.at(-1) > 0.5, `head is bright (${alphas.at(-1).toFixed(3)})`);
  assert.ok(alphas[0] < alphas.at(-1) - 1e-6, 'tail strictly dimmer than head');
});
ok('ribbon tapers: head segment thicker than tail segment', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const b = trail({ length: 100, width: 6, lifetime: 1, density: 5 }, carrier);
  for (let i = 0; i <= 8; i++) { ox = i * 5; b.update(DT); }
  const ctx = makeCtx();
  b.render(ctx);
  const widths = ctx.calls.filter(c => c[0] === 'width').map(c => c[1]);
  assert.ok(widths.length >= 2, 'each segment sets a width');
  assert.ok(widths.at(-1) > widths[0], `head wider than tail (${widths[0]} → ${widths.at(-1)})`);
});
ok('offset shifts the ribbon perpendicular to travel direction (exact magnitude)', () => {
  // Carrier travels along +x; a positive offset should push the drawn path
  // in +y by EXACTLY the offset amount (perpendicular normal (-dy,dx)/len =
  // (0,1) for +x travel). Assert the exact perpendicular magnitude, not just
  // its sign.
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const bNoOff = trail({ length: 100, width: 4, lifetime: 1, density: 5, offset: 0 }, carrier);
  const bOff = trail({ length: 100, width: 4, lifetime: 1, density: 5, offset: 10 }, carrier);
  for (let i = 0; i <= 4; i++) { ox = i * 5; bNoOff.update(DT); bOff.update(DT); }
  const firstSeg = (b) => {
    const c = makeCtx();
    b.render(c);
    const m = c.calls.find(v => v[0] === 'moveTo');
    const l = c.calls.find(v => v[0] === 'lineTo');
    return { p1: { x: m[1], y: m[2] }, p2: { x: l[1], y: l[2] } };
  };
  const sNo = firstSeg(bNoOff);
  const sOff = firstSeg(bOff);
  const dist = perpDistance(sNo.p1, sNo.p2, sOff.p1, sOff.p2);
  assert.ok(Math.abs(dist - 10) < 1e-9, `offset path shifted by exactly 10px (got ${dist})`);
  // Direction check: the offset line sits BELOW (greater y) the centerline.
  assert.ok(sOff.p1.y > sNo.p1.y, `offset path shifted +y (+${sOff.p1.y} vs ${sNo.p1.y})`);
});

console.log('age-based fade (B1)');
ok('head segment alpha equals opacity exactly; tail fades linearly by age', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const LIFETIME = 1;
  const OPACITY = 0.9;
  const b = trail({ length: 100, width: 4, lifetime: LIFETIME, opacity: OPACITY, density: 5 }, carrier);
  for (let i = 0; i <= 10; i++) { ox = i * 5; b.update(DT); }
  const ctx = makeCtx();
  b.render(ctx);
  const alphas = ctx.calls.filter(c => c[0] === 'alpha').map(c => c[1]);
  const n = b.points.length; // 11 points → 10 segments
  assert.equal(alphas.length, n - 1, 'one alpha per drawable segment');
  // The freshest segment (index n-2, between the two newest points) has age
  // = elapsed - points[n-2].t = exactly one step (DT), so its alpha is
  // opacity · (1 - DT/lifetime). The OLDEST drawable segment uses point[0]'s
  // age. Verify the head is at peak-ish and the formula holds exactly.
  const lastAge = b.elapsed - b.points[n - 2].t;
  const expectedHead = OPACITY * Math.min(1, Math.max(0, 1 - lastAge / LIFETIME));
  assert.ok(Math.abs(alphas.at(-1) - expectedHead) < 1e-9,
    `head alpha matches opacity·clamp(1-age/lifetime) (${alphas.at(-1)} vs ${expectedHead})`);
  // Oldest drawable segment: alpha = opacity·clamp(1 - age_0/lifetime).
  const firstAge = b.elapsed - b.points[0].t;
  const expectedTail = OPACITY * Math.min(1, Math.max(0, 1 - firstAge / LIFETIME));
  assert.ok(Math.abs(alphas[0] - expectedTail) < 1e-9,
    `tail alpha matches the same formula (${alphas[0]} vs ${expectedTail})`);
  assert.ok(expectedHead > expectedTail, 'fresher segment brighter than older');
});
ok('a point vanishes exactly when it is a full lifetime old (alpha → 0)', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const LIFETIME = 0.3;
  const b = trail({ length: 100, width: 4, lifetime: LIFETIME, opacity: 0.9, density: 5 }, carrier);
  // Record a point at t≈0, then advance well past the lifetime without moving
  // far enough to record new points (steps < density). The old point's age
  // exceeds the lifetime → its alpha clamps to 0 → it is skipped.
  b.addPoint(0, 0);
  for (let i = 0; i < 40; i++) b.update(DT); // 40 frames ≈ 0.667s > 0.3s
  const ctx = makeCtx();
  b.render(ctx);
  // Every surviving segment's alpha must be ≤ opacity and any segment whose
  // older endpoint is ≥ lifetime old must NOT be stroked.
  const alphas = ctx.calls.filter(c => c[0] === 'alpha').map(c => c[1]);
  for (const a of alphas) {
    assert.ok(a > 0 && a <= 0.9 + 1e-9, `all stroked segments have positive, bounded alpha (${a})`);
  }
  // After `lifetime` with no fresh recording (carrier stationary) the instance
  // is done and draws nothing.
  assert.equal(b.done, true, 'instance terminated at lifetime once the carrier went quiet');
});

console.log('continuous persistence (B2)');
ok('a continuously-moving trail persists past lifetime while the carrier keeps moving', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const LIFETIME = 0.3;
  const b = trail({ length: 100, width: 4, lifetime: LIFETIME, density: 5 }, carrier);
  // Advance well past the lifetime, moving the carrier EVERY frame so it keeps
  // recording. The instance must NOT hard-stop at `lifetime`.
  for (let i = 0; i < 40; i++) { ox += 5; b.update(DT); } // 40 frames ≈ 0.667s > 0.3s
  assert.equal(b.done, false, 'still alive while the carrier keeps moving past lifetime');
  assert.ok(b.points.length >= 2, 'ribbon still maintained (old points faded, new ones recorded)');
  // Old points have been evicted/faded: the accumulated path is bounded.
  let total = 0;
  for (let i = 0; i < b.points.length - 1; i++) {
    total += Math.hypot(b.points[i + 1].x - b.points[i].x, b.points[i + 1].y - b.points[i].y);
  }
  assert.ok(total <= 100 + 1e-9, `accumulated path bounded by length (got ${total.toFixed(2)})`);
});
ok('a discrete-fired trail whose carrier STOPS moving self-terminates (ribbon fades out)', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const LIFETIME = 0.3;
  const b = trail({ length: 100, width: 4, lifetime: LIFETIME, density: 5 }, carrier);
  // Move for a few frames, then STOP (carrier stays put → no new points).
  for (let i = 0; i < 5; i++) { ox += 5; b.update(DT); }
  assert.equal(b.done, false, 'alive while the carrier was moving');
  // Now hold position; once the clock passes `lifetime` with no fresh point
  // recorded, the instance terminates on its own.
  for (let i = 0; i < 40; i++) b.update(DT);
  assert.equal(b.done, true, 'self-terminated at lifetime after the carrier stopped moving');
});

console.log('render guards');
ok('with fewer than 2 points, render is a no-op', () => {
  const b = trail({ lifetime: 1 });
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw with 0 points');
  b.addPoint(0, 0);
  const ctx1 = makeCtx();
  b.render(ctx1);
  assert.equal(ctx1.calls.length, 0, 'no draw with 1 point');
});
ok('exactly 2 points produce finite (non-NaN) alpha and width (B3)', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const b = trail({ length: 100, width: 6, lifetime: 1, opacity: 0.9, density: 5 }, carrier);
  b.update(DT); // records point at x=0
  ox = 5;
  b.update(DT); // records point at x=5 → exactly 2 points
  assert.equal(b.points.length, 2, 'exactly 2 points recorded');
  const ctx = makeCtx();
  b.render(ctx);
  const alphas = ctx.calls.filter(c => c[0] === 'alpha').map(c => c[1]);
  const widths = ctx.calls.filter(c => c[0] === 'width').map(c => c[1]);
  assert.equal(alphas.length, 1, 'one segment drawn');
  assert.ok(Number.isFinite(alphas[0]), `alpha is finite (got ${alphas[0]})`);
  assert.ok(alphas[0] > 0 && alphas[0] <= 0.9 + 1e-9, `alpha in (0, opacity] (got ${alphas[0]})`);
  assert.ok(Number.isFinite(widths[0]), `width is finite (got ${widths[0]})`);
  assert.ok(widths[0] >= 1 && widths[0] <= 6 + 1e-9, `width within [min, max] (got ${widths[0]})`);
});
ok('draws nothing once done', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const b = trail({ lifetime: 0.1, density: 5 }, carrier);
  for (let i = 0; i < 3; i++) { ox = i * 5; b.update(DT); }
  b.complete();
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('zero width or zero opacity draws nothing', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const zw = trail({ width: 0, lifetime: 1, density: 5 }, carrier);
  const zo = trail({ opacity: 0, lifetime: 1, density: 5 }, carrier);
  for (let i = 0; i < 3; i++) { ox = i * 5; zw.update(DT); zo.update(DT); }
  const c1 = makeCtx(); zw.render(c1);
  const c2 = makeCtx(); zo.render(c2);
  assert.equal(c1.calls.length, 0, 'width 0 → no draw');
  assert.equal(c2.calls.length, 0, 'opacity 0 → no draw');
});
ok('render is bracketed by save()/restore()', () => {
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const b = trail({ lifetime: 1, density: 5 }, carrier);
  for (let i = 0; i < 3; i++) { ox = i * 5; b.update(DT); }
  const ctx = makeCtx();
  b.render(ctx);
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
});

console.log('length-as-distance (B4)');
ok('large steps (>density) do not exceed the declared length reach', () => {
  // A carrier taking 20px steps (>> density 5) would blow past `length` if
  // the buffer were bounded only by point COUNT. With the path-length bound,
  // the accumulated path stays <= length.
  let ox = 0;
  const carrier = { origin() { return { x: ox, y: 0 }; } };
  const LENGTH = 40;
  const b = trail({ length: LENGTH, width: 4, lifetime: 1, density: 5 }, carrier);
  for (let i = 0; i <= 10; i++) { ox = i * 20; b.update(DT); } // 20px steps
  let total = 0;
  for (let i = 0; i < b.points.length - 1; i++) {
    total += Math.hypot(b.points[i + 1].x - b.points[i].x, b.points[i + 1].y - b.points[i].y);
  }
  assert.ok(total <= LENGTH + 1e-9, `accumulated path bounded by length (got ${total.toFixed(2)})`);
  // Newest point is always kept; oldest evicted so the reach is capped.
  assert.ok(Math.abs(b.points.at(-1).x - 200) < EPS, 'newest point retained');
});
ok('a single step LONGER than length does not leave an over-length segment (gap/break, B6)', () => {
  // Regression for Review B final: the path-length eviction loop stops at 2
  // points, so a SINGLE segment longer than `length` would previously survive
  // and stretch across the gap. The gap/break rule must drop the old point so
  // no individual segment exceeds `length`.
  const b = trail({ length: 40, width: 4, lifetime: 1, density: 3 });
  b.addPoint(0, 0);   // first recorded point
  b.addPoint(100, 0); // single 100px step >> length 40 → must break, not stretch
  // No segment longer than `length` may exist in the resulting points.
  let maxSeg = 0;
  for (let i = 0; i < b.points.length - 1; i++) {
    maxSeg = Math.max(maxSeg, Math.hypot(b.points[i + 1].x - b.points[i].x, b.points[i + 1].y - b.points[i].y));
  }
  assert.ok(maxSeg <= 40 + 1e-9, `no segment exceeds length (max seg ${maxSeg.toFixed(2)} > 40)`);
  // The ribbon did not stretch across the gap: the new point is retained and
  // the over-length connection to (0,0) was dropped.
  assert.ok(Math.abs(b.points.at(-1).x - 100) < EPS, 'newest point retained');
  assert.ok(!b.points.some(p => Math.abs(p.x - 0) < EPS), 'old point across the gap was dropped');
});

console.log('continuous activation');
ok('carrier whose origin() moves each frame produces a following trail', () => {
  // Capture the spawned body through a thin wrapper factory so we can assert
  // on its recorded points without reaching into engine internals. The wrapper
  // delegates to the real trail() and forwards update/render/complete/done.
  let captured = null;
  registerEffect('__follow-trail', (p, c) => {
    const b = trail(p, c);
    captured = b;
    return b;
  });
  resetEffects();
  let ox = 0;
  const carrier = {
    origin() { return { x: ox, y: 0 }; },
    isConditionMet(c) { return c === 'moving'; },
    effects: [{ on: 'spawn', type: '__follow-trail', params: { length: 100, width: 4, lifetime: 1, density: 5 }, continuous: { condition: 'moving' } }],
  };
  updateContinuous(carrier); // spawn while condition holds
  assert.equal(activeCount(), 1, 'continuous instance spawned');
  assert.ok(captured !== null, 'wrapper captured the trail body');
  // Advance several frames, moving the carrier each time.
  for (let i = 1; i <= 5; i++) {
    ox = i * 5;
    updateEffects(DT); // engine steps the instance → records live origin
  }
  assert.ok(captured.points.length >= 5, `recorded points track the moving carrier (${captured.points.length})`);
  assert.ok(Math.abs(captured.points.at(-1).x - 25) < EPS, 'latest recorded point matches current origin');
  resetEffects();
});
ok('isConditionMet(\'moving\') path: completes when the carrier stops moving', () => {
  let ox = 0;
  const carrier = {
    moving: true,
    origin() { return { x: ox, y: 0 }; },
    isConditionMet(c) { return c === 'moving' ? this.moving : false; },
    effects: [{ on: 'spawn', type: 'trail', params: { lifetime: 1, density: 5 }, continuous: { condition: 'moving' } }],
  };
  resetEffects();
  updateContinuous(carrier);
  assert.equal(activeCount(), 1, 'alive while moving');
  carrier.moving = false;
  updateContinuous(carrier);
  assert.equal(activeCount(), 0, 'completed when the condition stopped');
  resetEffects();
});

console.log('registration');
ok('"trail" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('trail'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'trail', params: { length: 40, width: 4, lifetime: 0.2 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'trail');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['spawn', 'attackActive']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      origin: () => ({ x: 10, y: 20 }),
      effects: [{ on: trigger, type: 'trail', params: { length: 40, width: 4, lifetime: 0.3 } }],
    };
    const spawned = fire(trigger, carrier);
    assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
    assert.equal(activeCount(), 1, 'instance entered the active set');
    resetEffects();
  });
}
ok('attachable via a NON-ENTITY carrier shape (plain marker object) through fire()', () => {
  // Proves generic carrier support: a plain data object with origin() and an
  // effects array — no entity class, no isConditionMet — drives a real fire().
  resetEffects();
  const marker = {
    kind: 'marker',
    origin: () => ({ x: 5, y: 7 }),
    effects: [{ on: 'spawn', type: 'trail', params: { length: 40, width: 4, lifetime: 0.3 } }],
  };
  const spawned = fire('spawn', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired a trail');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});

console.log('standalone theater demo');
ok('standalone demo driven only by params via addPoint() (null carrier) — bounded, self-terminating', () => {
  // The debug theater fires effects explicitly with params alone and a null
  // carrier. It drives the REAL recording/render path through the public
  // addPoint() method (no internal-state mutation, no hand-maintained buffer
  // cap), proving the effect renders purely from fed data and terminates via
  // the idle timeout once feeding stops.
  resetEffects();
  const inst = fireManual({ type: 'trail',
    params: { length: 60, width: 5, lifetime: 0.3, opacity: 0.9, density: 5, offset: 0 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  let px = 0;
  const feedFrames = 10; // feed a moving position for 10 frames
  for (let i = 0; i < feedFrames; i++) {
    px += 5;
    body.addPoint(px, 0); // public path — drives real recording
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (segmentCount(ctx.calls) > 0) drew++;
  }
  assert.ok(drew >= 1, 'demo actually drew the ribbon');
  // Stop feeding; once the clock passes `lifetime` with no fresh point, the
  // instance self-terminates.
  for (let i = 0; i < 40; i++) updateEffects(DT);
  assert.equal(body.done, true, 'demo self-terminates after feeding stops');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects draws; persists while moving, prunes when quiet', () => {
  resetEffects();
  let ox = 0;
  const carrier = {
    origin() { return { x: ox, y: 0 }; },
    effects: [],
  };
  const inst = fireManual({ type: 'trail', params: { length: 100, width: 4, lifetime: 0.2, density: 5 } }, carrier);
  assert.ok(inst !== null, 'fired through the engine');
  let drew = 0;
  // Move the carrier every frame for 12 frames (≈ 0.2s == lifetime). Under B2
  // a continuously-moving trail PERSISTS past its lifetime rather than wiping.
  for (let i = 1; i <= 12; i++) {
    ox = i * 5;
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (segmentCount(ctx.calls) > 0) drew++;
  }
  assert.ok(drew >= 1, 'drew the ribbon while active');
  assert.equal(inst.done, false, 'still alive at the lifetime boundary because the carrier kept moving (B2)');
  // Now stop the carrier. Under B2 a stopped carrier terminates at
  // `lifetime + recencyWindow`, NOT at `lifetime`: its last point (recorded at
  // frame 12, elapsed == lifetime) must first age OUT of the recency window
  // before the instance may complete. Here recencyWindow =
  // min(density / MIN_SPEED, lifetime) = min(5/10, 0.2) = 0.2s == 12 frames, so
  // completion lands at elapsed ≈ lifetime + window == 0.4s — i.e. ~12 frames
  // AFTER the stop. We run 13 stop-phase frames (ceil(window/dt) + 1) to
  // comfortably exceed that boundary; 4 frames (the old value) stops short of
  // the window aging out and would wrongly expect early termination.
  const STOP_FRAMES = Math.ceil((Math.min(5 / 10, 0.2)) / DT) + 1; // 13
  for (let i = 0; i < STOP_FRAMES; i++) updateEffects(DT);
  assert.equal(inst.done, true, 'completed once the carrier stopped driving fresh points');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});

console.log(`${passed} passed`);
