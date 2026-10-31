// SpriteData parser + frame loader — pure math/contract tests (node --test).
// Run: node --test petal-panic/js/test/spriteData.test.js

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSheet, scaleReference, uniformScale, SPRITE_DEFAULTS } from '../core/spriteData.js';
import { loadFrames, _clearFrameCache } from '../core/frameLoader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', 'assets');

function sheet(path) {
  return JSON.parse(readFileSync(join(ASSETS, path), 'utf8'));
}

// --- Real asset parsing -------------------------------------------------------
test('level1 block_single parses: 1 anim, 2 frames', () => {
  const data = parseSheet(sheet('levels/level1/block_single_sheet.json'));
  const names = Object.keys(data.anims);
  assert.equal(names.length, 1);
  const anim = data.anims[names[0]];
  assert.equal(anim.frames.length, 2); // frame count from JSON only
  for (const f of anim.frames) {
    assert.match(f.file, /^block_single_f\d\.png$/);
    assert.equal(f.bbox, undefined, 'no bbox at runtime — crop is a build-time concern');
  }
});

test('level1 platform_single parses: 6 frames (3 decorated + 3 plain pool)', () => {
  const data = parseSheet(sheet('levels/level1/platform_single_sheet.json'));
  const anim = Object.values(data.anims)[0];
  assert.equal(anim.frames.length, 6);
});

test('checkpoint level + boss sheets merge into one SpriteData', () => {
  const data = parseSheet([
    sheet('objects/checkpoint/level_sheet.json'),
    sheet('objects/checkpoint/boss_sheet.json'),
  ]);
  assert.deepEqual(Object.keys(data.anims).sort(), ['boss', 'level']);
  assert.equal(data.anims.level.frames.length, 1);
});

test('barrel sheets each parse with a single frame', () => {
  for (const name of ['wooden', 'coin', 'explosion']) {
    const data = parseSheet(sheet(`objects/barrel/${name}_sheet.json`));
    const anim = data.anims[name];
    assert.ok(anim, `missing anim ${name}`);
    assert.equal(anim.frames.length, 1);
  }
});

// --- Defaults & validation ----------------------------------------------------
test('defaults: fps 12, loop, forward, fps-timing when fields absent', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const anim = data.anims.wooden;
  assert.equal(anim.fps, SPRITE_DEFAULTS.fps);
  assert.equal(anim.mode, 'loop');
  assert.equal(anim.direction, 'forward');
  assert.equal(anim.timing, 'fps');
});

test('explicit playback fields are honored', () => {
  const json = {
    entities: [{
      name: 'x', anim: 'attack',
      fps: 30, mode: 'once', direction: 'ping_pong_reverse', timing: 'relative',
      frames: [{ file: 'a.png', bbox: [0, 0, 10, 10] }],
    }],
  };
  const anim = parseSheet(json).anims.attack;
  assert.equal(anim.fps, 30);
  assert.equal(anim.mode, 'once');
  assert.equal(anim.direction, 'ping_pong_reverse');
  assert.equal(anim.timing, 'relative');
});

test('bad enums / missing file / missing frames throw', () => {
  const base = (over = {}) => ({
    entities: [{ name: 'x', anim: 'a', frames: [{ file: 'f.png' }], ...over }],
  });
  assert.throws(() => parseSheet({ entities: [{ name: 'x', anim: 'a', mode: 'yoyo', frames: [{ file: 'f.png' }] }] }), /mode/);
  assert.throws(() => parseSheet(base({ frames: [{ bbox: [0, 0, 5, 5] }] })), /missing file/);
  assert.throws(() => parseSheet(base({ frames: [] })), /no frames/);
  assert.throws(() => parseSheet({}), /entities/);
});

test('collisionBox with zero height throws (§4 validation)', () => {
  const json = {
    entities: [{
      name: 'x', anim: 'a', collisionBox: [0, 0, 10, 0],
      frames: [{ file: 'f.png', bbox: [0, 0, 5, 5] }],
    }],
  };
  assert.throws(() => parseSheet(json), /nonzero/);
});

// --- Scaling reference (§4 v1: bbox as reference) ------------------------------
test('scaleReference is the authored collision box (no fallback)', () => {
  const data = parseSheet(sheet('objects/checkpoint/level_sheet.json'));
  assert.deepEqual(scaleReference(data.anims.level), data.anims.level.collisionBox);

  const withBox = parseSheet({
    entities: [{
      name: 'x', anim: 'a', collisionBox: [2, 3, 20, 40],
      frames: [{ file: 'f.png' }],
    }],
  }).anims.a;
  assert.deepEqual(scaleReference(withBox), { x: 2, y: 3, w: 20, h: 40 });

  // A sheet without a collision box cannot be scaled (§4) — hard error.
  const noBox = parseSheet({
    entities: [{ name: 'x', anim: 'a', frames: [{ file: 'f.png' }] }],
  }).anims.a;
  assert.throws(() => scaleReference(noBox), /no collision box/);
});

test('uniformScale fits reference height onto target height (one scalar)', () => {
  // Checkpoint flag art is 525px tall in source; entity box is 48px → scale 48/525.
  const data = parseSheet(sheet('objects/checkpoint/level_sheet.json'));
  const s = uniformScale(data.anims.level, 48);
  assert.ok(Math.abs(s - 48 / 525) < 1e-9);
  // Barrel: use the actual collision box height from the sheet.
  const barrel = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const refH = barrel.anims.wooden.collisionBox.h;
  assert.ok(Math.abs(uniformScale(barrel.anims.wooden, 48) - 48 / refH) < 1e-9);
});

// --- Frame loader (node: no DOM → safe empty resolution) ------------------------
test('loadFrames resolves empty map without a DOM (node)', async () => {
  _clearFrameCache();
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const imgs = await loadFrames(data, 'file:///nonexistent/');
  assert.ok(imgs instanceof Map);
  assert.equal(imgs.size, 0); // no Image in node → nothing loaded, no throw
});
