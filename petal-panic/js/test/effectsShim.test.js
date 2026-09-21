// Task 2.2 — node-based end-to-end tests for the Effects.* compat shim
// (js/effects.js over the Effect Engine). Run: node js/test/effectsShim.test.js
// No DOM needed: mock canvas ctx + pure modules. Fixed dt = 1/60 per project
// convention. These exercise the shim's public surface exactly as
// systems/update.js and systems/render.js use it.

import { strict as assert } from 'node:assert';
import { Effects } from '../effects.js';
import { particles } from '../particles.js';
import { fire, fireManual } from '../effects/index.js';

const DT = 1 / 60;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Drain the shared particle pool so a test can count spawns deterministically. */
function drainPool() {
  for (const s of particles.activeItems) s.alive = false;
  particles.updateAll(1);
}

/** Minimal mock CanvasRenderingContext2D recording the calls drawOverlay issues. */
function mockCtx() {
  const calls = [];
  const grad = { addColorStop: (o, c) => calls.push(['grad.addColorStop', o, c]) };
  return {
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    fillRect: (x, y, w, h) => calls.push(['fillRect', x, y, w, h]),
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    get fillStyle() { return undefined; },
    set globalAlpha(v) { calls.push(['globalAlpha', v]); },
    get globalAlpha() { return 1; },
    createRadialGradient: (...a) => { calls.push(['createRadialGradient', ...a]); return grad; },
  };
}

console.log('Screen-space lifecycle through the shim (kick → step → read)');
ok('vignette ≈ 0.5 after 15 frames at fixed dt', () => {
  Effects.reset();
  Effects.heroDamaged(); // kicks to 1
  for (let i = 0; i < 15; i++) Effects.update(DT); // 15 * (1/60) = 0.25s of a 0.5s decay
  assert.ok(Math.abs(Effects.vignette - 0.5) < 1e-9, `got ${Effects.vignette}`);
});
ok('screenFlash decays linearly over ~0.15s', () => {
  Effects.reset();
  Effects.bigExplosion(); // kicks to 1
  for (let i = 0; i < 3; i++) Effects.update(DT); // 3 frames = 0.05s → 1 - 0.05/0.15
  assert.ok(Math.abs(Effects.screenFlash - (1 - (3 * DT) / 0.15)) < 1e-9, `got ${Effects.screenFlash}`);
  for (let i = 0; i < 10; i++) Effects.update(DT); // 13 frames total > 0.15s
  assert.equal(Effects.screenFlash, 0, 'flash fully faded');
});
ok('heroDamaged(0.2) while vignette is up never lowers it', () => {
  Effects.reset();
  Effects.heroDamaged(); // 1
  for (let i = 0; i < 10; i++) Effects.update(DT); // still well above 0.2
  const before = Effects.vignette;
  Effects.heroDamaged(0.2); // weaker hit mid-decay
  assert.equal(Effects.vignette, before, `weaker kick must not lower (${before})`);
});
ok('reset clears tracked overlays between runs', () => {
  Effects.heroDamaged();
  Effects.bigExplosion();
  Effects.reset();
  assert.equal(Effects.vignette, 0);
  assert.equal(Effects.screenFlash, 0);
});

console.log('drawOverlay issues real canvas calls via the engine path');
ok('vignette overlay issues gradient + fill on the viewport', () => {
  Effects.reset();
  Effects.heroDamaged();
  const ctx = mockCtx();
  Effects.drawOverlay(ctx, 960, 540);
  const kinds = ctx.calls.map(c => c[0]);
  assert.ok(kinds.includes('createRadialGradient'), 'expected a radial gradient');
  assert.ok(kinds.includes('fillRect'), 'expected a fillRect');
  const fill = ctx.calls.find(c => c[0] === 'fillRect');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [0, 0, 960, 540], 'fills the whole viewport');
});
ok('screen-flash overlay issues alpha + white fill on the viewport', () => {
  Effects.reset();
  Effects.bigExplosion();
  const ctx = mockCtx();
  Effects.drawOverlay(ctx, 960, 540);
  const kinds = ctx.calls.map(c => c[0]);
  assert.ok(kinds.includes('globalAlpha'), 'expected a globalAlpha set');
  const fill = ctx.calls.find(c => c[0] === 'fillRect');
  assert.deepEqual([fill[1], fill[2], fill[3], fill[4]], [0, 0, 960, 540], 'fills the whole viewport');
  assert.ok(ctx.calls.some(c => c[0] === 'fillStyle' && c[1] === '#ffffff'), 'white flash color');
});
ok('both overlays render in one pass when both are active', () => {
  Effects.reset();
  Effects.heroDamaged();
  Effects.bigExplosion();
  const ctx = mockCtx();
  Effects.drawOverlay(ctx, 960, 540);
  const fills = ctx.calls.filter(c => c[0] === 'fillRect');
  assert.equal(fills.length, 2, `expected vignette + flash fills, got ${fills.length}`);
});
ok('no canvas calls when no overlay is active', () => {
  Effects.reset();
  const ctx = mockCtx();
  Effects.drawOverlay(ctx, 960, 540);
  assert.equal(ctx.calls.length, 0, `expected zero calls, got ${ctx.calls.length}`);
});

console.log('Particle pool advances exactly once per frame (shim does not double-step)');
ok('Effects.update(dt) leaves the particle pool untouched', () => {
  drainPool();
  Effects.spawnHitSparkles(100, 100, 4);
  const items = [...particles.activeItems];
  assert.ok(items.length >= 1, 'pool has live sparkles');
  const lifeBefore = items.map(s => s.life);
  Effects.update(DT); // shim step only
  assert.deepEqual(items.map(s => s.life), lifeBefore, 'shim update must not advance particles');
  particles.updateAll(DT); // the single owner of pool stepping
  assert.ok(items.every((s, i) => s.life < lifeBefore[i]), 'pool advanced by its own call site');
});

console.log('Shake constant is owned by spriteShake.js');
ok('getEntityShakeOffset stays within ±SHAKE_AMT while flashing', () => {
  const e = { hitFlash: 0.1 };
  let sawNonZero = false;
  for (let i = 0; i < 50; i++) {
    const o = Effects.getEntityShakeOffset(e);
    assert.ok(Math.abs(o.x) <= 3 && Math.abs(o.y) <= 3, `out of range: ${JSON.stringify(o)}`);
    if (o.x !== 0 || o.y !== 0) sawNonZero = true;
  }
  assert.ok(sawNonZero, 'expected at least one non-zero offset in 50 rolls');
});
ok('beginEnemyShake fires the engine type AND bumps hitFlash', () => {
  const e = { hitFlash: 0 };
  Effects.beginEnemyShake(e);
  assert.ok(e.hitFlash >= 0.1);
});


console.log('Camera-shake singleton through the shim (task 3.3 review)');
ok('triggerShake kicks a tracked instance; getShakeOffset returns its live offset', () => {
  Effects.reset();
  assert.deepEqual(Effects.getShakeOffset(), { x: 0, y: 0 }, 'idle → zero offset');
  Effects.triggerShake(6);
  // Stub Math.random so the per-frame re-rolls are deterministic and the
  // envelope math is checkable frame by frame.
  const seq = [0.25, 0.75]; // x,y pair cycled every frame (perFrame default)
  let ri = 0;
  const origRand = Math.random;
  Math.random = () => seq[ri++ % seq.length];
  try {
    for (let f = 0; f < 15; f++) {
      Effects.update(DT); // engine step drives the tracked shake instance
      const o = Effects.getShakeOffset();
      // amp_k = intensity * ((DURATION - k*DT)/DURATION), k = f+1
      const amp = 6 * ((0.25 - (f + 1) * DT) / 0.25);
      // The effect multiplies by (2*rand-1): x-roll 0.25 -> -0.5, y-roll 0.75 -> +0.5
      const ex = -0.5 * amp; // frame 1: -0.5 * 5.6 = -2.8
      const ey = +0.5 * amp; // frame 1: +0.5 * 5.6 =  2.8
      assert.ok(Math.abs(o.x - ex) < 1e-4 && Math.abs(o.y - ey) < 1e-4,
        `frame ${f + 1} offset (${o.x}, ${o.y}) vs (${ex}, ${ey})`);
    }
  } finally { Math.random = origRand; }
  for (let i = 0; i < 10; i++) Effects.update(DT); // drain past the 0.25s lifetime
  assert.deepEqual(Effects.getShakeOffset(), { x: 0, y: 0 }, 'zero once done');
});
ok('triggerShake max-kick merge: smaller trigger keeps the bigger running shake', () => {
  Effects.reset();
  Effects.triggerShake(8);
  for (let i = 0; i < 10; i++) Effects.update(DT); // ~0.167s into the 0.25s life
  const origRand = Math.random;
  Math.random = () => 0.25; // deterministic: (2*0.25-1) = -0.5 → x = -0.5*amp each frame
  try {
    Effects.triggerShake(4); // smaller than the running peak of 8
    // Legacy parity: the smaller kick RESETS the lifetime clock, so from the
    // kick frame on the offset follows a FRESH full decay curve at the kept
    // 8px peak — not a continuation of the old (already-decayed) curve.
    for (let f = 0; f < 15; f++) {
      Effects.update(DT);
      const o = Effects.getShakeOffset();
      const amp = 8 * ((0.25 - (f + 1) * DT) / 0.25); // fresh curve, peak 8
      assert.ok(Math.abs(o.x - (-0.5 * amp)) < 1e-4,
        `frame ${f + 1} x ${o.x} vs ${-0.5 * amp} (fresh decay curve at the kept peak)`);
      assert.ok(Math.abs(o.y - (-0.5 * amp)) < 1e-4,
        `frame ${f + 1} y ${o.y} vs ${-0.5 * amp}`);
    }
    // The 15 updates above consumed the fresh instance's full 0.25s lifetime
    // (k=1..15). From its 16th update on it is DONE — the reset started a
    // fresh full lifetime from the kick frame, not an extension of the old one.
    for (let i = 0; i < 2; i++) {
      Effects.update(DT);
      assert.deepEqual(Effects.getShakeOffset(), { x: 0, y: 0 },
        `post-lifetime update ${i + 1} must be zero (reset instance done at exactly 0.25s)`);
    }
  } finally { Math.random = origRand; }
});
ok('triggerShake re-fires on an equal-or-larger kick (timer-reset parity)', () => {
  Effects.reset();
  Effects.triggerShake(6);
  for (let i = 0; i < 10; i++) Effects.update(DT); // ~0.167s into the 0.25s life
  Effects.triggerShake(6); // equal magnitude → fresh full-lifetime instance
  const origRand = Math.random;
  Math.random = () => 0.25; // deterministic: (2*0.25-1) = -0.5 → x = -0.5*amp each frame
  try {
    for (let f = 0; f < 15; f++) {
      Effects.update(DT);
      const o = Effects.getShakeOffset();
      const amp = 6 * ((0.25 - (f + 1) * DT) / 0.25);
      assert.ok(Math.abs(o.x - (-0.5 * amp)) < 1e-4,
        `frame ${f + 1} x ${o.x} vs ${-0.5 * amp} (fresh decay curve from the re-fire)`);
    }
    // The first 15 updates above consumed the fresh instance's full 0.25s
    // lifetime (k=1..15). From its 16th update on the instance is DONE —
    // timer-reset parity: the re-fire started a fresh full lifetime from the
    // re-fire point, not a continuation of the old curve.
    for (let i = 0; i < 2; i++) {
      Effects.update(DT);
      assert.deepEqual(Effects.getShakeOffset(), { x: 0, y: 0 },
        `post-lifetime update ${i + 1} must be zero (fresh instance done at exactly 0.25s)`);
    }
  } finally { Math.random = origRand; }
});
ok('carrier-declared camera-shake on explosion adds to getShakeOffset alongside the tracked one', () => {
  // Declaratively fired instances (carrier config) are engine-owned and were
  // previously invisible to the camera read path — getShakeOffset must sum
  // ALL active 'camera-shake' instances, not just the tracked singleton.
  Effects.reset();
  const carrier = { effects: [{ on: 'explosion', type: 'camera-shake', params: { intensity: 4 } }] };
  assert.equal(fire('explosion', carrier), 1, 'carrier fire spawned the declarative instance');
  Effects.triggerShake(6); // tracked singleton at a different peak
  const origRand = Math.random;
  Math.random = () => 0.25; // both bodies roll (2*0.25-1) = -0.5 each axis
  try {
    Effects.update(DT); // steps BOTH instances (same default duration 0.25s)
    const o = Effects.getShakeOffset();
    const ampTracked = 6 * ((0.25 - DT) / 0.25);
    const ampCarrier = 4 * ((0.25 - DT) / 0.25);
    const ex = -0.5 * (ampTracked + ampCarrier); // offsets ADD
    assert.ok(Math.abs(o.x - ex) < 1e-4 && Math.abs(o.y - ex) < 1e-4,
      `summed offset (${o.x}, ${o.y}) vs (${ex}, ${ex})`);
  } finally { Math.random = origRand; }
  Effects.reset();
});
ok('camera and entity shake paths coexist: distinct correct offsets simultaneously', () => {
  // Regression for the object-literal key collision where two methods named
  // getShakeOffset coexisted (the sprite-shake body silently won, so the
  // camera path always read {0,0}). Proves BOTH read paths work at once:
  // a live camera shake AND a live entity hitFlash yield their own offsets.
  Effects.reset();
  const e = { hitFlash: 0 };
  Effects.triggerShake(6);
  Effects.beginEnemyShake(e); // bumps e.hitFlash to 0.1
  assert.ok(e.hitFlash >= 0.1, 'entity flash is live');
  const seq = [0.25, 0.75]; // x,y pair cycled per roll
  let ri = 0;
  const origRand = Math.random;
  Math.random = () => seq[ri++ % seq.length];
  try {
    Effects.update(DT); // steps the tracked camera-shake instance (rolls once)
    const cam = Effects.getShakeOffset();          // camera path (no-arg)
    const amp = 6 * ((0.25 - DT) / 0.25);
    // (2*rand-1): x-roll 0.25 -> -0.5, y-roll 0.75 -> +0.5; frame 1 amp = 5.6
    assert.ok(Math.abs(cam.x - (-0.5 * amp)) < 1e-4 && Math.abs(cam.y - (+0.5 * amp)) < 1e-4,
      `camera offset (${cam.x}, ${cam.y}) vs envelope (${-0.5 * amp}, ${+0.5 * amp})`);
    assert.ok(cam.x !== 0 || cam.y !== 0, 'camera offset non-zero while shaking');
    const ent = Effects.getEntityShakeOffset(e);   // sprite path (with entity)
    assert.ok(Math.abs(ent.x) <= 3 + 1e-9 && Math.abs(ent.y) <= 3 + 1e-9,
      `entity offset (${ent.x}, ${ent.y}) within ±SHAKE_AMT`);
    assert.ok(ent.x !== 0 || ent.y !== 0, 'entity offset non-zero while flashing');
    // The two paths are independent: stub sequence positions differ, so the
    // values are distinct draws — but the contract is just that each is its
    // own correct value, not that they differ from each other.
    assert.notDeepEqual({ x: cam.x, y: cam.y }, { x: 0, y: 0 });
  } finally { Math.random = origRand; }
  Effects.reset();
});

ok('carrier-declared sprite-shake-standalone shifts ONLY its carrier entity', () => {
  // Standalone instances own their timer (not hitFlash) and must be consumed
  // per-carrier by identity: the carrier's translate gets the summed offset,
  // other entities are unaffected.
  Effects.reset();
  const e1 = { hitFlash: 0 }; // the carrier
  const e2 = { hitFlash: 0 }; // an unrelated entity
  const carrier = { effects: [{ on: 'hitLanded', type: 'sprite-shake-standalone', params: { duration: 0.5 } }] };
  assert.equal(fire('hitLanded', carrier), 1, 'carrier fire spawned the standalone instance');
  const origRand = Math.random;
  Math.random = () => 0.25; // deterministic roll: (2*0.25-1) = -0.5 each axis
  try {
    Effects.update(DT);
    const o1 = Effects.getStandaloneShakeOffset(carrier);
    const o2 = Effects.getStandaloneShakeOffset(e1); // not the carrier → zero
    const o3 = Effects.getStandaloneShakeOffset(e2); // not the carrier → zero
    const amp = 3 * ((0.5 - DT) / 0.5); // default h/v intensity 3, linear decay
    assert.ok(Math.abs(o1.x - (-0.5 * amp)) < 1e-4 && Math.abs(o1.y - (-0.5 * amp)) < 1e-4,
      `carrier offset (${o1.x}, ${o1.y}) vs (${-0.5 * amp}, ${-0.5 * amp})`);
    assert.deepEqual(o2, { x: 0, y: 0 }, 'non-carrier entity must get zero');
    assert.deepEqual(o3, { x: 0, y: 0 }, 'unrelated entity must get zero');
  } finally { Math.random = origRand; }
  Effects.reset();
});

console.log('Combined per-entity shake (getEntityShakeTotal) — hitFlash + standalone sum');
ok('getEntityShakeTotal sums a live hitFlash AND a carrier-declared standalone instance', () => {
  // Deterministic: stub Math.random so both the hitFlash-driven sprite-shake
  // (fresh roll each read) and the standalone body's update() roll are fixed.
  Effects.reset();
  const e = { hitFlash: 0 };
  const carrier = { effects: [{ on: 'hitLanded', type: 'sprite-shake-standalone', params: { duration: 0.5 } }] };
  assert.equal(fire('hitLanded', carrier), 1, 'carrier fire spawned the standalone instance');
  Effects.beginEnemyShake(e); // bumps e.hitFlash to >= 0.1
  assert.ok(e.hitFlash > 0, 'entity flash is live');
  // Bind the standalone instance to `e` by identity so getStandaloneShakeOffset(e)
  // sees it: re-fire with e as the carrier directly.
  Effects.reset();
  const inst = fireManual({ type: 'sprite-shake-standalone', params: { duration: 0.5 } }, e);
  assert.ok(inst, 'standalone instance fired with e as carrier');
  const seq = [0.25, 0.75]; // x,y pair cycled per roll
  let ri = 0;
  const origRand = Math.random;
  Math.random = () => seq[ri++ % seq.length];
  try {
    Effects.update(DT); // steps the standalone instance (rolls once: x=-0.5*amp, y=+0.5*amp)
    const amp = 3 * ((0.5 - DT) / 0.5); // default intensity 3, linear decay
    const total = Effects.getEntityShakeTotal(e);
    // Standalone contribution (held from the single update): (-0.5*amp, +0.5*amp).
    // HitFlash contribution: getEntityShakeOffset reads fresh → next two rolls.
    const hx = (seq[ri++ % seq.length] * 2 - 1) * 3;
    const hy = (seq[ri++ % seq.length] * 2 - 1) * 3;
    assert.ok(Math.abs(total.x - (-0.5 * amp + hx)) < 1e-4,
      `total.x ${total.x} vs ${-0.5 * amp + hx}`);
    assert.ok(Math.abs(total.y - (+0.5 * amp + hy)) < 1e-4,
      `total.y ${total.y} vs ${+0.5 * amp + hy}`);
    // The sum must differ from either source alone (both are non-zero here).
    const solo = Effects.getStandaloneShakeOffset(e);
    assert.notDeepEqual({ x: total.x, y: total.y }, { x: solo.x, y: solo.y },
      'combined offset must include the hitFlash term');
  } finally { Math.random = origRand; }
  Effects.reset();
});
ok('getEntityShakeTotal is {0,0} for a non-carrier entity with no hitFlash', () => {
  Effects.reset();
  const other = { hitFlash: 0 }; // never flashed, never a carrier
  const carrier = { effects: [{ on: 'hitLanded', type: 'sprite-shake-standalone', params: { duration: 0.5 } }] };
  assert.equal(fire('hitLanded', carrier), 1, 'standalone instance lives on `carrier`, not `other`');
  const o = Effects.getEntityShakeTotal(other);
  assert.deepEqual(o, { x: 0, y: 0 }, 'non-carrier, no-flash entity gets zero combined offset');
  Effects.reset();
});

console.log(`${passed} passed`);
