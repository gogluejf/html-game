// spriteBurst debug-box placement — pins the pure-math stamp (update())
// against the image-path formula it mirrors. Run: node js/test/spriteBurstBox.test.js
//
// The box must land where the SHEET says: for 'bottom-center' the box bottom
// sits ON the anchor y (feet planted on the surface), center-x on anchor x.
// The frame offset cancels in the transform (it shifts draw origin and sample
// point equally), so the box is frame-independent — this test asserts that.

import { strict as assert } from 'node:assert';
import { spriteBurst } from '../effects/spriteBurst.js';
import { Debug } from '../debug/debug.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// Real dust_impact geometry (assets/fx/dust/impact_sheet.json).
const cb = { x: -189, y: -200, w: 375, h: 175 };
const offsets = [
  { x: -100, y: -43 }, { x: -123.5, y: -57 },
  { x: -137.5, y: -84 }, { x: -163, y: -116 },
];
const anim = {
  fps: 14,
  collisionBox: cb,
  frames: offsets.map((offset, i) => ({ file: `f${i + 1}.png`, offset })),
};
const X = 500, Y = 400, SIZE = 48;
const scale = SIZE / cb.h;

function makeInst() {
  const inst = spriteBurst({ x: X, y: Y, size: SIZE, anim, anchor: 'bottom-center', fallback: () => {} });
  Debug.enabled = true;
  inst.update(0); // stamp at t=0 (frame 0)
  return inst;
}

console.log('spriteBurst debug box');

ok('bottom-center: box bottom sits exactly on anchor y (feet)', () => {
  const b = makeInst()._debugBox;
  assert.ok(b, 'box stamped');
  assert.ok(Math.abs((b.y + b.h) - Y) < 1e-6, `bottom=${b.y + b.h} want ${Y}`);
});

ok('bottom-center: box center-x sits exactly on anchor x', () => {
  const b = makeInst()._debugBox;
  assert.ok(Math.abs((b.x + b.w / 2) - X) < 1e-6, `cx=${b.x + b.w / 2} want ${X}`);
});

ok('box size = collisionBox × scale', () => {
  const b = makeInst()._debugBox;
  assert.ok(Math.abs(b.w - cb.w * scale) < 1e-6);
  assert.ok(Math.abs(b.h - cb.h * scale) < 1e-6);
});

ok('box matches the in-draw formula (dx + (cb.x - ox)*scale) per frame', () => {
  const inst = makeInst();
  for (let f = 0; f < offsets.length; f++) {
    // Step to frame f: each frame lasts 1/fps.
    inst.update(1 / anim.fps);
    const b = inst._debugBox;
    const { x: ox, y: oy } = offsets[f];
    // Image path: dx = x - (ax - ox)*s ; box.x = dx + (cb.x - ox)*s
    const ax = cb.x + cb.w / 2, ay = cb.y + cb.h;
    const s = scale;
    const dx = X - (ax - ox) * s;
    const dy = Y - (ay - oy) * s;
    const imgBoxX = dx + (cb.x - ox) * s;
    const imgBoxY = dy + (cb.y - oy) * s;
    assert.ok(Math.abs(b.x - imgBoxX) < 1e-6, `f${f + 1} x: ${b.x} vs ${imgBoxX}`);
    assert.ok(Math.abs(b.y - imgBoxY) < 1e-6, `f${f + 1} y: ${b.y} vs ${imgBoxY}`);
  }
});

ok('box is frame-independent (offset cancels) — same rect every frame', () => {
  const inst = makeInst();
  const first = { ...inst._debugBox };
  for (let f = 1; f < offsets.length; f++) {
    inst.update(1 / anim.fps);
    const b = inst._debugBox;
    assert.ok(Math.abs(b.x - first.x) < 1e-6 && Math.abs(b.y - first.y) < 1e-6,
      `f${f + 1} drifted: (${b.x},${b.y}) vs (${first.x},${first.y})`);
  }
});

ok('center anchor: box centered on (x,y)', () => {
  const inst = spriteBurst({ x: X, y: Y, size: SIZE, anim, anchor: 'center', fallback: () => {} });
  Debug.enabled = true;
  inst.update(0);
  const b = inst._debugBox;
  assert.ok(Math.abs((b.x + b.w / 2) - X) < 1e-6);
  assert.ok(Math.abs((b.y + b.h / 2) - Y) < 1e-6);
});

ok('no box when Debug disabled', () => {
  const inst = spriteBurst({ x: X, y: Y, size: SIZE, anim, fallback: () => {} });
  Debug.enabled = false;
  inst.update(0);
  assert.equal(inst._debugBox, null);
  Debug.enabled = true;
});

console.log(`\n${passed} assertions passed.`);
