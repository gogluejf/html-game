// Petal Panic — typed spawn END-TO-END regression gate (plan 5.1).
// Run: node --test petal-panic/js/test/typedSpawn.test.js
//
// This is the cross-cutting gate that exercises schema → composer → migrated
// macro data TOGETHER. Unit-level behavior (per-family value validation, one
// entity per slot, basic determinism) already lives in macroSchema.test.js and
// populate.test.js — this file does NOT duplicate those; it only covers the
// end-to-end contract across the three layers:
//   1. specific values spawn that exact type for ALL THREE families, using
//      every id from each family registry (hand-built layouts);
//   2. 'random' never yields an id outside the family list — statistical,
//      many placements × multiple seeds;
//   3. same seed + macros yields an identical population twice (determinism
//      on real composed areas, not hand-built layouts);
//   4. every migrated macro file validates against the schema AND every
//      placement carries an explicit `value` (migration completeness).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { loadTestMacros } from './_macroSetup.mjs';
const MACROS = loadTestMacros();

import { populateArea, composeAreaSeeded } from '../world/macros.js';
import { areaLengthBudget } from '../world/level.js';
import { createRng } from '../world/terrain.js';
import { assertMacroSchema } from '../world/macroSchema.js';
import { BARREL_TYPES } from '../objects/object.js';
import { ENEMY_TYPE_IDS } from '../world/enemyTypes.js';
import { POWERUP_ROLL_TYPES } from '../objects/powerup.js';

const FAMILIES = {
  barrel: BARREL_TYPES.map((t) => t.id),
  enemy: ENEMY_TYPE_IDS,
  powerup: POWERUP_ROLL_TYPES,
};

/** Hand-built layout with one slot per family id (specific-value pass-through). */
function specificLayout(family, ids) {
  return {
    placements: ids.map((id, i) => ({
      type: family, x: i, y: 0, slot: `${family}_${i}`, value: id,
    })),
  };
}

// ---------------------------------------------------------------------------
// 1. Specific value spawns that exact type — all three families, every id
// ---------------------------------------------------------------------------

for (const [family, ids] of Object.entries(FAMILIES)) {
  test(`specific values pass through unchanged for every ${family} id (${ids.length} types)`, () => {
    const pop = populateArea(createRng(11), specificLayout(family, ids));
    const key = family === 'enemy' ? 'enemies' : family === 'barrel' ? 'barrels' : 'powerups';
    assert.deepEqual(pop[key].map((it) => it.type), ids, `each ${family} placeholder spawns exactly its declared type`);
  });
}

// ---------------------------------------------------------------------------
// 2. Random rolls stay inside the family list (statistical, multi-seed)
// ---------------------------------------------------------------------------

test('random never yields an id outside the family list (60 slots/family × 5 seeds)', () => {
  // 60 random slots per family per seed — enough rolls to make a wrong-family
  // or unknown-id leak statistically impossible if the resolver were broken.
  const totalSlots = 60 * 3;
  for (const seed of [1, 7, 42, 999, 2026]) {
    const layout = {
      placements: Array.from({ length: totalSlots }, (_, i) => ({
        type: ['enemy', 'barrel', 'powerup'][i % 3],
        x: i, y: 0, slot: `s${i}`, value: 'random',
      })),
    };
    const pop = populateArea(createRng(seed), layout);
    const legal = {
      enemies: new Set(FAMILIES.enemy),
      barrels: new Set(FAMILIES.barrel),
      powerups: new Set(FAMILIES.powerup),
    };
    for (const e of pop.enemies) assert.ok(legal.enemies.has(e.type), `seed ${seed}: enemy roll "${e.type}" is a legal enemy id`);
    for (const b of pop.barrels) assert.ok(legal.barrels.has(b.type), `seed ${seed}: barrel roll "${b.type}" is a legal barrel id`);
    for (const p of pop.powerups) assert.ok(legal.powerups.has(p.type), `seed ${seed}: powerup roll "${p.type}" is a legal powerup id`);
  }
});

// ---------------------------------------------------------------------------
// 3. Determinism on real composed areas (same seed + macros → identical pop)
// ---------------------------------------------------------------------------

test('same seed + macros yields an identical population twice (real composed areas)', () => {
  const build = (seed, stage) => {
    const layout = composeAreaSeeded(seed, 'horizontal', stage, areaLengthBudget('horizontal'));
    return populateArea(createRng(seed), layout);
  };
  for (const [seed, stage] of [[31337, 1], [31337, 3], [777, 4]]) {
    const a = build(seed, stage);
    const b = build(seed, stage);
    assert.deepEqual(a, b, `seed ${seed} stage ${stage}: full population (items + structures + budgets) is identical`);
  }
});

// ---------------------------------------------------------------------------
// 4. Migrated macros validate + every placement carries an explicit value
// ---------------------------------------------------------------------------

test('all migrated macro files validate against the schema', () => {
  assert.ok(Object.keys(MACROS).length >= 18, `expected at least 18 macro files, found ${Object.keys(MACROS).length}`);
  for (const [id, macro] of Object.entries(MACROS)) {
    // loadTestMacros already validated once; re-assert explicitly here so this
    // gate fails loudly with the file name if migration data ever regresses.
    assert.doesNotThrow(() => assertMacroSchema(macro, { expectedId: id }), `${id}.json passes the schema`);
  }
});

test('every barrel/enemy/powerup placement in every macro carries an explicit value', () => {
  let checked = 0;
  for (const [id, macro] of Object.entries(MACROS)) {
    for (const p of macro.placements ?? []) {
      if (!['barrel', 'enemy', 'powerup'].includes(p.type)) continue;
      // Migration completeness: a non-empty string value that is either
      // "random" or a valid id of the placement's family registry. Today every
      // migrated placement is "random"; specific values stay legal.
      assert.ok(
        typeof p.value === 'string' && p.value.length > 0 &&
        (p.value === 'random' || FAMILIES[p.type].includes(p.value)),
        `${id}.json placement ${p.slot}: value must be "random" or a ${p.type} type id (got ${JSON.stringify(p.value)})`,
      );
      checked++;
    }
  }
  assert.ok(checked > 0, 'found typed placements to check');
});
