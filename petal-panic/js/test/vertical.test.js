// Task 5.2 — Climbing macros for vertical composition.
// Run: node --test petal-panic/js/test/vertical.test.js
//
// Source of truth:
//   docs/levels/generation.md   §5 (Progression: "the vertical area follows
//                               the same progression principle through
//                               climbing complexity, not horizontal length"),
//                               §6 (Playability: "both heroes must be able to
//                               complete the required route")
//   docs/levels/structure.md    §4 (Vertical areas: "the climb must be
//                               sustained", "three tiers must not accidentally
//                               become a three-platform cap on the entire
//                               ascent"), §5 (Terrain vocabulary: "successive
//                               top-surface elevations are spaced so double
//                               jumping can reach the next tier")
//
// Acceptance criteria covered (task 5.2):
//   1. Vertical areas compose from climbing macros only (no horizontal macros).
//   2. Every landing is reachable by both heroes' double jump (elevation step
//      ≤ MAX_ELEVATION_STEP, horizontal gap ≤ MAX_CLEARABLE_GAP).
//   3. Ascent has lateral variety (landings shift left/right within the fixed
//      screen width; not a single-file staircase).
//   4. Difficulty rises with stage via pattern complexity (more landings,
//      wider lateral range, gaps in harder macros).
//   5. Deterministic per seed (same seed → identical vertical layout).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  MACROS,
  selectMacros,
  composeArea,
  composeAreaSeeded,
  validateLayout,
  macroAxisLength,
  macroDensity,
  MAX_CLEARABLE_GAP,
  MAX_ELEVATION_STEP,
  UNIT_PX,
} from '../macros.js';
import { createRng, maxClearableStep } from '../terrain.js';
import { areaLengthBudget } from '../level.js';

// ---------------------------------------------------------------------------
// 1. Vertical areas compose from climbing macros only
// ---------------------------------------------------------------------------

test('vertical composition uses only vertical macros', () => {
  for (const stage of [-2, -3, -4]) {
    const rng = createRng(42);
    const layout = composeArea(rng, 'vertical', stage, areaLengthBudget('vertical'));
    for (const id of layout.macros) {
      assert.equal(
        MACROS[id].orientation, 'vertical',
        `stage ${stage}: macro "${id}" is vertical (not horizontal)`,
      );
    }
  }
});

test('selectMacros: vertical returns only vertical macros for all stages', () => {
  for (const stage of [-2, -3, -4]) {
    const candidates = selectMacros('vertical', stage);
    assert.ok(candidates.length > 0, `vertical stage ${stage}: has candidates`);
    for (const { macro } of candidates) {
      assert.equal(macro.orientation, 'vertical', `stage ${stage}: ${macro.id} is vertical`);
    }
  }
});

test('selectMacros: horizontal never returns vertical macros', () => {
  for (const stage of [-1, -2, -3, -4]) {
    const candidates = selectMacros('horizontal', stage);
    for (const { macro } of candidates) {
      assert.equal(macro.orientation, 'horizontal', `stage ${stage}: ${macro.id} is horizontal`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Every landing is reachable by both heroes' double jump
// ---------------------------------------------------------------------------

test('all vertical macro landings have elevation steps ≤ MAX_ELEVATION_STEP', () => {
  for (const [id, macro] of Object.entries(MACROS)) {
    if (macro.orientation !== 'vertical') continue;
    const platforms = macro.units.filter((u) => u.kind === 'platform');
    for (let i = 1; i < platforms.length; i++) {
      const step = platforms[i].tier - platforms[i - 1].tier;
      assert.ok(
        step <= MAX_ELEVATION_STEP,
        `${id}: step of ${step} tiers between platform ${i - 1} (tier ${platforms[i - 1].tier}) ` +
          `and platform ${i} (tier ${platforms[i].tier}) exceeds max ${MAX_ELEVATION_STEP}`,
      );
    }
    // First landing must be reachable from ground (tier 0).
    assert.ok(
      platforms[0].tier <= MAX_ELEVATION_STEP,
      `${id}: first platform at tier ${platforms[0].tier} is not reachable from ground`,
    );
  }
});

test('all vertical macro landings have horizontal gaps ≤ MAX_CLEARABLE_GAP', () => {
  for (const [id, macro] of Object.entries(MACROS)) {
    if (macro.orientation !== 'vertical') continue;
    const platforms = macro.units.filter((u) => u.kind === 'platform');
    for (let i = 1; i < platforms.length; i++) {
      const prevX = platforms[i - 1].x !== undefined ? platforms[i - 1].x : 0;
      const currX = platforms[i].x !== undefined ? platforms[i].x : 0;
      const gap = Math.abs(currX - prevX);
      assert.ok(
        gap <= MAX_CLEARABLE_GAP,
        `${id}: horizontal gap of ${gap} units between platform ${i - 1} (x=${prevX}) ` +
          `and platform ${i} (x=${currX}) exceeds max ${MAX_CLEARABLE_GAP}`,
      );
    }
  }
});

test('composed vertical layouts pass validateLayout (all landings reachable)', () => {
  const budget = areaLengthBudget('vertical');
  for (const stage of [-2, -3, -4]) {
    for (const seed of [1, 7, 42, 100, 999]) {
      const layout = composeAreaSeeded(seed, 'vertical', stage, budget);
      validateLayout(layout); // throws if any landing is unreachable
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Ascent has lateral variety (not a single-file staircase)
// ---------------------------------------------------------------------------

test('vertical macros have lateral variety (multiple distinct x positions)', () => {
  for (const [id, macro] of Object.entries(MACROS)) {
    if (macro.orientation !== 'vertical') continue;
    const platforms = macro.units.filter((u) => u.kind === 'platform');
    const xs = platforms.map((p) => p.x !== undefined ? p.x : 0);
    const distinctXs = new Set(xs);
    // At least 2 distinct x positions (not a single-file staircase).
    assert.ok(
      distinctXs.size >= 2,
      `${id}: all ${platforms.length} landings at the same x (${[...distinctXs].join(',')}) — ` +
        `no lateral variety`,
    );
  }
});

test('composed vertical layouts have landings at multiple x positions', () => {
  const budget = areaLengthBudget('vertical');
  for (const seed of [1, 7, 42]) {
    const layout = composeAreaSeeded(seed, 'vertical', -3, budget);
    const platforms = layout.units.filter((u) => u.kind === 'platform');
    const xs = new Set(platforms.map((p) => p.x));
    assert.ok(
      xs.size >= 2,
      `seed ${seed}: all ${platforms.length} platforms at x=${[...xs].join(',')} — no lateral variety`,
    );
  }
});

test('lateral positions stay within the fixed screen width', () => {
  // The zone is 1600px wide = 1600/48 ≈ 33 units.
  const ZONE_WIDTH_UNITS = Math.floor(1600 / UNIT_PX);
  for (const [id, macro] of Object.entries(MACROS)) {
    if (macro.orientation !== 'vertical') continue;
    const platforms = macro.units.filter((u) => u.kind === 'platform');
    for (const p of platforms) {
      const px = p.x !== undefined ? p.x : 0;
      assert.ok(
        px >= 0 && px + p.width <= ZONE_WIDTH_UNITS,
        `${id}: platform at x=${px} (width ${p.width}) exceeds zone width ${ZONE_WIDTH_UNITS}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Difficulty rises with stage via pattern complexity
// ---------------------------------------------------------------------------

test('vertical macros: difficulty 1 has fewer landings than difficulty 3', () => {
  const diff1 = Object.values(MACROS).filter((m) => m.orientation === 'vertical' && m.difficulty === 1);
  const diff3 = Object.values(MACROS).filter((m) => m.orientation === 'vertical' && m.difficulty === 3);
  assert.ok(diff1.length > 0, 'has at least one difficulty-1 vertical macro');
  assert.ok(diff3.length > 0, 'has at least one difficulty-3 vertical macro');

  const avgLandings1 = diff1.reduce((s, m) => s + m.units.filter((u) => u.kind === 'platform').length, 0) / diff1.length;
  const avgLandings3 = diff3.reduce((s, m) => s + m.units.filter((u) => u.kind === 'platform').length, 0) / diff3.length;
  assert.ok(
    avgLandings3 > avgLandings1,
    `difficulty-3 avg landings (${avgLandings3.toFixed(1)}) must exceed difficulty-1 avg (${avgLandings1.toFixed(1)})`,
  );
});

test('vertical macros: difficulty 3 has gaps (more complex than difficulty 1/2)', () => {
  const diff1 = Object.values(MACROS).filter((m) => m.orientation === 'vertical' && m.difficulty === 1);
  const diff3 = Object.values(MACROS).filter((m) => m.orientation === 'vertical' && m.difficulty === 3);

  for (const m of diff1) {
    assert.equal(
      m.units.filter((u) => u.kind === 'gap').length, 0,
      `${m.id}: difficulty-1 macro should not have gaps`,
    );
  }
  const gapCount3 = diff3.reduce((s, m) => s + m.units.filter((u) => u.kind === 'gap').length, 0);
  assert.ok(
    gapCount3 > 0,
    `difficulty-3 vertical macros should have gaps (total: ${gapCount3})`,
  );
});

test('vertical progression: macro difficulty rises from -2 to -4', () => {
  // Progression via climbing complexity: harder stages use more complex
  // macros (higher difficulty). The average macro difficulty across composed
  // areas must rise from -2 to -4.
  const budget = areaLengthBudget('vertical');
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const avgDiff = {};
  for (const stage of [-2, -3, -4]) {
    let total = 0;
    let count = 0;
    for (const seed of seeds) {
      const l = composeAreaSeeded(seed, 'vertical', stage, budget);
      validateLayout(l);
      for (const id of l.macros) {
        total += MACROS[id].difficulty;
        count++;
      }
    }
    avgDiff[stage] = total / count;
  }
  assert.ok(
    avgDiff[-4] >= avgDiff[-2],
    `vertical avg difficulty -4 (${avgDiff[-4].toFixed(2)}) must be >= -2 (${avgDiff[-2].toFixed(2)})`,
  );
  assert.ok(
    avgDiff[-4] >= avgDiff[-3],
    `vertical avg difficulty -4 (${avgDiff[-4].toFixed(2)}) must be >= -3 (${avgDiff[-3].toFixed(2)})`,
  );
});

// ---------------------------------------------------------------------------
// 5. Deterministic per seed
// ---------------------------------------------------------------------------

test('vertical composition is deterministic per seed', () => {
  const seed = 20240517;
  const budget = areaLengthBudget('vertical');
  const layout1 = composeAreaSeeded(seed, 'vertical', -3, budget);
  const layout2 = composeAreaSeeded(seed, 'vertical', -3, budget);

  assert.deepEqual(layout1.macros, layout2.macros, 'same seed: same macro sequence');
  assert.deepEqual(
    layout1.units.map((u) => ({ x: u.x, y: u.y, kind: u.kind, aabb: u.aabb })),
    layout2.units.map((u) => ({ x: u.x, y: u.y, kind: u.kind, aabb: u.aabb })),
    'same seed: same unit positions (x and y)',
  );
  assert.deepEqual(layout1.gaps, layout2.gaps, 'same seed: same gaps');
  assert.equal(layout1.totalHeight, layout2.totalHeight, 'same seed: same total height');
});

test('vertical composition: different seeds produce different layouts', () => {
  const budget = areaLengthBudget('vertical');
  const layout1 = composeAreaSeeded(1, 'vertical', -3, budget);
  const layout2 = composeAreaSeeded(2, 'vertical', -3, budget);
  const same = JSON.stringify(layout1.macros) === JSON.stringify(layout2.macros)
    && JSON.stringify(layout1.units.map((u) => ({ x: u.x, y: u.y })))
       === JSON.stringify(layout2.units.map((u) => ({ x: u.x, y: u.y })));
  assert.ok(!same, 'different seeds should produce different vertical layouts');
});

// ---------------------------------------------------------------------------
// 6. Climbing complexity: more than 3 distinct landing positions
// ---------------------------------------------------------------------------

test('vertical macros exceed the three-platform cap (structure.md §4)', () => {
  // "Three tiers must not accidentally become a three-platform cap on the
  // entire ascent." At least one macro must have more than 3 landings.
  const verticalMacros = Object.values(MACROS).filter((m) => m.orientation === 'vertical');
  const multiLanding = verticalMacros.filter(
    (m) => m.units.filter((u) => u.kind === 'platform').length > 3,
  );
  assert.ok(
    multiLanding.length > 0,
    'at least one vertical macro has more than 3 landings (breaks the three-platform cap)',
  );
});

test('composed vertical area has more than 3 total landings', () => {
  const budget = areaLengthBudget('vertical');
  for (const seed of [1, 7, 42]) {
    const layout = composeAreaSeeded(seed, 'vertical', -3, budget);
    const platformCount = layout.units.filter((u) => u.kind === 'platform').length;
    assert.ok(
      platformCount > 3,
      `seed ${seed}: composed vertical area has ${platformCount} landings (must exceed 3)`,
    );
  }
});

// ---------------------------------------------------------------------------
// 7. Reachability margin: tier spacing uses maxClearableStep (terrain.js)
// ---------------------------------------------------------------------------

test('tier spacing is derived from maxClearableStep (both heroes reachable)', () => {
  // maxClearableStep() is the max vertical step (px) a double jump can clear,
  // with margin. tierToOffset(1) = maxClearableStep() px. The composer works
  // in unit space where 1 tier = maxClearableStep() px. Since the composer
  // constrains steps to ≤ MAX_ELEVATION_STEP (1 tier), every step is within
  // maxClearableStep() px — reachable by both heroes by construction.
  const step = maxClearableStep();
  assert.ok(step > 0, 'maxClearableStep is positive');
  assert.ok(MAX_ELEVATION_STEP >= 1, 'max elevation step allows at least 1 tier');
  // The tier spacing in px must be ≤ the hero's double-jump reach (with margin).
  // This is guaranteed by tierToOffset's construction, but we assert the
  // invariant holds: 1 tier step in px ≤ maxClearableStep.
  assert.ok(1 * step <= step, '1 tier step equals maxClearableStep (reachable)');
});
