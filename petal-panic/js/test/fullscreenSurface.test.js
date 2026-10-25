import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLayoutMode, setFitState, surfaceBounds, fillSurface, drawOnSurface } from '../core/layout.js';
import { vignette } from '../effects/vignette.js';
import { screenFlash } from '../effects/screenFlash.js';

for (const [name, mode, scale, ox, oy, expected] of [
  ['fit', 'fit', 2, 0, 0, { x: -0, y: -0, w: 960, h: 540 }],
  ['wide', 'fullscreen', 2, 640, 0, { x: -320, y: -0, w: 1600, h: 540 }],
  ['portrait', 'fullscreen', 1, 0, 530, { x: -0, y: -530, w: 960, h: 1600 }],
]) {
  test(`${name}: backgrounds and screen effects cover the visible surface`, () => {
    setLayoutMode(mode);
    setFitState(ox, oy, scale);
    assert.deepEqual(surfaceBounds(), expected);
    const fills = [], translations = [];
    let depth = 0;
    const ctx = {
      save() { depth++; }, restore() { depth--; },
      translate(x, y) { translations.push([x, y]); },
      fillRect(...args) { fills.push(args); },
      createRadialGradient() { return { addColorStop() {} }; },
    };
    fillSurface(ctx);
    assert.deepEqual(fills.pop(), [expected.x, expected.y, expected.w, expected.h]);
    for (const factory of [vignette, screenFlash]) {
      const effect = factory({ strength: 1 }, null, {});
      drawOnSurface(ctx, (w, h) => effect.render(ctx, { view: { w, h } }));
      assert.deepEqual(fills.pop(), [0, 0, expected.w, expected.h]);
      assert.deepEqual(translations.pop(), [expected.x, expected.y]);
      assert.equal(depth, 0);
    }
    assert.throws(() => drawOnSurface(ctx, () => { throw new Error('draw failed'); }));
    assert.equal(depth, 0, 'restore transform even if effect drawing throws');
    setLayoutMode('fit');
    setFitState(0, 0, 1);
  });
}

test('HUD anchors to full surface edges without scaling its widgets', async () => {
  const { drawHUD } = await import('../systems/hud.js');
  for (const [ox, oy] of [[320, 0], [0, 530]]) {
    setLayoutMode('fullscreen'); setFitState(ox, oy, 1);
    const rects = [], texts = [];
    const ctx = { save() {}, restore() {}, strokeRect() {},
      fillRect(...a) { rects.push(a); }, fillText(...a) { texts.push(a); } };
    drawHUD(ctx, { energy: 100, maxEnergy: 100, shield: 0,
      supermoveMeter: 0, SUPERMOVE_MAX: 100, coins: 3, lives: 2 }, null, {});
    assert.deepEqual(rects[0], [12 - ox, 12 - oy, 200, 16]);
    assert.deepEqual(texts.find(a => a[0] === '💰 3'), ['💰 3', 948 + ox, 28 - oy]);
  }
  setLayoutMode('fit'); setFitState(0, 0, 1);
});

test('Home portrait scenery retains authored size and placement', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('../ui/screens.js', import.meta.url), 'utf8');
  const fn = source.match(/function drawHomeScenery\(ctx, img, x, y, w, h\) \{[\s\S]*?\n\}/)[0];
  const calls = [];
  runInNewContext(fn + '\ndrawHomeScenery(ctx, img, -20, -15, 960, 640);', {
    surfaceBounds: () => ({ x: 0, y: -530, w: 960, h: 1600 }), VIEW_W: 960,
    img: 'stage', ctx: { drawImage(...a) { calls.push(a); } },
  });
  assert.deepEqual(calls[0], ['stage', -20, -15, 960, 640]);
});
