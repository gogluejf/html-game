// Task 1.1 — node-based unit tests for global game rules (gameRules.js).
// Run: node --test petal-panic/js/test/gameRules.test.js
//
// Acceptance criteria covered:
//   1. Pool starts at 3 (from GAME_RULES, not a literal)
//   2. Pool can grow beyond the initial value via credit()
//   3. spend() never goes negative
//   4. All values come from GAME_RULES

import { strict as assert } from 'node:assert';
import {
  GAME_RULES,
  createContinuePool,
  canSpend,
  spend,
  credit,
} from '../gameRules.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// --- GAME_RULES global settings ----------------------------------------------
console.log('GAME_RULES');
ok('new game starts with 3 lives', () => {
  assert.equal(GAME_RULES.startingLives, 3);
});
ok('new game starts with 3 continues', () => {
  assert.equal(GAME_RULES.startingContinues, 3);
});
ok('one continue is earned per full 1000 coins (global tuning value)', () => {
  assert.equal(GAME_RULES.coinsPerContinue, 1000);
});

// --- Continue pool: balance, not a fixed maximum ------------------------------
console.log('continue pool');
ok('pool defaults to the configured starting continues (3)', () => {
  assert.equal(createContinuePool().remaining, 3);
});
ok('pool can be created with a custom starting balance', () => {
  assert.equal(createContinuePool(5).remaining, 5);
});
ok('credit() grows the pool beyond the initial value', () => {
  const pool = createContinuePool();
  credit(pool, 2);
  assert.equal(pool.remaining, 5);
});
ok('spend() decrements exactly one continue', () => {
  const pool = createContinuePool();
  spend(pool);
  assert.equal(pool.remaining, 2);
});
ok('spend() is a no-op when empty — pool never goes negative', () => {
  const pool = createContinuePool(0);
  spend(pool);
  spend(pool);
  assert.equal(pool.remaining, 0);
});
ok('canSpend() reflects whether a continue is available', () => {
  const pool = createContinuePool(0);
  assert.equal(canSpend(pool), false);
  credit(pool, 1);
  assert.equal(canSpend(pool), true);
});
ok('continues can be earned then spent in sequence', () => {
  const pool = createContinuePool();
  credit(pool, 1); // earned from a level reward
  assert.equal(canSpend(pool), true);
  spend(pool);     // used at Game Over
  assert.equal(pool.remaining, 3);
});

console.log(`\n${passed} assertions passed.`);
