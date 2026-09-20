// Petal Panic — generic explosion system (docs/architecture/explosion.md).
// Run: node js/test/explosion.test.js
//
// resolveExplosion() is the single blast resolver shared by every detonating
// source. These tests drive it directly with plain stand-in entities + a real
// Hero, using fixed inputs and exact values (within epsilon), to pin down:
//   * alignment filtering (foe / ally / neutral)
//   * self-exclusion
//   * i-frame absorption
//   * radial knockback direction for enemies
//   * hero behavior preservation (routed through takeHit('explosion'))

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';
import {
  resolveExplosion, isValidTarget, ALIGNMENT,
} from '../explosion.js';

let passed = 0;
const ok = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};
const EPS = 1e-9;
const close = (a, b) => Math.abs(a - b) < EPS;

/** A real hero at rest, not intangible. */
const mkHero = () => new Hero(HEROES.scarlet, 0, 0);

/** Minimal enemy stand-in carrying what resolveExplosion reads/writes. */
function mkEnemy(x, y, hp = 30) {
  const e = {
    x, y, w: 40, h: 40,
    alive: true,
    hp, maxHp: hp,
    energy: undefined,          // enemies use hp, not energy
    defense: 0,                 // no mitigation → damage lands raw
    vx: 0, vy: 0,
    hitstunTimer: 0, iFrameTimer: 0,
    knockbackResist: 1,
    bodyKnockback: { base: 260, scaleBySpeed: 1.0, hitstun: 0.25, iFrames: 0.60 },
    takeDamage(amt, _source, _method) {
      if (!this.alive) return 0;
      const real = Math.max(1, amt - this.defense);
      this.hp -= real;
      if (this.hp <= 0) this.alive = false;
      return real;
    },
  };
  return e;
}

const KB = { base: 380, scaleBySpeed: 0, hitstun: 0.30, iFrames: 0.60, dirMode: 'radial', pop: 60 };

/** A plain non-null detonator stand-in (no combatStats — damage() tolerates that). */
const DETONATOR = { x: 0, y: 0, w: 40, h: 40, alive: true, type: 'detonator' };

console.log('Generic explosion system (resolveExplosion)');

// ============================================================================
// NEUTRAL — hurts BOTH hero and enemy, shoves both radially.
// ============================================================================
ok('neutral explosion damages BOTH hero and enemy, shoves both radially', () => {
  const hero = mkHero();            // center (16, 24)
  const enemy = mkEnemy(100, 0);    // center (120, 20)
  // Blast centered at (60, 20), radius 200 → both in range.
  const exp = { cx: 60, cy: 20, radius: 200, damage: 25, alignment: ALIGNMENT.NEUTRAL, knockback: KB, self: DETONATOR, ctx: { hero } };
  const beforeHero = hero.energy;
  const beforeEnemy = enemy.hp;
  const result = resolveExplosion(exp, [hero, enemy]);

  assert.ok(result.hit.includes(hero), 'hero damaged');
  assert.ok(result.hit.includes(enemy), 'enemy damaged');
  assert.ok(beforeHero - hero.energy > 0, 'hero lost energy');
  assert.equal(beforeEnemy - enemy.hp, 25, 'enemy (defense 0) took raw 25');
});

// NOTE: scarlet's defense is 2, so damage() floors real = max(1, 25-2) = 23.
// Re-pin the neutral test against the ACTUAL hero defense to stay exact.
ok('neutral explosion: hero damage respects hero defense, enemy takes raw', () => {
  const hero = mkHero();
  const enemy = mkEnemy(100, 0);
  const exp = { cx: 60, cy: 20, radius: 200, damage: 25, alignment: ALIGNMENT.NEUTRAL, knockback: KB, self: DETONATOR, ctx: { hero } };
  const heroDef = hero.stats?.defense ?? 0;
  const beforeHero = hero.energy;
  const beforeEnemy = enemy.hp;
  resolveExplosion(exp, [hero, enemy]);
  assert.equal(beforeHero - hero.energy, Math.max(1, 25 - heroDef), 'hero drained by post-defense amount');
  assert.equal(beforeEnemy - enemy.hp, 25, 'enemy (defense 0) drained raw 25');
});

ok('neutral explosion shoves the enemy radially away from center', () => {
  const enemy = mkEnemy(160, 0);   // center (180, 20)
  const exp = { cx: 60, cy: 20, radius: 200, damage: 25, alignment: ALIGNMENT.NEUTRAL, knockback: KB, self: DETONATOR, ctx: {} };
  resolveExplosion(exp, [enemy]);
  // Normal from center (60,20) to enemy center (180,20) = (1, 0).
  // mag = base/resist = 380/1 = 380 along +x; pop adds -60 to vy.
  assert.ok(close(enemy.vx, 380), `vx=${enemy.vx}, expected 380`);
  assert.ok(close(enemy.vy, -60), `vy=${enemy.vy}, expected -60 (pop)`);
  assert.ok(close(enemy.hitstunTimer, 0.30), `hitstun=${enemy.hitstunTimer}`);
});

// ============================================================================
// FOE — damages the hero but NOT another enemy (the Jack-O-Lantern fix).
// ============================================================================
ok('foe explosion damages the hero but spares another enemy', () => {
  const hero = mkHero();           // center (16, 24)
  const otherEnemy = mkEnemy(40, 0); // center (60, 20) — an enemy, must be spared
  const exp = { cx: 30, cy: 20, radius: 200, damage: 22, alignment: ALIGNMENT.FOE, knockback: KB, self: DETONATOR, ctx: { hero } };
  const beforeHero = hero.energy;
  const beforeOther = otherEnemy.hp;
  const result = resolveExplosion(exp, [hero, otherEnemy]);

  assert.ok(result.hit.includes(hero), 'hero damaged by foe blast');
  assert.ok(!result.hit.includes(otherEnemy), 'other enemy spared (Jack fix)');
  assert.ok(beforeHero - hero.energy > 0, 'hero lost energy');
  assert.equal(otherEnemy.hp, beforeOther, 'other enemy HP unchanged');
  assert.equal(otherEnemy.vx, 0, 'other enemy not shoved');
});

// ============================================================================
// ALLY — damages the enemy but NOT the hero.
// ============================================================================
ok('ally explosion damages the enemy but spares the hero', () => {
  const hero = mkHero();
  const enemy = mkEnemy(40, 0);    // center (60, 20)
  const exp = { cx: 30, cy: 20, radius: 200, damage: 20, alignment: ALIGNMENT.ALLY, knockback: KB, self: DETONATOR, ctx: { hero } };
  const beforeHero = hero.energy;
  const beforeEnemy = enemy.hp;
  const result = resolveExplosion(exp, [hero, enemy]);

  assert.ok(result.hit.includes(enemy), 'enemy damaged by ally blast');
  assert.ok(!result.hit.includes(hero), 'hero spared by ally blast');
  assert.equal(hero.energy, beforeHero, 'hero energy unchanged');
  assert.equal(hero.vx, 0, 'hero not shoved');
  assert.ok(beforeEnemy - enemy.hp > 0, 'enemy lost hp');
});

// ============================================================================
// Self is never hit (any alignment).
// ============================================================================
ok('self (detonator) is never hit even when listed as a target', () => {
  // The detonator is an enemy stand-in placed at the blast center.
  const self = mkEnemy(0, 0);      // center (20, 20)
  const hero = mkHero();
  const exp = { cx: 20, cy: 20, radius: 200, damage: 25, alignment: ALIGNMENT.NEUTRAL, knockback: KB, self, ctx: { hero } };
  const beforeSelf = self.hp;
  const result = resolveExplosion(exp, [self, hero]);
  assert.ok(!result.hit.includes(self), 'self excluded from hits');
  assert.equal(self.hp, beforeSelf, 'self HP unchanged');
  assert.ok(result.hit.includes(hero), 'hero still hit');
});

ok('isValidTarget excludes self across all alignments', () => {
  const self = mkEnemy(0, 0);
  for (const al of [ALIGNMENT.FOE, ALIGNMENT.ALLY, ALIGNMENT.NEUTRAL]) {
    const exp = { cx: 0, cy: 0, radius: 200, damage: 1, alignment: al, self, ctx: {} };
    assert.equal(isValidTarget(exp, self, self), false, `${al}: self never valid`);
  }
});

// ============================================================================
// Intangible targets absorb the blast (no damage, no shove).
// ============================================================================
ok('intangible target absorbs the blast (no damage, no shove)', () => {
  const enemy = mkEnemy(40, 0);
  enemy.intangible = true;         // i-frames up
  const exp = { cx: 30, cy: 20, radius: 200, damage: 25, alignment: ALIGNMENT.NEUTRAL, knockback: KB, self: DETONATOR, ctx: {} };
  const beforeHp = enemy.hp;
  const result = resolveExplosion(exp, [enemy]);
  assert.equal(result.hit.length, 0, 'no hits recorded');
  assert.equal(enemy.hp, beforeHp, 'HP unchanged');
  assert.equal(enemy.vx, 0, 'not shoved');
  assert.equal(enemy.hitstunTimer, 0, 'no stun applied');
});

ok('intangible HERO absorbs the blast (takeHit guard, no double-fling)', () => {
  const hero = mkHero();
  hero.intangible = true;
  const exp = { cx: 60, cy: 20, radius: 200, damage: 25, alignment: ALIGNMENT.NEUTRAL, knockback: KB, self: DETONATOR, ctx: { hero } };
  const beforeEnergy = hero.energy;
  const result = resolveExplosion(exp, [hero]);
  assert.equal(result.hit.length, 0, 'hero absorbed');
  assert.equal(hero.energy, beforeEnergy, 'energy unchanged');
  assert.equal(hero.vx, 0, 'no knockback');
});

// ============================================================================
// Knockback direction is radial (away from center) for an enemy.
// ============================================================================
ok('enemy knockback points radially away from the blast center (diagonal)', () => {
  // Enemy center at (160, 120); blast center at (60, 20). Offset (100, 100).
  const enemy = mkEnemy(140, 100); // center (160, 120)
  const exp = { cx: 60, cy: 20, radius: 300, damage: 25, alignment: ALIGNMENT.NEUTRAL, knockback: KB, self: DETONATOR, ctx: {} };
  resolveExplosion(exp, [enemy]);
  const n = 1 / Math.SQRT2;        // normalized (1,1)/√2
  const mag = 380;                  // base / resist 1
  assert.ok(close(enemy.vx, n * mag), `vx=${enemy.vx}, expected ${(n * mag).toFixed(4)}`);
  // vy = n*mag (outward +y) minus pop 60.
  assert.ok(close(enemy.vy, n * mag - 60), `vy=${enemy.vy}, expected ${(n * mag - 60).toFixed(4)}`);
});

ok('enemy on the far side of the center is shoved the opposite way', () => {
  const enemy = mkEnemy(-60, 0);   // center (-40, 20); offset from (60,20) = (-100,0) → normal (-1,0)
  const exp = { cx: 60, cy: 20, radius: 200, damage: 25, alignment: ALIGNMENT.NEUTRAL, knockback: KB, self: DETONATOR, ctx: {} };
  resolveExplosion(exp, [enemy]);
  assert.ok(close(enemy.vx, -380), `vx=${enemy.vx}, expected -380`);
  assert.ok(close(enemy.vy, -60), `vy=${enemy.vy}, expected -60 (pop only)`);
});

// ============================================================================
// Out-of-range targets are untouched.
// ============================================================================
ok('target outside the radius is untouched', () => {
  const enemy = mkEnemy(500, 0);   // center (520, 20); dist from (60,20) = 460 > 200
  const exp = { cx: 60, cy: 20, radius: 200, damage: 25, alignment: ALIGNMENT.NEUTRAL, knockback: KB, self: DETONATOR, ctx: {} };
  const before = enemy.hp;
  const result = resolveExplosion(exp, [enemy]);
  assert.equal(result.hit.length, 0, 'nothing hit');
  assert.equal(enemy.hp, before, 'HP unchanged');
  assert.equal(enemy.vx, 0, 'not shoved');
});

// ============================================================================
// Hero behavior preservation: routed through takeHit('explosion').
// ============================================================================
ok('hero knocked back via takeHit("explosion") profile (strength 380, rec 0.30, iFrames 0.60)', () => {
  const hero = mkHero();
  // Hero center (16,24); blast center (116, 24) → dirX=-100, dirY=0 → normal (-1,0).
  // The blast is to the RIGHT of the hero, so it shoves the hero LEFT.
  const exp = { cx: 116, cy: 24, radius: 200, damage: 25, alignment: ALIGNMENT.NEUTRAL, knockback: KB, self: DETONATOR, ctx: { hero } };
  resolveExplosion(exp, [hero]);
  assert.ok(close(hero.vx, -380), `vx=${hero.vx}, expected -380`);
  assert.ok(close(hero.vy, 0), `vy=${hero.vy}, expected 0`);
  assert.ok(close(hero.timers.get('rec'), 0.30), `rec=${hero.timers.get('rec')}`);
  assert.ok(close(hero.timers.get('intangible'), 0.60), `intangible=${hero.timers.get('intangible')}`);
  assert.equal(hero.intangible, true, 'hero intangible after blast');
});

// Dead targets are skipped.
ok('dead target is skipped', () => {
  const enemy = mkEnemy(40, 0);
  enemy.alive = false;
  const exp = { cx: 30, cy: 20, radius: 200, damage: 25, alignment: ALIGNMENT.NEUTRAL, knockback: KB, self: DETONATOR, ctx: {} };
  const result = resolveExplosion(exp, [enemy]);
  assert.equal(result.hit.length, 0, 'dead target not hit');
});

console.log(`\n${passed} passed`);
