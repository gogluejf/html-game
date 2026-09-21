// Task 3.4 — node-based unit tests for the standalone sprite-shake effect
// (js/effects/spriteShakeStandalone.js, effects.md §15). Run:
// node js/test/spriteShakeStandalone.test.js
// No DOM needed: the effect is a pure STATE module (render() is a no-op; the
// renderer consumes getOffset()). Fixed dt = 1/60 per project convention.
//
// This type is SEPARATE from the hitFlash-driven 'sprite-shake' shim
// (js/effects/spriteShake.js): it owns its own timer and must work with a
// carrier that has NO hitFlash at all.

import { strict as assert } from 'node:assert';
import { spriteShakeStandalone } from '../effects/spriteShakeStandalone.js';
import { SHAKE_AMT } from '../effects/spriteShake.js';
import { hasEffect, fireManual, fire, resetEffects, activeCount, activeInstances, updateEffects } from '../effects/index.js';
import '../effects/registry.js'; // side effect: registers the types

const DT = 1 / 60;
const EPS = 1e-9;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Deterministic random stub: cycles through the given [0,1) values. */
function withRandomSeq(values, fn) {
  let i = 0;
  const orig = Math.random;
  Math.random = () => values[i++ % values.length];
  try { return fn(); } finally { Math.random = orig; }
}

/** The single active instance (tests run one at a time after resetEffects()). */
function peekActive() {
  const list = activeInstances();
  if (list.length !== 1) throw new Error(`expected exactly 1 active instance, got ${list.length}`);
  return list[0];
}

// Tolerance for "extreme" rand stubs (0.999999 → factor 1.999998 ≈ 2):
// expected offsets are within ~amp*1e-6 of the exact bound.
const STUB_TOL = 1e-4;

console.log('lifetime + bounds');
ok('defaults: h/v intensity 3, duration 0.1s → done exactly at frame 6', () => {
  const b = spriteShakeStandalone({});
  assert.equal(b.done, false);
  for (let i = 0; i < 5; i++) b.update(DT); // 5 frames ≈ 0.0833s < 0.1s
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT); // frame 6 = 0.1s
  assert.equal(b.done, true, 'done at the lifetime boundary (== duration)');
  assert.deepEqual(b.getOffset(), { x: 0, y: 0 }, 'zero offset after duration');
});
ok('getOffset() is {0,0} after done even when queried repeatedly', () => {
  const b = spriteShakeStandalone({ duration: 0.1 });
  withRandomSeq([0.999999, 0], () => {
    for (let i = 0; i < 6; i++) b.update(DT);
  });
  assert.equal(b.done, true);
  assert.deepEqual(b.getOffset(), { x: 0, y: 0 });
  assert.deepEqual(b.getOffset(), { x: 0, y: 0 }, 'still zero on re-query');
  b.update(DT); // updates after done are inert
  assert.deepEqual(b.getOffset(), { x: 0, y: 0 });
});
ok('offsets stay within ±intensity per axis; both endpoints reached via endpoint seeds', () => {
  const b = spriteShakeStandalone({ hIntensity: 4, vIntensity: 7, duration: 0.25 });
  // Frame 1 (t = 1/60): amp = (remaining/duration)^1. Stub rand so both axes
  // hit their extremes on the first roll (perFrame default re-rolls each frame).
  let o1, o2;
  withRandomSeq([0, 0.999999, 0.999999, 0], () => {
    b.update(DT); // roll #1: x = -hInt*amp, y = +vInt*amp
    o1 = b.getOffset();
    const amp1 = (0.25 - DT) / 0.25;
    assert.ok(Math.abs(o1.x - (-4 * amp1)) < STUB_TOL, `x ${o1.x} vs ${-4 * amp1}`);
    assert.ok(Math.abs(o1.y - (7 * amp1)) < STUB_TOL, `y ${o1.y} vs ${7 * amp1}`);
    b.update(DT); // roll #2: x = +hInt*amp, y = -vInt*amp
    o2 = b.getOffset();
    const amp2 = (0.25 - 2 * DT) / 0.25;
    assert.ok(Math.abs(o2.x - (4 * amp2)) < STUB_TOL, `x ${o2.x} vs ${4 * amp2}`);
    assert.ok(Math.abs(o2.y - (-7 * amp2)) < STUB_TOL, `y ${o2.y} vs ${-7 * amp2}`);
    assert.ok(amp2 < amp1, 'amplitude decays over time');
    for (let i = 0; i < 10; i++) {
      b.update(DT);
      const o = b.getOffset();
      assert.ok(Math.abs(o.x) <= 4 + EPS && Math.abs(o.y) <= 7 + EPS,
        `out of bounds (${o.x}, ${o.y})`);
    }
  });
  // Endpoint coverage: derive from the SAME amp constants as the exact STUB_TOL
  // checks above (no independent magic numbers). The decay envelope shrinks
  // monotonically, so these first two rolls ARE the bound-reach proof.
  const amp1 = (0.25 - DT) / 0.25;
  const amp2 = (0.25 - 2 * DT) / 0.25;
  assert.ok(Math.abs(o1.x) > 4 * amp1 - STUB_TOL, `roll #1 x ${o1.x} reached near the -4 bound`);
  assert.ok(Math.abs(o1.y) > 7 * amp1 - STUB_TOL, `roll #1 y ${o1.y} reached near the +7 bound`);
  assert.ok(Math.abs(o2.x) > 4 * amp2 - STUB_TOL, `roll #2 x ${o2.x} reached a positive bound`);
  assert.ok(Math.abs(o2.y) > 7 * amp2 - STUB_TOL, `roll #2 y ${o2.y} reached a negative bound`);
});
ok('hIntensity/vIntensity scale the per-axis bounds independently', () => {
  const b = spriteShakeStandalone({ hIntensity: 2, vIntensity: 9, duration: 0.25 });
  let o;
  withRandomSeq([0.999999, 0.999999], () => {
    b.update(DT);
    o = b.getOffset();
  });
  const amp = (0.25 - DT) / 0.25;
  assert.ok(Math.abs(o.x - 2 * amp) < STUB_TOL, `h-scaled x ${o.x} vs ${2 * amp}`);
  assert.ok(Math.abs(o.y - 9 * amp) < STUB_TOL, `v-scaled y ${o.y} vs ${9 * amp}`);
});
ok('decay exponent shapes the amplitude curve (decay 2 = quadratic ease-out)', () => {
  const b = spriteShakeStandalone({ hIntensity: 5, vIntensity: 5, decay: 2, duration: 0.25 });
  let o;
  withRandomSeq([0.999999, 0.999999], () => {
    b.update(DT);
    o = b.getOffset();
  });
  const t = (0.25 - DT) / 0.25;
  const amp = 5 * Math.pow(t, 2);
  assert.ok(Math.abs(o.x - amp) < STUB_TOL, `quadratic-decay x ${o.x} vs ${amp}`);
  assert.ok(Math.abs(o.y - amp) < STUB_TOL, `quadratic-decay y ${o.y} vs ${amp}`);
});

console.log('frequency semantics');
ok('default frequency is perFrame: a fresh offset every frame (legacy parity)', () => {
  const b = spriteShakeStandalone({ hIntensity: 5, vIntensity: 5, duration: 0.25 }); // no frequency
  const seq = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2]; // x,y pairs for frames 1..3
  let i = 0;
  const orig = Math.random;
  Math.random = () => seq[i++ % seq.length];
  try {
    const seen = [];
    for (let f = 0; f < 3; f++) {
      b.update(DT);
      seen.push(b.getOffset());
      const amp = 5 * ((0.25 - (f + 1) * DT) / 0.25);
      const rx = seq[f * 2], ry = seq[f * 2 + 1];
      assert.ok(Math.abs(seen[f].x - (rx * 2 - 1) * amp) < STUB_TOL,
        `frame ${f + 1} x ${seen[f].x} vs ${(rx * 2 - 1) * amp}`);
      assert.ok(Math.abs(seen[f].y - (ry * 2 - 1) * amp) < STUB_TOL,
        `frame ${f + 1} y ${seen[f].y} vs ${(ry * 2 - 1) * amp}`);
    }
    assert.equal(i, 6, 'each frame drew a fresh (x,y) pair');
    assert.ok(!(seen[0].x === seen[1].x && seen[0].y === seen[1].y),
      'frame 2 offset differs from frame 1 (fresh draw)');
    assert.ok(!(seen[1].x === seen[2].x && seen[1].y === seen[2].y),
      'frame 3 offset differs from frame 2 (fresh draw)');
  } finally { Math.random = orig; }
});
ok('explicit frequency 30 holds the offset between re-roll frames', () => {
  const b = spriteShakeStandalone({ hIntensity: 5, vIntensity: 5, frequency: 30, duration: 0.25 });
  withRandomSeq([0.1, 0.9, 0.3, 0.7], () => {
    b.update(DT); // roll #1
    const o1 = b.getOffset();
    b.update(DT); // within one period of roll #1 → HOLD
    assert.deepEqual(b.getOffset(), o1, 'offset held between re-roll frames');
    b.update(DT); // roll #2
    const o2 = b.getOffset();
    assert.ok(o2.x !== o1.x || o2.y !== o1.y, 're-rolled after one full period');
  });
});
ok('frequency 0.5 Hz holds the offset across frames and re-rolls at the 2s boundary', () => {
  // §15 contract: any positive f works verbatim — 0.5 Hz = a fresh roll every
  // 1/0.5 = 2s. With dt = 1/60 the elapsed−lastRoll gap first reaches the 2s
  // period at frame 121 (frame 1 rolls; 120 further updates bring the gap to
  // 2.0s). This guards against the removed Math.max(1, f) clamp that would
  // have silently promoted 0.5 → 1 Hz (a ~60-frame period instead of ~120).
  const b = spriteShakeStandalone({ hIntensity: 5, vIntensity: 5, frequency: 0.5, duration: 3 });
  let i = 0;
  const orig = Math.random;
  Math.random = () => [0.1, 0.9][i++ % 2]; // alternate so consecutive rolls differ
  try {
    b.update(DT); // frame 1: roll #1 (both axes → consumes 2 draws, i → 2)
    const o1 = b.getOffset();
    assert.equal(i, 2, 'first roll drew one value per axis');
    for (let f = 2; f <= 120; f++) {
      b.update(DT);
      assert.deepEqual(b.getOffset(), o1, `frame ${f} held the frame-1 offset`);
    }
    assert.equal(i, 2, 'no re-roll within the first 2s window');
    b.update(DT); // frame 121: elapsed−lastRoll first reaches the 2s period → re-roll #2
    const o2 = b.getOffset();
    assert.ok(o2.x !== o1.x || o2.y !== o1.y, 're-rolled at the 2s (~120-frame) boundary');
    assert.equal(i, 4, 'exactly one new (x,y) draw at the boundary');
  } finally { Math.random = orig; }
});
ok('first roll happens on the first update after fire (lastRoll starts unrolled)', () => {
  const b = spriteShakeStandalone({ hIntensity: 5, vIntensity: 5, frequency: 30, duration: 0.25 });
  assert.deepEqual(b.getOffset(), { x: 0, y: 0 }, 'no offset before any update');
  withRandomSeq([0.999999, 0.999999], () => {
    b.update(DT); // first update must roll immediately despite the 30Hz period
    const o = b.getOffset();
    const amp = 5 * ((0.25 - DT) / 0.25);
    assert.ok(Math.abs(o.x - amp) < STUB_TOL && Math.abs(o.y - amp) < STUB_TOL,
      `first-update roll (${o.x}, ${o.y}) vs ${amp}`);
  });
});
ok('complete() force-completes and zeroes the offset (engine reset path)', () => {
  const b = spriteShakeStandalone({ hIntensity: 5, vIntensity: 5 });
  b.update(DT);
  assert.equal(b.done, false);
  b.complete();
  assert.equal(b.done, true);
  assert.deepEqual(b.getOffset(), { x: 0, y: 0 });
});

console.log('registration + engine path');
ok('"sprite-shake-standalone" is registered and distinct from the "sprite-shake" shim', () => {
  assert.ok(hasEffect('sprite-shake-standalone'), 'standalone type registered');
  assert.ok(hasEffect('sprite-shake'), 'original hitFlash-driven type still registered');
  resetEffects();
  const inst = fireManual({ type: 'sprite-shake-standalone', params: {} });
  assert.ok(inst !== null, 'fireManual resolved the standalone type');
  assert.equal(inst.type, 'sprite-shake-standalone');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
ok('works with a carrier that has NO hitFlash (independent of the shim)', () => {
  resetEffects();
  const carrier = {
    effects: [{ on: 'stateChange', type: 'sprite-shake-standalone',
                params: { hIntensity: 4, vIntensity: 4, duration: 0.25 } }],
  };
  const spawned = fire('stateChange', carrier);
  assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  withRandomSeq([0.999999, 0.999999], () => {
    updateEffects(DT);
    const o = peekActive().body.getOffset();
    const amp = 4 * ((0.25 - DT) / 0.25);
    assert.ok(Math.abs(o.x - amp) < STUB_TOL && Math.abs(o.y - amp) < STUB_TOL,
      `stateChange-fired offset (${o.x}, ${o.y}) vs ${amp}`);
  });
  assert.equal(carrier.hitFlash, undefined, 'the effect did not touch carrier.hitFlash');
  resetEffects();
});
ok('attachable via carrier config on hitLanded (single engine path, real fire())', () => {
  resetEffects();
  const carrier = {
    effects: [{ on: 'hitLanded', type: 'sprite-shake-standalone',
                params: { hIntensity: 3, vIntensity: 3, duration: 0.25 } }],
  };
  const spawned = fire('hitLanded', carrier);
  assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  withRandomSeq([0.999999, 0.999999], () => {
    updateEffects(DT);
    const o = peekActive().body.getOffset();
    const amp = 3 * ((0.25 - DT) / 0.25);
    assert.ok(Math.abs(o.x - amp) < STUB_TOL && Math.abs(o.y - amp) < STUB_TOL,
      `hitLanded-fired offset (${o.x}, ${o.y}) vs ${amp}`);
  });
  resetEffects();
});
ok('end-to-end: fire → updateEffects drives decay; done exactly at duration', () => {
  // Proves the contract through the real engine path (not direct body calls):
  // the renderer would read inst.body.getOffset() each frame.
  resetEffects();
  const inst = fireManual({ type: 'sprite-shake-standalone',
                            params: { hIntensity: 4, vIntensity: 4, duration: 0.25 } });
  assert.ok(inst !== null, 'fired through the engine');
  withRandomSeq([0.999999, 0.999999], () => {
    updateEffects(DT); // frame 1
    const o = inst.body.getOffset();
    const amp = 4 * ((0.25 - DT) / 0.25);
    assert.ok(Math.abs(o.x - amp) < STUB_TOL && Math.abs(o.y - amp) < STUB_TOL,
      `frame 1 offset (${o.x}, ${o.y}) vs ${amp}`);
  });
  for (let i = 0; i < 14; i++) updateEffects(DT); // frames 2..15 = 0.25s total
  assert.equal(inst.done, true, 'engine prunes the instance at the lifetime boundary');
  assert.equal(activeCount(), 0, 'active set empty after completion');
  assert.deepEqual(inst.body.getOffset(), { x: 0, y: 0 }, 'zero offset after completion');
  resetEffects();
});
ok('standalone theater demo driven only by params (null carrier, manual fire)', () => {
  // The debug theater fires effects explicitly with params alone — this must
  // work with a null carrier and produce a full, bounded, self-terminating run.
  resetEffects();
  const inst = fireManual({ type: 'sprite-shake-standalone',
    params: { hIntensity: 6, vIntensity: 2, duration: 0.5, frequency: 30, decay: 1 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  let maxMag = 0;
  for (let i = 0; i < 29; i++) {
    updateEffects(DT); // 0.5s = 30 frames
    const o = inst.body.getOffset();
    assert.ok(Math.abs(o.x) <= 6 + EPS && Math.abs(o.y) <= 2 + EPS,
      `demo out of bounds (${o.x}, ${o.y})`);
    maxMag = Math.max(maxMag, Math.hypot(o.x, o.y));
  }
  updateEffects(DT); // frame 30 = 0.5s → done
  assert.equal(inst.done, true, 'demo terminates at the declared duration');
  assert.ok(maxMag > 0, 'demo actually shook (non-zero offsets observed)');
  assert.deepEqual(inst.body.getOffset(), { x: 0, y: 0 });
  resetEffects();
});

console.log('simultaneous standalone + hitFlash-driven shake on one entity');
ok('standalone and M2 hitFlash-driven sprite-shake run independently on the same carrier', () => {
  // B-major 2: prove the standalone type and the migrated 'sprite-shake' shim
  // (which rides carrier.hitFlash) coexist SIMULTANEOUSLY on one entity and are
  // fully independent — each owns its own timer/envelope; completing one never
  // touches the other's offset.
  resetEffects();
  const carrier = {
    hitFlash: 0.1, // M2 path active: beginEnemyShake parity window
    effects: [
      { on: 'stateChange', type: 'sprite-shake-standalone',
        params: { hIntensity: 4, vIntensity: 4, frequency: 30, duration: 0.5 } },
      { on: 'stateChange', type: 'sprite-shake', params: {} },
    ],
  };
  assert.equal(fire('stateChange', carrier), 2, 'both instances spawned from one trigger');
  assert.equal(activeCount(), 2, 'both entered the active set simultaneously');

  // Deterministic stubs with the (2·rand−1) factor so both offsets are exact.
  // Per updateEffects frame the engine advances instances in spawn order
  // (standalone first): its 30Hz roll consumes rand #1/#2, then the shim's
  // getOffset() consumes rand #3/#4.
  let i = 0;
  const orig = Math.random;
  Math.random = () => [0.999999, 0.999999, 0.5, 0.5][i++ % 4];
  try {
    updateEffects(DT); // frame 1
    const insts = activeInstances();
    assert.equal(insts.length, 2, 'both still active after frame 1');
    const stand = insts.find(x => x.type === 'sprite-shake-standalone').body;
    const shim = insts.find(x => x.type === 'sprite-shake').body;

    // Standalone: envelope 4·(remaining/duration)^1 at t = DT, extreme draw.
    const amp = 4 * ((0.5 - DT) / 0.5);
    const so = stand.getOffset();
    assert.ok(Math.abs(so.x - amp) < STUB_TOL && Math.abs(so.y - amp) < STUB_TOL,
      `standalone offset (${so.x}, ${so.y}) vs envelope ${amp}`);

    // Shim: stateless ±SHAKE_AMT per axis while hitFlash > 0 (factor 2·0.5−1 = 0).
    const mo = shim.getOffset();
    assert.ok(Math.abs(mo.x) <= SHAKE_AMT + EPS && Math.abs(mo.y) <= SHAKE_AMT + EPS,
      `shim offset (${mo.x}, ${mo.y}) within ±${SHAKE_AMT}`);
    assert.equal(i, 4, 'one (x,y) draw each for standalone and shim this frame');
  } finally { Math.random = orig; }

  // Completing the STANDALONE instance must not affect the hitFlash-driven offset.
  const standInst = activeInstances().find(x => x.type === 'sprite-shake-standalone');
  standInst.complete();
  assert.equal(standInst.done, true, 'standalone force-completed');
  const shimBody2 = activeInstances().find(x => x.type === 'sprite-shake').body;
  assert.equal(shimBody2.done, false, 'shim unaffected by standalone completion');
  withRandomSeq([0.999999, 0.999999], () => {
    const o = shimBody2.getOffset();
    assert.ok(Math.abs(o.x - SHAKE_AMT) < STUB_TOL && Math.abs(o.y - SHAKE_AMT) < STUB_TOL,
      `shim still shakes after standalone done (${o.x}, ${o.y})`);
  });

  // Resetting hitFlash stops the SHIM but does NOT stop the standalone timer.
  carrier.hitFlash = 0;
  const shimBody3 = activeInstances().find(x => x.type === 'sprite-shake').body;
  updateEffects(DT); // shim.update() sees hitFlash 0 → marks itself done
  assert.equal(shimBody3.done, true, 'shim reports done once hitFlash resets');
  const standBody3 = activeInstances().find(x => x.type === 'sprite-shake-standalone')?.body;
  if (standBody3) {
    assert.equal(standBody3.done, false, 'standalone timer survives the hitFlash reset');
    withRandomSeq([0.999999, 0.999999], () => {
      const o = standBody3.getOffset();
      assert.ok(Math.abs(o.x) > EPS || Math.abs(o.y) > EPS,
        `standalone still shaking after hitFlash reset (${o.x}, ${o.y})`);
    });
  }
  resetEffects();
});

console.log(`${passed} passed`);
