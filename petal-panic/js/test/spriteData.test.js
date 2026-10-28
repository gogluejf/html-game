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
    assert.ok(f.bbox.w > 0 && f.bbox.h > 0);
    assert.match(f.file, /^block_single_f\d\.png$/);
  }
});

test('level1 platform_single parses: 4 frames', () => {
  const data = parseSheet(sheet('levels/level1/platform_single_sheet.json'));
  const anim = Object.values(data.anims)[0];
  assert.equal(anim.frames.length, 4);
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

test('bad enums / zero-size bbox / missing frames throw', () => {
  const base = (over = {}) => ({
    entities: [{ name: 'x', anim: 'a', frames: [{ file: 'f.png', bbox: [0, 0, 5, 5] }], ...over }],
  });
  assert.throws(() => parseSheet({ entities: [{ name: 'x', anim: 'a', mode: 'yoyo', frames: [{ file: 'f.png', bbox: [0, 0, 5, 5] }] }] }), /mode/);
  assert.throws(() => parseSheet(base({ frames: [{ file: 'f.png', bbox: [0, 0, 0, 5] }] })), /zero-size/);
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
test('scaleReference falls back to first frame bbox; prefers collisionBox', () => {
  const data = parseSheet(sheet('objects/checkpoint/level_sheet.json'));
  const anim = data.anims.level;
  assert.deepEqual(scaleReference(anim), anim.frames[0].bbox);

  const withBox = parseSheet({
    entities: [{
      name: 'x', anim: 'a', collisionBox: [2, 3, 20, 40],
      frames: [{ file: 'f.png', bbox: [0, 0, 99, 99] }],
    }],
  }).anims.a;
  assert.deepEqual(scaleReference(withBox), { x: 2, y: 3, w: 20, h: 40 });
});

test('uniformScale fits reference height onto target height (one scalar)', () => {
  // Checkpoint flag art is 525px tall in source; entity box is 48px → scale 48/525.
  const data = parseSheet(sheet('objects/checkpoint/level_sheet.json'));
  const s = uniformScale(data.anims.level, 48);
  assert.ok(Math.abs(s - 48 / 525) < 1e-9);
  // Barrel art 386px tall → 48px box.
  const barrel = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  assert.ok(Math.abs(uniformScale(barrel.anims.wooden, 48) - 48 / 386) < 1e-9);
});

// --- Frame loader (node: no DOM → safe empty resolution) ------------------------
test('loadFrames resolves empty map without a DOM (node)', async () => {
  _clearFrameCache();
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const imgs = await loadFrames(data, 'file:///nonexistent/');
  assert.ok(imgs instanceof Map);
  assert.equal(imgs.size, 0); // no Image in node → nothing loaded, no throw
});
