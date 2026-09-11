// Integration: barrel blocks hero via resolve() AND thorn hits barrel via CollisionWorld.
import { strict as assert } from 'node:assert';
import { LAYER } from '../consts.js';
import { Entity } from '../entity.js';
import { CollisionWorld, resolve } from '../collision.js';
import { makeBarrel, GameObj } from '../object.js';
import { Projectile } from '../projectile.js';

let passed = 0;
const ok = (n, f) => { try { f(); passed++; console.log('  ✓', n); } catch(e){ console.error('  ✗', n, '\n   ', e.message); process.exitCode=1; } };

// --- Barrel blocks hero (acceptance #1) -------------------------------------
ok('hero cannot pass a barrel (resolve pushes it out)', () => {
  const floor = { x: 0, y: 500, w: 2000, h: 40 };
  const barrel = makeBarrel(600, 500 - 48); // sits on floor, blocks at x 600..632
  const solids = [floor, barrel.worldBox()];
  // Hero standing just left of the barrel, moving right into it.
  const hero = new Entity({ x: 590, y: 500 - 48, w: 32, h: 48, gravity: 0, layer: LAYER.HERO });
  hero.vx = 250;
  // Simulate several steps pushing into the barrel.
  for (let i = 0; i < 20; i++) {
    hero.x += hero.vx * (1/60);
    resolve(hero, solids);
  }
  const hb = hero.worldBox();
  // Hero's right edge must NOT have penetrated past the barrel's left face.
  assert.ok(hb.x + hb.w <= barrel.x + 1, `hero right=${hb.x+hb.w} should be <= ${barrel.x}`);
});

// --- Thorn hits barrel via CollisionWorld (acceptance #2/#3) ------------------
ok('friendly thorn overlaps barrel → hit event fires (PROJ_ALLY×SOLID rule)', () => {
  const world = new CollisionWorld({ cellSize: 64 });
  const barrel = makeBarrel(600, 452);
  world.add(barrel);
  // A friendly thorn overlapping the barrel box.
  const p = new Projectile(600, 470, 0, true);
  world.add(p);
  let hitFired = false;
  world.on('hit', (a, b) => {
    if ((a === barrel || b === barrel) && (a === p || b === p)) hitFired = true;
  });
  world.update();
  assert.ok(hitFired, 'hit event fired between thorn and barrel');
});

// --- Full pipeline: 6 thorns destroy barrel (acceptance #2/#3) ---------------
ok('6 thorn hits (10 dmg each) destroy a 60hp barrel', () => {
  const barrel = makeBarrel(0, 0);
  for (let i = 0; i < 6; i++) barrel.hit(10, null, 'projectile');
  assert.equal(barrel.destroyed, true);
  assert.equal(barrel.alive, false);
});

console.log(`\n${passed} integration assertions passed.`);
