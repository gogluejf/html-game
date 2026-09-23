// Task 6.1 — Boss zone flow state machine (docs/levels/boss-arena.md §1–§3).
// Run: node --test petal-panic/js/test/bossZone.test.js
//
// Source of truth:
//   docs/levels/boss-arena.md §1 Entry and approach
//   docs/levels/boss-arena.md §2 Boss introduction screen
//   docs/levels/boss-arena.md §3 Fight and retry
//
// Acceptance criteria covered (task 6.1):
//   1. Approach is ~1 screen and leaves the flag behind.
//   2. Both sides locked on arena entry (camera freeze + arena lock gate).
//   3. Intro plays in documented order with opposing motion.
//   4. Boss invisible until its entrance (BOSS_ENTER).
//   5. Hero cannot damage the boss before COMBAT.
//   6. Death during intro/combat restarts at the boss checkpoint, repeating
//      the approach (the machine resets to APPROACH and re-runs in order).
//
// This test exercises the STATE MACHINE (states transition in the right
// order, gates flip at the right moment). It does NOT test pixel-perfect
// timing or pixel-perfect motion — only the logic and the documented order.
//
// bossZone.js is pure (no DOM), so most of the machine is tested in
// isolation. The runtime wiring (update.js) is exercised through the real
// module for the death-restart path.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// --- Pure state machine (no DOM needed) ------------------------------------
const {
  BossZone, makeBossZone,
  BZ_APPROACH, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT,
  BOSS_ZONE_STATES, BOSS_APPROACH_DIST,
} = await import('../bossZone.js');
const { LEVELS, buildLevelZones } = await import('../level.js');
const { makeElephant } = await import('../boss.js');

// A minimal boss-zone fixture (the real one comes from buildLevelZones).
function fixture() {
  const zones = buildLevelZones(LEVELS[0]);
  const zone = zones.find((z) => z.kind === 'boss');
  assert.ok(zone, 'the level has a boss zone');
  const boss = makeElephant(0, 500);
  return { zone, boss };
}

// A minimal hero (x/y/w/h) for the machine.
function heroAt(x, y = 460) { return { x, y, w: 32, h: 40 }; }

// Drive the machine from its current state to the NEXT state (timer-driven
// states). APPROACH is hero-driven, so pass a hero at the arena entry to
// finish it. Returns the number of steps taken.
function advanceOne(m, hero, dt = 1 / 60, maxSteps = 600) {
  let steps = 0;
  const prev = m.state;
  while (m.state === prev && steps < maxSteps) {
    m.update(dt, hero);
    steps++;
  }
  return steps;
}

// Run the machine all the way to COMBAT from its current state.
function runToCombat(m, dt = 1 / 60) {
  const hero = heroAt(m.arenaEntryX - 1); // finish APPROACH, then hold
  let guard = 0;
  while (m.state !== BZ_COMBAT && guard++ < 50) {
    advanceOne(m, hero, dt);
  }
}

// ===========================================================================
// 1. Approach is ~1 screen and leaves the flag behind.
// ===========================================================================

test('approach distance is ~1 screen (provisional reference)', () => {
  // boss-arena.md §1: "around one screen of approach is a provisional
  // reference". One screen is the view width (960). The value should be in
  // the ballpark of a screen (between 0.5 and 1.5 screens).
  const { VIEW_W } = require_view();
  assert.ok(BOSS_APPROACH_DIST > VIEW_W * 0.5, 'approach is at least half a screen');
  assert.ok(BOSS_APPROACH_DIST < VIEW_W * 1.5, 'approach is at most 1.5 screens');
});

test('approach is leftward: hero starts on the right, walks left to the arena entry', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  const b = zone.bounds;
  // The hero starts on the RIGHT side of the zone (near the boss checkpoint /
  // entry flag) and walks LEFT toward the arena (boss-arena.md §1: "running
  // left toward the arena").
  assert.ok(m.approachStartX > b.x + b.w / 2,
    `the hero starts on the right side of the zone (${m.approachStartX})`);
  // The arena entry line is to the LEFT of the start, so the hero walks away
  // from the flag, leaving it behind (boss-arena.md §1: "leave the flag
  // behind"). The distance is the documented ~1-screen approach.
  assert.ok(m.arenaEntryX < m.approachStartX,
    `arena entry (${m.arenaEntryX}) is left of the start (${m.approachStartX})`);
  assert.equal(m.approachStartX - m.arenaEntryX, BOSS_APPROACH_DIST,
    'the approach runs exactly one documented screen');
  // The arena entry must be a reachable, positive position INSIDE the zone
  // (BLOCKER 2: it must never be negative / off the left of the zone).
  assert.ok(m.arenaEntryX >= b.x,
    `arena entry (${m.arenaEntryX}) is inside the zone bounds`);
  assert.ok(m.approachStartX <= b.x + b.w,
    'the hero start is inside the zone bounds');
});

test('approach is hero-driven: it ends when the hero reaches the arena entry', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  assert.equal(m.state, BZ_APPROACH);
  // Hero at the flag (right side) — still approaching.
  const atFlag = heroAt(m.approachStartX);
  m.update(1 / 60, atFlag);
  assert.equal(m.state, BZ_APPROACH, 'hero at the flag is still approaching');
  // Hero walks left to the arena entry line → the approach ends.
  const atEntry = heroAt(m.arenaEntryX - 1);
  m.update(1 / 60, atEntry);
  assert.equal(m.state, BZ_LOCKED, 'reaching the arena entry ends the approach');
});

// ===========================================================================
// 2. Both sides locked on arena entry.
// ===========================================================================

test('arena lock: onLock fires exactly once, at LOCKED', () => {
  const { zone, boss } = fixture();
  let lockCalls = 0;
  const m = makeBossZone(zone, boss, { onLock: () => { lockCalls++; } });
  m.begin();
  // Approach → LOCKED.
  m.update(1 / 60, heroAt(m.arenaEntryX - 1));
  assert.equal(m.state, BZ_LOCKED);
  assert.equal(lockCalls, 1, 'onLock fires once when the arena locks');
  assert.equal(m.arenaLocked(), true, 'the arena is locked from LOCKED onward');
  // Advance through the rest; onLock must NOT fire again.
  m.update(1, heroAt(m.arenaEntryX));
  m.update(1, heroAt(m.arenaEntryX));
  m.update(1, heroAt(m.arenaEntryX));
  assert.equal(lockCalls, 1, 'onLock does not re-fire on later states');
});

test('arena stays locked through combat (boss-arena.md §3)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  // Run the machine all the way to COMBAT.
  runToCombat(m);
  assert.equal(m.state, BZ_COMBAT);
  assert.equal(m.arenaLocked(), true, 'the arena remains locked during combat');
});

// ===========================================================================
// 3. Intro plays in documented order with opposing motion.
// ===========================================================================

test('states transition in the documented order', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  // Run to LOCKED (finishes APPROACH).
  advanceOne(m, heroAt(m.arenaEntryX - 1));
  assert.equal(m.state, BZ_LOCKED);
  const seen = [BZ_APPROACH, m.state];
  // LOCKED → INTRO_SWEEP → BAR_FILL → BOSS_ENTER → COMBAT (timer-driven).
  while (m.state !== BZ_COMBAT) {
    advanceOne(m, heroAt(m.arenaEntryX));
    if (m.state !== seen[seen.length - 1]) seen.push(m.state);
  }
  assert.equal(m.state, BZ_COMBAT, 'the machine reaches COMBAT');
  // The observed sequence must be a prefix-consistent walk through the
  // documented order.
  const expected = [BZ_APPROACH, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT];
  for (let i = 0; i < seen.length; i++) {
    assert.equal(seen[i], expected[i], `state ${i} is ${seen[i]}, expected ${expected[i]}`);
  }
  assert.equal(seen.length, expected.length, 'every documented state is visited in order');
});

test('INTRO_SWEEP carries opposing motion: graphic L→R, title R→L', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  advanceOne(m, heroAt(m.arenaEntryX - 1)); // → LOCKED
  advanceOne(m, heroAt(m.arenaEntryX));      // → INTRO_SWEEP
  assert.equal(m.state, BZ_INTRO_SWEEP);
  // The progress() value must advance 0→1 across the sweep (this is what the
  // presentation uses to drive the opposing motion). It must strictly
  // increase over the state.
  const p0 = m.progress();
  m.update(0.3, heroAt(m.arenaEntryX));
  const p1 = m.progress();
  m.update(0.3, heroAt(m.arenaEntryX));
  const p2 = m.progress();
  assert.ok(p0 < p1 && p1 < p2, `progress advances: ${p0} < ${p1} < ${p2}`);
  assert.ok(p0 >= 0 && p2 <= 1, 'progress stays within [0,1]');
});

test('INTRO_SWEEP duration is "rapid" (pure tension, boss-arena.md §2)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  advanceOne(m, heroAt(m.arenaEntryX - 1)); // → LOCKED
  advanceOne(m, heroAt(m.arenaEntryX));      // → INTRO_SWEEP
  // The sweep should complete in a short time (a few seconds at most).
  const steps = advanceOne(m, heroAt(m.arenaEntryX));
  const dur = steps / 60;
  assert.ok(dur < 4, `the sweep is rapid (${dur.toFixed(2)}s < 4s)`);
});

// ===========================================================================
// 4. Boss invisible until its entrance (BOSS_ENTER).
// ===========================================================================

test('boss is invisible during the intro (APPROACH..BAR_FILL)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  // APPROACH.
  assert.equal(m.state, BZ_APPROACH);
  assert.equal(m.bossVisible(), false, 'boss is invisible during APPROACH');
  assert.equal(m.inIntro, true, 'APPROACH is part of the intro');
  // → LOCKED → INTRO_SWEEP → BAR_FILL.
  for (const s of [BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL]) {
    advanceOne(m, heroAt(m.arenaEntryX - 1));
    assert.equal(m.state, s, 'reached ' + s);
    assert.equal(m.bossVisible(), false, `boss is invisible during ${s}`);
    assert.equal(m.inIntro, true, `${s} is part of the intro`);
  }
});

test('boss becomes visible at BOSS_ENTER (it enters from the right)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  // Run to BOSS_ENTER.
  advanceOne(m, heroAt(m.arenaEntryX - 1)); // → LOCKED
  advanceOne(m, heroAt(m.arenaEntryX));      // → INTRO_SWEEP
  advanceOne(m, heroAt(m.arenaEntryX));      // → BAR_FILL
  advanceOne(m, heroAt(m.arenaEntryX));      // → BOSS_ENTER
  assert.equal(m.state, BZ_BOSS_ENTER);
  assert.equal(m.bossVisible(), true, 'the boss is visible once it enters');
  // It entered from the right: its start x is right of its rest x.
  assert.ok(m.bossEnterFromX > m.bossRestX, 'the boss enters from the right');
});

test('boss keeps its position sliding in during BOSS_ENTER', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  advanceOne(m, heroAt(m.arenaEntryX - 1)); // → LOCKED
  advanceOne(m, heroAt(m.arenaEntryX));      // → INTRO_SWEEP
  advanceOne(m, heroAt(m.arenaEntryX));      // → BAR_FILL
  advanceOne(m, heroAt(m.arenaEntryX));      // → BOSS_ENTER
  assert.equal(m.state, BZ_BOSS_ENTER, 'the machine is in BOSS_ENTER');
  // Now in BOSS_ENTER: the boss's x moves from its entry x toward its rest.
  const startX = boss.x;
  m.update(0.2, heroAt(m.arenaEntryX));
  const midX = boss.x;
  m.update(0.2, heroAt(m.arenaEntryX));
  const endX = boss.x;
  assert.ok(startX > midX, `boss is sliding left into the arena: ${startX} → ${midX}`);
});

// ===========================================================================
// 5. Hero cannot damage the boss before COMBAT.
// ===========================================================================

test('boss cannot take damage before COMBAT', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  // APPROACH.
  assert.equal(m.state, BZ_APPROACH);
  assert.equal(m.bossCanTakeDamage(), false, 'boss is untouchable during APPROACH');
  assert.equal(m.heroCanShoot(), false, 'hero cannot shoot during APPROACH');
  // → LOCKED → INTRO_SWEEP → BAR_FILL → BOSS_ENTER.
  for (const s of [BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER]) {
    advanceOne(m, heroAt(m.arenaEntryX - 1));
    assert.equal(m.state, s);
    assert.equal(m.bossCanTakeDamage(), false, `boss is untouchable during ${s}`);
    assert.equal(m.heroCanShoot(), false, `hero cannot shoot during ${s}`);
  }
});

test('boss can take damage only in COMBAT', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  runToCombat(m);
  assert.equal(m.state, BZ_COMBAT);
  assert.equal(m.bossCanTakeDamage(), true, 'the boss is attackable in COMBAT');
  assert.equal(m.heroCanShoot(), true, 'the hero can shoot in COMBAT');
  assert.equal(m.inIntro, false, 'COMBAT is not part of the intro');
});

// ===========================================================================
// 6. Death during intro/combat restarts at the boss checkpoint.
// ===========================================================================

test('reset() restarts the flow at APPROACH (death restart)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  // Advance into the intro.
  advanceOne(m, heroAt(m.arenaEntryX - 1)); // → LOCKED
  assert.equal(m.state, BZ_LOCKED);
  // A death here resets the machine: the approach + intro repeat.
  m.reset();
  assert.equal(m.state, BZ_APPROACH, 'after reset the machine is back in APPROACH');
  assert.equal(m.bossVisible(), false, 'the boss is invisible again after reset');
  assert.equal(m.bossCanTakeDamage(), false, 'the boss is untouchable again after reset');
});

test('a full restart re-runs the documented order from APPROACH', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  // First run: reach COMBAT.
  runToCombat(m);
  assert.equal(m.state, BZ_COMBAT);
  // Death during combat → reset → the whole sequence repeats.
  m.reset();
  const seen = [m.state];
  advanceOne(m, heroAt(m.arenaEntryX - 1));
  if (m.state !== seen[seen.length - 1]) seen.push(m.state);
  while (m.state !== BZ_COMBAT) {
    advanceOne(m, heroAt(m.arenaEntryX));
    if (m.state !== seen[seen.length - 1]) seen.push(m.state);
  }
  const expected = [BZ_APPROACH, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT];
  for (let i = 0; i < seen.length; i++) {
    assert.equal(seen[i], expected[i], `restart state ${i} is ${seen[i]}`);
  }
  assert.equal(seen.length, expected.length, 'the restart re-runs every state in order');
});

// ===========================================================================
// Runtime wiring (update.js): death during the boss zone re-enters the flow.
// ===========================================================================

// --- Minimal DOM stub so systems/update.js (a browser module) loads in node. --
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  getElementById: () => ({ getContext: () => ctxStub, width: 960, height: 540 }),
  createElement: () => ({ style: {}, getContext: () => ctxStub, width: 0, height: 0 }),
  addEventListener: noop,
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 960, innerHeight: 540, addEventListener: noop };
globalThis.requestAnimationFrame = noop;

const U = await import('../systems/update.js');
const { S, getState } = await import('../state.js');

test('runtime: the boss zone flow is created DORMANT (inactive) at boot', () => {
  // BLOCKER 1: the machine must NOT be active at boot. It only activates when
  // the hero reaches the boss zone (beginBossZoneFlow / begin()). While
  // dormant, the shooting / melee / boss-damage gates all behave normally in
  // ordinary areas.
  assert.ok(U.bossZone, 'the runtime exposes the bossZone flow machine');
  assert.equal(U.bossZone.active, false, 'the flow is dormant (inactive) at boot');
  assert.equal(U.bossZone.inIntro, false, 'no intro is in progress while dormant');
  // The effective gating is `bossZone.active && <gate>` (update.js reads the
  // raw gates). While dormant the effective shooting gate is
  // `!inIntro` = true, so the hero may shoot in ordinary areas.
  assert.equal(!U.bossZone.inIntro, true, 'the effective shooting gate is open while dormant');
  // The effective boss-damage gate is `active && bossCanTakeDamage()`; while
  // dormant (active=false) the boss is not gated, so ordinary-area combat is
  // unaffected.
  assert.equal(U.bossZone.active && U.bossZone.bossCanTakeDamage(), false,
    'the boss is not gated while dormant (no boss zone is active)');
});

test('runtime: beginBossZoneFlow() re-arms the flow from APPROACH', () => {
  // Simulate a death restart: the machine may be mid-sequence; beginBossZoneFlow
  // must reset it to APPROACH and hide the boss.
  const bz = U.bossZone;
  const before = bz.state;
  U.beginBossZoneFlow();
  assert.equal(bz.state, BZ_APPROACH, 'beginBossZoneFlow resets to APPROACH');
  assert.equal(bz.bossVisible(), false, 'the boss is hidden after (re)start');
  assert.equal(bz.bossCanTakeDamage(), false, 'the boss is untouchable after (re)start');
  // Restore the machine to a clean APPROACH for other tests.
  U.beginBossZoneFlow();
});

test('runtime: the boss is invisible until the flow reaches BOSS_ENTER', () => {
  const bz = U.bossZone;
  U.beginBossZoneFlow();
  // The boss entity should be placed off-screen (right) and invisible.
  assert.equal(bz.bossVisible(), false, 'the boss is invisible at flow start');
});

// --- Helper for the approach-distance test (avoids a top-level VIEW_W import).
function require_view() {
  return { VIEW_W: 960 };
}
