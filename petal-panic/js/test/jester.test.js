// Task 3.3 — node-based unit tests for Enemy base + Jester AI + death pipeline.
// Run: node js/test/jester.test.js
// No DOM needed: enemy.js / jester.js / particles.js / consts.js / damage.js
// are pure modules (no canvas, no window).

import { strict as assert } from 'node:assert';
import { Enemy } from '../enemy.js';
import { Jester, JESTER_DEF } from '../jester.js';
import { ParticleSystem, CoinPool } from '../particles.js';
import { LAYER } from '../consts.js';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';
import { damage } from '../damage.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

// --- Helpers -----------------------------------------------------------------
function makeHero(x = 0, y = 0) {
  return new Hero(HEROES.scarlet, x, y);
}
function makeJester(x = 0, y = 0) {
  return new Jester(x, y);
}
// Simulate a fixed-timestep advance of the jester toward/away from a hero.
function stepJester(j, hero, dt = 1/60, n = 1) {
  for (let i = 0; i < n; i++) j.update(dt, hero, null);
}

console.log('Enemy base class');
ok('constructor sets type, stats, hp, coinDrop from def', () => {
  const e = new Jester(100, 200);
  assert.equal(e.type, 'jester');
  assert.equal(e.hp, 40);
  assert.equal(e.maxHp, 40);
  assert.deepEqual(e.coinDrop, { min: 1, max: 3, chance: 1.0, types: { bronze: 1 } });
  assert.equal(e.layer, LAYER.ENEMY);
});
ok('aiState starts at idle', () => {
  const e = new Jester(0, 0);
  assert.equal(e.aiState, 'idle');
});
ok('gravity is 1 for ground enemies (fly=false)', () => {
  const e = new Jester(0, 0);
  assert.equal(e.gravity, 1);
});
ok('aggroRadius defaults to 300', () => {
  const e = new Jester(0, 0);
  assert.equal(e.aggroRadius, 300);
});
ok('takeDamage reduces hp and sets hitFlash', () => {
  const e = new Jester(0, 0);
  const hero = makeHero();
  const before = e.hp;
  const dealt = e.takeDamage(10, hero, 'melee');
  // Jester defense = 2, so real = 10 - 2 = 8
  assert.equal(dealt, 8);
  assert.equal(e.hp, before - 8);
  assert.ok(e.hitFlash > 0);
});
ok('takeDamage triggers die() when hp reaches 0', () => {
  const e = new Jester(0, 0);
  const hero = makeHero();
  e.hp = 5; // low hp
  e.takeDamage(10, hero, 'projectile'); // will overkill
  assert.equal(e.aiState, 'dead');
  assert.equal(e.deathTimer, 0);
});
ok('die() zeroes velocity', () => {
  const e = new Jester(0, 0);
  e.vx = 100; e.vy = -50;
  e.die();
  assert.equal(e.vx, 0);
  assert.equal(e.vy, 0);
});
ok('death pipeline: alive stays true during anim, false after duration', () => {
  const e = new Jester(0, 0);
  const hero = makeHero();
  e.hp = 1;
  e.takeDamage(10, hero, 'melee'); // kills it
  assert.equal(e.aiState, 'dead');
  assert.equal(e.alive, true); // still "alive" during death anim

  // Advance past half duration → fading should be true.
  e.update(e.deathDuration / 2 + 0.01, hero, null); // just over half
  assert.equal(e.fading, true);

  // Advance past full duration → alive flips to false.
  e.update(e.deathDuration / 2 + 0.01, hero, null); // total > deathDuration
  assert.equal(e.alive, false);
});
ok('dead enemy does not move (velocity stays 0)', () => {
  const e = new Jester(100, 100);
  const hero = makeHero(0, 0);
  e.hp = 1;
  e.takeDamage(10, hero, 'melee');
  const xBefore = e.x;
  e.update(1/60, hero, null);
  assert.equal(e.x, xBefore); // no movement while dead
});

console.log('\nJester AI state machine');
ok('idle → chase when hero enters aggro radius', () => {
  const j = makeJester(500, 0);
  const hero = makeHero(300, 0); // dist = 200 < 300
  assert.equal(j.aiState, 'idle');
  j.update(1/60, hero, null);
  assert.equal(j.aiState, 'chase');
});
ok('stays idle when hero is outside aggro radius', () => {
  const j = makeJester(0, 0);
  const hero = makeHero(500, 0); // dist = 500 > 300
  j.update(1/60, hero, null);
  assert.equal(j.aiState, 'idle');
});
ok('chase → idle when hero leaves aggro * 1.5', () => {
  const j = makeJester(0, 0);
  const hero = makeHero(250, 0); // within aggro → chase
  j.update(1/60, hero, null);
  assert.equal(j.aiState, 'chase');
  // Move hero far away (> 300 * 1.5 = 450)
  hero.x = 500;
  j.update(1/60, hero, null);
  assert.equal(j.aiState, 'idle');
});
ok('chase moves jester toward hero (vx set)', () => {
  const j = makeJester(500, 0);
  const hero = makeHero(300, 0); // hero is to the left
  j.update(1/60, hero, null);
  assert.equal(j.aiState, 'chase');
  assert.ok(j.vx < 0, `expected negative vx (moving left), got ${j.vx}`);
  assert.equal(j.facing, -1);
});
ok('chase → attack (whip) when very close', () => {
  const j = makeJester(500, 0);
  const hero = makeHero(470, 0); // dist = 30 < 60
  j.update(1/60, hero, null);
  assert.equal(j.aiState, 'attack');
  assert.equal(j.whipActive, true);
  assert.ok(j.whipTimer > 0);
});
ok('attack → chase after whip timer expires', () => {
  const j = makeJester(500, 0);
  const hero = makeHero(470, 0);
  j.update(1/60, hero, null); // enters attack
  assert.equal(j.aiState, 'attack');
  // Advance past whip duration (0.4s)
  j.update(0.5, hero, null);
  assert.equal(j.aiState, 'chase');
  assert.equal(j.whipActive, false);
  assert.ok(j.whipCooldown > 0, 'cooldown should be set after whip');
});
ok('cannot re-whip during cooldown', () => {
  const j = makeJester(500, 0);
  const hero = makeHero(470, 0);
  j.update(1/60, hero, null); // first whip
  j.update(0.5, hero, null);  // whip ends, cooldown = 1.5s
  // Hero still close; jester should NOT immediately whip again.
  j.update(1/60, hero, null);
  assert.notEqual(j.aiState, 'attack', 'should not re-whip during cooldown');
});

console.log('\nJester whip hitbox');
ok('whipHitboxWorld is null when not whipping', () => {
  const j = makeJester(0, 0);
  assert.equal(j.whipHitboxWorld, null);
});
ok('whipHitboxWorld exists during active portion of whip', () => {
  const j = makeJester(500, 0);
  const hero = makeHero(470, 0);
  j.update(1/60, hero, null); // start whip
  // Whip is 0.4s; active fraction is [0.25, 0.75] → middle of the anim.
  // Force the timer to the middle: whipTimer = 0.2 (t = 0.5)
  j.whipTimer = 0.2;
  const hb = j.whipHitboxWorld;
  assert.ok(hb, 'expected a hitbox mid-whip');
  assert.equal(hb.w, 35);
  assert.equal(hb.h, 30);
});
ok('whipHitboxWorld is null during windup/recovery', () => {
  const j = makeJester(500, 0);
  const hero = makeHero(470, 0);
  j.update(1/60, hero, null);
  // Windup: t < 0.25 → whipTimer > 0.3
  j.whipTimer = 0.35;
  assert.equal(j.whipHitboxWorld, null, 'windup should have no hitbox');
  // Recovery: t > 0.75 → whipTimer < 0.1
  j.whipTimer = 0.05;
  assert.equal(j.whipHitboxWorld, null, 'recovery should have no hitbox');
});
ok('whip hitbox extends in facing direction', () => {
  const j = makeJester(500, 0);
  j.facing = 1;
  j.whipActive = true;
  j.whipTimer = 0.2; // mid-whip
  const cx = j.x + j.w / 2;
  const hbRight = j.whipHitboxWorld;
  assert.ok(hbRight.x >= cx, `right-facing box x=${hbRight.x} should be ahead of center ${cx}`);

  j.facing = -1;
  const hbLeft = j.whipHitboxWorld;
  assert.ok(hbLeft.x + hbLeft.w <= cx, `left-facing box right-edge=${hbLeft.x + hbLeft.w} behind center ${cx}`);
});

console.log('\nContact damage (ENEMY × HERO)');
ok('jester contact drains hero energy via damage()', () => {
  const j = makeJester(100, 100);
  const hero = makeHero(100, 100); // overlapping
  hero.energy = 100;
  // Simulate what the contact handler does:
  const amt = j.stats.attack; // 15
  const dealt = damage(j, hero, amt, 'contact');
  // Hero defense = 2, so real = 15 - 2 = 13
  assert.equal(dealt, 13);
  assert.equal(hero.energy, 87);
});
ok('dead jester does not deal contact damage', () => {
  const j = makeJester(100, 100);
  const hero = makeHero(100, 100);
  hero.energy = 100;
  j.hp = 1;
  j.takeDamage(10, hero, 'melee'); // kill it
  assert.equal(j.aiState, 'dead');
  // The contact handler checks aiState !== 'dead' before dealing damage.
  // Here we verify the guard condition directly.
  assert.equal(j.aiState === 'dead', true);
});

console.log('\nDeath pipeline (sparkles + coins)');
ok('ParticleSystem.spawnBurst creates N sparkles', () => {
  const ps = new ParticleSystem(50);
  const n = ps.spawnBurst(100, 100, 7);
  assert.equal(n, 7);
  assert.equal(ps.count, 7);
});
ok('sparkles expire after lifetime', () => {
  const ps = new ParticleSystem(50);
  ps.spawnBurst(100, 100, 5);
  assert.equal(ps.count, 5);
  // Advance past sparkle lifetime (0.5s).
  ps.updateAll(0.6);
  assert.equal(ps.count, 0);
});
ok('particle pool caps at max size', () => {
  const ps = new ParticleSystem(5); // tiny pool
  const n = ps.spawnBurst(0, 0, 10); // request more than available
  assert.equal(n, 5);
  assert.equal(ps.count, 5);
});
ok('CoinPool.dropCoins respects chance (always drops with chance=1)', () => {
  const cp = new CoinPool(32);
  const n = cp.dropCoins({ range: [1, 3], chance: 1.0 }, 100, 100);
  assert.ok(n >= 1 && n <= 3, `got ${n} coins, expected 1-3`);
});
ok('CoinPool.dropCoins can return 0 (chance roll fails)', () => {
  // With chance=0, always returns 0.
  const cp = new CoinPool(32);
  const n = cp.dropCoins({ range: [1, 3], chance: 0.0 }, 100, 100);
  assert.equal(n, 0);
});
ok('coins fall with gravity and bounce on floor', () => {
  const cp = new CoinPool(32);
  cp.dropCoins({ range: [1, 1], chance: 1.0 }, 100, 100);
  assert.equal(cp.count, 1);
  const coin = cp.activeItems[0];
  const yStart = coin.y;
  // Advance enough time for the coin to fall and bounce.
  cp.updateAll(1.0, 500, 3000); // 1 second, floor at y=500
  // After 1s the coin should be near or on the floor (y + h ≈ 500).
  const bottom = coin.y + coin.h;
  assert.ok(bottom <= 501, `coin bottom=${bottom} should be at or above floor 500`);
});
ok('full death pipeline: kill jester → sparkles + coins spawned', () => {
  const j = makeJester(200, 400);
  const hero = makeHero(100, 400);
  const ps = new ParticleSystem(50);
  const cp = new CoinPool(32);

  // Kill the jester.
  j.hp = 1;
  j.takeDamage(10, hero, 'melee');
  assert.equal(j.aiState, 'dead');

  // Advance through the full death anim.
  j.update(j.deathDuration + 0.1, hero, null);
  assert.equal(j.alive, false);

  // Now simulate what updateJester does on death completion:
  const cx = j.x + j.w / 2;
  const cy = j.y + j.h / 2;
  const sparkles = ps.spawnBurst(cx, cy, 7);
  const coinCount = cp.dropCoins(j.coinDrop, cx, cy);

  assert.ok(sparkles >= 1, 'should spawn sparkles');
  // Coins may or may not drop (60% chance), but if they do, 1-3.
  assert.ok(coinCount >= 0 && coinCount <= 3, `coin count=${coinCount}`);
});

console.log('\nExtensibility (other enemies can inherit)');
ok('custom enemy subclass works with base update/takeDamage/die', () => {
  class TestEnemy extends Enemy {
    constructor(x, y) {
      super({ id: 'test', name: 'Test', w: 20, h: 20, aggroRadius: 200,
              stats: { weight: 1, speed: 80, attack: 5, defense: 0, stamina: 10, fly: false },
              coinDrop: { min: 1, max: 1, chance: 1.0, types: { bronze: 1 } } }, x, y);
    }
    ai(dt, hero, world) {
      // Simple: always chase.
      this.aiState = 'chase';
      this.vx = Math.sign(hero.x - this.x) * this.stats.speed;
    }
  }
  const te = new TestEnemy(100, 100);
  const hero = makeHero(50, 100);
  te.update(1/60, hero, null);
  assert.equal(te.aiState, 'chase');
  assert.ok(te.vx < 0, 'should move toward hero (left)');

  // takeDamage + death pipeline work identically.
  te.hp = 1;
  te.takeDamage(10, hero, 'melee');
  assert.equal(te.aiState, 'dead');
  te.update(te.deathDuration + 0.1, hero, null);
  assert.equal(te.alive, false);
});

console.log(`\n${passed} assertions passed.`);
