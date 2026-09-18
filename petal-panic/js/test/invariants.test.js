// §33 cross-mechanic responsiveness invariants.
// Run: node js/test/invariants.test.js
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

console.log('Buffered melee vs cancellation');
ok('jump during recovery beats and clears buffered special melee', () => {
  const h = makeHero();
  h.setGrounded(true);
  // Start a normal melee via the shared entry point.
  h.requestMelee('normal');
  assert.ok(h.meleeActive, 'melee should have started');
  // Buffer a special melee while the swing is still committing.
  h.requestMelee('special');
  assert.equal(h.pendingMelee, 'special', 'buffer should hold the special melee');
  // Advance into recovery without letting the buffer fire naturally.
  for (let i = 0; i < 30 && h.combatPhase !== 'recovery'; i++) h.update(DT, noInput());
  assert.equal(h.combatPhase, 'recovery', 'swing must reach its natural recovery');
  // Fresh jump press: cancellation must beat the buffer AND clear it.
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.jumpsUsed, 1, 'jump should have fired');
  assert.equal(h.pendingMelee, null, 'buffer must be cleared by the cancel');
  assert.ok(h.vy < 0, 'should be airborne after the jump');
});

console.log('Crouch + jump + animation sync');
ok('crouch never traps: jump cancels crouch and locomotion reads jump', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = noInput(); inp.down = true;
  h.update(DT, inp);
  assert.ok(h.crouching, 'should be crouched');
  inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.grounded, false, 'hero must leave the ground');
  assert.equal(h.crouching, false, 'crouch must not persist mid-air');
  assert.ok(h.vy < 0, 'upward velocity present');
  // Animation source of truth (§31 composed domain): the locomotion view
  // must read the jump phase, not a crouch pose.
  assert.equal(h.locomotion, 'jump', `locomotion should be jump, got ${h.locomotion}`);
});

console.log('One-way platforms');
ok('down+jump drops through one-way without consuming a jump; upward passes freely', () => {
  const h = makeHero();
  h.setGrounded(true);
  // Standing on a one-way platform: Down+Jump starts the drop-through window.
  let inp = noInput(); inp.down = true; inp.jump = true; inp.onOneWay = true;
  h.update(DT, inp);
  assert.equal(h.jumpsUsed, 0, 'drop-through must NOT consume a jump');
  assert.ok(h.droppingThrough, 'drop-through window must be open');
  assert.ok(h.vy >= 0, 'should fall, not launch upward');
  // From below, jumping straight up passes through unblocked.
  h.setGrounded(false);
  h._dropTimer = 0; // hero has cleared the platform; window expired
  inp.jump = false;
  h.update(DT, inp); // release so the next press is a fresh edge
  inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.jumpsUsed, 1, 'upward jump should fire normally');
  assert.ok(h.vy < 0, 'upward traversal must not be blocked by the one-way');
});

console.log('Melee buffer capacity');
ok('buffer stores at most one action — latest wins', () => {
  const h = makeHero();
  h.setGrounded(true);
  h.requestMelee('normal'); // start the first swing
  assert.ok(h.meleeActive, 'first swing must be active to accept buffers');
  // Buffer normal → then special → then normal again.
  h.requestMelee('normal');
  assert.equal(h.pendingMelee, 'normal');
  h.requestMelee('special');
  assert.equal(h.pendingMelee, 'special', 'latest buffer overwrites');
  h.requestMelee('normal');
  assert.equal(h.pendingMelee, 'normal', 'latest wins: back to normal');
});

console.log('Supermove jump-cancel rules');
ok('supermove burst cannot be jump-cancelled; decel can end the dash', () => {
  const h = makeHero();
  h.setGrounded(true);
  h.supermoveMeter = h.SUPERMOVE_MAX;
  let inp = noInput(); inp.super = true;
  h.update(DT, inp);
  assert.ok(h.supermoveActive, 'supermove engaged');
  assert.equal(h.supermovePhase, 'burst');
  // Jump during the committed burst: dash must continue.
  inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.ok(h.supermoveActive, 'burst must survive a jump attempt');
  assert.ok(Math.abs(h.vx) > 0, 'still dashing horizontally');
  // Enter decel: a fresh jump now ends the dash.
  h.supermovePhase = 'decel';
  h.supermoveTimer = h.decelDur;
  h.update(DT, noInput()); // release jump so the next press is a fresh edge
  inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.supermoveActive, false, 'decel must be jump-cancellable');
});

console.log(`\n${passed} passed`);
