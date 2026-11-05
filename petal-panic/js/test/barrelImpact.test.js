// Rolling-barrel impact tests: a knocked barrel that is moving fast enough
// deals damage to overlapping enemies, knocks them back along its travel
// direction, and loses momentum per impact (declaration of impact).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

const ctx2d = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : () => {}), set: () => true });
global.document = { createElement: () => ({ getContext: () => ctx2d }), addEventListener: () => {} };
global.window = { addEventListener: () => {}, innerWidth: 1280, innerHeight: 720 };

const U = await import('../systems/update.js');
const { GameObj } = await import('../objects/object.js');
const { Enemy } = await import('../enemies/enemy.js');

function makeBarrel(x, y, vx) {
  const b = new GameObj({ id: 'test_barrel', w: 32, h: 48, hp: 60 }, x, y);
  b.vx = vx;
  return b;
}

function makeEnemy(x, y) {
  const e = new Enemy({
    id: 'test_foe', name: 'Test Foe', w: 30, h: 40, aggroRadius: 200,
    stats: { weight: 1, speed: 100, attack: 5, defense: 0, stamina: 50, fly: false },
  }, x, y);
  return e;
}

test('fast barrel overlapping an enemy deals damage and slows down', async () => {
  const barrel = makeBarrel(0, 0, 400);
  const enemy = makeEnemy(10, 10);
  U.realEnemies.length = 0;
  U.realEnemies.push(enemy);

  const hpBefore = enemy.hp;
  U.barrelImpactSweep(barrel);

  assert.ok(enemy.hp < hpBefore, `enemy took damage (${hpBefore} -> ${enemy.hp})`);
  assert.ok(Math.abs(barrel.vx) < 400, 'barrel lost momentum');
  assert.ok(enemy.vx > 0, 'enemy knocked back in barrel travel direction (+x)');
});

test('slow barrel does not impact (below speed threshold)', () => {
  const barrel = makeBarrel(0, 0, 50); // < 120 px/s
  const enemy = makeEnemy(10, 10);
  U.realEnemies.length = 0;
  U.realEnemies.push(enemy);

  const hpBefore = enemy.hp;
  U.barrelImpactSweep(barrel);

  assert.equal(enemy.hp, hpBefore, 'no damage below threshold');
  assert.equal(enemy.vx, 0, 'no knockback below threshold');
  assert.equal(barrel.vx, 50, 'barrel speed untouched');
});

test('impact cooldown prevents machine-gunning the same enemy every frame', () => {
  const barrel = makeBarrel(0, 0, 500);
  const enemy = makeEnemy(10, 10);
  U.realEnemies.length = 0;
  U.realEnemies.push(enemy);

  U.barrelImpactSweep(barrel);
  const hpAfterFirst = enemy.hp;
  // Same frame batch: second sweep must be suppressed by the cooldown.
  U.barrelImpactSweep(barrel);
  assert.equal(enemy.hp, hpAfterFirst, 'cooldown blocked the second hit');
});

test('leftward barrel knocks the enemy leftward', () => {
  const barrel = makeBarrel(100, 0, -400);
  const enemy = makeEnemy(90, 10);
  U.realEnemies.length = 0;
  U.realEnemies.push(enemy);

  U.barrelImpactSweep(barrel);

  assert.ok(enemy.vx < 0, `enemy knocked back -x (got vx=${enemy.vx})`);
  assert.ok(barrel.vx > -400, 'barrel slowed (momentum loss)');
});

test('dead enemies are skipped', () => {
  const barrel = makeBarrel(0, 0, 400);
  const enemy = makeEnemy(10, 10);
  enemy.aiState = 'dead';
  U.realEnemies.length = 0;
  U.realEnemies.push(enemy);

  U.barrelImpactSweep(barrel);

  assert.equal(enemy.hp, 50, 'dead enemy untouched');
  assert.equal(barrel.vx, 400, 'no momentum lost on dead target');
});
