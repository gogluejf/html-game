// Shared rigid-body physics (core/physics.js) — head-bonk + impulse rules.
// Run: node js/test/headBonk.test.js
//
// Asserts:
//   - heroBonkDynamic: falling hero overlapping a resting barrel bounces
//     (keeps part of fall speed) AND shoves the barrel downward along the
//     impact axis (energy transfer, not a hard stop).
//   - Gated: slow contact (< HERO_BONK_MIN_SPEED) is untouched (settling).
//   - No overlap / moving away = no-op.
//   - applyAxisImpulse: equal-mass momentum conservation (barrel-on-barrel).
//   - bounceOffStatic: into-wall velocity reflected with restitution.

import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

import { strict as assert } from 'node:assert';
import {
  penetration, axisNormal, applyAxisImpulse, bounceOffStatic,
  heroBonkDynamic, stepDynamicSolid,
  HERO_BONK_MIN_SPEED, HERO_BONK_RESTITUTION, HERO_BONK_TRANSFER,
} from '../core/physics.js';
import { resolve } from '../core/collision.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Minimal entity: plain box + velocities (worldBox reads live fields). */
function box(x, y, w, h, vx = 0, vy = 0) {
  return { x, y, w, h, vx, vy, alive: true, worldBox() { return this; } };
}

console.log('headBonk — core/physics.js');

ok('penetration: overlapping boxes report positive pen on both axes', () => {
  const { penX, penY } = penetration(box(0, 0, 40, 40), box(20, 10, 40, 40));
  assert.ok(penX > 0 && penY > 0);
});

ok('penetration: disjoint boxes report <= 0', () => {
  const { penX, penY } = penetration(box(0, 0, 40, 40), box(100, 100, 40, 40));
  assert.ok(penX <= 0 || penY <= 0);
});

ok('heroBonkDynamic: fast fall onto resting barrel bounces hero AND shoves barrel', () => {
  const hero = box(0, 0, 32, 91, 0, 400);      // falling at 400 px/s
  const barrel = box(8, 70, 32, 48, 0, 0);     // resting, head in lower half
  const hit = heroBonkDynamic(hero, barrel);
  assert.ok(hit, 'bonk applied');
  // Hero keeps RESTITUTION of closing speed (soft bounce, not a hard stop):
  assert.ok(Math.abs(hero.vy) > 0, 'hero still has vertical velocity after bonk');
  assert.ok(Math.abs(hero.vy) < 400, 'hero lost most of the fall speed');
  const expectedHero = -400 * HERO_BONK_RESTITUTION; // bounced back UP at 28% of fall speed
  assert.ok(Math.abs(hero.vy - expectedHero) < 1e-6, `hero.vy=${hero.vy} expected ${expectedHero}`);
  // Barrel received TRANSFER share of the closing speed (downward push):
  const expectedBarrel = 400 * HERO_BONK_TRANSFER;
  assert.ok(Math.abs(barrel.vy - expectedBarrel) < 1e-6, `barrel.vy=${barrel.vy} expected ${expectedBarrel}`);
});

ok('heroBonkDynamic: RISING into a barrel from below = head bonk even when penX > penY', () => {
  // The real under-barrel jump geometry: tall hero (91px) rising, head inside
  // the barrel's lower half. Horizontal overlap (24) EXCEEDS vertical (16) —
  // blind min-penetration would call this a side hit and read vx (~0),
  // missing the bonk. Intent must win: this is a head hit on the bottom face.
  const hero = box(0, 40, 32, 91, 0, -500);    // rising at 500 px/s
  const barrel = box(-8, 0, 32, 48, 0, 0);     // resting above; head overlaps
  const hit = heroBonkDynamic(hero, barrel);
  assert.ok(hit, 'head bonk applied despite penX > penY');
  // Bounced back DOWN with RESTITUTION of the closing speed (soft bonk):
  const rel = 500; // closing speed along Y (ny=-1, v=-500 → rel=500)
  const expectedHero = rel * HERO_BONK_RESTITUTION; // bounced back DOWN at 28% of closing speed
  assert.ok(Math.abs(hero.vy - expectedHero) < 1e-6, `hero.vy=${hero.vy} expected ${expectedHero}`);
  // Barrel shoved UP (ny=-1: impulse opposes the hero's driving direction):
  const expectedBarrel = -rel * HERO_BONK_TRANSFER;
  assert.ok(Math.abs(barrel.vy - expectedBarrel) < 1e-6, `barrel.vy=${barrel.vy} expected ${expectedBarrel}`);
});

ok('resolve(): rising hero under a barrel resolves on Y (head hit), NOT shoved sideways', () => {
  // Regression test for the "jumped under a barrel and teleported to its
  // side" glitch: penX (24) > penY (16), but the hero is rising with its
  // center in the barrel's lower half → head hit → Y resolution pushes the
  // hero back DOWN off the bottom face, x untouched.
  const hero = { x: 0, y: 40, w: 32, h: 91, vx: 0, vy: -500, worldBox() { return this; } };
  const barrel = { x: -8, y: 0, w: 32, h: 48 };
  const res = resolve(hero, [barrel], {});
  assert.equal(res.axis, 'y', `resolved axis=${res.axis}`);
  assert.equal(res.dir, 1, 'pushed DOWN off the barrel bottom face (dir=1 = +y)');
  // Hero moved DOWN (y increased) off the bottom face, x unchanged:
  assert.ok(hero.y > 40, `hero.y=${hero.y} should be pushed down`);
  assert.equal(hero.x, 0, 'x must not change (no side teleport)');
  assert.ok(hero.vy >= 0, `vy=${hero.vy} should be zeroed/flipped`);
});

ok('heroBonkDynamic: gentle contact below min speed is untouched (settling)', () => {
  const hero = box(0, 0, 32, 91, 0, HERO_BONK_MIN_SPEED - 10);
  const barrel = box(8, 70, 32, 48, 0, 0);
  assert.equal(heroBonkDynamic(hero, barrel), false);
  assert.equal(hero.vy, HERO_BONK_MIN_SPEED - 10);
  assert.equal(barrel.vy, 0);
});

ok('heroBonkDynamic: no overlap = no-op', () => {
  const hero = box(0, 0, 32, 91, 0, 500);
  const barrel = box(200, 200, 32, 48, 0, 0);
  assert.equal(heroBonkDynamic(hero, barrel), false);
});

ok('heroBonkDynamic: hero rising past a barrel (moving away) = no-op', () => {
  const hero = box(0, 0, 32, 91, 0, -500);     // ascending
  const barrel = box(8, 70, 32, 48, 0, 0);
  assert.equal(heroBonkDynamic(hero, barrel), false);
});

ok('applyAxisImpulse: equal-mass collision conserves momentum', () => {
  const a = { vx: 100 }, b = { vx: 0 };
  applyAxisImpulse(a, b, 1, 'vx', 0.35);
  // Momentum conserved: va+vb unchanged (equal mass).
  assert.ok(Math.abs((a.vx + b.vx) - 100) < 1e-9, `momentum ${a.vx + b.vx}`);
  // Symmetric hands: each gets (1+e)/2 of closing speed.
  const hand = 0.675 * 100;
  assert.ok(Math.abs(a.vx - (100 - hand)) < 1e-9);
  assert.ok(Math.abs(b.vx - hand) < 1e-9);
});

ok('applyAxisImpulse: not closing (rel <= 0) = no-op', () => {
  const a = { vx: -100 }, b = { vx: 0 }; // moving apart along n=+1? a recedes
  assert.equal(applyAxisImpulse(a, b, 1, 'vx', 0.35), false);
  assert.equal(a.vx, -100);
});

ok('bounceOffStatic: falling onto static top reflects vy with restitution', () => {
  const body = box(0, 0, 32, 48, 0, 300);       // falling
  const wall = box(-10, 40, 52, 200);           // overlaps from above
  const hit = bounceOffStatic(body, wall, 0.3, 120);
  assert.ok(hit);
  assert.ok(Math.abs(body.vy - (-300 * 0.3)) < 1e-9, `vy=${body.vy}`);
});

ok('bounceOffStatic: below min speed = settle, no bounce', () => {
  const body = box(0, 0, 32, 48, 0, 50);
  const wall = box(-10, 40, 52, 200);
  assert.equal(bounceOffStatic(body, wall, 0.3, 120), false);
  assert.equal(body.vy, 50);
});

ok('stepDynamicSolid: barrel at rest on a floor stays put (no drift)', () => {
  const b = box(0, 100, 32, 48, 0, 0);
  const floor = { x: -50, y: 148, w: 200, h: 50 };
  for (let i = 0; i < 120; i++) stepDynamicSolid(b, 1 / 60, [floor], [b]);
  assert.ok(Math.abs(b.y - 100) < 1, `y drifted to ${b.y}`);
  assert.ok(Math.abs(b.vy) < 1, `vy=${b.vy}`);
});

console.log(`\n${passed} passed`);
