// Falling-barrel-on-hero impact tests (kick-and-cook model): a fast-falling
// barrel that overlaps the hero gets a small knockback launch + a short fuse.
// It stays alive and arcs; it detonates when the fuse expires OR it lands, at
// its current position. Run: node js/test/fallingBarrelStomp.test.js
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
    alive: true, dying: false, x, y, w: 32, h: 48, vx: 0, vy: 0,
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
  const hero = makeHero(100, 100);
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 90);
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.equal(b.destroyed, false, 'barrel survives the head-hit (cooking, not dead)');
  assert.ok(b._fuse != null && b._fuse > 0, 'fuse armed');
  assert.ok(Math.abs(b.vx) > 0 || b.vy < 500, 'barrel got a knockback impulse');
});

test('fuse expiry detonates the barrel at its current position', () => {
  const hero = makeHero(100, 100);
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 90);
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
  const b = makeFallingBarrel(100, 90);
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

test('dead/destroyed barrel is skipped', () => {
  const hero = makeHero(100, 100);
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 90);
  b.alive = false;
  U.fallingBarrelImpact(b);
  assert.equal(b._fuse, undefined, 'already-dead barrel untouched');
});
