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

    // "Raised" high-water mark for ratchet zones (vertical climbs): the
    // smallest (highest on screen) camera.y reached. Once raised the camera
    // never follows back down (REVISION-zones-as-data §2; zone.ratchet).
    this.minYReached = 0;

    // Ratchet flag for the active zone (set by setZoneBounds()). When true,
    // vertical follow is upward-only — replaces the old orientation branch.
    this.ratchet = false;

    // Boss-arena lock (task 2.3): when true the camera is frozen and ignores
    // hero-following entirely.
    this.locked = false;
    this.lockX = 0;
    this.lockY = 0;
  }

  /**
   * Clamp the camera to the active room of a zone (REVISION-zones-as-data §2).
   *
   * The camera is positioned so it can never draw outside the ACTIVE ROOM:
   *   minX = box.x, maxX = box.x + box.w − VIEW_W (same for y).
   *
   * No orientation branches remain: a room whose width equals the viewport
   * yields minX === maxX (no horizontal scroll) and a one-screen-tall room
   * yields minY === maxY (no vertical scroll) — both fall out of the clamp
   * math automatically. The boss RUN phase binds the hall room (scrolls
   * across the full approach); enterBossRoom() re-binds the arena room
   * (one screen → frozen on both axes), replacing the old lockTo() path in
   * PR 5.
   *
   * Re-binding a new zone/room re-clamps the camera into the new range and
   * resets the ratchet high-water mark so a fresh climb starts at its bottom.
   *
   * @param {object} zone a zone from buildLevelZones() exposing `rooms`,
   *   `activeRoom` and `ratchet`.
   */
  setZoneBounds(zone) {
    const room = zone.rooms.find((r) => r.id === zone.activeRoom) ?? zone.rooms[0];
    this.minX = room.x;
    this.maxX = room.x + room.w - this.w;
    this.minY = room.y;
    this.maxY = room.y + room.h - this.h;
    // Vertical rooms are one screen wide by design (13 grid columns = 936px,
    // a 24px non-authorable margin inside the 960px view — macros.js). Pin x
    // to the room's left edge so the camera never drifts into that margin.
    if (room.w <= this.w) this.maxX = this.minX;
    this.ratchet = !!zone.ratchet;

    // Re-clamp into the new range; a boss lock takes precedence (frozen).
    if (this.locked) {
      this.x = this.lockX;
      this.y = this.lockY;
      return;
    }
    this.x = clamp(this.x, this.minX, this.maxX);
    this.y = clamp(this.y, this.minY, this.maxY);
    // Reset the high-water mark to the current position so a fresh climb does
    // not inherit the previous zone's ascent.
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

    // --- Vertical follow (upward only on ratchet zones). --------------------
    if (this.maxY > this.minY) {
      const triggerBottom = this.y + this.h * 0.65; // hero above this → raise cam
      let targetY = this.y;
      if (heroCY < triggerBottom) targetY = heroCY - this.h * 0.65;
      if (this.ratchet) {
        // Never follow back down: clamp the target to the high-water mark.
        targetY = Math.min(targetY, this.minYReached);
      }
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
