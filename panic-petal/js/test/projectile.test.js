// Task 3.1 — node-based unit tests for Projectile + Pool + 8-way aim.
// Run: node js/test/projectile.test.js
// No DOM needed: entity.js / consts.js / projectile.js are pure modules.

import { strict as assert } from 'node:assert';
import {
  Projectile, Pool, projectilePool, MAX_PROJECTILES,
  dirAngle, aimFromInput,
} from '../projectile.js';
import { LAYER } from '../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('Projectile class');
ok('friendly → PROJ_ALLY layer', () => {
  const p = new Projectile(0, 0, 0, true);
  assert.equal(p.layer, LAYER.PROJ_ALLY);
});
ok('foe → PROJ_FOE layer', () => {
  const p = new Projectile(0, 0, 0, false);
  assert.equal(p.layer, LAYER.PROJ_FOE);
  assert.equal(p.friendly, false);
});
ok('size ~12px, gravity 0, speed 600, damage 10, life 2', () => {
  const p = new Projectile(0, 0, 0, true);
  assert.equal(p.w, 12);
  assert.equal(p.h, 12);
  assert.equal(p.gravity, 0);
  assert.equal(p.speed, 600);
  assert.equal(p.damage, 10);
  assert.equal(p.life, 2);
});

console.log('8-direction velocities (speed 600)');
// Expected unit vectors per dir index.
const EXPECTED = [
  [1, 0],      // 0 right
  [Math.SQRT1_2, -Math.SQRT1_2], // 1 up-right
  [0, -1],     // 2 up
  [-Math.SQRT1_2, -Math.SQRT1_2],// 3 up-left
  [-1, 0],     // 4 left
  [-Math.SQRT1_2, Math.SQRT1_2], // 5 down-left
  [0, 1],      // 6 down
  [Math.SQRT1_2, Math.SQRT1_2],  // 7 down-right
];
for (let d = 0; d < 8; d++) {
  ok(`dir ${d} velocity`, () => {
    const p = new Projectile(0, 0, d, true);
    assert.ok(approx(p.vx, EXPECTED[d][0] * 600), `vx=${p.vx} want ${EXPECTED[d][0]*600}`);
    assert.ok(approx(p.vy, EXPECTED[d][1] * 600), `vy=${p.vy} want ${EXPECTED[d][1]*600}`);
  });
}

console.log('aimFromInput');
ok('no input → facing (right)', () => assert.equal(aimFromInput({}, 1), 0));
ok('no input → facing (left)', () => assert.equal(aimFromInput({}, -1), 4));
ok('right', () => assert.equal(aimFromInput({ right: true }, 1), 0));
ok('left', () => assert.equal(aimFromInput({ left: true }, -1), 4));
ok('up', () => assert.equal(aimFromInput({ up: true }, 1), 2));
ok('down', () => assert.equal(aimFromInput({ down: true }, 1), 6));
ok('up+right', () => assert.equal(aimFromInput({ up: true, right: true }, 1), 1));
ok('up+left', () => assert.equal(aimFromInput({ up: true, left: true }, -1), 3));
ok('down+left', () => assert.equal(aimFromInput({ down: true, left: true }, -1), 5));
ok('down+right', () => assert.equal(aimFromInput({ down: true, right: true }, 1), 7));

console.log('Lifetime cull');
ok('dies after 2s of updates', () => {
  const p = new Projectile(0, 0, 0, true);
  assert.equal(p.alive, true);
  p.update(1);   // t=1
  assert.equal(p.alive, true);
  p.update(0.99); // t=1.99
  assert.equal(p.alive, true);
  p.update(0.02); // t=2.01
  assert.equal(p.alive, false);
});
ok('moves straight (no gravity drift)', () => {
  const p = new Projectile(0, 0, 0, true);
  p.update(0.5);
  assert.ok(approx(p.x, 300), `x=${p.x} want 300`);
  assert.ok(approx(p.y, 0), `y=${p.y} want 0`);
});

console.log('Object Pool');
ok('pool size == MAX_PROJECTILES (64)', () => {
  assert.equal(MAX_PROJECTILES, 64);
  assert.equal(projectilePool.items.length, 64);
});
ok('spawn reuses inactive slots, returns live item', () => {
  const pool = new Pool(Projectile, 4);
  const a = pool.spawn(10, 10, 0, true);
  assert.ok(a && a.alive);
  assert.equal(pool.count, 1);
  a.alive = false; pool.active.splice(0, 1); // kill it
  const b = pool.spawn(20, 20, 4, true);
  assert.equal(b, a); // same slot reused (no allocation)
  assert.equal(pool.count, 1);
});
ok('exhausted pool returns null (soft cap)', () => {
  const pool = new Pool(Projectile, 2);
  assert.ok(pool.spawn(0, 0, 0, true));
  assert.ok(pool.spawn(0, 0, 1, true));
  assert.equal(pool.spawn(0, 0, 2, true), null);
});
ok('updateAll ticks active and drops dead', () => {
  const pool = new Pool(Projectile, 4);
  const a = pool.spawn(0, 0, 0, true);
  const b = pool.spawn(0, 0, 4, true);
  pool.updateAll(2.5); // both exceed lifetime
  assert.equal(pool.count, 0);
  assert.equal(a.alive, false);
  assert.equal(b.alive, false);
});
ok('fire 100 shots → no allocation beyond pool, all reused', () => {
  const pool = new Pool(Projectile, 8);
  // Every spawned item must be one of the 8 pre-allocated slots (no new objects).
  const slots = new Set(pool.items);
  for (let i = 0; i < 100; i++) {
    const p = pool.spawn(i, i, i % 8, true);
    assert.ok(slots.has(p), `allocation outside pool at shot ${i}`);
    pool.updateAll(3); // cull everything so next spawn reuses a slot
  }
  assert.equal(pool.items.length, 8); // still exactly 8 objects
});
ok('shared projectilePool is pre-allocated once', () => {
  assert.equal(projectilePool.items.length, MAX_PROJECTILES);
  assert.equal(projectilePool.count, 0);
});

console.log(`\n${passed} assertions passed.`);
