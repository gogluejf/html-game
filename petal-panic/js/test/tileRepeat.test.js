// tile=true repeat behavior in Entity.drawSprite (sprite-engine plan M7 / task 7.1).
// A tiled entity repeats its frame across the full entity width at the uniform
// collision-box scale — no stretching, coverage from the left edge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Entity } from '../core/entity.js';
import { parseSheet, uniformScale } from '../core/spriteData.js';

/** Minimal canvas ctx recorder: captures drawImage calls as {sx,sy,sw,sh,dx,dy,dw,dh}. */
function makeCtx() {
  const calls = [];
  return {
    calls,
    save() {}, restore() {},
    translate() {}, rotate() {},
    scale() {},
    drawImage(img, ...args) { calls.push({ img, args }); },
  };
}

/** A fake "image": drawImage only needs it opaquely. */
const FAKE_IMG = { complete: true, naturalWidth: 2171, naturalHeight: 287 };

/** fg-like sheet: one frame 2171x287, collision box 2163x175 (editor-authored). */
function fgSheet() {
  return {
    entities: [{
      name: 'level1', anim: 'fg',
      frames: [{ file: 'fg_f1.png', bbox: [0, 0, 2171, 287] }],
      collision: { x: 0, y: -181, w: 2163, h: 175 },
    }],
  };
}

test('tile=true: scale comes from the collision box, not the raw image height', () => {
  const data = parseSheet(fgSheet());
  const s = uniformScale(data.anims.fg, 48); // target 1 Y-unit
  assert.ok(Math.abs(s - 48 / 175) < 1e-9);
});

test('tile=true: a wide floor entity repeats the frame to cover its full width', () => {
  const data = parseSheet(fgSheet());
  const e = new Entity({ x: 0, y: 432, w: 5000, h: 48 }); // ~65 units wide floor
  e.sprite = { anchor: 'bottom-center', tile: true, anims: data.anims, frames: new Map([['fg_f1.png', FAKE_IMG]]) };
  e.setAnim('fg');

  const ctx = makeCtx();
  assert.equal(e.drawSprite(ctx), true);

  const s = e._spriteScale;
  const fw = 2171 * s; // scaled frame width ≈ 596px
  // Coverage must span the whole entity: first tile starts at or before the
  // left edge, last tile ends at or beyond the right edge.
  let minX = Infinity, maxX = -Infinity;
  for (const c of ctx.calls) {
    const [dx, dy, dw, dh] = c.args;
    assert.equal(dw, 2171); // drawn in source-bbox units (ctx is pre-scaled by s)
    assert.equal(dh, 287);
    minX = Math.min(minX, dx * s + e.x + e.w / 2);
    maxX = Math.max(maxX, (dx + 2171) * s + e.x + e.w / 2);
  }
  assert.ok(minX <= e.x + 1, `coverage starts at left edge (got ${minX})`);
  assert.ok(maxX >= e.x + e.w - 1, `coverage reaches right edge (got ${maxX})`);
  // Repeat count ≈ width / frame width (±1 for edge overhang).
  const expected = Math.ceil(5000 / fw);
  assert.ok(ctx.calls.length >= expected - 1 && ctx.calls.length <= expected + 1,
    `repeat count ${ctx.calls.length} ≈ ${expected}`);
});

test('tile=false (default): exactly one frame drawn, bottom-centered', () => {
  const data = parseSheet(fgSheet());
  const e = new Entity({ x: 0, y: 432, w: 48, h: 48 });
  e.sprite = { anchor: 'bottom-center', anims: data.anims, frames: new Map([['fg_f1.png', FAKE_IMG]]) };
  e.setAnim('fg');
  const ctx = makeCtx();
  assert.equal(e.drawSprite(ctx), true);
  assert.equal(ctx.calls.length, 1);
});
