// Task 2.1 — registration test: every migrated effect type must resolve
// through the engine's REAL fire() path (registry lookup → factory → instance).
// Run: node js/test/effectsRegistry.test.js
// No DOM needed.
//
// This is the guard against the "factories exist but are never registered"
// failure mode: importing ./effects/registry.js wires the eight M2 factories
// into the engine, and each type below is fired via fireManual() / fire() and
// asserted to actually instantiate (not silently dropped as unregistered).

import { strict as assert } from 'node:assert';
import { hasEffect, fireManual, fire, resetEffects, activeCount } from '../effects/index.js';
import '../effects/registry.js'; // side effect: registers the eight migrated types

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// The eight migrated types and a trigger each can legitimately be fired on
// (from the effects.md trigger table). One-shot burst types report done at
// fire time; screen-space + shake types stay active until they decay.
const TYPES = [
  { type: 'hit-sparkle',    trigger: 'collision' },
  { type: 'death-sparkle',  trigger: 'death' },
  { type: 'pickup-pop',     trigger: 'pickup' },
  { type: 'explosion',      trigger: 'explosion' },
  { type: 'particle-burst', trigger: 'collision' },
  { type: 'vignette',       trigger: 'damageTaken' },
  { type: 'screen-flash',   trigger: 'explosion' },
  { type: 'sprite-shake',   trigger: 'hitLanded' },
];

console.log('registration');
ok('all eight migrated types are registered with the engine', () => {
  for (const { type } of TYPES) {
    assert.ok(hasEffect(type), `type "${type}" not registered`);
  }
});

for (const { type, trigger } of TYPES) {
  ok(`"${type}" resolves through the real fire() path (manual)`, () => {
    resetEffects();
    const inst = fireManual({ type, params: { x: 0, y: 0, viewW: 640, viewH: 480 } });
    assert.ok(inst !== null, `fireManual returned null — "${type}" did not resolve`);
    assert.equal(inst.type, type);
    assert.equal(inst.trigger, 'manual');
    resetEffects();
  });
}

ok('a carrier-declared config fires the same type via fire(trigger, carrier)', () => {
  resetEffects();
  // Use a screen-space type (vignette) that stays active until it decays, so
  // we can assert the instance actually entered the active set. One-shot
  // burst types report done at fire time and are intentionally pruned here.
  const carrier = { effects: [{ on: 'damageTaken', type: 'vignette', params: {} }] };
  const spawned = fire('damageTaken', carrier);
  assert.equal(spawned, 1, 'exactly one instance spawned from the carrier config');
  assert.equal(activeCount(), 1, 'instance entered the active set');
  resetEffects();
});

console.log(`${passed} passed`);
