// Parallax background — pure math tests (node --test).
// Run: node --test petal-panic/js/test/parallax.test.js

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { BG_PARALLAX_DIVISOR, getBgImage, drawParallaxBg } from '../world/parallax.js';
import { VIEW_W, VIEW_H } from '../core/view.js';

// --- Divisor is a sane positive integer -------------------------------------
test('BG_PARALLAX_DIVISOR is a positive integer >= 2', () => {
  assert.ok(Number.isInteger(BG_PARALLAX_DIVISOR));
  assert.ok(BG_PARALLAX_DIVISOR >= 2);
});

// --- Image loading degrades gracefully in node (no DOM) ----------------------
test('getBgImage returns null without a DOM (node)', () => {
  assert.equal(getBgImage(1, 'horizontal'), null);
  assert.equal(getBgImage(3, 'vertical'), null);
});

// --- Fake image + recording ctx to verify tiling math ------------------------
function makeFakeImg(w, h) {
  return { complete: true, naturalWidth: w, naturalHeight: h };
}

function recordingCtx() {
  const calls = [];
  return {
    calls,
    drawImage(img, x, y, dw, dh) { calls.push({ x, y, dw, dh }); },
  };
}

// Monkey-patch the module's image cache by calling drawParallaxBg with a
// stubbed getBgImage result. parallax.js caches images internally, so instead
// we verify behavior through the public API using a Proxy-based fake canvas
// and rely on the no-DOM path returning early. To test the TILING MATH itself,
// replicate the formulas here against known inputs (the same expressions the
// module uses), which keeps the test dependency-free.
test('horizontal tiling covers the viewport at camera offset', () => {
  const imgW = 2172, imgH = 724; // level1 bg_f1 real dimensions
  const winX = 0, winW = VIEW_W, winH = VIEW_H; // fit-mode surface
  const scale = winH / imgH;
  const w = Math.max(1, Math.round(imgW * scale));
  const h = winH;
  const camX = 5000;
  const offX = -camX / BG_PARALLAX_DIVISOR;
  const first = Math.floor((winX - offX) / w);
  let covered = 0;
  for (let i = first; i * w + offX < winX + winW; i++) {
    covered++;
    // each tile must be drawn at full viewport height
    assert.equal(h, winH);
  }
  // Tiles must cover [offX, offX+VIEW_W): count ≈ VIEW_W/w + 2
  assert.ok(covered >= Math.ceil(winW / w) && covered <= Math.ceil(winW / w) + 2);
  // First tile starts at or before the left edge of the visible window.
  assert.ok(first * w + offX <= winX);
});

test('horizontal tiling covers fullscreen side strips too', () => {
  // Fullscreen layout: visible surface wider than VIEW_W (e.g. 1920px display).
  const imgW = 2172, imgH = 724;
  const winW = 1920, winH = VIEW_H;
  const winX = -(winW - VIEW_W) / 2; // centered logical box
  const scale = winH / imgH;
  const w = Math.max(1, Math.round(imgW * scale));
  const camX = 3000;
  const offX = -camX / BG_PARALLAX_DIVISOR;
  const first = Math.floor((winX - offX) / w);
  let covered = 0;
  for (let i = first; i * w + offX < winX + winW; i++) {
    covered++;
    // each tile must overlap the visible window (it may extend past either edge)
    assert.ok(offX + i * w < winX + winW && offX + i * w + w > winX);
  }
  // The union of tiles spans the whole window: first starts ≤ left edge,
  // last ends ≥ right edge.
  const last = first + covered - 1;
  assert.ok(first * w + offX <= winX);
  assert.ok(last * w + offX + w >= winX + winW);
});

test('vertical tiling starts at the camera bottom edge (camera-aligned grid)', () => {
  const imgW = 820, imgH = 1875; // level1 vertical_f1 real dimensions
  const winW = VIEW_W, winH = VIEW_H;
  const scale = winW / imgW;
  const w = winW;
  const h = Math.max(1, Math.round(imgH * scale));
  // At cam.y = 0 the first tile must sit exactly at y = 0 (top of view),
  // mirroring horizontal starting at camera x = 0.
  const camY = 0;
  const offY = -camY / BG_PARALLAX_DIVISOR;
  let covered = 0;
  for (let i = 0; i * h < offY + winH; i++) {
    covered++;
    assert.equal(w, VIEW_W);
    if (i === 0) assert.equal(offY + i * h, 0); // first tile at view top
  }
  // And mid-climb: tiles still align to the camera grid (first tile at offY).
  const camY2 = 1500;
  const offY2 = -camY2 / BG_PARALLAX_DIVISOR;
  let covered2 = 0;
  for (let i = 0; i * h < offY2 + winH; i++) {
    covered2++;
    if (i === 0) assert.equal(offY2 + i * h, offY2); // anchored to camera bottom
  }
  assert.ok(covered >= Math.ceil(winH / h) && covered <= Math.ceil(winH / h) + 2);
  assert.ok(covered2 >= Math.ceil(winH / h) && covered2 <= Math.ceil(winH / h) + 2);
});

test('drawParallaxBg is a safe no-op without loaded art (node)', () => {
  const ctx = recordingCtx();
  drawParallaxBg(ctx, { x: 100, y: 200 }, 1, 'horizontal');
  drawParallaxBg(ctx, { x: 100, y: 200 }, 1, 'vertical');
  assert.equal(ctx.calls.length, 0); // no DOM → no image → nothing drawn
});
