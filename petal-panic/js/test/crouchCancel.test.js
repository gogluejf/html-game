// Task 1.5 — Crouch/slide cancellation hardening + anim-state sync audit.
// Run: node js/test/crouchCancel.test.js
// Direct-intent pattern (see jumpslide.test.js): hero.update(DT, intent) with
// plain intent objects. No DOM key simulation, no input.js polling.
//
// Asserts design §11/§12 invariants:
//   - Jump from crouch cancels crouch atomically and initiates the jump.
//   - Releasing Down while moving exits crouch into run with the standing
//     hitbox active the SAME frame.
//   - After a slide ends, vx reaches 0 and the sliding flag stops together —
//     no lingering slide state.
//   - heroAnimName (§29) matches the authoritative gameplay state after each
//     transition: jump-from-crouch, melee end, hit-stun end, dash end.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';

// --- Minimal DOM stub (render.js → update.js builds placeholder frames at
// import time). Same pattern as heroAnim.test.js / supermove.test.js.
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: (tag) => ({
    width: 0, height: 0,
    getContext: () => ctxStub,
    addEventListener: noop,
  }),
};
globalThis.window = { addEventListener: noop };

const { heroAnimName } = await import('../systems/render.js');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, special: false, melee: false, super: false });
const makeHero = () => new Hero(HEROES.scarlet, 0, 0); // speed 250, jump 500
// Free-fall leaves the hero airborne at test end; settle it back to rest so
// post-state assertions reflect grounded gameplay state, not mid-flight.
const settle = (h) => { h.setGrounded(true); h.vy = 0; };
// Bring the hero to full run speed holding a direction.
const runUp = (h, dir) => {
  const inp = noInput(); inp[dir] = true;
  for (let i = 0; i < 10; i++) h.update(DT, inp);
};

console.log('Jump from crouch (§12)');
ok('jumping from crouch cancels crouch and initiates the jump the same frame', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = noInput(); inp.down = true;
  h.update(DT, inp);
  assert.ok(h.crouching, 'should be crouched first');
  assert.equal(h.box, h.crouchBox, 'crouch box active before the jump');
  inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.jumpsUsed, 1, 'jump must fire without a stand-first requirement');
  assert.ok(h.vy < 0, 'upward velocity immediately after the jump');
  assert.equal(h.crouching, false, 'crouch state cancelled by the jump');
  assert.equal(h.sliding, false, 'no lingering slide flag');
  assert.equal(h.box, h.standBox, 'airborne/standing hitbox restored same frame');
});

ok('anim reflects the jump, not the crouch, after jump-from-crouch (§29)', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = noInput(); inp.down = true;
  h.update(DT, inp);
  assert.equal(heroAnimName(h), 'crouch', 'crouch anim while crouched');
  inp.jump = true;
  h.update(DT, inp);
  assert.equal(heroAnimName(h), 'jump', 'must NOT visually remain crouched after jumping');
});

console.log('Release Down while moving (§11)');
ok('releasing Down while moving exits crouch into run with standing hitbox same frame', () => {
  const h = makeHero();
  h.setGrounded(true);
  runUp(h, 'right');
  assert.ok(Math.abs(h.vx - 250) < 1, 'at run speed before crouching');
  // Press down while running → enters the crouch/slide skid. The one-frame
  // grace keeps control for the entry frame, so sliding starts on the next.
  let inp = noInput(); inp.down = true; inp.right = true;
  h.update(DT, inp);
  assert.ok(h.crouching, 'crouched after pressing down mid-run');
  assert.equal(h.box, h.crouchBox, 'crouch hitbox active during the skid');
  settle(h); // grounded hero at rest before the second skid frame
  h.update(DT, inp);
  assert.ok(h.sliding, `sliding on the second skid frame (vx=${h.vx})`);
  // Release down while still holding right → stand + run on the SAME frame.
  inp = noInput(); inp.right = true;
  h.update(DT, inp);
  assert.equal(h.crouching, false, 'crouch exited when Down is released');
  assert.equal(h.sliding, false, 'slide flag cleared the same frame');
  assert.equal(h.box, h.standBox, 'standing hitbox active the same frame');
  assert.ok(h.vx > 200, `run resumes immediately (arcade snap), got vx=${h.vx}`);
  assert.equal(heroAnimName(h), 'run', 'anim is run, not crouch/slide, after exit');
});

console.log('First-frame crouch grace (§10)');
ok('pressing Down while running keeps run velocity on the entry frame; slide decel starts next frame', () => {
  const h = makeHero();
  h.setGrounded(true);
  runUp(h, 'right');
  assert.ok(Math.abs(h.vx - 250) < 1, 'at full run speed before pressing down');
  // Frame 1: first press of Down while holding right. The grace frame must
  // honor the held direction — vx stays at full run speed (no decel yet).
  let inp = noInput(); inp.down = true; inp.right = true;
  h.update(DT, inp);
  assert.ok(h.crouching, 'crouch entered on the press frame');
  assert.equal(h.box, h.crouchBox, 'crouch hitbox active from the press frame');
  assert.ok(Math.abs(h.vx - 250) < 1, `grace frame retains run velocity (vx=${h.vx})`);
  // Frame 2: still holding Down + right. Crouch is now fully committed —
  // control is locked and linear slide decel bleeds off exactly SLIDE_DECEL*dt.
  h.update(DT, inp);
  assert.ok(h.crouching, 'still crouched');
  assert.ok(h.sliding, 'slide flag committed on the second frame');
  assert.ok(Math.abs(h.vx - (250 - 8)) < 1, `slide decel begins on the NEXT frame (expected ~242, got ${h.vx})`);
});

console.log('Slide end (§10/§11)');
ok('after the slide ends, vx reaches 0 and the sliding flag stops together', () => {
  const h = makeHero();
  h.setGrounded(true);
  runUp(h, 'right');
  let inp = noInput(); inp.down = true; inp.right = true;
  h.update(DT, inp); // enter the skid (one-frame grace carries momentum in)
  settle(h); // grounded hero at rest before the committed skid frames
  h.update(DT, inp); // crouch fully committed: control locked, linear skid decel
  assert.ok(h.sliding, `sliding while momentum carries (vx=${h.vx})`);
  // Hold down until the skid fully bleeds off. The sliding flag must stay TRUE
  // on every frame where vx is still above rest, and flip false exactly on the
  // frame vx is clamped to 0 — state and velocity never desync (§11).
  inp = noInput(); inp.down = true;
  let frames = 0;
  while (frames < 300) {
    h.update(DT, inp);
    frames++;
    if (h.vx !== 0) {
      assert.ok(h.sliding, `sliding must remain true while vx is still moving (frame ${frames}, vx=${h.vx})`);
    } else {
      assert.equal(h.sliding, false, `sliding must be false the moment vx hits 0 (frame ${frames})`);
      break;
    }
  }
  assert.equal(h.vx, 0, 'vx reached rest');
  assert.equal(h.sliding, false, 'sliding flag cleared exactly when vx hit 0');
  assert.equal(h.crouching, true, 'still crouched (Down held) — only the slide ended');
  assert.equal(heroAnimName(h), 'crouch', 'anim drops from slide to crouch, not a stale slide');
  // Now release down: full stand-up, nothing lingers.
  h.update(DT, noInput());
  assert.equal(h.crouching, false);
  assert.equal(h.sliding, false);
  assert.equal(h.box, h.standBox);
  assert.equal(heroAnimName(h), 'idle', 'back on feet → idle, no stale visual state');
});

console.log('exitCrouch atomicity (§11 single exit path)');
ok('exitCrouch clears state, slide flag and restores the standing hitbox together', () => {
  const h = makeHero();
  h.crouching = true;
  h.sliding = true;
  h.box = h.crouchBox;
  h.exitCrouch();
  assert.equal(h.crouching, false);
  assert.equal(h.sliding, false);
  assert.equal(h.box, h.standBox, 'hitbox restored atomically with the flags');
});

console.log('heroAnimName §29 coverage — no stale visual state after transitions');
ok('airborne with vy > 0 (no jump used) → fall', () => {
  const h = makeHero();
  h.setGrounded(false); // walked off a ledge, no jump initiated
  h.vy = 300;           // falling
  assert.equal(h.jumpsUsed, 0, 'no jump was initiated');
  assert.equal(heroAnimName(h), 'fall', 'falling hero must show the fall anim, not idle/run');
});

ok('melee end: swing shows melee, then falls back to movement state', () => {
  const h = makeHero();
  h.grounded = true;
  h.tryMelee();
  assert.equal(heroAnimName(h), 'melee', 'melee anim while the swing is active');
  h.meleeActive = false;
  h.meleeFrame = 0;
  h.vx = 250;
  assert.equal(heroAnimName(h), 'run', 'no melee anim after the swing ends');
});

ok('hit-stun end: rec window shows hitstun, then control state resumes', () => {
  const h = makeHero();
  h.takeHit({ source: 'contact', dirX: -1, dirY: 0 });
  assert.ok(h.hitStunned, 'in hit-stun right after the hit');
  assert.equal(heroAnimName(h), 'hitstun', 'hitstun anim while recovery is active');
  for (let i = 0; i < 60; i++) h.update(DT, noInput()); // tick past the 0.25s window
  settle(h); // land from the knockback flight before asserting post-recovery state
  assert.equal(h.hitStunned, false, 'recovery expired');
  assert.equal(heroAnimName(h), 'idle', 'exact post-recovery state: grounded at rest → idle');
});

ok('dash end: supermove anim stops the moment the dash state ends', () => {
  const h = makeHero();
  h.facing = 1;
  h.supermoveMeter = h.SUPERMOVE_MAX;
  const inp = noInput(); inp.super = true;
  h.update(DT, inp);
  assert.ok(h.supermoveActive, 'dashing');
  assert.equal(heroAnimName(h), 'supermove', 'supermove anim while dashing');
  // Let the whole dash play out (0.6s ≈ 36 frames).
  for (let i = 0; i < 60 && h.supermoveActive; i++) h.update(DT, noInput());
  assert.equal(h.supermoveActive, false, 'dash finished');
  settle(h); // land from the dash flight before asserting post-dash state
  assert.equal(heroAnimName(h), 'run', 'exact post-dash state: residual forward nudge on ground → run');
});

// NOTE (§29): "special melee" and "shooting where applicable" are not covered
// here — they do not exist yet. Special melee lands with task 2.3 and the
// shooting context rules with the weapon system tasks; their anim coverage
// belongs in those tasks' tests, not stubbed here.

ok('priority order: dead > supermove > melee > hitstun > crouch > jump > run > idle', () => {
  const base = { dying: false, supermoveActive: false, meleeActive: false,
                 timers: { get: () => 0 }, crouching: false, sliding: false,
                 jumpsUsed: 0, vx: 0, vy: 0, grounded: true };
  assert.equal(heroAnimName({ ...base, dying: true, supermoveActive: true }), 'dead');
  assert.equal(heroAnimName({ ...base, supermoveActive: true, meleeActive: true }), 'supermove');
  assert.equal(heroAnimName({ ...base, meleeActive: true, crouching: true }), 'melee');
  assert.equal(heroAnimName({ ...base, timers: { get: () => 0.1 }, crouching: true }), 'hitstun');
  assert.equal(heroAnimName({ ...base, crouching: true, sliding: true, jumpsUsed: 1 }), 'slide');
  assert.equal(heroAnimName({ ...base, crouching: true, jumpsUsed: 1 }), 'crouch');
  assert.equal(heroAnimName({ ...base, jumpsUsed: 1, vx: 250 }), 'jump');
  assert.equal(heroAnimName({ ...base, vx: 250 }), 'run');
  assert.equal(heroAnimName(base), 'idle');
});

console.log(`\n${passed} passed`);
