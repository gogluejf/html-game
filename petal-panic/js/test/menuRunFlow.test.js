// Task 2.3 — New Game / Continue flow + Save & Quit write-side tests (headless).
// Run: node --test petal-panic/js/test/menuRunFlow.test.js
//
// Verifies the plan §2.3 acceptance criteria against the REAL runtime path:
//   - New Game clears the active run save but preserves meta unlocks;
//   - Continue resumes the saved level/area through AREA_ENTRY, installing the
//     saved zone's world content + spawn checkpoint exactly as a normal mid-run
//     area entry does (driven through update.js boot + the live hero);
//   - Save & Quit writes saveMeta before returning to MENU (the WRITE side —
//     saveCurrentRun() persists {level, area, score, timestamp});
//   - disabled Continue cannot be selected or confirmed (covered by
//     menuScreen.test.js; re-asserted here against the real store).
//
// The Continue happy-path tests drive the REAL path (H5): they import update.js
// (which boots a live hero and registers it as the menu's Continue target),
// then continueFromMenu on that live hero, then confirm the entry screen, and
// assert the installed world state. No manual hero registration in the
// happy-path tests — the boot path provides it.

import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

import { strict as assert } from 'node:assert';
import { test, before, after } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing the engine modules) ---------
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, addEventListener: noop }),
};
globalThis.window = { addEventListener: noop };

// In-memory localStorage so progressStore works headlessly.
const memStorage = (() => {
  let map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
})();
globalThis.localStorage = memStorage;

const { S, getState, setState, tryTransition } = await import('../core/state.js');
const SC = await import('../ui/screens.js');
const PS = await import('../systems/progressStore.js');
const L = await import('../systems/lifecycle.js');
const U = await import('../systems/update.js'); // boots a live hero (registers it for Continue)
const { GAME_RULES } = await import('../systems/gameRules.js');
const { Hero } = await import('../hero/hero.js');
const { HEROES } = await import('../hero/heroDefs.js');
const { createTrace } = await import('../stats.js');

/** Write a resumable save directly at the top level of the store document. */
function writeSave(meta) {
  PS.loadStore().saveMeta = meta;
  assert.equal(PS.saveStore(PS.loadStore()), true, 'save persisted');
}

/** A bare hero with a continue pool and a trace carrying known counters.
 * Used only where a hero object is needed WITHOUT the full runtime (e.g. the
 * saveCurrentRun write-side tests, which exercise persistence, not world install). */
function makeTestHero(level = 1, area = 1) {
  const h = new Hero(HEROES.scarlet, 100, 400);
  h.lives = GAME_RULES.startingLives;
  h.continues = { remaining: GAME_RULES.startingContinues };
  Object.defineProperty(h, 'continuesUsed', {
    get() { return GAME_RULES.startingContinues - h.continues.remaining; },
    set(n) { h.continues.remaining = GAME_RULES.startingContinues - n; },
    configurable: true,
  });
  h.currentLevel = level;
  h.currentArea = area;
  h.traceStats = createTrace();
  // Known counters: 5 kills (500) + 20 coins (200) = 700 points.
  h.traceStats.total.enemiesKilled = { doodle_dink: 5 };
  h.traceStats.total.coinsCollected = { total: 20 };
  return h;
}

before(() => { PS.resetStore(); });
after(() => { PS.resetStore(); });

function go(to) {
  const ok = tryTransition(to);
  if (!ok) throw new Error(`transition to ${to} failed`);
}

// --- New Game ------------------------------------------------------------------

test('New Game clears the active run save but preserves meta unlocks', () => {
  PS.resetStore();
  // Seed a full store: meta unlocks + settings + an active run save.
  PS.updateProgress((p) => {
    p.completedAreas['1-2'] = true;
    p.defeatedBosses.push('elephant');
    p.mediaUnlocked.push('intro');
  });
  PS.updateSettings((s) => { s.music = true; });
  writeSave({ level: 2, area: 3, score: 900, timestamp: 123 });
  assert.equal(PS.hasSave(), true, 'a run save exists before New Game');

  setState(S.HOME);
  go(S.MENU);
  SC.Menu.focus = 0; // New Game
  assert.equal(SC.Menu.onAction('confirm'), true, 'confirm handled');

  assert.equal(getState(), S.SELECT, 'New Game routes to SELECT');
  assert.equal(PS.hasSave(), false, 'the run save is cleared');
  const store = PS.loadStore();
  assert.deepEqual(store.progress.completedAreas, { '1-2': true }, 'completed areas preserved');
  assert.deepEqual(store.progress.defeatedBosses, ['elephant'], 'defeated bosses preserved');
  assert.deepEqual(store.progress.mediaUnlocked, ['intro'], 'media unlocks preserved');
  assert.equal(store.settings.music, true, 'settings preserved');
});

test('newGameFromMenu() drops only saveMeta and opens SELECT', () => {
  PS.resetStore();
  PS.updateProgress((p) => { p.mediaUnlocked.push('level-3'); });
  writeSave({ level: 1, area: 2, score: 100, timestamp: 1 });
  setState(S.MENU);
  assert.equal(L.newGameFromMenu(), true, 'SELECT transition made');
  assert.equal(getState(), S.SELECT);
  assert.equal(PS.hasSave(), false, 'run save dropped');
  assert.deepEqual(PS.loadStore().progress.mediaUnlocked, ['level-3'], 'meta unlock kept');
});

// --- Continue (real runtime path — H5) -----------------------------------------

test('boot registers the live hero as the menu Continue target (H1)', () => {
  // update.js booted a hero at module load; startGame must have registered it
  // via setMenuHero so the menu's Continue flow resumes on the LIVE instance.
  const live = U.getHero();
  assert.ok(live, 'a live hero exists after boot');
  assert.equal(SC.getMenuHero(), live, 'getMenuHero() returns the live hero (not null)');
});

test('Continue installs the saved zone + spawn checkpoint through AREA_ENTRY (H2)', () => {
  PS.resetStore();
  writeSave({ level: 1, area: 3, score: 900, timestamp: 456 });

  const hero = SC.getMenuHero(); // the live hero registered at boot (no manual registration)
  assert.ok(hero, 'a live hero is registered for the Continue flow');

  setState(S.HOME);
  go(S.MENU);
  SC.Menu.focus = 1; // Continue
  assert.equal(SC.Menu.onAction('confirm'), true, 'confirm handled');

  assert.equal(getState(), S.AREA_ENTRY, 'state is now AREA_ENTRY');
  assert.equal(hero.currentLevel, 1, 'hero restored to the saved level');
  assert.equal(hero.currentArea, 3, 'hero restored to the saved area');
  const data = L.getAreaEntryData();
  assert.equal(data.areaId, '1-3', 'entry screen shows the saved area id');
  assert.equal(data.lives, GAME_RULES.startingLives, 'entry screen shows the life count');

  // The saved zone's WORLD CONTENT is installed (structure.md §2): the active
  // zone is area 3 and its entry + exit checkpoints are present — NOT the
  // previous run's area 1 (whose only flag was 1-1-exit).
  const zone = U.getActiveZone(hero);
  assert.equal(zone.kind, 'area', 'active zone is an ordinary area');
  assert.equal(zone.areaIdx, 3, 'active zone is the saved area 3');
  const cpIds = U.getCheckpoints().map(c => c.checkpointId);
  assert.ok(cpIds.includes('1-3'), 'area 3 entry flag installed');
  assert.ok(cpIds.includes('1-3-exit'), 'area 3 exit flag installed');
  assert.ok(!cpIds.includes('1-1-exit'), 'previous area 1 content no longer installed');

  // The SPAWN CHECKPOINT is updated to the saved zone's spawn (not the stale
  // area-1 spawn). Area 3 is the vertical climb, so its spawn y differs from
  // area 1's ground line — asserting the exact zone spawn proves the install.
  assert.equal(hero.checkpoint.x, zone.spawn.x, 'checkpoint x matches the saved zone spawn');
  assert.equal(hero.checkpoint.y, zone.spawn.y - hero.h, 'checkpoint y matches the saved zone spawn');

  // Confirming the entry screen starts the attempt and places the hero at the
  // saved zone's entry (startLife reads the checkpoint we just installed).
  assert.equal(L.areaEntryOnAction('confirm', hero), true, 'confirm starts the attempt');
  assert.equal(getState(), S.PLAY, 'back in PLAY after confirming the entry screen');
  assert.equal(hero.x, zone.spawn.x, 'hero placed at the saved zone entry x');
  assert.equal(hero.y, zone.spawn.y - hero.h, 'hero placed at the saved zone entry y');
});

test('continueFromMenu() is a no-op when no save exists', () => {
  PS.resetStore();
  const hero = makeTestHero(2, 3);
  setState(S.MENU);
  assert.equal(L.continueFromMenu(hero), false, 'no transition without a save');
  assert.equal(getState(), S.MENU, 'state unchanged');
  assert.equal(hero.currentLevel, 2, 'hero untouched');
  assert.equal(hero.currentArea, 3, 'hero untouched');
});

test('disabled "No Save" entry cannot be confirmed into AREA_ENTRY', () => {
  PS.resetStore(); // no save → index 1 disabled
  setState(S.HOME);
  go(S.MENU);
  SC.Menu.focus = 1; // force focus onto the disabled entry
  SC.Menu.onAction('confirm');
  assert.equal(getState(), S.MENU, 'confirm on the disabled entry stays on MENU');
});

// --- Save validation (H3) ------------------------------------------------------

test('isValidSaveMeta rejects out-of-range / corrupt saves (H3)', () => {
  assert.equal(L.isValidSaveMeta({ level: -2, area: 0 }), false, 'negative level rejected');
  assert.equal(L.isValidSaveMeta({ level: 99, area: 1 }), false, 'level beyond config bounds rejected');
  assert.equal(L.isValidSaveMeta({ level: 1, area: 0 }), false, 'area below range rejected');
  assert.equal(L.isValidSaveMeta({ level: 1, area: 99 }), false, 'area beyond zones rejected');
  assert.equal(L.isValidSaveMeta({ level: 1.5, area: 1 }), false, 'non-integer level rejected');
  assert.equal(L.isValidSaveMeta(null), false, 'null save rejected');
});

test('isValidSaveMeta accepts valid boundary values (H3)', () => {
  const lastLevel = 8; // LEVEL_CONFIGS.length
  assert.equal(L.isValidSaveMeta({ level: 1, area: 1 }), true, 'first level/area accepted');
  assert.equal(L.isValidSaveMeta({ level: 1, area: 4 }), true, 'last ordinary area accepted');
  assert.equal(L.isValidSaveMeta({ level: lastLevel, area: 4 }), true, 'last level, last area accepted');
  assert.equal(L.isValidSaveMeta({ level: lastLevel, area: 5 }), true, 'boss zone (area 5) accepted');
});

test('continueFromMenu() rejects a corrupt save (out-of-range) as NO SAVE (H3)', () => {
  PS.resetStore();
  writeSave({ level: -2, area: 0, score: 100, timestamp: 1 });
  const hero = makeTestHero(1, 1);
  setState(S.MENU);
  assert.equal(L.continueFromMenu(hero), false, 'corrupt save rejected — no transition');
  assert.equal(getState(), S.MENU, 'state unchanged');
  assert.equal(hero.currentLevel, 1, 'hero untouched by a corrupt save');
  assert.equal(hero.currentArea, 1, 'hero untouched by a corrupt save');
});

// --- Save & Quit (write side) ---------------------------------------------------

test('saveCurrentRun() writes saveMeta {level, area, score, timestamp}', () => {
  PS.resetStore();
  const hero = makeTestHero(3, 2);
  // Fixed clock (H6): stub Date.now so the written timestamp is deterministic
  // and we can assert the EXACT value rather than a live-clock bound.
  const FIXED_NOW = 1_700_000_000_000;
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  let meta;
  try {
    meta = L.saveCurrentRun(hero);
  } finally {
    Date.now = realNow;
  }

  assert.ok(meta, 'returns the written saveMeta');
  assert.equal(meta.level, 3, 'saved level matches the hero');
  assert.equal(meta.area, 2, 'saved area matches the hero');
  assert.equal(meta.score, 700, 'score computed from the run totals (5×100 + 20×10)');
  assert.equal(meta.timestamp, FIXED_NOW, 'timestamp is the injected wall-clock value (exact)');

  // Persisted at the TOP LEVEL of the store document (not under progress).
  const stored = PS.loadStore();
  assert.deepEqual(stored.saveMeta, meta, 'saveMeta persisted');
  assert.equal(PS.hasSave(), true, 'hasSave() sees the new save');
  // Progress section is untouched by the write.
  assert.deepEqual(stored.progress.completedAreas, {}, 'progress intact');
});

test('saveCurrentRun() survives a reload (round-trip)', () => {
  PS.resetStore();
  const hero = makeTestHero(4, 1);
  const meta = L.saveCurrentRun(hero);
  PS._resetCache(); // forget the in-memory cache → next load re-reads storage
  const reloaded = PS.loadStore();
  assert.deepEqual(reloaded.saveMeta, meta, 'saveMeta round-trips through storage');
  assert.equal(PS.hasSave(), true, 'hasSave() true after reload');
});

test('saveCurrentRun() then Continue resumes exactly where the run was saved', () => {
  PS.resetStore();
  const hero = makeTestHero(2, 4);
  L.saveCurrentRun(hero);
  assert.equal(PS.hasSave(), true, 'save written');

  // Drive the REAL path: resume on the live hero registered at boot.
  const resumed = SC.getMenuHero();
  assert.ok(resumed, 'a live hero is registered for the Continue flow');
  setState(S.MENU);
  assert.equal(L.continueFromMenu(resumed), true, 'resume transition made');
  assert.equal(getState(), S.AREA_ENTRY);
  assert.equal(resumed.currentLevel, 2, 'resumed at the saved level');
  assert.equal(resumed.currentArea, 4, 'resumed at the saved area');
  assert.equal(L.getAreaEntryData().areaId, '2-4', 'entry screen shows the saved area');
});
