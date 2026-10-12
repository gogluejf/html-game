// Task 1.8 — Body Contact Damage primitive tests (pure logic, no DOM).
// Run: node js/test/attack/bodyContact.test.js

import { strict as assert } from 'node:assert';
import { applyBodyContact } from '../../combat/attack/primitives/bodyContact.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const KB = { base: 250, dirMode: 'radial' };

ok('applies damage + knockback to the attacker', () => {
  const a = {};
  applyBodyContact({ damage: 20, knockback: KB, enabled: true }, a);
  assert.equal(a.bodyContactDamage, 20);
  assert.equal(a.bodyKnockback, KB);
  assert.equal(a.bodyContactDisabled, false);
});

ok('enabled=false marks the body non-damaging', () => {
  const a = {};
  applyBodyContact({ enabled: false }, a);
  assert.equal(a.bodyContactDisabled, true);
});

ok('temporaryOverride restores previous values on restore()', () => {
  const a = { bodyContactDamage: 5, bodyKnockback: { base: 100 } };
  const restore = applyBodyContact(
    { damage: 99, knockback: KB, temporaryOverride: true }, a
  );
  assert.equal(a.bodyContactDamage, 99);
  assert.equal(a.bodyKnockback, KB);
  restore();
  assert.equal(a.bodyContactDamage, 5, 'damage restored');
  assert.deepEqual(a.bodyKnockback, { base: 100 }, 'knockback restored');
});

ok('non-temporary apply returns null (no restore needed)', () => {
  const a = {};
  const restore = applyBodyContact({ damage: 10 }, a);
  assert.equal(restore, null);
});

ok('end-to-end: temporary override completes via h.finish() and restores', () => {
  const a = { bodyContactDamage: 7 };
  const ctx = makeContext(a, {});
  const h = invoke('bodyContact', { damage: 50, temporaryOverride: true }, ctx);
  assert.equal(a.bodyContactDamage, 50, 'override active during charge');
  h.finish();
  assert.equal(a.bodyContactDamage, 7, 'restored after finish');
});

ok('end-to-end: persistent config completes immediately', () => {
  const a = {};
  const ctx = makeContext(a, {});
  const h = invoke('bodyContact', { damage: 30 }, ctx);
  // Non-temporary → already finished at invoke time.
  let n = 0;
  h.on('complete', () => n++);
  assert.equal(n, 0, 'late subscription does not replay');
  assert.equal(a.bodyContactDamage, 30);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
