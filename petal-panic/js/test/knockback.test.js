// Knockback core — applyKnockback (design: docs/architecture/knockback.md §2–§6).
// Run: node js/test/knockback.test.js
// Pure node unit tests on knockback.js (no DOM): exact impulse magnitudes/directions
// for base-only, motion-term (head-on vs sliding-past), mass-resistance scaling, and
// the zero/absent no-op case. Fixed inputs, exact expected numbers within epsilon.

import { strict as assert } from 'node:assert';
import { applyKnockback } from '../knockback.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const EPS = 1e-9;
const close = (a, b) => Math.abs(a - b) < EPS;

// Plain stand-in entities — no DOM, just the fields applyKnockback reads/writes.
const mkVictim = (resist = 1) => ({ vx: 0, vy: 0, knockbackResist: resist });
const mkAttacker = (vx = 0, vy = 0) => ({ vx, vy });

console.log('Knockback core (applyKnockback, §2–§6)');

// --- Acceptance 1: base-only knockback imparts exactly base * resist along normal ---
ok('base-only knockback imparts exactly base/resist along the normal', () => {
  const v = mkVictim(1); // resist 1 → unchanged
  const a = mkAttacker(0, 0); // stationary attacker → no motion term
  const applied = applyKnockback(v, a, { base: 300, scaleBySpeed: 0, hitstun: 0.2 }, { x: 1, y: 0 });
  assert.equal(applied, true);
  assert.ok(close(v.vx, 300), `expected vx=300, got ${v.vx}`);
  assert.ok(close(v.vy, 0), `expected vy=0, got ${v.vy}`);
});

ok('base-only respects an arbitrary normalized direction (§4/§5)', () => {
  const v = mkVictim(1);
  // Normalized diagonal (unit vector): (√2/2, √2/2)
  const n = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  applyKnockback(v, mkAttacker(), { base: 200, scaleBySpeed: 0, hitstun: 0.1 }, n);
  assert.ok(close(v.vx, 200 * Math.SQRT1_2), `vx=${v.vx}`);
  assert.ok(close(v.vy, 200 * Math.SQRT1_2), `vy=${v.vy}`);
});

// --- Acceptance 2: motion term adds only the into-victim velocity component ---
ok('head-on charging attacker adds the full motion term', () => {
  const v = mkVictim(1);
  // Attacker moving straight into the victim along +x (normal +x): headOn = 400.
  const a = mkAttacker(400, 0);
  applyKnockback(v, a, { base: 100, scaleBySpeed: 0.5, hitstun: 0.2 }, { x: 1, y: 0 });
  // mag = (100 + 400*0.5)/1 = 300
  assert.ok(close(v.vx, 300), `expected vx=300, got ${v.vx}`);
});

ok('sliding past sideways adds ~0 to the impact (perpendicular motion ignored)', () => {
  const v = mkVictim(1);
  // Attacker moving purely perpendicular (+y) to the push normal (+x): headOn = 0.
  const a = mkAttacker(0, 400);
  applyKnockback(v, a, { base: 100, scaleBySpeed: 0.5, hitstun: 0.2 }, { x: 1, y: 0 });
  // Only the base contributes; the sideways speed must NOT add anything.
  assert.ok(close(v.vx, 100), `expected vx=100 (base only), got ${v.vx}`);
  assert.ok(close(v.vy, 0), `expected vy=0, got ${v.vy}`);
});

ok('retreating attacker does not amplify the hit (motion clamped non-negative)', () => {
  const v = mkVictim(1);
  // Attacker moving AWAY from the victim along -x while normal is +x: headOn = -400 → clamped to 0.
  const a = mkAttacker(-400, 0);
  applyKnockback(v, a, { base: 100, scaleBySpeed: 0.5, hitstun: 0.2 }, { x: 1, y: 0 });
  assert.ok(close(v.vx, 100), `expected vx=100 (clamped), got ${v.vx}`);
});

// --- Acceptance 4: heavier mass resistance scales the impulse down proportionally ---
ok('heavier victim (higher knockbackResist) is shoved less, proportionally', () => {
  const kb = { base: 300, scaleBySpeed: 0, hitstun: 0.2 };
  const light = mkVictim(1);   // resist 1
  const heavy = mkVictim(3);   // resist 3 → one third the shove
  applyKnockback(light, mkAttacker(), kb, { x: 1, y: 0 });
  applyKnockback(heavy, mkAttacker(), kb, { x: 1, y: 0 });
  assert.ok(close(light.vx, 300), `light vx=${light.vx}`);
  assert.ok(close(heavy.vx, 100), `heavy vx=${heavy.vx}`);
  assert.ok(close(heavy.vx, light.vx / 3), 'mass divides the shove');
});

ok('mass resistance also scales the motion term', () => {
  const kb = { base: 100, scaleBySpeed: 0.5, hitstun: 0.2 };
  const light = mkVictim(1);
  const heavy = mkVictim(2);
  const a = mkAttacker(400, 0); // headOn 400 → motion 200; total 300
  applyKnockback(light, a, kb, { x: 1, y: 0 });
  applyKnockback(heavy, a, kb, { x: 1, y: 0 });
  assert.ok(close(light.vx, 300), `light vx=${light.vx}`);
  assert.ok(close(heavy.vx, 150), `heavy vx=${heavy.vx}`);
});

// --- Acceptance 3: absent or zero-strength knockback changes nothing (no-op) ---
ok('null knockback is a no-op (returns false, changes nothing)', () => {
  const v = mkVictim(1);
  const applied = applyKnockback(v, mkAttacker(400, 0), null, { x: 1, y: 0 });
  assert.equal(applied, false);
  assert.ok(close(v.vx, 0) && close(v.vy, 0));
  assert.equal(v.hitstunTimer, undefined);
  assert.equal(v.iFrameTimer, undefined);
});

ok('undefined knockback is a no-op', () => {
  const v = mkVictim(1);
  assert.equal(applyKnockback(v, mkAttacker(400, 0), undefined, { x: 1, y: 0 }), false);
  assert.ok(close(v.vx, 0) && close(v.vy, 0));
});

ok('zero-strength setting (no base, no scaleBySpeed) is a no-op', () => {
  const v = mkVictim(1);
  const applied = applyKnockback(v, mkAttacker(400, 0), { base: 0, scaleBySpeed: 0, hitstun: 0.5 }, { x: 1, y: 0 });
  assert.equal(applied, false);
  assert.ok(close(v.vx, 0) && close(v.vy, 0));
  assert.equal(v.hitstunTimer, undefined, 'no-op must not set stun either');
});

// --- Stun & protection TTLs (§6) -----------------------------------------------
ok('applied knockback sets the victim stun timer', () => {
  const v = mkVictim(1);
  applyKnockback(v, mkAttacker(), { base: 100, scaleBySpeed: 0, hitstun: 0.3 }, { x: 1, y: 0 });
  assert.ok(close(v.hitstunTimer, 0.3), `hitstun=${v.hitstunTimer}`);
});

ok('stun never shortens an existing longer stun', () => {
  const v = { ...mkVictim(1), hitstunTimer: 0.5 };
  applyKnockback(v, mkAttacker(), { base: 100, scaleBySpeed: 0, hitstun: 0.2 }, { x: 1, y: 0 });
  assert.ok(close(v.hitstunTimer, 0.5), `should keep 0.5, got ${v.hitstunTimer}`);
});

ok('iFrames > 0 sets the protection window; 0 leaves it untouched', () => {
  const withProtect = mkVictim(1);
  applyKnockback(withProtect, mkAttacker(), { base: 100, scaleBySpeed: 0, hitstun: 0.2, iFrames: 0.6 }, { x: 1, y: 0 });
  assert.ok(close(withProtect.iFrameTimer, 0.6), `iFrame=${withProtect.iFrameTimer}`);

  const noProtect = mkVictim(1);
  applyKnockback(noProtect, mkAttacker(), { base: 100, scaleBySpeed: 0, hitstun: 0.2, iFrames: 0 }, { x: 1, y: 0 });
  assert.equal(noProtect.iFrameTimer, undefined, 'iFrames=0 must not create a protection window');
});

// --- 2D: vertical pop on a strong upward-leaning hit (§5) -----------------------
ok('an upward-leaning normal imparts upward velocity (victim pops off ground)', () => {
  const v = mkVictim(1);
  // Strong supermove-ish hit, normal leaning up-and-right (unit vector).
  const n = { x: 0.8, y: -0.6 }; // y negative = up in screen coords
  applyKnockback(v, mkAttacker(300, 0), { base: 600, scaleBySpeed: 0.5, hitstun: 0.5 }, n);
  assert.ok(v.vy < 0, `expected upward (negative) vy, got ${v.vy}`);
  assert.ok(v.vx > 0, `expected positive vx, got ${v.vx}`);
});

console.log(`\n${passed} passed`);
