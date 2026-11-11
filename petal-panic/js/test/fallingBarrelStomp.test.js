// Falling-barrel-on-hero impact tests (pure model): a fast-falling barrel that
// overlaps the hero is destroyed on impact and detonates through its normal
// pipeline. No bounce, no jump refund, no flat "bonk" number — the blast
// decides damage. Run: node js/test/fallingBarrelStomp.test.js
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
    alive: true, dying: false, x, y, w: 32, h: 48,
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

test('fast falling barrel overlapping hero is destroyed and detonates', () => {
  const hero = makeHero(100, 100);
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 90); // overlapping the hero
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.equal(b.destroyed, true, 'barrel killed on head-impact');
  assert.ok(activeCount() > 0, 'blast payload fired (explosion primitive registered)');
});

test('stomp does NOT bounce the hero (no vy hack)', () => {
  const hero = makeHero(100, 100);
  hero.vy = 0;
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 90);
  U.fallingBarrelImpact(b);
  assert.equal(hero.vy, 0, 'hero velocity untouched — no bounce impulse');
});

test('slow settling barrel does not trigger impact', () => {
  const hero = makeHero(100, 100);
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 90, 100); // below FALLING_BARREL_MIN_VY
  resetEffects();
  U.fallingBarrelImpact(b);
  assert.equal(b.destroyed, false, 'settling barrel left alone');
});

test('dead/destroyed barrel is skipped', () => {
  const hero = makeHero(100, 100);
  ctx.hero = hero;
  const b = makeFallingBarrel(100, 90);
  b.alive = false;
  U.fallingBarrelImpact(b);
  assert.equal(b.destroyed, false, 'already-dead barrel untouched');
});
