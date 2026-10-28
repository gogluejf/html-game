// entity.sprite contract + setAnim() — node --test.
// Run: node --test petal-panic/js/test/spriteSetAnim.test.js

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Entity } from '../core/entity.js';
import { parseSheet, uniformScale } from '../core/spriteData.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const sheet = (p) => JSON.parse(readFileSync(join(HERE, '..', '..', 'assets', p), 'utf8'));

function makeSpriteEntity(w, h, anims) {
  const e = new Entity({ x: 100, y: 200, w, h });
  e.sprite = { anchor: 'bottom-center', anims, frames: new Map() };
  return e;
}

test('setAnim computes uniform scale from bbox height onto box height', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const e = makeSpriteEntity(32, 48, data.anims);
  e.setAnim('wooden');
  // Art is 386px tall in source → scale = 48/386.
  assert.ok(Math.abs(e._spriteScale - 48 / 386) < 1e-9);
  assert.equal(e.spriteAnimData, data.anims.wooden);
});

test('setAnim never moves the entity (anchor fixed, §3)', () => {
  const data = parseSheet(sheet('objects/checkpoint/level_sheet.json'));
  const e = makeSpriteEntity(24, 48, data.anims);
  const before = { x: e.x, y: e.y, w: e.w, h: e.h };
  e.setAnim('level');
  assert.deepEqual({ x: e.x, y: e.y, w: e.w, h: e.h }, before);
});

test('unknown anim throws with a clear message', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const e = makeSpriteEntity(32, 48, data.anims);
  assert.throws(() => e.setAnim('nope'), /unknown anim "nope"/);
});

test('entity without sprite data keeps legacy draw path (no crash)', () => {
  const e = new Entity({ x: 0, y: 0, w: 10, h: 10 });
  // A recording ctx: legacy path calls save/translate/fillRect/restore.
  const calls = [];
  const ctx = {
    save: () => calls.push('save'), restore: () => calls.push('restore'),
    translate: () => calls.push('translate'), scale: () => calls.push('scale'),
    rotate: () => calls.push('rotate'), fillRect: () => calls.push('fillRect'),
    set fillStyle(v) { calls.push('fillStyle'); }, get fillStyle() { return ''; },
  };
  e.draw(ctx);
  assert.ok(calls.includes('fillRect')); // debug rect drawn
});

test('drawSprite returns false until frames are loaded (fallback intact)', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const e = makeSpriteEntity(32, 48, data.anims);
  e.setAnim('wooden');
  const ctx = { save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, drawImage() {} };
  assert.equal(e.drawSprite(ctx), false); // empty frame map → legacy fallback
});

test('drawSprite renders the frame bottom-aligned to the anchor when loaded', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const e = makeSpriteEntity(32, 48, data.anims);
  e.setAnim('wooden');
  const fakeImg = { complete: true, naturalWidth: 305, naturalHeight: 386 };
  e.sprite.frames.set(data.anims.wooden.frames[0].file, fakeImg);

  let drawn = null;
  const ctx = {
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    drawImage(img, sx, sy, sw, sh) { drawn = { img, sx, sy, sw, sh }; },
  };
  assert.equal(e.drawSprite(ctx), true);
  assert.equal(drawn.img, fakeImg);
  // Source bbox copied at full size (ctx is pre-scale).
  const bb = data.anims.wooden.frames[0].bbox;
  assert.deepEqual([drawn.sx, drawn.sy, drawn.sw, drawn.sh], [bb.x, bb.y - bb.h, bb.w, bb.h]);
});
