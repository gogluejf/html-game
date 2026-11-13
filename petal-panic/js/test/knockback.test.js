// Knockback core (applyKnockback / calculateKnockback — the vector contract).
// Run: node js/test/knockback.test.js
//
// The whole shove is ONE vector { x, y } in px/s. applyKnockback() finishes
// the math with the victim's mass (knockbackResist divides the impulse) and
// sets stun / protection timers. calculateKnockback() derives a raw vector
// from an attacker's live velocity + weight. No DOM needed.

import { strict as assert } from 'node:assert';
import { applyKnockback, calculateKnockback } from '../combat/knockback.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const EPS = 1e-9;
const close = (a, b) => Math.abs(a - b) < EPS;

// Plain stand-in victim: only the fields applyKnockback reads/writes.
const mkVictim = (resist = 1) => ({ vx: 0, vy: 0, knockbackResist: resist });

console.log('Knockback core (vector contract)');

ok('a horizontal vector imparts exactly x/resist along the axis', () => {
  const v = mkVictim(1);
  assert.equal(applyKnockback(v, { x: 260, y: 0 }), true);
  assert.ok(close(v.vx, 260), `vx=${v.vx}`);
  assert.ok(close(v.vy, 0), `vy=${v.vy}`);
});

ok('the y component carries the loft (negative = up)', () => {
  const v = mkVictim(1);
  applyKnockback(v, { x: 360, y: -90 });
  assert.ok(close(v.vx, 360));
  assert.ok(close(v.vy, -90), `vy=${v.vy}`);
});

ok('heavier victim (higher knockbackResist) is shoved less, proportionally', () => {
  const light = mkVictim(1);
  const heavy = mkVictim(2);
  applyKnockback(light, { x: 300, y: -100 });
  applyKnockback(heavy, { x: 300, y: -100 });
  assert.ok(close(heavy.vx, light.vx / 2), `heavy vx=${heavy.vx}`);
  assert.ok(close(heavy.vy, light.vy / 2), `heavy vy=${heavy.vy}`);
});

ok('null/undefined knockback is a no-op (returns false, changes nothing)', () => {
  const v = mkVictim();
  assert.equal(applyKnockback(v, null), false);
  assert.equal(applyKnockback(v, undefined), false);
  assert.ok(close(v.vx, 0) && close(v.vy, 0));
});

ok('zero-strength vector is a no-op', () => {
  const v = mkVictim();
  assert.equal(applyKnockback(v, { x: 0, y: 0 }), false);
  assert.ok(close(v.vx, 0) && close(v.vy, 0));
});

ok('stun-only vector (no impulse) still applies the timers', () => {
  const v = mkVictim();
  assert.equal(applyKnockback(v, { hitstun: 0.4 }), true);
  assert.ok(close(v.hitstunTimer, 0.4));
});

ok('applied knockback sets the victim stun timer', () => {
  const v = mkVictim();
  applyKnockback(v, { x: 100, y: 0, hitstun: 0.35 });
  assert.ok(close(v.hitstunTimer, 0.35), `hitstun=${v.hitstunTimer}`);
});

ok('stun never shortens an existing longer stun', () => {
  const v = { ...mkVictim(), hitstunTimer: 0.5 };
  applyKnockback(v, { x: 100, y: 0, hitstun: 0.2 });
  assert.ok(close(v.hitstunTimer, 0.5));
});

ok('iFrames > 0 sets the protection window; 0 leaves it untouched', () => {
  const v = mkVictim();
  applyKnockback(v, { x: 100, y: 0, iFrames: 0.6 });
  assert.ok(close(v.iFrameTimer, 0.6), `iFrame=${v.iFrameTimer}`);
  const w = mkVictim();
  applyKnockback(w, { x: 100, y: 0, iFrames: 0 });
  assert.ok(w.iFrameTimer == null || close(w.iFrameTimer, 0));
});

ok('impulse ADDS to existing velocity (does not replace it)', () => {
  const v = { vx: 50, vy: -20, knockbackResist: 1 };
  applyKnockback(v, { x: 100, y: 30 });
  assert.ok(close(v.vx, 150));
  assert.ok(close(v.vy, 10));
});

// --- calculateKnockback (offense helper) ------------------------------------

ok('calculateKnockback derives the vector from live velocity × weight', () => {
  const attacker = { vx: 400, vy: 0, stats: { weight: 2 } };
  const kb = calculateKnockback(attacker);
  assert.ok(close(kb.x, 800), `x=${kb.x}`);
  assert.ok(close(kb.y, 0), `y=${kb.y}`);
});

ok('calculateKnockback folds pop into y (upward chunk)', () => {
  const attacker = { vx: 300, vy: 0, stats: { weight: 1 } };
  const kb = calculateKnockback(attacker, 90);
  assert.ok(close(kb.x, 300));
  assert.ok(close(kb.y, -90), `y=${kb.y}`);
});

ok('calculateKnockback returns null for a stationary attacker with no pop', () => {
  assert.equal(calculateKnockback({ vx: 0, vy: 0 }), null);
});

ok('calculateKnockback with pop on a stationary attacker gives a pure loft', () => {
  const kb = calculateKnockback({ vx: 0, vy: 0 }, 120);
  assert.ok(close(kb.x, 0));
  assert.ok(close(kb.y, -120));
});

ok('end-to-end: offense vector through defense mass = transferred force', () => {
  const attacker = { vx: 500, vy: 0, stats: { weight: 1.5 } };
  const victim = mkVictim(2);
  applyKnockback(victim, calculateKnockback(attacker));
  // 500 × 1.5 / 2 = 375
  assert.ok(close(victim.vx, 375), `vx=${victim.vx}`);
});

console.log(`\n${passed} passed`);
