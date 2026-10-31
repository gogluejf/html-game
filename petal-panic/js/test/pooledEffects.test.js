import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool, Projectile, initProjectileSprites } from '../objects/projectile.js';

test('pooled outline follows live slot after motion and reuse; playback advances', async () => {
  await initProjectileSprites();
  const pool = new Pool(Projectile, 1);
  const slot = pool.items[0];
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, fillRect() {} }) }) };
  try {
    for (let generation = 0; generation < 3; generation++) {
      const p = pool.spawn(100 + generation * 50, 200, 0, true);
      assert.equal(p, slot);
      const frames = new Map(p.spriteAnimData.frames.map(f => [f.file, {
        complete: true, naturalWidth: 244, naturalHeight: 101, src: f.file,
      }]));
      p.sprite = { ...p.sprite, frames };
      assert.equal(p.spriteFrameIndex, 0);
      pool.updateAll(0.1);
      assert.equal(p.spriteFrameIndex, 1);
      p.rotation = 0.7;
      let depth = 0;
      const translations = [], rotations = [];
      const ctx = { save() { depth++; }, restore() { depth--; },
        translate(...v) { translations.push(v); }, rotate(v) { rotations.push(v); },
        scale() {}, drawImage() {}, strokeRect() {} };
      for (let i = 0; i < 100; i++) {
        p.x += 3; p.y += 2;
        p.drawSprite(ctx);
        p._outline.render(ctx);
        assert.equal(depth, 0, 'sprite + outline must balance canvas stack');
        assert.deepEqual(translations.at(-1), [p.x + p.w / 2, p.y + p.h]);
        assert.equal(rotations.at(-1), p.rotation);
      }
      p.alive = false;
    }
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
