// Task 2.3 — Camera max-scroll from zone length (camera.js).
// Run: node --test petal-panic/js/test/camera.test.js
//
// Source of truth:
//   docs/levels/structure.md §3 Horizontal areas, §4 Vertical areas
//
// Acceptance criteria covered (task 2.3):
//   1. Camera max scroll equals the zone's length (cannot draw past the exit
//      flag) for horizontal zones.
//   2. Vertical zones have no horizontal camera movement (fixed width).
//   3. Boss zone camera is completely frozen (fixed view).
//   4. Entering a new zone re-clamps the camera to the new zone's length.
//
// The vertical up-only ratchet (camera never follows back down) is task 5.1's
// concern and is tested there — not here.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { Camera } from '../camera.js';
import { VIEW_W, VIEW_H } from '../view.js';
import { LEVELS, buildLevelZones } from '../level.js';

// --- Runtime wiring (systems/update.js) --------------------------------------
// The camera math above is covered directly. The reviewer finding is that the
// test never exercises the RUNTIME path: that update.js actually re-clamps the
// camera when a zone is entered/restarted. update.js is a browser module, so we
// stub a minimal DOM before importing it (same pattern as clearSequence.test.js
// and headless-smoke.mjs).
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  getElementById: () => ({ getContext: () => ctxStub, width: 960, height: 540 }),
  createElement: () => ({ style: {}, getContext: () => ctxStub, width: 0, height: 0 }),
  addEventListener: noop,
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 960, innerHeight: 540, addEventListener: noop };
globalThis.requestAnimationFrame = noop;

const U = await import('../systems/update.js');
const { S, getState, setState, tryTransition } = await import('../state.js');

// Expected clamp range for a given zone, mirroring camera.js setZoneBounds().
function expectedRange(zone) {
  const b = zone.bounds;
  if (zone.orientation === 'vertical') return { minX: b.x, maxX: b.x };
  if (zone.orientation === 'boss') {
    const cx = b.x + b.w / 2 - VIEW_W / 2;
    const cy = b.y + b.h / 2 - VIEW_H / 2;
    return { minX: cx, maxX: cx, minY: cy, maxY: cy };
  }
  return { minX: b.x, maxX: b.x + b.w - VIEW_W, minY: b.y, maxY: b.y + b.h - VIEW_H };
}

const zones = buildLevelZones(LEVELS[0]);
const zoneBy = (idx) => zones.find((z) => z.idx === idx);

// A minimal hero-like entity for camera.update().
function heroAt(x, y) {
  return { x, y, w: 32, h: 40 };
}

test('horizontal zone: max scroll equals the zone length, cannot draw past it', () => {
  const cam = new Camera();
  const b = zoneBy(1).bounds;
  cam.setZoneBounds(zoneBy(1));

  // minX is the zone's left edge; maxX keeps the right edge inside the zone.
  assert.equal(cam.minX, b.x, 'minX is the zone left edge');
  assert.equal(cam.maxX, b.x + b.w - VIEW_W, 'maxX = zone length - view width');
  assert.ok(cam.maxX > cam.minX, 'horizontal zone allows horizontal scrolling');

  // Walk the hero across and beyond the whole zone; the camera must stay
  // clamped so it never draws past the zone's end (structure.md §3).
  for (let x = -500; x <= b.w + 500; x += 20) {
    cam.update(heroAt(x, b.y + b.h / 2));
    assert.ok(cam.x >= cam.minX, `camera x ${cam.x} >= min ${cam.minX}`);
    assert.ok(cam.x <= cam.maxX, `camera x ${cam.x} <= max ${cam.maxX}`);
  }
  // It actually reached the right edge (the exit flag side) and stopped.
  assert.equal(cam.x, cam.maxX, 'camera rests at the zone end (exit flag side)');
});

test('vertical zone: no horizontal camera movement (fixed width)', () => {
  const cam = new Camera();
  const b = zoneBy(3).bounds;
  cam.setZoneBounds(zoneBy(3));

  assert.equal(cam.minX, b.x, 'vertical zone fixes x to the zone left');
  assert.equal(cam.minX, cam.maxX, 'no horizontal scroll (minX === maxX)');

  // Sideways hero movement must not move the camera horizontally.
  cam.update(heroAt(b.x + 100, b.y + b.h - 60));
  const x1 = cam.x;
  cam.update(heroAt(b.x + b.w - 100, b.y + b.h - 60));
  assert.equal(cam.x, x1, 'x does not change with horizontal hero movement');
  assert.equal(cam.x, b.x, 'camera x is pinned to the zone left edge');
});

test('boss zone: camera is completely frozen (fixed view)', () => {
  const cam = new Camera();
  cam.setZoneBounds(zoneBy('boss'));

  assert.equal(cam.minX, cam.maxX, 'boss zone: x is frozen (minX === maxX)');
  assert.equal(cam.minY, cam.maxY, 'boss zone: y is frozen (minY === maxY)');

  // Moving the hero must not move the frozen camera.
  const fx = cam.x;
  const fy = cam.y;
  cam.update(heroAt(0, 0));
  cam.update(heroAt(1000, 1000));
  assert.equal(cam.x, fx, 'boss camera x does not move with the hero');
  assert.equal(cam.y, fy, 'boss camera y does not move with the hero');
});

test('entering a new zone re-clamps the camera to the new zone length', () => {
  const cam = new Camera();
  // Start in area -1 and push the camera to its right edge.
  cam.setZoneBounds(zoneBy(1));
  cam.x = cam.maxX;

  // Enter area -2 (a fresh, independent zone). The camera must re-clamp into
  // the new zone's range and not reveal beyond its length.
  cam.setZoneBounds(zoneBy(2));
  const b2 = zoneBy(2).bounds;
  assert.equal(cam.minX, b2.x, 'new zone left edge becomes minX');
  assert.equal(cam.maxX, b2.x + b2.w - VIEW_W, 'new zone right edge becomes maxX');
  assert.ok(cam.x >= cam.minX && cam.x <= cam.maxX, 're-clamped x is inside the new zone');
});

// --- Runtime wiring tests (systems/update.js) --------------------------------
// These drive the real runtime path: update.js registers an onTransition hook
// that, on EVERY area-entry confirmation (AREA_ENTRY→PLAY), calls
// camera.setZoneBounds(getActiveZone(hero)). We exercise that hook end to end
// and assert the live runtime camera is re-clamped to the new zone's bounds.

test('runtime: AREA_ENTRY→PLAY re-clamps the live camera to the new zone', () => {
  const hero = U.getHero();
  const cam = U.camera;
  const zone = U.getActiveZone(hero);
  const range = expectedRange(zone);

  // Deliberately desync the runtime camera so the test is meaningful: if the
  // AREA_ENTRY→PLAY hook did NOT re-clamp, these would still be wrong.
  cam.minX = -99999;
  cam.maxX = 99999;
  cam.x = 50000;
  cam.y = 50000;

  setState(S.AREA_ENTRY);
  const ok = tryTransition(S.PLAY);
  assert.ok(ok, 'AREA_ENTRY→PLAY transition succeeds');

  // The runtime camera must now be bound to the active zone the hero is in.
  assert.equal(cam.minX, range.minX, 'runtime camera minX re-clamped to zone left');
  assert.equal(cam.maxX, range.maxX, 'runtime camera maxX re-clamped to zone right');
  assert.ok(cam.x >= cam.minX && cam.x <= cam.maxX, 'runtime camera x is inside the zone');
});

test('runtime: re-entering a zone re-clamps the camera to that zone length', () => {
  const hero = U.getHero();
  const cam = U.camera;
  const zone2 = zones.find((z) => z.idx === 2);
  const range = expectedRange(zone2);

  // Put the hero into area 2 and re-enter via the entry screen. The runtime
  // camera must be re-clamped to area 2's bounds (not the previous zone's).
  hero.currentArea = 2;

  // Desync so we can prove the hook re-clamps to the NEW zone.
  cam.minX = -99999;
  cam.maxX = 99999;
  cam.x = 50000;
  cam.y = 50000;

  setState(S.AREA_ENTRY);
  const ok = tryTransition(S.PLAY);
  assert.ok(ok, 'AREA_ENTRY→PLAY transition succeeds');
  assert.equal(getState(), S.PLAY, 'state is PLAY after confirmation');

  assert.equal(cam.minX, range.minX, 'camera minX re-clamped to area -2 left');
  assert.equal(cam.maxX, range.maxX, 'camera maxX re-clamped to area -2 right');
  assert.ok(cam.x >= cam.minX && cam.x <= cam.maxX, 'camera x inside area -2');
});
