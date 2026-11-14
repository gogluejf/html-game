// Falling-barrel-on-head impact tests (kick-and-cook model): a fast-falling
// barrel that overlaps the hero's OR an enemy's head gets a small knockback
// launch + a short fuse. It stays alive and arcs; it detonates when the fuse
// expires OR it lands, at its current position. Run: node js/test/fallingBarrelStomp.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

const ctx2d = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : () => {}), set: () => true });
global.document = { createElement: () => ({ getContext: () => ctx2d }), addEventListener: () => {} };
global.window = { addEventListener: () => {}, innerWidth: 1280, innerHeight: 720 };

const U = await import('../systems/update.js');
const { GameObj, BARREL_DEF } = await import('../objects/object.js');
const { ctx } = await import('../world/context.js');
const { activeCount, resetEffects } = await import('../effects/index.js');
await import('../effects/registry.js');

function makeHero(x, y) {
  return {
    alive: true, dying: false, x, y, w: 32, h: 91, vx: 0, vy: 0, // real standing hero box (scarlet targetH 1.9)
    energy: 100, shield: 0, stats: { defense: 0 }, layer: 1,
    worldBox() { return { x: this.x, y: this.y, w: this.w, h: this.h }; },
  };
}

function makeFallingBarrel(x, y, vy = 500) {
  const b = new GameObj(BARREL_DEF.id, x, y, BARREL_DEF.w, BARREL_DEF.h);
  b.vy = vy;
  b.worldBox = () => ({ x: b.x, y: b.y, w: b.w, h: b.h });
  return b;
}

test('head-hit launches the barrel (knockback) and arms a fuse, does NOT kill instantly', () => {
  const hero = makeHero(100, 100); // head region 100..112
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 80); // barrel y=80..128, midline=104: head under it
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.equal(b.destroyed, false, 'barrel survives the head-hit (cooking, not dead)');
  assert.ok(b._fuse != null && b._fuse > 0, 'fuse armed');
  assert.ok(Math.abs(b.vx) > 0 || b.vy < 500, 'barrel got a knockback impulse');
});

test('fuse expiry detonates the barrel at its current position', () => {
  const hero = makeHero(100, 100);
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 80);
  U.fallingBarrelImpact(b);
  // Simulate airborne cooking: keep vy high (not landed) and tick past the fuse.
  for (let i = 0; i < 60 && !b.destroyed; i++) {
    b.vy = 300; // still falling / airborne each frame
    U.tickFallingBarrelFuse(b, 1 / 60);
  }
  assert.equal(b.destroyed, true, 'barrel detonated once the fuse ran out');
  assert.ok(activeCount() > 0, 'blast payload fired');
});

test('landing detonates the barrel even before the fuse expires', () => {
  const hero = makeHero(100, 100);
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 80);
  U.fallingBarrelImpact(b);
  // Barrel comes to rest on a surface: stepDynamicSolid zeroes vy → landed.
  b.vy = 0;
  U.tickFallingBarrelFuse(b, 1 / 60);
  assert.equal(b.destroyed, true, 'landed barrel detonates immediately');
});

test('slow settling barrel does not trigger impact', () => {
  const hero = makeHero(100, 100);
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 90, 100); // below FALLING_BARREL_MIN_VY
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.equal(b._fuse, undefined, 'settling barrel left alone (no fuse)');
});

test('mid-air SIDE touch does NOT arm a fuse (barrel level with hero in air)', () => {
  const hero = makeHero(100, 100); // hero top at y=100, head region 100..112
  ctx.hero = hero;
  // Barrel falling fast but its BOTTOM is still ABOVE the hero's head —
  // they overlap only because of widths; it is drifting into the hero's
  // side from above, not landing on the head.
  const b = makeFallingBarrel(110, 50, 500); // barrel y=50..98, bottom=98 < heroTop=100
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.equal(b._fuse, undefined, 'airborne side touch must NOT cook the barrel');
});

test('barrel falling onto the head DOES arm a fuse', () => {
  const hero = makeHero(100, 100); // hero top at y=100, head region 100..112
  ctx.hero = hero;
  // Barrel overlapping the hero's head region: barrel y=80..128, midline=104.
  // Head bottom (112) > midline (104) → head under the barrel; barrel bottom
  // (128) below hero top (100) → arriving from above. Genuine stomp geometry.
  const b = makeFallingBarrel(100, 80, 500);
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.ok(b._fuse != null && b._fuse > 0, 'head stomp arms the fuse');
});

test('fast barrel skipping deep into the body still counts as a head stomp', () => {
  const hero = makeHero(100, 100); // real hero: 32×91 standing; head region 100..122.75
  ctx.hero = hero;
  // One-frame skip: barrel already partly past the head, y=95..143,
  // midline=119. Head bottom (122.75) is below midline (119) → head region
  // overlaps the barrel's lower half → genuine stomp even though the
  // top-edge-only test would have missed it.
  const b = makeFallingBarrel(100, 95, 600);
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.ok(b._fuse != null && b._fuse > 0, 'skipped frame still registers the stomp');
});

test('barrel level with the torso in the air does NOT arm a fuse', () => {
  const hero = makeHero(100, 100); // head region 100..122.75
  ctx.hero = hero;
  // Barrel y=125..173: entirely below the head region, overlapping the
  // torso. Midline=149; head bottom (122.75) < midline → no stomp geometry.
  const b = makeFallingBarrel(100, 125, 500);
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.equal(b._fuse, undefined, 'torso-level contact must NOT cook the barrel');
});

test('dead/destroyed barrel is skipped', () => {
  const hero = makeHero(100, 100);
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 90);
  b.alive = false;
  U.fallingBarrelImpact(b);
  assert.equal(b._fuse, undefined, 'already-dead barrel untouched');
});

// --- Enemy-head stomps -------------------------------------------------------

function makeEnemy(x, y, aiState = 'idle') {
  return {
    alive: true, aiState, x, y, w: 32, h: 48, vx: 0, vy: 0, // typical enemy box
    worldBox() { return { x: this.x, y: this.y, w: this.w, h: this.h }; },
  };
}

test('barrel falling onto an ENEMY head arms the fuse (no hero involved)', () => {
  ctx.hero = null; // no hero at all — enemy stomp must still work
  ctx.realEnemies = [makeEnemy(100, 100)]; // head region 100..112
  const b = makeFallingBarrel(100, 80, 500); // barrel y=80..128, midline=104
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.ok(b._fuse != null && b._fuse > 0, 'enemy head stomp arms the fuse');
  assert.equal(b.destroyed, false, 'barrel survives (cooking)');
});

test('hero takes priority when both hero and enemy heads are under the barrel', () => {
  const hero = makeHero(100, 100);
  ctx.hero = hero;
  ctx.realEnemies = [makeEnemy(100, 100)];
  const b = makeFallingBarrel(100, 80, 500);
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.ok(b._fuse != null && b._fuse > 0, 'stomp registered');
  // One launch per impact window: a second call in the same frame is skipped.
  const fuseBefore = b._fuse;
  U.fallingBarrelImpact(b);
  assert.equal(b._fuse, fuseBefore, 'no double-launch within the cooldown window');
});

test('dead enemy head does NOT arm a fuse', () => {
  ctx.hero = null;
  ctx.realEnemies = [makeEnemy(100, 100, 'dead')];
  const b = makeFallingBarrel(100, 80, 500);
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.equal(b._fuse, undefined, 'corpse contact must NOT cook the barrel');
});

test('barrel level with an enemy TORSO in the air does NOT arm a fuse', () => {
  ctx.hero = null;
  ctx.realEnemies = [makeEnemy(100, 100)]; // head region 100..112
  // Barrel y=125..173: below the head region, overlapping the torso.
  const b = makeFallingBarrel(100, 125, 500);
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.equal(b._fuse, undefined, 'torso-level enemy contact must NOT cook the barrel');
});
