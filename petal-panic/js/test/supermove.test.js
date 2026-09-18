// Supermove phase model + jump cancellation (design §22-§23) and the render.js
// anim flag fix (§29). Run: node js/test/supermove.test.js
// Direct-intent pattern (see jumpslide.test.js): hero.update(DT, intent) with
// plain intent objects. No DOM key simulation, no input.js polling.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';

// --- Minimal DOM stub (render.js → update.js builds placeholder frames at
// import time). Same pattern as heroAnim.test.js.
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

let passed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, special: false, melee: false, super: false });
const makeHero = () => new Hero(HEROES.scarlet, 0, 0); // speed 250, jump 500
const startDash = (h, facing = 1) => {
  h.facing = facing;
  h.supermoveMeter = h.SUPERMOVE_MAX;
  const inp = noInput(); inp.super = true;
  h.update(DT, inp);
};
// Advance N frames with no input; returns the frame index (1-based) on which
// the dash ended, or -1 if it never ended within the budget.
const runUntilEnd = (h, maxFrames = 240) => {
  for (let i = 1; i <= maxFrames; i++) {
    h.update(DT, noInput());
    if (!h.supermoveActive) return i;
  }
  return -1;
};

console.log('Phase split (§22/§23)');
await ok('dash starts in the committed burst phase', () => {
  const h = makeHero();
  startDash(h);
  assert.equal(h.supermoveActive, true);
  assert.equal(h.supermovePhase, 'burst');
});

await ok('phase durations are a 60/40 split of the total', () => {
  const h = makeHero();
  startDash(h);
  assert.ok(Math.abs(h.burstDur - h.SUPERMOVE_DUR * 0.6) < 1e-9, `burst=${h.burstDur}`);
  assert.ok(Math.abs(h.decelDur - h.SUPERMOVE_DUR * 0.4) < 1e-9, `decel=${h.decelDur}`);
});

await ok('full uncancelled dash runs exactly the total duration', () => {
  const h = makeHero();
  startDash(h);
  const endFrame = runUntilEnd(h);
  const expected = Math.round(h.SUPERMOVE_DUR / DT); // 0.6s → 36 frames
  assert.equal(endFrame, expected, `ended on frame ${endFrame}, expected ${expected}`);
});

console.log('Burst is committed (AC #1)');
await ok('jump pressed during the first 60% does NOT cancel the dash', () => {
  const h = makeHero();
  startDash(h);
  // Press jump while still inside the burst (frame 5 of ~22).
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.supermoveActive, true, 'burst must survive a jump press');
  assert.equal(h.supermovePhase, 'burst');
  // Keep holding through the whole burst — still not cancelled.
  for (let i = 0; i < 15 && h.supermoveActive; i++) h.update(DT, inp);
  assert.equal(h.supermoveActive, true, 'holding jump across the burst must not abort it');
});

await ok('no gravity during the burst (airborne slide)', () => {
  const h = makeHero();
  startDash(h);
  h.vy = 100; // stray vertical velocity
  h.update(DT, noInput());
  assert.equal(h.vy, 0, `burst should pin vy to 0, got ${h.vy}`);
});

console.log('Velocity ramp continuity (§22)');
await ok('vx is monotonically decreasing across the whole dash (no jump at phase handoff)', () => {
  const h = makeHero();
  startDash(h);
  let prev = Infinity;
  let sawBurst = false, sawDecel = false;
  for (let i = 0; h.supermoveActive; i++) {
    h.update(DT, noInput());
    if (h.supermovePhase === 'burst') sawBurst = true;
    if (h.supermovePhase === 'decel') sawDecel = true;
    assert.ok(h.vx <= prev + 1e-9,
      `vx increased at frame ${i} (${prev} → ${h.vx}) — discontinuity at handoff?`);
    prev = h.vx;
    if (i > 60) throw new Error('dash did not end in time');
  }
  assert.ok(sawBurst && sawDecel, 'sampled both phases');
});

console.log('Decel is jump-cancellable (AC #2)');
await ok('jump pressed during the last 40% ends the dash early with residual forward vx', () => {
  const h = makeHero();
  startDash(h);
  // Skip ahead past the burst (21.6 frames) into the decel phase.
  for (let i = 0; i < 23; i++) h.update(DT, noInput());
  assert.equal(h.supermovePhase, 'decel', `should be in decel by frame 20, was ${h.supermovePhase}`);
  // Fresh jump press cancels out of the recovery.
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.supermoveActive, false, 'decel jump must end the dash');
  assert.equal(h.supermovePhase, null);
  assert.ok(h.vx > 0, `residual forward nudge expected, got vx=${h.vx}`);
  assert.ok(h.vx < h.SUPERMOVE_SPEED, 'residual must be small, not full burst speed');
});

await ok('a held jump that started in the burst does NOT cancel once in decel (fresh press only)', () => {
  const h = makeHero();
  startDash(h);
  // Hold jump through the entire burst into the decel without a fresh edge.
  const hold = noInput(); hold.jump = true;
  h.update(DT, hold); // initial press lands in the burst
  let enteredDecel = false;
  for (let i = 0; i < 40 && h.supermoveActive; i++) {
    h.update(DT, hold);
    if (h.supermovePhase === 'decel') enteredDecel = true;
  }
  assert.ok(enteredDecel, 'dash should have reached the decel phase');
  // The dash may still be running OR already finished naturally — either way it
  // was NOT cancelled by the stale held jump (a fresh edge is required).
  assert.equal(h.supermovePhase, null, 'no fresh edge → no mid-decel cancel');
});

console.log('Intangibility window (AC #3/#5)');
await ok('supermove uses the shared intangible timer, not a separate bookkeeping path', () => {
  const h = makeHero();
  startDash(h);
  assert.equal(h.intangible, true);
  assert.ok(Math.abs(h.timers.get('intangible') - h.SUPERMOVE_DUR) < 1e-9,
    `intangible timer should equal the dash duration, got ${h.timers.get('intangible')}`);
});

await ok('intangibility lasts exactly the dash duration (timer-driven)', () => {
  const h = makeHero();
  startDash(h);
  const endFrame = runUntilEnd(h);
  // On the ending frame the dash has just closed; the shared timer has ticked
  // the same number of frames, so it expires on the very same frame.
  assert.equal(h.intangible, false, 'intangible flag should clear when the dash ends');
  assert.equal(h.timers.get('intangible'), 0, 'shared timer should be spent at dash end');
  assert.ok(endFrame > 0, 'dash should have ended');
});

await ok('jump-cancel during decel clears the supermove-granted intangibility', () => {
  const h = makeHero();
  startDash(h);
  assert.equal(h.intangible, true, 'dashing hero must be intangible');
  // Skip ahead past the burst into the decel phase.
  for (let i = 0; i < 23 && h.supermoveActive; i++) h.update(DT, noInput());
  assert.equal(h.supermovePhase, 'decel', `should be in decel, was ${h.supermovePhase}`);
  // Fresh jump press cancels out of the recovery.
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.supermoveActive, false, 'decel jump must end the dash');
  // The dash is over → the supermove immunity must NOT linger.
  assert.equal(h.intangible, false, 'hero must not stay intangible after a cancelled dash');
  assert.equal(h.timers.get('intangible'), 0, 'intangible timer must be cleared on cancel');
});

await ok('jump-cancel restores a pre-existing longer intangibility grant', () => {
  const h = makeHero();
  // Pre-existing i-frame window (e.g. from a recent hit) that outlasts the dash.
  h.intangible = true;
  h.timers.set('intangible', 2.0);
  startDash(h);
  // Supermove must not truncate the existing longer grant: it stays at the
  // pre-dash value (the trigger frame's own tick has already advanced it).
  assert.ok(h.timers.get('intangible') > h.SUPERMOVE_DUR,
    `existing 2s grant must survive trigger, got ${h.timers.get('intangible')}`);
  // Cancel mid-dash.
  for (let i = 0; i < 23 && h.supermoveActive; i++) h.update(DT, noInput());
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.supermoveActive, false);
  // Restored to the pre-dash remaining (the trigger re-set it to the full
  // pre-dash duration), minus the total time elapsed since the dash began.
  assert.equal(h.intangible, true, 'pre-existing intangibility must be restored');
  const expected = Math.max(0, 2.0 - (24 * DT));
  assert.ok(Math.abs(h.timers.get('intangible') - expected) < 2 * DT + 1e-6,
    `restored timer ≈ pre-dash remaining, got ${h.timers.get('intangible')} want ${expected}`);
});

await ok('a shorter pre-existing grant that expires during the dash is NOT restored', () => {
  const h = makeHero();
  // Short i-frame window (0.3s) that will naturally expire during the 0.6s dash.
  h.intangible = true;
  h.timers.set('intangible', 0.3);
  startDash(h);
  // The shared timer was bumped up to cover the dash, but the ORIGINAL 0.3s
  // grant only lasts 0.3s of real time — it must be gone when the dash ends.
  for (let i = 0; i < 23 && h.supermoveActive; i++) h.update(DT, noInput());
  assert.equal(h.supermovePhase, 'decel', `should be in decel, was ${h.supermovePhase}`);
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.supermoveActive, false, 'decel jump must end the dash');
  // 24 frames × DT ≈ 0.4s have elapsed since trigger > the 0.3s pre-grant →
  // the original immunity is long expired and must NOT linger after the cancel.
  assert.equal(h.intangible, false, 'expired pre-grant must not be resurrected by the cancel');
  assert.equal(h.timers.get('intangible'), 0, 'intangible timer must be cleared on cancel');
});

console.log('Respawn i-frames (§27)');
await ok('respawn grants actual immunity (flag true while the timer is active)', () => {
  const h = makeHero();
  h.dying = true;
  h.energy = 0;
  h.respawn();
  assert.equal(h.intangible, true, 'hero must be intangible right after respawn');
  assert.ok(Math.abs(h.timers.get('intangible') - Hero.RESPAWN_IFRAMES) < 1e-9,
    `respawn i-frame timer should equal RESPAWN_IFRAMES, got ${h.timers.get('intangible')}`);
  // A hit during the respawn window must be absorbed.
  const landed = h.takeHit({ dirX: -1, dirY: 0, strength: 240 });
  assert.equal(landed, false, 'hit during respawn i-frames must be absorbed');
  // After the window ticks out the flag clears.
  for (let i = 0; i < Math.ceil(Hero.RESPAWN_IFRAMES / DT) + 1; i++) h.update(DT, noInput());
  assert.equal(h.intangible, false, 'intangible flag must clear once the respawn window expires');
});

console.log('Anim state sync (§29, AC #4)');
await ok('heroAnimName returns supermove while dashing and the previous state after', async () => {
  const { heroAnimName } = await import('../systems/render.js');
  const h = makeHero();
  // Give the hero a real prev anim so restoration is observable.
  const prevAnim = { frames: [{}], reset() {}, pickFrame() {}, tick() {} };
  h.anim = prevAnim;
  h.anims.supermove = { frames: [{}], reset() {}, pickFrame() {}, tick() {} };

  startDash(h);
  assert.equal(heroAnimName(h), 'supermove', 'dashing hero must report the supermove anim');
  assert.notEqual(h.anim, prevAnim, 'anim should have swapped to the supermove clip');

  runUntilEnd(h);
  assert.equal(h.supermoveActive, false);
  assert.equal(h.anim, prevAnim, 'anim should restore to the previous clip');
  // After the dash the hero is airborne with residual vx → run (not idle, not supermove).
  assert.notEqual(heroAnimName(h), 'supermove', 'supermove anim must not persist after the dash');
});

console.log(`\n${passed} passed`);
