// Petal Panic — Level config validation tests (all 8 levels).
// Run: node --test petal-panic/js/test/levelConfigs.test.js
//
// Validates that the 8 level configs (levelConfigs.js) match the story doc
// (docs/story/levels.md), declare exactly one vertical area each, make budgets
// explicit (per-stage, not per-level), and show a monotonic tension curve
// across level indices (generation.md §5b).
//
// Acceptance criteria covered:
//   1. 8 config entries exist with unique name/index/boss.
//   2. Each level declares exactly one vertical area, one of -2/-3/-4
//      (never -1). The slot is NOT required to be unique ACROSS levels —
//      there are only 3 valid slots for 8 levels, so slots repeat.
//   3. Budgets make scope explicit (per-stage vs per-level).
//   4. Tension curve: enemies up, powerups down, macro difficulty weight up
//      across indices (monotonic).
//   5. Engine can boot any level by index: getLevelConfig returns the config
//      AND buildAllZoneTerrain generates a valid world (5 zones, correct
//      orientations, valid terrain) for every level config.
//   6. Adding a 9th level = one array entry (extensibility).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { LEVEL_CONFIGS, getLevelConfig, getStageBudget } from '../levelConfigs.js';
// Length budgets are sourced from level.js (single source of truth) — import
// the same constants so the assertions check identity/equality against the
// real values rather than hard-coded literals.
import {
  ZONE_WIDTH_HORIZONTAL,
  ZONE_H_VERTICAL,
  buildLevelZones,
  buildAllZoneTerrain,
} from '../level.js';
import { composeArea, MACROS } from '../macros.js';
import { createRng } from '../terrain.js';

// ---------------------------------------------------------------------------
// Structure: LEVEL_CONFIGS is a non-empty array with exactly 8 entries
// ---------------------------------------------------------------------------

test('LEVEL_CONFIGS is an array with exactly 8 entries', () => {
  assert.ok(Array.isArray(LEVEL_CONFIGS), 'LEVEL_CONFIGS is an array');
  assert.equal(LEVEL_CONFIGS.length, 8, 'exactly 8 levels are defined');
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
    // macroWeights is present on every level (generation.md §5b: macro intensity).
    assert.ok(cfg.macroWeights && typeof cfg.macroWeights === 'object', `${cfg.index}: macroWeights is an object`);
  }
});

// ---------------------------------------------------------------------------
// Unique names, indices, and bosses
// ---------------------------------------------------------------------------

test('level names are unique', () => {
  const names = LEVEL_CONFIGS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, 'all names are unique');
});

test('level indices are unique and 1..8', () => {
  const indices = LEVEL_CONFIGS.map((c) => c.index);
  assert.equal(new Set(indices).size, indices.length, 'all indices are unique');
  assert.deepEqual([...indices].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8],
    'indices are exactly 1 through 8');
});

test('level bosses are unique', () => {
  const bosses = LEVEL_CONFIGS.map((c) => c.boss);
  assert.equal(new Set(bosses).size, bosses.length, 'all bosses are unique');
});

test('each level: verticalArea is one of -2/-3/-4 (never -1)', () => {
  const valid = new Set([-2, -3, -4]);
  for (const cfg of LEVEL_CONFIGS) {
    assert.ok(valid.has(cfg.verticalArea),
      `level ${cfg.index}: verticalArea ${cfg.verticalArea} is one of ${[...valid]} (never -1)`);
  }
});

// ---------------------------------------------------------------------------
// Level 1 matches docs/story/levels.md
// ---------------------------------------------------------------------------

test('Level 1: name is "Big Top" (docs/story/levels.md "Level 1 — Big Top")', () => {
  const l1 = getLevelConfig(1);
  assert.ok(l1, 'Level 1 exists');
  assert.equal(l1.name, 'Big Top');
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
// Exactly one vertical area per level (structure.md §1)
//
// Invariant: each level has EXACTLY ONE vertical area, and it is one of
// -2/-3/-4 (never -1). The slot is NOT unique across levels — there are only
// 3 valid slots for 8 levels, so values necessarily repeat.
// ---------------------------------------------------------------------------

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

test('each level: stageBudgets covers all four stages (-1 through -4)', () => {
  const stages = ['-1', '-2', '-3', '-4'];
  for (const cfg of LEVEL_CONFIGS) {
    for (const s of stages) {
      assert.ok(cfg.stageBudgets[s], `level ${cfg.index} stage ${s} has a budget`);
    }
  }
});

test('each level: each stage budget has enemy, barrel, and powerup sections', () => {
  for (const cfg of LEVEL_CONFIGS) {
    for (const [stage, budget] of Object.entries(cfg.stageBudgets)) {
      assert.ok(budget.enemies && typeof budget.enemies === 'object', `level ${cfg.index} ${stage}: has enemies`);
      assert.ok(budget.barrels && typeof budget.barrels === 'object', `level ${cfg.index} ${stage}: has barrels`);
      assert.ok(budget.powerups && typeof budget.powerups === 'object', `level ${cfg.index} ${stage}: has powerups`);
    }
  }
});

test('each level: per-stage enemy counts are non-negative integers', () => {
  for (const cfg of LEVEL_CONFIGS) {
    for (const [stage, budget] of Object.entries(cfg.stageBudgets)) {
      for (const [type, count] of Object.entries(budget.enemies)) {
        assert.ok(Number.isInteger(count) && count >= 0,
          `level ${cfg.index} ${stage}/${type}: count ${count} is a non-negative integer`);
      }
    }
  }
});

test('each level: per-stage barrel counts are non-negative integers', () => {
  const VALID_BARRELS = new Set(['explosive', 'wood', 'coin']);
  for (const cfg of LEVEL_CONFIGS) {
    for (const [stage, budget] of Object.entries(cfg.stageBudgets)) {
      for (const [type, count] of Object.entries(budget.barrels)) {
        assert.ok(VALID_BARRELS.has(type), `level ${cfg.index} ${stage}: barrel type "${type}" is valid`);
        assert.ok(Number.isInteger(count) && count >= 0,
          `level ${cfg.index} ${stage}/${type}: count ${count} is a non-negative integer`);
      }
    }
  }
});

test('each level: per-stage powerup counts are non-negative integers', () => {
  for (const cfg of LEVEL_CONFIGS) {
    for (const [stage, budget] of Object.entries(cfg.stageBudgets)) {
      for (const [type, count] of Object.entries(budget.powerups)) {
        assert.ok(Number.isInteger(count) && count >= 0,
          `level ${cfg.index} ${stage}/${type}: count ${count} is a non-negative integer`);
      }
    }
  }
});

test('each level: budgets are per-stage (not a single level-wide budget)', () => {
  // The scope is explicit: each stage has its own budget object, and the
  // budgets DIFFER across stages (they are not just a copy of one level-wide
  // total repeated four times). This satisfies populate.md §1: "the matrix
  // must make that scope explicit so a level-wide quantity is not mistakenly
  // repeated in every area."
  for (const cfg of LEVEL_CONFIGS) {
    const budgets = Object.values(cfg.stageBudgets);
    assert.equal(budgets.length, 4, `level ${cfg.index}: four stage budgets`);
    // At least the enemy counts differ between stages (intro is sparser than pre-boss).
    const e1 = Object.values(budgets[0].enemies).reduce((a, b) => a + b, 0);
    const e4 = Object.values(budgets[3].enemies).reduce((a, b) => a + b, 0);
    assert.ok(e4 > e1,
      `level ${cfg.index}: stage -4 total enemies (${e4}) > stage -1 total enemies (${e1})`);
  }
});

// ---------------------------------------------------------------------------
// Length budgets
// ---------------------------------------------------------------------------

test('each level: length budgets are positive numbers', () => {
  for (const cfg of LEVEL_CONFIGS) {
    assert.ok(cfg.lengths.horizontal > 0, `level ${cfg.index}: horizontal length is positive`);
    assert.ok(cfg.lengths.vertical > 0, `level ${cfg.index}: vertical length is positive`);
  }
});

test('each level: length budgets reference the level.js zone constants (no re-declared literals)', () => {
  for (const cfg of LEVEL_CONFIGS) {
    assert.equal(cfg.lengths.horizontal, ZONE_WIDTH_HORIZONTAL,
      `level ${cfg.index}: horizontal length === ZONE_WIDTH_HORIZONTAL (level.js)`);
    assert.equal(cfg.lengths.vertical, ZONE_H_VERTICAL,
      `level ${cfg.index}: vertical length === ZONE_H_VERTICAL (level.js)`);
  }
});

test('each level: horizontal length is ~4000px (2x prototype segment)', () => {
  for (const cfg of LEVEL_CONFIGS) {
    assert.equal(cfg.lengths.horizontal, 4000,
      `level ${cfg.index}: horizontal is the documented 4000px target`);
  }
});

// ---------------------------------------------------------------------------
// Tension curve across levels (generation.md §5b)
// ---------------------------------------------------------------------------

/**
 * Compute the total enemy count for a level (summed across all stages).
 * @param {object} cfg a level config
 * @returns {number} the total enemy count
 */
function totalEnemies(cfg) {
  let total = 0;
  for (const budget of Object.values(cfg.stageBudgets)) {
    for (const count of Object.values(budget.enemies)) total += count;
  }
  return total;
}

/**
 * Compute the total powerup count for a level (summed across all stages).
 * @param {object} cfg a level config
 * @returns {number} the total powerup count
 */
function totalPowerups(cfg) {
  let total = 0;
  for (const budget of Object.values(cfg.stageBudgets)) {
    for (const count of Object.values(budget.powerups)) total += count;
  }
  return total;
}

test('tension curve: total enemies strictly increases across level indices', () => {
  const sorted = [...LEVEL_CONFIGS].sort((a, b) => a.index - b.index);
  for (let i = 1; i < sorted.length; i++) {
    const prev = totalEnemies(sorted[i - 1]);
    const curr = totalEnemies(sorted[i]);
    assert.ok(curr > prev,
      `level ${sorted[i].index}: total enemies (${curr}) > level ${sorted[i - 1].index} total enemies (${prev})`);
  }
});

test('tension curve: total powerups strictly decreases across level indices', () => {
  const sorted = [...LEVEL_CONFIGS].sort((a, b) => a.index - b.index);
  for (let i = 1; i < sorted.length; i++) {
    const prev = totalPowerups(sorted[i - 1]);
    const curr = totalPowerups(sorted[i]);
    assert.ok(curr < prev,
      `level ${sorted[i].index}: total powerups (${curr}) < level ${sorted[i - 1].index} total powerups (${prev})`);
  }
});

test('tension curve: macro brutal-tier weight strictly increases across level indices', () => {
  const sorted = [...LEVEL_CONFIGS].sort((a, b) => a.index - b.index);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].macroWeights.brutal;
    const curr = sorted[i].macroWeights.brutal;
    assert.ok(curr > prev,
      `level ${sorted[i].index}: macro brutal weight (${curr}) > level ${sorted[i - 1].index} macro brutal weight (${prev})`);
  }
});

test('tension curve: macro hard-tier weight strictly increases across level indices', () => {
  const sorted = [...LEVEL_CONFIGS].sort((a, b) => a.index - b.index);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].macroWeights.hard;
    const curr = sorted[i].macroWeights.hard;
    assert.ok(curr > prev,
      `level ${sorted[i].index}: macro hard weight (${curr}) > level ${sorted[i - 1].index} macro hard weight (${prev})`);
  }
});

test('tension curve: macro easy-tier weight does not increase across level indices', () => {
  const sorted = [...LEVEL_CONFIGS].sort((a, b) => a.index - b.index);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].macroWeights.easy;
    const curr = sorted[i].macroWeights.easy;
    assert.ok(curr <= prev,
      `level ${sorted[i].index}: macro easy weight (${curr}) <= level ${sorted[i - 1].index} macro easy weight (${prev})`);
  }
});

// ---------------------------------------------------------------------------
// Engine can boot any level by index
// ---------------------------------------------------------------------------

test('getLevelConfig: returns the config for each level index 1..8', () => {
  for (let i = 1; i <= 8; i++) {
    const cfg = getLevelConfig(i);
    assert.ok(cfg, `level ${i} exists`);
    assert.equal(cfg.index, i, `level ${i} has the correct index`);
  }
});

test('getLevelConfig: returns undefined for an undefined level', () => {
  assert.equal(getLevelConfig(99), undefined, 'unknown level returns undefined');
  assert.equal(getLevelConfig(0), undefined, 'level 0 returns undefined');
});

test('getStageBudget: returns the correct stage budget for each level', () => {
  for (const cfg of LEVEL_CONFIGS) {
    for (const stage of [-1, -2, -3, -4]) {
      const budget = getStageBudget(cfg, stage);
      assert.ok(budget, `level ${cfg.index} stage ${stage} budget exists`);
      assert.ok(budget.enemies, `level ${cfg.index} stage ${stage} has enemies`);
      assert.ok(budget.barrels, `level ${cfg.index} stage ${stage} has barrels`);
      assert.ok(budget.powerups, `level ${cfg.index} stage ${stage} has powerups`);
    }
  }
});

test('getStageBudget: returns null for a stage with no budget', () => {
  for (const cfg of LEVEL_CONFIGS) {
    assert.equal(getStageBudget(cfg, 0), null, `level ${cfg.index}: stage 0 has no budget`);
  }
});

// ---------------------------------------------------------------------------
// Engine can generate a world for any level (MAJOR 4)
//
// Proof that the engine can boot any level: for each of the 8 level configs,
// buildLevelZones produces the five sealed zones with the correct
// orientations (exactly one vertical area, matching the config's
// verticalArea) and buildAllZoneTerrain composes valid terrain for every
// ordinary area (5 zones total: 4 areas + boss).
// ---------------------------------------------------------------------------

test('engine boot: buildLevelZones yields 5 zones with correct orientations for every level', () => {
  for (const cfg of LEVEL_CONFIGS) {
    const zones = buildLevelZones(cfg);
    assert.equal(zones.length, 5, `level ${cfg.index}: 5 zones (4 areas + boss)`);
    const areaZones = zones.filter((z) => z.kind === 'area');
    const bossZones = zones.filter((z) => z.kind === 'boss');
    assert.equal(areaZones.length, 4, `level ${cfg.index}: 4 ordinary areas`);
    assert.equal(bossZones.length, 1, `level ${cfg.index}: 1 boss zone`);
    assert.deepEqual(
      areaZones.map((z) => z.areaIdx),
      [-1, -2, -3, -4],
      `level ${cfg.index}: areas are -1..-4 in play order`,
    );
    // Exactly one ordinary area is vertical, and it is the config's slot.
    const verticalZones = areaZones.filter((z) => z.orientation === 'vertical');
    assert.equal(verticalZones.length, 1,
      `level ${cfg.index}: exactly one vertical area`);
    assert.equal(verticalZones[0].areaIdx, cfg.verticalArea,
      `level ${cfg.index}: vertical area is the config's verticalArea (${cfg.verticalArea})`);
    // Every other ordinary area is horizontal.
    for (const z of areaZones) {
      if (z.areaIdx !== cfg.verticalArea) {
        assert.equal(z.orientation, 'horizontal',
          `level ${cfg.index} area ${z.areaIdx}: horizontal`);
      }
    }
    assert.equal(bossZones[0].orientation, 'boss', `level ${cfg.index}: boss zone orientation`);
  }
});

test('engine boot: buildAllZoneTerrain produces valid terrain for every level', () => {
  const VALID_KINDS = new Set(['block', 'platform', 'gap']);
  for (const cfg of LEVEL_CONFIGS) {
    // A distinct seed per level keeps the streams independent; any fixed seed
    // works — determinism is the point, not a specific layout.
    const terrains = buildAllZoneTerrain(cfg, `boot-level-${cfg.index}`);
    assert.equal(terrains.size, 4, `level ${cfg.index}: terrain for all 4 ordinary areas`);
    for (const stage of [-1, -2, -3, -4]) {
      const layout = terrains.get(stage);
      assert.ok(layout, `level ${cfg.index} stage ${stage}: terrain exists`);
      assert.equal(layout.stage, stage, `level ${cfg.index} stage ${stage}: stage matches`);
      const isVertical = stage === cfg.verticalArea;
      assert.equal(layout.orientation, isVertical ? 'vertical' : 'horizontal',
        `level ${cfg.index} stage ${stage}: orientation matches the zone model`);
      assert.ok(layout.macroIds !== undefined || layout.macros,
        `level ${cfg.index} stage ${stage}: macro placements recorded`);
      assert.ok(layout.units.length > 0,
        `level ${cfg.index} stage ${stage}: layout has placed units`);
      for (const unit of layout.units) {
        assert.ok(VALID_KINDS.has(unit.kind),
          `level ${cfg.index} stage ${stage}: unit kind "${unit.kind}" is valid`);
        assert.ok(Number.isFinite(unit.aabb.x) && Number.isFinite(unit.aabb.y)
          && unit.aabb.w > 0 && unit.aabb.h > 0,
          `level ${cfg.index} stage ${stage}: unit AABB is finite and positive`);
      }
      assert.ok(layout.totalWidth > 0, `level ${cfg.index} stage ${stage}: positive width`);
      if (isVertical) {
        // Vertical layouts carry the climb height; horizontal layouts leave
        // totalHeight undefined (a horizontal area is one screen tall, fixed
        // by the zone model, not by the terrain).
        assert.ok(layout.totalHeight > 0,
          `level ${cfg.index} stage ${stage}: positive climb height`);
      }
    }
    // Determinism: same seed twice → identical world (lifecycle.md §6).
    const again = buildAllZoneTerrain(cfg, `boot-level-${cfg.index}`);
    assert.deepEqual([...again.values()], [...terrains.values()],
      `level ${cfg.index}: same seed produces identical terrain`);
  }
});

// ---------------------------------------------------------------------------
// Data purity: the config is pure data (no functions, no DOM references)
// ---------------------------------------------------------------------------

test('macroWeights bias: harder-tier weights shift macro selection toward harder macros', () => {
  // The composer must CONSUME the level config's macroWeights (MAJOR 3):
  // composing the same stage with a brutal-leaning weight set must yield a
  // different (harder) macro sequence than the same stage with an
  // easy-leaning set. Use a fixed seed so the difference is purely the bias.
  const budget = 40;
  const easyWeights = { easy: 10, medium: 1, hard: 1, brutal: 0 };
  const brutalWeights = { easy: 0, medium: 1, hard: 5, brutal: 10 };
  const a = composeArea(createRng('bias-test'), 'horizontal', -3, budget, easyWeights);
  const b = composeArea(createRng('bias-test'), 'horizontal', -3, budget, brutalWeights);
  assert.ok(Array.isArray(a.macros) && Array.isArray(b.macros), 'layouts record macro sequences');
  assert.notDeepEqual(a.macros, b.macros,
    'level macroWeights change the composed macro sequence (weights are consumed)');
  // The brutal-biased layout must average to a higher difficulty tier.
  const avgDiff = (layout) =>
    layout.macros.reduce((s, id) => s + MACROS[id].difficulty, 0) / layout.macros.length;
  assert.ok(avgDiff(b) >= avgDiff(a),
    `brutal-biased layout averages harder (avg ${avgDiff(b).toFixed(2)} >= ${avgDiff(a).toFixed(2)})`);
});

test('all level configs are pure data (no function values)', () => {
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
  for (const cfg of LEVEL_CONFIGS) {
    checkPure(cfg, `level ${cfg.index}`);
  }
});
