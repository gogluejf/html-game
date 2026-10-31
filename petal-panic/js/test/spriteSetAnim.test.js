// entity.sprite contract + setAnim() — node --test.
// Run: node --test petal-panic/js/test/spriteSetAnim.test.js
//
// SIZE MODEL:
//   Sheet-owned (no baseW): w derived from sheet collisionBox × scale after setAnim().
//   Constructor-owned (baseW set): w fixed at baseW, h = targetH × 48.
//   h is ALWAYS targetH × 48 regardless of owner.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Entity } from '../core/entity.js';
import { parseSheet, uniformScale } from '../core/spriteData.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const sheet = (p) => JSON.parse(readFileSync(join(HERE, '..', '..', 'assets', p), 'utf8'));

/** Sheet-owned entity: no baseW, width comes from the sheet after setAnim(). */
function makeSpriteEntity(targetH, anims) {
  const e = new Entity({ x: 100, y: 200, targetH });
  e.sprite = { anchor: 'bottom-center', targetH, anims, frames: new Map() };
  return e;
}

/** Constructor-owned entity: baseW fixes the width, h = targetH × 48. */
function makeFixedEntity(x, y, baseW, targetH, anims) {
  const e = new Entity({ x, y, baseW, targetH });
  if (anims) e.sprite = { anchor: 'bottom-center', targetH, anims, frames: new Map() };
  return e;
}

test('setAnim computes uniform scale from bbox height onto targetH', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const e = makeSpriteEntity(1.0, data.anims);
  e.setAnim('wooden');
  // Art collision box is 365px tall → scale = 48/365.
  const refH = data.anims.wooden.collisionBox.h;
  assert.ok(Math.abs(e._spriteScale - 48 / refH) < 1e-9);
  assert.equal(e.spriteAnimData, data.anims.wooden);
});

test('sheet-owned: w/h derive from sheet box × §4 scale after setAnim()', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const cb = data.anims.wooden.collisionBox;
  const e = makeSpriteEntity(1.0, data.anims);
  e.setAnim('wooden');
  const s = 48 / cb.h;
  assert.ok(Math.abs(e.h - 48) < 1e-9, `h = ${e.h} (want 48)`);
  assert.ok(Math.abs(e.w - cb.w * s) < 1e-9, `w = ${e.w} (want ${cb.w * s})`);
});

test('constructor-owned (baseW): w/h fixed regardless of setAnim()', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const e = makeFixedEntity(0, 0, 96, 3.0, data.anims);
  e.setAnim('wooden');
  assert.equal(e.w, 96, 'width fixed at baseW');
  assert.equal(e.h, 144, 'height = targetH × 48');
});

test('setAnim without a collision box throws (§4 requires a box for scale)', () => {
  const data = parseSheet({ entities: [{ name: 'x', anim: 'a', frames: [{ file: 'f.png' }] }] });
  const e = makeSpriteEntity(1.0, data.anims);
  assert.throws(() => e.setAnim('a'), /no collision box/);
  // Before setAnim, w falls back to targetH × 48 (square).
  assert.equal(e.w, 48);
  assert.equal(e.h, 48);
});

test('setAnim never MOVES the entity — position fixed, size derives (§3)', () => {
  const data = parseSheet(sheet('objects/checkpoint/level_sheet.json'));
  const e = makeSpriteEntity(1.0, data.anims);
  const before = { x: e.x, y: e.y };
  e.setAnim('level');
  // Position (the physical anchor) is untouched...
  assert.deepEqual({ x: e.x, y: e.y }, before);
  // ...size now comes from the sheet box × §4 scale:
  const cb = data.anims.level.collisionBox;
  const s = 48 / cb.h;
  assert.ok(Math.abs(e.h - 48) < 1e-9, 'h = target height exactly');
  assert.ok(Math.abs(e.w - cb.w * s) < 1e-9, 'w keeps the sheet ratio');
});

test('unknown anim throws with a clear message', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const e = makeSpriteEntity(1.0, data.anims);
  assert.throws(() => e.setAnim('nope'), /unknown anim "nope"/);
});

test('entity without sprite data keeps legacy draw path (no crash)', () => {
  const e = new Entity({ x: 0, y: 0, baseW: 10, targetH: 10 / 48 });
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
  const e = makeSpriteEntity(1.0, data.anims);
  e.setAnim('wooden');
  const ctx = { save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, drawImage() {} };
  assert.equal(e.drawSprite(ctx), false); // empty frame map → legacy fallback
});

test('drawSprite renders the frame via per-frame tuning (offset/scale) when present', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  const e = makeSpriteEntity(1.0, data.anims);
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
  // Check world coordinates against the authored top-left delta.
  const f = data.anims.wooden.frames[0];
  const cb = data.anims.wooden.collisionBox;
  const s = e._spriteScale;
  const w = 305 * f.scale.sx, h = 386 * f.scale.sy;
  const worldX = e.x + e.w / 2 + drawn.dx * s;
  const worldY = e.y + e.h + drawn.dy * s;
  assert.ok(Math.abs(worldX - (e.x + (f.offset.x - cb.x) * s)) < 1e-9);
  assert.ok(Math.abs(worldY - (e.y + (f.offset.y - cb.y) * s)) < 1e-9);
  assert.deepEqual([drawn.dw, drawn.dh], [w, h]);
});

// Synthetic fixtures avoid depending on mutable editor tuning.
test('top-left placement: final canvas coordinates, one scale, no Y flip', () => {
  const cases = [
    { box: {x:-40,y:-40,w:400,h:400}, off:{x:-60,y:-60}, iw:800, ih:800, target:96, expected:[95.2,195.2,192,192] },
    { box: {x:0,y:-181,w:2163,h:175}, off:{x:0,y:-287}, iw:2171, ih:287, target:175, expected:[100,94,2171,287] },
    { box: {x:-152.5,y:-386,w:305,h:386}, off:{x:-152.5,y:-386}, iw:305, ih:386, target:48, expected:[100,200,305*48/386,48] },
  ];
  for (const c of cases) {
    // Constructor-owned: baseW=96, targetH from c.target.
    const e = new Entity({x:100,y:200,baseW:96,targetH:c.target/48});
    e.sprite = {anims:{test:{collisionBox:c.box,frames:[{file:'test.png',offset:c.off,scale:{sx:1,sy:1}}]}},frames:new Map([['test.png',{complete:true,naturalWidth:c.iw,naturalHeight:c.ih}]])};
    e.setAnim('test');
    let tx=0,ty=0,sx=1,sy=1,actual;
    const ctx={save(){},restore(){},translate(x,y){tx+=x*sx;ty+=y*sy;},scale(x,y){sx*=x;sy*=y;},rotate(a){assert.equal(a,0);},drawImage(im,a,b,cw,ch,x,y,w,h){actual=[tx+x*sx,ty+y*sy,w*sx,h*sy];}};
    e.drawSprite(ctx);
    actual.forEach((v,i)=>assert.ok(Math.abs(v-c.expected[i])<1e-9, `${v} != ${c.expected[i]}`));
    const f=e.spriteFrame();
    assert.ok(Math.abs(f.anchorX+f.dx*f.scale-c.expected[0])<1e-9);
    assert.ok(Math.abs(f.anchorY+f.dy*f.scale-c.expected[1])<1e-9);
  }
});

// --- T3.2: SpritePlayer wiring -------------------------------------------------

test('setAnim builds a player for playback anims; frameIndex advances via update()', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json')); // mode loop, fps 12
  const e = makeSpriteEntity(1.0, data.anims);
  e.setAnim('wooden');
  assert.ok(e._player, 'loop anim must get a SpritePlayer');
  const n = data.anims.wooden.frames.length;
  const fps = data.anims.wooden.fps;
  const seen = new Set();
  // Run one full traversal + margin at fixed dt; record every index visited.
  const steps = Math.ceil((n / fps) * 60) + 30;
  for (let i = 0; i < steps; i++) { e.update(1 / 60); seen.add(e.spriteFrameIndex); }
  for (let f = 0; f < n; f++) assert.ok(seen.has(f), `frame ${f} was visited`);
});

test('mode none → no player; _tileFrame still wins (terrain contract)', () => {
  const data = parseSheet(sheet('objects/barrel/wooden_sheet.json'));
  data.anims.wooden.mode = 'none'; // simulate a pool declaration
  const e = makeSpriteEntity(1.0, data.anims);
  e.setAnim('wooden');
  assert.equal(e._player, null, 'pool anims must not build a player');
  e._tileFrame = 1;
  e.update(1); // a whole second of ticks must not move a pool frame
  assert.equal(e.spriteFrameIndex, 1 % data.anims.wooden.frames.length);
});

test('once anim: animDone flips after terminal frame; resetAnim rewinds', () => {
  const data = parseSheet({
    entities: [{
      name: 'boom', anim: 'boom', fps: 10, mode: 'once',
      frames: [0, 1, 2].map((i) => ({ file: `b${i}.png` })),
      collision: [0, 0, 10, 10],
    }],
  });
  const e = makeSpriteEntity(1.0, data.anims);
  e.setAnim('boom');
  assert.equal(e.animDone, false);
  for (let i = 0; i < 29; i++) e.update(1 / 60); // 0.483s < 0.3s? no — 3×0.1=0.3s
  assert.equal(e.animDone, true, 'once anim completes after terminal duration');
  assert.equal(e.spriteFrameIndex, 2, 'holds terminal frame');
  e.resetAnim();
  assert.equal(e.animDone, false);
  assert.equal(e.spriteFrameIndex, 0);
});

test('setProgress drives relative-timing anims', () => {
  const data = parseSheet({
    entities: [{
      name: 'slide', anim: 'slide', fps: 10, mode: 'loop', timing: 'relative',
      frames: [0, 1, 2, 3].map((i) => ({ file: `s${i}.png` })),
      collision: [0, 0, 10, 10],
    }],
  });
  const e = makeSpriteEntity(1.0, data.anims);
  e.setAnim('slide');
  e.setProgress(0);
  assert.equal(e.spriteFrameIndex, 0);
  e.setProgress(0.5);
  assert.equal(e.spriteFrameIndex, 1, 'p=0.5 → slot (L-1)·p = 1.5 → floor 1');
  e.setProgress(1);
  assert.equal(e.spriteFrameIndex, 3);
  // clock ticks must NOT drive a relative anim (it stays where progress put it)
  e.update(1);
  assert.equal(e.spriteFrameIndex, 3);
});
