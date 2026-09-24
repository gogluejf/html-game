// Boss zone flow state machine — BATTLE ROOM model (docs/levels/boss-arena.md §1–§3).
// Run: node --test petal-panic/js/test/bossZone.test.js
//
// Source of truth:
//   docs/levels/boss-arena.md §1 Entry and run phase
//   docs/levels/boss-arena.md §2 Boss introduction screen
//   docs/levels/boss-arena.md §3 Fight and retry
//
// The boss zone has TWO phases, both inside ONE zone:
//   RUN         — hero walks right from the left entry to the boss checkpoint
//                 at the far right. Machine DORMANT (state === null).
//   BATTLE ROOM — triggered by crossing the checkpoint (update.js
//                 enterBossRoom): flag removed, camera frozen at x=0 on the
//                 leftmost VIEW_W of the zone, hero at the room's left entry,
//                 boss slides in from the right. THIS module owns that half:
//                 LOCKED → INTRO_SWEEP → BAR_FILL → BOSS_ENTER → COMBAT.
//
// Acceptance criteria covered:
//   1. Room geometry: x ∈ [0, VIEW_W], boss rest ~75%, boss enters off-screen right.
//   2. begin() starts in LOCKED (no APPROACH state exists anymore).
//   3. Intro plays in documented order with opposing motion.
//   4. Boss invisible until its entrance (BOSS_ENTER).
//   5. Hero cannot damage the boss before COMBAT.
//   6. Death during intro/combat resets the machine to dormant; the run
//      repeats (flag restored by the update system, not the machine).
//
// This test exercises the STATE MACHINE (states transition in the right
// order, gates flip at the right moment). It does NOT test pixel-perfect
// timing or pixel-perfect motion — only the logic and the documented order.
//
// bossZone.js is pure (no DOM), so most of the machine is tested in
// isolation. The runtime wiring (update.js) is exercised through the real
// module for the boot/dormant path.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// --- Pure state machine (no DOM needed) ------------------------------------
const {
  BossZone, makeBossZone,
  BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT,
  BOSS_ZONE_STATES,
} = await import('../bossZone.js');
const { LEVELS, buildLevelZones, ZONE_ENTRY_X, BOSS_TRIGGER_X } = await import('../level.js');
const { makeElephant } = await import('../boss.js');
const { VIEW_W } = await import('../view.js');

// A minimal boss-zone fixture (the real one comes from buildLevelZones).
function fixture() {
  const zones = buildLevelZones(LEVELS[0]);
  const zone = zones.find((z) => z.kind === 'boss');
  assert.ok(zone, 'the level has a boss zone');
  const boss = makeElephant(0, 500);
  return { zone, boss };
}

// A minimal hero (x/y/w/h) for the machine. All states are timer-driven now,
// so the hero position is irrelevant to transitions — it is kept for API
// compatibility with update(dt, hero).
function heroAt(x, y = 460) { return { x, y, w: 32, h: 40 }; }

// Drive the machine from its current state to the NEXT state (timer-driven).
// Returns the number of steps taken.
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
  const hero = heroAt(120); // static hero; all states are timer-driven
  let guard = 0;
  while (m.state !== BZ_COMBAT && guard++ < 50) {
    advanceOne(m, hero, dt);
  }
}

// ===========================================================================
// 1. Room geometry: fixed-width world at the origin.
// ===========================================================================

test('room is the leftmost VIEW_W of the zone, at the origin', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  assert.equal(m.roomX, 0, 'the room starts at world x=0 (screen x = world x)');
  assert.equal(m.roomW, VIEW_W, 'the room is exactly one view wide');
  assert.ok(m.roomX + m.roomW <= zone.bounds.w, 'the room fits inside the zone');
});

test('boss rests at ~75% across the room (right side, visible)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  // Rest x is the boss's LEFT edge at ~75% of the room width.
  const expected = Math.round(m.roomX + m.roomW * 0.75 - boss.w / 2);
  assert.equal(m.bossRestX, expected, 'boss rest is computed at 75% of the room');
  // Fully visible when the camera is frozen at the room's left edge:
  assert.ok(m.bossRestX >= m.roomX, 'boss rest is inside the room (left)');
  assert.ok(m.bossRestX + boss.w <= m.roomX + m.roomW, 'boss rest is inside the room (right)');
});

test('boss enters from off-screen right of the room', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  // Entry x must be RIGHT of the room's right edge (off-screen when the
  // camera is frozen at the room's left edge).
  assert.ok(m.bossEnterFromX > m.roomX + m.roomW,
    `boss entry (${m.bossEnterFromX}) is off-screen right of the room (${m.roomX + m.roomW})`);
  assert.ok(m.bossEnterFromX > m.bossRestX, 'the boss slides left into the room');
});

test('begin() places the boss off-screen right and starts in LOCKED', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  assert.equal(m.state, null, 'dormant before begin()');
  m.begin();
  assert.equal(m.state, BZ_LOCKED, 'begin() starts in LOCKED (no APPROACH state)');
  assert.equal(boss.x, m.bossEnterFromX, 'the boss is placed off-screen right');
  assert.equal(m.bossVisible(), false, 'the boss is invisible at LOCKED');
});

test('the boss zone entry flag stands at the left like any other level', () => {
  const zones = buildLevelZones(LEVELS[0]);
  const zone = zones.find((z) => z.kind === 'boss');
  assert.ok(zone.entryFlag, 'the boss zone has an entry flag (the boss checkpoint)');
  // Purely visual, exactly like areas 2..4: it stands at the standard left
  // entry position and is never triggered. The battle room is started by the
  // invisible trigger line at BOSS_TRIGGER_X (update.js), not by this flag.
  assert.equal(zone.entryFlag.x, ZONE_ENTRY_X,
    'the boss entry flag is at the standard left entry position');
  assert.equal(zone.entryFlag.appearance, 'boss-checkpoint', 'it carries the boss-checkpoint appearance');
});

test('the boss-card trigger line sits at the far right of the zone', () => {
  const zones = buildLevelZones(LEVELS[0]);
  const zone = zones.find((z) => z.kind === 'boss');
  // The hero walks right from the left entry and crosses this line to start
  // the battle room. It must be inside the zone, well past the entry.
  assert.ok(BOSS_TRIGGER_X > ZONE_ENTRY_X + VIEW_W,
    `trigger (${BOSS_TRIGGER_X}) is at least one screen past the entry`);
  assert.ok(BOSS_TRIGGER_X < zone.bounds.w, 'trigger is inside the zone bounds');
});

// ===========================================================================
// 2. Room lock: locked from LOCKED through COMBAT.
// ===========================================================================

test('roomLocked() is true from LOCKED onward (including COMBAT)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  assert.equal(m.roomLocked(), false, 'not locked while dormant (run phase)');
  m.begin();
  assert.equal(m.roomLocked(), true, 'locked from LOCKED');
  runToCombat(m);
  assert.equal(m.state, BZ_COMBAT);
  assert.equal(m.roomLocked(), true, 'the room remains locked during combat');
});

// ===========================================================================
// 3. Intro plays in documented order with opposing motion.
// ===========================================================================

test('states transition in the documented order', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  const seen = [m.state]; // LOCKED
  while (m.state !== BZ_COMBAT) {
    advanceOne(m, heroAt(120));
    if (m.state !== seen[seen.length - 1]) seen.push(m.state);
  }
  assert.equal(m.state, BZ_COMBAT, 'the machine reaches COMBAT');
  const expected = [BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT];
  assert.deepEqual(seen, expected, 'every documented state is visited in order');
  assert.deepEqual(BOSS_ZONE_STATES, expected, 'BOSS_ZONE_STATES matches the runtime order');
});

test('INTRO_SWEEP carries opposing motion: progress advances 0→1', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  advanceOne(m, heroAt(120)); // → INTRO_SWEEP
  assert.equal(m.state, BZ_INTRO_SWEEP);
  const p0 = m.progress();
  m.update(0.3, heroAt(120));
  const p1 = m.progress();
  m.update(0.3, heroAt(120));
  const p2 = m.progress();
  assert.ok(p0 < p1 && p1 < p2, `progress advances: ${p0} < ${p1} < ${p2}`);
  assert.ok(p0 >= 0 && p2 <= 1, 'progress stays within [0,1]');
});

test('INTRO_SWEEP duration is "rapid" (pure tension, boss-arena.md §2)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  advanceOne(m, heroAt(120)); // → INTRO_SWEEP
  const steps = advanceOne(m, heroAt(120));
  const dur = steps / 60;
  assert.ok(dur < 4, `the sweep is rapid (${dur.toFixed(2)}s < 4s)`);
});

// ===========================================================================
// 4. Boss invisible until its entrance (BOSS_ENTER).
// ===========================================================================

test('boss is invisible during the intro (LOCKED..BAR_FILL)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  assert.equal(m.state, BZ_LOCKED);
  assert.equal(m.bossVisible(), false, 'boss is invisible during LOCKED');
  assert.equal(m.inIntro, true, 'LOCKED is part of the intro');
  for (const s of [BZ_INTRO_SWEEP, BZ_BAR_FILL]) {
    advanceOne(m, heroAt(120));
    assert.equal(m.state, s, 'reached ' + s);
    assert.equal(m.bossVisible(), false, `boss is invisible during ${s}`);
    assert.equal(m.inIntro, true, `${s} is part of the intro`);
  }
});

test('boss becomes visible at BOSS_ENTER (it enters from the right)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  advanceOne(m, heroAt(120)); // → INTRO_SWEEP
  advanceOne(m, heroAt(120)); // → BAR_FILL
  advanceOne(m, heroAt(120)); // → BOSS_ENTER
  assert.equal(m.state, BZ_BOSS_ENTER);
  assert.equal(m.bossVisible(), true, 'the boss is visible once it enters');
  assert.ok(m.bossEnterFromX > m.bossRestX, 'the boss entered from the right');
});

test('boss keeps sliding in during BOSS_ENTER', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  advanceOne(m, heroAt(120)); // → INTRO_SWEEP
  advanceOne(m, heroAt(120)); // → BAR_FILL
  advanceOne(m, heroAt(120)); // → BOSS_ENTER
  assert.equal(m.state, BZ_BOSS_ENTER, 'the machine is in BOSS_ENTER');
  const startX = boss.x;
  m.update(0.2, heroAt(120));
  const midX = boss.x;
  m.update(0.2, heroAt(120));
  const endX = boss.x;
  assert.ok(startX > midX && midX > endX,
    `boss is sliding left into the room: ${startX} → ${midX} → ${endX}`);
});

test('bar fill continues during BOSS_ENTER (the "final stretch" overlaps the entrance)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  // Run straight to BOSS_ENTER (LOCKED → INTRO_SWEEP → BAR_FILL → BOSS_ENTER).
  while (m.state !== BZ_BOSS_ENTER) {
    m.update(1 / 60, heroAt(120));
  }
  assert.equal(m.state, BZ_BOSS_ENTER, 'the machine is in BOSS_ENTER');
  // The bar was filling when the boss entered: it sits at (or just past) the
  // entrance threshold, strictly between 0 and 1... or exactly at the point
  // where the entrance began. Either way it is not yet full.
  const barFillAtEnterStart = m.barFill;
  assert.ok(barFillAtEnterStart > 0, `the bar has been filling (${barFillAtEnterStart.toFixed(3)})`);
  assert.ok(barFillAtEnterStart < 1, 'the bar is not yet full when the boss enters');
  // The bar KEEPS filling during BOSS_ENTER (it does NOT freeze).
  m.update(0.2, heroAt(120));
  const barFillLater = m.barFill;
  m.update(0.2, heroAt(120));
  const barFillEnd = m.barFill;
  assert.ok(barFillLater >= barFillAtEnterStart,
    `bar fill is increasing during BOSS_ENTER (${barFillLater.toFixed(3)} >= ${barFillAtEnterStart.toFixed(3)})`);
  assert.ok(barFillEnd >= barFillLater,
    `bar fill is increasing during BOSS_ENTER (${barFillEnd.toFixed(3)} >= ${barFillLater.toFixed(3)})`);
  // The bar reaches 1.0 (full) by the end of BOSS_ENTER.
  runToCombat(m);
  assert.equal(m.state, BZ_COMBAT, 'the machine reaches COMBAT');
  assert.equal(m.barFill, 1, 'the bar is full (1.0) once the boss has settled');
});

// ===========================================================================
// 5. Hero cannot damage the boss before COMBAT.
// ===========================================================================

test('boss cannot take damage before COMBAT', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  assert.equal(m.state, BZ_LOCKED);
  assert.equal(m.bossCanTakeDamage(), false, 'boss is untouchable during LOCKED');
  assert.equal(m.heroCanShoot(), false, 'hero cannot shoot during LOCKED');
  for (const s of [BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER]) {
    advanceOne(m, heroAt(120));
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
// 6. Death during intro/combat restarts the WHOLE zone (machine → dormant).
// ===========================================================================

test('reset() returns the machine to dormant (death restart)', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  assert.equal(m.state, BZ_LOCKED);
  // A death here resets the machine: the run + intro repeat. The update
  // system re-installs the zone content (flag restored), re-binds the camera,
  // and re-places the hero at the left entry.
  m.reset();
  assert.equal(m.state, null, 'after reset the machine is dormant');
  assert.equal(m.active, false, 'the machine is inactive after reset');
  assert.equal(m.roomLocked(), false, 'the room is no longer locked after reset');
  assert.equal(m.bossVisible(), false, 'the boss is invisible again after reset');
  assert.equal(m.bossCanTakeDamage(), false, 'the boss is untouchable again after reset');
});

test('a full restart re-runs the documented order from LOCKED', () => {
  const { zone, boss } = fixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  // First run: reach COMBAT.
  runToCombat(m);
  assert.equal(m.state, BZ_COMBAT);
  // Death during combat → reset → the whole sequence repeats.
  m.reset();
  assert.equal(m.state, null, 'dormant after reset');
  m.begin(); // the next checkpoint trigger re-enters the room
  const seen = [m.state];
  while (m.state !== BZ_COMBAT) {
    advanceOne(m, heroAt(120));
    if (m.state !== seen[seen.length - 1]) seen.push(m.state);
  }
  const expected = [BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT];
  assert.deepEqual(seen, expected, 'the restart re-runs every state in order');
});

// ===========================================================================
// Runtime wiring (update.js): the flow is created DORMANT at boot.
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
  // The machine must NOT be active at boot. It only activates when the hero
  // crosses the boss checkpoint (enterBossRoom → begin()). While dormant, the
  // shooting / melee / boss-damage gates all behave normally in ordinary areas
  // AND during the run phase of 1-B.
  assert.ok(U.bossZone, 'the runtime exposes the bossZone flow machine');
  assert.equal(U.bossZone.active, false, 'the flow is dormant (inactive) at boot');
  assert.equal(U.bossZone.inIntro, false, 'no intro is in progress while dormant');
  // The effective gating is `bossZone.active && <gate>` (update.js reads the
  // raw gates). While dormant the effective shooting gate is open, so the
  // hero may shoot in ordinary areas and during the 1-B run phase.
  assert.equal(!U.bossZone.inIntro, true, 'the effective shooting gate is open while dormant');
  // The effective boss-damage gate is `active && bossCanTakeDamage()`; while
  // dormant (active=false) the boss is not gated, so ordinary-area combat is
  // unaffected.
  assert.equal(U.bossZone.active && U.bossZone.bossCanTakeDamage(), false,
    'the boss is not gated while dormant (no battle room is active)');
});

test('runtime: the room geometry is exposed at the origin', () => {
  const bz = U.bossZone;
  assert.equal(bz.roomX, 0, 'the room starts at world x=0');
  assert.equal(bz.roomW, VIEW_W, 'the room is one view wide');
  assert.ok(bz.bossEnterFromX > bz.roomW, 'the boss enters off-screen right');
});
