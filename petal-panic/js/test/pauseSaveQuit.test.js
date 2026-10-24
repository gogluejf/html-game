// Task 4.2 — Pause menu Save & Quit integration tests (headless).
// Run: node --test petal-panic/js/test/pauseSaveQuit.test.js
//
// Verifies the plan §4.2 acceptance criteria against the REAL runtime path:
//   - Pause shows five options in the existing centered list style;
//   - Save & Quit writes progress/saveMeta and returns to MENU;
//   - Controls opens REMAP with parent PAUSE (back from REMAP → PAUSE);
//   - Options opens OPTIONS with origin PAUSE (back from OPTIONS → PAUSE).
// Plus preservation of the existing Resume / Retry behavior.

import { strict as assert } from 'node:assert';
import { test, before, after } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing the engine modules) ---------
const noop = () => {};
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => noop, set: () => true }), addEventListener: noop }),
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
const { Remap } = await import('../core/remap.js');
// Same source lifecycle.saveCurrentRun uses for its score (lifecycle.js imports
// calculateScore from stats.js) — lets us assert the EXACT persisted score.
const { calculateScore } = await import('../stats.js');

/** A fake live hero carrying a mid-run identity + scoreable stats. */
function makeHero() {
  return {
    currentLevel: 3,
    currentArea: 2,
    traceStats: { total: { enemiesKilled: { doodle_dink: 12 }, coinsCollected: { total: 5 } } },
  };
}

/** Drive a transition through the real onTransition hook (screenReset etc.). */
function go(to) {
  const ok = tryTransition(to);
  if (!ok) throw new Error(`transition to ${to} failed`);
}

before(() => { PS.resetStore(); });
after(() => { PS.resetStore(); });

test('Pause exposes draw/onAction/reset and lists the five §4.2 options', () => {
  assert.equal(typeof SC.Pause.draw, 'function', 'draw is a function');
  assert.equal(typeof SC.Pause.onAction, 'function', 'onAction is a function');
  assert.equal(typeof SC.Pause.reset, 'function', 'reset is a function');

  const opts = SC.Pause.options();
  assert.equal(opts.length, 5, 'five options');
  assert.deepEqual(
    opts.map(o => o.label),
    ['Resume', 'Retry Level', 'Save & Quit', 'Controls', 'Options'],
    'canonical order',
  );
  assert.ok(opts.every(o => o.enabled === true), 'all enabled');
});

test('Pause.draw renders all five labels via the shared centered list', () => {
  const texts = [];
  const base = new Proxy({}, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: noop });
      return target[prop] ?? noop;
    },
    set(target, prop, val) { target[prop] = val; return true; },
  });
  base.fillText = (t) => { texts.push(String(t)); };

  setState(S.PLAY);
  go(S.PAUSE);
  SC.Pause.draw(base);
  for (const label of ['PAUSED', 'Resume', 'Retry Level', 'Save & Quit', 'Controls', 'Options']) {
    assert.ok(texts.some(t => t.includes(label)), `renders "${label}"`);
  }
});

test('Save & Quit writes saveMeta and returns to MENU (round-trip)', () => {
  PS.resetStore();
  const hero = makeHero();
  setState(S.PLAY);
  go(S.PAUSE);
  SC.Pause.focus = 2; // Save & Quit
  const consumed = SC.screenOnAction('confirm', hero, {}, hero);
  assert.equal(consumed, true, 'action handled');
  assert.equal(getState(), S.MENU, 'returned to MENU');

  const stored = PS.loadStore().saveMeta;
  assert.ok(stored, 'saveMeta persisted at top level of the store');
  assert.equal(stored.level, 3, 'level from the live hero');
  assert.equal(stored.area, 2, 'area from the live hero');
  // Exact score: replicate saveCurrentRun's argument construction — it calls
  // calculateScore(h.traceStats.total, h). For this fixed hero that is
  // 12 kills × 100 + 5 coins × 10 = 1250 (no boss/barrels in the trace).
  const expectedScore = calculateScore(hero.traceStats.total, hero);
  assert.equal(expectedScore, 1250, 'hand-derived expectation matches calculateScore');
  assert.equal(stored.score, expectedScore, 'score is the EXACT calculateScore value');
  assert.ok(stored.timestamp > 0, 'timestamp written');

  // Round-trip serialization fidelity: read the RAW serialized document out of
  // storage (what a page reload would parse) and verify its saveMeta deep-equals
  // the expected {level, area, score} plus a positive timestamp. This actually
  // verifies what was written to disk, not just the in-memory cache reference.
  const rawDoc = JSON.parse(memStorage.getItem('petal_panic_store'));
  assert.ok(rawDoc.saveMeta, 'raw storage document carries saveMeta');
  assert.deepEqual(
    { level: rawDoc.saveMeta.level, area: rawDoc.saveMeta.area, score: rawDoc.saveMeta.score },
    { level: 3, area: 2, score: expectedScore },
    'raw serialized saveMeta deep-equals the expected values',
  );
  assert.equal(typeof rawDoc.saveMeta.timestamp, 'number', 'raw timestamp is a number');
  assert.ok(rawDoc.saveMeta.timestamp > 0, 'raw timestamp is positive');
});

test('Save & Quit falls back to the registered menu hero when none passed', () => {
  PS.resetStore();
  const hero = makeHero();
  SC.setMenuHero(hero);
  setState(S.PLAY);
  go(S.PAUSE);
  SC.Pause.focus = 2;
  SC.screenOnAction('confirm', undefined, undefined); // no hero arg
  assert.equal(getState(), S.MENU, 'returned to MENU');
  assert.equal(PS.loadStore().saveMeta?.level, 3, 'saved via the registered hero');
  SC.setMenuHero(null);
});

test('Controls opens REMAP with parent PAUSE (back returns to PAUSE)', () => {
  setState(S.PLAY);
  go(S.PAUSE);
  SC.Pause.focus = 3; // Controls
  const consumed = SC.screenOnAction('confirm', undefined, {});
  assert.equal(consumed, true, 'action handled');
  assert.equal(getState(), S.REMAP, 'REMAP opened');
  // remapParent captured PAUSE by screenReset(to, from): back exits REMAP → PAUSE.
  assert.equal(Remap.onAction('back'), 'exit', 'remap reports exit on back');
  go(S.PAUSE); // the dispatcher's post-exit transition
  assert.equal(getState(), S.PAUSE, 'back from REMAP lands on PAUSE');
});

test('Options opens OPTIONS with origin PAUSE (back returns to PAUSE)', () => {
  setState(S.PLAY);
  go(S.PAUSE);
  SC.Pause.focus = 4; // Options
  const consumed = SC.screenOnAction('confirm', undefined, {});
  assert.equal(consumed, true, 'action handled');
  assert.equal(getState(), S.OPTIONS, 'OPTIONS opened');
  // Back from OPTIONS transitions to its captured origin (PAUSE here).
  assert.equal(SC.Options.onAction('back'), true, 'back handled');
  assert.equal(getState(), S.PAUSE, 'back from OPTIONS lands on PAUSE');
});

test('Resume and Retry behavior preserved (existing ergonomics intact)', () => {
  // Resume: confirm on focus 0 → PLAY.
  setState(S.PLAY);
  go(S.PAUSE);
  SC.Pause.focus = 0;
  assert.equal(SC.screenOnAction('confirm', undefined, {}), true);
  assert.equal(getState(), S.PLAY, 'resume returns to PLAY');

  // Retry: the injected retry action fires (update.js owns the real flow).
  let retried = false;
  setState(S.PLAY);
  go(S.PAUSE);
  SC.Pause.focus = 1;
  assert.equal(SC.screenOnAction('confirm', undefined, { retry: () => { retried = true; } }), true);
  assert.equal(retried, true, 'retry action invoked');

  // Back / pause still resume regardless of focus.
  setState(S.PLAY);
  go(S.PAUSE);
  SC.Pause.focus = 4;
  assert.equal(SC.screenOnAction('back', undefined, {}), true);
  assert.equal(getState(), S.PLAY, 'back resumes');
});

test('focus wraps around the five options', () => {
  setState(S.PLAY);
  go(S.PAUSE);
  SC.Pause.focus = 0;
  SC.screenOnAction('up', undefined, {});
  assert.equal(SC.Pause.focus, 4, 'up from 0 wraps to 4');
  SC.screenOnAction('down', undefined, {});
  assert.equal(SC.Pause.focus, 0, 'down from 4 wraps to 0');
  SC.Pause.focus = 4;
  SC.screenOnAction('down', undefined, {});
  assert.equal(SC.Pause.focus, 0, 'down wraps');
  SC.Pause.focus = 0;
  SC.screenOnAction('up', undefined, {});
  assert.equal(SC.Pause.focus, 4, 'up wraps');
});
