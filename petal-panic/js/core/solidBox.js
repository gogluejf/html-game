// Solid wrapper entity for static terrain (blocks + one-way platforms).
// Layer-only: one-way platforms use the PLATFORM layer (no SOLID rules — they
// only land the hero from above via resolve()'s oneWay branch, never block
// sides/below or chip projectiles). Solid blocks keep SOLID.
// Barrels do NOT use this class — they are GameObj entities with their own
// worldBox() and participate in collision via barrelSolidBoxes.
import { Entity } from './entity.js';
import { LAYER } from '../consts.js';

export class SolidBox extends Entity {
  constructor(box) {
    const layer = box.oneWay ? LAYER.PLATFORM : LAYER.SOLID;
    super({ x: box.x, y: box.y, w: box.w, h: box.h, gravity: 0, layer, debugColor: '#ff9f43' });
  }
}
