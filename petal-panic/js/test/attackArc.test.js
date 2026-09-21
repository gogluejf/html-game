// Task 5.8 — node-based unit tests for the attack arc / slash effect
// (js/effects/attackArc.js, effects.md §21). Run:
// node js/test/attackArc.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.
//
// Determinism note: the attack arc geometry is fully deterministic (no
// Math.random) — the leading/trailing edge angles are derived purely from
// elapsed time (base + sweepDir·arcAngle·min(t/duration, 1)) and the alpha is
// opacity·(1 − t/duration), so assertions on drawn arc coordinates, radius,
// span, and alpha are exact within epsilon. Assertions target the DOCUMENTED
// contract (declared params, declared lifetime, carrier-origin rule,
// carrier-facing orientation rule, fixed vs follow semantics), not internal
// literals.

import { strict as assert } from 'node:assert';
import { attackArc } from '../effects/attackArc.js';
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

/** A carrier exposing both origin() and a mutable facing() direction. */
function facingCarrier(x = 0, y = 0, fx = 1, fy = 0) {
  let ox = x, oy = y, fxx = fx, fyy = fy;
  return {
    get x() { return ox; },
    set x(v) { ox = v; },
    get y() { return oy; },
    set y(v) { oy = v; },
    get facingX() { return fxx; },
    set facingX(v) { fxx = v; },
    get facingY() { return fyy; },
    set facingY(v) { fyy = v; },
    origin() { return { x: ox, y: oy }; },
    facing() { return { x: fxx, y: fyy }; },
  };
}

console.log('lifetime');
ok('defaults: done exactly at the duration boundary, not before', () => {
  const b = attackArc({});
  const frames = Math.round(0.15 / DT); // default duration 0.15s → 9 frames
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
});
ok('explicit duration is honored exactly (total lifetime == duration)', () => {
  const dur = 0.3; // 18 frames at dt = 1/60
  const b = attackArc({ duration: dur });
  for (let i = 0; i < Math.round(dur / DT) - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT);
  assert.equal(b.done, true, 'done at the duration boundary');
  assert.ok(close(b.elapsed, dur), `elapsed equals the declared duration (${b.elapsed})`);
});
ok('update after done is a no-op (elapsed frozen)', () => {
  const c = movingCarrier(0);
  const b = attackArc({ duration: 0.1 }, c);
  b.complete();
  const e = b.elapsed;
  c.x = 999;
  b.update(DT);
  assert.equal(b.elapsed, e, 'no further accumulation once done');
});

console.log('sweep geometry');
ok('carrier origin() wins over params.x/y', () => {
  const c = movingCarrier(500, 10);
  const b = attackArc({ x: 999, y: 999, duration: 1 }, c);
  assert.ok(close(b.origin.x, 500) && close(b.origin.y, 10), 'carrier origin resolved');
});
ok('carrier without origin() falls back to params.x/y', () => {
  const b = attackArc({ x: 77, y: 5, duration: 1 }, { size: () => ({ w: 8, h: 8 }) });
  assert.ok(close(b.origin.x, 77) && close(b.origin.y, 5), 'params fallback used');
});
ok('draws an arc of the declared radius centered on the resolved origin', () => {
  const b = attackArc({ x: 30, y: 40, radius: 55, thickness: 8, duration: 2 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
  const strokes = ctx.calls.filter(c => c[0] === 'stroke');
  assert.equal(strokes.length, 1, 'exactly one stroked arc');
  const arc = ctx.calls.find(c => c[0] === 'arc');
  assert.ok(arc, 'arc drawn via arc()');
  assert.ok(close(arc[1], 30) && close(arc[2], 40), `arc centered at the origin (got ${arc[1]},${arc[2]})`);
  assert.ok(close(arc[3], 55), `arc radius matches the declared radius (${arc[3]})`);
  const lw = ctx.calls.find(c => c[0] === 'lineWidth');
  assert.ok(lw && close(lw[1], 8), `lineWidth == declared thickness (got ${lw && lw[1]})`);
});
ok('sweeps the full declared arcAngle by completion (leading edge reaches EXACTLY base + sweepDir·arcAngle on the last visible frame)', () => {
  // Contract: "sweeps an arc of the declared angle". With base angle 0 and
  // counter-clockwise sweep, the leading edge must sit at EXACTLY base +
  // arcAngle on the last VISIBLE frame (t = duration − dt). The sweep is
  // driven against (duration − dt) so progress hits 1.0 one frame before
  // done — no tolerance needed.
  const arcAngle = Math.PI / 2, dur = 0.3;
  const b = attackArc({ arcAngle, radius: 40, duration: dur, orientation: 0 });
  const frames = Math.round(dur / DT);
  for (let i = 0; i < frames - 1; i++) b.update(DT);
  assert.equal(b.done, false, 'precondition: last VISIBLE frame is one step short');
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(c => c[0] === 'arc');
  assert.ok(arc, 'arc drawn');
  const lead = arc[5];
  assert.ok(close(lead, arcAngle),
    `leading edge == base + arcAngle EXACTLY on the last visible frame (got ${lead}, want ${arcAngle})`);
});
ok('first visible frame: the arc starts AT the base orientation (no pre-start extension)', () => {
  // At t=0 (drawn before any update) the leading edge sits at the base and
  // the trailing wake is clamped to the base too — the visible arc begins
  // exactly at the declared start orientation with zero backward extension.
  const base = Math.PI / 3, arcAngle = Math.PI / 2;
  const b = attackArc({ orientation: base, arcAngle, radius: 40, duration: 1 });
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(c => c[0] === 'arc');
  assert.ok(arc, 'arc drawn at t=0');
  const [trail, lead] = [arc[4], arc[5]];
  assert.ok(close(trail, base), `trailing edge == base at t=0 (got ${trail}, want ${base})`);
  assert.ok(close(lead, base), `leading edge == base at t=0 (got ${lead}, want ${base})`);
});
ok('visible span never exceeds [base, base + sweepDir·arcAngle] across the whole lifetime', () => {
  // Sweep through every frame of a default-duration slash and verify both
  // edges stay inside the declared window in both sweep directions.
  for (const dir of [1, -1]) {
    const base = Math.PI / 6, arcAngle = Math.PI / 2, dur = 0.15;
    const b = attackArc({ orientation: base, arcAngle, radius: 40, duration: dur, sweepDirection: dir });
    const lo = dir > 0 ? base : base - arcAngle;
    const hi = dir > 0 ? base + arcAngle : base;
    for (let f = 0; f <= Math.round(dur / DT) - 1; f++) {
      if (f > 0) b.update(DT);
      const ctx = makeCtx();
      b.render(ctx);
      const arc = ctx.calls.find(c => c[0] === 'arc');
      assert.ok(arc, `frame ${f} drew an arc`);
      const [trail, lead] = [arc[4], arc[5]];
      for (const e of [trail, lead]) {
        assert.ok(e >= lo - EPS && e <= hi + EPS,
          `edge ${e.toFixed(6)} inside [${lo.toFixed(4)}, ${hi.toFixed(4)}] at frame ${f} (dir=${dir})`);
      }
      const span = Math.abs(lead - trail);
      assert.ok(span <= arcAngle + EPS, `visible span ${span.toFixed(6)} ≤ arcAngle at frame ${f}`);
    }
  }
});
ok('clockwise sweep: trailing edge lags the leading edge by wakeSpan once past the clamp', () => {
  // With dir=-1 and a long duration, at t=30·dt the lead is well past
  // wakeSpan from the base (in −angle direction), so the trail must sit
  // exactly wakeSpan ahead of the lead (toward the base) and both stay
  // inside [base−arcAngle, base].
  const base = 0, arcAngle = Math.PI / 2, dur = 1;
  const b = attackArc({ orientation: base, arcAngle, radius: 40, duration: dur, sweepDirection: -1 });
  b.update(DT * 30);
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(c => c[0] === 'arc');
  const [trail, lead] = [arc[4], arc[5]];
  assert.ok(trail > lead, 'clockwise: trailing edge ahead of the leading edge (toward base)');
  const expectedTrail = lead + 0.35 * arcAngle;
  assert.ok(close(trail, expectedTrail, 1e-9),
    `trailing edge sits exactly wakeSpan ahead of the lead (got ${trail}, want ${expectedTrail})`);
  assert.ok(lead >= base - arcAngle - EPS && trail <= base + EPS,
    'both edges inside [base − arcAngle, base] for the clockwise sweep');
});
ok('orientation param sets the base angle when the carrier has no facing()', () => {
  // Base angle = params.orientation (default +x): at t=dt the leading edge
  // sits just past the base angle and the trailing wake trails behind it.
  const base = Math.PI / 3, arcAngle = Math.PI / 2;
  const b = attackArc({ orientation: base, arcAngle, radius: 40, duration: 1 });
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(c => c[0] === 'arc');
  assert.ok(arc, 'arc drawn');
  const [trail, lead] = [arc[4], arc[5]];
  assert.ok(lead > trail, 'counter-clockwise sweep: leading edge ahead of trailing edge');
  // Sweep is driven against (duration − dt), so at t=dt the lead has advanced
  // by arcAngle · dt/(duration − dt).
  const expectedLead = base + arcAngle * DT / (1 - DT);
  assert.ok(close(lead, expectedLead, 1e-6),
    `leading edge advanced from the declared base angle (got ${lead}, want ${expectedLead})`);
  assert.ok(trail >= base - EPS, 'trailing edge never crosses the base orientation');
  assert.ok(trail < lead - EPS, 'trailing edge sits behind the leading edge');
});
ok('carrier facing() wins over params.orientation (orientation follows the carrier)', () => {
  // A carrier facing +y (down) must orient the slash along +y regardless of
  // params.orientation (+x here). At t=dt the leading edge sits just past
  // atan2(1, 0) = π/2.
  const c = facingCarrier(0, 0, 0, 1);
  const b = attackArc({ orientation: 0, arcAngle: Math.PI / 2, radius: 40, duration: 1 }, c);
  b.update(DT);
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(c => c[0] === 'arc');
  const lead = arc[5];
  // Sweep is driven against (duration − dt): at t=dt the lead has advanced
  // by arcAngle · dt/(duration − dt) from the carrier facing angle π/2.
  const expectedLead = Math.PI / 2 + (Math.PI / 2) * DT / (1 - DT);
  assert.ok(close(lead, expectedLead, 1e-6),
    `leading edge advanced from the carrier facing angle π/2 (got ${lead}, want ${expectedLead})`);
});
ok('fixed mode freezes the facing at fire time (later rotation does NOT drag the arc)', () => {
  const c = facingCarrier(0, 0, 1, 0); // facing +x at fire time
  const b = attackArc({ arcAngle: Math.PI / 2, radius: 40, duration: 1 }, c);
  const firstBase = b.baseAngle;
  c.facingX = 0; c.facingY = 1; // carrier rotates to face +y AFTER fire
  b.update(DT);
  assert.ok(close(b.baseAngle, firstBase), 'base angle held frozen in fixed mode');
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(c => c[0] === 'arc');
  const lead = arc[5];
  // Sweep is driven against (duration − dt): at t=dt the lead has advanced
  // by arcAngle · dt/(duration − dt) from the fire-time facing.
  const expectedLead = 0 + (Math.PI / 2) * DT / (1 - DT);
  assert.ok(close(lead, expectedLead, 1e-6),
    `sweep still runs from the fire-time facing (got ${lead}, want ${expectedLead})`);
});
ok('followEntity re-resolves origin AND facing each frame', () => {
  const c = facingCarrier(0, 0, 1, 0);
  const b = attackArc({ arcAngle: Math.PI / 2, radius: 40, duration: 1, followEntity: true }, c);
  c.x = 120; c.y = -30; c.facingX = 0; c.facingY = 1;
  b.update(DT);
  assert.ok(close(b.origin.x, 120) && close(b.origin.y, -30), 'origin follows the live carrier');
  assert.ok(close(b.baseAngle, Math.PI / 2), 'base angle follows the live facing');
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(c => c[0] === 'arc');
  assert.ok(close(arc[1], 120) && close(arc[2], -30), 'arc drawn at the live origin');
});
ok('sweepDirection -1 sweeps clockwise (leading edge behind the base angle)', () => {
  const b = attackArc({ arcAngle: Math.PI / 2, radius: 40, duration: 1, sweepDirection: -1, orientation: 0 });
  // Use a long duration so at t=dt the lead is still within wakeSpan of the
  // base (wake clamped to base); by t=30·dt the lead is past wakeSpan and the
  // trail lags behind.
  b.update(DT * 30);
  const ctx = makeCtx();
  b.render(ctx);
  const arc = ctx.calls.find(c => c[0] === 'arc');
  const [trail, lead] = [arc[4], arc[5]];
  assert.ok(lead < trail, 'clockwise sweep: leading edge behind the trailing edge');
  assert.ok(lead <= 0 + EPS, `leading edge swept into negative angles (got ${lead})`);
  assert.equal(arc[6], true, 'counterclockwise flag set for the clockwise sweep');
});

console.log('render');
ok('draws nothing once done', () => {
  const b = attackArc({ duration: 0.1 });
  for (let i = 0; i < 6; i++) b.update(DT); // 6 frames ≈ 0.1s ≥ duration
  assert.equal(b.done, true, 'precondition: done');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done');
});
ok('sub-frame duration (duration == dt): completes on first update, draws nothing', () => {
  // Degenerate config: duration <= dt means the instance is pruned before any
  // frame renders. Pin the actual behavior — done === true after one update,
  // and no draw call once done. We do NOT assert a visible full-angle sweep;
  // a sub-frame sweep is nonsensical by definition.
  const b = attackArc({ arcAngle: Math.PI / 2, radius: 40, thickness: 6, opacity: 0.9, duration: DT });
  assert.equal(b.done, false, 'not done before any update');
  b.update(DT);
  assert.equal(b.done, true, 'done after the first update (duration == dt)');
  const ctx = makeCtx();
  b.render(ctx);
  assert.equal(ctx.calls.length, 0, 'no draw once done (pruned before rendering)');
});
ok('alpha fades linearly from the declared opacity toward 0 across the lifetime', () => {
  const dur = 0.3;
  const b = attackArc({ duration: dur, opacity: 0.9, radius: 40 });
  b.update(DT); // t = 1/60
  const ctx = makeCtx();
  b.render(ctx);
  const alpha = ctx.calls.find(c => c[0] === 'alpha')?.[1];
  assert.ok(alpha !== undefined, 'globalAlpha set during render');
  assert.ok(close(alpha, 0.9 * (1 - DT / dur), 1e-6),
    `alpha == opacity·(1 − t/duration) at t=dt (got ${alpha})`);
  // Halfway through the lifetime the alpha should be ~half the peak.
  const b2 = attackArc({ duration: dur, opacity: 0.9, radius: 40 });
  for (let i = 0; i < 9; i++) b2.update(DT); // t = 0.15s = half of 0.3s
  const ctx2 = makeCtx();
  b2.render(ctx2);
  const alpha2 = ctx2.calls.find(c => c[0] === 'alpha')?.[1];
  assert.ok(close(alpha2, 0.9 * 0.5, 1e-6), `alpha ≈ half peak at half lifetime (got ${alpha2})`);
});
ok('degenerate geometry (arcAngle/radius/thickness 0 or opacity 0) draws nothing but still completes', () => {
  const bA = attackArc({ arcAngle: 0, duration: 0.1 });
  const bR = attackArc({ radius: 0, duration: 0.1 });
  const bT = attackArc({ thickness: 0, duration: 0.1 });
  const bO = attackArc({ opacity: 0, duration: 0.1 });
  for (const b of [bA, bR, bT, bO]) b.update(DT);
  for (const b of [bA, bR, bT, bO]) {
    const ctx = makeCtx();
    b.render(ctx);
    assert.equal(ctx.calls.length, 0, 'degenerate instance draws nothing');
  }
  for (let i = 0; i < 5; i++) { bA.update(DT); bR.update(DT); bT.update(DT); bO.update(DT); }
  for (const b of [bA, bR, bT, bO]) assert.equal(b.done, true, 'degenerate instance still completes at duration');
});

console.log('registration');
ok('"attack-arc" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('attack-arc'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'attack-arc', params: { arcAngle: Math.PI / 2, radius: 40, thickness: 6, opacity: 0.9, duration: 0.15, x: 0, y: 100 } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'attack-arc');
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
      effects: [{ on: trigger, type: 'attack-arc', params: { arcAngle: Math.PI / 2, radius: 40, duration: 0.15 } }],
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
    effects: [{ on: 'spawn', type: 'attack-arc', params: { arcAngle: Math.PI / 2, radius: 40, duration: 0.15 } }],
  };
  const spawned = fire('spawn', marker);
  assert.equal(spawned, 1, 'a plain-object carrier fired an attack arc');
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
  const inst = fireManual({ type: 'attack-arc',
    params: { arcAngle: Math.PI / 2, radius: 40, thickness: 6, opacity: 0.9, duration: 0.15, x: 0, y: 100 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  const body = inst.body;
  let drew = 0;
  // Drive the full lifetime: 9 frames = 0.15s.
  for (let i = 1; i <= 9; i++) {
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(c => c[0] === 'stroke')) drew++;
  }
  assert.ok(drew >= 5, `demo actually drew the arc most frames (drew ${drew}/9)`);
  assert.equal(body.done, true, 'demo self-terminated at duration (bounded)');
  const ctxLast = makeCtx();
  drawEffects(ctxLast, {});
  assert.equal(ctxLast.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('end-to-end: fire → updateEffects → drawEffects sweeps the arc, then prunes', () => {
  resetEffects();
  const c = facingCarrier(0, 100, 1, 0);
  const inst = fireManual({ type: 'attack-arc', params: { arcAngle: Math.PI / 2, radius: 40, duration: 0.2 } }, c);
  assert.ok(inst !== null, 'fired through the engine');
  let drew = 0;
  let lastLead = null;
  for (let i = 1; i <= 12; i++) { // 12 frames = 0.2s
    updateEffects(DT);
    const ctx = makeCtx();
    drawEffects(ctx, {});
    if (ctx.calls.some(cc => cc[0] === 'stroke')) {
      drew++;
      const arc = ctx.calls.find(cc => cc[0] === 'arc');
      lastLead = arc ? arc[5] : lastLead;
    }
  }
  assert.ok(drew >= 6, `drew the arc while active (drew ${drew}/12)`);
  // The sweep is driven against (duration − dt), so the last VISIBLE frame
  // lands the leading edge EXACTLY at base + arcAngle — no tolerance.
  assert.ok(lastLead !== null && close(lastLead, Math.PI / 2),
    `leading edge reached EXACTLY base + arcAngle on the last visible frame (got ${lastLead})`);
  assert.equal(inst.done, true, 'instance completed and was pruned');
  assert.equal(activeCount(), 0, 'pruned from the active set');
  const ctxAfter = makeCtx();
  drawEffects(ctxAfter, {});
  assert.equal(ctxAfter.calls.length, 0, 'no draw after completion');
  resetEffects();
});

console.log(`${passed} passed`);
