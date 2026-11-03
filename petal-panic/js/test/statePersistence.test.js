// State Persistence — consolidated transition-table gate (plan 4.1).
// Run: node --test petal-panic/js/test/statePersistence.test.js
//
// Source of truth: docs/levels/state-persistence.md §3 — one test per table
// row asserting the FULL keep/reset columns (coins, score, energy, weapon,
// lives, continues). Per-transition detail tests live in lifecycle.test.js /
// reward.test.js / menuRunFlow.test.js; this file is the cross-cutting gate
// that fails if ANY column of ANY row drifts from the doc.

import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// --- Minimal DOM + storage stubs (must run BEFORE importing game modules) ----
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, addEventListener: noop }),
};
globalThis.window = { addEventListener: noop };
const memStorage = (() => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
})();
globalThis.localStorage = memStorage;

const L = await import('../systems/lifecycle.js');
const PS = await import('../systems/progressStore.js');
const { S, getState, setState } = await import('../core/state.js');
const { GAME_RULES } = await import('../systems/gameRules.js');
const { Hero, WEAPON_THORN } = await import('../hero/hero.js');
const { HEROES } = await import('../hero/heroDefs.js');
const { calculateScore } = await import('../stats.js');

// --- Helpers -----------------------------------------------------------------

/** Post-startGame-shaped hero with a known wallet/inventory state. */
function makeHero(coins = 0, kills = 0) {
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
  h.checkpoint = { x: 100, y: 400 };
  h.wallet.current.coins = coins;
  h.wallet.current.kills = kills;
  return h;
}

/** Minimal empty area context (startLife restores it; nothing to restore). */
const emptyCtx = () => ({ enemies: [], boss: null, barrels: [], powerups: [], checkpoints: [], projectiles: { activeItems: [], active: [] }, coins: { activeItems: [], active: [] }, particles: { reset: () => {} }, effects: { reset: () => {} } });

/** Give the hero a mid-run inventory: non-default weapon + held special. */
function armHero(h) {
  h.selectedWeapon = 1; // a special slot index, not the default thorn
  h.specialSlots[0] = 'bomb';
  h.energy = Math.floor(h.maxEnergy / 2); // drained energy
}

/** Score of the hero's current wallet (the doc's "score" column input). */
const scoreOf = (h) => h.wallet.current.coins * 10 + h.wallet.current.kills * 100;

/** Assert the full "keep everything" row for progress transitions. */
function assertKept(h, before, label) {
  assert.equal(h.wallet.current.coins, before.coins, `${label}: coins kept`);
  assert.equal(h.wallet.current.kills, before.kills, `${label}: kills kept`);
  assert.equal(h.energy, before.energy, `${label}: energy kept`);
  assert.equal(h.selectedWeapon, before.weapon, `${label}: weapon kept`);
  assert.deepEqual([...h.specialSlots], before.specials, `${label}: specials kept`);
  assert.equal(h.lives, before.lives, `${label}: lives kept`);
  assert.equal(h.continues.remaining, before.continues, `${label}: continues kept`);
}

/** Capture the keep-columns of a hero. */
const capture = (h) => ({
  coins: h.wallet.current.coins, kills: h.wallet.current.kills, energy: h.energy,
  weapon: h.selectedWeapon, specials: [...h.specialSlots], lives: h.lives,
  continues: h.continues.remaining,
});

// ===========================================================================
// Row: Die / Retry — cost 1 life, same zone, ↩ zone snapshot, energy full,
//       weapon gone, lives −1, continues kept
// ===========================================================================

test('row [Die/Retry]: death restart rolls to zone snapshot, full energy, weapon gone, lives −1', () => {
  const h = makeHero(50, 5);
  L.recordZoneSnapshot(h); // zone 1-1 entry: coins 50, kills 5
  armHero(h);
  h.wallet.current.coins += 30; // attempt earnings
  h.wallet.current.kills += 2;
  h.lives = 2;

  L.startLife(h, emptyCtx()); // the death-restart path

  assert.equal(h.wallet.current.coins, 50, 'coins rolled back to zone entry');
  assert.equal(h.wallet.current.kills, 5, 'kills rolled back to zone entry');
  assert.equal(scoreOf(h), 50 * 10 + 5 * 100, 'score derives from rolled-back wallet');
  assert.equal(h.energy, h.maxEnergy, 'energy full');
  assert.equal(h.selectedWeapon, WEAPON_THORN, 'weapon gone (default)');
  assert.ok(h.specialSlots.every((s) => s === null), 'specials cleared');
  assert.equal(h.lives, 2, 'lives untouched by startLife (caller consumed the life)');
  assert.equal(h.continues.remaining, GAME_RULES.startingContinues, 'continues kept');
});

test('row [Die/Retry]: manual retry costs exactly 1 life and rejects at 0 lives', async () => {
  // retryFromGameOver operates on the LIVE booted hero (world/context.js ctx),
  // same harness as lifecycle.test.js's retry tests.
  const U = await import('../systems/update.js');
  const hero = U.getHero();
  setState(S.OVER);
  hero.lives = 2;
  const r1 = U.retryFromGameOver();
  assert.equal(r1, true, 'retry accepted with lives remaining');
  assert.equal(hero.lives, 1, 'exactly one life consumed (2→1)');
  // At 0 lives: rejected, nothing changes.
  setState(S.OVER);
  hero.lives = 0;
  const coinsBefore = hero.wallet.current.coins;
  const r2 = U.retryFromGameOver();
  assert.equal(r2, false, 'retry rejected at 0 lives');
  assert.equal(hero.lives, 0, 'lives unchanged on rejection');
  assert.equal(hero.wallet.current.coins, coinsBefore, 'wallet unchanged on rejection');
});

// ===========================================================================
// Row: Continue — cost 1 continue, zone 1-1, ↩ 1-1 snapshot, energy full,
//        weapon gone, lives refilled, continues −1
// ===========================================================================

test('row [Continue]: defeat in 1-3 → 1-1 entry state, full energy, weapon gone, lives refilled, continues −1', () => {
  const h = makeHero(0, 0);
  L.recordZoneSnapshot(h); // 1-1 entry: coins 0
  // Advance to area 3 (a genuine entry records ITS snapshot), earn more there.
  h.currentArea = 3;
  h.wallet.current.coins = 90; h.wallet.current.kills = 9;
  h.wallet.current.coins = 90; h.wallet.current.kills = 9;
  L.recordZoneSnapshot(h); // 1-3 entry: coins 90
  armHero(h);
  h.wallet.current.coins += 25; // failed-attempt earnings in 1-3
  h.lives = 0;

  const contBefore = h.continues.remaining;
  const ok = L.continueRun(h, null);

  assert.equal(ok, true, 'continue applied');
  assert.equal(h.currentArea, 1, 'back to area 1 of the current level');
  assert.equal(h.wallet.current.coins, 0, 'coins rolled back to the 1-1 ENTRY snapshot (not zeroed, not 1-3)');
  assert.equal(h.wallet.current.kills, 0, 'kills rolled back to the 1-1 entry snapshot');
  assert.equal(h.energy, h.maxEnergy, 'energy full');
  assert.equal(h.selectedWeapon, WEAPON_THORN, 'weapon gone');
  assert.ok(h.specialSlots.every((s) => s === null), 'specials cleared');
  assert.equal(h.lives, GAME_RULES.startingLives, 'lives refilled');
  assert.equal(h.continues.remaining, contBefore - 1, 'exactly one continue spent');
});

// ===========================================================================
// Row: Next zone — keep everything (no resets), new snapshot recorded
// ===========================================================================

test('row [Next zone]: zone arrival keeps EVERY column (doc §2.3)', () => {
  const h = makeHero(70, 7);
  armHero(h);
  const before = capture(h);
  L.startArea(h, 1, 2);
  // The full §2.3 row: a zone pass resets NOTHING — money, energy, weapon,
  // specials, lives, continues all carry over.
  assertKept(h, before, 'zone advance');
  assert.ok(h.wallet.snapshots['1:2'], 'new zone snapshot recorded at entry');
  assert.deepEqual(h.wallet.snapshots['1:2'], h.wallet.current, 'snapshot equals entry state');
});

test('row [Next zone]: ADVANCE attempt-start keeps energy/weapon (no failure reset)', () => {
  // Flow-level guard for the regression that refilled energy on zone pass:
  // startLife({advance:true}) must NOT roll back, refill energy, or clear the
  // weapon — it only places the hero at the new zone's entry.
  const h = makeHero(70, 7);
  armHero(h);
  L.recordZoneSnapshot(h);
  h.wallet.current.coins += 25; // earnings inside the zone so far
  h.checkpoint = { x: 500, y: 300 };
  const before = capture(h);
  L.startLife(h, emptyCtx(), { advance: true });
  assertKept(h, before, 'advance arrival');
  assert.equal(h.x, 500, 'hero placed at the new zone entry');
  assert.equal(h.y, 300, 'hero placed at the new zone entry');
  // And the FAILURE flavor still does the full reset (regression both ways).
  h.wallet.current.coins += 40;
  L.startLife(h, emptyCtx());
  assert.equal(h.wallet.current.coins, 70, 'failure restart rolls to the zone snapshot (entry value)');
  assert.equal(h.energy, h.maxEnergy, 'failure restart refills energy');
  assert.equal(h.selectedWeapon, WEAPON_THORN, 'failure restart clears the weapon');
});

// ===========================================================================
// Row: Next level — keep everything EXCEPT energy → full; lives NOT refilled
// ===========================================================================

test('row [Next level]: boss reward confirm refills energy only, keeps all other columns', async () => {
  const h = makeHero(120, 12);
  h.levelConfig = { index: 1, boss: 'tusko_wobble' };
  h._levelStartWallet = { ...h.wallet.current };
  armHero(h);
  h.lives = 1; // deliberately low: must NOT be refilled
  const before = capture(h);

  L.bindAreaContext(h, emptyCtx());
  L._resetRewardForTest();
  setState(S.PLAY);
  L.showLevelReward(h);
  // The current build ships a single playable level (LEVELS.length === 1), so
  // temporarily extend LEVELS to exercise the next-level path (same trick as
  // reward.test.js).
  const { LEVELS } = await import('../world/level.js');
  const savedLen = LEVELS.length;
  LEVELS.push({ name: 'Second Level' });
  let handled;
  try {
    L._advanceRewardDwellForTest();
    handled = L.rewardOnAction('confirm', h);
  } finally {
    LEVELS.length = savedLen;
  }

  assert.equal(handled, true, 'reward confirmed');
  assert.equal(h.currentLevel, 2, 'advanced to next level');
  assert.equal(h.currentArea, 1, 'next level starts at area 1');
  assert.equal(h.energy, h.maxEnergy, 'energy refilled (the only touched column)');
  assert.equal(h.wallet.current.coins, before.coins, 'coins kept');
  assert.equal(h.wallet.current.kills, before.kills, 'kills kept');
  assert.equal(h.selectedWeapon, before.weapon, 'weapon kept');
  assert.deepEqual([...h.specialSlots], before.specials, 'specials kept');
  assert.equal(h.lives, 1, 'lives NOT refilled on level clear');
  assert.ok(h.wallet.snapshots['2:1'], 'next-level 1-1 snapshot recorded');
});

// ===========================================================================
// Row: Save & Quit — free; stores zone + chain + full player state + seed
// ===========================================================================

test('row [Save&Quit]: saveCurrentRun persists the full state block + snapshot chain, changes nothing', () => {
  const h = makeHero(80, 8);
  armHero(h);
  h.lives = 2;
  h.continues.remaining = 1;
  L.recordZoneSnapshot(h);
  const before = capture(h);

  const meta = L.saveCurrentRun(h);

  assert.ok(meta, 'save written');
  assert.equal(meta.level, 1);
  assert.equal(meta.area, 1);
  assert.ok(Number.isInteger(meta.seed), 'seed persisted');
  assert.equal(meta.state.coins, 80, 'state.coins captured');
  assert.equal(meta.state.energy, before.energy, 'state.energy captured');
  assert.equal(meta.state.weapon, before.weapon, 'state.weapon captured');
  assert.deepEqual(meta.state.specialSlots, before.specials, 'state.specials captured');
  assert.equal(meta.state.lives, 2, 'state.lives captured');
  assert.equal(meta.state.continues, 1, 'state.continues captured');
  assert.ok(meta.state.snapshots['1:1'], 'snapshot chain persisted inside state');
  // Saving is free: the run itself is untouched.
  assertKept(h, before, 'after save');
});

// ===========================================================================
// Row: Reload → Continue — restore exactly the saved on-screen state
// ===========================================================================

test('row [Reload→Continue]: applySavedState restores the exact saved state incl. the chain', () => {
  const saved = makeHero(80, 8);
  armHero(saved);
  saved.lives = 2;
  saved.continues.remaining = 1;
  L.recordZoneSnapshot(saved);
  const meta = L.saveCurrentRun(saved);

  // Simulate a reload: a FRESH hero with different (post-boot) values.
  const fresh = makeHero(5, 0);
  fresh.lives = GAME_RULES.startingLives;
  fresh.continues.remaining = GAME_RULES.startingContinues;
  L.applySavedState(fresh, meta.state);

  assert.equal(fresh.wallet.current.coins, 80, 'coins restored');
  assert.equal(fresh.energy, saved.energy, 'energy restored');
  assert.equal(fresh.selectedWeapon, saved.selectedWeapon, 'weapon restored');
  assert.deepEqual([...fresh.specialSlots], [...saved.specialSlots], 'specials restored');
  assert.equal(fresh.lives, 2, 'lives restored');
  assert.equal(fresh.continues.remaining, 1, 'continues restored');
  assert.deepEqual(fresh.wallet.snapshots, saved.wallet.snapshots, 'snapshot chain restored');

  // A death AFTER the reload-continue rolls back to the PRE-QUIT zone entry.
  fresh.wallet.current.coins += 40; // earn in the resumed zone
  L.restoreZoneState(fresh, '1:1');
  assert.equal(fresh.wallet.current.coins, 80, 'post-reload death rolls to pre-quit entry value');
});

test('row [Reload→Continue]: legacy save without state leaves the hero untouched', () => {
  const h = makeHero(30, 3);
  armHero(h);
  const before = capture(h);
  L.applySavedState(h, undefined); // no state block (legacy save)
  assertKept(h, before, 'legacy resume');
});

// ===========================================================================
// Row: New game — reset everything
// ===========================================================================

test('row [New game]: startGame zeroes the run and clears any saved state', () => {
  // A saved run exists first.
  const old = makeHero(999, 99);
  L.saveCurrentRun(old);
  assert.ok(PS.loadStore().saveMeta, 'save present before new game');

  const h = L.startGame({ oldHero: old }, HEROES.scarlet);
  // The menu-hub New Game flow (not startGame itself) drops the run save.
  L.newGameFromMenu();

  assert.equal(h.wallet.current.coins, 0, 'coins zeroed');
  assert.equal(h.wallet.current.kills, 0, 'kills zeroed');
  assert.equal(h.energy, h.maxEnergy, 'energy full');
  assert.equal(h.selectedWeapon, WEAPON_THORN, 'weapon default');
  assert.ok(h.specialSlots.every((s) => s === null), 'specials empty');
  assert.equal(h.lives, GAME_RULES.startingLives, 'lives at start count');
  assert.equal(h.continues.remaining, GAME_RULES.startingContinues, 'continues at start count');
  assert.deepEqual(Object.keys(h.wallet.snapshots), ['1:1'], 'fresh snapshot chain seeded at 1-1');
  // New Game drops the resumable run save.
  assert.equal(PS.loadStore().saveMeta, null, 'saved run cleared by new game');
});
