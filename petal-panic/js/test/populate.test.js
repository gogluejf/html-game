// Petal Panic — population resolver tests (populate.md §1–§5, generation.md §4 step 4).
// Run: node --test petal-panic/js/test/populate.test.js
//
// Source of truth:
//   docs/levels/populate.md     §1 (Budgets vs placement chance), §2 (Powerups),
//                               §3 (Barrels), §4 (Enemies), §5 (Combined population)
//   docs/levels/generation.md   §4 step 4 ("Populate their designated positions
//                               using the level's budgets and chances")
//
// Acceptance criteria covered:
//   1. All spawn items sit on valid macro slots (never invented coordinates).
//   2. Fixed budgets are met without overcrowding (placed ≤ budget, ≤ slots;
//      no independent-coin-flip empty areas when slots exist).
//   3. Explosive barrels can form chain positions.
//   4. Result deterministic per game seed.
//   5. After life loss the same population is restored (same seed → same world).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

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
} from '../macros.js';
import { createRng } from '../terrain.js';

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
  const config = {
    enemies: { jester: 3, vine_hound: 2 },
    powerups: { ammo: 2, shield: 1 },
    barrels: { explosive: 2, wood: 1, coin: 1 },
  };
  const pop = populateArea(createRng(99), layout, config);

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
// populateArea: budgets are met without overcrowding (acceptance #2)
// ---------------------------------------------------------------------------

test('populateArea: fixed budgets are met without overcrowding (placed ≤ budget, ≤ slots)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const layout = composeAreaSeeded(seed, 'horizontal', 3, 60);
    const config = {
      enemies: { jester: 3, vine_hound: 2, boris_loon: 1 },
      powerups: { ammo: 2, shield: 1, rapid: 1 },
      barrels: { explosive: 3, wood: 2, coin: 2 },
    };
    const pop = populateArea(createRng(seed * 1000), layout, config);
    for (const k of ['enemies', 'barrels', 'powerups']) {
      const b = pop.budgets[k];
      assert.ok(b.placed <= b.requested, `${k}: placed ${b.placed} does not exceed budget ${b.requested}`);
      assert.ok(b.placed <= b.slots, `${k}: placed ${b.placed} does not exceed available slots ${b.slots}`);
      assert.ok(b.placed >= 0, `${k}: placed is non-negative`);
    }
  }
});

test('populateArea: when slots ≥ budget, the full budget is placed (no accidental empty area)', () => {
  // A synthetic layout with enough slots in every category. With a budget below
  // the slot count, the resolver must place exactly the budget (a fixed budget
  // must not produce an empty or overcrowded area — populate.md §1).
  const layout = {
    placements: [
      { type: 'enemy', x: 1, y: 0, slot: 'e0' },
      { type: 'enemy', x: 2, y: 0, slot: 'e1' },
      { type: 'enemy', x: 3, y: 0, slot: 'e2' },
      { type: 'barrel', x: 4, y: 0, slot: 'b0' },
      { type: 'barrel', x: 5, y: 0, slot: 'b1' },
      { type: 'powerup', x: 6, y: 0, slot: 'p0' },
      { type: 'powerup', x: 7, y: 0, slot: 'p1' },
    ],
  };
  const config = {
    enemies: { jester: 2 },
    powerups: { ammo: 1 },
    barrels: { explosive: 1, wood: 1 },
  };
  const pop = populateArea(createRng(5), layout, config);
  assert.equal(pop.budgets.enemies.placed, 2, 'enemy budget (2) fully met');
  assert.equal(pop.budgets.barrels.placed, 2, 'barrel budget (2) fully met');
  assert.equal(pop.budgets.powerups.placed, 1, 'powerup budget (1) fully met');
});

test('populateArea: when slots < budget, it fills every slot (visible under-placement, no over-fill)', () => {
  // A budget the terrain cannot support: the resolver fills every valid slot
  // and reports the shortfall in `budgets` — it never piles items into invalid
  // positions (populate.md §1: "revise the composition rather than pile items
  // into invalid positions").
  const layout = {
    placements: [
      { type: 'enemy', x: 1, y: 0, slot: 'e0' },
      { type: 'enemy', x: 2, y: 0, slot: 'e1' },
    ],
  };
  const config = { enemies: { jester: 10 } };
  const pop = populateArea(createRng(5), layout, config);
  assert.equal(pop.budgets.enemies.placed, 2, 'only 2 enemy slots exist, so 2 placed');
  assert.equal(pop.budgets.enemies.requested, 10, 'the requested budget is recorded');
  assert.equal(pop.budgets.enemies.slots, 2, 'the slot count is recorded');
  assert.equal(pop.enemies.length, 2, 'no over-fill beyond the slots');
});

test('populateArea: per-type counts are never exceeded (roster/mix caps)', () => {
  const layout = {
    placements: Array.from({ length: 20 }, (_, i) => ({ type: 'enemy', x: i, y: 0, slot: `e${i}` })),
  };
  const config = { enemies: { jester: 3, vine_hound: 2 } };
  const pop = populateArea(createRng(5), layout, config);
  const counts = {};
  for (const e of pop.enemies) counts[e.type] = (counts[e.type] ?? 0) + 1;
  assert.equal(counts.jester ?? 0, 3, 'jester capped at its roster count');
  assert.equal(counts.vine_hound ?? 0, 2, 'vine_hound capped at its roster count');
  assert.equal(pop.enemies.length, 5, 'no enemy beyond the total roster');
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

test('populateArea: explosive barrels are placed in chain positions when possible', () => {
  // A synthetic layout with a cluster of adjacent barrel slots. The resolver
  // should place the explosive barrels on chainable slots so a well-placed
  // attack causes a chain reaction (populate.md §3).
  const layout = {
    placements: [
      { type: 'barrel', x: 10, y: 0, slot: 'b0' },
      { type: 'barrel', x: 11, y: 0, slot: 'b1' },
      { type: 'barrel', x: 12, y: 0, slot: 'b2' },
      { type: 'barrel', x: 13, y: 0, slot: 'b3' },
    ],
  };
  const config = { barrels: { explosive: 2, wood: 2 } };
  const pop = populateArea(createRng(3), layout, config);
  assert.equal(pop.barrels.length, 4, 'all 4 barrel slots filled');
  const explosive = pop.barrels.filter((b) => b.type === 'explosive');
  assert.equal(explosive.length, 2, '2 explosive barrels placed');
  // At least one explosive barrel must sit on a slot adjacent to another barrel
  // (a chain position) — the explosive barrels form the chain, not the edges.
  const explosivePositions = explosive.map((b) => b.x);
  const allXs = pop.barrels.map((b) => b.x);
  const anyExplosiveChains = explosivePositions.some((ex) =>
    allXs.some((ox) => ox !== ex && Math.abs(ox - ex) <= BARREL_CHAIN_MAX_UNITS),
  );
  assert.ok(anyExplosiveChains, 'an explosive barrel occupies a chain position');
  // The structure containing the explosive barrels is flagged as a chain.
  const chainedStructure = pop.structures.find((s) => s.chain);
  assert.ok(chainedStructure, 'a structure is flagged as a chain');
});

// ---------------------------------------------------------------------------
// Determinism per game seed (acceptance #4, lifecycle.md §6)
// ---------------------------------------------------------------------------

test('populateArea: same seed produces an identical population (determinism)', () => {
  const config = {
    enemies: { jester: 4, vine_hound: 2, boris_loon: 1 },
    powerups: { ammo: 3, shield: 1, rapid: 1 },
    barrels: { explosive: 4, wood: 2, coin: 2 },
  };
  // The whole world (terrain + population) is rolled once per game from the seed.
  const build = (seed) => {
    const rng = createRng(seed);
    const layout = composeAreaSeeded(seed, 'horizontal', 3, 60);
    // Re-derive the population from the SAME seed stream the game uses.
    return populateArea(createRng(seed), layout, config);
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
  const config = {
    enemies: { jester: 3, vine_hound: 2 },
    powerups: { ammo: 2, shield: 1 },
    barrels: { explosive: 3, wood: 1, coin: 1 },
  };
  for (const seed of [100, 200, 300]) {
    for (const stage of [1, 2, 3, 4]) {
      const mk = () => {
        const layout = composeAreaSeeded(seed, 'horizontal', stage, 60);
        return populateArea(createRng(seed * 100 + stage), layout, config);
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
  const config = {
    enemies: { jester: 5, vine_hound: 3, boris_loon: 2 },
    powerups: { ammo: 4, shield: 2, rapid: 2, special: 1 },
    barrels: { explosive: 6, wood: 3, coin: 3 },
  };
  const worldFromSeed = () => {
    const layout = composeAreaSeeded(seed, 'horizontal', 3, 60);
    return populateArea(createRng(seed), layout, config);
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

test('populateArea: empty config produces an empty population (no crash, no items)', () => {
  const layout = composeAreaSeeded(42, 'horizontal', 3, 60);
  const pop = populateArea(createRng(1), layout, {});
  assert.equal(pop.enemies.length, 0, 'no enemies with an empty roster');
  assert.equal(pop.barrels.length, 0, 'no barrels with an empty barrel budget');
  assert.equal(pop.powerups.length, 0, 'no powerups with an empty mix');
  assert.equal(pop.structures.length, 0, 'no structures with no barrels');
});

test('populateArea: a real level-1 area populates with the level spawn budgets', () => {
  // Uses the actual Level 1 (Big Top) spawn counts as the area budget. A real
  // composed area should populate deterministically and place every item on a
  // valid slot (acceptance #1 + #4 together on real data).
  const layout = composeAreaSeeded(12345, 'horizontal', 2, 60);
  const config = {
    enemies: { jester: 6, vine_hound: 4, boris_loon: 3, boris_loon_baby: 6 },
    powerups: { ammo: 3, invincibility: 1, shield: 1, rapid: 2 },
    barrels: { explosive: 8, wood: 4, coin: 4 },
  };
  const pop = populateArea(createRng(12345), layout, config);
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
  const block = { kind: 'block', x: 10, aabb: { x: 10, y: 0, w: 1, h: 2 }, height: 2 };
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
  // For multiple seeds and stages, every slot in the composed layout must be
  // at a valid standing position (on top of the supporting surface, never
  // inside a solid block). This is the BLOCKER invariant (task 4.1).
  for (const seed of [1, 2, 3, 4, 5, 100, 200]) {
    for (const stage of [1, 2, 3, 4]) {
      const layout = composeAreaSeeded(seed, 'horizontal', stage, 60);
      const solidUnits = layout.units.filter((u) => u.kind === 'block');
      for (const slot of layout.placements) {
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
    units: [{ kind: 'block', x: 5, aabb: { x: 5, y: 0, w: 1, h: 2 }, height: 2 }],
    placements: [
      { type: 'enemy', x: 5, y: 0, slot: 'bad' }, // y=0 is INSIDE the block (height 2)
    ],
  };
  assert.throws(
    () => populateArea(createRng(1), layout, { enemies: { jester: 1 } }),
    /inside a solid block/,
    'resolver throws when a slot is inside a solid',
  );
});

// ---------------------------------------------------------------------------
// Stable snapshot (acceptance #5, lifecycle.md §6 — restoreArea integration in task 7.1)
// ---------------------------------------------------------------------------

test('populationSnapshot: produces a stable, value-only snapshot of the population', () => {
  const layout = composeAreaSeeded(42, 'horizontal', 3, 60);
  const config = {
    enemies: { jester: 3, vine_hound: 2 },
    powerups: { ammo: 2, shield: 1 },
    barrels: { explosive: 2, wood: 1, coin: 1 },
  };
  const pop = populateArea(createRng(99), layout, config);
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
  const config = {
    enemies: { jester: 3, vine_hound: 2 },
    powerups: { ammo: 2, shield: 1 },
    barrels: { explosive: 2, wood: 1, coin: 1 },
  };
  const build = () => populationSnapshot(populateArea(createRng(99), layout, config));
  const a = build();
  const b = build();
  assert.deepEqual(a, b, 'same population → identical snapshot (stable for restoreArea)');
});
