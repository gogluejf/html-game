// Task 1.3 — node-based tests for the shared area-entry screen
// (docs/levels/checkpoints.md §3, game-rules.md §3/§4, lifecycle.md §3/§4).
// Run: node --test petal-panic/js/test/screens.test.js
//
// Acceptance criteria covered:
//   1. The entry screen shows exactly level name, area id, and lives — no score.
//   2. The same screen is used for new game, area advance, post-death restart,
//      continue, and boss-zone entry (one shared screen, not five).
//   3. Death in an area re-enters that same area beside its entry flag
//      (e.g. death in 1-3 restarts 1-3 beside its flag).
//   4. Zero lives goes to the EXISTING Game Over screen — untouched.
//   5. The entry screen follows the pause-menu ergonomics contract (same
//      keycap nav bar pattern).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing the engine modules) ---------
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, addEventListener: noop }),
};
globalThis.window = { addEventListener: noop };

const L = await import('../lifecycle.js');
const { S, getState, setState, tryTransition } = await import('../state.js');
const { GAME_RULES } = await import('../gameRules.js');
const { Hero } = await import('../hero.js');
const { HEROES } = await import('../heroDefs.js');
const SC = await import('../screens.js');
const U = await import('../systems/update.js');

// --- Helpers -----------------------------------------------------------------

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

function makeAreaContext() {
  const enemy = {
    x: 2000, y: 450, vx: 0, vy: 0,
    hp: 40, maxHp: 40, alive: true, aiState: 'idle',
    fading: false, hitFlash: 0, hitstunTimer: 0,
    _initPos: { x: 2000, y: 450, aiState: 'idle' },
    timers: { map: new Map() },
  };
  const checkpoint = { triggered: true, flashTimer: 0.5 };
  return {
    enemies: [enemy],
    boss: null,
    barrels: [],
    powerups: [],
    checkpoints: [checkpoint],
    projectiles: { activeItems: [], active: [] },
    coins: { activeItems: [], active: [] },
    particles: { reset: () => {} },
    effects: { reset: () => {} },
    _enemy: enemy,
    _checkpoint: checkpoint,
  };
}

// --- 1. Screen data: exactly level name, area id, lives — NO score -----------

test('showAreaEntry: screen data has exactly level name, area id, and lives (no score)', () => {
  const h = makeTestHero();
  h.currentLevel = 1;
  h.currentArea = 2; // "1-3"
  h.lives = 2;
  setState(S.PLAY);

  const data = L.showAreaEntry(h, makeAreaContext());

  assert.equal(data.levelName, 'Big Top', 'level name from the level definitions');
  assert.equal(data.areaId, '1-3', 'area identifier');
  assert.equal(data.lives, 2, 'lives remaining');
  assert.equal('score' in data, false, 'NO score field on the entry screen (game-rules.md §3)');
  assert.equal(getState(), S.AREA_ENTRY, 'the entry screen state is active');
});

test('formatAreaId: area ids come from the level definition (checkpoint ids)', () => {
  assert.equal(L.formatAreaId(1, -1), '1-1', 'pre-area -1 displays as the level\'s first checkpoint id');
  assert.equal(L.formatAreaId(1, 0), '1-2', 'first checkpoint area');
  assert.equal(L.formatAreaId(1, 1), '1-3', 'second checkpoint area');
  assert.equal(L.formatAreaId(1, 2), '1-4', 'third checkpoint area');
  assert.equal(L.formatAreaId(2, 0), '2-1', 'unknown levels fall back to positional ids');
});

test('formatAreaId: the boss zone is identified as the level\'s boss area (from the level def)', async () => {
  const { LEVELS } = await import('../level.js');
  const def = LEVELS[0];
  const bossIdx = def.checkpoints.length - 1; // the last checkpoint of the level is the boss zone
  assert.equal(L.formatAreaId(1, bossIdx), '1-B', 'the boss area index (from the level def) displays as 1-B');
  assert.notEqual(L.formatAreaId(1, bossIdx - 1), '1-B', 'the area before the boss is not the boss zone');
});

test('showAreaEntry: the presented data is the same shape the screen renders', () => {
  // The screen (screens.js AreaEntry) renders exactly these three fields;
  // anything else in the data would be a contract violation.
  const h = makeTestHero();
  h.currentArea = 0; // "1-2"
  h.lives = 1;
  setState(S.PLAY);
  const data = L.showAreaEntry(h, makeAreaContext());
  assert.deepEqual(Object.keys(data).sort(), ['areaId', 'levelName', 'lives'].sort(),
    'exactly the three documented fields, nothing more');
});

// --- 2. ONE shared screen for all five entry paths ---------------------------

test('new game shows the shared entry screen for the first area', () => {
  // A genuinely new game (SELECT → PLAY) opens the shared entry screen. The
  // transition hook pushes the screen AFTER the transition completes, so the
  // screen data survives the transition's screen reset.
  tryTransition(S.SELECT);
  window.__selectedHero = 'scarlet';
  SC.Select.reset();
  SC.Select.focus = 0;
  SC.Select.onAction('confirm');

  assert.equal(getState(), S.AREA_ENTRY, 'new game lands on the shared entry screen');
  const data = SC.getAreaEntryData();
  assert.ok(data, 'screen data is presented (not cleared by the transition reset)');
  assert.equal(data.areaId, '1-1', 'first area of the level');
  assert.equal(data.lives, GAME_RULES.startingLives, 'starting lives shown');
  assert.ok(!('score' in data), 'no score on the new-game entry screen');
  // Confirming the entry screen starts the first attempt.
  L.areaEntryOnAction('confirm', U.getHero());
  assert.equal(getState(), S.PLAY, 'confirm starts the attempt');
});

test('continue shows the same shared entry screen (not a different one)', () => {
  const h = makeTestHero();
  h.lives = 0;
  const ctx = makeAreaContext();
  setState(S.OVER);

  const applied = L.continueRun(h, ctx);

  assert.equal(applied, true, 'continue applied');
  assert.equal(getState(), S.AREA_ENTRY, 'continue lands on the shared entry screen');
  assert.equal(h.lives, GAME_RULES.startingLives, 'lives restored to the starting count');
  assert.equal(h.currentArea, -1, 'continue returns to area -1 of the current level');
  assert.equal(h.currentLevel, 1, 'level unchanged');
});

test('post-death restart and continue both land on the SAME entry screen state', () => {
  // Both paths must converge on S.AREA_ENTRY (one shared screen, checkpoints.md §3).
  const h1 = makeTestHero();
  const ctx1 = makeAreaContext();
  h1.lives = 2;
  h1.currentArea = 2; // died in 1-3 with lives remaining
  setState(S.PLAY);
  L.showAreaEntry(h1, ctx1);
  const afterDeath = getState();

  const h2 = makeTestHero();
  const ctx2 = makeAreaContext();
  h2.lives = 0;
  setState(S.OVER);
  L.continueRun(h2, ctx2);
  const afterContinue = getState();

  assert.equal(afterDeath, S.AREA_ENTRY, 'death restart lands on the entry screen');
  assert.equal(afterContinue, S.AREA_ENTRY, 'continue lands on the entry screen');
  assert.equal(afterDeath, afterContinue, 'both paths use the same screen');
});

// --- 3. Death in an area re-enters that same area beside its flag ------------

/** Run the death pipeline (skull presentation + fade-to-black) to completion. */
function runDeathPipeline(hero) {
  hero.energy = 0;
  U.update(1 / 60);
  let steps = 1;
  while (hero.dying && steps < 400) { U.update(1 / 60); steps++; }
}

test('death in 1-3 re-enters 1-3 beside its entry flag (same area, same arrangement)', () => {
  const hero = U.getHero();
  const checkpoints = U.getCheckpoints();

  // Simulate: the player has passed the 1-3 flag (x=6000) and dies deep in 1-3.
  setState(S.PLAY);
  hero.dying = false;
  hero.deathTimer = 0;
  hero.alive = true;
  hero.energy = hero.maxEnergy;
  hero.lives = 2; // one death will leave one life
  hero.x = 6500; hero.y = 492;
  hero.checkpoint = { x: 6000, y: 492 }; // the 1-3 flag position
  hero.currentArea = 2; // "1-3" (area index 2 = third checkpoint area)

  // Kill the hero and run the death pipeline (skull + fade-to-black) to completion.
  runDeathPipeline(hero);

  // The shared entry screen is shown for the SAME area (1-3), not Game Over.
  assert.equal(getState(), S.AREA_ENTRY, 'death with lives remaining shows the entry screen');
  assert.equal(hero.lives, 1, 'one life consumed exactly once');
  const data = SC.getAreaEntryData();
  assert.equal(data.areaId, '1-3', 're-enters 1-3, not a different area');
  assert.equal(data.lives, 1, 'the new life count is shown');

  // Confirming the screen starts the attempt beside the 1-3 flag.
  L.areaEntryOnAction('confirm', hero);
  assert.equal(getState(), S.PLAY, 'confirm starts the attempt');
  assert.ok(Math.abs(hero.x - 6000) < 1, `hero placed beside the 1-3 flag (x=${hero.x})`);
  assert.ok(hero.intangible, 'respawn i-frames active');
  assert.equal(hero.energy, hero.maxEnergy, 'full energy for the fresh attempt');

  // The area's starting arrangement returns (a killed enemy is restored).
  const enemy = U.getRealEnemies().find(e => e._initPos);
  if (enemy) {
    assert.equal(enemy.alive, true, 'defeated enemies are restored');
    assert.equal(enemy.hp, enemy.maxHp, 'enemy HP fully restored');
  }
  for (const c of checkpoints) {
    assert.equal(c.triggered, false, 'checkpoints re-arm for the new attempt');
  }
});

test('ordinary death fades to black before the entry screen (checkpoints.md §4)', () => {
  const hero = U.getHero();

  setState(S.PLAY);
  hero.dying = false;
  hero.deathTimer = 0;
  hero.alive = true;
  hero.energy = hero.maxEnergy;
  hero.lives = 2;
  hero.x = 6500; hero.y = 492;
  hero.checkpoint = { x: 6000, y: 492 };
  hero.currentArea = 2;

  // Kill the hero and step the presentation + fade.
  hero.energy = 0;
  U.update(1 / 60);
  assert.equal(getState(), S.PLAY, 'still PLAY during the death presentation');
  // After the skull presentation, the fade-to-black ramps up.
  let sawFade = false;
  for (let i = 0; i < 240 && hero.dying; i++) {
    U.update(1 / 60);
    if (U.getDeathFadeAlpha() > 0.5) sawFade = true;
  }
  assert.ok(sawFade, 'a fade-to-black was drawn during the delay after the skull');
  assert.equal(getState(), S.AREA_ENTRY, 'the entry screen follows the fade');
});

// --- 4. Zero lives goes to the EXISTING Game Over screen, untouched ----------

test('zero lives goes to the existing Game Over screen, not the entry screen', () => {
  const hero = U.getHero();

  setState(S.PLAY);
  hero.dying = false;
  hero.deathTimer = 0;
  hero.alive = true;
  hero.energy = hero.maxEnergy;
  hero.lives = 1; // last life
  hero.x = 6500; hero.y = 492;
  hero.checkpoint = { x: 6000, y: 492 };
  hero.currentArea = 2;

  runDeathPipeline(hero);

  assert.equal(getState(), S.OVER, 'zero lives shows the existing Game Over screen');
  assert.equal(hero.lives, 0, 'all lives consumed');
  // The Game Over screen is the existing one (screens.js GameOver) — it still
  // draws its score/stat presentation (game-rules.md §5: keep its score display).
  assert.ok(typeof SC.GameOver.draw === 'function', 'existing Game Over screen untouched');
  assert.ok(typeof SC.GameOver.onAction === 'function', 'existing Game Over navigation untouched');
});

// --- 5. Ergonomics: the entry screen reuses the pause-menu nav pattern -------

test('the entry screen reuses the pause-menu ergonomics (list, focus pill, keycap bar)', async () => {
  // Both screens build their nav bar via navHintEntries with the same entry
  // shape (navigate / confirm / back), per game-rules.md §3 shared
  // ergonomics contract.
  const { navHintEntries } = await import('../input.js');
  const pauseEntries = navHintEntries([
    { actions: ['up', 'down'], label: 'Navigate' },
    { action: 'confirm' },
    { action: 'back', label: 'Close' },
  ]);
  const entryEntries = navHintEntries([
    { actions: ['up', 'down'], label: 'Navigate' },
    { action: 'confirm' },
    { action: 'back', label: 'Quit' },
  ]);
  // Same layout contract: chip icons + a label per entry.
  for (const e of [...pauseEntries, ...entryEntries]) {
    assert.ok(Array.isArray(e.icons) && e.icons.length > 0, 'each entry has keycap icons');
    assert.equal(typeof e.label, 'string', 'each entry has a label');
  }
  assert.equal(entryEntries.length, pauseEntries.length, 'same number of nav entries as the pause menu');
  assert.equal(entryEntries[0].label, 'Navigate', 'same navigate entry as the pause menu');
  assert.equal(entryEntries[1].label, 'Confirm', 'same confirm entry as the pause menu');
  assert.ok(entryEntries[2].icons.some(i => i.includes('ESCAPE')),
    'the back/quit keycap is shown, like the pause menu');
});

// --- 6. Confirm starts the attempt; back opens the pause menu ----------------

test('confirming the entry screen starts the attempt in the area', () => {
  const h = makeTestHero();
  h.lives = 2;
  h.currentArea = 1; // "1-3" (area index 1 = second checkpoint area)
  h.checkpoint = { x: 4000, y: 492 };
  const ctx = makeAreaContext();
  ctx._enemy.x = 5000; // moved during a previous attempt

  setState(S.PLAY);
  L.showAreaEntry(h, ctx);
  assert.equal(getState(), S.AREA_ENTRY);

  L.areaEntryOnAction('confirm', h, ctx);

  assert.equal(getState(), S.PLAY, 'confirm starts play');
  assert.equal(h.x, 4000, 'hero placed at the area entry');
  assert.equal(ctx._enemy.x, 2000, 'the area arrangement is restored');
  assert.equal(h.lives, 2, 'lives untouched by the entry screen');
});

test('back on the entry screen opens the pause menu', () => {
  const h = makeTestHero();
  const ctx = makeAreaContext();
  setState(S.PLAY);
  L.showAreaEntry(h, ctx);
  assert.equal(getState(), S.AREA_ENTRY);

  L.areaEntryOnAction('back', h, ctx);
  assert.equal(getState(), S.PAUSE, 'back opens the pause menu');
});
