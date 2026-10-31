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
  e.sprite = { anchor: 'bottom-center', targetH: 1.0, anims, frames: new Map() };
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

test('setAnim derives w/h from the sheet box × §4 scale (boxFromSheet default)', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  // Box 305×386, targetH 1.0 → s = 48/386; h lands exactly on 48, w keeps ratio.
  const e = makeSpriteEntity(999, 999, data.anims);
  e.setAnim('wooden');
  const s = 48 / 386;
  assert.ok(Math.abs(e.h - 386 * s) < 1e-9, `h = ${e.h} (want 48)`);
  assert.ok(Math.abs(e.w - 305 * s) < 1e-9, `w = ${e.w} (want ${305 * s})`);
});

test('boxFromSheet:false keeps macro-owned sizes (terrain contract)', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const e = new Entity({ x: 0, y: 0, w: 96, h: 144 });
  e.sprite = { anchor: 'bottom-center', anims: data.anims, frames: new Map(), boxFromSheet: false };
  e.setAnim('wooden');
  assert.equal(e.w, 96, 'width untouched');
  assert.equal(e.h, 144, 'height untouched');
});

test('setAnim without a collision box leaves w/h alone (§4 requires a box for scale)', () => {
  const data = parseSheet({ entities: [{ name: 'x', anim: 'a', frames: [{ file: 'f.png' }] }] });
  const e = makeSpriteEntity(32, 48, data.anims);
  assert.throws(() => e.setAnim('a'), /no collision box/);
  assert.equal(e.w, 32);
  assert.equal(e.h, 48);
});

test('setAnim never MOVES the entity — position fixed, size derives (§3)', () => {
  const data = parseSheet(sheet('objects/checkpoint/level_sheet.json'));
  const e = makeSpriteEntity(999, 999, data.anims);
  const before = { x: e.x, y: e.y };
  e.setAnim('level');
  // Position (the physical anchor) is untouched...
  assert.deepEqual({ x: e.x, y: e.y }, before);
  // ...size now comes from the sheet box × §4 scale (box 332×525, target 48):
  const s = 48 / 525;
  assert.ok(Math.abs(e.h - 525 * s) < 1e-9, 'h = target height exactly');
  assert.ok(Math.abs(e.w - 332 * s) < 1e-9, 'w keeps the sheet ratio');
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

test('drawSprite renders the frame via per-frame tuning (offset/scale) when present', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const e = makeSpriteEntity(32, 48, data.anims);
  e.setAnim('wooden');
  const fakeImg = { complete: true, naturalWidth: 305, naturalHeight: 386 };
  e.sprite.frames.set(data.anims.wooden.frames[0].file, fakeImg);

  let drawn = null;
  const ctx = {
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) { drawn = { img, sx, sy, sw, sh, dx, dy, dw, dh }; },
  };
  assert.equal(e.drawSprite(ctx), true);
  assert.equal(drawn.img, fakeImg);
  // Full image drawn (no sheet crop at runtime)...
  assert.deepEqual([drawn.sx, drawn.sy, drawn.sw, drawn.sh], [0, 0, 305, 386]);
  // ...and placed by the DELTA RULE: spriteCenter = anchor +
  // (offset − boxBottomCenter) × s. Barrel box (-152.5,-386,305,386) has
  // bottom-center at (0,0); offset (0,-193) → delta (0,-193) × s(48/386)
  // → center at (0, -23.97); size 305×386 (scale 1).
  const f = data.anims.wooden.frames[0];
  const cb = data.anims.wooden.collisionBox;
  const s = e._spriteScale;
  const w = 305 * f.scale.sx, h = 386 * f.scale.sy;
  const exDx = (f.offset.x - (cb.x + cb.w / 2)) * s - w / 2;
  const exDy = (f.offset.y - (cb.y + cb.h)) * s - h / 2;
  assert.ok(Math.abs(drawn.dx - exDx) < 1e-9, `dx ${drawn.dx} vs ${exDx}`);
  assert.ok(Math.abs(drawn.dy - exDy) < 1e-9, `dy ${drawn.dy} vs ${exDy}`);
  assert.deepEqual([drawn.dw, drawn.dh], [w, h]);
});
