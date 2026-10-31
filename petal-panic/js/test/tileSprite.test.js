// tileSprite.js — terrain tiles as real sprite entities (sprite-engine M8).
// Each block/platform tile must scale from its variant sheet's authored
// collision box via setAnim() — uniform, no stretching (sprites.md §4,
// terrain-tiling.md §Scaling). Run: node --test petal-panic/js/test/tileSprite.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { loadLevelAsset } from '../world/levelAssets.js';
import { tileSolid } from '../world/terrainTiles.js';
import { getTileSprites, drawTileSprites, _clearAllTilePools } from '../world/tileSprite.js';
import { UNIT_PX_X, UNIT_PX_Y, PLATFORM_DRAW_H } from '../world/macros.js';
import { BLOCK_FOOTPRINT } from '../world/squareGrid.js';
import { parseSheet, uniformScale } from '../core/spriteData.js';

/** Minimal canvas ctx recorder. */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    fillRect(...a) { calls.push({ rect: a }); },
    drawImage(img, ...args) { calls.push({ img, args }); },
  };
}

async function readSheet(name) {
  const url = new URL(`../../assets/levels/level1/${name}`, import.meta.url);
  return JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
}

test('block_single tile scales from the sheet collision box (§4)', async () => {
  const data = parseSheet(await readSheet('block_single_sheet.json'));
  // level1 block_single collision box: w=464 (frame width), h=232 (ratio 2:1).
  const refH = data.anims.block_single.collisionBox.h;
  const expected = uniformScale(data.anims.block_single, UNIT_PY_TARGET(1));
  function UNIT_PY_TARGET(units) { return units * UNIT_PX_Y; }
  assert.ok(Math.abs(expected - UNIT_PX_Y / refH) < 1e-9, `reference: 48 / collision h ${refH}`);

  await loadLevelAsset(1, 'block');
  _clearAllTilePools();
  const s = { x: 0, y: 100, w: BLOCK_FOOTPRINT.widthCells * UNIT_PX_X, h: UNIT_PX_Y, oneWay: false };
  const e = getTileSprites(s, 1, tileSolid(s, 1, 42))[0];
  assert.equal(e._spriteScale, expected, 'scale comes from the authored collision box');
});

test('platform_single tile pins its slab to the landing face (PLATFORM_DRAW_H)', async () => {
  const data = parseSheet(await readSheet('platform_single_sheet.json'));
  // The sheet's collision box is editor-tuned (art reference, not the tile
  // footprint), so the §4 target for terrain tiles is the TILE RECT height,
  // not the sheet box height: base scale = 1u / box.h, then the one-way pin
  // × PLATFORM_DRAW_H/UNIT_PX_Y makes the drawn slab a thin strip at the
  // platform's top face (build.js R5.1).
  const refH = data.anims.platform_single.collisionBox.h;
  const expected = (UNIT_PX_Y / refH) * PLATFORM_DRAW_H / UNIT_PX_Y;
  assert.ok(Math.abs(expected - PLATFORM_DRAW_H / refH) < 1e-9, `reference: ${PLATFORM_DRAW_H} / collision h ${refH}`);

  await loadLevelAsset(1, 'platform');
  _clearAllTilePools();
  const s = { x: 0, y: 200, w: UNIT_PX_X, h: UNIT_PX_Y, oneWay: true };
  const pool = getTileSprites(s, 1, tileSolid(s, 1, 42));
  // 1 unit wide → single variant. (float: two-step multiply vs one-step)
  assert.ok(Math.abs(pool[0]._spriteScale - expected) < 1e-12);
});

test('drawTileSprites falls back to flat rects when frames are unloaded (node)', async () => {
  await loadLevelAsset(1, 'platform');
  _clearAllTilePools();
  const s = { x: 0, y: 200, w: 7 * UNIT_PX_X, h: UNIT_PX_Y, oneWay: true };
  const pool = getTileSprites(s, 1, tileSolid(s, 1, 42));
  assert.equal(pool.length, 3); // triple+triple+single
  const ctx = makeCtx();
  const drew = drawTileSprites(ctx, pool);
  assert.equal(drew, false, 'no decoded images in node → fallback path');
  const rects = ctx.calls.filter((c) => c.rect);
  assert.equal(rects.length, 3, 'one fallback rect per tile');
  // Fallback rect matches the tile footprint exactly.
  // Right→left draw order: first fallback rect is the right-most triple (x4–7u).
  // Right→left draw order: first fallback rect is the single at x6–7u.
  assert.deepEqual(rects[0].rect, [6 * UNIT_PX_X, 200, 1 * UNIT_PX_X, UNIT_PX_Y]);
});

test('pool is reused for identical solids, rebuilt when the rect changes', async () => {
  await loadLevelAsset(1, 'block');
  _clearAllTilePools();
  const s = { x: 0, y: 100, w: BLOCK_FOOTPRINT.widthCells * UNIT_PX_X, h: UNIT_PX_Y, oneWay: false };
  const t1 = tileSolid(s, 1, 42);
  const p1 = getTileSprites(s, 1, t1);
  assert.equal(getTileSprites(s, 1, t1), p1, 'same rect + tiles → same pool');
  const s2 = { x: 0, y: 52, w: BLOCK_FOOTPRINT.widthCells * UNIT_PX_X, h: UNIT_PX_Y, oneWay: false }; // moved 1u
  assert.notEqual(getTileSprites(s2, 1, tileSolid(s2, 1, 42)), p1, 'new rect → new pool');
});
