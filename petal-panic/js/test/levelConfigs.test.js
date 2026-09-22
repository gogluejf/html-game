// Petal Panic — Level 1 config validation tests.
// Run: node --test petal-panic/js/test/levelConfigs.test.js
//
// Validates that the Level 1 config (levelConfigs.js) matches the story doc
// (docs/story/levels.md), declares exactly one vertical area, and makes
// budgets explicit (per-stage, not per-level).
//
// Acceptance criteria covered:
//   1. Config matches docs/story/levels.md Level 1 roster and boss.
//   2. Exactly one vertical area declared (one of -2/-3/-4, never -1).
//   3. Budgets make scope explicit (per-stage vs per-level).
//   4. Adding a Level 2 requires only a new array entry.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { LEVEL_CONFIGS, getLevelConfig, getStageBudget } from '../levelConfigs.js';
// Length budgets are sourced from level.js (single source of truth) — import
// the same constants so the assertions check identity/equality against the
// real values rather than hard-coded literals.
import { ZONE_WIDTH_HORIZONTAL, ZONE_H_VERTICAL } from '../level.js';

// ---------------------------------------------------------------------------
// Structure: LEVEL_CONFIGS is a non-empty array
// ---------------------------------------------------------------------------

test('LEVEL_CONFIGS is a non-empty array', () => {
  assert.ok(Array.isArray(LEVEL_CONFIGS), 'LEVEL_CONFIGS is an array');
  assert.ok(LEVEL_CONFIGS.length >= 1, 'at least one level is defined');
});

test('each level config has the required top-level fields', () => {
  for (const cfg of LEVEL_CONFIGS) {
    assert.equal(typeof cfg.name, 'string', `${cfg.index}: name is a string`);
    assert.ok(cfg.name.length > 0, `${cfg.index}: name is non-empty`);
    assert.equal(typeof cfg.index, 'number', `${cfg.index}: index is a number`);
    assert.ok(cfg.index >= 1, `${cfg.index}: index is 1-based`);
    assert.equal(typeof cfg.boss, 'string', `${cfg.index}: boss is a string`);
    assert.ok(cfg.boss.length > 0, `${cfg.index}: boss is non-empty`);
    assert.ok(typeof cfg.verticalArea === 'number', `${cfg.index}: verticalArea is a number`);
    // There is NO top-level `enemies`/`powerups` weight block — the per-stage
    // counts in stageBudgets are the quantity budgets (populate.md §1). Type
    // selection weights, when present, live in the flat *_weights fields.
    assert.ok(!('enemies' in cfg), `${cfg.index}: no top-level enemies weight block`);
    assert.ok(!('powerups' in cfg), `${cfg.index}: no top-level powerups weight block`);
    if (cfg.enemyWeights) {
      assert.ok(typeof cfg.enemyWeights === 'object', `${cfg.index}: enemyWeights is an object`);
    }
    if (cfg.powerupWeights) {
      assert.ok(typeof cfg.powerupWeights === 'object', `${cfg.index}: powerupWeights is an object`);
    }
    assert.ok(cfg.stageBudgets && typeof cfg.stageBudgets === 'object', `${cfg.index}: stageBudgets is an object`);
    assert.ok(cfg.lengths && typeof cfg.lengths === 'object', `${cfg.index}: lengths is an object`);
  }
});

// ---------------------------------------------------------------------------
// Level 1 matches docs/story/levels.md
// ---------------------------------------------------------------------------

test('Level 1: name is "The Circus"', () => {
  const l1 = getLevelConfig(1);
  assert.ok(l1, 'Level 1 exists');
  assert.equal(l1.name, 'The Circus');
});

test('Level 1: boss is "tusko_wobble" (Tusko Wobble)', () => {
  const l1 = getLevelConfig(1);
  assert.equal(l1.boss, 'tusko_wobble');
});

test('Level 1: enemy roster matches the story doc (Jester, Jack-O-Lantern, Vine Hound, Boris Loon babies)', () => {
  const l1 = getLevelConfig(1);
  // The roster is the union of enemy type keys across all per-stage budgets
  // (the per-stage counts ARE the enemy selection — there is no separate
  // top-level roster block).
  const roster = new Set();
  for (const budget of Object.values(l1.stageBudgets)) {
    for (const type of Object.keys(budget.enemies)) roster.add(type);
  }
  // The story doc lists: Jester, Jack-O-Lantern, Vine Hound, Boris Loon (babies)
  assert.deepEqual([...roster].sort(), ['boris_loon_baby', 'jackolantern', 'jester', 'vine_hound'].sort(),
    'roster (derived from stage budgets) matches the story doc exactly');
});

test('Level 1: enemyWeights are a flat { type: number } map with positive weights', () => {
  const l1 = getLevelConfig(1);
  assert.ok(l1.enemyWeights && typeof l1.enemyWeights === 'object', 'enemyWeights is present');
  for (const [type, weight] of Object.entries(l1.enemyWeights)) {
    // Flat schema: the value IS the weight (a number), not a nested { weight }.
    assert.equal(typeof weight, 'number', `enemyWeights.${type} is a flat number`);
    assert.ok(weight > 0, `enemyWeights.${type}: weight is positive`);
  }
  // Every weighted type is part of the roster (no orphan weight keys).
  const roster = new Set();
  for (const budget of Object.values(l1.stageBudgets)) {
    for (const type of Object.keys(budget.enemies)) roster.add(type);
  }
  for (const type of Object.keys(l1.enemyWeights)) {
    assert.ok(roster.has(type), `enemyWeights.${type} is a known roster type`);
  }
});

test('Level 1: powerupWeights are a flat { type: number } map with positive weights', () => {
  const l1 = getLevelConfig(1);
  const VALID_POWERUPS = new Set(['ammo', 'invincibility', 'special', 'rapid', 'shield', 'clear', 'energy', 'oneUp']);
  assert.ok(l1.powerupWeights && typeof l1.powerupWeights === 'object', 'powerupWeights is present');
  for (const [type, weight] of Object.entries(l1.powerupWeights)) {
    // Flat schema: the value IS the weight (a number), not a nested { weight }.
    assert.equal(typeof weight, 'number', `powerupWeights.${type} is a flat number`);
    assert.ok(VALID_POWERUPS.has(type), `powerupWeights "${type}" is a known type`);
    assert.ok(weight > 0, `powerupWeights.${type}: weight is positive`);
  }
  // Every weighted type appears in at least one stage's powerup budget.
  const budgeted = new Set();
  for (const budget of Object.values(l1.stageBudgets)) {
    for (const type of Object.keys(budget.powerups)) budgeted.add(type);
  }
  for (const type of Object.keys(l1.powerupWeights)) {
    assert.ok(budgeted.has(type), `powerupWeights.${type} appears in a stage budget`);
  }
});

// ---------------------------------------------------------------------------
// Exactly one vertical area (structure.md §1)
// ---------------------------------------------------------------------------

test('Level 1: exactly one vertical area declared, and it is one of -2/-3/-4 (never -1)', () => {
  const l1 = getLevelConfig(1);
  const valid = [-2, -3, -4];
  assert.ok(valid.includes(l1.verticalArea),
    `verticalArea ${l1.verticalArea} is one of ${valid} (never -1)`);
});

test('each level: verticalArea is exactly one of -2, -3, -4', () => {
  const valid = new Set([-2, -3, -4]);
  for (const cfg of LEVEL_CONFIGS) {
    assert.ok(valid.has(cfg.verticalArea),
      `level ${cfg.index}: verticalArea ${cfg.verticalArea} is valid`);
  }
});

// ---------------------------------------------------------------------------
// Budgets make scope explicit (per-stage, not per-level)
// ---------------------------------------------------------------------------

test('Level 1: stageBudgets covers all four stages (-1 through -4)', () => {
  const l1 = getLevelConfig(1);
  const stages = ['-1', '-2', '-3', '-4'];
  for (const s of stages) {
    assert.ok(l1.stageBudgets[s], `stage ${s} has a budget`);
  }
});

test('Level 1: each stage budget has enemy, barrel, and powerup sections', () => {
  const l1 = getLevelConfig(1);
  for (const [stage, budget] of Object.entries(l1.stageBudgets)) {
    assert.ok(budget.enemies && typeof budget.enemies === 'object', `${stage}: has enemies`);
    assert.ok(budget.barrels && typeof budget.barrels === 'object', `${stage}: has barrels`);
    assert.ok(budget.powerups && typeof budget.powerups === 'object', `${stage}: has powerups`);
  }
});

test('Level 1: per-stage enemy counts are non-negative integers', () => {
  const l1 = getLevelConfig(1);
  for (const [stage, budget] of Object.entries(l1.stageBudgets)) {
    for (const [type, count] of Object.entries(budget.enemies)) {
      assert.ok(Number.isInteger(count) && count >= 0,
        `${stage}/${type}: count ${count} is a non-negative integer`);
    }
  }
});

test('Level 1: per-stage barrel counts are non-negative integers', () => {
  const l1 = getLevelConfig(1);
  const VALID_BARRELS = new Set(['explosive', 'wood', 'coin']);
  for (const [stage, budget] of Object.entries(l1.stageBudgets)) {
    for (const [type, count] of Object.entries(budget.barrels)) {
      assert.ok(VALID_BARRELS.has(type), `${stage}: barrel type "${type}" is valid`);
      assert.ok(Number.isInteger(count) && count >= 0,
        `${stage}/${type}: count ${count} is a non-negative integer`);
    }
  }
});

test('Level 1: per-stage powerup counts are non-negative integers', () => {
  const l1 = getLevelConfig(1);
  for (const [stage, budget] of Object.entries(l1.stageBudgets)) {
    for (const [type, count] of Object.entries(budget.powerups)) {
      assert.ok(Number.isInteger(count) && count >= 0,
        `${stage}/${type}: count ${count} is a non-negative integer`);
    }
  }
});

test('Level 1: budgets are per-stage (not a single level-wide budget)', () => {
  // The scope is explicit: each stage has its own budget object, and the
  // budgets DIFFER across stages (they are not just a copy of one level-wide
  // total repeated four times). This satisfies populate.md §1: "the matrix
  // must make that scope explicit so a level-wide quantity is not mistakenly
  // repeated in every area."
  const l1 = getLevelConfig(1);
  const budgets = Object.values(l1.stageBudgets);
  assert.equal(budgets.length, 4, 'four stage budgets');
  // At least the enemy counts differ between stages (intro is sparser than pre-boss).
  const e1 = Object.values(budgets[0].enemies).reduce((a, b) => a + b, 0);
  const e4 = Object.values(budgets[3].enemies).reduce((a, b) => a + b, 0);
  assert.ok(e4 > e1, `stage -4 total enemies (${e4}) > stage -1 total enemies (${e1})`);
});

// ---------------------------------------------------------------------------
// Length budgets
// ---------------------------------------------------------------------------

test('Level 1: length budgets are positive numbers', () => {
  const l1 = getLevelConfig(1);
  assert.ok(l1.lengths.horizontal > 0, 'horizontal length is positive');
  assert.ok(l1.lengths.vertical > 0, 'vertical length is positive');
});

test('Level 1: length budgets reference the level.js zone constants (no re-declared literals)', () => {
  const l1 = getLevelConfig(1);
  // The config imports the single source of truth from level.js rather than
  // re-declaring the pixel literals.
  assert.equal(l1.lengths.horizontal, ZONE_WIDTH_HORIZONTAL,
    'horizontal length === ZONE_WIDTH_HORIZONTAL (level.js)');
  assert.equal(l1.lengths.vertical, ZONE_H_VERTICAL,
    'vertical length === ZONE_H_VERTICAL (level.js)');
});

test('Level 1: horizontal length is ~4000px (2x prototype segment)', () => {
  const l1 = getLevelConfig(1);
  assert.equal(l1.lengths.horizontal, 4000, 'horizontal is the documented 4000px target');
});

// ---------------------------------------------------------------------------
// Extensibility: adding a Level 2 requires only a new array entry
// ---------------------------------------------------------------------------

test('getLevelConfig: returns undefined for an undefined level', () => {
  assert.equal(getLevelConfig(99), undefined, 'unknown level returns undefined');
});

test('getStageBudget: returns the correct stage budget', () => {
  const l1 = getLevelConfig(1);
  const budget = getStageBudget(l1, -2);
  assert.ok(budget, 'stage -2 budget exists');
  assert.ok(budget.enemies, 'stage -2 has enemies');
  assert.ok(budget.barrels, 'stage -2 has barrels');
  assert.ok(budget.powerups, 'stage -2 has powerups');
});

test('getStageBudget: returns null for a stage with no budget', () => {
  const l1 = getLevelConfig(1);
  assert.equal(getStageBudget(l1, 0), null, 'stage 0 has no budget');
});

// ---------------------------------------------------------------------------
// Data purity: the config is pure data (no functions, no DOM references)
// ---------------------------------------------------------------------------

test('Level 1 config is pure data (no function values)', () => {
  const l1 = getLevelConfig(1);
  function checkPure(obj, path = 'root') {
    if (obj === null || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => checkPure(v, `${path}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'function') {
        assert.fail(`${path}.${k} is a function — config must be pure data`);
      }
      checkPure(v, `${path}.${k}`);
    }
  }
  checkPure(l1);
});
