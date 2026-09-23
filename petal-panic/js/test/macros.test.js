// Petal Panic — macros.js tests (macro library + area composer).
// Run: node --test petal-panic/js/test/macros.test.js
//
// Source of truth:
//   docs/levels/generation.md   §2 (Macro examples), §3 (What a macro
//                               describes), §4 (Constructing an area),
//                               §5 (Progression 1 to 4), §6 (Playability)
//   docs/levels/structure.md    §5 (Terrain vocabulary)
//
// Acceptance criteria covered:
//   1. composeArea returns a playable block/platform layout meeting the budget
//   2. No impossible gaps at macro joins
//   3. No trapped starts (entry zone clear)
//   4. Required landings not buried (platforms not under blocks)
//   5. Start/exit never require a random powerup to reach
//   6. Output deterministic for a given rng stream

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  MACROS,
  macroWidth,
  macroDensity,
  layoutDensity,
  selectMacros,
  composeArea,
  composeAreaSeeded,
  validateLayout,
  STAGE_WEIGHTS,
  ENTRY_CLEAR,
  EXIT_CLEAR,
  MAX_CLEARABLE_GAP,
} from '../macros.js';
import { createRng } from '../terrain.js';
import {
  HORIZONTAL_AREA_LENGTH_PX,
  VERTICAL_AREA_LENGTH_PX,
  areaLengthBudget,
  buildZoneTerrain,
  buildAllZoneTerrain,
  buildLevelZones,
  LEVELS,
} from '../level.js';
import { UNIT_PX } from '../macros.js';

// ---------------------------------------------------------------------------
// Macro vocabulary (generation.md §2, §3)
// ---------------------------------------------------------------------------

test('macro vocabulary: all six required macros are present', () => {
  const required = ['pyramid', 'lowRepeated', 'stretchedPyramid', 'mixedCrossing', 'climbing', 'gapDrop'];
  for (const id of required) {
    assert.ok(MACROS[id], `macro "${id}" must exist`);
  }
});

test('macro vocabulary: each macro declares orientation, difficulty, units, entry/exit', () => {
  for (const [id, macro] of Object.entries(MACROS)) {
    assert.ok(macro.id === id, `${id}: macro.id matches key`);
    assert.ok(
      macro.orientation === 'horizontal' || macro.orientation === 'vertical',
      `${id}: orientation is horizontal or vertical`,
    );
    assert.ok(macro.difficulty >= 1 && macro.difficulty <= 3, `${id}: difficulty 1-3`);
    assert.ok(Array.isArray(macro.units) && macro.units.length > 0, `${id}: has units`);
    assert.ok(typeof macro.entryClear === 'number' && macro.entryClear >= 0, `${id}: has entryClear`);
    assert.ok(typeof macro.exitClear === 'number' && macro.exitClear >= 0, `${id}: has exitClear`);
    assert.ok(Array.isArray(macro.placements), `${id}: has placements array`);
    assert.ok(Array.isArray(macro.variations), `${id}: has variations array`);
    assert.ok(Array.isArray(macro.follows), `${id}: has follows array`);
    assert.ok(Array.isArray(macro.followedBy), `${id}: has followedBy array`);
  }
});

test('macro vocabulary: pyramid has heights 1,2,3,2,1 (generation.md §2)', () => {
  const pyramid = MACROS.pyramid;
  const blockHeights = pyramid.units
    .filter((u) => u.kind === 'block')
    .map((u) => u.height);
  assert.deepEqual(blockHeights, [1, 2, 3, 2, 1], 'pyramid: blocks 1,2,3,2,1');
  assert.equal(pyramid.orientation, 'horizontal');
  assert.equal(pyramid.difficulty, 1);
});

test('macro vocabulary: lowRepeated has five height-1 blocks (generation.md §2)', () => {
  const lr = MACROS.lowRepeated;
  const blockHeights = lr.units
    .filter((u) => u.kind === 'block')
    .map((u) => u.height);
  assert.deepEqual(blockHeights, [1, 1, 1, 1, 1], 'lowRepeated: five height-1 blocks');
  assert.equal(lr.orientation, 'horizontal');
  assert.equal(lr.difficulty, 1);
});

test('macro vocabulary: stretchedPyramid has 5×h1, 5×h2, 5×h3, then descent (generation.md §2)', () => {
  const sp = MACROS.stretchedPyramid;
  const blocks = sp.units.filter((u) => u.kind === 'block');
  const gaps = sp.units.filter((u) => u.kind === 'gap');
  assert.equal(blocks.length, 15, 'stretchedPyramid: 15 blocks total');
  assert.equal(blocks.slice(0, 5).every((b) => b.height === 1), true, 'first 5 are height 1');
  assert.equal(blocks.slice(5, 10).every((b) => b.height === 2), true, 'next 5 are height 2');
  assert.equal(blocks.slice(10, 15).every((b) => b.height === 3), true, 'last 5 are height 3');
  assert.ok(gaps.length >= 1, 'stretchedPyramid: has a descent/drop gap');
  assert.equal(sp.orientation, 'horizontal');
  assert.equal(sp.difficulty, 2);
});

test('macro vocabulary: mixedCrossing has blocks, gap, triple platform tier 2, blocks (generation.md §2)', () => {
  const mc = MACROS.mixedCrossing;
  const blocks = mc.units.filter((u) => u.kind === 'block');
  const platforms = mc.units.filter((u) => u.kind === 'platform');
  const gaps = mc.units.filter((u) => u.kind === 'gap');
  assert.equal(blocks.length, 6, 'mixedCrossing: 6 blocks (3 before + 3 after)');
  assert.equal(platforms.length, 1, 'mixedCrossing: 1 platform');
  assert.equal(platforms[0].width, 3, 'mixedCrossing: triple-width platform');
  assert.equal(platforms[0].tier, 2, 'mixedCrossing: platform at tier 2');
  assert.ok(gaps.length >= 1, 'mixedCrossing: has a gap');
  assert.equal(mc.orientation, 'horizontal');
  assert.equal(mc.difficulty, 3);
});

test('macro vocabulary: climbing is vertical with upward landings (generation.md §2)', () => {
  const climb = MACROS.climbing;
  assert.equal(climb.orientation, 'vertical', 'climbing is vertical');
  const platforms = climb.units.filter((u) => u.kind === 'platform');
  assert.ok(platforms.length >= 2, 'climbing: at least 2 platform landings');
  // The landings should include upward progression (some platform at a higher tier).
  const tiers = platforms.map((p) => p.tier);
  const maxTier = Math.max(...tiers);
  assert.ok(maxTier >= 2, 'climbing: reaches at least tier 2 (upward progression)');
  assert.equal(climb.difficulty, 2);
});

test('macro vocabulary: gapDrop is a movement challenge (generation.md §2)', () => {
  const gd = MACROS.gapDrop;
  assert.equal(gd.orientation, 'horizontal');
  const gaps = gd.units.filter((u) => u.kind === 'gap');
  assert.ok(gaps.length >= 1, 'gapDrop: has at least one gap');
  assert.equal(gd.difficulty, 2);
});

test('macroWidth: computes total width including entry/exit clear zones', () => {
  for (const [id, macro] of Object.entries(MACROS)) {
    const w = macroWidth(macro);
    // Width must be at least entryClear + exitClear + at least one unit.
    assert.ok(w >= macro.entryClear + macro.exitClear + 1, `${id}: width ${w} is reasonable`);
    // Width must be an integer.
    assert.ok(Number.isInteger(w), `${id}: width is an integer`);
  }
});

// ---------------------------------------------------------------------------
// Macro selection by stage (generation.md §5)
// ---------------------------------------------------------------------------

test('selectMacros: stage 1 only returns difficulty-1 macros', () => {
  const candidates = selectMacros('horizontal', 1);
  assert.ok(candidates.length > 0, 'stage 1 has candidates');
  for (const { macro } of candidates) {
    assert.equal(macro.difficulty, 1, `stage 1: ${macro.id} is difficulty 1`);
    assert.equal(macro.orientation, 'horizontal', `stage 1: ${macro.id} is horizontal`);
  }
});

test('selectMacros: stage 2 returns difficulty 1-2 macros', () => {
  const candidates = selectMacros('horizontal', 2);
  assert.ok(candidates.length > 0, 'stage 2 has candidates');
  for (const { macro } of candidates) {
    assert.ok(macro.difficulty >= 1 && macro.difficulty <= 2, `stage 2: ${macro.id} is difficulty 1-2`);
  }
});

test('selectMacros: stage 3 returns difficulty 1-3 macros', () => {
  const candidates = selectMacros('horizontal', 3);
  assert.ok(candidates.length > 0, 'stage 3 has candidates');
  for (const { macro } of candidates) {
    assert.ok(macro.difficulty >= 1 && macro.difficulty <= 3, `stage 3: ${macro.id} is difficulty 1-3`);
  }
});

test('selectMacros: stage 4 returns difficulty 1-3 macros weighted toward hard', () => {
  const candidates = selectMacros('horizontal', 4);
  assert.ok(candidates.length > 0, 'stage 4 has candidates');
  // The hardest macros should have the highest weight.
  const weights = candidates.map((c) => c.weight);
  const maxWeight = Math.max(...weights);
  const hardCandidates = candidates.filter((c) => c.macro.difficulty === 3);
  assert.ok(hardCandidates.length > 0, 'stage 4: has difficulty-3 macros');
  for (const hc of hardCandidates) {
    assert.equal(hc.weight, maxWeight, `stage 4: ${hc.macro.id} has max weight`);
  }
});

test('selectMacros: vertical stage 2 returns climbing macros', () => {
  const candidates = selectMacros('vertical', 2);
  assert.ok(candidates.length > 0, 'vertical stage 2 has candidates');
  for (const { macro } of candidates) {
    assert.equal(macro.orientation, 'vertical', `vertical: ${macro.id} is vertical`);
  }
});

test('selectMacros: throws on unknown stage', () => {
  assert.throws(() => selectMacros('horizontal', 0), /unknown stage/);
  assert.throws(() => selectMacros('horizontal', 5), /unknown stage/);
});

// ---------------------------------------------------------------------------
// composeArea: basic structure (generation.md §4)
// ---------------------------------------------------------------------------

test('composeArea: returns a layout with the correct shape', () => {
  const rng = createRng(42);
  const layout = composeArea(rng, 'horizontal', 1, 40);

  assert.equal(layout.orientation, 'horizontal');
  assert.equal(layout.stage, 1);
  assert.equal(layout.budget, 40);
  assert.equal(layout.entryClear, ENTRY_CLEAR);
  assert.equal(layout.exitClear, EXIT_CLEAR);
  assert.ok(Array.isArray(layout.macros), 'has macros array');
  assert.ok(Array.isArray(layout.units), 'has units array');
  assert.ok(Array.isArray(layout.gaps), 'has gaps array');
  assert.ok(Number.isInteger(layout.totalWidth), 'totalWidth is an integer');
  assert.ok(layout.totalWidth >= layout.budget, 'totalWidth meets the budget');
  assert.ok(Array.isArray(layout.placements), 'has placements array');
});

test('composeArea: layout meets the budget (totalWidth >= budget)', () => {
  for (const seed of [1, 7, 42, 100, 999]) {
    const rng = createRng(seed);
    const layout = composeArea(rng, 'horizontal', 1, 40);
    assert.ok(
      layout.totalWidth >= layout.budget,
      `seed ${seed}: totalWidth ${layout.totalWidth} >= budget ${layout.budget}`,
    );
  }
});

test('composeArea: at least one macro is placed', () => {
  const rng = createRng(1);
  const layout = composeArea(rng, 'horizontal', 1, 40);
  assert.ok(layout.macros.length >= 1, 'at least one macro placed');
});

test('composeArea: units have x positions and valid aabb', () => {
  const rng = createRng(5);
  const layout = composeArea(rng, 'horizontal', 2, 30);
  for (const u of layout.units) {
    assert.ok(typeof u.x === 'number', 'unit has x position');
    assert.ok(u.x >= 0, 'unit x is non-negative');
    assert.ok(u.aabb, 'unit has aabb');
    assert.equal(u.aabb.x, u.x, 'aabb.x matches unit.x');
    assert.ok(u.aabb.w > 0, 'aabb.w is positive');
    assert.ok(u.aabb.h > 0, 'aabb.h is positive');
  }
});

test('composeArea: gaps are within the layout bounds', () => {
  const rng = createRng(10);
  const layout = composeArea(rng, 'horizontal', 3, 30);
  for (const gap of layout.gaps) {
    assert.ok(gap.x >= 0, 'gap x is non-negative');
    assert.ok(gap.x + gap.width <= layout.totalWidth, 'gap is within layout bounds');
    assert.ok(gap.width > 0, 'gap width is positive');
  }
});

// ---------------------------------------------------------------------------
// composeArea: playability (generation.md §6)
// ---------------------------------------------------------------------------

test('composeArea: no impossible gaps (gap width <= MAX_CLEARABLE_GAP)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const rng = createRng(seed);
    const layout = composeArea(rng, 'horizontal', 3, 40);
    for (const gap of layout.gaps) {
      assert.ok(
        gap.width <= MAX_CLEARABLE_GAP,
        `seed ${seed}: gap of ${gap.width} units at x=${gap.x} exceeds max ${MAX_CLEARABLE_GAP}`,
      );
    }
  }
});

test('composeArea: entry zone is clear (no units in the first ENTRY_CLEAR units)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const rng = createRng(seed);
    const layout = composeArea(rng, 'horizontal', 2, 25);
    for (const u of layout.units) {
      assert.ok(
        u.x >= layout.entryClear,
        `seed ${seed}: unit at x=${u.x} intrudes into entry zone (clear: ${layout.entryClear})`,
      );
    }
  }
});

test('composeArea: exit zone is clear (no units in the last EXIT_CLEAR units)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const rng = createRng(seed);
    const layout = composeArea(rng, 'horizontal', 2, 25);
    const exitStart = layout.totalWidth - layout.exitClear;
    for (const u of layout.units) {
      const unitEnd = u.x + u.aabb.w;
      assert.ok(
        unitEnd <= exitStart,
        `seed ${seed}: unit ending at x=${unitEnd} intrudes into exit zone (starts at x=${exitStart})`,
      );
    }
  }
});

test('composeArea: no buried landings (platforms not under blocks)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const rng = createRng(seed);
    const layout = composeArea(rng, 'horizontal', 3, 35);
    const platforms = layout.units.filter((u) => u.kind === 'platform');
    const blocks = layout.units.filter((u) => u.kind === 'block');
    for (const p of platforms) {
      for (const b of blocks) {
        const pStart = p.x;
        const pEnd = p.x + p.aabb.w;
        const bStart = b.x;
        const bEnd = b.x + b.aabb.w;
        if (pStart < bEnd && pEnd > bStart) {
          // X overlap: block must NOT be tall enough to bury the platform.
          assert.ok(
            b.height < p.tier,
            `seed ${seed}: platform at x=${p.x} (tier ${p.tier}) buried by block at x=${b.x} (height ${b.height})`,
          );
        }
      }
    }
  }
});

test('composeArea: elevation steps between successive platforms are <= 1 tier', () => {
  for (const seed of [1, 2, 3]) {
    const rng = createRng(seed);
    const layout = composeArea(rng, 'horizontal', 3, 35);
    const platforms = layout.units
      .filter((u) => u.kind === 'platform')
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < platforms.length; i++) {
      const step = Math.abs(platforms[i].tier - platforms[i - 1].tier);
      assert.ok(
        step <= 1,
        `seed ${seed}: elevation step of ${step} between platforms at x=${platforms[i - 1].x} and x=${platforms[i].x}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// composeArea: vertical orientation
// ---------------------------------------------------------------------------

test('composeArea: vertical orientation produces vertical macros', () => {
  const rng = createRng(42);
  const layout = composeArea(rng, 'vertical', 2, 20);
  assert.equal(layout.orientation, 'vertical');
  assert.ok(layout.macros.length >= 1, 'at least one macro placed');
  for (const id of layout.macros) {
    assert.equal(MACROS[id].orientation, 'vertical', `macro ${id} is vertical`);
  }
});

test('composeArea: vertical layout has platform units (climbing landings)', () => {
  const rng = createRng(42);
  const layout = composeArea(rng, 'vertical', 2, 20);
  const platforms = layout.units.filter((u) => u.kind === 'platform');
  assert.ok(platforms.length > 0, 'vertical layout has platform landings');
});

// ---------------------------------------------------------------------------
// composeArea: progression stages
// ---------------------------------------------------------------------------

test('composeArea: stage 1 produces only difficulty-1 macros', () => {
  const rng = createRng(1);
  const layout = composeArea(rng, 'horizontal', 1, 40);
  for (const id of layout.macros) {
    assert.equal(MACROS[id].difficulty, 1, `stage 1: macro ${id} is difficulty 1`);
  }
});

test('composeArea: stage 3 can include difficulty-3 macros', () => {
  // With a large budget, stage 3 should eventually place a difficulty-3 macro.
  let found = false;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const rng = createRng(seed);
    const layout = composeArea(rng, 'horizontal', 3, 40);
    if (layout.macros.some((id) => MACROS[id].difficulty === 3)) {
      found = true;
      break;
    }
  }
  assert.ok(found, 'stage 3: at least one seed produces a difficulty-3 macro');
});

// ---------------------------------------------------------------------------
// Progression -1 to -4 (generation.md §5) + length doubling (structure.md §6)
// ---------------------------------------------------------------------------

test('STAGE_WEIGHTS: -1 is sparse/simple, -4 is dense/hard (generation.md §5)', () => {
  // -1 uses ONLY difficulty-1 macros; -4 weights difficulty-3 heaviest.
  assert.deepEqual(Object.keys(STAGE_WEIGHTS['1']), ['1'], '-1: only difficulty 1');
  assert.ok(STAGE_WEIGHTS['4'][3] >= 1, '-4: difficulty 3 is the top weight');
  assert.ok(STAGE_WEIGHTS['4'][1] < STAGE_WEIGHTS['4'][3], '-4: difficulty 1 weighted below 3');
});

test('progression: stage 1 areas are visibly sparser than stage 4 (generation.md §5)', () => {
  // -1 must have FEWER obstacles (block/platform units) than -4 at the same
  // (real) horizontal area budget. This is the "visibly sparser" acceptance
  // criterion: fewer, more simply-arranged obstacles with room to move.
  const budget = areaLengthBudget('horizontal');
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  let density1 = 0;
  let density4 = 0;
  for (const seed of seeds) {
    const l1 = composeAreaSeeded(seed, 'horizontal', 1, budget);
    const l4 = composeAreaSeeded(seed, 'horizontal', 4, budget);
    // Every stage must produce a completable (validated) route.
    validateLayout(l1);
    validateLayout(l4);
    density1 += layoutDensity(l1);
    density4 += layoutDensity(l4);
  }
  const avg1 = density1 / seeds.length;
  const avg4 = density4 / seeds.length;
  assert.ok(
    avg1 < avg4,
    `stage 1 avg density ${avg1.toFixed(2)} must be less than stage 4 avg density ${avg4.toFixed(2)}`,
  );
});

test('progression: macro difficulty rises across -1 → -4 (generation.md §5)', () => {
  // Across the four stages, the AVERAGE macro difficulty must be non-decreasing
  // and -4 must strictly exceed -1 (stronger combos later).
  const budget = areaLengthBudget('horizontal');
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  const avgDiff = {};
  for (const stage of [1, 2, 3, 4]) {
    let total = 0;
    let count = 0;
    for (const seed of seeds) {
      const l = composeAreaSeeded(seed, 'horizontal', stage, budget);
      for (const id of l.macros) {
        total += MACROS[id].difficulty;
        count++;
      }
    }
    avgDiff[stage] = total / count;
  }
  assert.ok(avgDiff[1] < avgDiff[4], `avg difficulty 1 (${avgDiff[1].toFixed(2)}) < 4 (${avgDiff[4].toFixed(2)})`);
  assert.ok(avgDiff[2] >= avgDiff[1], 'avg difficulty 2 >= 1');
  assert.ok(avgDiff[4] >= avgDiff[3], 'avg difficulty 4 >= 3 (strongest combos)');
});

test('progression: all four stages produce completable routes (generation.md §5/§6)', () => {
  // For each stage, composing at the real area budget must yield a layout that
  // passes validation (no impossible gaps, entry/exit clear, no buried
  // landings, reachable elevations) — i.e. a completable route.
  const budget = areaLengthBudget('horizontal');
  const vBudget = areaLengthBudget('vertical');
  for (const stage of [1, 2, 3, 4]) {
    for (const seed of [1, 7, 42, 100]) {
      const l = composeAreaSeeded(seed, 'horizontal', stage, budget);
      assert.ok(l.macros.length > 0, `stage ${stage} seed ${seed}: at least one macro`);
      validateLayout(l); // throws if the route is not completable
    }
    // The vertical slot stage must also compose a completable vertical climb.
    if (stage !== 1) {
      const lv = composeAreaSeeded(42, 'vertical', stage, vBudget);
      validateLayout(lv);
    }
  }
});

// ---------------------------------------------------------------------------
// Length doubling (structure.md §6, generation.md §7)
// ---------------------------------------------------------------------------

test('length: horizontal area budget is ~2x the prototype segment (structure.md §6)', () => {
  // The measured prototype baseline was ~2000px per checkpoint segment
  // (8000px corridor / 4 segments). The target is ~2x that = ~4000px.
  const PROTOTYPE_SEGMENT_PX = 2000;
  assert.equal(
    HORIZONTAL_AREA_LENGTH_PX,
    2 * PROTOTYPE_SEGMENT_PX,
    'horizontal area length is exactly 2x the prototype segment',
  );
  // In unit space the budget is the px target scaled by UNIT_PX.
  assert.equal(
    areaLengthBudget('horizontal'),
    Math.round(HORIZONTAL_AREA_LENGTH_PX / UNIT_PX),
    'horizontal budget is the px target in width-units',
  );
});

test('length: vertical area budget is the ~3-screen climb height, NOT doubled (structure.md §6)', () => {
  // Vertical length is tuned separately and must NOT be blindly doubled
  // (structure.md §6). It stays at the ~3-screen (VIEW_H × 3) climb height.
  assert.ok(
    VERTICAL_AREA_LENGTH_PX < HORIZONTAL_AREA_LENGTH_PX,
    'vertical area is shorter than the doubled horizontal area (not doubled)',
  );
  assert.equal(
    areaLengthBudget('vertical'),
    Math.round(VERTICAL_AREA_LENGTH_PX / UNIT_PX),
    'vertical budget is the climb height in units',
  );
});

test('length: composed horizontal areas meet the doubled budget in px', () => {
  // A composed horizontal area's total width in px (units × UNIT_PX) must be
  // at least the budget's px target (≈4000px). totalWidth = max(budget, axisPos),
  // so it is always >= budget; the budget itself is the ~2x prototype segment.
  const budget = areaLengthBudget('horizontal');
  const budgetPx = Math.round(budget * UNIT_PX);
  for (const seed of [1, 7, 42, 100]) {
    const l = composeAreaSeeded(seed, 'horizontal', 4, budget);
    const widthPx = l.totalWidth * UNIT_PX;
    assert.ok(
      widthPx >= budgetPx,
      `seed ${seed}: composed width ${widthPx}px is at least the budget ${budgetPx}px`,
    );
    // And the budget is ~2x the prototype segment (within rounding tolerance).
    assert.ok(
      Math.abs(budgetPx - HORIZONTAL_AREA_LENGTH_PX) <= UNIT_PX,
      `budget ${budgetPx}px is within one unit of the 2x target ${HORIZONTAL_AREA_LENGTH_PX}px`,
    );
  }
});

// ---------------------------------------------------------------------------
// Vertical slot: exactly one of 2/3/4 is vertical, fixed for the game
// (structure.md §1) — the composer respects the configured slot.
// ---------------------------------------------------------------------------

test('vertical slot: the configured area composes as a vertical climb (structure.md §1)', () => {
  const def = LEVELS[0];
  assert.ok([2, 3, 4].includes(def.verticalArea), 'Level 1 vertical slot is 2/3/4');
  const zones = buildLevelZones(def);
  const verticalZone = zones.find((z) => z.idx === def.verticalArea);
  assert.equal(verticalZone.orientation, 'vertical', 'the configured area is the vertical one');
  const layout = buildZoneTerrain(verticalZone, createRng(42));
  assert.equal(layout.orientation, 'vertical', 'buildZoneTerrain composes the vertical slot vertically');
  assert.equal(layout.stage, def.verticalArea, 'the vertical area uses its own stage');
  validateLayout(layout);
});

test('vertical slot: exactly one area is vertical and it is fixed for the game (structure.md §1)', () => {
  // Composing ALL areas from a single seed: exactly one is vertical, and it is
  // the configured slot — deterministic and fixed for the whole game.
  const def = LEVELS[0];
  const result = buildAllZoneTerrain(def, 12345);
  const verticalIdx = [...result.keys()].filter((idx) => result.get(idx).orientation === 'vertical');
  assert.deepEqual(verticalIdx, [def.verticalArea], 'exactly one vertical area, at the configured slot');
  // Every composed area is a completable route.
  for (const layout of result.values()) validateLayout(layout);
});

// ---------------------------------------------------------------------------
// composeArea: determinism (lifecycle.md §6)
// ---------------------------------------------------------------------------

test('composeArea: same seed produces identical layout (determinism)', () => {
  const seed = 20240517;
  const layout1 = composeAreaSeeded(seed, 'horizontal', 2, 25);
  const layout2 = composeAreaSeeded(seed, 'horizontal', 2, 25);

  // The layouts must be deep-equal: same macros, same units, same gaps, same x positions.
  assert.deepEqual(
    layout1.macros,
    layout2.macros,
    'same seed: same macro sequence',
  );
  assert.deepEqual(
    layout1.units.map((u) => ({ x: u.x, kind: u.kind, aabb: u.aabb })),
    layout2.units.map((u) => ({ x: u.x, kind: u.kind, aabb: u.aabb })),
    'same seed: same unit positions',
  );
  assert.deepEqual(
    layout1.gaps,
    layout2.gaps,
    'same seed: same gaps',
  );
  assert.equal(
    layout1.totalWidth,
    layout2.totalWidth,
    'same seed: same total width',
  );
});

test('composeArea: different seeds produce different layouts', () => {
  // Use a realistic area budget so the composition actually varies between
  // seeds (a tiny budget collapses to a single macro and can collide).
  const layout1 = composeAreaSeeded(1, 'horizontal', 2, 40);
  const layout2 = composeAreaSeeded(2, 'horizontal', 2, 40);

  // It's theoretically possible (but extremely unlikely) that two different
  // seeds produce the same macro sequence. We check the full layout shape.
  const same = JSON.stringify(layout1.macros) === JSON.stringify(layout2.macros)
    && JSON.stringify(layout1.units.map((u) => u.x)) === JSON.stringify(layout2.units.map((u) => u.x));
  assert.ok(!same, 'different seeds should produce different layouts');
});

test('composeArea: determinism holds across multiple seeds and stages', () => {
  for (const seed of [100, 200, 300]) {
    for (const stage of [1, 2, 3]) {
      const a = composeAreaSeeded(seed, 'horizontal', stage, 40);
      const b = composeAreaSeeded(seed, 'horizontal', stage, 40);
      assert.deepEqual(a.macros, b.macros, `seed ${seed} stage ${stage}: same macros`);
      assert.deepEqual(
        a.units.map((u) => ({ x: u.x, kind: u.kind })),
        b.units.map((u) => ({ x: u.x, kind: u.kind })),
        `seed ${seed} stage ${stage}: same unit positions`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// composeArea: error handling
// ---------------------------------------------------------------------------

test('composeArea: throws on invalid orientation', () => {
  const rng = createRng(1);
  assert.throws(() => composeArea(rng, 'diagonal', 1, 20), /orientation/);
});

test('composeArea: throws on invalid stage', () => {
  const rng = createRng(1);
  assert.throws(() => composeArea(rng, 'horizontal', 0, 40), /stage/);
  assert.throws(() => composeArea(rng, 'horizontal', 5, 40), /stage/);
});

test('composeArea: throws on budget too small', () => {
  const rng = createRng(1);
  assert.throws(() => composeArea(rng, 'horizontal', 1, 2), /budget/);
});

// ---------------------------------------------------------------------------
// validateLayout: independent validation
// ---------------------------------------------------------------------------

test('validateLayout: passes on a valid layout', () => {
  const rng = createRng(42);
  const layout = composeArea(rng, 'horizontal', 2, 25);
  // Should not throw.
  validateLayout(layout);
});

test('validateLayout: throws on impossible gap', () => {
  const layout = {
    orientation: 'horizontal',
    stage: 1,
    budget: 20,
    entryClear: ENTRY_CLEAR,
    exitClear: EXIT_CLEAR,
    macros: [],
    units: [],
    gaps: [{ x: 5, width: MAX_CLEARABLE_GAP + 1 }],
    totalWidth: 20,
    placements: [],
  };
  assert.throws(() => validateLayout(layout), /impossible gap/);
});

test('validateLayout: throws on unit in entry zone', () => {
  const layout = {
    orientation: 'horizontal',
    stage: 1,
    budget: 20,
    entryClear: ENTRY_CLEAR,
    exitClear: EXIT_CLEAR,
    macros: [],
    units: [{ kind: 'block', x: 1, width: 1, height: 1, tier: 0, solid: true, oneWay: false, aabb: { x: 1, y: 0, w: 1, h: 1 } }],
    gaps: [],
    totalWidth: 20,
    placements: [],
  };
  assert.throws(() => validateLayout(layout), /entry zone/);
});

test('validateLayout: throws on unit in exit zone', () => {
  const layout = {
    orientation: 'horizontal',
    stage: 1,
    budget: 20,
    entryClear: ENTRY_CLEAR,
    exitClear: EXIT_CLEAR,
    macros: [],
    units: [{ kind: 'block', x: 17, width: 1, height: 1, tier: 0, solid: true, oneWay: false, aabb: { x: 17, y: 0, w: 1, h: 1 } }],
    gaps: [],
    totalWidth: 20,
    placements: [],
  };
  assert.throws(() => validateLayout(layout), /exit zone/);
});

test('validateLayout: throws on buried platform', () => {
  const layout = {
    orientation: 'horizontal',
    stage: 1,
    budget: 20,
    entryClear: ENTRY_CLEAR,
    exitClear: EXIT_CLEAR,
    macros: [],
    units: [
      // Block at x=5, height 2
      { kind: 'block', x: 5, width: 1, height: 2, tier: 0, solid: true, oneWay: false, aabb: { x: 5, y: 0, w: 1, h: 2 } },
      // Platform at x=5, tier 1 (buried by the height-2 block)
      { kind: 'platform', x: 5, width: 1, tier: 1, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 1, w: 1, h: 1 } },
    ],
    gaps: [],
    totalWidth: 20,
    placements: [],
  };
  assert.throws(() => validateLayout(layout), /buried/);
});

test('validateLayout: throws on elevation step > 1 tier', () => {
  const layout = {
    orientation: 'vertical',
    stage: 2,
    budget: 20,
    entryClear: ENTRY_CLEAR,
    exitClear: EXIT_CLEAR,
    macros: [],
    units: [
      { kind: 'platform', x: 5, width: 2, tier: 1, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 1, w: 2, h: 1 }, placementId: 1 },
      { kind: 'platform', x: 8, width: 2, tier: 3, thickness: 1, oneWay: true, solid: false, aabb: { x: 8, y: 3, w: 2, h: 1 }, placementId: 1 },
    ],
    gaps: [],
    totalWidth: 20,
    placements: [],
  };
  assert.throws(() => validateLayout(layout), /elevation step/);
});

test('validateLayout: throws on unreachable inter-macro join (R2 #2)', () => {
  // Two vertical macros stacked with a 4-tier gap between macro 0's peak
  // (y=3) and macro 1's first platform (y=7). The hero standing on y=3
  // cannot double-jump 4 tiers up to y=7 — this is an unreachable join.
  const layout = {
    orientation: 'vertical',
    stage: 2,
    budget: 20,
    entryClear: ENTRY_CLEAR,
    exitClear: EXIT_CLEAR,
    macros: ['climbing', 'climbing'],
    units: [
      // Macro 0 (placementId 0): platforms at y=1, y=2, y=3 (peak at y=3).
      { kind: 'platform', x: 5, width: 2, tier: 1, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 1, w: 2, h: 1 }, placementId: 0 },
      { kind: 'platform', x: 5, width: 2, tier: 2, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 2, w: 2, h: 1 }, placementId: 0 },
      { kind: 'platform', x: 5, width: 2, tier: 3, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 3, w: 2, h: 1 }, placementId: 0 },
      // Macro 1 (placementId 1): platforms at y=7, y=8, y=9 (first at y=7).
      { kind: 'platform', x: 5, width: 2, tier: 1, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 7, w: 2, h: 1 }, placementId: 1 },
      { kind: 'platform', x: 5, width: 2, tier: 2, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 8, w: 2, h: 1 }, placementId: 1 },
      { kind: 'platform', x: 5, width: 2, tier: 3, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 9, w: 2, h: 1 }, placementId: 1 },
    ],
    gaps: [],
    totalWidth: 20,
    placements: [],
  };
  assert.throws(
    () => validateLayout(layout),
    /inter-macro.*unreachable|unreachable join/,
    'unreachable inter-macro join must be flagged',
  );
});

test('validateLayout: passes on a reachable inter-macro join (R2 #2)', () => {
  // Two vertical macros stacked with a 1-tier gap between macro 0's peak
  // (y=3) and macro 1's first platform (y=4). The hero standing on y=3
  // can double-jump 1 tier up to y=4 — this is a reachable join.
  const layout = {
    orientation: 'vertical',
    stage: 2,
    budget: 20,
    entryClear: ENTRY_CLEAR,
    exitClear: EXIT_CLEAR,
    macros: ['climbing', 'climbing'],
    units: [
      // Macro 0 (placementId 0): platforms at y=1, y=2, y=3 (peak at y=3).
      { kind: 'platform', x: 5, width: 2, tier: 1, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 1, w: 2, h: 1 }, placementId: 0 },
      { kind: 'platform', x: 5, width: 2, tier: 2, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 2, w: 2, h: 1 }, placementId: 0 },
      { kind: 'platform', x: 5, width: 2, tier: 3, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 3, w: 2, h: 1 }, placementId: 0 },
      // Macro 1 (placementId 1): platforms at y=4, y=5, y=6 (first at y=4).
      { kind: 'platform', x: 5, width: 2, tier: 1, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 4, w: 2, h: 1 }, placementId: 1 },
      { kind: 'platform', x: 5, width: 2, tier: 2, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 5, w: 2, h: 1 }, placementId: 1 },
      { kind: 'platform', x: 5, width: 2, tier: 3, thickness: 1, oneWay: true, solid: false, aabb: { x: 5, y: 6, w: 2, h: 1 }, placementId: 1 },
    ],
    gaps: [],
    totalWidth: 20,
    placements: [],
  };
  // Should NOT throw.
  validateLayout(layout);
});
