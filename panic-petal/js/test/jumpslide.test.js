// Double-jump + SMB1-style crouch/slide deceleration.
// Run: node js/test/jumpslide.test.js
// No DOM needed: hero.js / entity.js / consts.js are pure modules.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, special: false, melee: false });
const makeHero = () => new Hero(HEROES.scarlet, 0, 0); // speed 250, jump 500

console.log('Double jump');
ok('grounded reset keeps both jumps available (counter never stuck)', () => {
  const h = makeHero();
  h.setGrounded(true);
  // Simulate a prior air jump that left the counter at 1 while still grounded.
  h.jumpsUsed = 1;
  h.update(DT, noInput());
  assert.equal(h.grounded, true);
  assert.equal(h.jumpsUsed, 0, 'grounded should reset jumpsUsed to 0');
});

ok('first jump fires from ground, second fires in air on fresh press', () => {
  const h = makeHero();
  h.setGrounded(true);
  // Press jump (edge) → ground jump.
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.ok(h.vy < 0, 'should have upward velocity after first jump');
  assert.equal(h.jumpsUsed, 1);
  // Release so _prevJumpHeld clears, then we are airborne.
  h.setGrounded(false);
  // Hold frame (no new press) must NOT trigger the double jump.
  inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.jumpsUsed, 1, 'holding jump mid-air must not consume the double jump');
  // Fresh press in the air → double jump.
  inp = noInput(); inp.jump = false; h.update(DT, inp); // release
  inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.jumpsUsed, 2, 'fresh air press should use the double jump');
});

ok('crouching blocks jumping', () => {
  const h = makeHero();
  h.setGrounded(true);
  // Crouch via input (grounded + down), then press jump on the next frame.
  let inp = noInput(); inp.down = true;
  h.update(DT, inp);
  assert.ok(h.crouching, 'should be crouched');
  inp = noInput(); inp.down = true; inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.jumpsUsed, 0, 'crouched hero should not jump');
});

console.log('Crouch / slide deceleration');
ok('standing with no input uses gentle friction (exponential decay)', () => {
  const h = makeHero();
  h.setGrounded(true);
  h.vx = 200;
  h.update(DT, noInput());
  // Exponential: vx *= 0.85 → 170, not a linear drop of ~26.
  assert.ok(Math.abs(h.vx - 200 * 0.85) < 1, `expected ~170, got ${h.vx}`);
});

ok('crouching with no input skids to a stop via strong linear decel', () => {
  const h = makeHero();
  h.setGrounded(true);
  h.crouching = true;
  h.vx = 375; // sliding speed (250 * 1.5)
  h.update(DT, noInput());
  // Linear decel of 1600*dt ≈ 26.67 removed this step → ~348, much faster than friction.
  assert.ok(h.vx > 0 && h.vx < 375, 'should be decelerating');
  assert.ok(h.vx < 375 - 20, `decel should be strong, got ${h.vx}`);
});

ok('crouch skid eventually reaches zero and stays there', () => {
  const h = makeHero();
  h.setGrounded(true);
  h.crouching = true;
  h.vx = 375;
  for (let i = 0; i < 120 && h.vx !== 0; i++) h.update(DT, noInput());
  assert.equal(h.vx, 0, 'skid should come to a full stop');
});

ok('crouching locks horizontal control — holding a direction does not move you', () => {
  // Running right, then pressing+holding down: crouch must NOT let you keep
  // accelerating. vx should start decaying (skid), not be forced to run speed.
  const h = makeHero();
  h.setGrounded(true);
  h.vx = 250;
  const inp = noInput(); inp.right = true; inp.down = true;
  h.update(DT, inp);
  assert.ok(h.crouching, 'should be crouched');
  assert.ok(h.vx < 250, `crouch must not hold/boost forward speed, got ${h.vx}`);
});

console.log(`\n${passed} passed`);
