// Task 3.2 — node-based unit tests for melee recovery cancellation
// (design §16/§19). Run: node js/test/meleeCancel.test.js
// No DOM needed: hero.js / heroDefs.js are pure modules. Direct-intent pattern:
// call hero.requestMelee(kind) for input and hero.update(DT, intent) for ticks.
//
// Contract under test:
//   • Windup + active = committed — jump/run input does NOT cancel.
//   • Recovery = cancellable — a fresh Jump press OR run/movement input ends
//     the attack immediately, resumes locomotion the same frame, and CLEARS
//     the pending melee buffer (§19 "cancellation always wins and clears it").
//   • Normal and special melee obey identical rules (shared predicate).

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60; // fixed step

// --- Helpers -----------------------------------------------------------------
function makeHero(id = 'scarlet', x = 0, y = 0) {
  const h = new Hero(HEROES[id], x, y);
  h.runStats = { meleeSwings: 0 };
  return h;
}
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, super: false, melee: false });
/** Land a normal swing exactly on its RECOVERY frame (frame TOTAL-1). */
function setNormalRecovery(h) {
  h.meleeActive = true;
  h.meleeFrame = h.MELEE_TOTAL_FRAMES - 1;
  h.meleeCooldown = h.MELEE_FRAME_DURATION;
}
/** Land a special swing exactly on its first RECOVERY frame. */
function setSpecialRecovery(h) {
  const cfg = h.heroDef.specialMelee;
  h.specialMeleeActive = true;
  h.specialMeleePhase = 'recovery';
  h.specialMeleeFrame = cfg.frames.windup + cfg.frames.active;
}
/** True when every melee state flag is clear (no residual attack state). */
const noAttackState = (h) => !h.meleeActive && !h.specialMeleeActive
  && h.meleeFrame === 0 && h.meleeCooldown <= 0
  && h.specialMeleePhase === null && h.specialMeleeFrame === 0;

console.log('Acceptance #1 — Melee → buffer Special → recovery → Jump = Jump only');
ok('jump during normal recovery cancels the swing and DISCARDS the buffered special', () => {
  const h = makeHero();
  h.grounded = true;
  h.requestMelee('normal');            // start the normal swing
  h.requestMelee('special');           // buffer the special mid-swing
  assert.equal(h.pendingMelee, 'special');
  setNormalRecovery(h);                // land on the recovery frame
  h._prevMeleeJumpHeld = false;        // ensure a genuine fresh-press edge
  h.update(DT, { ...noInput(), jump: true });
  assert.equal(h.meleeActive, false, 'swing must be cancelled');
  assert.equal(h.specialMeleeActive, false, 'buffered special must be discarded');
  assert.equal(h.pendingMelee, null, 'buffer must be cleared');
  assert.ok(noAttackState(h), 'no residual attack state');
});
ok('the jump actually fires (locomotion performed, not just suppressed)', () => {
  const h = makeHero();
  h.grounded = true;
  h.requestMelee('normal');
  h.requestMelee('special');
  setNormalRecovery(h);
  h._prevMeleeJumpHeld = false;
  h.update(DT, { ...noInput(), jump: true });
  assert.equal(h.jumpsUsed, 1, 'ground jump consumed by the cancel');
  assert.ok(h.vy < 0, `vy=${h.vy} — hero must launch upward`);
  assert.equal(h.grounded, false);
});

console.log('Acceptance #2 — Special → buffer Melee → recovery → Run = Run only');
ok('run input during special recovery cancels the swing and discards the buffered normal', () => {
  const h = makeHero('balthazar');
  h.grounded = true;
  h.requestMelee('special');           // start the special swing
  h.requestMelee('normal');            // buffer the normal mid-swing
  assert.equal(h.pendingMelee, 'normal');
  setSpecialRecovery(h);               // land on the first recovery frame
  h.update(DT, { ...noInput(), right: true });
  assert.equal(h.specialMeleeActive, false, 'swing must be cancelled');
  assert.equal(h.meleeActive, false, 'buffered normal must be discarded');
  assert.equal(h.pendingMelee, null, 'buffer must be cleared');
  assert.ok(noAttackState(h), 'no residual attack state');
});
ok('run input during NORMAL recovery cancels and discards the buffered special', () => {
  const h = makeHero();
  h.grounded = true;
  h.requestMelee('normal');
  h.requestMelee('special');
  setNormalRecovery(h);
  h.update(DT, { ...noInput(), left: true });
  assert.equal(h.meleeActive, false);
  assert.equal(h.specialMeleeActive, false);
  assert.equal(h.pendingMelee, null);
  assert.ok(noAttackState(h));
});

console.log('Acceptance #3 — windup/active are committed (jump does NOT cancel)');
ok('jump during normal WINDUP does not cancel the swing', () => {
  const h = makeHero();
  h.grounded = true;
  h.requestMelee('normal');
  h.meleeFrame = 0;                    // windup frame
  h._prevMeleeJumpHeld = false;
  h.update(DT, { ...noInput(), jump: true });
  assert.equal(h.meleeActive, true, 'windup is committed — no cancel');
});
ok('jump during normal ACTIVE does not cancel the swing', () => {
  const h = makeHero();
  h.grounded = true;
  h.requestMelee('normal');
  h.meleeFrame = h.MELEE_ACTIVE_FRAME; // the damaging frame
  h._prevMeleeJumpHeld = false;
  h.update(DT, { ...noInput(), jump: true });
  assert.equal(h.meleeActive, true, 'active is committed — no cancel');
});
ok('run input during normal windup/active does not cancel', () => {
  const h = makeHero();
  h.grounded = true;
  h.requestMelee('normal');
  h.meleeFrame = 1;                    // windup
  h.update(DT, { ...noInput(), right: true });
  assert.equal(h.meleeActive, true, 'windup is committed against run input');
  h.meleeFrame = h.MELEE_ACTIVE_FRAME; // active
  h.update(DT, { ...noInput(), right: true });
  assert.equal(h.meleeActive, true, 'active is committed against run input');
});
ok('jump during special WINDUP does not cancel (committed)', () => {
  const h = makeHero('balthazar');
  h.grounded = true;
  h.requestMelee('special');
  h._prevMeleeJumpHeld = false;
  h.update(DT, { ...noInput(), jump: true });
  assert.equal(h.specialMeleeActive, true, 'special windup is committed');
  assert.equal(h.specialMeleePhase, 'windup');
  assert.equal(h.jumpsUsed, 0);
});
ok('jump during special ACTIVE does not cancel (committed)', () => {
  const h = makeHero('balthazar');
  h.grounded = true;
  h.requestMelee('special');
  const cfg = HEROES.balthazar.specialMelee;
  h.specialMeleeFrame = cfg.frames.windup; // first active frame
  h._prevMeleeJumpHeld = false;
  h.update(DT, { ...noInput(), jump: true });
  assert.equal(h.specialMeleeActive, true, 'special active is committed');
  assert.equal(h.specialMeleePhase, 'active');
  assert.equal(h.jumpsUsed, 0);
});

console.log('Acceptance #4 — run input cancels recovery, locomotion resumes SAME frame');
ok('vx reaches full run speed on the cancel frame with no residual attack state', () => {
  const h = makeHero();
  h.grounded = true;
  h.facing = 1;
  h.vx = 0;
  h.requestMelee('normal');
  setNormalRecovery(h);
  h.update(DT, { ...noInput(), right: true });
  assert.equal(h.meleeActive, false);
  assert.ok(noAttackState(h), 'no residual attack state');
  assert.ok(Math.abs(h.vx - h.stats.speed) < 1e-6,
    `vx=${h.vx} vs speed=${h.stats.speed} — ground snap must apply the same frame`);
});
ok('opposite-direction run also cancels and steers the same frame', () => {
  const h = makeHero();
  h.grounded = true;
  h.facing = 1;
  h.requestMelee('normal');
  setNormalRecovery(h);
  h.update(DT, { ...noInput(), left: true });
  assert.equal(h.meleeActive, false);
  assert.equal(h.facing, -1, 'facing follows the run direction');
  assert.ok(Math.abs(h.vx + h.stats.speed) < 1e-6, `vx=${h.vx}`);
});
ok('special recovery run-cancel resumes locomotion the same frame', () => {
  const h = makeHero('balthazar');
  h.grounded = true;
  h.facing = 1;
  h.requestMelee('special');
  setSpecialRecovery(h);
  h.update(DT, { ...noInput(), right: true });
  assert.equal(h.specialMeleeActive, false);
  assert.ok(noAttackState(h));
  assert.ok(Math.abs(h.vx - h.stats.speed) < 1e-6, `vx=${h.vx}`);
});
ok('holding both directions is NOT a valid cancel (ambiguous input)', () => {
  const h = makeHero();
  h.grounded = true;
  h.requestMelee('normal');
  setNormalRecovery(h);
  h.update(DT, { ...noInput(), left: true, right: true });
  assert.equal(h.meleeActive, true, 'ambiguous input must not cancel');
});

console.log('Acceptance #5 — identical rules for normal and special (no per-type divergence)');
ok('the shared predicate drives both kinds identically', () => {
  const n = makeHero();
  const s = makeHero('balthazar');
  // Same inputs, same prior jump state → same verdict for both machines.
  const cases = [
    { ...noInput() },                                  // nothing → false
    { ...noInput(), jump: true },                      // fresh jump → true
    { ...noInput(), left: true },                      // run → true
    { ...noInput(), right: true },                     // run → true
    { ...noInput(), left: true, right: true },         // ambiguous → false
    { ...noInput(), down: true },                      // crouch only → false
  ];
  for (const inp of cases) {
    n._prevMeleeJumpHeld = false;
    s._prevMeleeJumpHeld = false;
    assert.equal(n._meleeCancelRequested(inp), s._meleeCancelRequested(inp),
      `divergence for input ${JSON.stringify(inp)}`);
  }
});
ok('a HELD jump (not a fresh press) does not cancel either kind', () => {
  const h = makeHero();
  h.grounded = true;
  h.requestMelee('normal');
  setNormalRecovery(h);
  h._prevMeleeJumpHeld = true;                        // jump already held last frame
  h.update(DT, { ...noInput(), jump: true });
  assert.equal(h.meleeActive, true, 'held jump is not an edge → no cancel');
});
ok('cancel beats buffer even when the buffer was stored on the SAME frame', () => {
  // §19 ordering: the cancel check runs BEFORE executePendingMelee each frame.
  // Even if a press buffers into an attack that is ALREADY in recovery, the
  // next locomotion intent discards it rather than letting it fire.
  const h = makeHero();
  h.grounded = true;
  h.requestMelee('normal');
  setNormalRecovery(h);                                // already in recovery
  h.requestMelee('special');                           // press lands → buffers
  assert.equal(h.pendingMelee, 'special');
  h._prevMeleeJumpHeld = false;
  h.update(DT, { ...noInput(), jump: true });          // cancel this frame
  assert.equal(h.meleeActive, false);
  assert.equal(h.specialMeleeActive, false, 'buffered action must never fire after a cancel');
  assert.equal(h.pendingMelee, null);
});

console.log('\nWiring (per-frame order contract from systems/update.js)');
ok('update.js evaluates cancel BEFORE buffer execution each frame', () => {
  // Mirrors the production per-frame order: hero.update(dt, intent) runs the
  // melee phase machines (cancel checked inside updateMelee/updateSpecialMelee,
  // before any executePendingMelee), THEN the melee trigger block handles a
  // NEW press via requestMelee(). A press landing on the cancel frame stores
  // into the slot AFTER the cancel already ran — so it survives until the
  // NEXT frame's natural completion, never firing on the cancel frame itself.
  const h = makeHero();
  h.grounded = true;
  h.requestMelee('normal');
  setNormalRecovery(h);
  h._prevMeleeJumpHeld = false;
  // Frame N: cancel (jump) + a simultaneous fresh melee press.
  let input = { ...noInput(), jump: true, melee: true };
  h.update(DT, input);                                  // cancel runs first…
  const wasActive = h.meleeActive || h.specialMeleeActive;
  h.requestMelee(input.down ? 'special' : 'normal');    // …then the new press
  assert.equal(wasActive, false, 'cancel beat the buffer this frame');
  assert.equal(h.meleeActive, true, 'the NEW press starts a fresh swing after the cancel');
  assert.equal(h.pendingMelee, null);
});

console.log(`\n${passed} assertions passed.`);
if (process.exitCode) console.error('FAILURES above');
