// Task 5.1 — node-based unit tests for the remaining enemy AIs.
// Run: node js/test/enemies51.test.js
// No DOM needed: the four enemy modules + their deps (enemy/entity/consts/
// damage/projectile) are pure (no canvas, no window).

import { strict as assert } from 'node:assert';
import { Enemy } from '../enemy.js';
import { LAYER } from '../consts.js';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';
import { VineHound, VINE_HOUND_DEF } from '../vine_hound.js';
import { Violetta, VIOLETTA_DEF } from '../violetta.js';
import { JackOLantern, JACKO_DEF, explodeJackolantern } from '../jackolantern.js';
import { BorisLoon, BORIS_DEF, BORIS_BABY_DEF, makeBoris, makeBorisBaby } from '../boris_loon.js';
import { projectilePool } from '../projectile.js';
import { damage } from '../damage.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 0.5) => Math.abs(a - b) < eps;
function makeHero(x = 0, y = 0) { return new Hero(HEROES.scarlet, x, y); }
function step(e, hero, dt = 1/60, n = 1) { for (let i = 0; i < n; i++) e.update(dt, hero, null); }

// ===========================================================================
console.log('Vine Hound');
ok('constructor: type/hp/gravity from def', () => {
  const v = new VineHound(0, 0);
  assert.equal(v.type, 'vine_hound');
  assert.equal(v.hp, 35);
  assert.equal(v.gravity, 1, 'ground enemy → gravity 1');
  assert.equal(v.layer, LAYER.ENEMY);
});
ok('faster than jester (speed 180)', () => {
  assert.ok(VINE_HOUND_DEF.stats.speed > 120, `speed=${VINE_HOUND_DEF.stats.speed}`);
});
ok('idle → chase when hero in aggro radius', () => {
  const v = new VineHound(500, 0);
  const hero = makeHero(300, 0); // dist 200 < 320
  v.update(1/60, hero, null);
  assert.equal(v.aiState, 'chase');
});
ok('chase moves toward hero at full speed', () => {
  const v = new VineHound(500, 0);
  const hero = makeHero(300, 0);
  v.update(1/60, hero, null);
  assert.ok(Math.abs(v.vx) === 180, `vx=${v.vx}`);
  assert.ok(v.vx < 0, 'moving left toward hero');
});
ok('chase → lunge when adjacent (<50px) with cooldown ready', () => {
  const v = new VineHound(500, 0);
  const hero = makeHero(470, 0); // dist 30 < 50
  v.update(1/60, hero, null);
  assert.equal(v.aiState, 'lunge');
  assert.equal(v.lungeActive, true);
});
ok('lunge hitbox active mid-lunge, null on windup/recover', () => {
  const v = new VineHound(500, 0);
  const hero = makeHero(470, 0);
  v.update(1/60, hero, null);
  v.lungeTimer = 0.175; // t=0.5 → within [0.1,0.7]
  assert.ok(v.lungeHitboxWorld, 'hitbox present mid-lunge');
  v.lungeTimer = 0.32;  // t≈0.09 → windup
  assert.equal(v.lungeHitboxWorld, null, 'no hitbox during windup');
});
ok('lunge → recover → chase, sets lungeCooldown', () => {
  const v = new VineHound(500, 0);
  const hero = makeHero(470, 0);
  v.update(1/60, hero, null); // lunge
  v.update(0.4, hero, null);  // past lunge duration → recover
  assert.equal(v.aiState, 'recover');
  v.update(0.4, hero, null);  // past recover → chase + cooldown set
  assert.equal(v.aiState, 'chase');
  assert.ok(v.lungeCooldown > 0, 'cooldown set after lunge');
});
ok('cannot re-lunge during cooldown', () => {
  const v = new VineHound(500, 0);
  const hero = makeHero(470, 0);
  v.update(1/60, hero, null);
  v.update(0.4, hero, null);
  v.update(0.4, hero, null); // now in chase with cooldown ~1.2s
  v.update(1/60, hero, null); // still close but on cooldown
  assert.notEqual(v.aiState, 'lunge', 'should not re-lunge during cooldown');
});
ok('inherits Enemy cleanly (takeDamage/die/death pipeline)', () => {
  const v = new VineHound(0, 0);
  const hero = makeHero(0, 0);
  v.hp = 1;
  v.takeDamage(10, hero, 'melee');
  assert.equal(v.aiState, 'dead');
  v.update(0.7, hero, null);
  assert.equal(v.alive, false);
});

// ===========================================================================
console.log('\nVioletta Marionetta');
ok('constructor: type/hp/gravity/projectile flag', () => {
  const v = new Violetta(0, 0);
  assert.equal(v.type, 'violetta_marionetta');
  assert.equal(v.hp, 45);
  assert.equal(v.gravity, 1);
  assert.equal(v.def.stats.projectile, true);
});
ok('idle → pace when hero in aggro radius', () => {
  const v = new Violetta(500, 0);
  const hero = makeHero(300, 0);
  v.update(1/60, hero, null);
  assert.equal(v.aiState, 'pace');
});
ok('paces back and forth within corridor around spawnX', () => {
  const v = new Violetta(1000, 0);
  const hero = makeHero(960, 0); // dist 40 < aggro 340; stays in aggro
  v.paceDir = 1;
  // Walk right until it hits the right edge, then direction flips.
  let flipped = false;
  for (let i = 0; i < 200 && !flipped; i++) {
    v.update(1/60, hero, null);
    if (v.paceDir === -1) flipped = true;
  }
  assert.ok(flipped, 'direction should flip at corridor edge');
  // And stays within corridor bounds.
  assert.ok(v.x >= 1000 - 140 - 1 && v.x <= 1000 + 140 + 1, `x=${v.x.toFixed(1)}`);
});
ok('fires a projectile every ~2s when hero in line of sight', () => {
  const v = new Violetta(500, 0);
  const hero = makeHero(300, 0); // same y, in LOS, in range
  v.projectileTimer = 1.99; // about to fire
  const before = projectilePool.count;
  v.update(1/60, hero, null);
  assert.ok(projectilePool.count > before, `expected a shot (pool ${before}→${projectilePool.count})`);
  const shot = projectilePool.activeItems[projectilePool.activeItems.length - 1];
  assert.equal(shot.friendly, false, 'enemy shot is unfriendly');
});
ok('does NOT fire when hero out of line of sight (dy > 50)', () => {
  const v = new Violetta(500, 0);
  const hero = makeHero(300, 200); // far below → dy large
  v.projectileTimer = 1.99;
  const before = projectilePool.count;
  v.update(1/60, hero, null);
  assert.equal(projectilePool.count, before, 'no shot when out of LOS');
});
ok('pace → melee when very close (<40px)', () => {
  const v = new Violetta(500, 0);
  const hero = makeHero(475, 0); // dist 25 < 40
  v.meleeCooldown = 0;
  v.update(1/60, hero, null);
  assert.equal(v.aiState, 'melee');
  assert.equal(v.meleeActive, true);
});
ok('melee hitbox exists mid-jab, null otherwise', () => {
  const v = new Violetta(500, 0);
  const hero = makeHero(475, 0);
  v.update(1/60, hero, null); // enter melee
  v.meleeTimer = 0.15; // t=0.5 → within [0.3,0.7]
  assert.ok(v.meleeHitboxWorld, 'hitbox present mid-jab');
  v.meleeActive = false;
  assert.equal(v.meleeHitboxWorld, null, 'no hitbox when inactive');
});
ok('inherits Enemy cleanly', () => {
  const v = new Violetta(0, 0);
  const hero = makeHero(0, 0);
  v.hp = 1;
  v.takeDamage(10, hero, 'melee');
  assert.equal(v.aiState, 'dead');
});

// ===========================================================================
console.log('\nJack-O-Lantern');
ok('constructor: type/hp 30/gravity', () => {
  const j = new JackOLantern(0, 0);
  assert.equal(j.type, 'jackolantern');
  assert.equal(j.hp, 30);
  assert.equal(j.maxHp, 30);
  assert.equal(j.gravity, 1);
});
ok('idle → roll when hero in aggro radius', () => {
  const j = new JackOLantern(500, 0);
  const hero = makeHero(300, 0); // dist 200 < 400
  j.update(1/60, hero, null);
  assert.equal(j.aiState, 'roll');
});
ok('roll moves toward hero at ~150 px/s and spins', () => {
  const j = new JackOLantern(500, 0);
  const hero = makeHero(350, 0); // dist 150 < aggro 400 (stays rolling)
  const rotBefore = j.rotation;
  j.update(1/60, hero, null);
  assert.ok(Math.abs(j.vx) === 150, `vx=${j.vx}`);
  assert.ok(j.rotation > rotBefore, 'rotation advances while rolling');
});
ok('roll → launch on proximity (<80px)', () => {
  const j = new JackOLantern(500, 0);
  const hero = makeHero(450, 0); // dist 50 < 80
  j.update(1/60, hero, null); // idle→roll
  j.update(1/60, hero, null); // roll, still <80 → launch
  assert.equal(j.aiState, 'launch');
  assert.ok(j.launchTimer > 0);
});
ok('roll → launch on fuse timer (3s) even at range', () => {
  const j = new JackOLantern(500, 0);
  const hero = makeHero(300, 0); // dist 200 (>80), keep rolling
  j.update(1/60, hero, null); // idle→roll
  j.update(3.1, hero, null);  // advance past fuse time
  assert.equal(j.aiState, 'launch');
});
ok('launch → explode fires AoE exactly once', () => {
  const j = new JackOLantern(500, 0);
  const hero = makeHero(450, 0);
  j.update(1/60, hero, null); // idle→roll
  j.update(1/60, hero, null); // → launch
  j.update(0.5, hero, null);  // past launch → explode
  assert.equal(j.aiState, 'explode');
  assert.equal(j.exploded, true);
  // Running explode() again must not double-fire (latch).
  j.explode();
  assert.equal(j.exploded, true);
});
ok('explode → dead after flash', () => {
  const j = new JackOLantern(500, 0);
  const hero = makeHero(450, 0);
  j.update(1/60, hero, null);
  j.update(1/60, hero, null); // launch
  j.update(0.5, hero, null);  // explode
  j.update(0.4, hero, null);  // past explode flash → die
  assert.equal(j.aiState, 'dead');
});
ok('destructible by shot/melee before detonation (HP 30)', () => {
  const j = new JackOLantern(0, 0);
  const hero = makeHero(0, 0);
  assert.equal(j.hp, 30);
  const dealt = j.takeDamage(10, hero, 'projectile'); // defense 0 → 10
  assert.equal(dealt, 10);
  assert.equal(j.hp, 20);
  assert.notEqual(j.aiState, 'dead', 'not yet dead');
});
ok('explodeJackolantern deals AoE damage within radius via damage()', () => {
  const j = new JackOLantern(500, 0);
  const near = makeHero(540, 0);   // dist 40 < 80
  const far = makeHero(700, 0);    // dist 200 > 80
  const nearEnergy = near.energy;
  const result = explodeJackolantern(j, [near, far]);
  assert.ok(result.hit.includes(near), 'near target hit');
  assert.ok(!result.hit.includes(far), 'far target not hit');
  assert.ok(near.energy < nearEnergy, 'near hero lost energy');
  assert.equal(far.energy, far.energy, 'far hero untouched');
});
ok('explodeJackolantern never self-hits', () => {
  const j = new JackOLantern(500, 0);
  const hpBefore = j.hp;
  const result = explodeJackolantern(j, [j]);
  assert.equal(result.hit.length, 0, 'self excluded');
  assert.equal(j.hp, hpBefore);
});

// ===========================================================================
console.log('\nBoris Loon (flyer)');
ok('constructor: type/hp 25/gravity 0/fly', () => {
  const b = makeBoris(0, 0);
  assert.equal(b.type, 'boris_loon');
  assert.equal(b.hp, 25);
  assert.equal(b.gravity, 0, 'flyer ignores gravity');
  assert.equal(b.def.stats.fly, true);
});
ok('ignores gravity (y does not fall under base update)', () => {
  const b = makeBoris(0, 100);
  const hero = makeHero(500, 100); // far → stays idle
  const y0 = b.y;
  // Idle state eases toward baseY (same value) → no net fall.
  b.update(0.5, hero, null);
  assert.ok(Math.abs(b.y - y0) < 1, `y stayed put (${b.y.toFixed(1)} vs ${y0})`);
});
ok('idle → hover when hero in aggro radius', () => {
  const b = makeBoris(500, 100);
  const hero = makeHero(300, 100);
  b.update(1/60, hero, null);
  assert.equal(b.aiState, 'hover');
});
ok('hover oscillates y in a sine wave around baseY', () => {
  const b = makeBoris(500, 100);
  const hero = makeHero(450, 100); // dist 50 < aggro 360 (stays hovering)
  b.update(1/60, hero, null); // enter hover
  const ys = [];
  for (let i = 0; i < 120; i++) { b.update(1/60, hero, null); ys.push(b.y); }
  const min = Math.min(...ys), max = Math.max(...ys);
  // Amplitude 30 → peak-to-peak ≈ 60. Allow tolerance.
  assert.ok(max - min > 40, `bob range=${(max-min).toFixed(1)} should be ~60`);
  assert.ok(min < 100 && max > 100, 'oscillates above and below baseY');
});
ok('hover drifts horizontally toward hero (~80 px/s)', () => {
  const b = makeBoris(500, 100);
  const hero = makeHero(450, 100); // dist 50 < aggro 360
  b.update(1/60, hero, null);
  assert.ok(Math.abs(b.vx) === 80, `vx=${b.vx}`);
  assert.ok(b.vx < 0, 'drifting left toward hero');
});
ok('dive triggers when hero is below within range', () => {
  const b = makeBoris(500, 100);
  const hero = makeHero(500, 250); // directly below, dist 150 < 160
  b.diveCooldown = 0;
  b.update(1/60, hero, null); // idle→hover
  b.update(1/60, hero, null); // hover → dive (hero below)
  assert.equal(b.aiState, 'dive');
  assert.ok(b.vy > 0, `diving downward (vy=${b.vy})`);
});
ok('dive → recover → hover, sets diveCooldown', () => {
  const b = makeBoris(500, 100);
  const hero = makeHero(500, 250);
  b.diveCooldown = 0;
  b.update(1/60, hero, null);
  b.update(1/60, hero, null); // dive
  b.update(0.9, hero, null);  // past dive → recover
  assert.equal(b.aiState, 'recover');
  b.update(1.0, hero, null);  // past recover → hover + cooldown
  assert.equal(b.aiState, 'hover');
  assert.ok(b.diveCooldown > 0, 'cooldown set after dive');
});
ok('can fire a downward projectile', () => {
  const b = makeBoris(500, 100);
  const hero = makeHero(500, 250);
  const before = projectilePool.count;
  b.fireDown(hero);
  assert.ok(projectilePool.count > before, 'spawned a shot');
  const shot = projectilePool.activeItems[projectilePool.activeItems.length - 1];
  assert.equal(shot.friendly, false);
  assert.ok(shot.vy > 0, `shooting downward (vy=${shot.vy})`);
});
ok('inherits Enemy cleanly', () => {
  const b = makeBoris(0, 0);
  const hero = makeHero(0, 0);
  b.hp = 1;
  b.takeDamage(10, hero, 'melee');
  assert.equal(b.aiState, 'dead');
});

// ===========================================================================
console.log('\nBoris Loon Baby');
ok('baby is smaller (×0.6) than adult', () => {
  const baby = makeBorisBaby(0, 0);
  const adult = makeBoris(0, 0);
  assert.ok(baby.w < adult.w, `baby w=${baby.w} < adult w=${adult.w}`);
  assert.ok(baby.h < adult.h, `baby h=${baby.h} < adult h=${adult.h}`);
  assert.equal(baby.w, Math.round(44 * 0.6));
  assert.equal(baby.h, Math.round(40 * 0.6));
});
ok('baby is faster (speed ×1.5) and lower HP (15)', () => {
  const baby = makeBorisBaby(0, 0);
  assert.equal(baby.hp, 15);
  assert.ok(baby.def.stats.speed > BORIS_DEF.stats.speed,
    `baby speed=${baby.def.stats.speed} > adult ${BORIS_DEF.stats.speed}`);
  assert.equal(baby.def.stats.speed, BORIS_DEF.stats.speed * 1.5);
});
ok('baby is also a flyer (gravity 0)', () => {
  const baby = makeBorisBaby(0, 0);
  assert.equal(baby.gravity, 0);
  assert.equal(baby.def.stats.fly, true);
});
ok('baby inherits Enemy cleanly', () => {
  const baby = makeBorisBaby(0, 0);
  const hero = makeHero(0, 0);
  baby.hp = 1;
  baby.takeDamage(10, hero, 'melee');
  assert.equal(baby.aiState, 'dead');
});

// ===========================================================================
console.log('\nInheritance / distinctness');
ok('all four types extend Enemy', () => {
  assert.ok(new VineHound(0,0) instanceof Enemy);
  assert.ok(new Violetta(0,0) instanceof Enemy);
  assert.ok(new JackOLantern(0,0) instanceof Enemy);
  assert.ok(makeBoris(0,0) instanceof Enemy);
  assert.ok(makeBorisBaby(0,0) instanceof Enemy);
});
ok('each type has a distinct id', () => {
  const ids = [
    new VineHound(0,0).type,
    new Violetta(0,0).type,
    new JackOLantern(0,0).type,
    makeBoris(0,0).type,
    makeBorisBaby(0,0).type,
  ];
  assert.equal(new Set(ids).size, ids.length, `ids not unique: ${ids.join(',')}`);
});
ok('grounders have gravity 1, flyers have gravity 0', () => {
  assert.equal(new VineHound(0,0).gravity, 1);
  assert.equal(new Violetta(0,0).gravity, 1);
  assert.equal(new JackOLantern(0,0).gravity, 1);
  assert.equal(makeBoris(0,0).gravity, 0);
  assert.equal(makeBorisBaby(0,0).gravity, 0);
});

console.log(`\n${passed} assertions passed.`);
