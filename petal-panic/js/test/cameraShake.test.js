// Task 3.3 — node-based unit tests for the camera-shake effect
// (js/effects/cameraShake.js, effects.md §13). Run: node js/test/cameraShake.test.js
// No DOM needed: the effect is a pure STATE module (render() is a no-op; the
// camera consumes getOffset()). Fixed dt = 1/60 per project convention.

import { strict as assert } from 'node:assert';
import { cameraShake } from '../effects/cameraShake.js';
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

// Tolerance for "extreme" rand stubs (0.9999995 → factor 1.999999 ≈ 2):
// expected offsets are within ~amp*5e-7 of the exact bound.
const STUB_TOL = 1e-4;

console.log('decay + bounds');
ok('defaults: intensity 6, duration 0.25s → done exactly at frame 15', () => {
  const b = cameraShake({});
  assert.equal(b.done, false);
  for (let i = 0; i < 14; i++) b.update(DT); // 14 frames ≈ 0.2333s < 0.25s
  assert.equal(b.done, false, 'not done just before the boundary');
  b.update(DT); // frame 15 = 0.25s
  assert.equal(b.done, true, 'done at the lifetime boundary (== duration)');
  assert.deepEqual(b.getOffset(), { x: 0, y: 0 }, 'zero offset after duration');
});
ok('amplitude decays linearly (decay 1) and offsets stay within ±intensity per axis', () => {
  const b = cameraShake({ intensity: 8, duration: 0.25 });
  // Frame 1 (t = 1/60): remaining = 0.25 - 1/60 → amp = 8 * (remaining/0.25).
  // Stub rand so both axes hit their extremes on the first roll. The default
  // frequency is 0 ("perFrame"): every update() re-rolls a fresh offset.
  let o1, o2;
  withRandomSeq([0, 0.999999, 0.999999, 0], () => {
    b.update(DT); // roll #1: x = -amp, y = +amp
    o1 = b.getOffset();
    const amp1 = 8 * ((0.25 - DT) / 0.25);
    assert.ok(Math.abs(o1.x - (-amp1)) < STUB_TOL, `x ${o1.x} vs -${amp1}`);
    assert.ok(Math.abs(o1.y - amp1) < STUB_TOL, `y ${o1.y} vs ${amp1}`);
    // Default perFrame mode re-rolls EVERY frame: frame 2 draws again.
    b.update(DT); // roll #2: x = +amp, y = -amp
    o2 = b.getOffset();
    const amp2 = 8 * ((0.25 - 2 * DT) / 0.25);
    assert.ok(Math.abs(o2.x - amp2) < STUB_TOL, `x ${o2.x} vs ${amp2}`);
    assert.ok(Math.abs(o2.y - (-amp2)) < STUB_TOL, `y ${o2.y} vs -${amp2}`);
    assert.ok(amp2 < amp1, 'amplitude decays over time');
    for (let i = 0; i < 12; i++) {
      b.update(DT);
      const o = b.getOffset();
      assert.ok(Math.abs(o.x) <= 8 + EPS && Math.abs(o.y) <= 8 + EPS,
        `out of bounds (${o.x}, ${o.y})`);
    }
  });
  // Endpoint coverage from the stubbed rolls themselves (the decay envelope
  // shrinks monotonically, so later rolls can never reach the full bound —
  // the extreme draws above ARE the bound-reach proof).
  assert.ok(Math.abs(o1.x) > 7.4, `roll #1 x ${o1.x} reached near the -8 bound`);
  assert.ok(Math.abs(o1.y) > 7.4, `roll #1 y ${o1.y} reached near the +8 bound`);
  assert.ok(Math.abs(o2.x) > 6.3, `roll #2 x ${o2.x} reached a positive bound`);
  assert.ok(Math.abs(o2.y) > 6.3, `roll #2 y ${o2.y} reached a negative bound`);
});
ok('hStrength/vStrength scale the per-axis bounds independently', () => {
  const b = cameraShake({ intensity: 10, hStrength: 0.5, vStrength: 2, duration: 0.25 });
  let maxX = -Infinity, maxY = -Infinity;
  withRandomSeq([0.999999, 0.999999], () => {
    b.update(DT);
    const o = b.getOffset();
    maxX = o.x; maxY = o.y;
  });
  const amp = 10 * ((0.25 - DT) / 0.25);
  assert.ok(Math.abs(maxX - 0.5 * amp) < STUB_TOL, `h-scaled x ${maxX}`);
  assert.ok(Math.abs(maxY - 2 * amp) < STUB_TOL, `v-scaled y ${maxY}`);
});
ok('frequency controls the re-roll rate (higher frequency jitters faster)', () => {
  // At 60Hz the offset re-rolls EVERY frame; at 30Hz it alternates.
  const fast = cameraShake({ intensity: 5, frequency: 60, duration: 0.25 });
  const slow = cameraShake({ intensity: 5, frequency: 30, duration: 0.25 });
  let fastRolls = 0, slowRolls = 0;
  withRandomSeq([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], () => {
    for (let i = 0; i < 4; i++) {
      const fxBefore = fast.x, fyBefore = fast.y;
      const sxBefore = slow.x, syBefore = slow.y;
      fast.update(DT);
      slow.update(DT);
      if (fast.x !== fxBefore || fast.y !== fyBefore) fastRolls++;
      if (slow.x !== sxBefore || slow.y !== syBefore) slowRolls++;
    }
  });
  assert.equal(fastRolls, 4, '60Hz re-rolls every frame');
  assert.equal(slowRolls, 2, '30Hz re-rolls every other frame');
});
ok('default frequency is perFrame: a fresh offset every frame (legacy monolith parity)', () => {
  // The documented legacy-preserving default re-rolls on EVERY update() call.
  // Stub Math.random with a deterministic sequence and assert the offset
  // changes each frame exactly according to that stub sequence.
  const b = cameraShake({ intensity: 5, duration: 0.25 }); // no frequency → default
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
    // Every frame consumed two fresh draws from the stub — no held offsets.
    assert.equal(i, 6, 'each frame drew a fresh (x,y) pair');
    assert.ok(!(seen[0].x === seen[1].x && seen[0].y === seen[1].y),
      'frame 2 offset differs from frame 1 (fresh draw)');
    assert.ok(!(seen[1].x === seen[2].x && seen[1].y === seen[2].y),
      'frame 3 offset differs from frame 2 (fresh draw)');
  } finally { Math.random = orig; }
});
ok('explicit frequency 30 holds the offset between re-roll frames', () => {
  // The explicit-frequency case keeps its hold-between-rolls semantics: at
  // 30Hz (period 1/30s) the offset re-rolls every other frame at fixed dt.
  const b = cameraShake({ intensity: 5, frequency: 30, duration: 0.25 });
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
ok('frequency: "perFrame" string alias behaves like frequency: 0', () => {
  const b = cameraShake({ intensity: 5, frequency: 'perFrame', duration: 0.25 });
  withRandomSeq([0.1, 0.9, 0.3, 0.7], () => {
    b.update(DT);
    const o1 = b.getOffset();
    b.update(DT);
    const o2 = b.getOffset();
    assert.ok(o2.x !== o1.x || o2.y !== o1.y, 're-rolls every frame');
  });
});
ok('complete() force-completes and zeroes the offset (engine reset path)', () => {
  const b = cameraShake({ intensity: 6 });
  b.update(DT);
  assert.equal(b.done, false);
  b.complete();
  assert.equal(b.done, true);
  assert.deepEqual(b.getOffset(), { x: 0, y: 0 });
});

console.log('registration + engine path');
ok('"camera-shake" is registered and resolves through the real fire() path', () => {
  assert.ok(hasEffect('camera-shake'), 'type registered');
  resetEffects();
  const inst = fireManual({ type: 'camera-shake', params: {} });
  assert.ok(inst !== null, 'fireManual resolved the type');
  assert.equal(inst.type, 'camera-shake');
  assert.equal(inst.trigger, 'manual');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
ok('attachable via carrier config on its trigger (explosion)', () => {
  resetEffects();
  const carrier = {
    effects: [{ on: 'explosion', type: 'camera-shake',
                params: { intensity: 8, duration: 0.3 } }],
  };
  const spawned = fire('explosion', carrier);
  assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});
ok('attachable via carrier config on hitLanded (single engine path, real fire())', () => {
  resetEffects();
  const carrier = {
    effects: [{ on: 'hitLanded', type: 'camera-shake',
                params: { intensity: 4, duration: 0.25 } }],
  };
  const spawned = fire('hitLanded', carrier);
  // fire() returns a count; verify through the active set + a step so this
  // proves the type fires through the SAME engine path as every other trigger.
  assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  withRandomSeq([0.999999, 0.999999], () => {
    updateEffects(DT);
    const o = peekActive().body.getOffset();
    const amp = 4 * ((0.25 - DT) / 0.25);
    assert.ok(Math.abs(o.x - amp) < STUB_TOL && Math.abs(o.y - amp) < STUB_TOL,
      `hitLanded-fired offset (${o.x}, ${o.y}) vs ${amp}`);
  });
  resetEffects();
});
ok('attachable via carrier config on attackActive (single engine path, real fire())', () => {
  resetEffects();
  const carrier = {
    effects: [{ on: 'attackActive', type: 'camera-shake',
                params: { intensity: 7, duration: 0.25 } }],
  };
  const spawned = fire('attackActive', carrier);
  assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  withRandomSeq([0.999999, 0.999999], () => {
    updateEffects(DT);
    const o = peekActive().body.getOffset();
    const amp = 7 * ((0.25 - DT) / 0.25);
    assert.ok(Math.abs(o.x - amp) < STUB_TOL && Math.abs(o.y - amp) < STUB_TOL,
      `attackActive-fired offset (${o.x}, ${o.y}) vs ${amp}`);
  });
  resetEffects();
});
ok('end-to-end: fire → updateEffects drives decay; offset reads through the instance body', () => {
  // Proves the contract through the real engine path (not direct body calls):
  // the camera would read inst.body.getOffset() each frame.
  resetEffects();
  const inst = fireManual({ type: 'camera-shake', params: { intensity: 4, duration: 0.25 } });
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
  const inst = fireManual({ type: 'camera-shake',
    params: { intensity: 10, duration: 0.5, frequency: 30, hStrength: 1, vStrength: 1, decay: 1 } });
  assert.ok(inst !== null, 'manual fire with null carrier resolved');
  let maxMag = 0;
  for (let i = 0; i < 29; i++) {
    updateEffects(DT); // 0.5s = 30 frames
    const o = inst.body.getOffset();
    assert.ok(Math.abs(o.x) <= 10 + EPS && Math.abs(o.y) <= 10 + EPS,
      `demo out of bounds (${o.x}, ${o.y})`);
    maxMag = Math.max(maxMag, Math.hypot(o.x, o.y));
  }
  updateEffects(DT); // frame 30 = 0.5s → done
  assert.equal(inst.done, true, 'demo terminates at the declared duration');
  assert.ok(maxMag > 0, 'demo actually shook (non-zero offsets observed)');
  assert.deepEqual(inst.body.getOffset(), { x: 0, y: 0 });
  resetEffects();
});

console.log(`${passed} passed`);
