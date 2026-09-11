// Petal Panic — Camera (design §0, §13).
//
// Horizontal follow-cam in logical 960x540 space. y stays at 0 for v1
// (horizontal scroll only). The camera tracks the hero's horizontal center
// with a facing look-ahead offset, clamped to [0, levelLength - VIEW_W].
// During a boss fight the camera locks to the arena bounds via lockTo().
//
// Render integration: render.js applies ctx.translate(-camera.x, -camera.y)
// before drawing world entities so the world scrolls under a fixed viewport.

import { VIEW_W, VIEW_H } from './view.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;                 // always 0 in v1 (no vertical scroll)
    this.w = VIEW_W;
    this.h = VIEW_H;
    this.levelLength = 8000;    // default; set by the level loader
    this.locked = false;        // true while a boss holds the arena
    this.lockX = 0;             // locked arena left edge
    this.lockW = 0;             // locked arena width
  }

  /**
   * Follow the hero horizontally with a facing look-ahead.
   * No-op while locked (boss arena). Direct follow is fine for v1.
   * @param {object} hero entity exposing x and facing (-1|1)
   */
  update(hero) {
    if (this.locked) return;
    const targetX = hero.x - this.w / 2 + hero.facing * 80;
    this.x = Math.max(0, Math.min(targetX, this.levelLength - this.w));
  }

  /**
   * Lock the camera to a boss arena.
   * @param {number} x arena left edge (world coords)
   * @param {number} w arena width (world coords)
   */
  lockTo(x, w) {
    this.locked = true;
    this.lockX = x;
    this.lockW = w;
    this.x = Math.max(0, Math.min(x, this.levelLength - this.w));
  }

  /** Release the boss-arena lock; resume hero-following on next update(). */
  unlock() {
    this.locked = false;
  }
}
