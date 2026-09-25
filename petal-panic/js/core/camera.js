// Petal Panic — Camera (design §0, §13, structure.md §3/§4, checkpoints.md §2).
//
// The camera is clamped to the ACTIVE ZONE's world bounds (task 2.3) so it can
// never reveal the previous or next zone. Each sealed zone owns its own world
// (structure.md §2); the camera's clamp range therefore comes from the zone
// model, not from the legacy corridor length.
//
// Per-orientation rules (structure.md §3 horizontal, §4 vertical):
//   - horizontal: scrolls horizontally; the hero walks left→right. The camera
//     follows the hero both ways INSIDE the zone but is clamped so the left
//     edge never opens onto the previous zone and the right edge never opens
//     onto the next. (Backward-scroll within an area is allowed.)
//   - vertical: NO horizontal scrolling (fixed width). The camera follows
//     upward progress only and, once raised, never follows back down
//     (structure.md §4).
//   - boss: the camera is completely frozen (min === max). The boss arena
//     locks both sides (structure.md §3, checkpoints.md §2).
//
// Render integration: render.js applies ctx.translate(-camera.x, -camera.y)
// before drawing world entities so the world scrolls under a fixed viewport.

import { VIEW_W, VIEW_H } from './view.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.w = VIEW_W;
    this.h = VIEW_H;

    // Active-zone clamp range (set by setZoneBounds()). Defaults to a
    // single-screen world so the camera is well-behaved before the first
    // zone is bound.
    this.minX = 0;
    this.maxX = 0;
    this.minY = 0;
    this.maxY = 0;

    // "Raised" high-water mark for vertical climbs: the smallest (highest on
    // screen) camera.y reached. Once raised the camera never follows back
    // down (structure.md §4).
    this.minYReached = 0;

    // Boss-arena lock (task 2.3): when true the camera is frozen and ignores
    // hero-following entirely.
    this.locked = false;
    this.lockX = 0;
    this.lockY = 0;
  }

  /**
   * Clamp the camera to a zone's world bounds (task 2.3).
   *
   * The camera is positioned so it can never draw outside the zone:
   *   - horizontal: minX = bounds.x, maxX = bounds.x + bounds.w - VIEW_W.
   *   - vertical:   minX === maxX = bounds.x (no horizontal scroll);
   *                 minY = bounds.y, maxY = bounds.y + bounds.h - VIEW_H.
   *   - boss:       completely frozen at the arena center (min === max on both
   *                 axes).
   *
   * Re-binding a new zone re-clamps the camera into the new range and resets
   * the vertical "raised" high-water mark so a fresh climb starts at its
   * bottom.
   *
   * @param {object} zone a zone from buildLevelZones() exposing
   *   `orientation` ('horizontal'|'vertical'|'boss') and
   *   `bounds` ({x, y, w, h}).
   */
  setZoneBounds(zone) {
    const b = zone.bounds;
    this.minX = b.x;
    this.maxX = b.x + b.w - this.w;
    this.minY = b.y;
    this.maxY = b.y + b.h - this.h;

    if (zone.orientation === 'vertical') {
      // No horizontal scrolling (structure.md §4): fixed width.
      this.minX = b.x;
      this.maxX = b.x;
    } else if (zone.orientation === 'boss') {
      // Boss zone RUN phase: allow horizontal scrolling across the full zone
      // width so the hero can walk from the left entry to the boss checkpoint
      // at the far right. When the checkpoint is crossed, enterBossRoom()
      // (update.js) freezes the camera on the battle room (minX === maxX = 0).
      this.minX = b.x;
      this.maxX = b.x + b.w - this.w;
    }

    // Re-clamp into the new range; a boss lock takes precedence (frozen).
    if (this.locked) {
      this.x = this.lockX;
      this.y = this.lockY;
      return;
    }
    this.x = clamp(this.x, this.minX, this.maxX);
    this.y = clamp(this.y, this.minY, this.maxY);
    // Reset the vertical high-water mark to the current (bottom) position so a
    // fresh climb does not inherit the previous zone's ascent.
    this.minYReached = this.y;
  }

  /**
   * Follow the hero within the active zone.
   *
   * Horizontal: dead-zone follow on x (scroll both ways inside the zone), y
   * stays at the zone's top (single-screen height).
   * Vertical: x is fixed (no horizontal scroll); y follows upward progress
   * only and never follows back down (structure.md §4).
   * Boss / locked: no-op (frozen).
   *
   * @param {object} hero entity exposing x, y, w, h
   */
  update(hero) {
    if (this.locked) return;

    if (this.minX === this.maxX && this.minY === this.maxY) return; // frozen (boss)

    const heroCX = hero.x + hero.w / 2;
    const heroCY = hero.y + hero.h / 2;

    // --- Horizontal follow (dead-zone to prevent jitter). -------------------
    if (this.maxX > this.minX) {
      const triggerRight = this.x + this.w * 0.65;
      const triggerLeft = this.x + this.w * 0.35;
      let targetX = this.x;
      if (heroCX > triggerRight) targetX = heroCX - this.w * 0.65;
      else if (heroCX < triggerLeft) targetX = heroCX - this.w * 0.35;
      this.x = clamp(targetX, this.minX, this.maxX);
    }

    // --- Vertical follow (upward only, never back down). --------------------
    if (this.maxY > this.minY) {
      const triggerBottom = this.y + this.h * 0.65; // hero above this → raise cam
      let targetY = this.y;
      if (heroCY < triggerBottom) targetY = heroCY - this.h * 0.65;
      // Never follow back down: clamp the target to the high-water mark.
      targetY = Math.min(targetY, this.minYReached);
      this.y = clamp(targetY, this.minY, this.maxY);
      // Track the highest (smallest-y) position reached.
      if (this.y < this.minYReached) this.minYReached = this.y;
    }
  }

  /**
   * Lock the camera to a fixed position (boss arena). Freezes the camera at
   * the given world coordinates; hero-following is suspended until unlock().
   *
   * @param {number} x world x to freeze at (camera left edge)
   * @param {number} [y=0] world y to freeze at (camera top edge)
   */
  lockTo(x, y = 0) {
    this.locked = true;
    this.lockX = x;
    this.lockY = y;
    this.x = x;
    this.y = y;
  }

  /** Release the lock; resume hero-following on the next update(). */
  unlock() {
    this.locked = false;
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(v, hi));
}
