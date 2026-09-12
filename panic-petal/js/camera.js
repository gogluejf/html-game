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
   * Follow the hero horizontally with a dead-zone (buffer) to prevent jittery
   * camera movement. The camera only scrolls when the hero crosses the trigger
   * line: 60% from left (moving right) or 40% from left (moving left).
   * No-op while locked (boss arena).
   * @param {object} hero entity exposing x and w
   */
  update(hero) {
    if (this.locked) return;
    const heroCenter = hero.x + hero.w / 2;
    // Dead-zone boundaries in screen space.
    const triggerRight = this.x + this.w * 0.65;  // hero must pass 60% to scroll right
    const triggerLeft = this.x + this.w * 0.35;   // hero must pass 40% to scroll left

    let targetX = this.x; // default: stay put (no scroll)

    if (heroCenter > triggerRight) {
      // Hero crossed the right trigger → scroll so hero sits at 60%.
      targetX = heroCenter - this.w * 0.65;
    } else if (heroCenter < triggerLeft) {
      // Hero crossed the left trigger → scroll so hero sits at 40%.
      targetX = heroCenter - this.w * 0.35;
    }

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
