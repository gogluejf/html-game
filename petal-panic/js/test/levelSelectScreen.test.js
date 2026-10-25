// Task 3.2 — Level select screen tests (headless). Grid rework.
// Run: node --test petal-panic/js/test/levelSelectScreen.test.js
//
// Verifies the canvas-drawn LEVEL_SELECT screen against the plan's acceptance
// criteria (8×5 stage-cell grid):
//   - draws 40 stage cells within 960x540 without overflow;
//   - locked cells render dimmed with a lock icon (draw runs clean);
//   - focused locked cell shows 'Pass <previous stage> to unlock' on the right
//     (the model tooltip is surfaced by the detail card);
//   - confirm starts an unlocked stage through AREA_ENTRY;
//   - back returns MENU; arrows move the cursor one cell, clamping at edges;
//   - reset lands the cursor on the next playable stage.

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
const { buildSubAreasForLevel, hasLevelContent } = await import('../ui/levelSelectModel.js');

// Cell geometry mirrored from screens.js's LevelSelect layout (test asserts
// the drawn arcTo corners against these; keep in sync if the layout moves).
const LS_CELL_W_TEST = 92, LS_CELL_H_TEST = 46;
const LS_GRID_CX0_TEST = 170, LS_GRID_CY0_TEST = 138;
const LS_CELL_DX_TEST = 104, LS_CELL_DY_TEST = 54;
const LS_CARD_X_TEST = 700, LS_CARD_Y_TEST = 110, LS_CARD_W_TEST = 240;

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
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 0, zoneIdx: 0 }, 'focus reset on entry (fresh progress)');
});

test('draws the 8×5 stage-cell grid within the 960x540 viewport', () => {
  PS.resetStore();
  setState(S.LEVEL_SELECT);
  const { calls, ctx } = recordingCtx();
  SC.LevelSelect.draw(ctx);

  // 40 stage cells → the helper roundRect() issues one arcTo(x+w, y, ...) per
  // cell; with cell centers at (170 + c*104, 140 + r*54) and top-left corner
  // (centerX - 46, centerY - 23), the first corner x values are unique per
  // column: 124, 228, 332, 436, 540.
  const colCornerXs = [124, 228, 332, 436, 540];
  for (let c = 0; c < 5; c++) {
    const rightX = colCornerXs[c];
    let count = 0;
    for (let r = 0; r < 8; r++) {
      const topY = LS_GRID_CY0_TEST + r * LS_CELL_DY_TEST - LS_CELL_H_TEST / 2;
      const hits = calls.filter(cl => cl.fn === 'arcTo' && cl.args[0] === rightX && cl.args[1] === topY);
      assert.ok(hits.length >= 1, `cell (${r},${c}) at x=[${rightX - LS_CELL_W_TEST},${rightX}] y=${topY} drawn`);
      count += hits.length;
    }
    assert.equal(count, 8, `column ${c} has 8 cells`);
    // All cells inside the viewport.
    assert.ok(rightX - LS_CELL_W_TEST >= 0 && rightX <= VIEW_W, `column ${c} x inside viewport`);
  }
  const lastBottom = LS_GRID_CY0_TEST + 7 * LS_CELL_DY_TEST + LS_CELL_H_TEST / 2;
  assert.ok(lastBottom <= VIEW_H, 'last row bottom inside viewport');

  // Right-side detail card present: its first arcTo corner is (x+240, y) =
  // (940, 110), unique to the 240-wide card body.
  const card = calls.find(c => c.fn === 'arcTo' && c.args[0] === 940 && c.args[1] === 110);
  assert.ok(card, 'detail card drawn on the right');
  assert.ok(940 <= VIEW_W, 'detail card fits the viewport');
});

test('locked cells render dimmed with a lock icon (fresh progress: levels 2-8 locked)', () => {
  PS.resetStore();
  setState(S.LEVEL_SELECT);
  const { calls, ctx } = recordingCtx();
  SC.LevelSelect.draw(ctx);

  // Fresh progress: only level 1 is available → rows 2-8 fully locked (35
  // cells) plus 1-2..1-B locked (4 cells) = 39 locked cells, each drawn
  // dimmed (globalAlpha 0.45).
  const dimSets = calls.filter(c => c.fn === 'set:globalAlpha' && c.args[0] === 0.45);
  assert.ok(dimSets.length >= 39, `locked cells drawn dimmed (got ${dimSets.length})`);
  // Lock icons draw a semicircle shackle (arc with PI..0 span) — at least one
  // per locked cell (39) plus the detail card's lock.
  const shackleArcs = calls.filter(c => c.fn === 'arc' && c.args[3] === Math.PI && c.args[4] === 0);
  assert.ok(shackleArcs.length >= 39, `lock icons drawn on locked cells (got ${shackleArcs.length})`);
});

test('focused locked cell surfaces the "Pass <previous stage> to unlock" hint on the right', () => {
  PS.resetStore();
  setState(S.LEVEL_SELECT);

  // Focus a locked zone directly (grid navigation allows landing on locked
  // cells; this asserts the DETAIL CARD presentation the hover-style tooltip
  // lives in).
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

test('arrows move the cursor one cell on the grid, clamping at edges', () => {
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
  // Right steps one cell along the row (locked cells no longer block movement).
  assert.equal(SC.screenOnAction('right'), true);
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 0, zoneIdx: 1 }, 'right stepped one cell');
  assert.equal(SC.screenOnAction('left'), true);
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 0, zoneIdx: 0 }, 'left stepped back');
  // Left at the left edge clamps.
  assert.equal(SC.screenOnAction('left'), true);
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 0, zoneIdx: 0 }, 'left clamps at col 0');
  // Down steps one row (level 2 row exists even though content-less/locked).
  assert.equal(SC.screenOnAction('down'), true);
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 1, zoneIdx: 0 }, 'down stepped one row');
  // Up walks back to the top row.
  assert.equal(SC.screenOnAction('up'), true);
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 0, zoneIdx: 0 }, 'up stepped back to row 0');
});

test('cursor can travel the full grid to a far cell (7-3 reachable by walking)', () => {
  PS.resetStore();
  setState(S.MENU);
  go(S.LEVEL_SELECT);
  SC.LevelSelect.reset();
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 0, zoneIdx: 0 });

  // Walk to row 6 (level 7), col 2 (zone 3): 6 downs + 2 rights = 8 presses.
  for (let i = 0; i < 6; i++) assert.equal(SC.screenOnAction('down'), true);
  for (let i = 0; i < 2; i++) assert.equal(SC.screenOnAction('right'), true);
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 6, zoneIdx: 2 }, 'cursor at 7-3');
  // Edges clamp: further downs stop at row 7, rights at col 4.
  for (let i = 0; i < 5; i++) assert.equal(SC.screenOnAction('down'), true);
  for (let i = 0; i < 5; i++) assert.equal(SC.screenOnAction('right'), true);
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 7, zoneIdx: 4 }, 'clamped at bottom-right');
});

test('reset lands the cursor on the next playable stage', () => {
  PS.resetStore();
  const p = PS.loadStore().progress;
  p.completedAreas['1-1'] = true;
  p.completedAreas['1-2'] = true;
  PS.saveStore(PS.loadStore());
  setState(S.MENU);
  go(S.LEVEL_SELECT);

  // screenReset already ran via the transition; the cursor should sit on 1-3
  // (first unlocked non-completed cell).
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 0, zoneIdx: 2 }, 'cursor pre-placed on next playable stage (1-3)');

  // Explicit reset() call agrees.
  SC.LevelSelect.focus = { levelIdx: 7, zoneIdx: 4 };
  SC.LevelSelect.reset();
  assert.deepEqual(SC.LevelSelect.focus, { levelIdx: 0, zoneIdx: 2 }, 'reset() re-places on 1-3');
});

test('confirm on a locked focus is a no-op (safety net)', () => {
  PS.resetStore();
  setState(S.MENU);
  go(S.LEVEL_SELECT);
  SC.LevelSelect.reset();
  SC.setMenuHero(null);

  // Force focus onto a locked zone (grid navigation allows landing on it).
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
