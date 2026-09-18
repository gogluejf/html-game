// Task 3.1 — node-based unit tests for the shared one-slot melee input buffer
// (design §17-§18). Run: node js/test/meleeBuffer.test.js
// No DOM needed: hero.js / heroDefs.js are pure modules. Direct-intent pattern:
// call hero.requestMelee(kind) for input and hero.update(DT, intent) for ticks.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60; // fixed step
const NORMAL_SWING_DUR = (h) => h.MELEE_TOTAL_FRAMES * h.MELEE_FRAME_DURATION;
const SPECIAL_SWING_DUR = (h) => h.specialMeleeTotalFrames * Hero.SPECIAL_MELEE_FRAME_DURATION;

// --- Helpers -----------------------------------------------------------------
function makeHero(id = 'scarlet', x = 0, y = 0) {
  const h = new Hero(HEROES[id], x, y);
  h.runStats = { meleeSwings: 0 };
  return h;
}
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, super: false, melee: false });
// Run full update() ticks until a predicate holds or budget runs out.
function runUntil(h, dt, maxTicks, pred) {
  for (let i = 0; i < maxTicks; i++) {
    h.update(dt, noInput());
    if (pred()) return i + 1;
  }
  throw new Error(`runUntil: predicate not met within ${maxTicks} ticks`);
}

console.log('Slot init');
ok('pendingMelee starts empty (null)', () => {
  const h = makeHero();
  assert.equal(h.pendingMelee, null);
});
ok('requestMelee with no attack in progress starts immediately, slot stays empty', () => {
  const h = makeHero();
  h.requestMelee('normal');
  assert.equal(h.meleeActive, true);
  assert.equal(h.pendingMelee, null);
});

console.log('Acceptance #1 — latest-wins replacement, never two queued actions');
ok('Melee then Special before the first attack finishes leaves exactly "special"', () => {
  const h = makeHero();
  h.requestMelee('normal');           // starts the normal swing
  h.requestMelee('normal');           // press 1 mid-swing → buffers 'normal'
  h.requestMelee('special');          // press 2 mid-swing → REPLACES with 'special'
  assert.equal(h.pendingMelee, 'special');
  assert.equal(h.meleeActive, true);  // original swing still running
  assert.equal(h.specialMeleeActive, false);
});
ok('pressing Melee again replaces the buffered special with "normal"', () => {
  const h = makeHero();
  h.requestMelee('normal');
  h.requestMelee('special');          // buffer 'special'
  h.requestMelee('normal');           // replace with 'normal'
  assert.equal(h.pendingMelee, 'normal');
});
ok('mashing many times stores at most one pending action (latest wins)', () => {
  const h = makeHero();
  h.requestMelee('normal');
  for (let i = 0; i < 10; i++) {
    h.requestMelee(i % 2 === 0 ? 'normal' : 'special'); // alternate while swinging
  }
  // Exactly one slot, holding only the LAST valid input (i=9 → odd → 'special').
  assert.equal(h.pendingMelee, 'special');
});
ok('buffering does not start a second concurrent attack', () => {
  const h = makeHero();
  h.requestMelee('normal');
  h.requestMelee('special');
  assert.equal(h.meleeActive, true);
  assert.equal(h.specialMeleeActive, false); // special waits in the slot
});

console.log('Acceptance #4 — normal and special share the same slot');
ok('a normal can be replaced by a special and vice versa', () => {
  const h = makeHero();
  h.requestMelee('normal');
  h.requestMelee('special');
  assert.equal(h.pendingMelee, 'special');
  h.requestMelee('normal');
  assert.equal(h.pendingMelee, 'normal');
  h.requestMelee('special');
  assert.equal(h.pendingMelee, 'special');
});
ok('the SAME slot buffers into a special swing too (shared, not per-kind)', () => {
  const h = makeHero();
  h.requestMelee('special');          // starts the special swing
  h.requestMelee('normal');           // plain Melee during special → 'normal'
  assert.equal(h.pendingMelee, 'normal');
  assert.equal(h.specialMeleeActive, true);
  assert.equal(h.meleeActive, false);
});

console.log('Acceptance #2 — buffering never shortens recovery');
ok('buffered press does not advance the frame clock or cut the swing early', () => {
  const h = makeHero();
  h.requestMelee('normal');
  const dur = NORMAL_SWING_DUR(h);
  h.requestMelee('special');          // buffer mid-swing
  const frameAtBuffer = h.meleeFrame; // frame clock unchanged by buffering
  assert.ok(frameAtBuffer < 1, `frame clock advanced on buffer: ${frameAtBuffer}`);
  // The remaining swing must still take its FULL natural duration from here.
  const ticksToFinish = runUntil(h, DT, Math.ceil(dur / DT), () => !h.meleeActive && h.pendingMelee === null);
  const elapsedAfterBuffer = ticksToFinish * DT;
  const expectedRemaining = dur - frameAtBuffer * h.MELEE_FRAME_DURATION;
  assert.ok(elapsedAfterBuffer >= expectedRemaining - 1e-9,
    `swing ended early: ${elapsedAfterBuffer}s vs ${expectedRemaining}s expected`);
});
ok('frame timing of the first attack is identical to an unbuffered sequence', () => {
  const buffered = makeHero();
  const clean = makeHero();
  buffered.requestMelee('normal');
  clean.requestMelee('normal');
  buffered.requestMelee('special');   // buffer mid-swing (no re-press needed)
  let tB = 0, tC = 0;
  // Track when the FIRST (normal) swing ends for each hero.
  while (buffered.meleeActive) { buffered.update(DT, noInput()); tB++; }
  while (clean.meleeActive) { clean.update(DT, noInput()); tC++; }
  // The FIRST swing ended on the same tick whether or not a press landed.
  assert.equal(tB, tC, `first swing: buffered=${tB} ticks vs clean=${tC} ticks`);
});
ok('buffered normal cannot shorten the current special swing', () => {
  const h = makeHero();
  h.requestMelee('special');
  h.requestMelee('normal');           // buffer 'normal' during special windup
  const dur = SPECIAL_SWING_DUR(h);
  const ticksToFinish = runUntil(h, DT, Math.ceil(dur / DT) + 5, () => !h.specialMeleeActive);
  assert.ok(ticksToFinish * DT >= dur - Hero.SPECIAL_MELEE_FRAME_DURATION - 1e-9,
    `special ended early at ${ticksToFinish} ticks`);
});

console.log('Acceptance #3 — buffered action fires automatically after natural recovery');
ok('after natural recovery the buffered special fires without re-pressing', () => {
  const h = makeHero();
  h.requestMelee('normal');
  h.requestMelee('special');          // buffer 'special'
  runUntil(h, DT, 240, () => !h.meleeActive);
  // No further input at all — the special must have started on its own.
  assert.equal(h.specialMeleeActive, true);
  assert.equal(h.specialMeleePhase, 'windup');
  assert.equal(h.pendingMelee, null); // slot consumed
});
ok('after natural recovery the buffered normal fires without re-pressing', () => {
  const h = makeHero();
  h.requestMelee('special');
  h.requestMelee('normal');           // buffer 'normal'
  runUntil(h, DT, 240, () => !h.specialMeleeActive);
  assert.equal(h.meleeActive, true);
  assert.equal(h.pendingMelee, null);
});
ok('normal→normal buffer auto-fires after natural recovery (cooldown float dust)', () => {
  // Regression: the cooldown decrement can leave a ~1e-16 positive float when
  // the last tick overshoots the boundary. tryMelee()'s `meleeCooldown > 0`
  // guard would then silently reject the buffered 'normal' attack.
  const h = makeHero();
  h.requestMelee('normal');           // start first swing
  h.requestMelee('normal');           // buffer 'normal' mid-swing
  assert.equal(h.pendingMelee, 'normal', 'buffered before the loop');
  // Run until the FIRST swing completes and the buffered one fires.
  // The buffered swing starts on the same tick the old one ends, so we detect
  // it by watching meleeFrame reset to ~0 while meleeActive stays true.
  let sawReset = false;
  for (let i = 0; i < 240; i++) {
    h.update(DT, noInput());
    if (h.meleeActive && h.meleeFrame < 0.5 && i > 5) {
      sawReset = true; break;
    }
  }
  assert.ok(sawReset, 'buffered normal did not fire after natural recovery');
  assert.equal(h.pendingMelee, null, 'slot cleared after firing');
});
ok('the buffered action only starts AFTER the full swing has elapsed (not during recovery)', () => {
  const h = makeHero();
  h.requestMelee('normal');
  h.requestMelee('special');
  // Step through the swing; the special must NOT start while meleeActive is true.
  for (let i = 0; i < 240 && h.meleeActive; i++) {
    assert.equal(h.specialMeleeActive, false, `special started DURING the swing (tick ${i})`);
    h.update(DT, noInput());
  }
  // On the tick the normal swing completes, the buffered special fires — that's
  // "after natural recovery", not before it.
  assert.equal(h.specialMeleeActive, true, 'special should fire on the completion tick');
});
ok('chained: each buffered action itself accepts a new buffer (latest wins across the chain)', () => {
  const h = makeHero();
  h.requestMelee('normal');
  h.requestMelee('special');          // buffer 'special' for after swing 1
  runUntil(h, DT, 240, () => !h.meleeActive);
  assert.equal(h.specialMeleeActive, true);
  h.requestMelee('normal');           // buffer 'normal' for after swing 2
  assert.equal(h.pendingMelee, 'normal');
  runUntil(h, DT, 240, () => !h.specialMeleeActive);
  assert.equal(h.meleeActive, true);  // swing 2 fired automatically
  assert.equal(h.pendingMelee, null);
});

console.log('\nWiring (kind resolution contract from systems/update.js)');
ok('Down+Melee resolves to "special", plain Melee to "normal"', () => {
  // Mirrors the single decision in systems/update.js:
  //   hero.requestMelee(input.down ? 'special' : 'normal')
  const h = makeHero();
  h.requestMelee(true ? 'special' : 'normal');   // input.down = true
  assert.equal(h.specialMeleeActive, true);
  const h2 = makeHero();
  h2.requestMelee(false ? 'special' : 'normal'); // input.down = false
  assert.equal(h2.meleeActive, true);
});

console.log(`\n${passed} assertions passed.`);
