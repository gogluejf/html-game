// Task 2.1 — Main menu state and routing tests (headless).
// Run: node --test petal-panic/js/test/stateMenu.test.js
//
// Verifies the new MENU/OPTIONS/LEVEL_SELECT/BOSS_RUSH/MEDIA states and their
// transition rules against the acceptance criteria of the menu-hub plan:
//   - HOME can transition to MENU;
//   - MENU can transition to every top-level destination;
//   - PAUSE can open OPTIONS and return to MENU or PLAY;
//   - LEVEL_SELECT and BOSS_RUSH can start play through AREA_ENTRY.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const { S, STATE_NAMES, getState, setState, canTransition, tryTransition, onTransition } =
  await import('../core/state.js');

test('menu hub states exist with unique ids', () => {
  for (const name of ['MENU', 'OPTIONS', 'LEVEL_SELECT', 'BOSS_RUSH', 'MEDIA']) {
    assert.equal(typeof S[name], 'number', `S.${name} is defined`);
    assert.equal(STATE_NAMES[S[name]], name, `STATE_NAMES round-trips ${name}`);
  }
  const ids = Object.values(S);
  assert.equal(new Set(ids).size, ids.length, 'all state ids are unique');
});

test('HOME can transition to MENU', () => {
  assert.ok(canTransition(S.HOME, S.MENU), 'HOME → MENU allowed');
});

test('MENU can transition to every top-level destination', () => {
  // §2.1 top-level destinations plus the two edges required by later plan
  // sections: HOME (§2.2 Back action) and AREA_ENTRY (§2.3 Continue flow).
  const destinations = [S.HOME, S.AREA_ENTRY, S.SELECT, S.PLAY, S.LEVEL_SELECT, S.BOSS_RUSH, S.MEDIA, S.REMAP, S.OPTIONS];
  for (const to of destinations) {
    assert.ok(canTransition(S.MENU, to), `MENU → ${STATE_NAMES[to]} allowed`);
  }
});

test('MENU does not transition to non-top-level states', () => {
  // Negative guard: anything outside the documented destination set must stay
  // blocked, so an accidental extra edge fails this test.
  const forbidden = [S.PAUSE, S.OVER, S.WIN, S.REWARD, S.END_OF_GAME];
  for (const to of forbidden) {
    assert.ok(!canTransition(S.MENU, to), `MENU → ${STATE_NAMES[to]} must be blocked`);
  }
});

test('PAUSE can open OPTIONS and return to MENU or PLAY', () => {
  assert.ok(canTransition(S.PAUSE, S.OPTIONS), 'PAUSE → OPTIONS allowed');
  assert.ok(canTransition(S.OPTIONS, S.MENU), 'OPTIONS → MENU allowed');
  assert.ok(canTransition(S.OPTIONS, S.PAUSE), 'OPTIONS → PAUSE allowed');
  assert.ok(canTransition(S.PAUSE, S.MENU), 'PAUSE → MENU allowed (save & quit)');
  assert.ok(canTransition(S.PAUSE, S.PLAY), 'PAUSE → PLAY still allowed');
});

test('LEVEL_SELECT and BOSS_RUSH can start play through AREA_ENTRY', () => {
  for (const from of [S.LEVEL_SELECT, S.BOSS_RUSH]) {
    assert.ok(canTransition(from, S.AREA_ENTRY), `${STATE_NAMES[from]} → AREA_ENTRY allowed`);
    assert.ok(canTransition(from, S.PLAY), `${STATE_NAMES[from]} → PLAY allowed`);
    assert.ok(canTransition(from, S.MENU), `${STATE_NAMES[from]} → MENU allowed (back)`);
  }
});

test('MEDIA only routes back to MENU', () => {
  assert.ok(canTransition(S.MEDIA, S.MENU), 'MEDIA → MENU allowed');
  assert.ok(!canTransition(S.MEDIA, S.PLAY), 'MEDIA → PLAY not allowed');
  assert.ok(!canTransition(S.MEDIA, S.HOME), 'MEDIA → HOME not allowed');
});

test('tryTransition enforces the map and fires listeners', () => {
  let seen = null;
  const off = onTransition((from, to) => { seen = [from, to]; });
  try {
    setState(S.HOME);
    assert.ok(tryTransition(S.MENU), 'HOME → MENU via tryTransition');
    assert.deepEqual(seen, [S.HOME, S.MENU]);
    assert.equal(getState(), S.MENU);
    assert.ok(tryTransition(S.HOME), 'MENU → HOME allowed (documented Back action, plan §2.2)');
    assert.equal(getState(), S.HOME);
    // Previously-forbidden edge stays blocked: MENU must not jump straight to OVER.
    setState(S.MENU);
    assert.ok(!tryTransition(S.OVER), 'MENU → OVER still blocked by the map');
    assert.equal(getState(), S.MENU, 'state unchanged after a blocked transition');
    assert.ok(tryTransition(S.AREA_ENTRY), 'MENU → AREA_ENTRY allowed (§2.3 Continue flow)');
    assert.equal(getState(), S.AREA_ENTRY);
  } finally {
    off();
    setState(S.HOME);
  }
});
