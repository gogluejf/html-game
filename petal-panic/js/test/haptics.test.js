// Haptics funnel tests (js/haptics.js).
// Run: node --test js/test/haptics.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haptic, hapticForShake, hapticsEnabled, setHapticsEnabled, HAPTIC_PRESETS } from '../haptics.js';
import { loadStore } from '../systems/progressStore.js';

// --- navigator stubs -----------------------------------------------------------
function makeNavigator({ padActuator = null, vibrate = true } = {}) {
  const calls = { playEffect: [], vibrate: [] };
  const nav = {
    getGamepads: () => [
      { connected: true, index: 0, id: 'test-pad',
        vibrationActuator: padActuator ? {
          playEffect(type, params) { calls.playEffect.push({ type, params }); return Promise.resolve(); },
        } : undefined },
    ],
    vibrate: vibrate ? (pattern) => { calls.vibrate.push(pattern); return true; } : undefined,
  };
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  return calls;
}

test('presets exist with [strong, weak, durationMs] shape', () => {
  for (const name of ['nav', 'impactSoft', 'impactMed', 'impactHard']) {
    const p = HAPTIC_PRESETS[name];
    assert.ok(Array.isArray(p) && p.length === 3, `${name} preset shape`);
    assert.ok(p[0] >= 0 && p[0] <= 1, `${name} strong in range`);
    assert.ok(p[1] >= 0 && p[1] <= 1, `${name} weak in range`);
    assert.ok(p[2] > 0, `${name} duration positive`);
  }
});

test('vibration setting off → fast exit, nothing delivered', () => {
  const calls = makeNavigator({ padActuator: true, vibrate: true });
  loadStore().settings.vibration = false;
  try {
    haptic('impactHard');
    hapticForShake(20);
    assert.equal(calls.playEffect.length, 0);
    assert.equal(calls.vibrate.length, 0);
    assert.equal(hapticsEnabled(), false);
  } finally {
    loadStore().settings.vibration = true;
  }
});

test('gamepad actuator wins: dual-rumble with clamped magnitudes, no device fallback', () => {
  const calls = makeNavigator({ padActuator: true, vibrate: true });
  haptic('impactHard', { scale: 2 }); // scale clamps to 1 → full preset magnitudes
  assert.equal(calls.playEffect.length, 1);
  assert.equal(calls.playEffect[0].type, 'dual-rumble');
  assert.ok(Math.abs(calls.playEffect[0].params.strongMagnitude - HAPTIC_PRESETS.impactHard[0]) < 1e-9);
  assert.ok(Math.abs(calls.playEffect[0].params.weakMagnitude - HAPTIC_PRESETS.impactHard[1]) < 1e-9);
  assert.equal(calls.vibrate.length, 0, 'no double buzz when the pad handled it');
});

test('scale multiplies magnitudes (shake-magnitude mapping)', () => {
  const calls = makeNavigator({ padActuator: true });
  haptic('impactMed', { scale: 0.5 });
  const { strongMagnitude, weakMagnitude } = calls.playEffect[0].params;
  const base = HAPTIC_PRESETS.impactMed;
  assert.ok(Math.abs(strongMagnitude - base[0] * 0.5) < 1e-9);
  assert.ok(Math.abs(weakMagnitude - base[1] * 0.5) < 1e-9);
});

// NOTE: the "Firefox shape" (actuator object present, playEffect method
// absent) is covered by the virtual-pad test below via `vibrationActuator:
// null` skip + the no-pad fallback; a dedicated stub for it misbehaves under
// node:test's module-scope import ordering (the pre-test navigator stub gets
// observed during haptics.js evaluation), so we don't fake that exact shape.
test('no actuator at all (virtual pad / unsupported) → touch fallback only', () => {
  const calls = makeNavigator({ padActuator: null, vibrate: true });
  haptic('impactMed');
  assert.equal(calls.vibrate.length, 1);
  assert.ok(Array.isArray(calls.vibrate[0]), 'medium impact uses a pulse pattern');
});

test('virtual pad (index 99, no actuator) never blocks the device fallback', () => {
  const calls = makeNavigator({ padActuator: null, vibrate: true });
  const realPads = globalThis.navigator.getGamepads();
  globalThis.navigator.getGamepads = () => [
    ...realPads,
    { connected: true, index: 99, id: 'squid-virtual-pad', vibrationActuator: null },
  ];
  haptic('impactHard');
  assert.equal(calls.vibrate.length, 1, 'phone motor still fires with only the virtual pad present');
});

test('no pad at all → touch patterns per preset intensity', () => {
  const calls = makeNavigator({ padActuator: null, vibrate: true });
  haptic('nav');
  haptic('impactSoft');
  haptic('impactHard');
  assert.deepEqual(calls.vibrate[0], 15, 'nav tick = legacy 15ms parity');
  assert.ok(Array.isArray(calls.vibrate[1]), 'soft = tick pattern');
  assert.equal(typeof calls.vibrate[2], 'number', 'hard = solid block');
});

test('nothing available anywhere → silent no-op', () => {
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  haptic('impactHard'); // must not throw
  hapticForShake(6);
});

test('declarative camera-shake fire (attack engine path) also rumbles', async () => {
  // The theater bug: attack primitives fire camera-shake via fireDeclared,
  // never through Effects.triggerShake — the hook must live at the
  // effect-instance spawn funnel to cover both paths.
  const calls = makeNavigator({ padActuator: true });
  await import('../effects/registry.js'); // registers camera-shake (side effect)
  const { fireManual, resetEffects } = await import('../effects/index.js');
  const inst = fireManual({ type: 'camera-shake', params: { intensity: 8 } }, null, { view: { w: 960, h: 540 } });
  assert.ok(inst, 'camera-shake instance spawned');
  assert.equal(calls.playEffect.length, 1, 'rumble fired on declarative spawn');
  assert.equal(calls.playEffect[0].params.duration, HAPTIC_PRESETS.impactMed[2]);
  resetEffects();
});

test('shake funnel maps magnitude onto presets', () => {
  const calls = makeNavigator({ padActuator: true });
  hapticForShake(0); // zero kick → no rumble
  assert.equal(calls.playEffect.length, 0);
  hapticForShake(4);  // light
  hapticForShake(8);  // medium
  hapticForShake(15); // hard
  assert.equal(calls.playEffect.length, 3);
  const durs = calls.playEffect.map((c) => c.params.duration);
  assert.deepEqual(durs, [
    HAPTIC_PRESETS.impactSoft[2],
    HAPTIC_PRESETS.impactMed[2],
    HAPTIC_PRESETS.impactHard[2],
  ]);
});
