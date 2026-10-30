// Shared square-grid contract — unit tests (node --test).
// Run: node --test petal-panic/js/test/squareGrid.test.js
//
// Covers the shared footprint/decomposition contract consumed by the live
// terrain pipeline (world/terrainTiles.js) plus the placement/dimension
// snapping helpers consumed by the runtime validator (macroSchema.js) and
// the macro editor (pointer.js).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  BLOCK_FOOTPRINT, PLATFORM_FOOTPRINT, getFootprint,
  decomposeVariant, blockColumns,
  snapCellX, clampWidth, normalizeUnit, unitGridError,
} from '../world/squareGrid.js';

// --- Footprint configuration ------------------------------------------------------
test('block footprint: fixed width 2, height variants 1/2/3, x-snap 2', () => {
  assert.equal(BLOCK_FOOTPRINT.widthCells, 2);
  assert.equal(BLOCK_FOOTPRINT.snapStepX, 2);
  assert.deepEqual([...BLOCK_FOOTPRINT.heightVariants].sort((a, b) => a - b), [1, 2, 3]);
  assert.deepEqual(BLOCK_FOOTPRINT.widthVariants, [2]);
});

test('platform footprint: height 1, width variants 1/2/3, x-snap 1', () => {
  assert.equal(PLATFORM_FOOTPRINT.snapStepX, 1);
  assert.deepEqual([...PLATFORM_FOOTPRINT.widthVariants].sort((a, b) => a - b), [1, 2, 3]);
  assert.deepEqual(PLATFORM_FOOTPRINT.heightVariants, [1]);
});

test('getFootprint: resolves kinds and rejects unknowns', () => {
  assert.equal(getFootprint('block'), BLOCK_FOOTPRINT);
  assert.equal(getFootprint('platform'), PLATFORM_FOOTPRINT);
  assert.throws(() => getFootprint('barrel'));
});

// --- Variant decomposition ------------------------------------------------------------
test('decomposeVariant: blocks decompose HEIGHT longest-first [3,2,1]', () => {
  assert.deepEqual(decomposeVariant('block', 1), [1]);
  assert.deepEqual(decomposeVariant('block', 2), [2]);
  assert.deepEqual(decomposeVariant('block', 3), [3]);
  assert.deepEqual(decomposeVariant('block', 4), [3, 1]);
  assert.deepEqual(decomposeVariant('block', 5), [3, 2]);
  assert.deepEqual(decomposeVariant('block', 7), [3, 3, 1]);
});

test('decomposeVariant: platforms decompose WIDTH longest-first [3,2,1]', () => {
  assert.deepEqual(decomposeVariant('platform', 1), [1]);
  assert.deepEqual(decomposeVariant('platform', 5), [3, 2]);
  assert.deepEqual(decomposeVariant('platform', 10), [3, 3, 3, 1]);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const parts = decomposeVariant('platform', n);
    assert.equal(parts.reduce((a, b) => a + b, 0), n, `sum for ${n}`);
    for (const p of parts) assert.ok([1, 2, 3].includes(p));
  }
});

test('decomposeVariant: rejects non-positive / non-integer lengths', () => {
  assert.throws(() => decomposeVariant('block', 0));
  assert.throws(() => decomposeVariant('platform', 1.5));
  assert.throws(() => decomposeVariant('block', -1));
});

test('blockColumns: wall of N even cells → N/2 columns of 2', () => {
  assert.deepEqual(blockColumns(2), [2]);
  assert.deepEqual(blockColumns(6), [2, 2, 2]);
  assert.throws(() => blockColumns(3));
  assert.throws(() => blockColumns(0));
});

// --- Placement / dimension snapping (editor + validator contract) -------------------
test('snapCellX: blocks snap to the 2-cell lattice, platforms to whole cells', () => {
  assert.equal(snapCellX('block', 5), 4);
  assert.equal(snapCellX('block', 6), 6);
  assert.equal(snapCellX('block', -1), 0);   // clamped at the origin
  assert.equal(snapCellX('platform', 5), 5);
  assert.equal(snapCellX('platform', 0), 0);
});

test('clampWidth: blocks round up to positive multiples of 2; platforms floor to int ≥ 1', () => {
  assert.equal(clampWidth('block', 1), 2);
  assert.equal(clampWidth('block', 3), 4);
  assert.equal(clampWidth('block', 4), 4);
  assert.equal(clampWidth('block', 0), 2);
  assert.equal(clampWidth('platform', 0.4), 1);
  assert.equal(clampWidth('platform', 3), 3);
});

test('normalizeUnit: blocks land on the lattice with legal width/height', () => {
  const b = normalizeUnit({ kind:'block', x:5, y:0.9, width:3, height:0.4 });
  assert.deepEqual(b, { kind:'block', x:4, y:0, width:4, height:1 });
  const p = normalizeUnit({ kind:'platform', x:7.6, y:0, width:0.2 });
  assert.deepEqual(p, { kind:'platform', x:7, y:1, width:1 }); // platform row floors up to ≥1
});

test('unitGridError: reports each square-grid violation precisely', () => {
  assert.equal(unitGridError({ kind:'block', x:4, y:0, width:2, height:1 }), null);
  assert.match(unitGridError({ kind:'block', x:5, y:0, width:2, height:1 }), /lattice/);
  assert.match(unitGridError({ kind:'block', x:4, y:0, width:3, height:1 }), /multiple of 2/);
  assert.match(unitGridError({ kind:'block', x:4, y:0, width:1, height:1 }), /at least 2/);
  assert.match(unitGridError({ kind:'block', x:4, y:0, width:2, height:0 }), /integer/);
  assert.match(unitGridError({ kind:'block', x:4, y:1.5, width:2, height:1 }), /y=/);
  assert.equal(unitGridError({ kind:'platform', x:3, y:1, width:1 }), null);
  assert.match(unitGridError({ kind:'platform', x:3, y:0, width:1 }), /integer/);
  assert.match(unitGridError({ kind:'platform', x:3, y:1, width:0 }), /width/);
});
