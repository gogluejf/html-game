// Task 7.3 — Full Level 1 flow integration tests (headless).
// Run: node --test petal-panic/js/test/levelFlow.test.js
//
// Simulates a full Level 1 run end-to-end against the real engine modules
// (lifecycle.js, systems/update.js, level.js, macros.js, bossZone.js):
//   Group 1 — Determinism: same seed → identical terrain + population;
//             different seeds → different worlds.
//   Group 2 — Full Level 1 flow: startGame → areas 1..4 (incl. vertical)
//             → boss zone → reward → next-level / end-of-game.
//   Group 3 — Death & continue: death in area 3 restarts the SAME area with
//             the SAME arrangement; continue lands the hero at area 1 with
//             restored lives.
//   Group 4 — Vertical fall death: falling below the bottom platform is
//             lethal; a restart places the hero back on the bottom platform.
//   Group 5 — Boss zone flow: APPROACH → LOCKED → INTRO_SWEEP → BAR_FILL →
//             BOSS_ENTER → COMBAT; boss invisible until BOSS_ENTER; the hero
//             cannot damage the boss before COMBAT.
//
// Only the test file is added — no source files are modified.

import { strict as assert } from 'node:assert';
import { test, before } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing the engine modules) --------
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, addEventListener: noop }),
};
globalThis.window = { addEventListener: noop, __selectedHero: 'scarlet' };

const L = await import('../lifecycle.js');
const { S, getState, setState, tryTransition } = await import('../state.js');
const { LEVELS, buildLevelZones, buildAllZoneTerrain, ZONE_ENTRY_X, ZONE_GROUND_Y } = await import('../level.js');
const { createRng } = await import('../terrain.js');
const { populateArea, populationSnapshot, composeArea } = await import('../macros.js');
const { getLevelConfig, getStageBudget } = await import('../levelConfigs.js');
const { Hero } = await import('../hero.js');
const { HEROES } = await import('../heroDefs.js');
const { createStats } = await import('../stats.js');
const { GAME_RULES } = await import('../gameRules.js');
const U = await import('../systems/update.js');
const {
  makeBossZone, BZ_APPROACH, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT,
} = await import('../bossZone.js');
const { makeElephant } = await import('../boss.js');

// --- Constants (from TUNING via the runtime) ---------------------------------
const DT = 1 / 60;
const BANNER_STEPS = Math.ceil(1.2 / DT);   // TUNING.clearBanner
const FADE_OUT_STEPS = Math.ceil(0.6 / DT); // TUNING.clearFadeOut
const FADE_IN_STEPS = Math.ceil(0.6 / DT);  // TUNING.clearFadeIn
const LEVEL_DEF = LEVELS[0];
const AREA_BOSS = 5; // zone-model currentArea value for the boss zone (levelZones[4])

// --- Helpers -----------------------------------------------------------------

/** Fresh post-startGame-shaped hero (lives, continue pool, stats, area 1). */
function makeTestHero() {
  const h = new Hero(HEROES.scarlet, 100, 400);
  h.lives = GAME_RULES.startingLives;
  h.continues = { remaining: GAME_RULES.startingContinues };
  Object.defineProperty(h, 'continuesUsed', {
    get() { return GAME_RULES.startingContinues - h.continues.remaining; },
    set(n) { h.continues.remaining = GAME_RULES.startingContinues - n; },
    configurable: true,
  });
  h.currentLevel = 1;
  h.currentArea = 1;
  h.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y - h.h };
  h.runStats = createStats();
  return h;
}

/**
 * Minimal area context with stub entities, each carrying an _initPos so
 * restoreArea() (lifecycle.js) can replay the arrangement.
 */
function makeAreaContext() {
  const enemy = {
    x: 2000, y: 450, vx: 0, vy: 0,
    hp: 40, maxHp: 40, alive: true, aiState: 'idle',
    fading: false, hitFlash: 0, hitstunTimer: 0,
    _initPos: { x: 2000, y: 450, aiState: 'idle' },
    timers: { map: new Map() },
  };
  const barrel = {
    x: 3000, y: 460, hp: 60, maxHp: 60,
    alive: true, destroyed: false, hitFlash: 0,
    _initPos: { x: 3000, y: 460 },
    timers: { map: new Map() },
  };
  return {
    enemies: [enemy],
    boss: null,
    barrels: [barrel],
    powerups: [],
    checkpoints: [],
    projectiles: { activeItems: [], active: [] },
    coins: { activeItems: [], active: [] },
    particles: { reset: () => {} },
    effects: { reset: () => {} },
    _enemy: enemy,
    _barrel: barrel,
  };
}

/**
 * Drive the runtime's clear sequence (banner → fadeOut) until the next area's
 * entry screen is showing, then confirm it (AREA_ENTRY → PLAY) and drain the
 * fade-in so the sequence is idle. Returns the confirmed hero.
 */
function advanceToNextArea(nextArea) {
  setState(S.PLAY);
  const clearedId = nextArea === AREA_BOSS ? '1-4' : `1-${nextArea - 1}`;
  U.onExitFlagReached(clearedId, nextArea);
  for (let i = 0; i < BANNER_STEPS + FADE_OUT_STEPS; i++) U.stepClearSequence(DT);
  assert.equal(getState(), S.AREA_ENTRY, 'entry screen is shown after the fade-out');
  assert.equal(U.getHero().currentArea, nextArea, `hero advanced to area ${nextArea}`);
  // Confirm the entry screen: startLife + AREA_ENTRY→PLAY (+ fade-in hook).
  L.areaEntryOnAction('confirm', U.getHero());
  assert.equal(getState(), S.PLAY, 'confirm starts the attempt (PLAY)');
  if (U.getClearSequence().state === 'fadeIn') {
    for (let i = 0; i < FADE_IN_STEPS + 2; i++) U.stepClearSequence(DT);
  }
  return U.getHero();
}

/** Ensure the clear sequence is fully drained (idle, no pending fade-in). */
function drainClearSequence() {
  const seq = U.getClearSequence();
  if (seq.state !== 'idle') {
    for (let i = 0; i < BANNER_STEPS + FADE_OUT_STEPS + FADE_IN_STEPS + 10; i++) U.stepClearSequence(DT);
  }
  if (U.getClearSequence().pendingFadeIn) {
    U.beginClearFadeIn();
    for (let i = 0; i < FADE_IN_STEPS + 10; i++) U.stepClearSequence(DT);
  }
}

/** Put the runtime back at a clean "playing area 1" baseline. */
function resetRuntimeToAreaOne() {
  drainClearSequence();
  const hero = U.getHero();
  hero.currentArea = 1;
  hero.lives = GAME_RULES.startingLives;
  hero.dying = false;
  hero.alive = true;
  hero.energy = hero.maxEnergy;
  hero.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y - hero.h };
  hero.x = ZONE_ENTRY_X;
  hero.y = ZONE_GROUND_Y - hero.h;
  setState(S.PLAY);
}

// =============================================================================
// Group 1 — Determinism
// =============================================================================

test('determinism: same seed produces identical zone terrain', () => {
  const a = buildAllZoneTerrain(LEVEL_DEF, 1234);
  const b = buildAllZoneTerrain(LEVEL_DEF, 1234);
  assert.deepEqual([...a.keys()], [...b.keys()], 'same areas are composed');
  for (const areaIdx of a.keys()) {
    assert.deepEqual(a.get(areaIdx), b.get(areaIdx),
      `area ${areaIdx}: terrain layout is identical for the same seed`);
  }
});

test('determinism: same seed produces identical population', () => {
  const config = getLevelConfig(1);
  function populationFor(seed) {
    const terrain = buildAllZoneTerrain(LEVEL_DEF, seed);
    const zones = buildLevelZones(LEVEL_DEF);
    const rng = createRng(seed); // same stream order as buildWorld (update.js)
    const pops = new Map();
    for (const zone of zones) {
      if (zone.kind !== 'area') continue;
      const stageBudget = getStageBudget(config, zone.areaIdx);
      const pop = populateArea(rng, terrain.get(zone.areaIdx), {
        enemies: stageBudget.enemies ?? {},
        powerups: stageBudget.powerups ?? {},
        powerupWeights: config.powerupWeights,
        barrels: stageBudget.barrels ?? {},
      });
      pops.set(zone.areaIdx, populationSnapshot(pop));
    }
    return pops;
  }
  const a = populationFor(1234);
  const b = populationFor(1234);
  for (const areaIdx of a.keys()) {
    assert.deepEqual(a.get(areaIdx), b.get(areaIdx),
      `area ${areaIdx}: population snapshot is identical for the same seed`);
  }
});

test('determinism: different seeds produce different worlds', () => {
  const t1 = buildAllZoneTerrain(LEVEL_DEF, 1);
  const t2 = buildAllZoneTerrain(LEVEL_DEF, 2);
  let terrainDiffers = false;
  for (const areaIdx of t1.keys()) {
    try {
      assert.deepEqual(t1.get(areaIdx), t2.get(areaIdx));
    } catch {
      terrainDiffers = true;
      break;
    }
  }
  assert.ok(terrainDiffers, 'at least one area\'s terrain differs between seeds 1 and 2');

  // Population differs too (fresh RNG stream per seed, mirroring buildWorld).
  const config = getLevelConfig(1);
  function populationFor(seed) {
    const terrain = buildAllZoneTerrain(LEVEL_DEF, seed);
    const zones = buildLevelZones(LEVEL_DEF);
    const rng = createRng(seed);
    const pops = new Map();
    for (const zone of zones) {
      if (zone.kind !== 'area') continue;
      const stageBudget = getStageBudget(config, zone.areaIdx);
      const pop = populateArea(rng, terrain.get(zone.areaIdx), {
        enemies: stageBudget.enemies ?? {},
        powerups: stageBudget.powerups ?? {},
        powerupWeights: config.powerupWeights,
        barrels: stageBudget.barrels ?? {},
      });
      pops.set(zone.areaIdx, populationSnapshot(pop));
    }
    return pops;
  }
  const p1 = populationFor(1);
  const p2 = populationFor(2);
  let popDiffers = false;
  for (const areaIdx of p1.keys()) {
    try {
      assert.deepEqual(p1.get(areaIdx), p2.get(areaIdx));
    } catch {
      popDiffers = true;
      break;
    }
  }
  assert.ok(popDiffers, 'at least one area\'s population differs between seeds 1 and 2');
});

// =============================================================================
// Group 2 — Full Level 1 flow (simulated)
// =============================================================================

before(() => {
  // Ensure a clean baseline before the flow tests run.
  drainClearSequence();
});

test('full flow: startGame puts the hero in area 1 with the first zone installed', () => {
  resetRuntimeToAreaOne();
  const hero = U.getHero();
  assert.equal(hero.currentArea, 1, 'hero starts in area 1');
  assert.equal(hero.currentLevel, 1, 'hero starts in level 1');
  const zone = U.getActiveZone(hero);
  assert.equal(zone.areaIdx, 1, 'area 1 is the active zone');
  assert.equal(zone.kind, 'area', 'the active zone is an ordinary area');
  assert.ok(U.getSolids().length > 0, 'area 1 has installed solids (terrain)');
});

test('full flow: 1 → 2 → 3 → 4 → boss, each zone installs its content', () => {
  resetRuntimeToAreaOne();
  const hero = U.getHero();

  // Area 1 → 2 (horizontal).
  advanceToNextArea(2);
  assert.equal(U.getActiveZone(hero).areaIdx, 2, 'area 2 is active');
  assert.ok(U.getSolids().length > 0, 'area 2 has installed solids');
  assert.ok(U.getRealEnemies().length > 0, 'area 2 has populated enemies (budget 2)');

  // Area 2 → 3 (the vertical climb).
  advanceToNextArea(3);
  const z3 = U.getActiveZone(hero);
  assert.equal(z3.areaIdx, 3, 'area 3 is active');
  assert.equal(z3.orientation, 'vertical', 'area 3 is the vertical climb (Level 1)');
  assert.ok(U.getSolids().length > 0, 'area 3 has installed solids (composed climb)');
  assert.ok(U.getRealEnemies().length > 0, 'area 3 has populated enemies (budget 3)');

  // Area 3 → 4 (horizontal).
  advanceToNextArea(4);
  assert.equal(U.getActiveZone(hero).areaIdx, 4, 'area 4 is active');
  assert.ok(U.getSolids().length > 0, 'area 4 has installed solids');
  assert.ok(U.getRealEnemies().length > 0, 'area 4 has populated enemies (budget 4)');

  // Area 4 → boss zone (the 4 exit is the boss checkpoint).
  advanceToNextArea(AREA_BOSS);
  const zb = U.getActiveZone(hero);
  assert.equal(zb.kind, 'boss', 'the boss zone is active after the 4 exit');
  assert.ok(U.getSolids().length > 0, 'the boss zone has installed solids (its floor)');
  // The boss zone is a self-contained arena: no composed population, but the
  // boss entity is the content. The boss zone's entry flag (boss checkpoint)
  // is installed as a checkpoint.
  assert.ok(U.getCheckpoints().length > 0, 'the boss zone installs its boss checkpoint');
});

test('full flow: boss defeat → reward → next level starts at area 1', () => {
  // Clean reward state + a fresh hero with a known tally.
  L._resetRewardForTest();
  setState(S.PLAY);
  const h = makeTestHero();
  h.runStats.bossKilled = true;
  h.runStats.enemiesKilled.jester = 5;
  h.runStats.coinsCollected.total = 2500;
  L.bindAreaContext(h, makeAreaContext());

  const before = h.continues.remaining;
  const data = L.showLevelReward(h);
  assert.equal(getState(), S.REWARD, 'the reward screen is shown after the boss defeat');
  assert.equal(data.kills, 5, 'kills are presented');
  assert.equal(data.coins, 2500, 'coins are presented');
  assert.equal(data.continuesEarned, 2, '2500 coins earn 2 continues');
  assert.equal(h.continues.remaining, before + 2, 'the global pool is credited');

  // The current build ships a single level (LEVELS.length === 1), so level 1
  // is the final level. Temporarily extend LEVELS to simulate a multi-level
  // build so the next-level path is exercised.
  const savedLen = LEVELS.length;
  LEVELS.push({ name: 'Second Level' });
  try {
    L._advanceRewardDwellForTest();
    L.rewardOnAction('confirm', h);
  } finally {
    LEVELS.length = savedLen;
  }
  assert.equal(getState(), S.AREA_ENTRY, 'the next level opens on the shared entry screen');
  assert.equal(h.currentLevel, 2, 'the level advanced to 2');
  assert.equal(h.currentArea, 1, 'the next level starts at area 1');
  assert.equal(h.runStats.coinsCollected.total, 0, 'the per-level coin tally is reset');
});

test('full flow: boss defeat on the FINAL level → end-of-game (no next level)', () => {
  L._resetRewardForTest();
  setState(S.PLAY);
  const h = makeTestHero();
  h.currentLevel = LEVELS.length; // the final level
  h.runStats.bossKilled = true;
  h.runStats.coinsCollected.total = 1000;

  const data = L.showLevelReward(h);
  assert.equal(data.isFinalLevel, true, 'the reward screen knows this is the final level');

  L._advanceRewardDwellForTest();
  L.rewardOnAction('confirm', h);

  assert.equal(h.currentLevel, LEVELS.length, 'the level did NOT advance past the final one');
  assert.equal(getState(), S.END_OF_GAME, 'the end-of-game screen appears (not a next level)');
});

// =============================================================================
// Group 3 — Death & continue
// =============================================================================

test('death in area 3: the same area restarts with the SAME arrangement', () => {
  const h = makeTestHero();
  h.lives = 3;
  const ctx = makeAreaContext();
  // The area's preserved arrangement (what restoreArea replays).
  const entryX = ZONE_ENTRY_X;
  const enemyInitX = ctx._enemy._initPos.x;

  // Simulate a failed attempt in area 3: the hero walked to the middle of the
  // area, the enemy moved and took damage, the barrel was destroyed.
  h.currentArea = 3;
  h.x = 2500;
  h.y = 460;
  h.checkpoint = { x: entryX, y: ZONE_GROUND_Y - h.h }; // area entry flag position
  h.lives -= 1; // the death consumed one life
  ctx._enemy.x = 3200;
  ctx._enemy.hp = 10;
  ctx._enemy.aiState = 'chase';
  ctx._barrel.hp = 0;
  ctx._barrel.alive = false;
  ctx._barrel.destroyed = true;

  // A death restart of the SAME area: startLife restores the arrangement and
  // places the hero at the area's entry.
  setState(S.PLAY);
  L.startLife(h, ctx);

  assert.equal(h.currentArea, 3, 'the hero is still in area 3 (same area)');
  assert.equal(h.x, entryX, 'the hero is at the area 3 entry flag');
  assert.equal(h.y, ZONE_GROUND_Y - h.h, 'the hero is at the entry flag\'s ground level');
  assert.equal(ctx._enemy.x, enemyInitX, 'the enemy is back at its original position');
  assert.equal(ctx._enemy.hp, 40, 'the enemy\'s HP is restored');
  assert.equal(ctx._enemy.aiState, 'idle', 'the enemy\'s AI is reset');
  assert.equal(ctx._barrel.hp, 60, 'the destroyed barrel is restored');
  assert.equal(ctx._barrel.alive, true, 'the destroyed barrel is alive again');
  assert.equal(h.lives, 2, 'lives are decremented by the death, not by startLife');
  assert.ok(h.intangible, 'respawn i-frames are active at the entry');
});

test('continue: lands the hero at area 1 with lives restored', () => {
  const h = makeTestHero();
  h.lives = 0; // game over
  h.currentArea = 3; // died deep in the level (area 3)
  h.x = 3000;
  h.y = 460;
  h.checkpoint = { x: 3000, y: 460 }; // the death spot
  const ctx = makeAreaContext();

  setState(S.OVER);
  const applied = L.continueRun(h, ctx);

  assert.equal(applied, true, 'the continue was applied');
  assert.equal(h.lives, GAME_RULES.startingLives, 'lives restored to the starting count');
  assert.equal(h.currentArea, 1, 'the hero returns to area 1 of the CURRENT level');
  assert.equal(h.continues.remaining, GAME_RULES.startingContinues - 1, 'exactly one continue spent');
  assert.equal(getState(), S.AREA_ENTRY, 'continue shows the shared area-entry screen');

  // Confirming the entry screen starts the fresh attempt at area 1's entry.
  L.areaEntryOnAction('confirm', h, ctx);
  assert.equal(getState(), S.PLAY, 'confirm starts the fresh attempt');
  assert.equal(h.x, ZONE_ENTRY_X, 'the hero is at area 1\'s entry (not the death spot)');
  assert.ok(h.intangible, 'respawn i-frames are active after the continue');
});

// =============================================================================
// Group 4 — Vertical fall death
// =============================================================================

test('vertical fall: a hero below the bottom platform is lethal; on the platform is safe', () => {
  const zones = buildLevelZones(LEVEL_DEF);
  const vzone = zones.find((z) => z.kind === 'area' && z.orientation === 'vertical');
  assert.ok(vzone, 'Level 1 has a vertical zone');
  const bottom = vzone.bounds.y + vzone.bounds.h; // bottom platform top surface

  const h = makeTestHero();
  // Hero standing ON the bottom platform: feet exactly AT the platform top.
  h.x = vzone.bounds.x + ZONE_ENTRY_X;
  h.y = bottom - h.h;
  assert.equal(U.isBelowVerticalBottom(h, vzone), false,
    'a hero standing on the bottom platform is NOT below it (safe start)');

  // Hero fallen into the emptiness: feet strictly below the platform top.
  h.y = bottom + 5;
  assert.equal(U.isBelowVerticalBottom(h, vzone), true,
    'a hero whose feet dropped below the bottom platform IS below it (lethal)');

  // Non-vertical zones are never lethal-bottom.
  const hz = zones.find((z) => z.kind === 'area' && z.orientation === 'horizontal');
  h.y = 99999;
  assert.equal(U.isBelowVerticalBottom(h, hz), false,
    'the lethal-bottom rule never fires in a horizontal zone');
});

test('vertical fall: a restart places the hero back on the bottom platform', () => {
  const zones = buildLevelZones(LEVEL_DEF);
  const vzone = zones.find((z) => z.kind === 'area' && z.orientation === 'vertical');
  const bottom = vzone.bounds.y + vzone.bounds.h;

  const h = makeTestHero();
  h.lives = 3;
  const ctx = makeAreaContext();
  // The hero died in the bottom emptiness; the death consumed a life. The
  // area's entry flag sits on the bottom supporting platform, so its
  // checkpoint position is the bottom platform top.
  h.currentArea = vzone.areaIdx;
  h.lives -= 1;
  h.checkpoint = { x: vzone.bounds.x + ZONE_ENTRY_X, y: bottom - h.h };
  h.y = bottom + 40; // fell into the emptiness

  setState(S.PLAY);
  L.startLife(h, ctx);

  // startLife respawns the hero at its checkpoint (the entry flag on the
  // bottom platform), so the hero is back ON the platform — not in the
  // lethal emptiness.
  const feet = h.y + h.h;
  assert.equal(feet, bottom, 'the restarted hero\'s feet are back on the bottom platform top');
  assert.equal(U.isBelowVerticalBottom(h, vzone), false,
    'the restarted hero is not in the lethal emptiness');
});

// =============================================================================
// Group 5 — Boss zone flow
// =============================================================================

/** Drive the machine from its current state to the NEXT state. */
function advanceOne(m, hero, dt = DT, maxSteps = 600) {
  let steps = 0;
  const prev = m.state;
  while (m.state === prev && steps < maxSteps) {
    m.update(dt, hero);
    steps++;
  }
  return steps;
}

function bzFixture() {
  const zones = buildLevelZones(LEVEL_DEF);
  const zone = zones.find((z) => z.kind === 'boss');
  const boss = makeElephant(0, ZONE_GROUND_Y);
  return { zone, boss };
}
const heroAt = (x) => ({ x, y: 460, w: 32, h: 40 });

test('boss flow: states transition in the documented order', () => {
  const { zone, boss } = bzFixture();
  let lockCalls = 0, combatCalls = 0;
  const m = makeBossZone(zone, boss, {
    onLock: () => { lockCalls++; },
    onCombat: () => { combatCalls++; },
  });
  m.begin();
  assert.equal(m.state, BZ_APPROACH, 'the flow starts in APPROACH');

  const seen = [BZ_APPROACH];
  advanceOne(m, heroAt(m.arenaEntryX - 1)); // APPROACH → LOCKED (hero reaches the arena entry)
  if (m.state !== seen[seen.length - 1]) seen.push(m.state);
  while (m.state !== BZ_COMBAT) {
    advanceOne(m, heroAt(m.arenaEntryX));
    if (m.state !== seen[seen.length - 1]) seen.push(m.state);
  }
  const expected = [BZ_APPROACH, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT];
  for (let i = 0; i < seen.length; i++) {
    assert.equal(seen[i], expected[i], `state ${i} is ${seen[i]}, expected ${expected[i]}`);
  }
  assert.equal(seen.length, expected.length, 'every documented state is visited in order');
  assert.equal(m.state, BZ_COMBAT, 'the flow reaches COMBAT');
  assert.equal(lockCalls, 1, 'onLock fires exactly once (at LOCKED)');
  assert.equal(combatCalls, 1, 'onCombat fires exactly once (at COMBAT)');
});

test('boss flow: the boss is invisible until BOSS_ENTER', () => {
  const { zone, boss } = bzFixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  // Invisible through the entire intro (APPROACH..BAR_FILL).
  for (const s of [BZ_APPROACH, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL]) {
    if (m.state !== s) advanceOne(m, heroAt(m.arenaEntryX - 1));
    assert.equal(m.state, s, `reached ${s}`);
    assert.equal(m.bossVisible(), false, `the boss is invisible during ${s}`);
  }
  // Visible once the boss enters (BOSS_ENTER).
  advanceOne(m, heroAt(m.arenaEntryX)); // → BOSS_ENTER
  assert.equal(m.state, BZ_BOSS_ENTER);
  assert.equal(m.bossVisible(), true, 'the boss is visible once it enters');
  // And still visible in COMBAT.
  advanceOne(m, heroAt(m.arenaEntryX)); // → COMBAT
  assert.equal(m.state, BZ_COMBAT);
  assert.equal(m.bossVisible(), true, 'the boss stays visible in COMBAT');
});

test('boss flow: the hero cannot damage the boss before COMBAT', () => {
  const { zone, boss } = bzFixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  // Untouchable + unshooter throughout the intro.
  for (const s of [BZ_APPROACH, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER]) {
    if (m.state !== s) advanceOne(m, heroAt(m.arenaEntryX - 1));
    assert.equal(m.state, s, `reached ${s}`);
    assert.equal(m.bossCanTakeDamage(), false, `the boss cannot take damage during ${s}`);
    assert.equal(m.heroCanShoot(), false, `the hero cannot shoot during ${s}`);
  }
  // Attackable only in COMBAT.
  advanceOne(m, heroAt(m.arenaEntryX)); // → COMBAT
  assert.equal(m.state, BZ_COMBAT);
  assert.equal(m.bossCanTakeDamage(), true, 'the boss can take damage in COMBAT');
  assert.equal(m.heroCanShoot(), true, 'the hero can shoot in COMBAT');
});

test('boss flow: death during the boss zone restarts the flow at APPROACH', () => {
  const { zone, boss } = bzFixture();
  const m = makeBossZone(zone, boss);
  m.begin();
  advanceOne(m, heroAt(m.arenaEntryX - 1)); // → LOCKED
  assert.equal(m.state, BZ_LOCKED);
  // A death during the intro restarts the boss zone at its checkpoint:
  // the approach and the introduction repeat.
  m.reset();
  assert.equal(m.state, BZ_APPROACH, 'after reset the flow is back in APPROACH');
  assert.equal(m.bossVisible(), false, 'the boss is invisible again after reset');
  assert.equal(m.bossCanTakeDamage(), false, 'the boss is untouchable again after reset');
});
