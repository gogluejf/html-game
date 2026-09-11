// Task 3.2 — node-based unit tests for melee swing + central damage routing.
// Run: node js/test/melee.test.js
// No DOM needed: entity.js / consts.js / hero.js / damage.js are pure modules.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';
import { LAYER } from '../consts.js';
import { Entity } from '../entity.js';
import { damage } from '../damage.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// --- Helpers -----------------------------------------------------------------
function makeHero() {
  return new Hero(HEROES.scarlet, 0, 0); // attack 10, defense 2
}
function makeEnemy(x, y, hp = 20, def = 0) {
  const e = new Entity({ x, y, w: 36, h: 40, gravity: 0, layer: LAYER.ENEMY });
  e.hp = hp; e.maxHp = hp; e.type = 'target';
  if (def > 0) e.defense = def; // explicit defense override (placeholder target)
  return e;
}
// Advance a swing to a specific integer frame index without running update().
function setSwingFrame(h, idx) {
  h.meleeActive = true;
  h.meleeFrame = idx;
}

console.log('Melee state init');
ok('default: no active swing, zero cooldown', () => {
  const h = makeHero();
  assert.equal(h.meleeActive, false);
  assert.equal(h.meleeCooldown, 0);
  assert.equal(h.meleeHitboxWorld, null);
});
ok('swing constants per spec', () => {
  const h = makeHero();
  assert.equal(h.MELEE_TOTAL_FRAMES, 5);
  assert.equal(h.MELEE_ACTIVE_FRAME, 3);
  assert.ok(approx(h.MELEE_FRAME_DURATION, 0.08));
  assert.deepEqual(h.meleeHitbox, { ox: 20, oy: -10, bw: 40, bh: 40 });
});

console.log('tryMelee / cooldown');
ok('tryMelee starts a swing and sets full cooldown', () => {
  const h = makeHero();
  h.tryMelee();
  assert.equal(h.meleeActive, true);
  assert.ok(approx(h.meleeCooldown, 5 * 0.08), `cd=${h.meleeCooldown}`);
});
ok('cannot re-swing while active (no spam)', () => {
  const h = makeHero();
  h.tryMelee();
  const cdBefore = h.meleeCooldown;
  h.tryMelee(); // ignored
  assert.ok(approx(h.meleeCooldown, cdBefore));
  assert.equal(h.meleeFrame, 0); // still at start of first swing
});
ok('cooldown decrements over time via updateMelee', () => {
  const h = makeHero();
  h.tryMelee();
  h.updateMelee(0.1);
  assert.ok(h.meleeCooldown < 0.4 && h.meleeCooldown > 0);
});

console.log('active-frame window (acceptance #1)');
ok('hitbox is null on windup frames 0-2', () => {
  const h = makeHero();
  for (const f of [0, 1, 2]) {
    setSwingFrame(h, f);
    assert.equal(h.meleeHitboxWorld, null, `frame ${f} should be null`);
  }
});
ok('hitbox is null on recovery frame 4', () => {
  const h = makeHero();
  setSwingFrame(h, 4);
  assert.equal(h.meleeHitboxWorld, null);
});
ok('hitbox exists ONLY on active frame 3', () => {
  const h = makeHero();
  setSwingFrame(h, 3);
  const hb = h.meleeHitboxWorld;
  assert.ok(hb, 'expected a box on frame 3');
  assert.equal(hb.w, 40);
  assert.equal(hb.h, 40);
});
ok('hitbox flips with facing (left vs right)', () => {
  const h = makeHero();
  h.x = 100; h.y = 100; h.facing = 1;
  setSwingFrame(h, 3);
  const right = { ...h.meleeHitboxWorld };
  h.facing = -1;
  const left = { ...h.meleeHitboxWorld };
  // Facing right: box starts ahead of center (x > center).
  const cx = h.x + h.w / 2;
  assert.ok(right.x >= cx, `right box x=${right.x} should be ahead of center ${cx}`);
  // Facing left: box extends backward (x < center).
  assert.ok(left.x + left.w <= cx, `left box right-edge=${left.x + left.w} behind center ${cx}`);
  assert.notEqual(right.x, left.x, 'facing must move the box');
});
ok('hitbox null when not swinging at all', () => {
  const h = makeHero();
  h.meleeActive = false;
  assert.equal(h.meleeHitboxWorld, null);
});
ok('updateMelee ends the swing after total frames', () => {
  const h = makeHero();
  h.tryMelee();
  h.updateMelee(5 * 0.08 + 0.01); // run past the end
  assert.equal(h.meleeActive, false);
  assert.equal(h.meleeFrame, 0);
  assert.equal(h.meleeHitboxWorld, null);
});

console.log('central damage() — defense + telemetry (acceptance #2)');
ok('reduces by target defense override, floors at 1', () => {
  const src = makeHero(); // attack 10, own defense 2
  const tgt = makeEnemy(0, 0, 100, 4); // explicit defense override = 4
  const real = damage(src, tgt, 10, 'melee');
  assert.equal(real, 6, `real=${real} want 10-4`);
  assert.equal(tgt.hp, 94);
});
ok('minimum 1 damage even when defense >= attack', () => {
  const src = makeHero();
  const tgt = makeEnemy(0, 0, 100, 50);
  const real = damage(src, tgt, 10, 'melee');
  assert.equal(real, 1);
  assert.equal(tgt.hp, 99);
});
ok('no defense → full raw amount', () => {
  const src = makeHero();
  const tgt = makeEnemy(0, 0, 100, 0);
  const real = damage(src, tgt, 10, 'projectile');
  assert.equal(real, 10);
});
ok('hero vs hero: target defense DOES reduce incoming damage', () => {
  // Hero B has stats.defense = 2 (from scarlet def). When hero A deals 10 raw,
  // B's defense mitigates it to 8. This is correct: defense protects the target.
  const a = makeHero();
  const b = makeHero();
  b.energy = 100;
  const real = damage(a, b, 10, 'contact');
  assert.equal(real, 8, `expected 8 (10 - target def 2), got ${real}`);
  assert.equal(b.energy, 92);
});
ok('updates source telemetry (hitsLanded + byMethod + byEnemy)', () => {
  const src = makeHero();
  src.combatStats = { hitsLanded: {}, damageDealt: { byMethod: {}, byEnemy: {} } };
  const tgt = makeEnemy(0, 0, 100, 0);
  damage(src, tgt, 10, 'melee');
  damage(src, tgt, 10, 'melee');
  assert.equal(src.combatStats.hitsLanded.melee, 2);
  assert.equal(src.combatStats.damageDealt.byMethod.melee, 20);
  assert.equal(src.combatStats.damageDealt.byEnemy.target, 20);
});
ok('drains hero energy (not hp) for hero targets', () => {
  const src = makeHero();
  const heroTgt = makeHero();
  heroTgt.energy = 100;
  // Hero target has stats.defense = 2, so 10 raw → 8 real.
  const real = damage(src, heroTgt, 10, 'contact');
  assert.equal(real, 8);
  assert.equal(heroTgt.energy, 92);
});
ok('returns 0 and does nothing if target already dead', () => {
  const src = makeHero();
  const tgt = makeEnemy(0, 0, 100, 0);
  tgt.alive = false;
  const before = tgt.hp;
  const real = damage(src, tgt, 10, 'melee');
  assert.equal(real, 0);
  assert.equal(tgt.hp, before);
});
ok('flags alive=false when HP drops to <= 0', () => {
  const src = makeHero();
  const tgt = makeEnemy(0, 0, 5, 0);
  damage(src, tgt, 10, 'melee');
  assert.equal(tgt.alive, false);
});
ok('works with no combatStats on source (no crash)', () => {
  const src = makeEnemy(0, 0, 100, 0); // enemy source, no combatStats
  const tgt = makeEnemy(0, 0, 100, 0);
  const real = damage(src, tgt, 7, 'melee');
  assert.equal(real, 7);
});

console.log('\nMelee + damage integration');
ok('melee attack value routes through damage() to kill a target', () => {
  const h = makeHero();
  h.combatStats = { hitsLanded: {}, damageDealt: { byMethod: {}, byEnemy: {} } };
  const e = makeEnemy(0, 0, 20, 0); // 20hp, hero attack 10 → 2 swings
  // Simulate two active-frame hits.
  setSwingFrame(h, 3);
  const hb = h.meleeHitboxWorld;
  assert.ok(hb);
  const dealt1 = damage(h, e, h.stats.attack, 'melee');
  assert.equal(dealt1, 10);
  assert.equal(e.alive, true);
  const dealt2 = damage(h, e, h.stats.attack, 'melee');
  assert.equal(dealt2, 10);
  assert.equal(e.alive, false);
  assert.equal(h.combatStats.hitsLanded.melee, 2);
});

console.log(`\n${passed} assertions passed.`);
