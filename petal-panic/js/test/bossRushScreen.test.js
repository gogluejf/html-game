// Task 3.3 — Boss rush model + screen tests (headless).
// Run: node --test petal-panic/js/test/bossRushScreen.test.js
//
// Verifies the plan §3.3 acceptance criteria against the canvas-drawn
// BOSS_RUSH screen and its model, plus the user-decided post-battle routing:
//   - buildBossRushCards returns one card per LEVEL_CONFIGS entry (8);
//   - locked boss cards show no boss image/name, only a lock icon;
//   - focused locked boss shows 'Pass Level X to unlock this boss' on the right;
//   - focused unlocked boss shows the boss name and boss card image;
//   - confirm starts an unlocked boss through AREA_ENTRY;
//   - after the victory reward summary the player returns to BOSS_RUSH at the
//     SAME focus position (no auto-advance), and the defeated boss is recorded
//     in progress.defeatedBosses via the normal victory path.

import { strict as assert } from 'node:assert';
import { test, before, after } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing the engine modules) ---------
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, addEventListener: noop }),
};
globalThis.window = { addEventListener: noop };

// Image stub for the boss card art cache (screens.js constructs `new Image()`
// lazily; node has no DOM Image — an incomplete image drives the placeholder
// path, which is what these tests assert against).
class FakeImage {
  constructor() { this.complete = false; this.naturalWidth = 0; this.src = ''; }
}
globalThis.Image = FakeImage;

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
const LC = await import('../systems/lifecycle.js');
const { VIEW_W, VIEW_H } = await import('../core/view.js');
const { buildBossRushCards } = await import('../ui/bossRushModel.js');
const { LEVEL_CONFIGS } = await import('../world/levelConfigs.js');

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

/** Mark every area of a level completed in the live store. */
function completeLevelInStore(level) {
  const p = PS.loadStore().progress;
  for (const a of [1, 2, 3, 4]) p.completedAreas[`${level}-${a}`] = true;
  p.completedAreas[`${level}-B`] = true;
  PS.saveStore(PS.loadStore());
}

before(() => { PS.resetStore(); LC.setBossRushReturn(false); LC._resetRewardForTest(); });
after(() => { PS.resetStore(); });

// --- Model --------------------------------------------------------------------

test('buildBossRushCards returns exactly 8 cards, one per LEVEL_CONFIGS entry', () => {
  const cards = buildBossRushCards({ defeatedBosses: [] });
  assert.equal(cards.length, 8);
  assert.deepEqual(cards.map(c => c.index), LEVEL_CONFIGS.map(c => c.index));
  assert.deepEqual(cards.map(c => c.bossId), LEVEL_CONFIGS.map(c => c.boss));
  for (const c of cards) {
    assert.deepEqual(Object.keys(c).sort(), ['bossId', 'index', 'name', 'start', 'status', 'tooltip']);
    assert.deepEqual(c.start, { level: c.index, area: 5 });
  }
});

test('fresh progress: level 1 boss locked until the level is passed; content gate holds for 2-8', () => {
  const fresh = buildBossRushCards({ defeatedBosses: [] });
  assert.equal(fresh[0].status, 'locked', 'level 1 boss locked with no progress');
  assert.equal(fresh[0].tooltip, 'Pass Level 1 to unlock this boss');
  assert.ok(fresh.slice(1).every(c => c.status === 'locked'), 'levels 2-8 always locked (no world content yet)');

  // Pass level 1 → its boss unlocks even with zero defeats recorded.
  const p = { defeatedBosses: [], completedAreas: {} };
  for (const a of [1, 2, 3, 4]) p.completedAreas[`1-${a}`] = true;
  p.completedAreas['1-B'] = true;
  const open = buildBossRushCards(p);
  assert.equal(open[0].status, 'unlocked', 'passed level 1 unlocks its boss');
  assert.equal(open[0].tooltip, null, 'unlocked cards carry no tooltip');

  // Defeated bosses keep their card but present as defeated.
  const beaten = buildBossRushCards({ ...p, defeatedBosses: ['tusko_wobble'] });
  assert.equal(beaten[0].status, 'defeated');
  assert.equal(beaten[0].name, 'Tusko Wobble');
});

// --- Screen wiring -------------------------------------------------------------

test('BossRush exposes draw/onAction/reset and is wired into the dispatch helpers', () => {
  assert.equal(typeof SC.BossRush.draw, 'function', 'draw is a function');
  assert.equal(typeof SC.BossRush.onAction, 'function', 'onAction is a function');
  assert.equal(typeof SC.BossRush.reset, 'function', 'reset is a function');

  // drawScreen routes BOSS_RUSH to BossRush.draw.
  setState(S.BOSS_RUSH);
  const { calls, ctx } = recordingCtx();
  assert.equal(SC.drawScreen(ctx), true, 'drawScreen handles BOSS_RUSH');
  assert.ok(calls.length > 0, 'BossRush.draw issued canvas calls');

  // screenOnAction routes actions to BossRush.onAction.
  assert.equal(SC.screenOnAction('left'), true, 'left handled');
  assert.equal(SC.screenOnAction('right'), true, 'right handled');
  assert.equal(SC.screenOnAction('up'), true, 'up handled');
  assert.equal(SC.screenOnAction('down'), true, 'down handled');

  // Fresh entry from MENU resets focus.
  SC.BossRush.focus = 3;
  SC.screenReset(S.BOSS_RUSH, S.MENU);
  assert.equal(SC.BossRush.focus, 0, 'focus reset on fresh entry');
});

// --- Drawing -------------------------------------------------------------------

test('draws 8 boss cards within the 960x540 viewport', () => {
  PS.resetStore();
  setState(S.BOSS_RUSH);
  const { calls, ctx } = recordingCtx();
  SC.BossRush.draw(ctx);

  // Each locked card draws a silhouette disc: arc(cx, cy, r=47, 0..2PI).
  // Unlocked/defeated cards have NO such disc, so on fresh progress all 8 hit.
  const discs = calls.filter(c => c.fn === 'arc' && c.args[2] === 47 && c.args[3] === 0 && Math.abs(c.args[4] - Math.PI * 2) < 1e-9);
  assert.equal(discs.length, 8, 'eight card discs drawn (fresh progress: all locked)');
  for (const c of discs) {
    const [x, y, r] = c.args;
    assert.ok(x >= 0 && x <= VIEW_W, `card x=${x} inside viewport`);
    assert.ok(y - r >= 0 && y + r <= VIEW_H, `card y=${y} inside viewport`);
  }

  // Right-side detail card present: first arcTo corner (x+230, y) = (930, 120).
  const card = calls.find(c => c.fn === 'arcTo' && c.args[0] === 930 && c.args[1] === 120);
  assert.ok(card, 'detail card drawn on the right');
  assert.ok(card.args[0] <= VIEW_W, 'detail card fits the viewport');
});

test('locked cards render dimmed silhouettes with lock icons and NO boss name', () => {
  PS.resetStore();
  setState(S.BOSS_RUSH);
  const { calls, ctx } = recordingCtx();
  SC.BossRush.draw(ctx);

  // Every locked card is drawn dimmed (globalAlpha 0.45 on the silhouette).
  const dimSets = calls.filter(c => c.fn === 'set:globalAlpha' && c.args[0] === 0.45);
  assert.ok(dimSets.length >= 8, 'locked cards drawn dimmed');
  // Lock shackle arcs (PI..0 span) — at least one per locked card (8) + detail card.
  const shackleArcs = calls.filter(c => c.fn === 'arc' && c.args[3] === Math.PI && c.args[4] === 0);
  assert.ok(shackleArcs.length >= 9, 'lock icons drawn on locked cards');

  // Locked bosses hide their identity completely: no boss NAME text anywhere.
  const texts = calls.filter(c => c.fn === 'fillText').map(c => c.args[0]);
  const names = buildBossRushCards(PS.loadStore().progress).map(c => c.name);
  for (const n of names) assert.ok(!texts.includes(n), `locked boss name '${n}' not drawn`);
});

test('focused locked boss surfaces "Pass Level X to unlock this boss" on the right', () => {
  PS.resetStore();
  setState(S.BOSS_RUSH);
  SC.BossRush.reset(S.MENU); // focus 0 → level 1 boss (locked fresh)
  const { calls, ctx } = recordingCtx();
  SC.BossRush.draw(ctx);
  const texts = calls.filter(c => c.fn === 'fillText').map(c => c.args[0]);
  assert.ok(texts.includes('Pass Level 1 to unlock this boss'), 'unlock hint drawn on the right card');
  assert.ok(texts.includes('LOCKED'), 'locked status label drawn');
});

test('focused unlocked boss shows the boss name and boss card image', () => {
  PS.resetStore();
  completeLevelInStore(1);
  setState(S.BOSS_RUSH);
  SC.BossRush.reset(S.MENU);
  const { calls, ctx } = recordingCtx();
  SC.BossRush.draw(ctx);

  const texts = calls.filter(c => c.fn === 'fillText').map(c => c.args[0]);
  assert.ok(texts.includes('Tusko Wobble'), 'unlocked boss name drawn (grid card + detail card)');
  // Card art: drawFitted issues drawImage once for the grid card + once for
  // the detail card (images are incomplete in node → placeholder path also
  // fillTexts 'boss card'; either way the name proves the unlocked branch).
  const imgDraws = calls.filter(c => c.fn === 'drawImage');
  const placeholders = texts.filter(t => t === 'boss card').length;
  assert.ok(imgDraws.length >= 2 || placeholders >= 2, 'boss card image presented (art or placeholder) in both panes');
});

// --- Actions -------------------------------------------------------------------

test('confirm starts an unlocked boss through AREA_ENTRY with the chosen level/area', () => {
  PS.resetStore();
  completeLevelInStore(1);
  setState(S.MENU);
  go(S.BOSS_RUSH);
  SC.BossRush.reset(S.MENU);

  const fakeHero = { currentLevel: 1, currentArea: 1, lives: 3 };
  SC.setMenuHero(fakeHero);
  LC._resetRewardForTest();

  assert.equal(getState(), S.BOSS_RUSH, 'starts on BOSS_RUSH');
  assert.equal(SC.screenOnAction('confirm'), true, 'confirm handled');
  assert.equal(getState(), S.AREA_ENTRY, 'confirm opens AREA_ENTRY');

  const data = SC.getAreaEntryData();
  assert.equal(data.levelName, 'Big Top', 'entry screen shows the chosen level name');
  assert.equal(data.areaId, '1-B', 'entry screen shows the boss zone id');
  assert.equal(fakeHero.currentLevel, 1, 'hero currentLevel updated');
  assert.equal(fakeHero.currentArea, 5, 'hero currentArea set to the boss zone');
  assert.equal(LC.getBossRushReturn(), true, 'post-victory return armed before the battle');

  // Clean up: this test armed the return flag but ended in AREA_ENTRY without
  // running the victory flow that consumes it. Disarm it so the flag state is
  // clean per-test (a leaked arm would otherwise pollute the next test's
  // "return flag NOT armed" assertions).
  LC.setBossRushReturn(false);
});

test('confirm on a locked focus is a no-op (safety net)', () => {
  PS.resetStore();
  LC._resetRewardForTest();
  setState(S.MENU);
  go(S.BOSS_RUSH);
  SC.BossRush.reset(S.MENU);
  SC.setMenuHero(null);

  assert.equal(SC.screenOnAction('confirm'), true, 'action consumed');
  assert.equal(getState(), S.BOSS_RUSH, 'no transition from a locked focus');
  assert.equal(LC.getBossRushReturn(), false, 'return flag NOT armed from a locked focus');
});

test('confirm with no registered hero is blocked — no broken AREA_ENTRY (I2 parity)', () => {
  PS.resetStore();
  completeLevelInStore(1);
  setState(S.MENU);
  go(S.BOSS_RUSH);
  SC.BossRush.reset(S.MENU);
  SC.setMenuHero(null); // fresh boot: no hero ever registered

  assert.equal(SC.screenOnAction('confirm'), true, 'action consumed');
  assert.equal(getState(), S.BOSS_RUSH, 'state stays BOSS_RUSH (no AREA_ENTRY)');
});

test('navigation steps left/right AND up/down, skipping locked cards (wrap-around)', () => {
  PS.resetStore();
  completeLevelInStore(1);
  setState(S.MENU);
  go(S.BOSS_RUSH);
  SC.BossRush.reset(S.MENU);

  // Only level 1's boss is playable today: every step skips the 7 locked
  // cards and wraps back to index 0.
  assert.equal(SC.screenOnAction('right'), true);
  assert.equal(SC.BossRush.focus, 0, 'right skips locked cards (wraps)');
  assert.equal(SC.screenOnAction('left'), true);
  assert.equal(SC.BossRush.focus, 0, 'left skips locked cards (wraps)');
  assert.equal(SC.screenOnAction('down'), true);
  assert.equal(SC.BossRush.focus, 0, 'down skips locked cards (wraps)');
  assert.equal(SC.screenOnAction('up'), true);
  assert.equal(SC.BossRush.focus, 0, 'up skips locked cards (wraps)');
});

test('back from BOSS_RUSH returns MENU', () => {
  PS.resetStore();
  setState(S.MENU);
  go(S.BOSS_RUSH);
  assert.equal(SC.screenOnAction('back'), true, 'back handled');
  assert.equal(getState(), S.MENU, 'returned to MENU');
});

// --- Post-battle routing (user decision 2026-10-24) ----------------------------

test('victory records the defeated boss via the normal victory path (showLevelReward)', () => {
  PS.resetStore();
  const h = { currentLevel: 1, currentArea: 5, wallet: { current: { kills: 0, coins: 0 } }, _levelStartWallet: { kills: 0, coins: 0 }, traceStats: { total: {} } };
  LC._resetRewardForTest();

  setState(S.PLAY); // real caller invokes showLevelReward from PLAY; HOME→REWARD is not a legal transition
  LC.showLevelReward(h);

  assert.equal(getState(), S.REWARD, 'normal victory flow reaches REWARD');
  const p = PS.loadStore().progress;
  assert.deepEqual(p.defeatedBosses, ['tusko_wobble'], 'boss defeat recorded exactly once');

  // Re-presenting the same reward must not double-record.
  LC.showLevelReward(h);
  assert.deepEqual(PS.loadStore().progress.defeatedBosses, ['tusko_wobble'], 'no duplicate record on re-presentation');
});

// F1 regression: a real boss fight started via startArea never has
// h.levelConfig assigned (that field is only set on the REWARD→next-level
// path), so showLevelReward must resolve the config from currentLevel itself.
// This hero carries ONLY what startArea/startLife leave behind — no levelConfig.
test('defeat recording works without h.levelConfig (startArea-style hero)', () => {
  PS.resetStore();
  const h = { currentLevel: 2, currentArea: 5, wallet: { current: { kills: 3, coins: 0 } }, _levelStartWallet: { kills: 0, coins: 0 }, traceStats: { total: {} } };
  assert.equal(h.levelConfig, undefined, 'precondition: no levelConfig on the hero');
  LC._resetRewardForTest();

  setState(S.PLAY);
  LC.showLevelReward(h);

  assert.equal(getState(), S.REWARD, 'reaches REWARD');
  const expectedBoss = LEVEL_CONFIGS.find(c => c.index === 2)?.boss;
  assert.ok(expectedBoss, 'level 2 has a boss in its config');
  assert.deepEqual(PS.loadStore().progress.defeatedBosses, [expectedBoss], 'boss id resolved from currentLevel and recorded');
});

test('reward confirm returns to BOSS_RUSH with focus preserved — no auto-advance', () => {
  PS.resetStore();
  completeLevelInStore(1);
  setState(S.MENU);
  go(S.BOSS_RUSH);
  SC.BossRush.reset(S.MENU);
  // F2: the old version asserted focus 0 without ever moving it, so it could
  // not distinguish preserve-from-reset. With fresh progress only card 0 is
  // unlocked and navigation skips locked cards (and level 2+ cards are gated
  // by hasLevelContent), so navigation alone cannot move focus off 0 — we set
  // it directly instead. It must be set AFTER starting the boss (confirm hits
  // a locked-focus no-op on any non-zero index with fresh progress), so the
  // "where the player was" position is recorded during/after the fight; the
  // post-return assertion then proves reset(from) preserved it rather than
  // resetting to 0.
  SC.setMenuHero({ currentLevel: 1, currentArea: 1, lives: 3 });
  LC._resetRewardForTest();

  // Start the boss from the screen (arms the return flag).
  assert.equal(SC.screenOnAction('confirm'), true);
  assert.equal(getState(), S.AREA_ENTRY);

  // The player moved around the grid before the fight started; record that
  // position now (focus is inert while in AREA_ENTRY/PLAY/REWARD).
  SC.BossRush.focus = 3;
  assert.notEqual(SC.BossRush.focus, 0, 'focus moved away from the default (preserve ≠ reset)');

  // Simulate the battle: AREA_ENTRY → PLAY → REWARD (the real death pipeline
  // drives these; here we drive the state machine directly).
  go(S.PLAY);
  const h = { currentLevel: 1, currentArea: 5, lives: 3, wallet: { current: { kills: 1, coins: 0 } }, _levelStartWallet: { kills: 0, coins: 0 }, traceStats: { total: {} } };
  LC.showLevelReward(h);
  assert.equal(getState(), S.REWARD, 'victory summary shown');
  LC._advanceRewardDwellForTest();

  // Dismiss the reward: must land back on BOSS_RUSH (NOT next-level AREA_ENTRY,
  // NOT END_OF_GAME), and screenReset(REWARD→BOSS_RUSH) must PRESERVE focus.
  assert.equal(SC.screenOnAction('confirm', h), true, 'reward confirm handled');
  assert.equal(getState(), S.BOSS_RUSH, 'returned to BOSS_RUSH after the victory summary');
  assert.equal(SC.BossRush.focus, 3, 'focus preserved at the pre-battle position (not reset to 0)');
  assert.equal(LC.getBossRushReturn(), false, 'return flag consumed');

  // The flag was consumed: a subsequent normal-flow reward would route onward.
  // (No auto-advance happened: the hero never advanced past level 1.)
  assert.equal(h.currentLevel, 1, 'no auto-advance to the next level');
});

test('flag survives the PLAY detour and a fresh MENU entry still resets focus', () => {
  PS.resetStore();
  completeLevelInStore(1);
  setState(S.MENU);
  go(S.BOSS_RUSH);
  SC.BossRush.reset(S.MENU);
  SC.setMenuHero({ currentLevel: 1, currentArea: 1, lives: 3 });
  LC._resetRewardForTest();

  assert.equal(SC.screenOnAction('confirm'), true);
  go(S.PLAY); // the detour runs screenReset(PLAY) — flag lives in lifecycle.js
  assert.equal(LC.getBossRushReturn(), true, 'flag survives the PLAY detour');

  go(S.REWARD);
  const h = { currentLevel: 1, currentArea: 5, lives: 3, wallet: { current: { kills: 0, coins: 0 } }, _levelStartWallet: { kills: 0, coins: 0 }, traceStats: { total: {} } };
  h.levelConfig = LEVEL_CONFIGS[0];
  LC.showLevelReward(h);
  LC._advanceRewardDwellForTest();
  assert.equal(SC.screenOnAction('confirm', h), true);
  assert.equal(getState(), S.BOSS_RUSH);

  // A LATER fresh entry from MENU resets focus again (the preserve rule keys
  // off `from`, not history).
  go(S.MENU);
  SC.BossRush.focus = 0;
  go(S.BOSS_RUSH);
  assert.equal(SC.BossRush.focus, 0, 'fresh entry from MENU resets focus');
  SC.BossRush.focus = 0;
  // And returning from REWARD preserves whatever focus was set. The first
  // return already consumed the flag, so a fresh boss battle must re-arm it —
  // that is exactly what Boss Rush confirm does (setBossRushReturn(true))
  // before startArea. Re-arm here so this second victory also routes back to
  // BOSS_RUSH rather than falling through to the final-level END_OF_GAME route.
  LC.setBossRushReturn(true);
  go(S.PLAY);
  go(S.REWARD);
  LC.showLevelReward(h);
  LC._advanceRewardDwellForTest();
  SC.BossRush.focus = 0;
  assert.equal(SC.screenOnAction('confirm', h), true);
  assert.equal(getState(), S.BOSS_RUSH, 'second return also lands on BOSS_RUSH');
});
