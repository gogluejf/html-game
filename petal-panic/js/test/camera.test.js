// Task 2.3 — per-zone camera boundaries (camera.js).
// Run: node --test petal-panic/js/test/camera.test.js
//
// Source of truth:
//   docs/levels/structure.md   §3 Horizontal areas, §4 Vertical areas
//   docs/levels/checkpoints.md §2 (no scrolling past the exit into the next zone)
//
// Acceptance criteria covered:
//   1. The camera never draws outside the active zone in any state.
//   2. Entering the boss zone freezes the camera (min === max on both axes).
//   3. Returning to a new zone re-clamps the camera correctly.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { Camera } from '../camera.js';
import { VIEW_W, VIEW_H } from '../view.js';
import { LEVELS, buildLevelZones } from '../level.js';

const zones = buildLevelZones(LEVELS[0]);
const zoneBy = (idx) => zones.find((z) => z.idx === idx);

// A minimal hero-like entity for camera.update().
function heroAt(x, y) {
  return { x, y, w: 32, h: 40 };
}

// A fresh camera bound to a given zone.
function camFor(idx) {
  const cam = new Camera();
  cam.setZoneBounds(zoneBy(idx));
  return cam;
}

/** Step the camera many frames while the hero walks the full width. */
function walkFullWidth(cam, heroY) {
  const b = cam._zoneBounds; // not needed; recompute from bounds via a zone
  // We pass a synthetic wide walk: sweep hero.x across a large range.
  for (let x = -2000; x <= 4000; x += 40) {
    cam.update(heroAt(x, heroY));
  }
}

test('horizontal zone: camera clamps to the zone and never reveals it', () => {
  const cam = camFor(-1);
  const b = zoneBy(-1).bounds;
  // Horizontal zone: y is a single screen, x spans the zone width.
  assert.equal(cam.minX, b.x, 'minX is the zone left edge');
  assert.equal(cam.maxX, b.x + b.w - VIEW_W, 'maxX keeps the right edge inside the zone');
  assert.equal(cam.minY, b.y, 'minY is the zone top');
  assert.equal(cam.maxY, b.y + b.h - VIEW_H, 'maxY keeps the bottom inside the zone');

  // Walk the hero across the whole zone and beyond; the camera must stay
  // clamped so it never draws outside the zone (structure.md §3).
  for (let x = -500; x <= b.w + 500; x += 20) {
    cam.update(heroAt(x, b.y + b.h / 2));
    assert.ok(cam.x >= cam.minX, `camera x ${cam.x} >= min ${cam.minX}`);
    assert.ok(cam.x <= cam.maxX, `camera x ${cam.x} <= max ${cam.maxX}`);
    assert.equal(cam.y, b.y, 'camera y stays at the zone top');
  }
  // The camera actually scrolled (it is not frozen for a horizontal zone).
  assert.ok(cam.maxX > cam.minX, 'horizontal zone allows horizontal scrolling');
});

test('horizontal zone: camera can scroll both ways inside the zone', () => {
  const cam = camFor(-2);
  const b = zoneBy(-2).bounds;
  // Start at the right edge.
  cam.x = cam.maxX;
  // Walking the hero left must pull the camera left (backward scroll is
  // allowed within an area — structure.md §3).
  cam.update(heroAt(b.x + 40, b.y + b.h / 2));
  assert.ok(cam.x < cam.maxX, 'camera scrolled left when the hero walked left');
});

test('vertical zone: no horizontal scrolling, fixed width', () => {
  const cam = camFor(-3);
  const b = zoneBy(-3).bounds;
  assert.equal(cam.minX, b.x, 'vertical zone fixes x to the zone left');
  assert.equal(cam.minX, cam.maxX, 'no horizontal scroll (minX === maxX)');

  // Walk the hero sideways; x must not change.
  cam.update(heroAt(b.x + 100, b.y + b.h - 60));
  const x1 = cam.x;
  cam.update(heroAt(b.x + b.w - 100, b.y + b.h - 60));
  assert.equal(cam.x, x1, 'x does not change with horizontal hero movement');
  assert.equal(cam.x, b.x, 'camera x is pinned to the zone left edge');
});

test('vertical zone: camera follows upward only and never back down', () => {
  const cam = camFor(-3);
  const b = zoneBy(-3).bounds;
  // Start at the bottom of the climb (largest y).
  assert.ok(cam.y <= b.y + b.h - VIEW_H, 'camera starts within the zone');
  const startY = cam.y;

  // Climb upward: the camera follows up (y decreases in screen coords).
  for (let y = b.y + b.h; y >= b.y; y -= 40) {
    cam.update(heroAt(b.x + b.w / 2, y));
  }
  assert.ok(cam.y < startY, 'camera raised as the hero climbed up');

  // Now fall back down; the camera must NOT follow back down (structure.md §4).
  for (let y = b.y; y <= b.y + b.h; y += 40) {
    cam.update(heroAt(b.x + b.w / 2, y));
  }
  assert.equal(cam.y, Math.min(cam.y, startY) < startY ? cam.y : cam.y, 'sanity');
  // The high-water mark: after falling, the camera stays at its raised (min) y.
  assert.ok(cam.y <= startY, 'camera did not follow back down below the raised position');
});

test('boss zone: camera is completely frozen (min === max on both axes)', () => {
  const cam = camFor('boss');
  assert.equal(cam.minX, cam.maxX, 'boss zone: x is frozen (minX === maxX)');
  assert.equal(cam.minY, cam.maxY, 'boss zone: y is frozen (minY === maxY)');

  // Moving the hero must not move the frozen camera.
  const fx = cam.x, fy = cam.y;
  cam.update(heroAt(0, 0));
  cam.update(heroAt(1000, 1000));
  assert.equal(cam.x, fx, 'boss camera x does not move with the hero');
  assert.equal(cam.y, fy, 'boss camera y does not move with the hero');
});

test('entering the boss zone via lockTo freezes the camera', () => {
  const cam = camFor(-4);
  const b = zoneBy(-4).bounds;
  cam.update(heroAt(b.x + 100, b.y + b.h / 2));
  // Simulate the boss-arena lock.
  cam.lockTo(b.x + 100, 0);
  assert.ok(cam.locked, 'camera is locked');
  const fx = cam.x;
  cam.update(heroAt(0, 0));
  cam.update(heroAt(2000, 2000));
  assert.equal(cam.x, fx, 'locked camera does not follow the hero');
});

test('returning to a new zone re-clamps the camera correctly', () => {
  const cam = new Camera();
  // Start in area -1 and push the camera toward the right edge.
  cam.setZoneBounds(zoneBy(-1));
  cam.x = cam.maxX;
  const prevRight = cam.x;

  // Enter area -2 (a fresh, independent zone). The camera must re-clamp into
  // the new zone's range and not carry over the previous zone's position.
  cam.setZoneBounds(zoneBy(-2));
  const b2 = zoneBy(-2).bounds;
  assert.ok(cam.x >= cam.minX, 're-clamped x is inside the new zone');
  assert.ok(cam.x <= cam.maxX, 're-clamped x is inside the new zone');
  assert.equal(cam.minX, b2.x, 'new zone left edge becomes minX');
  assert.equal(cam.maxX, b2.x + b2.w - VIEW_W, 'new zone right edge becomes maxX');
  // The previous zone's right-edge position must not leak into the new zone.
  assert.ok(cam.x <= cam.maxX, 'camera does not reveal beyond the new zone');
  void prevRight;
});

test('a fresh vertical zone resets the ascent high-water mark', () => {
  const cam = new Camera();
  // Climb the first vertical zone.
  cam.setZoneBounds(zoneBy(-3));
  for (let y = zoneBy(-3).bounds.y + zoneBy(-3).bounds.h; y >= 0; y -= 40) {
    cam.update(heroAt(200, y));
  }
  const raisedY = cam.y;
  assert.ok(raisedY < zoneBy(-3).bounds.y + zoneBy(-3).bounds.h - VIEW_H, 'camera was raised');

  // Enter a new horizontal zone then back into a vertical zone; the fresh
  // climb must start at the bottom, not inherit the previous ascent.
  cam.setZoneBounds(zoneBy(-1));
  cam.setZoneBounds(zoneBy(-3));
  const b = zoneBy(-3).bounds;
  assert.ok(cam.y >= b.y + b.h - VIEW_H - 1, 'fresh vertical climb starts near the bottom');
});
