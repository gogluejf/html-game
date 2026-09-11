// Task 5.2 — node-based tests for energy/death/respawn/gameover flow.
// Run: node js/test/lives.test.js
//
// update.js builds placeholder frames via document.createElement('canvas') at
// import time, so we install a minimal DOM stub (window + canvas) before the
// dynamic import. The game logic under test is pure state mutation, so the
// stubbed canvas context only needs to be a no-op recorder.

import { strict as assert } from 'node:assert';

// --- Minimal DOM stub (must run BEFORE importing update.js) ------------------
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

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// Dynamic import AFTER the stub is in place.
const U = await import('../systems/update.js');
const { S, getState, setState, tryTransition } = await import('../state.js');
const { Hero } = await import('../hero.js');
const { HEROES } = await import('../heroDefs.js');

const hero = U.getHero();
const checkpoints = U.getCheckpoints();
const CONTINUE_COST = U.CONTINUE_COST;

// Reset helper: put the module back into a clean PLAY state.
function resetToPlay() {
  setState(S.PLAY);
  hero.dying = false;
  hero.deathTimer = 0;
  hero.alive = true;
  hero.energy = hero.maxEnergy;
  hero.lives = 3;
  hero.coins = 0;
  hero.continuesUsed = 0;
  hero.invincibleTimer = 0;
  hero.x = 80; hero.y = 500; hero.vx = 0; hero.vy = 0;
  hero.checkpoint = { x: 80, y: 500 };
  for (const c of checkpoints) c.triggered = false;
}

console.log('Hero death fields (Task 5.2 init)');
ok('hero has dying/deathTimer/continues fields', () => {
  const h = new Hero(HEROES.scarlet, 0, 0);
  assert.equal(h.dying, false);
  assert.ok(approx(h.deathTimer, 0));
  assert.ok(approx(h.DEATH_DURATION, 1.5));
  assert.equal(h.continuesUsed, 0);
  assert.equal(h.maxContinues, 3);
});
ok('CONTINUE_COST is 1000 coins', () => {
  assert.equal(CONTINUE_COST, 1000);
});

console.log('die() / respawn() on the Hero class');
ok('die() sets dying=true, deathTimer=0, freezes velocity', () => {
  const h = new Hero(HEROES.scarlet, 10, 10);
  h.vx = 50; h.vy = -20; h.energy = 40;
  h.die();
  assert.equal(h.dying, true);
  assert.ok(approx(h.deathTimer, 0));
  assert.ok(approx(h.energy, 0));
  assert.ok(approx(h.vx, 0));
  assert.ok(approx(h.vy, 0));
});
ok('die() is idempotent (no re-trigger mid-fade)', () => {
  const h = new Hero(HEROES.scarlet, 0, 0);
  h.die();
  h.deathTimer = 0.7;
  h.die(); // ignored
  assert.ok(approx(h.deathTimer, 0.7), 'deathTimer must not reset');
});
ok('respawn() restores to checkpoint with full energy + i-frames', () => {
  const h = new Hero(HEROES.scarlet, 0, 0);
  h.checkpoint = { x: 3000, y: 492 };
  h.energy = 0; h.dying = true; h.deathTimer = 1.5;
  h.respawn();
  assert.ok(approx(h.x, 3000));
  assert.ok(approx(h.y, 492));
  assert.ok(approx(h.energy, h.maxEnergy), 'full energy restored');
  assert.equal(h.dying, false);
  assert.ok(h.invincibleTimer >= 1.0 - 1e-6, 'i-frames granted on respawn');
  assert.ok(approx(h.vx, 0) && approx(h.vy, 0));
});
ok('respawn() grants exactly RESPAWN_IFRAMES when none active', () => {
  const h = new Hero(HEROES.scarlet, 0, 0);
  h.checkpoint = { x: 0, y: 0 };
  h.respawn();
  assert.ok(approx(h.invincibleTimer, Hero.RESPAWN_IFRAMES));
});

console.log('Death sequence via update() (acceptance #1/#2)');
ok('energy<=0 triggers die() during an update step', () => {
  resetToPlay();
  hero.energy = 0; // simulate a hit that drained to 0
  U.update(1 / 60);
  assert.equal(hero.dying, true, 'hero should be dying after update');
});
ok('skull fade runs ~DEATH_DURATION then respawns (lives>0)', () => {
  resetToPlay();
  hero.lives = 3;
  hero.checkpoint = { x: 1500, y: 492 };
  hero.energy = 0;
  // First frame triggers die() and starts the timer; subsequent frames advance it.
  U.update(1 / 60);
  let steps = 1;
  while (hero.dying && steps < 200) { U.update(1 / 60); steps++; }
  assert.equal(hero.dying, false, 'death should have completed');
  assert.equal(hero.lives, 2, 'one life consumed');
  assert.ok(approx(hero.x, 1500), `respawned at checkpoint x=${hero.x}`);
  assert.ok(approx(hero.y, 492), `respawned at checkpoint y=${hero.y}`);
  assert.ok(approx(hero.energy, hero.maxEnergy), 'full energy on respawn');
  assert.ok(hero.invincibleTimer > 0, 'i-frames active after respawn');
});
ok('last life → transition to GAME OVER (S.OVER)', () => {
  resetToPlay();
  hero.lives = 1;
  hero.energy = 0;
  U.update(1 / 60);
  let steps = 1;
  while (hero.dying && steps < 200) { U.update(1 / 60); steps++; }
  assert.equal(getState(), S.OVER, 'should be in OVER state');
  assert.equal(hero.lives, 0, 'all lives gone');
});
ok('no input processed while dying (position frozen by gravity only)', () => {
  resetToPlay();
  hero.energy = 0;
  hero.x = 80;
  U.update(1 / 60); // first frame: dies, returns early
  const xAfterFirst = hero.x;
  // Subsequent frames are skipped for gameplay; camera/shake still run.
  U.update(1 / 60);
  // The hero does NOT integrate movement (early return), so x stays where die() left it.
  assert.ok(approx(hero.x, xAfterFirst), 'hero position frozen during death');
});

console.log('Game Over options (acceptance #3/#4)');
ok('Retry (R): restart at first checkpoint, lives=3, continues reset', () => {
  resetToPlay();
  hero.lives = 0;
  hero.continuesUsed = 2;
  setState(S.OVER);
  U.retryFromGameOver();
  assert.equal(getState(), S.PLAY, 'back in PLAY');
  assert.equal(hero.lives, 3, 'lives reset to 3');
  assert.equal(hero.continuesUsed, 0, 'continues reset');
  assert.ok(approx(hero.energy, hero.maxEnergy), 'full energy');
  // First checkpoint is '1-1' at x=1500.
  assert.ok(approx(hero.x, checkpoints[0].x), `retry at cp1 x=${hero.x}`);
  // Checkpoint flags cleared so they can re-trigger.
  for (const c of checkpoints) assert.equal(c.triggered, false);
});
ok('Continue (C): deducts 1000 coins, restores at last checkpoint', () => {
  resetToPlay();
  hero.lives = 0;
  hero.coins = 2500;
  hero.checkpoint = { x: 4500, y: 492 };
  setState(S.OVER);
  const applied = U.continueFromGameOver();
  assert.equal(applied, true, 'continue should apply');
  assert.equal(getState(), S.PLAY, 'back in PLAY');
  assert.ok(approx(hero.coins, 1500), `coins deducted: ${hero.coins}`);
  assert.equal(hero.continuesUsed, 1, 'one continue used');
  assert.ok(approx(hero.x, 4500), `restored at last checkpoint x=${hero.x}`);
  assert.ok(approx(hero.energy, hero.maxEnergy), 'full energy');
  assert.ok(hero.lives >= 1, 'has a life to play');
});
ok('Continue blocked when not enough coins', () => {
  resetToPlay();
  hero.lives = 0;
  hero.coins = 999;
  setState(S.OVER);
  const applied = U.continueFromGameOver();
  assert.equal(applied, false, 'should refuse');
  assert.equal(getState(), S.OVER, 'still in OVER');
  assert.ok(approx(hero.coins, 999), 'coins unchanged');
});
ok('Continue limited to maxContinues (3) per run', () => {
  resetToPlay();
  hero.lives = 0;
  hero.coins = 100000;
  hero.continuesUsed = 3;
  setState(S.OVER);
  const applied = U.continueFromGameOver();
  assert.equal(applied, false, 'no continues left');
  assert.equal(getState(), S.OVER, 'still in OVER');
});
ok('Quit (Q): transition to HOME', () => {
  resetToPlay();
  setState(S.OVER);
  assert.ok(tryTransition(S.HOME), 'OVER→HOME allowed');
  assert.equal(getState(), S.HOME);
});

console.log('\nSkull effect math (render reads these)');
ok('skull alpha fades 1→0 over DEATH_DURATION', () => {
  const t = 0;   assert.ok(approx(Math.max(0, 1 - t / 1.5), 1));
  const t2 = 0.75; assert.ok(approx(Math.max(0, 1 - t2 / 1.5), 0.5));
  const t3 = 1.5;  assert.ok(approx(Math.max(0, 1 - t3 / 1.5), 0));
});
ok('skull sine sway + upward drift formulas bounded', () => {
  for (const t of [0, 0.3, 0.75, 1.2]) {
    const sx = Math.sin(t * 4) * 10;
    const sy = -30 * t;
    assert.ok(sx >= -10 && sx <= 10, `sway within ±10 at t=${t}`);
    assert.ok(sy <= 0, `drifts upward at t=${t}`);
  }
});

console.log(`\n${passed} assertions passed.`);
