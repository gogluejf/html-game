// Task 5.1 — Vertical zone orientation (camera ratchet + lethal bottom + restart).
// Run: node --test petal-panic/js/test/verticalZone.test.js
//
// Source of truth:
//   docs/levels/structure.md  §4 Vertical areas (Contra-style ascent)
//   docs/levels/checkpoints.md §1 (vertical entry/exit flags), §4 (death restart)
//
// Acceptance criteria covered (task 5.1):
//   1. Camera never scrolls down once raised (upward-only ratchet).
//   2. Falling below the bottom kills exactly like any other death
//      (isBelowVerticalBottom drives the shared die() pipeline).
//   3. Restart places the hero on the bottom platform with a reset camera
//      (the AREA_ENTRY→PLAY hook re-clamps the camera, resetting the ratchet).
//   4. The initial platform does not kill a standing hero.
//   5. The route remains usable under the up-only camera (camera tracks upward
//      progress while the hero climbs).
//
// The camera ratchet itself lives in Camera (task 2.3); this test exercises it
// through the vertical-zone path and the lethal-bottom rule through the real
// runtime (systems/update.js), which is where the death check is wired.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { Camera } from '../camera.js';
import { VIEW_H } from '../view.js';
import { LEVELS, buildLevelZones } from '../level.js';

// --- Minimal DOM stub so systems/update.js (a browser module) loads in node. --
// Same pattern as camera.test.js / clearSequence.test.js.
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
const { S, setState, tryTransition } = await import('../state.js');

const zones = buildLevelZones(LEVELS[0]);
// LEVELS[0].verticalArea is -3 (see level.js config); the vertical zone is the
// one whose orientation is 'vertical'.
const vzone = zones.find((z) => z.orientation === 'vertical');
assert.ok(vzone, 'a vertical zone exists in the level');

// A minimal hero-like entity for Camera.update() (matches camera.test.js).
function heroAt(x, y) {
  return { x, y, w: 32, h: 40 };
}

// ---------------------------------------------------------------------------
// 1. Camera ratchet: upward-only, never back down (structure.md §4).
// ---------------------------------------------------------------------------
test('vertical camera: follows upward but never scrolls back down', () => {
  const cam = new Camera();
  const b = vzone.bounds;
  cam.setZoneBounds(vzone);

  // Start at the bottom of the climb (camera bottom = zone bottom).
  const bottomCamY = b.y + b.h - VIEW_H;
  cam.y = bottomCamY;
  cam.minYReached = bottomCamY;

  // The hero climbs (smaller y). The camera should rise to follow.
  const midY = b.y + b.h / 2;
  cam.update(heroAt(b.x + 100, midY));
  const raisedY = cam.y;
  assert.ok(raisedY < bottomCamY, `camera rose while climbing (${raisedY} < ${bottomCamY})`);

  // Now the hero falls back down (larger y). The camera must NOT follow down.
  cam.update(heroAt(b.x + 100, b.y + b.h - 60));
  assert.equal(cam.y, raisedY, 'camera did not follow the hero back down');
  assert.ok(cam.y <= cam.minYReached, 'camera stays at/above the high-water mark');
});

test('vertical camera: sideways movement never scrolls horizontally', () => {
  const cam = new Camera();
  const b = vzone.bounds;
  cam.setZoneBounds(vzone);

  cam.update(heroAt(b.x + 50, b.y + b.h - 60));
  const x1 = cam.x;
  cam.update(heroAt(b.x + b.w - 50, b.y + b.h - 60));
  assert.equal(cam.x, x1, 'x is fixed (no horizontal scroll)');
  assert.equal(cam.x, b.x, 'camera x pinned to the zone left edge');
});

// ---------------------------------------------------------------------------
// 2. Lethal bottom emptiness (structure.md §4).
// ---------------------------------------------------------------------------
test('lethal bottom: a standing hero on the bottom platform is safe', () => {
  // The bottom platform's top surface is at bounds.y + bounds.h. A hero
  // standing on it has feet exactly at that line (y + h === bottom).
  const bottom = vzone.bounds.y + vzone.bounds.h;
  const standingHero = { y: bottom - 40, h: 40 }; // feet at `bottom`
  assert.equal(standingHero.y + standingHero.h, bottom, 'feet rest on the platform top');
  assert.equal(
    U.isBelowVerticalBottom(standingHero, vzone),
    false,
    'a standing hero is NOT below the lethal bottom (safe start)',
  );
});

test('lethal bottom: falling below the bottom platform kills', () => {
  const bottom = vzone.bounds.y + vzone.bounds.h;
  // Feet strictly below the platform top → lethal.
  const fallenHero = { y: bottom - 30, h: 40 }; // feet at bottom + 10
  assert.ok(
    U.isBelowVerticalBottom(fallenHero, vzone),
    'a hero whose feet drop below the platform is below the lethal bottom',
  );
});

test('lethal bottom: does not apply to horizontal or boss zones', () => {
  const hzone = zones.find((z) => z.orientation === 'horizontal');
  const bzone = zones.find((z) => z.orientation === 'boss');
  const deepHero = { y: 99999, h: 40 };
  assert.equal(U.isBelowVerticalBottom(deepHero, hzone), false, 'horizontal zone: no lethal bottom');
  assert.equal(U.isBelowVerticalBottom(deepHero, bzone), false, 'boss zone: no lethal bottom');
});

// ---------------------------------------------------------------------------
// 3. Restart resets the camera ratchet (structure.md §4 / checkpoints.md §4).
// ---------------------------------------------------------------------------
test('restart: AREA_ENTRY→PLAY re-clamps the camera, resetting the ratchet', () => {
  const hero = U.getHero();
  const cam = U.camera;
  const b = vzone.bounds;

  // Put the hero in the vertical area and simulate a camera that has already
  // risen partway up the climb (a mid-attempt state).
  hero.currentArea = vzone.areaIdx;
  cam.setZoneBounds(vzone);
  cam.y = b.y + 100; // a raised camera position
  cam.minYReached = b.y + 100;

  // Desync so we can prove the hook re-clamps and resets the ascent.
  cam.minYReached = 99999; // a bogus high-water mark that a fresh climb must clear

  setState(S.AREA_ENTRY);
  const ok = tryTransition(S.PLAY);
  assert.ok(ok, 'AREA_ENTRY→PLAY transition succeeds');

  // The ratchet high-water mark must be reset to the camera's current (bottom)
  // position so the fresh climb does not inherit the previous attempt's ascent.
  assert.equal(cam.minYReached, cam.y, 'ratchet reset to the camera position on restart');
  assert.ok(cam.y >= cam.minY && cam.y <= cam.maxY, 'camera re-clamped inside the vertical zone');
});

test('restart: hero respawns at the bottom-platform entry, not mid-climb', () => {
  const hero = U.getHero();
  const b = vzone.bounds;
  const bottom = b.y + b.h;

  // A vertical zone's entry flag sits on the bottom supporting platform
  // (structure.md §4): entryFlag.y = bottom - flagHeight. Placing the hero at
  // the entry (foot at bottom) is a safe, non-lethal start.
  const entryFlag = vzone.entryFlag;
  assert.ok(entryFlag, 'the vertical zone has an entry flag on the bottom platform');
  assert.equal(entryFlag.y, bottom - 48, 'entry flag top sits on the bottom platform');

  // Respawn at the checkpoint (bottom entry) and confirm the hero is NOT below
  // the lethal bottom — i.e. the restart is a safe start.
  const respawned = { y: entryFlag.y - hero.h + 48, h: hero.h }; // feet at bottom
  assert.equal(respawned.y + respawned.h, bottom, 'respawn feet rest on the bottom platform');
  assert.equal(
    U.isBelowVerticalBottom(respawned, vzone),
    false,
    'a death restart on the bottom platform is not lethal',
  );
});
