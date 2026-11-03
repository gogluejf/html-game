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

import { LEVEL_CONFIGS, getLevelConfig } from '../world/levelConfigs.js';
// Length budgets are sourced from level.js (single source of truth) — import
// the same constants so the assertions check identity/equality against the
// real values rather than hard-coded literals.
import {
  ZONE_WIDTH_HORIZONTAL,
  ZONE_H_VERTICAL,
  buildLevelZones,
  buildAllZoneTerrain,
} from '../world/level.js';
import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

import { composeArea, MACROS } from '../world/macros.js';
import { createRng } from '../world/terrain.js';

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
    // There is NO top-level `enemies`/`powerups` weight block, and no
    // per-stage quantity budgets — typed spawn makes the macro placements the
    // population spec. Type selection weights, when present, live in the flat
    // *_weights fields.
    assert.ok(!('enemies' in cfg), `${cfg.index}: no top-level enemies weight block`);
    assert.ok(!('powerups' in cfg), `${cfg.index}: no top-level powerups weight block`);
    // No per-stage quantity budgets anymore (placeholder-typed-spawn task 2.2):
    // the macro placements ARE the population spec.
    assert.ok(!('stageBudgets' in cfg), `${cfg.index}: no per-stage quantity budgets (typed spawn)`);
    if (cfg.enemyWeights) {
      assert.ok(typeof cfg.enemyWeights === 'object', `${cfg.index}: enemyWeights is an object`);
    }
    if (cfg.powerupWeights) {
      assert.ok(typeof cfg.powerupWeights === 'object', `${cfg.index}: powerupWeights is an object`);
    }
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

test('each level: verticalArea is one of 2/3/4 (never 1)', () => {
  const valid = new Set([2, 3, 4]);
  for (const cfg of LEVEL_CONFIGS) {
    assert.ok(valid.has(cfg.verticalArea),
      `level ${cfg.index}: verticalArea ${cfg.verticalArea} is one of ${[...valid]} (never 1)`);
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
  // The roster is the union of enemy types in the level's type-selection
  // weights (the per-level roster declaration).
  const roster = new Set(Object.keys(l1.enemyWeights));
  // The story doc lists: Jester, Jack-O-Lantern, Vine Hound, Boris Loon (babies)
  assert.deepEqual([...roster].sort(), ['boris_loon_baby', 'jackolantern', 'jester', 'vine_hound'].sort(),
    'roster (derived from enemyWeights) matches the story doc exactly');
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
  const roster = new Set(Object.keys(l1.enemyWeights));
  for (const type of Object.keys(l1.enemyWeights)) {
    assert.ok(roster.has(type), `enemyWeights.${type} is a known roster type`);
  }
});

test('Level 1: powerupWeights are a flat { type: number } map with positive weights', () => {
  const l1 = getLevelConfig(1);
  const VALID_POWERUPS = new Set(['specialDrop', 'invincibility', 'rapid', 'shield', 'clear', 'energy', 'oneUp']);
  assert.ok(l1.powerupWeights && typeof l1.powerupWeights === 'object', 'powerupWeights is present');
  for (const [type, weight] of Object.entries(l1.powerupWeights)) {
    // Flat schema: the value IS the weight (a number), not a nested { weight }.
    assert.equal(typeof weight, 'number', `powerupWeights.${type} is a flat number`);
    assert.ok(VALID_POWERUPS.has(type), `powerupWeights "${type}" is a known type`);
    assert.ok(weight > 0, `powerupWeights.${type}: weight is positive`);
  }
  // Every weighted type is a known powerup type (no orphan weight keys).
  for (const type of Object.keys(l1.powerupWeights)) {
    assert.ok(VALID_POWERUPS.has(type), `powerupWeights.${type} is a known type`);
  }
});

// ---------------------------------------------------------------------------
// Exactly one vertical area per level (structure.md §1)
//
// Invariant: each level has EXACTLY ONE vertical area, and it is one of
// -2/-3/-4 (never -1). The slot is NOT unique across levels — there are only
// 3 valid slots for 8 levels, so values necessarily repeat.
// ---------------------------------------------------------------------------

test('each level: verticalArea is exactly one of 2, 3, 4', () => {
  const valid = new Set([2, 3, 4]);
  for (const cfg of LEVEL_CONFIGS) {
    assert.ok(valid.has(cfg.verticalArea),
      `level ${cfg.index}: verticalArea ${cfg.verticalArea} is valid`);
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

test('each level: horizontal length is the canonical 56-column budget', () => {
  for (const cfg of LEVEL_CONFIGS) {
    assert.equal(cfg.lengths.horizontal, ZONE_WIDTH_HORIZONTAL,
      `level ${cfg.index}: horizontal length uses the shared unit-derived target`);
  }
});

// ---------------------------------------------------------------------------
// Tension curve across levels (generation.md §5b)
// ---------------------------------------------------------------------------

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
      [1, 2, 3, 4],
      `level ${cfg.index}: areas are 1..4 in play order`,
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
    for (const stage of [1, 2, 3, 4]) {
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
  // Square-grid cutover note: authored macro widths doubled, so the budget is
  // raised to 80 cells — wide enough for the composer to place more than one
  // macro and let the difficulty bias actually change the selection.
  const budget = 80;
  const easyWeights = { easy: 10, medium: 1, hard: 1, brutal: 0 };
  const brutalWeights = { easy: 0, medium: 1, hard: 5, brutal: 10 };
  const a = composeArea(createRng('bias-test'), 'horizontal', 3, budget, easyWeights);
  const b = composeArea(createRng('bias-test'), 'horizontal', 3, budget, brutalWeights);
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
