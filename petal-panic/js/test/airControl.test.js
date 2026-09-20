// Air control: ground snaps to run speed (§7), air ramps from rest (§8).
// Run: node js/test/airControl.test.js
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

console.log('Ground movement (§7)');
ok('grounded press produces full run speed on the same frame', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = noInput(); inp.right = true;
  // Hero starts at natural rest (vx=0, not blocked by any solid). Pressing a
  // direction must produce INSTANT full run speed on the very first frame (§7),
  // not the air ramp. _blockedX is unset/false here — the hero is free.
  assert.equal(h.vx, 0, 'precondition: hero at rest');
  h.update(DT, inp);
  assert.equal(h.vx, 250, `expected instant 250 from rest, got ${h.vx}`);
});

ok('opposite ground direction cancels momentum immediately', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = noInput(); inp.right = true;
  for (let i = 0; i < 10; i++) h.update(DT, inp);
  assert.ok(Math.abs(h.vx - 250) < 1, 'should be at full run speed first');
  inp = noInput(); inp.left = true;
  h.update(DT, inp);
  assert.equal(h.vx, -250, `expected instant -250, got ${h.vx}`);
});

console.log('Air control ramp (§8)');
ok('airborne from ~0 vx approaches run speed over several frames, never snaps', () => {
  const h = makeHero();
  h.setGrounded(false);
  h.vy = 0; // hold in place so gravity doesn't matter for this check
  let inp = noInput(); inp.right = true;
  h.update(DT, inp);
  const v1 = h.vx;
  assert.ok(v1 > 0 && v1 < 250, `frame 1 should be partway, not snapped: ${v1}`);
  assert.ok(v1 <= 1400 * DT + 1e-9, `first-frame gain must respect AIR_ACCEL*dt: ${v1}`);
  let frames = 0;
  while (Math.abs(h.vx - 250) > 0.5 && frames < 300) { h.update(DT, inp); frames++; }
  assert.ok(frames >= 3, `should take several frames to reach run speed, took ${frames}`);
  assert.ok(Math.abs(h.vx - 250) < 1, `should settle at run speed, got ${h.vx}`);
});

ok('jumping while running preserves horizontal momentum', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = noInput(); inp.right = true;
  for (let i = 0; i < 10; i++) h.update(DT, inp);
  assert.ok(Math.abs(h.vx - 250) < 1, 'should be at full run speed before jumping');
  inp.jump = true;
  h.update(DT, inp);
  assert.ok(h.vy < 0, 'should have jumped');
  assert.equal(h.grounded, false);
  assert.ok(Math.abs(h.vx - 250) < 1, `running jump must keep 250 vx, got ${h.vx}`);
  // Keep holding right in the air: velocity stays at run speed (no decay, no re-ramp).
  h.setGrounded(false);
  for (let i = 0; i < 10; i++) h.update(DT, inp);
  assert.ok(Math.abs(h.vx - 250) < 1, `momentum should persist mid-air, got ${h.vx}`);
});

ok('barrel case: blocked against a solid then jumping accelerates into movement, no 1-frame snap', () => {
  // Hero runs right into a barrel: collision zeroes vx each frame while blocked
  // AND stamps _blockedX (a solid cancelled horizontal motion). Jump with
  // vx ≈ 0 → air ramp applies.
  const h = makeHero();
  h.setGrounded(true);
  let inp = noInput(); inp.right = true;
  for (let i = 0; i < 10; i++) {
    h.update(DT, inp);
    h.vx = 0;          // simulate the solid blocking horizontal motion
    h._blockedX = true; // resolve() stamped it: a solid stopped us this frame
  }
  assert.equal(h.vx, 0, 'blocked hero should sit at ~0 vx');
  inp.jump = true;
  h.update(DT, inp);
  assert.ok(h.vy < 0, 'should have jumped');
  // The launch frame must NOT snap to full run speed even though the hero is
  // still grounded when the horizontal branch runs: pinned by a solid
  // (_blockedX) with a held direction means "blocked", so the ramp applies
  // (§8 solid-obstacle).
  const vJump = h.vx;
  assert.ok(vJump > 0 && vJump < 250, `jump frame must not launch at full speed: ${vJump}`);
  assert.ok(vJump <= 1400 * DT + 1e-9, `jump-frame gain must respect AIR_ACCEL*dt: ${vJump}`);
  // Once airborne and clear of the barrel, keep holding right: the ramp
  // continues toward run speed over several frames, never re-snapping in one.
  h.setGrounded(false);
  h._blockedX = false; // cleared the wall — free air now
  h.update(DT, inp);
  const v1 = h.vx;
  assert.ok(v1 >= vJump - 1e-9, `ramp must be monotonic, got ${v1} after ${vJump}`);
  assert.ok(v1 < 250, `still ramping mid-air: ${v1}`);
  let frames = 0;
  while (Math.abs(h.vx - 250) > 0.5 && frames < 300) { h.update(DT, inp); frames++; }
  assert.ok(frames >= 1, `should accelerate over several frames, took ${frames}`);
  assert.ok(Math.abs(h.vx - 250) < 1, `should settle at run speed after clearing, got ${h.vx}`);
});

console.log('Air direction reversal (§8)');
ok('full-speed air reversal flips instantly, preserving speed magnitude (no decel-to-zero)', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = noInput(); inp.right = true;
  for (let i = 0; i < 10; i++) h.update(DT, inp); // reach full run speed
  assert.ok(Math.abs(h.vx - 250) < 1, 'precondition: at full run speed');
  inp.jump = true;
  h.update(DT, inp);
  h.setGrounded(false); // airborne
  assert.ok(Math.abs(h.vx - 250) < 1, 'running jump preserved 250 vx');
  // Press the opposite direction in the air.
  inp = noInput(); inp.left = true;
  h.update(DT, inp);
  // Instant mirror: sign flipped on THIS frame, magnitude preserved (~250).
  assert.ok(h.vx < 0, `reversal must flip sign immediately, got ${h.vx}`);
  assert.ok(Math.abs(Math.abs(h.vx) - 250) < 1, `magnitude must be preserved (~250), got ${h.vx}`);
});

ok('air reversal never passes through a long zero window', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = noInput(); inp.right = true;
  for (let i = 0; i < 10; i++) h.update(DT, inp);
  inp.jump = true;
  h.update(DT, inp);
  h.setGrounded(false);
  inp = noInput(); inp.left = true;
  h.update(DT, inp);
  // The very first reversal frame is already fully negative — it did not cruise
  // through ~0 over many frames (the old bug took ~11 frames to cross zero).
  assert.ok(h.vx <= -249, `first reversal frame should be ~-250, got ${h.vx}`);
});

ok('near-zero air start still uses the ramp (no instant snap)', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp); // jump from rest → vx ≈ 0
  h.setGrounded(false);
  assert.ok(Math.abs(h.vx) < 1, 'precondition: jumped from rest');
  inp = noInput(); inp.right = true;
  h.update(DT, inp);
  assert.ok(h.vx > 0 && h.vx < 250, `near-zero start must ramp, not snap: ${h.vx}`);
});

console.log(`\n${passed} passed`);
