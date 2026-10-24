// Task 3.2 — Level select screen tests (headless).
// Run: node --test petal-panic/js/test/levelSelectScreen.test.js
//
// Verifies the canvas-drawn LEVEL_SELECT screen against the plan's acceptance
// criteria:
//   - draws 8 level markers and 5 sub-area chips without overflow at 960x540;
//   - locked cards show a lock icon and dimmed content (draw runs clean);
//   - focused locked card shows 'Pass <previous stage> to unlock' on the right
//     (the model tooltip is surfaced by the detail card);
//   - confirm starts an unlocked stage through AREA_ENTRY;
//   - back returns MENU; up/down/left/right navigate focus (skipping locks).

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
const { VIEW_W, VIEW_H } = await import('../core/view.js');
const { buildSubAreasForLevel, buildLevelMap, hasLevelContent } = await import('../ui/levelSelectModel.js');

// Chip geometry mirrored from screens.js's LevelSelect layout (test asserts
// the drawn arcTo corners against these; keep in sync if the layout moves).
const LS_CHIP_W_TEST = 74, LS_CHIP_H_TEST = 44;

/** Drive a transition through the real onTransition hook (screenReset etc.). */
function go(to) {
  const ok = tryTransition(to);
  if (!ok) throw new Error(`transition to ${to} failed`);
}

/** Record canvas draw calls so geometry can be asserted headlessly. */
function recordingCtx() {
  const calls = [];
  const base = {
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }),
  };
  const handler = {
    get(target, prop) {
      if (prop in target) return target[prop];
      // Property-style state (fillStyle, font, globalAlpha, ...) is set via
      // assignment; method-style drawing goes through the recorded function.
      return (...args) => { calls.push({ fn: String(prop), args }); };
    },
    set(target, prop, value) {
      target[prop] = value;
      calls.push({ fn: `set:${String(prop)}`, args: [value] });
      return true;
    },
  };
  return { calls, ctx: new Proxy(base, handler) };
}

before(() => { PS.resetStore(); });
after(() => { PS.resetStore(); });

test('LevelSelect exposes draw/onAction/reset and is wired into the dispatch helpers', () => {
  assert.equal(typeof SC.LevelSelect.draw, 'function', 'draw is a function');
  assert.equal(typeof SC.LevelSelect.onAction, 'function', 'onAction is a function');
  assert.equal(typeof SC.LevelSelect.reset, 'function', 'reset is a function');

  // drawScreen routes LEVEL_SELECT to LevelSelect.draw.
  setState(S.LEVEL_SELECT);
  const { calls, ctx } = recordingCtx();
  assert.equal(SC.drawScreen(ctx), true, 'drawScreen handles LEVEL_SELECT');
  assert.ok(calls.length > 0, 'LevelSelect.draw issued canvas calls');

  // screenOnAction routes actions to LevelSelect.onAction.
  assert.equal(SC.screenOnAction('down'), true, 'screenOnAction handles down');
  assert.equal(SC.screenOnAction('up'), true, 'screenOnAction handles up');
  assert.equal(SC.screenOnAction('left'), true, 'screenOnAction handles left');
  assert.equal(SC.screenOnAction('right'), true, 'screenOnAction handles right');

  // screenReset resets focus when entering LEVEL_SELECT.
  SC.LevelSelect.focus = { levelIdx: 3, zoneIdx: 2 };
  SC.screenReset(S.LEVEL_SELECT, S.MENU);
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 0, zoneIdx: 0 }, 'focus reset on entry');
});

test('draws 8 level markers and 5 sub-area chips within the 960x540 viewport', () => {
  PS.resetStore();
  setState(S.LEVEL_SELECT);
  const { calls, ctx } = recordingCtx();
  SC.LevelSelect.draw(ctx);

  // 8 marker discs → 8 arc() calls with radius 16 (the shackle arcs of the
  // lock icons have a much smaller radius, so r===16 isolates the markers).
  const markerArcs = calls.filter(c => c.fn === 'arc' && c.args[2] === 16);
  assert.equal(markerArcs.length, 8, 'eight level marker discs drawn');
  for (const c of markerArcs) {
    const [x, y, r] = c.args;
    assert.ok(x >= 0 && x <= VIEW_W, `marker x=${x} inside viewport`);
    assert.ok(y - r >= 0 && y + r <= VIEW_H, `marker y=${y} inside viewport`);
  }

  // 5 sub-area chips → the helper roundRect() issues one arcTo(x+w, y, ...)
  // per chip; with chip centers at x = 90 + i*84 (i=0..4) and top edge y=278,
  // the first corner is (centerX+37, 278).
  const chipCorners = [127, 211, 295, 379, 463];
  for (const rightX of chipCorners) {
    const hits = calls.filter(c => c.fn === 'arcTo' && c.args[0] === rightX && c.args[1] === 278);
    assert.ok(hits.length >= 1, `chip at x=[${rightX - LS_CHIP_W_TEST},${rightX}] drawn`);
    const bottomY = hits[0].args[3];
    assert.ok(rightX - LS_CHIP_W_TEST >= 0 && rightX <= VIEW_W, `chip x inside viewport`);
    assert.ok(278 >= 0 && bottomY <= VIEW_H, `chip y inside viewport`);
  }

  // Right-side detail card present: its first arcTo corner is (x+340, y) =
  // (900, 120), unique to the 340x240 card body.
  const card = calls.find(c => c.fn === 'arcTo' && c.args[0] === 900 && c.args[1] === 120);
  assert.ok(card, 'detail card drawn on the right');
  assert.ok(card.args[0] <= VIEW_W, 'detail card fits the viewport');
});

test('locked cards render dimmed with a lock icon (fresh progress: levels 2-8 locked)', () => {
  PS.resetStore();
  setState(S.LEVEL_SELECT);
  const { calls, ctx } = recordingCtx();
  SC.LevelSelect.draw(ctx);

  // Fresh progress: only level 1 is available → 7 locked markers, each drawn
  // dimmed (globalAlpha 0.45) with a padlock glyph (a small shackle arc).
  const dimSets = calls.filter(c => c.fn === 'set:globalAlpha' && c.args[0] === 0.45);
  assert.ok(dimSets.length >= 7, 'locked markers/chips drawn dimmed');
  // Lock icons draw a semicircle shackle (arc with PI..0 span) — at least one
  // per locked marker (7) plus the locked chip.
  const shackleArcs = calls.filter(c => c.fn === 'arc' && c.args[3] === Math.PI && c.args[4] === 0);
  assert.ok(shackleArcs.length >= 7, 'lock icons drawn on locked markers');
});

test('focused locked card surfaces the "Pass <previous stage> to unlock" hint on the right', () => {
  PS.resetStore();
  setState(S.LEVEL_SELECT);

  // Focus a locked zone directly (navigation skips locks; this asserts the
  // DETAIL CARD presentation the hover-style tooltip lives in).
  SC.LevelSelect.focus = { levelIdx: 0, zoneIdx: 1 }; // 1-2 is locked fresh
  const zones = buildSubAreasForLevel(1, PS.loadStore().progress);
  assert.equal(zones[1].status, 'locked', 'precondition: 1-2 is locked');
  assert.equal(zones[1].tooltip, 'Pass 1-1 to unlock', 'model tooltip names the gate');

  const { calls, ctx } = recordingCtx();
  SC.LevelSelect.draw(ctx);
  const texts = calls.filter(c => c.fn === 'fillText').map(c => c.args[0]);
  assert.ok(texts.includes('Pass 1-1 to unlock'), 'unlock hint text drawn on the right card');
  assert.ok(texts.includes('LOCKED'), 'locked status label drawn');
});

test('confirm starts an unlocked stage through AREA_ENTRY with the chosen level/area', () => {
  PS.resetStore();
  setState(S.MENU);
  go(S.LEVEL_SELECT);
  SC.LevelSelect.reset();

  const fakeHero = { currentLevel: 1, currentArea: 1, lives: 3 };
  SC.setMenuHero(fakeHero);

  assert.equal(getState(), S.LEVEL_SELECT, 'starts on LEVEL_SELECT');
  assert.equal(SC.screenOnAction('confirm'), true, 'confirm handled');
  assert.equal(getState(), S.AREA_ENTRY, 'confirm opens AREA_ENTRY');

  const data = SC.getAreaEntryData();
  assert.equal(data.levelName, 'Big Top', 'entry screen shows the chosen level name');
  assert.equal(data.areaId, '1-1', 'entry screen shows the chosen area id');
  assert.equal(fakeHero.currentLevel, 1, 'hero currentLevel updated');
  assert.equal(fakeHero.currentArea, 1, 'hero currentArea updated');
});

test('confirm navigates to another unlocked stage after completing the previous ones', () => {
  PS.resetStore();
  const p = PS.loadStore().progress;
  p.completedAreas['1-1'] = true;
  PS.saveStore(PS.loadStore());
  setState(S.MENU);
  go(S.LEVEL_SELECT);
  SC.LevelSelect.reset();
  SC.setMenuHero({ currentLevel: 1, currentArea: 1, lives: 3 });

  // Zone 1-1 is completed; right steps to the next UNLOCKED zone (1-2).
  assert.equal(SC.screenOnAction('right'), true);
  const zones = buildSubAreasForLevel(1, PS.loadStore().progress);
  assert.equal(zones[SC.LevelSelect.focus.zoneIdx].label, '1-2', 'focus moved to 1-2');

  assert.equal(SC.screenOnAction('confirm'), true);
  assert.equal(getState(), S.AREA_ENTRY, 'confirm opened AREA_ENTRY');
  assert.equal(SC.getAreaEntryData().areaId, '1-2', 'entry screen shows 1-2');
});

test('confirm on a locked focus is a no-op (safety net)', () => {
  PS.resetStore();
  setState(S.MENU);
  go(S.LEVEL_SELECT);
  SC.LevelSelect.reset();
  SC.setMenuHero(null);

  // Force focus onto a locked zone (navigation would skip it).
  SC.LevelSelect.focus = { levelIdx: 0, zoneIdx: 2 }; // 1-3 locked fresh
  assert.equal(SC.screenOnAction('confirm'), true, 'action consumed');
  assert.equal(getState(), S.LEVEL_SELECT, 'no transition from a locked focus');
});

test('confirm with no registered hero is blocked — no broken AREA_ENTRY (I2)', () => {
  PS.resetStore();
  setState(S.MENU);
  go(S.LEVEL_SELECT);
  SC.LevelSelect.reset();
  SC.setMenuHero(null); // fresh boot: no hero ever registered

  assert.equal(SC.screenOnAction('confirm'), true, 'action consumed');
  assert.equal(getState(), S.LEVEL_SELECT, 'state stays LEVEL_SELECT (no AREA_ENTRY)');
});

test('levels without world content are locked with a clear reason (I1)', () => {
  PS.resetStore();
  const p = PS.loadStore().progress;
  // Complete level 1 fully so level 2 passes the progress gate.
  for (const a of [1, 2, 3, 4]) p.completedAreas[`1-${a}`] = true;
  p.completedAreas['1-B'] = true;
  PS.saveStore(PS.loadStore());

  const map = buildLevelMap(p);
  assert.equal(map[0].status, 'completed', 'level 1 (has content) completes normally');
  assert.equal(map[1].status, 'locked', 'level 2 locked despite predecessor completed — no LEVELS entry');

  const subs = buildSubAreasForLevel(2, p);
  assert.equal(subs[0].status, 'locked', '2-1 not startable without world content');
  assert.ok(String(subs[0].tooltip).toLowerCase().includes('content'),
    `tooltip names the missing-content reason, got: ${subs[0].tooltip}`);

  // Level 1 stages remain fully playable (content exists).
  const l1 = buildSubAreasForLevel(1, p);
  assert.equal(l1[0].status, 'completed');
  assert.ok(hasLevelContent(1), 'level 1 has world content');
  assert.ok(!hasLevelContent(2), 'level 2 has no world content yet');
});

test('back from LEVEL_SELECT returns MENU', () => {
  PS.resetStore();
  setState(S.MENU);
  go(S.LEVEL_SELECT);
  assert.equal(SC.screenOnAction('back'), true, 'back handled');
  assert.equal(getState(), S.MENU, 'returned to MENU');
});

test('up/down change the level and left/right change the zone, skipping locked entries', () => {
  PS.resetStore();
  const p = PS.loadStore().progress;
  // Complete level 1 fully so its zones are all unlocked/completed.
  for (const a of [1, 2, 3, 4]) p.completedAreas[`1-${a}`] = true;
  p.completedAreas['1-B'] = true;
  PS.saveStore(PS.loadStore());
  setState(S.MENU);
  go(S.LEVEL_SELECT);
  SC.LevelSelect.reset();

  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 0, zoneIdx: 0 });
  // I1: levels 2-8 have no world content yet, so navigation must skip them —
  // down from level 1 wraps back to level 1 (the only playable level today).
  assert.equal(SC.screenOnAction('down'), true);
  assert.equal(SC.LevelSelect.focus.levelIdx, 0, 'down skips content-less levels (wraps)');
  assert.equal(SC.screenOnAction('up'), true);
  assert.equal(SC.LevelSelect.focus.levelIdx, 0, 'up skips content-less levels (wraps)');

  // On fresh-ish level 1 (all areas done): every zone is unlocked/completed,
  // so right wraps cleanly through all five.
  assert.equal(SC.screenOnAction('right'), true);
  assert.equal(SC.LevelSelect.focus.zoneIdx, 1, 'right stepped the zone');
  assert.equal(SC.screenOnAction('left'), true);
  assert.equal(SC.LevelSelect.focus.zoneIdx, 0, 'left stepped back');
});
