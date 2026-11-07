import assert from 'node:assert/strict';
import { Projectile, initProjectileSprites } from '../../objects/projectile.js';
import { setGraphicMode, GRAPHIC_MODE } from '../../core/renderMode.js';

await initProjectileSprites();
const bottle = new Projectile(0, 0, 0, true, 'molotov');
assert.equal(bottle._spriteAnim, 'throw');
assert.equal(bottle.spriteAnimData.frames.length, 16);
assert.ok(bottle._player, 'molotov must have an animation player');
assert.ok(!bottle._outline, 'molotov must not have a white outline');
const first = bottle.spriteFrameIndex;
bottle.update(0.15);
assert.notEqual(bottle.spriteFrameIndex, first, 'bottle animation advances');
assert.ok(!bottle._rockTumble, 'sheet must not receive procedural tumble');
assert.equal(bottle._primitiveRotation, 0.6);
const sheetRotation = bottle.rotation;
const rotations = [];
const ctx = new Proxy({}, { get: (_, key) => key === 'rotate'
  ? angle => rotations.push(angle) : () => {} });
setGraphicMode(GRAPHIC_MODE.PRIMITIVE);
bottle.draw(ctx);
assert.equal(rotations[0], bottle._primitiveRotation, 'primitive bottle spins');
assert.equal(bottle.rotation, sheetRotation, 'drawing fallback preserves sheet orientation');
let rendered = false;
bottle.drawSprite = () => { rendered = true; assert.equal(bottle.rotation, sheetRotation); return true; };
setGraphicMode(GRAPHIC_MODE.HIGH);
bottle.draw(ctx);
assert.ok(rendered, 'high graphics selects sheet');
console.log('PASS: molotov animation, no outline, primitive-only spin, mode switching');
