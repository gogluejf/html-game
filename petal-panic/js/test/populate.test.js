// Petal Panic — population resolver tests (typed spawn, placeholder-typed-spawn plan).
// Run: node --test petal-panic/js/test/populate.test.js
//
// Typed spawn contract (task 2.1): the authored placeholder on each slot is
// the source of truth — every placement spawns exactly one entity; value
// 'random' rolls within the family registry list; specific values pass
// through unchanged; same seed → identical population. No quantity budgets.
//
// Acceptance criteria covered:
//   1. All spawn items sit on valid macro slots (never invented coordinates).
//   2. Every slot spawns exactly one entity of its declared/rolled type.
//   3. Barrel structures report chain positions from the authored geometry.
//   4. Result deterministic per game seed.
//   5. After life loss the same population is restored (same seed → same world).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

import {
  populateArea,
  classifyBarrelStructure,
  formsChain,
  barrelStructures,
  BARREL_STRUCTURE,
  BARREL_CHAIN_MAX_UNITS,
  composeAreaSeeded,
  MACROS,
  slotIsOnValidSurface,
  populationSnapshot,
} from '../world/macros.js';
import { createRng } from '../world/terrain.js';
import { ENEMY_TYPE_IDS } from '../world/enemyTypes.js';
import { BARREL_TYPES } from '../objects/object.js';
import { POWERUP_ROLL_TYPES } from '../objects/powerup.js';

// ---------------------------------------------------------------------------
// Macro placement opportunities (the slots the resolver fills)
// ---------------------------------------------------------------------------

test('macros declare typed placement slots (enemy / barrel / powerup)', () => {
  const validTypes = new Set(['enemy', 'barrel', 'powerup']);
  for (const [id, macro] of Object.entries(MACROS)) {
    assert.ok(Array.isArray(macro.placements), `${id}: has placements array`);
    for (const p of macro.placements) {
      assert.ok(validTypes.has(p.type), `${id}: placement type "${p.type}" is a known slot type`);
      assert.ok(typeof p.x === 'number', `${id}: placement has an x position`);
      assert.ok(typeof p.slot === 'string', `${id}: placement has a slot name`);
    }
  }
});

test('composed layouts expose placement slots from their macros', () => {
  const layout = composeAreaSeeded(42, 'horizontal', 3, 60);
  assert.ok(Array.isArray(layout.placements), 'layout has a placements array');
  assert.ok(layout.placements.length > 0, 'a real area has at least one slot');
  // Every slot is one of the three population types.
  for (const p of layout.placements) {
    assert.ok(['enemy', 'barrel', 'powerup'].includes(p.type), `slot type ${p.type} is valid`);
  }
});

// ---------------------------------------------------------------------------
// populateArea: items sit on valid macro slots (acceptance #1)
// ---------------------------------------------------------------------------

test('populateArea: every item sits on a valid macro slot (no invented coordinates)', () => {
  const layout = composeAreaSeeded(7, 'horizontal', 3, 60);
  const pop = populateArea(createRng(99), layout);

  const slotSet = new Set(layout.placements.map((p) => `${p.x}|${p.y ?? 0}|${p.type}`));
  for (const it of pop.enemies) {
    assert.ok(slotSet.has(`${it.x}|${it.y ?? 0}|enemy`), `enemy ${it.type}@${it.x} is on a valid enemy slot`);
  }
  for (const it of pop.barrels) {
    assert.ok(slotSet.has(`${it.x}|${it.y ?? 0}|barrel`), `barrel ${it.type}@${it.x} is on a valid barrel slot`);
  }
  for (const it of pop.powerups) {
    assert.ok(slotSet.has(`${it.x}|${it.y ?? 0}|powerup`), `powerup ${it.type}@${it.x} is on a valid powerup slot`);
  }
});

// ---------------------------------------------------------------------------
// populateArea: one entity per slot (typed spawn)
// ---------------------------------------------------------------------------

test('populateArea: every slot spawns exactly one item, never more (no over-fill)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const layout = composeAreaSeeded(seed, 'horizontal', 3, 60);
    const pop = populateArea(createRng(seed * 1000), layout);
    const byType = { enemy: 0, barrel: 0, powerup: 0 };
    for (const p of layout.placements) byType[p.type]++;
    assert.equal(pop.enemies.length, byType.enemy, `seed ${seed}: one enemy per enemy slot`);
    assert.equal(pop.barrels.length, byType.barrel, `seed ${seed}: one barrel per barrel slot`);
    assert.equal(pop.powerups.length, byType.powerup, `seed ${seed}: one powerup per powerup slot`);
    for (const k of ['enemies', 'barrels', 'powerups']) {
      const b = pop.budgets[k];
      assert.ok(b.placed <= b.requested, `${k}: placed ${b.placed} does not exceed requested ${b.requested}`);
      assert.ok(b.placed <= b.slots, `${k}: placed ${b.placed} does not exceed available slots ${b.slots}`);
      assert.ok(b.placed >= 0, `${k}: placed is non-negative`);
    }
  }
});

// ---------------------------------------------------------------------------
// Typed spawn contract (placeholder-typed-spawn plan, task 2.1)
// ---------------------------------------------------------------------------
// The authored placeholder is the source of truth: every placement spawns
// EXACTLY ONE entity; value 'random' rolls within the family registry list;
// a specific value passes through unchanged; no quantity budgets exist.

test('populateArea: every placement spawns exactly one entity (no budgets, no under/over-fill)', () => {
  const layout = {
    placements: [
      { type: 'enemy', x: 1, y: 0, slot: 'e0' },
      { type: 'enemy', x: 2, y: 0, slot: 'e1' },
      { type: 'barrel', x: 4, y: 0, slot: 'b0' },
      { type: 'powerup', x: 6, y: 0, slot: 'p0' },
    ],
  };
  const pop = populateArea(createRng(5), layout);
  assert.equal(pop.enemies.length, 2, 'one enemy per enemy slot');
  assert.equal(pop.barrels.length, 1, 'one barrel per barrel slot');
  assert.equal(pop.powerups.length, 1, 'one powerup per powerup slot');
  // Budget accounting mirrors the slots 1:1 (requested == placed == slots).
  for (const k of ['enemies', 'barrels', 'powerups']) {
    const b = pop.budgets[k];
    assert.equal(b.requested, b.placed, `${k}: requested equals placed`);
    assert.equal(b.placed, b.slots, `${k}: placed equals slot count`);
  }
});

test('populateArea: value "random" rolls within the family registry list', () => {
  const enemyIds = new Set(ENEMY_TYPE_IDS);
  const barrelIds = new Set(BARREL_TYPES.map((t) => t.id));
  const powerupIds = new Set(POWERUP_ROLL_TYPES);

  const layout = {
    placements: Array.from({ length: 40 }, (_, i) => ({
      type: i % 3 === 0 ? 'enemy' : i % 3 === 1 ? 'barrel' : 'powerup',
      x: i, y: 0, slot: `s${i}`, value: 'random',
    })),
  };
  const pop = populateArea(createRng(7), layout);
  for (const e of pop.enemies) assert.ok(enemyIds.has(e.type), `enemy roll "${e.type}" is a legal enemy id`);
  for (const b of pop.barrels) assert.ok(barrelIds.has(b.type), `barrel roll "${b.type}" is a legal barrel id`);
  for (const p of pop.powerups) assert.ok(powerupIds.has(p.type), `powerup roll "${p.type}" is a legal powerup id`);
});

test('populateArea: specific values pass through unchanged (no re-roll)', () => {
  const layout = {
    placements: [
      { type: 'enemy', x: 1, y: 0, slot: 'e0', value: 'jester' },
      { type: 'enemy', x: 2, y: 0, slot: 'e1', value: 'vine_hound' },
      { type: 'barrel', x: 4, y: 0, slot: 'b0', value: 'explosive' },
      { type: 'powerup', x: 6, y: 0, slot: 'p0', value: 'ammo' },
    ],
  };
  const pop = populateArea(createRng(5), layout);
  assert.deepEqual(pop.enemies.map((e) => e.type), ['jester', 'vine_hound'], 'enemy ids pass through');
  assert.deepEqual(pop.barrels.map((b) => b.type), ['explosive'], 'barrel id passes through');
  assert.deepEqual(pop.powerups.map((p) => p.type), ['ammo'], 'powerup id passes through');
});

test('populateArea: same seed + same layout produces an identical typed population', () => {
  const layout = {
    placements: Array.from({ length: 12 }, (_, i) => ({
      type: i % 3 === 0 ? 'enemy' : i % 3 === 1 ? 'barrel' : 'powerup',
      x: i, y: 0, slot: `s${i}`, value: 'random',
    })),
  };
  const build = () => populateArea(createRng(4242), layout);
  const a = build();
  const b = build();
  assert.deepEqual(a.enemies, b.enemies, 'same seed: same enemy types');
  assert.deepEqual(a.barrels, b.barrels, 'same seed: same barrel types');
  assert.deepEqual(a.powerups, b.powerups, 'same seed: same powerup types');
});

// ---------------------------------------------------------------------------
// Barrel structures + chain positions (acceptance #3, populate.md §3)
// ---------------------------------------------------------------------------

test('classifyBarrelStructure: the four scales (single / small 2-3 / medium 4-9 / super)', () => {
  assert.equal(classifyBarrelStructure([1]), 'single');
  // 2-3 barrels are a "small" cluster — NOT medium (populate.md §3: medium is 4-9).
  assert.equal(classifyBarrelStructure([1, 2]), 'small');
  assert.equal(classifyBarrelStructure([1, 2, 3]), 'small');
  assert.equal(classifyBarrelStructure([1, 2, 3, 4]), 'medium');
  assert.equal(classifyBarrelStructure([1, 2, 3, 4, 5, 6, 7, 8, 9]), 'medium');
  assert.equal(classifyBarrelStructure([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 'super');
  assert.ok(BARREL_STRUCTURE.medium.min === 4 && BARREL_STRUCTURE.medium.max === 9, 'medium is 4-9');
});

test('formsChain: adjacent same-tier barrels chain, distant ones do not', () => {
  assert.ok(formsChain([1, 2, 3]), 'adjacent barrels form a chain');
  assert.ok(!formsChain([1, 5, 9]), 'distant barrels do not form a chain');
  assert.ok(!formsChain([1]), 'a single barrel is not a chain');
  assert.ok(BARREL_CHAIN_MAX_UNITS >= 1, 'chain threshold is at least 1 unit');
});

test('barrelStructures: groups same-tier contiguous barrels into structures', () => {
  const structures = barrelStructures([
    { x: 1, y: 0, type: 'barrel', slot: 'a' },
    { x: 2, y: 0, type: 'barrel', slot: 'b' },
    { x: 3, y: 0, type: 'barrel', slot: 'c' },
    { x: 20, y: 0, type: 'barrel', slot: 'd' },
    { x: 21, y: 1, type: 'barrel', slot: 'e' },
  ]);
  assert.equal(structures.length, 3, 'three structures: a run of 3, a single, a single on another tier');
  const run = structures.find((s) => s.xs.length === 3);
  assert.ok(run, 'a 3-barrel structure exists');
  assert.equal(run.tier, 0, 'the run is on tier 0');
});

test('populateArea: barrel slots form chain structures when adjacent (structures report, not placement)', () => {
  // A synthetic layout with a cluster of adjacent barrel slots. Typed spawn
  // places one barrel per slot; the structure grouping then flags the run as
  // a chain (populate.md §3) — chaining is a property of the authored slot
  // geometry, not of resolver placement decisions.
  const layout = {
    placements: [
      { type: 'barrel', x: 10, y: 0, slot: 'b0' },
      { type: 'barrel', x: 11, y: 0, slot: 'b1' },
      { type: 'barrel', x: 12, y: 0, slot: 'b2' },
      { type: 'barrel', x: 13, y: 0, slot: 'b3' },
    ],
  };
  const pop = populateArea(createRng(3), layout);
  assert.equal(pop.barrels.length, 4, 'one barrel per slot');
  const chainedStructure = pop.structures.find((s) => s.chain);
  assert.ok(chainedStructure, 'the adjacent run is flagged as a chain');
  assert.equal(chainedStructure.xs.length, 4, 'the chain spans all 4 adjacent slots');
});

// ---------------------------------------------------------------------------
// Determinism per game seed (acceptance #4, lifecycle.md §6)
// ---------------------------------------------------------------------------

test('populateArea: same seed produces an identical population (determinism)', () => {
  // The whole world (terrain + population) is rolled once per game from the seed.
  const build = (seed) => {
    const layout = composeAreaSeeded(seed, 'horizontal', 3, 60);
    // Re-derive the population from the SAME seed stream the game uses.
    return populateArea(createRng(seed), layout);
  };
  const a = build(20240517);
  const b = build(20240517);
  assert.deepEqual(a.enemies, b.enemies, 'same seed: same enemy placements');
  assert.deepEqual(a.barrels, b.barrels, 'same seed: same barrel placements');
  assert.deepEqual(a.powerups, b.powerups, 'same seed: same powerup placements');
  assert.deepEqual(a.structures, b.structures, 'same seed: same barrel structures');
  assert.deepEqual(a.budgets, b.budgets, 'same seed: same budget accounting');
});

test('populateArea: determinism holds across many seeds and stages', () => {
  for (const seed of [100, 200, 300]) {
    for (const stage of [1, 2, 3, 4]) {
      const mk = () => {
        const layout = composeAreaSeeded(seed, 'horizontal', stage, 60);
        return populateArea(createRng(seed * 100 + stage), layout);
      };
      assert.deepEqual(mk().enemies, mk().enemies, `seed ${seed} stage ${stage}: enemies`);
      assert.deepEqual(mk().barrels, mk().barrels, `seed ${seed} stage ${stage}: barrels`);
      assert.deepEqual(mk().powerups, mk().powerups, `seed ${seed} stage ${stage}: powerups`);
    }
  }
});

// ---------------------------------------------------------------------------
// After life loss the same population is restored (acceptance #5, lifecycle.md §6)
// ---------------------------------------------------------------------------

test('after life loss the same population is restored (same seed → same world, no re-roll)', () => {
  // The "restore" contract is that the arrangement is FIXED for the game: a
  // life loss rebuilds the SAME world from the SAME seed, not a re-roll. We
  // simulate two "attempts" of the same game (same seed) and assert the
  // population is byte-for-byte identical — this is what restoreArea replays.
  const seed = 987654;
  const worldFromSeed = () => {
    const layout = composeAreaSeeded(seed, 'horizontal', 3, 60);
    return populateArea(createRng(seed), layout);
  };
  const firstAttempt = worldFromSeed();
  const afterLifeLoss = worldFromSeed();
  // Deep equality: enemies, barrels, powerups, structures, and budget accounting
  // are all restored to the identical arrangement.
  assert.deepEqual(afterLifeLoss, firstAttempt, 'the same seed restores the identical population');
});

// ---------------------------------------------------------------------------
// Combined population sanity (acceptance — nothing invalidates another layer)
// ---------------------------------------------------------------------------

test('populateArea: a layout with no placements produces an empty population (no crash, no items)', () => {
  // With typed spawn there are no budgets to satisfy — the population is
  // exactly the set of authored slots. A slot-less layout yields nothing.
  const layout = composeAreaSeeded(42, 'horizontal', 3, 60);
  const empty = { ...layout, placements: [] };
  const pop = populateArea(createRng(1), empty);
  assert.equal(pop.enemies.length, 0, 'no enemies without enemy slots');
  assert.equal(pop.barrels.length, 0, 'no barrels without barrel slots');
  assert.equal(pop.powerups.length, 0, 'no powerups without powerup slots');
  assert.equal(pop.structures.length, 0, 'no structures with no barrels');
});

test('populateArea: a real level-1 area populates from its authored slots', () => {
  // A real composed area should populate deterministically and place every
  // item on a valid slot (acceptance #1 + #4 together on real data).
  const layout = composeAreaSeeded(12345, 'horizontal', 2, 60);
  const pop = populateArea(createRng(12345), layout);
  const slotSet = new Set(layout.placements.map((p) => `${p.x}|${p.y ?? 0}|${p.type}`));
  for (const it of pop.enemies) {
    assert.ok(slotSet.has(`${it.x}|${it.y ?? 0}|enemy`), `enemy ${it.type}@${it.x} on a valid slot`);
  }
  for (const it of pop.barrels) {
    assert.ok(slotSet.has(`${it.x}|${it.y ?? 0}|barrel`), `barrel ${it.type}@${it.x} on a valid slot`);
  }
  for (const it of pop.powerups) {
    assert.ok(slotSet.has(`${it.x}|${it.y ?? 0}|powerup`), `powerup ${it.type}@${it.x} on a valid slot`);
  }
  // The population is a subset of the slots: never more items than slots.
  assert.ok(pop.enemies.length <= pop.budgets.enemies.slots, 'enemies ≤ slots');
  assert.ok(pop.barrels.length <= pop.budgets.barrels.slots, 'barrels ≤ slots');
  assert.ok(pop.powerups.length <= pop.budgets.powerups.slots, 'powerups ≤ slots');
});

// ---------------------------------------------------------------------------
// Slot validity: items never spawn inside solids (BLOCKER fix, task 4.1)
// ---------------------------------------------------------------------------

test('slotIsOnValidSurface: a slot on top of a block is valid; a slot inside a block is not', () => {
  // A block of height 2 at x=10 occupies [10, 11). A slot at x=10 is above it.
  const block = { kind: 'block', x: 10, y: 0, width: 1, aabb: { x: 10, y: 0, w: 1, h: 2 }, height: 2 };
  // Slot at y=2 (on top of the block) → valid.
  assert.ok(slotIsOnValidSurface({ x: 10, y: 2 }, [block]), 'slot on top of block (y=2) is valid');
  // Slot at y=0 (ground level, inside the block) → invalid.
  assert.ok(!slotIsOnValidSurface({ x: 10, y: 0 }, [block]), 'slot inside block (y=0) is invalid');
  // Slot at y=1 (inside the block, below its top) → invalid.
  assert.ok(!slotIsOnValidSurface({ x: 10, y: 1 }, [block]), 'slot inside block (y=1) is invalid');
  // Slot at x=11 (not above the block) → valid regardless of y.
  assert.ok(slotIsOnValidSurface({ x: 11, y: 0 }, [block]), 'slot not above block is valid');
});

test('slotIsOnValidSurface: platforms do not invalidate a slot (one-way landings)', () => {
  // A platform at x=10, tier 2. A slot at x=10, y=0 is NOT inside the platform
  // (platforms are one-way landings, not solids).
  const platform = { kind: 'platform', x: 10, aabb: { x: 10, y: 2, w: 1, h: 1 }, tier: 2 };
  assert.ok(slotIsOnValidSurface({ x: 10, y: 0 }, [platform]), 'slot at ground level is valid with a platform above');
});

test('populateArea: all slots in a composed layout are on valid surfaces (no items in solids)', () => {
  // For multiple seeds and stages, every non-powerup slot in the composed
  // layout must NOT be inside a solid block. This is the BLOCKER invariant.
  for (const seed of [1, 2, 3, 4, 5, 100, 200]) {
    for (const stage of [1, 2, 3, 4]) {
      const layout = composeAreaSeeded(seed, 'horizontal', stage, 60);
      const solidUnits = layout.units.filter((u) => u.kind === 'block');
      for (const slot of layout.placements) {
        if (slot.type === 'powerup') continue;
        assert.ok(
          slotIsOnValidSurface(slot, solidUnits),
          `seed ${seed} stage ${stage}: slot ${slot.slot} at x=${slot.x} y=${slot.y} is inside a solid block`,
        );
      }
    }
  }
});

test('populateArea: throws if a slot is inside a solid block (defense-in-depth)', () => {
  // A synthetic layout with a slot INSIDE a block. The resolver must throw
  // (not silently place an item in a solid).
  const layout = {
    units: [{ kind: 'block', x: 5, y: 0, width: 1, aabb: { x: 5, y: 0, w: 1, h: 2 }, height: 2 }],
    placements: [
      { type: 'enemy', x: 5, y: 0, slot: 'bad' }, // y=0 is INSIDE the block (height 2)
    ],
  };
  assert.throws(
    () => populateArea(createRng(1), layout, { enemies: { jester: 1 } }),
    /INSIDE a solid block/,
    'resolver throws when a slot is inside a solid',
  );
});

// ---------------------------------------------------------------------------
// Stable snapshot (acceptance #5, lifecycle.md §6 — restoreArea integration in task 7.1)
// ---------------------------------------------------------------------------

test('populationSnapshot: produces a stable, value-only snapshot of the population', () => {
  const layout = composeAreaSeeded(42, 'horizontal', 3, 60);
  const pop = populateArea(createRng(99), layout);
  const snap = populationSnapshot(pop);

  // The snapshot is a deep copy: mutating the original does not affect it.
  const original = pop.enemies[0];
  const snapEnemy = snap.enemies[0];
  assert.deepEqual(snapEnemy, original, 'snapshot matches the original');
  snapEnemy.type = 'mutated';
  assert.notEqual(pop.enemies[0].type, 'mutated', 'mutating the snapshot does not affect the original');

  // The snapshot is value-only: no references to the original objects.
  assert.notEqual(snap.enemies, pop.enemies, 'snapshot enemies array is a new array');
  assert.notEqual(snap.barrels, pop.barrels, 'snapshot barrels array is a new array');
  assert.notEqual(snap.powerups, pop.powerups, 'snapshot powerups array is a new array');
});

test('populationSnapshot: the same population always produces an identical snapshot (stability)', () => {
  const layout = composeAreaSeeded(42, 'horizontal', 3, 60);
  const build = () => populationSnapshot(populateArea(createRng(99), layout));
  const a = build();
  const b = build();
  assert.deepEqual(a, b, 'same population → identical snapshot (stable for restoreArea)');
});
