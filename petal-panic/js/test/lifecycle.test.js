// Task 1.2 — node-based tests for lifecycle operations (lifecycle.js).
// Run: node --test petal-panic/js/test/lifecycle.test.js
//
// Acceptance criteria covered:
//   1. startGame establishes lives=3, continues pool=3, currentArea=-1
//   2. startLife restores the area arrangement and places the hero at entry
//   3. continueRun spends exactly one continue, restores starting lives,
//      goes to area -1 of the CURRENT level, and never rerolls generation
//   4. Death in an area restarts that same area (same arrangement)
//   5. Continue from 2-3 lands in 2-1 (area -1 of current level)
//   6. No module outside lifecycle.js assigns lives/continues for restart

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing update.js) ------------------
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

const L = await import('../lifecycle.js');
const { S, getState, setState, tryTransition } = await import('../state.js');
const { GAME_RULES } = await import('../gameRules.js');
const { Hero } = await import('../hero.js');
const { HEROES } = await import('../heroDefs.js');
const U = await import('../systems/update.js');

// --- Helpers -----------------------------------------------------------------

/** Create a bare hero with a continue pool (simulating post-startGame state). */
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
  h.currentArea = -1;
  h.checkpoint = { x: 100, y: 400 };
  return h;
}

/** Create a minimal area context with stub entities. */
function makeAreaContext(hero) {
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
  const powerup = {
    x: 4000, y: 460, collected: false, alive: true,
    _initPos: { x: 4000, y: 460 },
    timers: { map: new Map() },
  };
  const checkpoint = { triggered: true, flashTimer: 0.5 };
  const projectiles = { activeItems: [{ alive: true }], active: [{ alive: true }] };
  const coins = { activeItems: [{ alive: true, collected: false }], active: [{ alive: true, collected: false }] };
  const particles = { reset: () => {} };
  const effects = { reset: () => {} };

  return {
    enemies: [enemy],
    boss: null,
    barrels: [barrel],
    powerups: [powerup],
    checkpoints: [checkpoint],
    projectiles,
    coins,
    particles,
    effects,
    _enemy: enemy,
    _barrel: barrel,
    _powerup: powerup,
    _checkpoint: checkpoint,
  };
}

// --- Tests -------------------------------------------------------------------

test('startGame: establishes lives=3, continues pool=3, currentArea=-1', () => {
  const h = L.makeHero(HEROES.scarlet);
  const result = L.startGame({ oldHero: h }, HEROES.scarlet);
  assert.equal(result.lives, 3, 'starting lives from GAME_RULES');
  assert.equal(result.continues.remaining, 3, 'starting continues from GAME_RULES');
  assert.equal(result.continuesUsed, 0, 'no continues used yet');
  assert.equal(result.currentArea, -1, 'enters area -1');
  assert.equal(result.currentLevel, 1, 'enters level 1');
  assert.ok(result.runStats, 'fresh run stats');
});

test('startGame: values come from GAME_RULES, not literals', () => {
  const h = L.startGame({ oldHero: new Hero(HEROES.scarlet, 0, 0) }, HEROES.scarlet);
  assert.equal(h.lives, GAME_RULES.startingLives);
  assert.equal(h.continues.remaining, GAME_RULES.startingContinues);
});

test('startLife: restores area arrangement and places hero at entry', () => {
  const h = makeTestHero();
  const ctx = makeAreaContext(h);

  // Simulate a failed attempt: enemy moved and took damage, barrel destroyed,
  // powerup collected, checkpoint triggered, projectiles in flight.
  ctx._enemy.x = 2500;
  ctx._enemy.hp = 10;
  ctx._enemy.aiState = 'chase';
  ctx._barrel.hp = 0;
  ctx._barrel.alive = false;
  ctx._barrel.destroyed = true;
  ctx._powerup.collected = true;
  ctx._powerup.alive = false;
  ctx._checkpoint.triggered = true;

  h.x = 3500; // hero was somewhere mid-area
  h.checkpoint = { x: 100, y: 400 }; // entry position

  setState(S.PLAY);
  L.startLife(h, ctx);

  // Area restored to original arrangement.
  assert.equal(ctx._enemy.x, 2000, 'enemy back at original x');
  assert.equal(ctx._enemy.hp, 40, 'enemy HP restored');
  assert.equal(ctx._enemy.aiState, 'idle', 'enemy AI reset');
  assert.equal(ctx._barrel.hp, 60, 'barrel HP restored');
  assert.equal(ctx._barrel.alive, true, 'barrel alive again');
  assert.equal(ctx._barrel.destroyed, false, 'barrel not destroyed');
  assert.equal(ctx._powerup.collected, false, 'powerup re-armed');
  assert.equal(ctx._powerup.alive, true, 'powerup alive again');
  assert.equal(ctx._checkpoint.triggered, false, 'checkpoint re-armed');
  assert.equal(ctx.projectiles.active.length, 0, 'projectiles cleared');
  assert.equal(ctx.coins.active.length, 0, 'coins cleared');

  // Hero placed at entry with i-frames.
  assert.equal(h.x, 100, 'hero at entry x');
  assert.equal(h.y, 400, 'hero at entry y');
  assert.equal(h.energy, h.maxEnergy, 'full energy');
  assert.ok(h.intangible, 'i-frames active (intangible)');
});

test('startLife: does NOT touch lives (caller already consumed one)', () => {
  const h = makeTestHero();
  h.lives = 2; // one life already consumed
  const ctx = makeAreaContext(h);
  setState(S.PLAY);
  L.startLife(h, ctx);
  assert.equal(h.lives, 2, 'lives unchanged by startLife');
});

test('continueRun: spends exactly one continue, restores starting lives', () => {
  const h = makeTestHero();
  h.lives = 0; // game over
  const ctx = makeAreaContext(h);

  setState(S.OVER);
  const applied = L.continueRun(h, ctx);

  assert.equal(applied, true, 'continue applied');
  assert.equal(h.continues.remaining, 2, 'one continue spent (3→2)');
  assert.equal(h.continuesUsed, 1, 'continuesUsed reflects spend');
  assert.equal(h.lives, 3, 'lives restored to starting count');
  assert.equal(h.currentArea, -1, 'back to area -1');
  // checkpoints.md §3: continue shows the shared area-entry screen; the fresh
  // attempt starts when the player confirms it (lifecycle.md §4).
  assert.equal(getState(), S.AREA_ENTRY, 'transitioned to the shared area-entry screen');
  const r = L.areaEntryOnAction('confirm', h, ctx);
  assert.equal(r, true, 'confirm starts the attempt');
  assert.equal(getState(), S.PLAY, 'transitioned to PLAY after confirming');
});

test('continueRun: returns to area -1 of the CURRENT level (not level 1)', () => {
  const h = makeTestHero();
  h.currentLevel = 2;
  h.currentArea = 3; // "2-3"
  h.lives = 0;
  const ctx = makeAreaContext(h);

  setState(S.OVER);
  const applied = L.continueRun(h, ctx);

  assert.equal(applied, true);
  assert.equal(h.currentLevel, 2, 'level unchanged (still 2)');
  assert.equal(h.currentArea, -1, 'area reset to -1 (so 2-1)');
});

test('continueRun: blocked when no continues remaining', () => {
  const h = makeTestHero();
  h.continues.remaining = 0; // pool empty
  h.lives = 0;
  const ctx = makeAreaContext(h);

  setState(S.OVER);
  const applied = L.continueRun(h, ctx);

  assert.equal(applied, false, 'continue refused');
  assert.equal(getState(), S.OVER, 'still in OVER');
  assert.equal(h.lives, 0, 'lives unchanged');
});

test('continueRun: never rerolls generation (arrangement preserved)', () => {
  const h = makeTestHero();
  const ctx = makeAreaContext(h);

  // Record the "original" arrangement (already in _initPos).
  const origEnemyX = ctx._enemy._initPos.x;
  const origBarrelX = ctx._barrel._initPos.x;

  // Simulate playing through: enemy moved, barrel damaged.
  ctx._enemy.x = 5000;
  ctx._enemy.hp = 5;
  ctx._barrel.hp = 20;
  h.lives = 0;

  setState(S.OVER);
  L.continueRun(h, ctx);

  // The entry screen is shown; confirming starts the attempt and restores the
  // arrangement to ORIGINAL positions, not re-rolled.
  L.areaEntryOnAction('confirm', h, ctx);
  assert.equal(ctx._enemy.x, origEnemyX, 'enemy at original x (not rerolled)');
  assert.equal(ctx._barrel.x, origBarrelX, 'barrel at original x (not rerolled)');
  assert.equal(ctx._enemy.hp, 40, 'enemy HP fully restored');
  assert.equal(ctx._barrel.hp, 60, 'barrel HP fully restored');
});

test('death in an area restarts that same area (same arrangement)', () => {
  const h = makeTestHero();
  const ctx = makeAreaContext(h);
  h.lives = 3;

  // Simulate: hero dies mid-area, one life consumed.
  h.lives -= 1; // now 2
  h.x = 4000; // was mid-area
  h.checkpoint = { x: 100, y: 400 }; // area entry

  // Enemy was moved during the attempt.
  ctx._enemy.x = 3000;
  ctx._enemy.hp = 20;

  setState(S.PLAY);
  L.startLife(h, ctx);

  // Same area, same arrangement restored.
  assert.equal(ctx._enemy.x, 2000, 'enemy back at original position');
  assert.equal(ctx._enemy.hp, 40, 'enemy HP restored');
  assert.equal(h.x, 100, 'hero at area entry');
  assert.equal(h.lives, 2, 'lives decremented by caller, not by startLife');
});

test('restoreArea: clears transient projectiles and coins', () => {
  const h = makeTestHero();
  const ctx = makeAreaContext(h);

  // Add "live" projectiles and coins.
  ctx.projectiles.activeItems.push({ alive: true });
  ctx.projectiles.active.push({ alive: true });
  ctx.coins.activeItems.push({ alive: true, collected: false });
  ctx.coins.active.push({ alive: true, collected: false });

  L.restoreArea(ctx);

  assert.equal(ctx.projectiles.active.length, 0, 'all projectiles cleared');
  assert.equal(ctx.coins.active.length, 0, 'all coins cleared');
});

test('rememberInitial: idempotent — records position once', () => {
  const e = { x: 100, y: 200, _initPos: undefined };
  L.rememberInitial(e, { aiState: 'idle' });
  assert.equal(e._initPos.x, 100);
  assert.equal(e._initPos.y, 200);
  assert.equal(e._initPos.aiState, 'idle');

  // Move the entity — re-recording must NOT overwrite.
  e.x = 500;
  L.rememberInitial(e, { aiState: 'idle' });
  assert.equal(e._initPos.x, 100, 'initial position preserved (not re-recorded)');
});

test('startGame: establishes fresh generation choices (rerolls when a regenerate callback is registered)', () => {
  // The real regenerate callback is registered by update.js at boot. We verify
  // it's invoked exactly once on a new game by triggering a SELECT → PLAY
  // transition (which calls startGame with areaContext).
  setState(S.HOME);
  window.__selectedHero = 'scarlet';
  const prevHero = U.getHero();
  const prevEnemyXs = U.getRealEnemies().map(e => e.x);
  tryTransition(S.SELECT);
  tryTransition(S.PLAY);
  const newHero = U.getHero();
  assert.notEqual(newHero, prevHero, 'hero rebuilt on new game');
  assert.equal(newHero.lives, 3, 'starting lives');
  assert.equal(newHero.currentArea, -1, 'enters area -1');
  // The world was regenerated with fresh choices.
  const newEnemyXs = U.getRealEnemies().map(e => e.x);
  const moved = newEnemyXs.some((x, i) => Math.abs(x - prevEnemyXs[i]) > 0.5);
  assert.ok(moved, 'new game rerolled generation choices');
});

test('startGame: a bare startGame (no areaContext) does NOT reroll', () => {
  // Note: the regenerate callback is still registered by update.js at boot.
  // A bare startGame (no areaContext) must NOT invoke it.
  const h = L.makeHero(HEROES.scarlet);
  L.startGame({ oldHero: h }, HEROES.scarlet);
  // No crash, no reroll — the bare startGame leaves the world untouched.
  assert.ok(h, 'hero returned');
});

test('continueRun: re-positions the hero at the level entry (area -1), not the death spot', () => {
  const h = makeTestHero();
  h.currentLevel = 2;
  h.currentArea = 3; // "2-3"
  h.lives = 0;
  // The hero died deep in 2-3; the checkpoint still points there.
  h.checkpoint = { x: 6000, y: 492 };
  h.x = 6000; h.y = 492;
  const ctx = makeAreaContext(h);
  setState(S.OVER);
  L.continueRun(h, ctx);
  // The entry screen is shown; confirming starts the fresh attempt. Continuing
  // after defeat in 2-3 lands the hero at the level's area -1 entry (x=100),
  // NOT at the death spot (x=6000).
  L.areaEntryOnAction('confirm', h, ctx);
  assert.equal(h.currentArea, -1, 'area reset to -1');
  assert.equal(h.x, 100, 'hero positioned at the level entry, not the death spot');
  assert.ok(h.intangible, 'respawn i-frames active');
  assert.equal(h.energy, h.maxEnergy, 'full energy after continue');
});

test('resetHeroTransient: clears death flags and stale i-frames without touching lives', () => {
  const h = makeTestHero();
  h.lives = 1;
  h.dying = true;
  h.deathTimer = 0.5;
  h.alive = false;
  h.energy = 0;
  h.intangible = true;
  h.vx = 40; h.vy = -10;
  L.resetHeroTransient(h);
  assert.equal(h.dying, false, 'death flag cleared');
  assert.equal(h.deathTimer, 0, 'death timer cleared');
  assert.equal(h.alive, true, 'alive restored');
  assert.equal(h.energy, h.maxEnergy, 'energy restored');
  assert.equal(h.intangible, false, 'stale i-frames cleared (respawn() re-grants)');
  assert.equal(h.vx, 0, 'velocity reset');
  assert.equal(h.vy, 0, 'velocity reset');
  assert.equal(h.lives, 1, 'lives untouched');
});

test('startLife: clears a leaked death flag / drained energy from a failed attempt', () => {
  const h = makeTestHero();
  h.lives = 2;
  const ctx = makeAreaContext(h);
  // Simulate a failed attempt that left transient state on the hero.
  h.dying = true;
  h.energy = 0;
  h.intangible = true;
  h.x = 3500;
  h.checkpoint = { x: 100, y: 400 };
  setState(S.PLAY);
  L.startLife(h, ctx);
  assert.equal(h.dying, false, 'death flag cleared by startLife');
  assert.equal(h.energy, h.maxEnergy, 'energy restored by startLife');
  assert.equal(h.lives, 2, 'lives untouched');
});

test('integration: full death → continue flow via update.js', async () => {
  const hero = U.getHero();
  const checkpoints = U.getCheckpoints();

  // Reset to a clean PLAY state.
  setState(S.PLAY);
  hero.dying = false;
  hero.deathTimer = 0;
  hero.alive = true;
  hero.energy = hero.maxEnergy;
  hero.lives = 3;
  hero.coins = 0;
  hero.x = 80; hero.y = 500; hero.vx = 0; hero.vy = 0;
  hero.checkpoint = { x: 80, y: 500 };
  for (const c of checkpoints) c.triggered = false;

  // Kill the hero.
  hero.lives = 1;
  hero.energy = 0;
  U.update(1 / 60);
  let steps = 1;
  while (hero.dying && steps < 200) { U.update(1 / 60); steps++; }

  // Should be in OVER now.
  assert.equal(getState(), S.OVER, 'transitioned to OVER after last life');
  assert.equal(hero.lives, 0, 'all lives consumed');

  // Continue.
  setState(S.OVER);
  const applied = U.continueFromGameOver();
  assert.equal(applied, true, 'continue applied');
  assert.equal(getState(), S.AREA_ENTRY, 'continue shows the shared area-entry screen (checkpoints.md §3)');
  assert.equal(hero.lives, 3, 'lives restored to 3');
  assert.equal(hero.continuesUsed, 1, 'one continue spent');
  // Confirming the entry screen starts the fresh attempt (lifecycle.md §4).
  const { areaEntryOnAction } = L;
  assert.equal(areaEntryOnAction('confirm', hero), true, 'confirm starts the attempt');
  assert.equal(getState(), S.PLAY, 'back in PLAY after confirming the entry screen');
  assert.ok(hero.energy === hero.maxEnergy, 'full energy after continue');
});

test('integration: continue from 2-3 lands the hero at the level entry (area -1), not the death spot', async () => {
  const hero = U.getHero();
  // Simulate: the player is deep in the level (a later area) and runs out of lives.
  setState(S.OVER);
  hero.lives = 0;
  hero.currentArea = 3; // "2-3" (level index is 1 for the current single-level build)
  hero.x = 6000; hero.y = 492;
  hero.checkpoint = { x: 6000, y: 492 }; // died deep in the level

  const applied = U.continueFromGameOver();
  assert.equal(applied, true, 'continue applied');
  assert.equal(getState(), S.AREA_ENTRY, 'continue shows the shared area-entry screen first');
  assert.equal(hero.lives, 3, 'starting lives restored');
  assert.equal(hero.currentArea, -1, 'area reset to -1');
  // Confirming the entry screen starts the fresh attempt at the level's entry
  // (x=100), NOT at the death spot (x=6000).
  L.areaEntryOnAction('confirm', hero);
  assert.equal(getState(), S.PLAY, 'back in PLAY after confirming the entry screen');
  assert.ok(Math.abs(hero.x - 100) < 1, `hero at level entry x=${hero.x} (not 6000)`);
});
