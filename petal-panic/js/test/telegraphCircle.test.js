// Task 5.5 — node-based unit tests for the telegraph circle effect
// (js/effects/telegraphCircle.js, effects.md §8). Run:
// node js/test/telegraphCircle.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Three-phase sequence (all derived from `duration`):
//   SHRINK (0%→65%): ease-in stroked circle, radius → ZERO, pulsing alpha
//   GAP (65%→77%): nothing drawn
//   BLINK (77%→100%): filled dot at minRadius, 3 on/off cycles

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

/** Recording canvas stub. */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    arc(...a) { calls.push(['arc', ...a]); },
    stroke() { calls.push(['stroke']); },
    fill() { calls.push(['fill']); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
    set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    get strokeStyle() { return undefined; },
    set lineWidth(v) { calls.push(['lineWidth', v]); },
    get lineWidth() { return 1; },
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    get fillStyle() { return undefined; },
  };
}

/** A carrier whose origin tracks a mutable position. */
function movingCarrier(x = 0, y = 0) {
  let ox = x, oy = y;
  return {
    get x() { return ox; }, set x(v) { ox = v; },
    get y() { return oy; }, set y(v) { oy = v; },
    origin() { return { x: ox, y: oy }; },
  };
}

// Phase boundaries for default duration (0.4s):
const DUR = 0.4;
const SHRINK_END = DUR * 0.65;  // 0.26s
const GAP_END = DUR * 0.77;     // 0.308s

console.log('lifetime');
ok('defaults: done exactly at the duration boundary, not before', () => {
  const b = telegraphCircle({});
  const frames = Math.round(DUR / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
});
ok('explicit duration is honored exactly', () => {
  const dur = 0.6;
  const b = telegraphCircle({ duration: dur });
  for (let i = 0; i < Math.round(dur / DT) - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
});
ok('update after done is a no-op', () => {
  const c = movingCarrier(0);
  const b = telegraphCircle({ duration: 0.1 }, c);
  b.complete();
  const e = b.elapsed;
  c.x = 999;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
});

console.log('phase 1: ease-in shrink to zero');
ok('starts at the declared radius', () => {
  const b = telegraphCircle({ radius: 100, minRadius: 12, duration: 1 });
  assert.ok(close(b.radius, 100), `initial radius == declared (${b.radius})`);
});
ok('shrink is slow at first (ease-in)', () => {
  const b = telegraphCircle({ radius: 100, minRadius: 12, duration: 1 });
  b.update(DT);
  assert.ok(100 - b.radius < 0.01, `first frame: negligible shrink (< 0.01px, got ${100 - b.radius})`);
});
ok('reaches zero at the end of the shrink phase', () => {
  const r0 = 48, dur = 0.4;
  const b = telegraphCircle({ radius: r0, minRadius: 12, duration: dur });
  const shrinkFrames = Math.round(dur * 0.65 / DT);
  for (let i = 0; i < shrinkFrames; i++) b.update(DT);
  assert.ok(b.radius < 1, `at shrink end: near zero (${b.radius.toFixed(3)})`);
});
ok('shrink accelerates monotonically (vacuum feel)', () => {
  const b = telegraphCircle({ radius: 100, minRadius: 12, duration: 0.5 });
  let prevShrink = 0;
  const shrinkEnd = 0.5 * 0.65; // 0.325s
  // Only check frames where BOTH endpoints are within the shrink phase
  // (the last frame may clamp to 0, producing a smaller delta)
  const safeFrames = Math.floor(shrinkEnd / DT) - 1;
  for (let i = 0; i < safeFrames; i++) {
    const before = b.radius;
    b.update(DT);
    const shrink = before - b.radius;
    if (i > 0) {
      assert.ok(shrink >= prevShrink - 1e-4, `frame ${i}: non-decreasing (${prevShrink.toFixed(6)} → ${shrink.toFixed(6)})`);
    }
    prevShrink = shrink;
  }
});
ok('pulse alpha oscillates during shrink phase', () => {
  const b = telegraphCircle({ radius: 48, minRadius: 12, duration: 0.4, pulseRate: 4 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const alpha = ctx.calls.find(c => c[0] === 'alpha')?.[1];
  assert.ok(alpha !== undefined && alpha > 0 && alpha <= 0.85, `alpha in range (${alpha})`);
});

console.log('phase 2: gap (nothing drawn)');
ok('gap phase draws nothing', () => {
  const b = telegraphCircle({ radius: 48, minRadius: 12, duration: 0.4 });
  const targetFrame = Math.round(0.28 / DT);
  for (let i = 0; i < targetFrame; i++) b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, `no draw during gap (t=${b.elapsed.toFixed(3)}s)`);
});
ok('gap lasts multiple frames (not a single-frame flicker)', () => {
  const b = telegraphCircle({ radius: 48, minRadius: 12, duration: 0.4 });
  // Advance to just before the gap, then count empty frames through it
  const totalFrames = Math.round(DUR / DT);
  let emptyFrames = 0;
  for (let f = 0; f < totalFrames; f++) {
    b.update(DT);
    const ctx = makeCtx();
    b.render(ctx);
    if (ctx.calls.length === 0 && !b.done) emptyFrames++;
  }
  assert.ok(emptyFrames >= 2, `gap has ${emptyFrames} empty frames (≥2)`);
});

console.log('phase 3: dot blink ×3');
ok('blink phase draws a filled dot (fill, not stroke)', () => {
  const b = telegraphCircle({ radius: 48, minRadius: 12, duration: 0.4 });
  const targetFrame = Math.round(0.32 / DT);
  for (let i = 0; i < targetFrame; i++) b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const fills = ctx.calls.filter(c => c[0] === 'fill');
  const strokes = ctx.calls.filter(c => c[0] === 'stroke');
  assert.ok(fills.length >= 1, 'dot drawn via fill()');
  assert.equal(strokes.length, 0, 'no stroke during blink phase');
});
ok('blink phase uses minRadius for the dot size', () => {
  const b = telegraphCircle({ radius: 48, minRadius: 12, duration: 0.4 });
  const targetFrame = Math.round(0.32 / DT);
  for (let i = 0; i < targetFrame; i++) b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(c => c[0] === 'arc');
  assert.ok(arc, 'arc drawn');
  assert.ok(close(arc[3], 12), `dot radius == minRadius (${arc[3]})`);
});
ok('blink alternates on/off (3 full cycles)', () => {
  const blinkStart = GAP_END;
  const blinkDur = DUR - GAP_END;
  const halfCycle = blinkDur / 6;
  const states = [];
  for (let i = 0; i < 6; i++) {
    const t = blinkStart + (i + 0.5) * halfCycle;
    const freshB = telegraphCircle({ radius: 48, minRadius: 12, duration: 0.4 });
    const frames = Math.round(t / DT);
    for (let f = 0; f < frames; f++) freshB.update(DT);
    const ctx = makeCtx();
    freshB.render(ctx);
    states.push(ctx.calls.some(c => c[0] === 'fill'));
  }
  assert.deepEqual(states, [true, false, true, false, true, false], `pattern: ${states}`);
});
ok('blink alpha is full opacity when ON', () => {
  const b = telegraphCircle({ radius: 48, minRadius: 12, duration: 0.4, opacity: 0.85 });
  const blinkStart = GAP_END;
  const blinkDur = DUR - GAP_END;
  const halfCycle = blinkDur / 6;
  const t = blinkStart + 0.5 * halfCycle;
  const frames = Math.round(t / DT);
  for (let i = 0; i < frames; i++) b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const alpha = ctx.calls.find(c => c[0] === 'alpha')?.[1];
  assert.ok(close(alpha, 0.85, 1e-6), `blink ON alpha == peak (${alpha})`);
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
ok('null carrier uses params.x/y', () => {
  const b = telegraphCircle({ x: 33, y: 44, duration: 1 }, null);
  assert.ok(close(b.origin.x, 33) && close(b.origin.y, 44), 'null carrier → params');
});
ok('followTarget=false (default): origin held even if carrier moves', () => {
  const c = movingCarrier(10, 20);
  const b = telegraphCircle({ duration: 1 }, c);
  c.x = 500; c.y = 600;
  b.update(DT);
  assert.ok(close(b.origin.x, 10) && close(b.origin.y, 20), 'origin frozen');
});
ok('followTarget=true: origin tracks the moving carrier', () => {
  const c = movingCarrier(10, 20);
  const b = telegraphCircle({ duration: 1, followTarget: true }, c);
  c.x = 500; c.y = 600;
  b.update(DT);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 600), 'origin follows carrier');
});

console.log('render');
ok('draws nothing once done', () => {
  const b = telegraphCircle({ duration: 0.1 });
  for (let i = 0; i < 7; i++) b.update(DT);
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('degenerate geometry (thickness 0 or opacity 0) draws nothing but still completes', () => {
  const bT = telegraphCircle({ thickness: 0, duration: 0.1 });
  const bO = telegraphCircle({ opacity: 0, duration: 0.1 });
  for (let i = 0; i < 7; i++) { bT.update(DT); bO.update(DT); }
  for (const b of [bT, bO]) {
    const ctx = makeCtx();
    b.render(ctx);
    assert.equal(ctx.calls.length, 0, 'degenerate instance draws nothing');
  }
  assert.equal(bT.done, true, 'still completes');
  assert.equal(bO.done, true, 'still completes');
});

console.log('registration');
ok('"telegraph-circle" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('telegraph-circle'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'telegraph-circle', params: { x: 0, y: 100, radius: 48, duration: 0.4 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'telegraph-circle');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['stateChange', 'spawn']) {
  ok(`attachable via carrier config on its documented trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      origin: () => ({ x: 10, y: 100 }),
      effects: [{ on: trigger, type: 'telegraph-circle', params: { radius: 48, duration: 0.4 } }],
    };
    const spawned = fire(trigger, carrier);
    assert.equal(spawned, 1, 'exactly one instance spawned');
    assert.equal(activeCount(), 1, 'instance entered the active set');
    resetEffects();
  });
}

console.log('standalone theater demo');
ok('standalone demo driven only by params (null carrier) — draws AND self-terminates', () => {
  resetEffects();
  const inst = fireManual({ type: 'telegraph-circle',
    params: { x: 0, y: 100, radius: 48, minRadius: 12, duration: 0.4 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  const frames = Math.round(0.4 / DT);
  for (let i = 1; i <= frames; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'stroke' || c[0] === 'fill')) drew++;
  }
  assert.ok(drew >= 10, `demo actually drew most frames (drew ${drew}/${frames})`);
  assert.equal(body.done, true, 'self-terminated at duration');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects, then prunes', () => {
  resetEffects();
  const c = movingCarrier(0, 100);
  const inst = fireManual({ type: 'telegraph-circle', params: { radius: 48, duration: 0.4 } }, c);
  assert.ok(inst !== null, 'fired through the engine');
  let drew = 0;
  const frames = Math.round(0.4 / DT);
  for (let i = 1; i <= frames; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(cc => cc[0] === 'stroke' || cc[0] === 'fill')) drew++;
  }
  assert.ok(drew >= 10, `drew while active (drew ${drew}/${frames})`);
  assert.equal(inst.done, true, 'completed and pruned');
  assert.equal(activeCount(), 0, 'pruned from active set');
  resetEffects();
});

console.log(`${passed} passed`);
