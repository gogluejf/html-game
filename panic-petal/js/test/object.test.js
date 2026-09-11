// Task 4.1 — node-based unit tests for Objects (barrels + explosions).
// Run: node js/test/object.test.js
// No DOM needed: entity.js / consts.js / damage.js / object.js are pure modules.
//
// Acceptance criteria covered here:
//   1. Hero and enemy cannot pass a barrel (solid)        → layer SOLID check
//   2. Melee/projectile/bomb chip HP; no explosion until 0 → hit() latching
//   3. A bomb one-shots the barrel; thorns/melee need many → dmg magnitude
//   4. Explosion at HP=0 damages entities in radius incl. hero → explodeBarrel

import { strict as assert } from 'node:assert';
import { LAYER } from '../consts.js';
import {
  GameObj, makeBarrel, makeCoinBarrel,
  BARREL_DEF, COIN_BARREL_DEF, BARREL_DAMAGE,
  centerOf, withinRadius, explodeBarrel,
} from '../object.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// --- Minimal stand-in targets (no DOM, no full Enemy/Hero needed) -------------
// A plain "enemy" with hp + alive; a plain "hero" with energy + defense.
function fakeEnemy(x, y, hp = 40) {
  return { x, y, w: 36, h: 40, alive: true, hp, maxHp: hp, type: 'target', layer: LAYER.ENEMY };
}
function fakeHero(x, y, energy = 100, defense = 2) {
  return { x, y, w: 32, h: 48, alive: true, energy, maxEnergy: energy, defense, layer: LAYER.HERO };
}

console.log('Definitions');
ok('BARREL_DEF matches spec', () => {
  assert.equal(BARREL_DEF.id, 'barrel');
  assert.equal(BARREL_DEF.w, 32);
  assert.equal(BARREL_DEF.h, 48);
  assert.equal(BARREL_DEF.hp, 60);
  assert.equal(BARREL_DEF.explosive, true);
  assert.equal(BARREL_DEF.explodeRadius, 120);
});
ok('COIN_BARREL_DEF is non-explosive', () => {
  assert.equal(COIN_BARREL_DEF.id, 'coinBarrel');
  assert.equal(COIN_BARREL_DEF.hp, 60);
  assert.equal(COIN_BARREL_DEF.explosive, false);
  assert.equal(COIN_BARREL_DEF.explodeRadius, 0);
});

console.log('GameObj base');
ok('barrel is a SOLID (blocks movement)', () => {
  const b = makeBarrel(0, 0);
  assert.equal(b.layer, LAYER.SOLID);
});
ok('barrel defaults: hp 60, explosive, radius 120, gravity 0', () => {
  const b = makeBarrel(0, 0);
  assert.equal(b.hp, 60);
  assert.equal(b.maxHp, 60);
  assert.equal(b.explosive, true);
  assert.equal(b.explodeRadius, 120);
  assert.equal(b.gravity, 0);
  assert.equal(b.type, 'barrel');
});
ok('coin barrel is non-explosive with radius 0', () => {
  const b = makeCoinBarrel(0, 0);
  assert.equal(b.explosive, false);
  assert.equal(b.explodeRadius, 0);
  assert.equal(b.type, 'coinBarrel');
});
ok('hitFlash decays over update()', () => {
  const b = makeBarrel(0, 0);
  b.hitFlash = 0.1;
  b.update(0.05);
  assert.ok(approx(b.hitFlash, 0.05), `flash=${b.hitFlash}`);
  b.update(0.1);
  assert.equal(b.hitFlash, 0); // clamped at 0
});

console.log('HP chipping (acceptance #2)');
ok('single thorn (10 dmg) chips HP but does NOT destroy', () => {
  const b = makeBarrel(0, 0);
  const applied = b.hit(10, null, 'projectile');
  assert.equal(applied, 10);
  assert.equal(b.hp, 50);
  assert.equal(b.destroyed, false);
  assert.equal(b.alive, true);
  assert.ok(b.hitFlash > 0, 'white flash set on hit');
});
ok('does not break on touch / per-hit: needs several hits to reach 0', () => {
  const b = makeBarrel(0, 0);
  for (let i = 0; i < 5; i++) b.hit(10, null, 'projectile'); // 50 total
  assert.equal(b.hp, 10);
  assert.equal(b.destroyed, false);
  assert.equal(b.alive, true);
  b.hit(10, null, 'projectile'); // 6th hit → 0
  assert.equal(b.destroyed, true);
  assert.equal(b.alive, false);
});
ok('melee (10 dmg) also chips over multiple hits', () => {
  const b = makeBarrel(0, 0);
  for (let i = 0; i < 5; i++) b.hit(10, null, 'melee');
  assert.equal(b.hp, 10);
  assert.equal(b.destroyed, false);
});
ok('hit() returns 0 and is a no-op after destruction', () => {
  const b = makeBarrel(0, 0);
  b.hit(999, null, 'bomb'); // destroys it
  assert.equal(b.destroyed, true);
  const again = b.hit(10, null, 'projectile');
  assert.equal(again, 0);
  assert.equal(b.hp, 0);
});
ok('damage never drives HP below 0 (clamped)', () => {
  const b = makeBarrel(0, 0);
  b.hit(50, null, 'projectile');
  assert.equal(b.hp, 10);
  b.hit(999, null, 'projectile');
  assert.equal(b.hp, 0);
});

console.log('Bomb one-shot (acceptance #3)');
ok('a bomb (large dmg) one-shots the barrel', () => {
  const b = makeBarrel(0, 0);
  const applied = b.hit(999, null, 'bomb');
  assert.ok(applied >= 60);
  assert.equal(b.hp, 0);
  assert.equal(b.destroyed, true);
  assert.equal(b.alive, false);
});
ok('thorns need ~6 hits (10 dmg each) vs a bomb needing 1', () => {
  const t = makeBarrel(0, 0);
  let thornHits = 0;
  while (!t.destroyed) { t.hit(10, null, 'projectile'); thornHits++; }
  assert.equal(thornHits, 6); // 6 × 10 = 60 hp
  const bomb = makeBarrel(0, 0);
  bomb.hit(999, null, 'bomb');
  assert.equal(bomb.destroyed, true);
});

console.log('Explosion AoE (acceptance #4)');
ok('explodeBarrel damages an enemy inside the radius', () => {
  const b = makeBarrel(0, 0);          // center at (16, 24)
  const enemy = fakeEnemy(16 - 18, 24 - 20, 40); // well within 120px
  const before = enemy.hp;
  const result = explodeBarrel(b, [enemy]);
  assert.ok(result.hit.includes(enemy), 'enemy listed as hit');
  assert.ok(enemy.hp < before, `hp dropped ${before}→${enemy.hp}`);
});
ok('explodeBarrel damages the HERO too (self-damage risk/reward)', () => {
  const b = makeBarrel(0, 0);
  const hero = fakeHero(16 - 10, 24 - 10, 100, 2); // close to the blast
  const before = hero.energy;
  const result = explodeBarrel(b, [hero]);
  assert.ok(result.hit.includes(hero), 'hero listed as hit');
  assert.ok(hero.energy < before, `energy dropped ${before}→${hero.energy}`);
});
ok('entities OUTSIDE the radius are untouched', () => {
  const b = makeBarrel(0, 0); // center (16,24), radius 120
  const far = fakeEnemy(1000, 1000, 40); // far away
  const result = explodeBarrel(b, [far]);
  assert.equal(result.hit.length, 0);
  assert.equal(far.hp, 40);
});
ok('the exploding barrel never self-hits', () => {
  const b = makeBarrel(0, 0);
  const result = explodeBarrel(b, [b]); // only itself in the list
  assert.equal(result.hit.length, 0);
});
ok('dead entities are skipped', () => {
  const b = makeBarrel(0, 0);
  const dead = fakeEnemy(0, 0, 40);
  dead.alive = false;
  const result = explodeBarrel(b, [dead]);
  assert.equal(result.hit.length, 0);
});
ok('explosion reports correct center + radius', () => {
  const b = makeBarrel(100, 200); // center (116, 224)
  const result = explodeBarrel(b, []);
  assert.ok(approx(result.center.cx, 116));
  assert.ok(approx(result.center.cy, 224));
  assert.equal(result.radius, 120);
});
ok('AoE uses center-to-center distance (circular, symmetric)', () => {
  const b = makeBarrel(0, 0); // center (16,24)
  // Place an enemy whose CENTER is exactly at radius distance along +x.
  const ex = 16 + 120 - 18; // enemy left edge so its center (ex+18) == 136
  const e = fakeEnemy(ex, 24 - 20, 40);
  assert.ok(withinRadius(b, e, 120), 'at radius boundary should be within');
  // One more px out → outside.
  const e2 = fakeEnemy(ex + 5, 24 - 20, 40);
  assert.ok(!withinRadius(b, e2, 120), 'just past radius should be outside');
});

console.log('Coin barrel behavior');
ok('coin barrel has no damaging explosion (radius 0)', () => {
  const cb = makeCoinBarrel(0, 0);
  const enemy = fakeEnemy(0, 0, 40);
  const result = explodeBarrel(cb, [enemy]);
  assert.equal(result.radius, 0);
  assert.equal(result.hit.length, 0); // nothing within 0 radius
  assert.equal(enemy.hp, 40);
});
ok('coin barrel still destructible via hit()', () => {
  const cb = makeCoinBarrel(0, 0);
  for (let i = 0; i < 6; i++) cb.hit(10, null, 'projectile');
  assert.equal(cb.destroyed, true);
  assert.equal(cb.alive, false);
});

console.log('Geometry helpers');
ok('centerOf computes box center', () => {
  const c = centerOf({ x: 10, y: 20, w: 32, h: 48 });
  assert.ok(approx(c.cx, 26));
  assert.ok(approx(c.cy, 44));
});
ok('withinRadius true for overlapping/near boxes', () => {
  assert.ok(withinRadius({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }, 10));
});
ok('withinRadius false for distant boxes', () => {
  assert.ok(!withinRadius({ x: 0, y: 0, w: 10, h: 10 }, { x: 500, y: 500, w: 10, h: 10 }, 10));
});

console.log('Solid blocking (acceptance #1)');
ok('barrel exposes a worldBox usable by resolve() as a solid', () => {
  const b = makeBarrel(100, 400);
  const wb = b.worldBox();
  assert.ok(approx(wb.x, 100));
  assert.ok(approx(wb.y, 400));
  assert.ok(approx(wb.w, 32));
  assert.ok(approx(wb.h, 48));
  // The SOLID bit is what the HERO×SOLID / ENEMY×SOLID resolve rules match.
  assert.ok((b.layer & LAYER.SOLID) === LAYER.SOLID);
});

console.log(`\n${passed} assertions passed.`);
