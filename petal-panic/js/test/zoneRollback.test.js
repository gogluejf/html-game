// Fresh-zone-cleanup regression: wallet rollback must target the ZONE THE
// ATTEMPT FAILED IN, never the hero's post-transition level/area.
//
// The bug this pins: a continue flips currentArea to 1 (run rule) BEFORE the
// failure-flavor restart rolls the wallet back. If the rollback reads
// currentZoneId(h) at that point it restores area 1's snapshot (or nothing),
// and the coins earned in the death zone survive the "retry" — the anti-farming
// reset silently no-ops.
import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing lifecycle/hero) --------------
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
const memStorage = (() => {
  let map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
})();
globalThis.localStorage = memStorage;

const L = await import('../systems/lifecycle.js');
const { S, setState } = await import('../core/state.js');
const { HEROES } = await import('../hero/heroDefs.js');

function makeHero() {
  const h = L.makeHero(HEROES.scarlet);
  h.currentLevel = 1;
  h.currentArea = 3; // died in area 3
  h.lives = 2;
  h.wallet = { current: { coins: 0, kills: 0 }, snapshots: {} };
  return h;
}

test('death-retry rolls back to the DEATH zone snapshot even when currentArea points elsewhere', () => {
  const h = makeHero();
  // Entry snapshot for area 3 (recorded on genuine entry).
  h.wallet.current.coins = 10;
  L.recordZoneSnapshot(h); // snapshots['1:3'] = {coins:10}
  // Area 1 has a DIFFERENT snapshot (stale or fresh — must not be used here).
  h.wallet.snapshots['1:1'] = { coins: 999, kills: 0 };

  // Earned coins inside area 3 during the failed attempt.
  h.wallet.current.coins = 55;

  // Simulate the continue having already flipped the area (run rule ran first):
  // the rollback MUST still use 1:3, not 1:1.
  h.currentArea = 1;

  setState(S.PLAY);
  L.restartAttempt(h, null, '1:3'); // explicit zone id, as the entry paths now pass

  assert.equal(h.wallet.current.coins, 10,
    'wallet rolled back to the death zone (1:3) snapshot, not the post-transition area');
});

test('restartAttempt without an explicit zone id falls back to the hero current zone', () => {
  const h = makeHero();
  h.currentArea = 3;
  h.wallet.current.coins = 10;
  L.recordZoneSnapshot(h);
  h.wallet.current.coins = 77;

  setState(S.PLAY);
  L.restartAttempt(h, null); // bare caller (tests / legacy): fallback path

  assert.equal(h.wallet.current.coins, 10, 'fallback uses currentZoneId when no id passed');
});
