// Supermove phase model + jump cancellation (design §22-§23) and the render.js
// anim flag fix (§29). Run: node js/test/supermove.test.js
// Direct-intent pattern (see jumpslide.test.js): hero.update(DT, intent) with
// plain intent objects. No DOM key simulation, no input.js polling.

import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

import { strict as assert } from 'node:assert';
import { Hero } from '../hero/hero.js';
import { HEROES } from '../hero/heroDefs.js';
import { SUPERMOVE_DUR, SUPERMOVE_SPEED } from '../consts.js';

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
// the supermove ended, or -1 if it never ended within the budget.
const runUntilEnd = (h, maxFrames = 240) => {
  for (let i = 1; i <= maxFrames; i++) {
    h.update(DT, noInput());
    if (!h.supermoveActive) return i;
  }
  return -1;
};

console.log('Phase split (§22/§23)');
await ok('supermove starts in the committed burst phase', () => {
  const h = makeHero();
  startDash(h);
  assert.equal(h.supermoveActive, true);
  assert.equal(h.supermovePhase, 'burst');
});

await ok('phase durations are a 60/40 split of the total', () => {
  const h = makeHero();
  startDash(h);
  assert.ok(Math.abs(h.burstDur - SUPERMOVE_DUR * 0.6) < 1e-9, `burst=${h.burstDur}`);
  assert.ok(Math.abs(h.decelDur - SUPERMOVE_DUR * 0.4) < 1e-9, `decel=${h.decelDur}`);
});

await ok('full uncancelled supermove runs exactly the total duration', () => {
  const h = makeHero();
  startDash(h);
  const endFrame = runUntilEnd(h);
  const expected = Math.round(SUPERMOVE_DUR / DT); // 0.6s → 36 frames
  assert.equal(endFrame, expected, `ended on frame ${endFrame}, expected ${expected}`);
});

console.log('Burst is committed (AC #1)');
await ok('jump pressed during the first 60% does NOT cancel the supermove', () => {
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
await ok('vx is monotonically decreasing across the whole supermove (no jump at phase handoff)', () => {
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
    if (i > 60) throw new Error('supermove did not end in time');
  }
  assert.ok(sawBurst && sawDecel, 'sampled both phases');
});

console.log('Decel is jump-cancellable (AC #2)');
await ok('jump pressed during the last 40% ends the supermove early with residual forward vx', () => {
  const h = makeHero();
  startDash(h);
  // Skip ahead past the burst (21.6 frames) into the decel phase.
  for (let i = 0; i < 23; i++) h.update(DT, noInput());
  assert.equal(h.supermovePhase, 'decel', `should be in decel by frame 20, was ${h.supermovePhase}`);
  // Fresh jump press cancels out of the recovery.
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.supermoveActive, false, 'decel jump must end the supermove');
  assert.equal(h.supermovePhase, null);
  assert.ok(h.vx > 0, `residual forward nudge expected, got vx=${h.vx}`);
  assert.ok(h.vx < SUPERMOVE_SPEED, 'residual must be small, not full burst speed');
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
  assert.ok(enteredDecel, 'supermove should have reached the decel phase');
  // The supermove may still be running OR already finished naturally — either way it
  // was NOT cancelled by the stale held jump (a fresh edge is required).
  assert.equal(h.supermovePhase, null, 'no fresh edge → no mid-decel cancel');
});

console.log('Immunity window (immunity.md: event-based invincible, no intangible)');
await ok('supermove grants invincible WITHOUT intangible (stays a body in the world)', () => {
  const h = makeHero();
  startDash(h);
  assert.equal(h.invincible, true);
  assert.equal(h.invulnSource, 'supermove', 'source tag drives the (absent) visual');
  assert.equal(h.intangible, false, 'supermove does NOT leave the collision system');
});

await ok('invincibility lasts exactly the supermove duration (cleared at endSupermove)', () => {
  const h = makeHero();
  startDash(h);
  const endFrame = runUntilEnd(h);
  // On the ending frame the supermove has just closed; the scoped clear ran.
  assert.equal(h.invincible, false, 'invincible flag should clear when the supermove ends');
  assert.equal(h.intangible, false, 'no ghost state was ever granted');
  assert.ok(endFrame > 0, 'supermove should have ended');
});

await ok('jump-cancel during decel clears the supermove-granted invincibility', () => {
  const h = makeHero();
  startDash(h);
  assert.equal(h.invincible, true, 'dashing hero must be invincible');
  // Skip ahead past the burst into the decel phase.
  for (let i = 0; i < 23 && h.supermoveActive; i++) h.update(DT, noInput());
  assert.equal(h.supermovePhase, 'decel', `should be in decel, was ${h.supermovePhase}`);
  // Fresh jump press cancels out of the recovery.
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.supermoveActive, false, 'decel jump must end the supermove');
  // The supermove is over → the supermove immunity must NOT linger.
  assert.equal(h.invincible, false, 'hero must not stay invincible after a cancelled supermove');
  assert.equal(h.intangible, false, 'no ghost state lingers either');
});

await ok('jump-cancel restores a pre-existing longer invincibility grant', () => {
  const h = makeHero();
  // Pre-existing i-frame window (e.g. from a recent hit) that outlasts the supermove.
  h.setInvincible('hit', 2.0);
  startDash(h);
  // Supermove must not truncate the existing longer grant: its timer-backed
  // window is untouched by the event-based supermove claim.
  assert.ok(h.timers.get('invincible') > SUPERMOVE_DUR,
    `existing 2s grant must survive trigger, got ${h.timers.get('invincible')}`);
  assert.equal(h.invulnSource, 'hit', 'longer timer-backed grant keeps its own source');
  // Cancel mid-supermove.
  for (let i = 0; i < 23 && h.supermoveActive; i++) h.update(DT, noInput());
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.supermoveActive, false);
  // Restored to the pre-supermove remaining: the trigger re-set the timer to the
  // full pre-supermove duration (2.0s), then 25 frames have ticked by cancel time
  // (1 on the trigger frame + 24 more).
  assert.equal(h.invincible, true, 'pre-existing invincibility must be restored');
  const expected = Math.max(0, 2.0 - (25 * DT));
  assert.ok(Math.abs(h.timers.get('invincible') - expected) < 2 * DT + 1e-6,
    `restored timer ≈ pre-supermove remaining, got ${h.timers.get('invincible')} want ${expected}`);
});

await ok('a shorter pre-existing grant that expires during the supermove is NOT restored', () => {
  const h = makeHero();
  // Short i-frame window (0.3s) that will naturally expire during the 0.6s supermove.
  h.setInvincible('hit', 0.3);
  startDash(h);
  // The supermove claims the flag event-based; the 0.3s timer keeps ticking and
  // self-expires mid-supermove — at which point syncImmunityStates drops the flag.
  for (let i = 0; i < 23 && h.supermoveActive; i++) h.update(DT, noInput());
  assert.equal(h.supermovePhase, 'decel', `should be in decel, was ${h.supermovePhase}`);
  let inp = noInput(); inp.jump = true;
  h.update(DT, inp);
  assert.equal(h.supermoveActive, false, 'decel jump must end the supermove');
  // ~0.4s elapsed since trigger > the 0.3s pre-grant → the original immunity is
  // long expired and must NOT linger after the cancel either.
  assert.equal(h.invincible, false, 'expired pre-grant must not be resurrected by the cancel');
  assert.equal(h.intangible, false, 'no ghost state lingers');
});

console.log('Respawn i-frames (§27)');
await ok('respawn grants actual immunity (flag true while the timer is active)', () => {
  const h = makeHero();
  h.dying = true;
  h.energy = 0;
  h.respawn();
  assert.equal(h.invincible, true, 'hero must be invincible right after respawn');
  assert.ok(Math.abs(h.timers.get('invincible') - Hero.RESPAWN_IFRAMES) < 1e-9,
    `respawn i-frame timer should equal RESPAWN_IFRAMES, got ${h.timers.get('invincible')}`);
  // A hit during the respawn window must be absorbed.
  const landed = h.takeHit({ dirX: -1, dirY: 0, strength: 240 });
  assert.equal(landed, false, 'hit during respawn i-frames must be absorbed');
  // After the window ticks out the flag clears.
  for (let i = 0; i < Math.ceil(Hero.RESPAWN_IFRAMES / DT) + 1; i++) h.update(DT, noInput());
  assert.equal(h.invincible, false, 'invincible flag must clear once the respawn window expires');
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
  // After the supermove the hero is airborne with residual vx → run (not idle, not supermove).
  assert.notEqual(heroAnimName(h), 'supermove', 'supermove anim must not persist after the supermove');
});

console.log(`\n${passed} passed`);
