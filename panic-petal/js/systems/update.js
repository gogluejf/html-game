// Petal Panic — update system (fixed 60Hz physics step).
// Currently hosts the Task 1.2 integration test: an Entity falling under
// gravity, bouncing off the floor, and resetting when it comes to rest.
// Later systems (player, enemies, camera) will be composed here.

import { VIEW_W, VIEW_H } from '../view.js';
import { Entity } from '../entity.js';

const FLOOR_Y = VIEW_H - 40;   // bounce surface for the test entity
const BOUNCE = 0.65;           // restitution on floor hit
// Impact speed below which the entity is considered "at rest" (rebound apex < 2px).
const REST_VY = Math.sqrt(2 * 1500 * 2); // ≈ 77 px/s

// Test entity: a 48x48 box dropped from the top-center. It exercises the full
// Entity pipeline — gravity integration, terminal-velocity clamp, worldBox(),
// facing/syncMirror, and draw().
const testEntity = new Entity({
  x: VIEW_W / 2 - 24,
  y: 40,
  w: 48,
  h: 48,
  vx: 120,                    // some horizontal drift so mirrorX is exercised
  vy: 0,
  gravity: 1,
  facing: 1,
  layer: 0,
  debugColor: '#7ec8ff',
});

export function update(dt) {
  const e = testEntity;

  e.update(dt);               // base physics: gravity + velocity integration

  // Floor bounce via worldBox() (symmetric AABB, never mirrored).
  const wb = e.worldBox();
  if (wb.y + wb.h >= FLOOR_Y) {
    // Capture impact speed BEFORE inverting so we can decide "is this rest?"
    const impactVy = Math.abs(e.vy);

    // Land exactly on the floor: box bottom (world) touches FLOOR_Y.
    // worldBox().y = e.y + box.oy, so box bottom = e.y + box.oy + box.bh.
    e.y = FLOOR_Y - e.box.oy - e.box.bh;
    e.vy = -impactVy * BOUNCE;
    // Horizontal wall bounce keeps it in view and flips facing + mirror.
    if (wb.x <= 0) {
      e.x = -e.box.ox;
      e.vx = Math.abs(e.vx);
      e.facing = 1;
    } else if (wb.x + wb.w >= VIEW_W) {
      e.x = VIEW_W - e.box.ox - e.box.bw;
      e.vx = -Math.abs(e.vx);
      e.facing = -1;
    }
    e.syncMirror();

    // Reset once the impact is too weak to rise more than ~2px
    // (v²/2g < 2 → v < √(2·g·2) ≈ 77 px/s). Without this the entity
    // settles into a micro-bounce equilibrium and drifts off-screen.
    if (impactVy < REST_VY) {
      e.x = VIEW_W / 2 - 24;
      e.y = 40;
      e.vx = 120;
      e.vy = 0;
      e.facing = 1;
      e.syncMirror();
    }
  }
}

export function getTestEntity() {
  return testEntity;
}
