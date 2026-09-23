// Task 6.2 — Level reward screen + continue crediting
// (docs/levels/boss-arena.md §4–5, game-rules.md §2–3, lifecycle.md §5).
// Run: node --test petal-panic/js/test/reward.test.js
//
// Source of truth:
//   docs/levels/boss-arena.md §4 — reward screen content (kills, score, coins,
//     continues earned); the screen presents the result ONCE and must not
//     credit rewards repeatedly while animating.
//   docs/levels/boss-arena.md §5 — after the reward screen the next level
//     starts at area -1 with its shared entry screen; the final level's
//     reward screen is followed by the end-of-game path, NOT a next level.
//   docs/levels/game-rules.md §2 — one continue per full 1000 coins
//     (GAME_RULES.coinsPerContinue, a global tuning value); the reward must
//     be credited once, not again because the screen redraws.
//   docs/levels/game-rules.md §3 — the reward screen shows enemies killed,
//     score, coins collected, continues earned and their credit to the
//     global pool; it follows the shared screen ergonomics contract.
//
// Acceptance criteria covered (task 6.2):
//   1. Screen shows kills, score, coins, continues earned.
//   2. Pool credited exactly once even if the screen redraws or animates.
//   3. 2500 coins credits 2 continues.
//   4. After the screen, the next level starts at area -1 with its entry
//      screen.
//   5. The final boss does not advance into a nonexistent level.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing the engine modules) ---------
const noop = () => {};
// measureText must return a shape with a numeric width (fonts.js drawNavBar
// reads it); a bare noop would return undefined and break the draw path.
const ctxStub = new Proxy({}, {
  get: (t, prop) => (prop === 'measureText' ? () => ({ width: 10 }) : noop),
  set: () => true,
});
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, addEventListener: noop }),
};
globalThis.window = { addEventListener: noop };

const L = await import('../lifecycle.js');
const { S, getState, setState } = await import('../state.js');
const { GAME_RULES } = await import('../gameRules.js');
const { Hero } = await import('../hero.js');
const { HEROES } = await import('../heroDefs.js');
const { LEVELS } = await import('../level.js');
const { createStats } = await import('../stats.js');
const SC = await import('../screens.js');
const U = await import('../systems/update.js');

// --- Helpers -----------------------------------------------------------------

/**
 * A hero with the post-startGame shape: continue pool + fresh run stats.
 * Uses the real createStats() for the tallies so the reward screen reads the
 * exact same shape production code produces.
 */
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
  h.runStats = createStats();
  h.runStats.bossKilled = true; // the reward screen is only shown post-boss
  return h;
}

/** Fill the hero's run stats with a known kill/coin tally. */
function tally(h, { kills = {}, coins = 0 } = {}) {
  for (const [k, n] of Object.entries(kills)) h.runStats.enemiesKilled[k] = n;
  h.runStats.coinsCollected.total = coins;
}

// Reset the global state machine to a clean baseline so each test starts
// from a known state regardless of what the previous test left behind.
// The previous test's rewardOnAction confirm runs startLife, which consumes
// the AREA_ENTRY→PLAY transition — so by the time the next test's
// showLevelReward tries PLAY→REWARD, the state is already PLAY and the
// transition is invalid. Resetting to PLAY before each test avoids this.
function resetState() {
  setState(S.PLAY);
}

// --- 1. Screen data: kills, score, coins, continues earned -------------------

test('showLevelReward presents the documented minimal set (kills, score, coins, continues earned)', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  tally(h, { kills: { jester: 5, vine_hound: 2 }, coins: 2500 });
  setState(S.PLAY);

  const data = L.showLevelReward(h);

  assert.equal(data.kills, 7, 'enemies killed is the sum over all enemy types');
  assert.equal(data.coins, 2500, 'coins collected');
  assert.equal(data.continuesEarned, 2, 'one continue per full 1000-coin chunk');
  assert.equal(typeof data.score, 'number', 'score is presented');
  assert.ok(data.score > 0, 'the score is non-trivial (kills + boss + coins)');
  assert.equal(getState(), S.REWARD, 'the reward screen state is active');
});

test('the reward screen data shape is exactly the documented fields (+ final-level flag)', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  tally(h, { kills: { jester: 1 }, coins: 100 });
  setState(S.PLAY);

  const data = L.showLevelReward(h);

  // game-rules.md §3: enemies killed, score, coins collected, continues
  // earned. continuesRemaining is the resulting global continue-pool balance
  // after the credit is applied (boss-arena.md §4: "visibly credit the global
  // continue counter"). isFinalLevel is the screen's own routing flag
  // (boss-arena.md §5).
  assert.deepEqual(Object.keys(data).sort(),
    ['coins', 'continuesEarned', 'continuesRemaining', 'isFinalLevel', 'kills', 'score'].sort(),
    'exactly the documented fields, nothing more');
});

test('continuesEarned: 2500 coins credits 2 continues; 999 credits 0; 1000 credits 1', () => {
  assert.equal(L.continuesEarned(2500), 2, 'each full 1000-coin chunk earns a continue');
  assert.equal(L.continuesEarned(999), 0, 'a partial chunk earns nothing');
  assert.equal(L.continuesEarned(1000), 1, 'exactly one chunk earns exactly one');
  assert.equal(L.continuesEarned(0), 0, 'no coins earns no continues');
  assert.equal(L.continuesEarned(3999), 3, 'remainder below the threshold does not carry');
});

// --- 2. Pool credited exactly once (redraw / animation safety) ----------------

test('the pool is credited exactly once even if the screen redraws or animates', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  tally(h, { kills: { jester: 1 }, coins: 2500 });
  const before = h.continues.remaining;
  setState(S.PLAY);

  L.showLevelReward(h);
  const afterFirst = h.continues.remaining;

  // Simulate a redraw / animation repeating the presentation.
  L.showLevelReward(h);
  L.showLevelReward(h);

  assert.equal(afterFirst, before + 2, 'the first presentation credits 2 continues (2500 coins)');
  assert.equal(h.continues.remaining, afterFirst, 'redraws do not re-credit the pool');
});

test('the pool is credited once even across a fresh screen presentation cycle', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  tally(h, { kills: { jester: 1 }, coins: 1500 });
  const before = h.continues.remaining;
  setState(S.PLAY);

  L.showLevelReward(h);
  assert.equal(h.continues.remaining, before + 1, '1500 coins credits exactly 1 continue');

  // Redraw: the screen re-presents the same data; the credit must not repeat.
  const data = L.getRewardData();
  assert.equal(data.continuesEarned, 1, 'the presented data still reports 1 earned');
  L.showLevelReward(h);
  assert.equal(h.continues.remaining, before + 1, 'still credited exactly once');
});

test('zero continues earned leaves the pool untouched', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  tally(h, { kills: { jester: 1 }, coins: 500 });
  const before = h.continues.remaining;
  setState(S.PLAY);

  const data = L.showLevelReward(h);

  assert.equal(data.continuesEarned, 0, '500 coins earns no continue');
  assert.equal(h.continues.remaining, before, 'the pool is untouched');
});

test('the credit goes to the GLOBAL continue pool (gameRules credit)', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  tally(h, { kills: { jester: 1 }, coins: 3000 });
  setState(S.PLAY);

  L.showLevelReward(h);

  // The presentation counts the reward, then visibly credits the continue
  // pool (game-rules.md §2). The pool object on the hero is the global
  // balance (game-rules.md §1); it is a remaining balance, not a fixed
  // maximum — it can grow past the starting 3.
  assert.equal(h.continues.remaining, GAME_RULES.startingContinues + 3, 'pool grew by 3 (3000 coins)');
});

// Blocker regression (game-rules.md §2; lifecycle.md §1): the exactly-once
// credit latch must be keyed to the REWARD, not to presentation state left over
// from a prior run. After finishing a game (final level → end-of-game path) and
// starting a NEW game, a genuinely new reward must still be credited — a stale
// presentation from the previous game must never suppress it.

test('a fresh run credits a new reward even after a previous run finished (blocker regression)', () => {
  // --- First game: finish the final level, confirm the end-of-game path. ---
  L._resetRewardForTest();
  resetState();
  const h1 = makeTestHero();
  h1.currentLevel = LEVELS.length; // final level
  tally(h1, { kills: { jester: 1 }, coins: 2000 });
  setState(S.PLAY);
  L.showLevelReward(h1);
  assert.equal(h1.continues.remaining, GAME_RULES.startingContinues + 2, 'first run credits 2 continues');
  L._advanceRewardDwellForTest(); L.rewardOnAction('confirm', h1); // final level → end-of-game screen
  assert.equal(getState(), S.END_OF_GAME, 'final level confirm shows the end-of-game screen');

  // --- New game: a genuinely new reward must be credited again. ---
  // startGame clears the presented-reward latch, so a new run's boss reward is
  // not suppressed by the previous run's presentation.
  const h2 = L.startGame({ world: null, oldHero: null, areaContext: null }, HEROES.scarlet);
  h2.currentLevel = 1;
  h2.runStats = createStats();
  h2.runStats.bossKilled = true;
  tally(h2, { kills: { jester: 1 }, coins: 2500 });
  setState(S.PLAY);
  L.showLevelReward(h2);
  assert.equal(h2.continues.remaining, GAME_RULES.startingContinues + 2,
    'the new run credits its own 2 continues (not suppressed by the prior run)');
});

// The credit latch is keyed to reward identity: a DIFFERENT reward (a
// different coin tally / level) is credited again, while a redraw of the SAME
// reward is not.

test('a different reward is credited again; a redraw of the same reward is not', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  tally(h, { kills: { jester: 1 }, coins: 2000 });
  const before = h.continues.remaining;
  setState(S.PLAY);

  L.showLevelReward(h);
  assert.equal(h.continues.remaining, before + 2, 'first reward (2000 coins) credits 2');

  // Redraw of the SAME reward: no re-credit.
  L.showLevelReward(h);
  assert.equal(h.continues.remaining, before + 2, 'redrawing the same reward does not re-credit');

  // A genuinely NEW reward (different coin tally): credited again.
  tally(h, { kills: { jester: 1 }, coins: 1000 });
  L.showLevelReward(h);
  assert.equal(h.continues.remaining, before + 3, 'a new reward (1000 coins) credits 1 more');
});

// --- 3. The screen presents the credited result (screens.js wiring) -----------

test('the screens.js reward screen presents the data lifecycle.js computes', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  tally(h, { kills: { jester: 4, boris_loon: 1 }, coins: 2000 });
  setState(S.PLAY);

  L.showLevelReward(h);

  const presented = SC.getRewardData();
  assert.ok(presented, 'screens.js received the reward data');
  assert.equal(presented.kills, 5, 'kills presented');
  assert.equal(presented.coins, 2000, 'coins presented');
  assert.equal(presented.continuesEarned, 2, 'continues earned presented');
  assert.equal(typeof presented.score, 'number', 'score presented');
  // The resulting global continue-pool balance is presented (boss-arena.md
  // §4: "visibly credit the global continue counter"): the screen shows the
  // pool AFTER the credit, not just the "+N" earned this level.
  assert.equal(presented.continuesRemaining,
    GAME_RULES.startingContinues + 2,
    'the resulting global continue-pool balance is presented (3 + 2 earned)');
  assert.ok(typeof SC.Reward.draw === 'function', 'the reward screen has a draw method');
});

test('the reward screen follows the shared ergonomics contract (keycap nav bar)', async () => {
  // game-rules.md §3: all screens share the same list layout, focus pill,
  // and button-instruction/keycap bar as the pause menu. The reward screen
  // builds its nav bar through the same navHintEntries() pattern.
  const { navHintEntries } = await import('../input.js');
  const entries = navHintEntries([{ action: 'confirm' }]);
  assert.ok(Array.isArray(entries) && entries.length === 1, 'a single confirm entry');
  assert.ok(Array.isArray(entries[0].icons) && entries[0].icons.length > 0, 'keycap icons present');
});

// --- 4. After the screen: next level starts at area -1 with its entry screen --

test('confirming the reward screen starts the next level at area -1 with its entry screen', async () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  h.currentLevel = 1;
  tally(h, { kills: { jester: 1 }, coins: 2500 });
  L.bindAreaContext(h, makeAreaContext(h));
  setState(S.PLAY);
  L.showLevelReward(h);
  assert.equal(getState(), S.REWARD);

  // The current build ships a single level (LEVELS.length === 1), so
  // level 1 is the final level. Temporarily extend LEVELS to simulate a
  // multi-level build so the next-level path is exercised.
  const savedLen = LEVELS.length;
  LEVELS.push({ name: 'Second Level' });
  try {
    L._advanceRewardDwellForTest(); L.rewardOnAction('confirm', h);
  } finally {
    LEVELS.length = savedLen;
  }

  assert.equal(getState(), S.AREA_ENTRY, 'the next level opens on the shared entry screen');
  assert.equal(h.currentLevel, 2, 'the level advanced');
  assert.equal(h.currentArea, -1, 'the next level starts at area -1');
  // Per-level reward accounting is reset for the new level (boss-arena.md §5):
  // the next level's reward must reflect THIS level only, not carry over the
  // previous level's kill/coin tally.
  assert.ok(h.runStats, 'a fresh per-level stats object is established for the next level');
  assert.equal(Object.values(h.runStats.enemiesKilled).reduce((a, b) => a + b, 0),
    0, 'per-level kill tally is reset for the next level');
  assert.equal(h.runStats.coinsCollected.total, 0, 'per-level coin tally is reset for the next level');
  const data = SC.getAreaEntryData();
  assert.ok(data, 'the entry screen data is presented');
  assert.equal(data.lives, h.lives, 'lives shown on the entry screen');
  assert.ok(!('score' in data), 'no score on the entry screen (game-rules.md §3)');
});

test('confirming the reward screen on the final level shows the end-of-game screen (not a next level)', async () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  h.currentLevel = LEVELS.length; // the final level
  tally(h, { kills: { jester: 1 }, coins: 1000 });
  setState(S.PLAY);
  L.showLevelReward(h);

  const data = L.getRewardData();
  assert.equal(data.isFinalLevel, true, 'the screen knows this is the final level');

  L._advanceRewardDwellForTest(); L.rewardOnAction('confirm', h);

  assert.equal(h.currentLevel, LEVELS.length, 'the level did NOT advance');
  assert.notEqual(getState(), S.AREA_ENTRY, 'no entry screen for a nonexistent next level');
  // lifecycle.md §5: after the final level's boss and its reward screen, a
  // minimal end-of-game screen is shown — congratulations + final score + a
  // single return-home option. It follows the shared ergonomics contract.
  // (Its full presentation is task 7.5's job; this is the placeholder path.)
  assert.equal(getState(), S.END_OF_GAME, 'the end-of-game screen appears (not a next level)');
  assert.equal(L.getRewardData(), null, 'the presented reward is consumed on confirm');
  // The end-of-game screen presents the final score (lifecycle.md §5).
  const { getEndOfGameScore } = SC;
  assert.ok(typeof getEndOfGameScore === 'function', 'the end-of-game screen exposes its final score');
  assert.equal(getEndOfGameScore(), data.score, 'the final score is the reward screen\'s score');
  assert.ok(typeof SC.EndOfGame.draw === 'function', 'the end-of-game screen has a draw method');

  // Confirming the end-of-game screen returns home (the single documented
  // option, lifecycle.md §5).
  assert.equal(SC.EndOfGame.onAction('confirm'), true, 'confirm on the end-of-game screen is handled');
  assert.equal(getState(), S.HOME, 'confirming the end-of-game screen returns home');
});

test('back on the reward screen quits to home (finding: nav bar Quit keycap)', async () => {
  // The reward screen's nav bar shows a "Quit" keycap (back action). The
  // state transition S.REWARD → S.HOME already exists; rewardOnAction must
  // handle the 'back' action and transition to HOME.
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  h.currentLevel = 1;
  tally(h, { kills: { jester: 1 }, coins: 1000 });
  setState(S.PLAY);
  L.showLevelReward(h);
  assert.equal(getState(), S.REWARD);

  assert.equal(L.rewardOnAction('back', h), true, 'the back action is handled');
  assert.equal(getState(), S.HOME, 'back quits the reward screen to home');
  assert.equal(L.getRewardData(), null, 'the presented reward is consumed on quit');
});

// --- 5. Runtime wiring: defeating the boss shows the reward screen ------------

test('runtime: defeating the boss transitions to the reward screen (not the placeholder WIN)', () => {
  const hero = U.getHero();
  const boss = U.getBoss();

  // Set up a PLAY state where the boss death pipeline fires this frame.
  setState(S.PLAY);
  hero.dying = false;
  hero.alive = true;
  hero.runStats.bossKilled = false;
  hero.runStats.coinsCollected.total = 2500;
  boss._deathHandled = false;
  boss.alive = false; // the death pipeline completed (timers expired)
  boss.active = true;

  U.update(1 / 60);

  assert.equal(getState(), S.REWARD, 'boss defeat shows the reward screen');
  assert.equal(hero.runStats.bossKilled, true, 'the boss kill is recorded');
  const data = SC.getRewardData();
  assert.ok(data, 'the reward screen data is presented');
  assert.equal(data.coins, 2500, 'the coins collected this level are presented');
  assert.equal(data.continuesEarned, 2, '2500 coins → 2 continues presented');

  // A further presentation (redraw/animation frames) must not re-credit.
  const after = hero.continues.remaining;
  L.showLevelReward(hero);
  assert.equal(hero.continues.remaining, after, 're-presenting the reward does not re-credit');
});

// --- End-of-game screen (lifecycle.md §5, task 7.5) ---------------------------
//
// The final level's reward confirm presents the minimal end-of-game screen:
// congratulations + final score + a single 'Return Home' option, following the
// shared screen ergonomics contract (game-rules.md §3).

test('end-of-game: the final level presents the congrats screen with the final score', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  h.currentLevel = LEVELS.length; // the final level
  tally(h, { kills: { jester: 3 }, coins: 1500 });
  setState(S.PLAY);

  const data = L.showLevelReward(h);
  assert.equal(data.isFinalLevel, true, 'the reward screen knows this is the final level');

  L._advanceRewardDwellForTest();
  L.rewardOnAction('confirm', h);

  assert.equal(getState(), S.END_OF_GAME, 'the congrats screen appears');
  assert.equal(SC.getEndOfGameScore(), data.score, 'the final score presented is the reward screen\'s score');
  assert.ok(SC.getEndOfGameScore() > 0, 'the final score is non-trivial');
  // The screen presents the score via its draw method (no exceptions on a
  // stub canvas).
  assert.doesNotThrow(() => SC.EndOfGame.draw(ctxStub), 'the end-of-game screen draws without error');
});

test('end-of-game: confirming the single option returns home', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  h.currentLevel = LEVELS.length;
  tally(h, { kills: { jester: 1 }, coins: 1000 });
  setState(S.PLAY);
  L.showLevelReward(h);
  L._advanceRewardDwellForTest();
  L.rewardOnAction('confirm', h);
  assert.equal(getState(), S.END_OF_GAME, 'the end-of-game screen is up');

  assert.equal(SC.EndOfGame.onAction('confirm'), true, 'confirm is handled');
  assert.equal(getState(), S.HOME, 'confirming the single option returns home');
});

test('end-of-game: back also returns home (nav bar return keycap)', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  h.currentLevel = LEVELS.length;
  tally(h, { kills: { jester: 1 }, coins: 500 });
  setState(S.PLAY);
  L.showLevelReward(h);
  L._advanceRewardDwellForTest();
  L.rewardOnAction('confirm', h);
  assert.equal(getState(), S.END_OF_GAME, 'the end-of-game screen is up');

  assert.equal(SC.EndOfGame.onAction('back'), true, 'back is handled');
  assert.equal(getState(), S.HOME, 'back returns home');
});

test('end-of-game: up/down keep the single option focused (no other action exists)', () => {
  setState(S.END_OF_GAME);
  assert.equal(SC.EndOfGame.onAction('up'), true, 'up is handled');
  assert.equal(SC.EndOfGame.focus, 0, 'up keeps focus on the single option');
  assert.equal(SC.EndOfGame.onAction('down'), true, 'down is handled');
  assert.equal(SC.EndOfGame.focus, 0, 'down keeps focus on the single option');
  assert.equal(getState(), S.END_OF_GAME, 'navigation does not leave the screen');
});

test('end-of-game: the screen follows the shared ergonomics pattern (list + focus pill + keycap nav bar)', async () => {
  // game-rules.md §3: the end-of-game screen reuses the pause menu's list
  // layout / focus pill / keycap nav bar pattern. The nav bar is built with
  // the same navHintEntries() helper the pause menu uses.
  const { navHintEntries } = await import('../input.js');
  const entries = navHintEntries([
    { action: 'confirm' },
    { action: 'back', label: 'Return' },
  ]);
  assert.equal(entries.length, 2, 'the nav bar has confirm + return entries (same pattern as the pause menu)');
  assert.ok(entries[0].icons.length > 0, 'the confirm keycap has icons');
  assert.equal(entries[0].label, 'Confirm', 'the confirm entry is labeled Confirm');
  assert.equal(entries[1].label, 'Return', 'the back entry is labeled Return');
  // The screen exposes the shared-pattern pieces.
  assert.ok(typeof SC.EndOfGame.draw === 'function', 'the screen has a draw method (list + focus pill)');
  assert.ok(typeof SC.EndOfGame.onAction === 'function', 'the screen handles semantic actions');
});

test('end-of-game: non-final levels still advance to the next level (not end-of-game)', () => {
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  h.currentLevel = 1;
  tally(h, { kills: { jester: 1 }, coins: 1000 });
  L.bindAreaContext(h, makeAreaContext(h));
  setState(S.PLAY);
  L.showLevelReward(h);

  // Simulate a multi-level build so level 1 is NOT the final level.
  const savedLen = LEVELS.length;
  LEVELS.push({ name: 'Second Level' });
  try {
    L._advanceRewardDwellForTest();
    L.rewardOnAction('confirm', h);
  } finally {
    LEVELS.length = savedLen;
  }

  assert.equal(getState(), S.AREA_ENTRY, 'a non-final boss advances to the next level\'s entry screen');
  assert.notEqual(getState(), S.END_OF_GAME, 'the end-of-game screen is NOT shown for a non-final level');
  assert.equal(h.currentLevel, 2, 'the level advanced');
  assert.equal(h.currentArea, -1, 'the next level starts at area -1');
});

test('end-of-game: no reference to a level beyond the last exists', () => {
  // lifecycle.md §5: the last boss must not advance into a nonexistent next
  // level. After the final level's reward confirm, the hero's level must not
  // have moved past LEVELS.length.
  L._resetRewardForTest();
  resetState();
  const h = makeTestHero();
  h.currentLevel = LEVELS.length;
  tally(h, { kills: { jester: 1 }, coins: 1000 });
  setState(S.PLAY);
  L.showLevelReward(h);

  L._advanceRewardDwellForTest();
  L.rewardOnAction('confirm', h);

  assert.equal(h.currentLevel, LEVELS.length, 'the final level did not advance past itself');
  assert.ok(h.currentLevel <= LEVELS.length, 'no reference to a level beyond the last');
  assert.equal(getState(), S.END_OF_GAME, 'the end-of-game screen takes over');
});

// --- Minimal area context for the next-level confirm path ---------------------

function makeAreaContext(h) {
  const enemy = {
    x: 2000, y: 450, vx: 0, vy: 0,
    hp: 40, maxHp: 40, alive: true, aiState: 'idle',
    fading: false, hitFlash: 0, hitstunTimer: 0,
    _initPos: { x: 2000, y: 450, aiState: 'idle' },
    timers: { map: new Map() },
  };
  return {
    enemies: [enemy],
    boss: null,
    barrels: [],
    powerups: [],
    checkpoints: [],
    projectiles: { activeItems: [], active: [] },
    coins: { activeItems: [], active: [] },
    particles: { reset: () => {} },
    effects: { reset: () => {} },
  };
}
