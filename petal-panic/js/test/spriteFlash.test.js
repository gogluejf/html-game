// Task 3.2 — node-based unit tests for the sprite-flash effect
// (js/effects/spriteFlash.js, effects.md §12). Run: node js/test/spriteFlash.test.js
// No DOM needed: the effect is a pure module; render() is exercised with a
// recording stub context. Fixed dt = 1/60 per project convention.

import { strict as assert } from 'node:assert';
import { spriteFlash } from '../effects/spriteFlash.js';
import { hasEffect, fireManual, fire, resetEffects, activeCount, updateEffects, drawEffects } from '../effects/index.js';
import '../effects/registry.js'; // side effect: registers the types

const DT = 1 / 60;
const EPS = 1e-9;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Recording canvas stub: captures save/restore/fillRect and style/alpha writes. */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    fillRect(...a) { calls.push(['fill', ...a]); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
    set fillStyle(v) { calls.push(['style', v]); },
    get fillStyle() { return undefined; },
    createRadialGradient(...a) {
      calls.push(['createRadialGradient', ...a]);
      return { addColorStop(o, c) { calls.push(['addColorStop', o, c]); } };
    },
    translate(...a) { calls.push(['translate', ...a]); },
    rotate(...a) { calls.push(['rotate', ...a]); },
    beginPath() { calls.push(['beginPath']); },
    closePath() { calls.push(['closePath']); },
    fill() { calls.push(['fillPath']); },
    stroke() { calls.push(['strokePath']); },
    moveTo(...a) { calls.push(['moveTo', ...a]); },
    lineTo(...a) { calls.push(['lineTo', ...a]); },
    arc(...a) { calls.push(['arc', ...a]); },
  };
}

/** Carrier with a world-space box (Entity contract). */
function makeCarrier(x, y, w, h) {
  return {
    worldBox() { return { x, y, w, h }; },
    origin() { return { x: x + w / 2, y: y + h / 2 }; },
    size() { return { w, h }; },
  };
}

console.log('flash cycle');
ok('defaults: duration 0.4s, 3 flashes → 6 half-cycles of ~0.0667s each', () => {
  const b = spriteFlash({}, makeCarrier(0, 0, 32, 32));
  assert.equal(b.on, true, 'starts ON (kicks in immediately on fire)');
  // Frame 1 (~0.0167s): still inside the first ON half (0..0.0667s).
  b.update(DT);
  assert.equal(b.on, true, `frame 1 ${b.elapsed}`);
  // Frame 4 (~0.0667s): crosses into the first OFF half.
  for (let i = 0; i < 3; i++) b.update(DT);
  assert.equal(b.on, false, `frame 4 ${b.elapsed}`);
  // Frame 8 (~0.1333s): back ON for the second cycle.
  for (let i = 0; i < 4; i++) b.update(DT);
  assert.equal(b.on, true, `frame 8 ${b.elapsed}`);
});
ok('tints on/off at the declared frequency for the declared number of flashes', () => {
  // Exact contract at fixed dt = 1/60 (no tolerance band): with
  // flashFrequency 15 over 0.4s → round(15 * 0.4) = 6 cycles → 12 half-cycles
  // of duration/(2*flashes) = 1/30 s ≈ 2 frames each. Derive the expected
  // ON/OFF frame sets from the SAME phase formula the effect uses:
  //   phase = floor((elapsed + 1e-9) / half), ON iff phase is even,
  // evaluated at each frame's accumulated elapsed = k * DT (k = 1..N).
  const b = spriteFlash({ flashFrequency: 15, duration: 0.4 }, makeCarrier(0, 0, 32, 32));
  const flashes = Math.max(1, Math.round(15 * 0.4)); // 6
  const half = 0.4 / (2 * flashes);                    // 1/30 s
  let observedOn = [], observedOff = [];
  let k = 0;
  while (!b.done) {
    b.update(DT);
    k++;
    if (b.on) observedOn.push(k); else observedOff.push(k);
  }
  // Expected lifetime in frames: done when elapsed >= duration - 1e-9, i.e.
  // the first k with k/60 >= 0.4 - 1e-9 → k = 24. That final frame marks
  // done and forces OFF before any phase evaluation, so strip it from the
  // observed sets; expectations are derived over frames 1..k-1.
  assert.equal(k, 24, `lifetime ${k} frames`);
  const lastPhaseFrame = k - 1; // frames 1..23 carry a phase state
  const expectedOn = [], expectedOff = [];
  for (let f = 1; f <= lastPhaseFrame; f++) {
    const phase = Math.floor((f * DT + EPS) / half);
    (phase % 2 === 0 ? expectedOn : expectedOff).push(f);
  }
  assert.deepEqual(observedOn, expectedOn, 'exact ON frame set');
  assert.deepEqual(observedOff.slice(0, -1), expectedOff, 'exact OFF frame set (done-frame excluded)');
  // Phase-transition count over the lifetime: the state flips at every
  // half-cycle boundary inside (0, duration) → exactly 2*flashes - 1 flips.
  const seq = [...observedOn.map(f => [f, 1]), ...observedOff.map(f => [f, 0])]
    .sort((a, c) => a[0] - c[0]);
  let transitions = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i][1] !== seq[i - 1][1]) transitions++;
  }
  assert.equal(transitions, 2 * flashes - 1, `transitions ${transitions}`);
});
ok('wrong flash count is detectable: flashes=2 produces a different exact frame pattern than flashes=3', () => {
  // Guard against grossly wrong cycle counts slipping through: run both
  // configs and require their ON-frame sets to differ AND each to match its
  // own derived expectation exactly.
  const run = (p) => {
    const b = spriteFlash(p, makeCarrier(0, 0, 32, 32));
    const on = [];
    let k = 0;
    while (!b.done) { b.update(DT); k++; if (b.on) on.push(k); }
    return { on, k };
  };
  const two = run({ flashes: 2, duration: 0.4 });
  const three = run({ flashes: 3, duration: 0.4 });
  assert.notDeepEqual(two.on, three.on, 'different flash counts must give different patterns');
  const check = (r, nFlashes) => {
    const half = 0.4 / (2 * nFlashes);
    const exp = [];
    // Frames 1..k-1 carry a phase state; frame k marks done (forced OFF).
    for (let f = 1; f < r.k; f++) if (Math.floor((f * DT + EPS) / half) % 2 === 0) exp.push(f);
    assert.deepEqual(r.on, exp, `flashes=${nFlashes} exact ON set`);
  };
  check(two, 2);
  check(three, 3);
});
ok('explicit flashes param wins over flashFrequency when both are given', () => {
  const b = spriteFlash({ flashes: 2, flashFrequency: 100, duration: 0.4 }, makeCarrier(0, 0, 32, 32));
  // 2 cycles → 4 halves of 0.1s each (≈ 6 frames).
  assert.equal(b.on, true);
  for (let i = 0; i < 6; i++) b.update(DT); // ~0.1s → first OFF half
  assert.equal(b.on, false, `at 0.1s ${b.elapsed}`);
  for (let i = 0; i < 6; i++) b.update(DT); // ~0.2s → second ON half
  assert.equal(b.on, true, `at 0.2s ${b.elapsed}`);
});
ok('reports done exactly when total lifetime elapses (== duration)', () => {
  const b = spriteFlash({ duration: 0.4, flashes: 3 }, makeCarrier(0, 0, 32, 32));
  for (let i = 0; i < 23; i++) b.update(DT); // 23 frames ≈ 0.3833s < 0.4s
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT); // frame 24 = 0.4s
  assert.equal(b.done, true, 'done at the lifetime boundary');
  assert.equal(b.on, false, 'ends OFF (no trailing tint after completion)');
});
ok('clamps opacity above 1 and below 0', () => {
  const ctx = makeCtx();
  const hi = spriteFlash({ opacity: 99, duration: 0.2 }, makeCarrier(0, 0, 10, 10));
  hi.render(ctx);
  const alphaHi = ctx.calls.find(c => c[0] === 'alpha');
  assert.equal(alphaHi[1], 1, 'opacity clamped to 1');
  const neg = spriteFlash({ opacity: -3, duration: 0.2 }, makeCarrier(0, 0, 10, 10));
  neg.render(makeCtx()); // value path: opacity 0 → still draws? no: guard is only done/on
  // Negative opacity collapses to 0: render runs but at alpha 0 (invisible).
  const ctx2 = makeCtx();
  neg.render(ctx2);
  const alphaNeg = ctx2.calls.find(c => c[0] === 'alpha');
  assert.equal(alphaNeg?.[1], 0, 'negative opacity collapses to 0');
});

console.log('rendering');
ok('renders the sprite-box tint at alpha = opacity with the declared color while ON', () => {
  const carrier = makeCarrier(100, 200, 32, 48);
  const ctx = makeCtx();
  const b = spriteFlash({ color: '#ff0000', opacity: 0.6, duration: 0.4 }, carrier);
  b.update(DT); // still ON
  b.render(ctx);
  const fill = ctx.calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [100, 200, 32, 48], 'fills the sprite box');
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(Math.abs(alpha[1] - 0.6) < EPS, `alpha ${alpha[1]}`);
  assert.ok(ctx.calls.some(c => c[0] === 'style' && c[1] === '#ff0000'), 'color recorded');
  assert.deepEqual([ctx.calls[0][0], ctx.calls.at(-1)[0]], ['save', 'restore'], 'save/restore bracket the draw');
});
ok('draws nothing while OFF or once done', () => {
  const carrier = makeCarrier(0, 0, 10, 10);
  const b = spriteFlash({ duration: 0.4, flashes: 3 }, carrier);
  for (let i = 0; i < 4; i++) b.update(DT); // into first OFF half
  const ctxOff = makeCtx();
  b.render(ctxOff);
  assert.equal(ctxOff.calls.length, 0, 'no draw while OFF');
  for (let i = 0; i < 20; i++) b.update(DT); // past lifetime
  assert.equal(b.done, true);
  const ctxDone = makeCtx();
  b.render(ctxDone);
  assert.equal(ctxDone.calls.length, 0, 'no draw once done');
});
ok('reads the sprite box at DRAW time (tracks a moving carrier)', () => {
  let bx = 0, by = 0;
  const carrier = {
    worldBox() { return { x: bx, y: by, w: 20, h: 20 }; },
  };
  const b = spriteFlash({ duration: 0.4 }, carrier);
  const ctx = makeCtx();
  b.render(ctx);
  let fill = ctx.calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2]], [0, 0], 'first draw at initial position');
  bx = 50; by = 60; // carrier moved
  b.render(makeCtx());
  const ctx2 = makeCtx();
  b.render(ctx2);
  fill = ctx2.calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2]], [50, 60], 'second draw tracks the new position');
});
ok('falls back to factory-time params.box when the carrier has no geometry accessors', () => {
  const b = spriteFlash({ duration: 0.4, box: { x: 5, y: 6, w: 7, h: 8 } });
  const ctx = makeCtx();
  b.render(ctx);
  const fill = ctx.calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [5, 6, 7, 8], 'params.box used');
});
ok('blendIntensity multiplies the tint alpha; default 1.0 preserves opacity', () => {
  const b = spriteFlash({ opacity: 0.6, blendIntensity: 0.5, duration: 0.4 }, makeCarrier(0, 0, 10, 10));
  const ctx = makeCtx();
  b.render(ctx);
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(Math.abs(alpha[1] - 0.3) < EPS, `alpha ${alpha[1]} (0.6 * 0.5)`);
  // Default: no blendIntensity → effective alpha equals opacity exactly.
  const d = spriteFlash({ opacity: 0.7, duration: 0.4 }, makeCarrier(0, 0, 10, 10));
  const ctx2 = makeCtx();
  d.render(ctx2);
  const alphaD = ctx2.calls.find(c => c[0] === 'alpha');
  assert.ok(Math.abs(alphaD[1] - 0.7) < EPS, `default alpha ${alphaD[1]}`);
  // Clamped like opacity: >1 collapses to full strength of opacity.
  const hi = spriteFlash({ opacity: 0.5, blendIntensity: 9, duration: 0.4 }, makeCarrier(0, 0, 10, 10));
  const ctx3 = makeCtx();
  hi.render(ctx3);
  const alphaHi = ctx3.calls.find(c => c[0] === 'alpha');
  assert.ok(Math.abs(alphaHi[1] - 0.5) < EPS, `clamped alpha ${alphaHi[1]}`);
});
ok('defaults to white tint', () => {
  const ctx = makeCtx();
  const b = spriteFlash({ duration: 0.4, box: { x: 0, y: 0, w: 4, h: 4 } });
  b.render(ctx);
  assert.ok(ctx.calls.some(c => c[0] === 'style' && c[1] === '#ffffff'));
});

console.log('registration');
ok('"sprite-flash" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('sprite-flash'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'sprite-flash', params: { duration: 0.4, box: { x: 0, y: 0, w: 16, h: 16 } } });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'sprite-flash');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
for (const trigger of ['hitLanded', 'stateChange', 'damageTaken']) {
  ok(`attachable via carrier config on its trigger (${trigger})`, () => {
    resetEffects();
    const carrier = {
      worldBox: () => ({ x: 0, y: 0, w: 16, h: 16 }),
      effects: [{ on: trigger, type: 'sprite-flash', params: { color: '#00ff00', duration: 0.3 } }],
    };
    const spawned = fire(trigger, carrier);
    assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
    assert.equal(activeCount(), 1, 'instance entered the active set');
    resetEffects();
  });
}
ok('end-to-end: fire → updateEffects → drawEffects tints the carrier box', () => {
  // Proves the viewport/lifecycle contract through the real engine path:
  // the instance advances via updateEffects and renders via drawEffects.
  resetEffects();
  const carrier = { worldBox: () => ({ x: 10, y: 20, w: 30, h: 40 }) };
  const inst = fireManual({ type: 'sprite-flash', params: { color: '#00ffff', opacity: 0.5, duration: 0.4 } }, carrier);
  assert.ok(inst !== null, 'fired through the engine');
  updateEffects(DT); // one frame: still ON
  const ctx = makeCtx();
  drawEffects(ctx, { view: { w: 640, h: 480 } });
  const fill = ctx.calls.find(c => c[0] === 'fill');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [10, 20, 30, 40], 'carrier box filled');
  const alpha = ctx.calls.find(c => c[0] === 'alpha');
  assert.ok(Math.abs(alpha[1] - 0.5) < EPS, `alpha ${alpha[1]}`);
  // Advance past the lifetime: pruned from the active set, no further draws.
  for (let i = 0; i < 30; i++) updateEffects(DT);
  assert.equal(activeCount(), 0, 'pruned after lifetime');
  const ctx2 = makeCtx();
  drawEffects(ctx2, { view: { w: 640, h: 480 } });
  assert.equal(ctx2.calls.length, 0, 'no draw after completion');
  resetEffects();
});
ok('two-pass model: impactStar renders in the world pass, NOT the screen pass', () => {
  // World-space effects (default space) must be drawn by the camera-translated
  // pass only; the post-restore screen pass must skip them.
  resetEffects();
  const inst = fireManual({ type: 'impact-star', params: { x: 30, y: 40, size: 20, duration: 0.4 } });
  assert.ok(inst !== null, 'fired through the engine');
  updateEffects(DT); // one frame: still active
  const worldCtx = makeCtx();
  drawEffects(worldCtx, undefined, { space: 'world' });
  assert.ok(worldCtx.calls.some(c => c[0] === 'translate'), 'world pass drew the star');
  const screenCtx = makeCtx();
  drawEffects(screenCtx, { view: { w: 640, h: 480 } }, { space: 'screen' });
  assert.equal(screenCtx.calls.length, 0, 'screen pass must not draw a world-space effect');
  resetEffects();
});
ok('two-pass model: vignette renders in the screen pass, NOT the world pass', () => {
  // Screen-space overlays (space: 'screen') must be drawn by the post-restore
  // pass only; the camera-translated world pass must skip them.
  resetEffects();
  const inst = fireManual({ type: 'vignette', params: { strength: 1 } }, null, { view: { w: 960, h: 540 } });
  assert.ok(inst !== null, 'fired through the engine');
  updateEffects(DT); // one frame: still above zero
  const worldCtx = makeCtx();
  drawEffects(worldCtx, undefined, { space: 'world' });
  assert.equal(worldCtx.calls.length, 0, 'world pass must not draw a screen-space overlay');
  const screenCtx = makeCtx();
  drawEffects(screenCtx, { view: { w: 960, h: 540 } }, { space: 'screen' });
  assert.ok(screenCtx.calls.some(c => c[0] === 'fill'), 'screen pass drew the vignette fill');
  resetEffects();
});
ok('complete() force-completes (engine reset path)', () => {
  const b = spriteFlash({ duration: 0.4 }, makeCarrier(0, 0, 10, 10));
  assert.equal(b.done, false);
  b.complete();
  assert.equal(b.done, true);
  assert.equal(b.on, false);
});

console.log(`${passed} passed`);
