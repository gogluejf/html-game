// Task 6.1 — node-based unit tests for the Overgrown Elephant boss (design §9).
// Run: node js/test/boss.test.js
// No DOM needed: boss.js + its deps (enemy/entity/consts/damage/projectile) are
// pure (no canvas, no window). The camera-lock and win-state transitions live in
// systems/update.js (which needs the DOM), so those are exercised via the boss's
// exposed data contract (arenaX/arenaW, shouldActivate, onDeath) here.

import { strict as assert } from 'node:assert';
import { Enemy } from '../enemy.js';
import { LAYER } from '../consts.js';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';
import { projectilePool } from '../projectile.js';
import { Elephant, ELEPHANT_DEF, makeElephant, WEAK_POINT_MULT, BOSS_TRIGGER_RADIUS, BOSS_ARENA_WIDTH } from '../boss.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 0.5) => Math.abs(a - b) < eps;
function makeHero(x = 0, y = 0) { return new Hero(HEROES.scarlet, x, y); }
function step(b, hero, dt = 1/60, n = 1) { for (let i = 0; i < n; i++) b.update(dt, hero, null); }

// ===========================================================================
console.log('Constructor / identity');
ok('is an Enemy subclass with isBoss flag', () => {
  const e = new Elephant(0, 0);
  assert.ok(e instanceof Enemy);
  assert.equal(e.isBoss, true);
});
ok('uses BOSS layer (not ENEMY)', () => {
  const e = new Elephant(0, 0);
  assert.equal(e.layer, LAYER.BOSS);
});
ok('type/hp/maxHp from def (stamina 500)', () => {
  const e = new Elephant(0, 0);
  assert.equal(e.type, 'elephant');
  assert.equal(e.hp, 500);
  assert.equal(e.maxHp, 500);
});
ok('starts idle, inactive, escalation 1.0', () => {
  const e = new Elephant(0, 0);
  assert.equal(e.phase, 'idle');
  assert.equal(e.active, false);
  assert.equal(e.escalation, 1.0);
});
ok('arena is centered on spawn x with width 400', () => {
  const e = new Elephant(1000, 0);
  assert.equal(e.arenaW, BOSS_ARENA_WIDTH);
  // arenaX centers the body mid-arena: arenaX + W/2 == spawnX + w/2
  assert.ok(approx(e.arenaX + e.arenaW / 2, 1000 + e.w / 2), `arenaX=${e.arenaX}`);
});
ok('makeElephant rests feet on the floor top', () => {
  const e = makeElephant(7000, 500);
  assert.ok(approx(e.y + e.h, 500), `bottom=${e.y + e.h}`);
});

// ===========================================================================
console.log('\nActivation (camera-lock trigger)');
ok('does not activate when hero is far away', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(100, 0); // ~6900px away
  assert.equal(e.shouldActivate(hero), false);
  assert.equal(e.active, false);
});
ok('activates when hero within trigger radius (300)', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0); // center-to-center ~180 < 300
  assert.equal(e.shouldActivate(hero), true);
  assert.equal(e.active, true);
});
ok('activation latches (stays active even if hero retreats)', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);
  e.shouldActivate(hero);
  const farHero = makeHero(100, 0);
  assert.equal(e.shouldActivate(farHero), true, 'still active after hero leaves');
});
ok('activation starts the first charge phase', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);
  e.shouldActivate(hero);
  assert.equal(e.phase, 'charge');
});

// ===========================================================================
console.log('\nPhase machine');
ok('idle → charge after the idle duration', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);
  e.shouldActivate(hero);           // charge
  e.startPhase('idle');             // force idle
  step(e, hero, 1.1);               // > IDLE_DUR (1.0) at escalation 1.0
  assert.equal(e.phase, 'charge');
});
ok('charge runs toward the hero at escalated speed', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);   // hero to the LEFT of the boss
  e.shouldActivate(hero);           // enter charge
  step(e, hero, 1/60);
  assert.ok(Math.abs(e.vx) === 200 * e.escalation, `vx=${e.vx}`);
  assert.ok(e.vx < 0, 'moving left toward hero');
});
ok('charge → stomp after the charge duration', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);
  e.shouldActivate(hero);           // charge
  step(e, hero, 1.6);               // > CHARGE_DUR (1.5)
  assert.equal(e.phase, 'stomp');
});
ok('stomp → trunk_blast after the stomp duration', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);
  e.shouldActivate(hero);
  e.startPhase('stomp');
  step(e, hero, 1.1);               // > STOMP_DUR (1.0)
  assert.equal(e.phase, 'trunk_blast');
});
ok('trunk_blast → idle after the blast duration', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);
  e.shouldActivate(hero);
  e.startPhase('trunk_blast');
  step(e, hero, 1.3);               // > TRUNK_DUR (1.2)
  assert.equal(e.phase, 'idle');
});
ok('full loop returns to idle without crashing', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);
  e.shouldActivate(hero);
  // Run well past one full cycle; it must settle back into a valid phase.
  const valid = ['idle', 'charge', 'stomp', 'trunk_blast'];
  step(e, hero, 1/60, 60 * 8);      // 8 seconds
  assert.ok(valid.includes(e.phase), `phase=${e.phase}`);
});

// ===========================================================================
console.log('\nEscalation');
ok('escalation grows as HP drops (up to 1.5× at 0%)', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);
  e.shouldActivate(hero);
  assert.ok(approx(e.escalation, 1.0), `full hp esc=${e.escalation}`);
  e.hp = 250; // 50%
  step(e, hero, 1/60);
  assert.ok(approx(e.escalation, 1.25, 0.01), `half hp esc=${e.escalation}`);
  e.hp = 1;   // ~0%
  step(e, hero, 1/60);
  assert.ok(e.escalation > 1.4, `low hp esc=${e.escalation.toFixed(3)}`);
});
ok('lower HP shortens the idle gap (faster attacks)', () => {
  const hi = new Elephant(7000, 0);
  const lo = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);
  hi.shouldActivate(hero); hi.startPhase('idle');
  lo.shouldActivate(hero); lo.startPhase('idle'); lo.hp = 1;
  // Advance both until each leaves idle; low-HP boss must leave sooner.
  let hiFrames = 0, loFrames = 0;
  while (hi.phase === 'idle' && hiFrames < 1000) { step(hi, hero, 1/60); hiFrames++; }
  while (lo.phase === 'idle' && loFrames < 1000) { step(lo, hero, 1/60); loFrames++; }
  assert.ok(loFrames < hiFrames, `low=${loFrames} < high=${hiFrames}`);
});

// ===========================================================================
console.log('\nTrunk blast (ranged fan)');
ok('fires 3 unfriendly projectiles in a fan', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);
  e.shouldActivate(hero);
  e.startPhase('trunk_blast');
  const before = projectilePool.count;
  e.fireTrunkBlast();
  const added = projectilePool.count - before;
  assert.equal(added, 3, `expected 3 shots, got ${added}`);
  for (const p of projectilePool.activeItems.slice(-3)) {
    assert.equal(p.friendly, false, 'boss shots are unfriendly (PROJ_FOE)');
  }
});
ok('fan spreads around the facing axis (left-facing aims leftward)', () => {
  const e = new Elephant(7000, 0);
  e.facing = -1; e.syncMirror();
  e.fireTrunkBlast();
  const shots = projectilePool.activeItems.slice(-3);
  // All three should travel leftward (negative vx) since the boss faces left.
  assert.ok(shots.every(p => p.vx < 0), `vxs=${shots.map(p => p.vx.toFixed(0)).join(',')}`);
});
ok('blast fires exactly once per phase (latch resets on startPhase)', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(6800, 0);
  e.shouldActivate(hero);
  e.startPhase('trunk_blast');
  const before = projectilePool.count;
  // Step through the whole blast phase; only one fan should fire.
  step(e, hero, 1/60, 60 * 2);
  const added = projectilePool.count - before;
  assert.equal(added, 3, `one fan only, got ${added} shots`);
});

// ===========================================================================
console.log('\nStomp (ground shockwave)');
ok('damages a grounded hero during the wave window', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(7000, 0); // overlapping
  hero.grounded = true;
  hero.invincibleTimer = 0;
  const energyBefore = hero.energy;
  const hit = e.doStomp(hero);
  assert.equal(hit, true, 'should have hit a grounded hero');
  assert.ok(hero.energy < energyBefore, 'hero lost energy');
});
ok('does NOT damage an airborne hero (jump over it)', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(7000, 0);
  hero.grounded = false; // jumped
  hero.invincibleTimer = 0;
  const energyBefore = hero.energy;
  const hit = e.doStomp(hero);
  assert.equal(hit, false, 'airborne hero dodges the stomp');
  assert.equal(hero.energy, energyBefore, 'no energy lost');
});
ok('respects the hero invincibility window', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(7000, 0);
  hero.grounded = true;
  hero.invincibleTimer = 0.5;
  const energyBefore = hero.energy;
  const hit = e.doStomp(hero);
  assert.equal(hit, false, 'i-frames absorb the stomp');
  assert.equal(hero.energy, energyBefore);
});
ok('records a shake magnitude for screen-shake juice', () => {
  const e = new Elephant(7000, 0);
  const hero = makeHero(7000, 0);
  hero.grounded = true;
  e.shakeMag = 0;
  e.doStomp(hero);
  assert.ok(e.shakeMag > 0, `shakeMag=${e.shakeMag}`);
});

// ===========================================================================
console.log('\nWeak point (bonus damage)');
ok('head/trunk hits deal 1.5× damage', () => {
  const e = new Elephant(0, 0);
  const hero = makeHero(0, 0);
  // Weak point box is ox:10 oy:0 bw:60 bh:30 → world (10..70, 0..30).
  const headPos = { x: 40, y: 15 };
  assert.equal(e.isWeakPointHit(headPos.x, headPos.y), true, 'center of head is weak');
  const hpBefore = e.hp;
  const dealt = e.takeDamage(10, hero, 'projectile', headPos);
  // defense 5 → max(1, 15-5)=10 base; weak ×1.5 = 15 raw → max(1,15-5)=10? No:
  // takeDamage multiplies amt by 1.5 FIRST (15), then damage() subtracts def 5 → 10.
  const expected = Math.max(1, 10 * WEAK_POINT_MULT - e.stats.defense);
  assert.equal(dealt, expected, `dealt=${dealt} expected=${expected}`);
  assert.ok(e.hp <= hpBefore - dealt, 'hp drained');
});
ok('body hits (below the head) deal normal damage', () => {
  const e = new Elephant(0, 0);
  const hero = makeHero(0, 0);
  const bodyPos = { x: 40, y: 70 }; // well below the 30px-tall weak zone
  assert.equal(e.isWeakPointHit(bodyPos.x, bodyPos.y), false, 'torso is not weak');
  const dealt = e.takeDamage(10, hero, 'projectile', bodyPos);
  const expected = Math.max(1, 10 - e.stats.defense);
  assert.equal(dealt, expected, `dealt=${dealt} expected=${expected}`);
});
ok('weak-point bonus strictly exceeds body damage for the same attack', () => {
  const a = new Elephant(0, 0);
  const b = new Elephant(0, 0);
  const hero = makeHero(0, 0);
  const head = a.takeDamage(10, hero, 'projectile', { x: 40, y: 15 });
  const body = b.takeDamage(10, hero, 'projectile', { x: 40, y: 70 });
  assert.ok(head > body, `head=${head} > body=${body}`);
});
ok('weakPointWorld matches the configured offset box', () => {
  const e = new Elephant(100, 200);
  const wp = e.weakPointWorld();
  assert.equal(wp.x, 100 + 10);
  assert.equal(wp.y, 200 + 0);
  assert.equal(wp.w, 60);
  assert.equal(wp.h, 30);
});

// ===========================================================================
console.log('\nDeath → win pipeline');
ok('takeDamage at 0 HP enters the death pipeline', () => {
  const e = new Elephant(0, 0);
  const hero = makeHero(0, 0);
  e.hp = 1;
  e.takeDamage(10, hero, 'melee');
  assert.equal(e.aiState, 'dead');
});
ok('death anim completes and alive flips to false', () => {
  const e = new Elephant(0, 0);
  const hero = makeHero(0, 0);
  e.hp = 1;
  e.takeDamage(10, hero, 'melee');
  e.alive = true; // keep alive during the anim (as update.js does)
  step(e, hero, 0.7); // > deathDuration (0.6)
  assert.equal(e.alive, false, 'corpse fully gone after anim');
});
ok('onDeath clears velocity and deactivates the fight', () => {
  const e = new Elephant(0, 0);
  e.vx = 100; e.vy = 50; e.active = true;
  e.onDeath();
  assert.equal(e.vx, 0);
  assert.equal(e.vy, 0);
  assert.equal(e.active, false);
});
ok('ai() is a no-op while dead (no crash, no movement)', () => {
  const e = new Elephant(0, 0);
  const hero = makeHero(0, 0);
  e.hp = 1;
  e.takeDamage(10, hero, 'melee');
  e.alive = true;
  const x0 = e.x;
  step(e, hero, 1/60, 30);
  assert.equal(e.x, x0, 'dead boss does not move');
});

// ===========================================================================
console.log('\nInheritance / distinctness');
ok('extends Enemy cleanly (inherits takeDamage/die/death pipeline)', () => {
  const e = new Elephant(0, 0);
  assert.ok(e instanceof Enemy);
  assert.equal(typeof e.die, 'function');
  assert.equal(typeof e.takeDamage, 'function');
});
ok('distinct type id from regular enemies', () => {
  assert.equal(new Elephant(0, 0).type, 'elephant');
});

console.log(`\n${passed} assertions passed.`);
