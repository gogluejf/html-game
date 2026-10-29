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
import { UNIT_PX_X, UNIT_PX_Y } from '../world/macros.js';
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
  const expected = uniformScale(data.anims.block_single, UNIT_PX_Y);
  assert.ok(Math.abs(expected - UNIT_PX_Y / 243) < 1e-9, 'reference: 48 / collision h 243');

  await loadLevelAsset(1, 'block');
  _clearAllTilePools();
  const s = { x: 0, y: 100, w: UNIT_PX_X, h: UNIT_PX_Y, oneWay: false };
  const e = getTileSprites(s, 1, tileSolid(s, 1, 42))[0];
  assert.equal(e._spriteScale, expected, 'scale comes from the authored collision box');
});

test('platform_single tile uses platform_single collision box (h 160)', async () => {
  const data = parseSheet(await readSheet('platform_single_sheet.json'));
  const expected = uniformScale(data.anims.platform_single, UNIT_PX_Y);
  assert.ok(Math.abs(expected - UNIT_PX_Y / 160) < 1e-9);

  await loadLevelAsset(1, 'platform');
  _clearAllTilePools();
  const s = { x: 0, y: 200, w: UNIT_PX_X, h: UNIT_PX_Y, oneWay: true };
  const pool = getTileSprites(s, 1, tileSolid(s, 1, 42));
  // 1 unit wide → single variant.
  assert.equal(pool[0]._spriteScale, expected);
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
  assert.deepEqual(rects[0].rect, [0, 200, 3 * UNIT_PX_X, UNIT_PX_Y]);
});

test('pool is reused for identical solids, rebuilt when the rect changes', async () => {
  await loadLevelAsset(1, 'block');
  _clearAllTilePools();
  const s = { x: 0, y: 100, w: UNIT_PX_X, h: UNIT_PX_Y, oneWay: false };
  const t1 = tileSolid(s, 1, 42);
  const p1 = getTileSprites(s, 1, t1);
  assert.equal(getTileSprites(s, 1, t1), p1, 'same rect + tiles → same pool');
  const s2 = { x: 0, y: 52, w: UNIT_PX_X, h: UNIT_PX_Y, oneWay: false }; // moved 1u
  assert.notEqual(getTileSprites(s2, 1, tileSolid(s2, 1, 42)), p1, 'new rect → new pool');
});
