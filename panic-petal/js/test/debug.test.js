// Task 7.2 — node-based unit tests for the Debug & Test Harness (design §19).
// Run: node js/test/debug.test.js
// No DOM needed: debug.js is a pure state container + helpers (no canvas/window).
// We stub `performance` (present in node) and drive the pure API surface.

import { strict as assert } from 'node:assert';
import { Debug, initSpawnTable, SPAWN_KEYS } from '../debug.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// --- Fake entity factories so we can exercise the spawn table without the real
//     enemy classes (which pull in more of the graph). Each factory returns an
//     object shaped like the relevant entity type. ---------------------------
function makeFakeDeps() {
  const record = [];
  const mk = (type, states) => (x, y, state) => {
    const e = { type, x, y, aiState: 'idle', layer: 0b10, _states: states };
    if (state) e.aiState = state;
    record.push(e);
    return e;
  };
  return {
    Jester: class { constructor(x, y) { Object.assign(this, mk('jester')()); } },
    VineHound: class { constructor(x, y) { Object.assign(this, mk('vine_hound')()); } },
    Violetta: class { constructor(x, y) { Object.assign(this, mk('violetta')()); } },
    JackOLantern: class { constructor(x, y) { Object.assign(this, mk('jackolantern')()); } },
    BorisLoon: class { constructor(def, x, y) { Object.assign(this, mk('boris_loon')()); } },
    BORIS_DEF: { id: 'boris_loon' },
    makeBorisBaby: (x, y) => mk('boris_loon_baby')(x, y),
    makeBarrel: (x, y) => ({ type: 'barrel', x, y, layer: 0b1000 }),
    makeCoinBarrel: (x, y) => ({ type: 'coinBarrel', x, y, layer: 0b1000 }),
    Powerup: class { constructor(type, x, y) { this.powerType = type; this.x = x; this.y = y; } },
    POWERUP_TYPES: ['ammo', 'shield', 'clear'],
  };
}

console.log('Debug & Test Harness');

ok('toggle flips enabled on/off', () => {
  Debug.enabled = false;
  assert.equal(Debug.toggle(), true);
  assert.equal(Debug.enabled, true);
  assert.equal(Debug.toggle(), false);
  assert.equal(Debug.enabled, false);
});

ok('reset clears all flags to defaults', () => {
  Debug.god = true;
  Debug.timeScale = 0.25;
  Debug.selected = { fake: true };
  Debug.showLog = true;
  Debug.log = [{ t: 0, msg: 'x' }];
  Debug.reset();
  assert.equal(Debug.god, false);
  assert.equal(Debug.timeScale, 1.0);
  assert.equal(Debug.selected, null);
  assert.equal(Debug.showLog, false);
  assert.deepEqual(Debug.log, []);
});

ok('cycleTimeScale walks 1 → 0.5 → 0.25 → 0 → 1', () => {
  Debug.timeScale = 1.0;
  assert.equal(Debug.cycleTimeScale(), 0.5);
  assert.equal(Debug.cycleTimeScale(), 0.25);
  assert.equal(Debug.cycleTimeScale(), 0);
  assert.equal(Debug.cycleTimeScale(), 1.0); // wraps back
});

ok('logEvent appends and caps at LOG_MAX', () => {
  Debug.reset();
  for (let i = 0; i < Debug.LOG_MAX + 10; i++) Debug.logEvent(`m${i}`);
  assert.equal(Debug.log.length, Debug.LOG_MAX);
  // Oldest entries dropped; newest retained.
  assert.equal(Debug.log[0].msg, `m10`);
  assert.equal(Debug.log[Debug.log.length - 1].msg, `m${Debug.LOG_MAX + 9}`);
});

ok('initSpawnTable populates all 9 spawn types with correct states', () => {
  initSpawnTable(makeFakeDeps());
  const keys = Object.keys(Debug.spawnTable);
  for (const k of ['jester','vine_hound','violetta','jackolantern','boris_loon','boris_loon_baby','barrel','coinBarrel','powerup']) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
  assert.deepEqual(Debug.spawnTable.jester.states, ['idle', 'chase', 'attack']);
  assert.deepEqual(Debug.spawnTable.vine_hound.states, ['idle', 'chase', 'lunge', 'recover']);
  assert.deepEqual(Debug.spawnTable.boris_loon.states, ['idle', 'hover', 'dive', 'recover']);
  assert.deepEqual(Debug.spawnTable.barrel.states, []); // not AI-driven
});

ok('SPAWN_KEYS maps digits 1-9 to the documented types', () => {
  assert.equal(SPAWN_KEYS.Digit1, 'jester');
  assert.equal(SPAWN_KEYS.Digit2, 'vine_hound');
  assert.equal(SPAWN_KEYS.Digit3, 'violetta');
  assert.equal(SPAWN_KEYS.Digit4, 'jackolantern');
  assert.equal(SPAWN_KEYS.Digit5, 'boris_loon');
  assert.equal(SPAWN_KEYS.Digit6, 'boris_loon_baby');
  assert.equal(SPAWN_KEYS.Digit7, 'barrel');
  assert.equal(SPAWN_KEYS.Digit8, 'coinBarrel');
  assert.equal(SPAWN_KEYS.Digit9, 'powerup');
});

ok('spawn table make() honors a forced AI state', () => {
  initSpawnTable(makeFakeDeps());
  const j = Debug.spawnTable.jester.make(10, 20, 'attack');
  assert.equal(j.type, 'jester');
  assert.equal(j.aiState, 'attack');
  const noState = Debug.spawnTable.jester.make(0, 0);
  assert.equal(noState.aiState, 'idle');
});

ok('forceState sets aiState on a regular enemy', () => {
  const e = { type: 'jester', aiState: 'idle' };
  assert.equal(Debug.forceState(e, 'attack'), true);
  assert.equal(e.aiState, 'attack');
});

ok('forceState routes boss phases through startPhase', () => {
  let called = null;
  const boss = {
    isBoss: true, aiState: 'idle', phase: 'idle',
    startPhase(p) { this.phase = p; called = p; },
  };
  assert.equal(Debug.forceState(boss, 'stomp'), true);
  assert.equal(called, 'stomp');
  assert.equal(boss.phase, 'stomp');
  // 'dead' goes onto aiState instead.
  Debug.forceState(boss, 'dead');
  assert.equal(boss.aiState, 'dead');
});

ok('nextState cycles through the type\'s valid states', () => {
  initSpawnTable(makeFakeDeps());
  const e = { type: 'jester', aiState: 'idle' };
  assert.equal(Debug.nextState(e), 'chase');
  assert.equal(e.aiState, 'chase');
  assert.equal(Debug.nextState(e), 'attack');
  assert.equal(e.aiState, 'attack');
  assert.equal(Debug.nextState(e), 'idle'); // wraps
  assert.equal(e.aiState, 'idle');
});

ok('nextState falls back to generic list for unknown types', () => {
  const e = { type: 'mystery', aiState: 'idle' };
  assert.equal(Debug.nextState(e), 'chase');
  assert.equal(Debug.nextState(e), 'attack');
  assert.equal(Debug.nextState(e), 'idle');
});

ok('statesFor returns [] for a null entity', () => {
  assert.deepEqual(Debug.statesFor(null), []);
});

console.log(`\n${passed} passed`);
