// Task 4.3 — node-based unit tests for Powerups + Checkpoint.
// Run: node js/test/powerup.test.js
// No DOM needed: entity.js / consts.js / damage.js / object.js / powerup.js are pure modules.
//
// Acceptance criteria covered here:
//   1. Each powerup applies its documented effect        → apply() per type
//   2. Invincibility grants timed no-damage + fast blink → invincibleTimer set to 5
//   3. Checkpoint stores position used on death-restart  → trigger() sets hero.checkpoint
//   4. Collection shows floating text + sparkle          → collect() latches + telemetry (VFX is caller-side)

import { strict as assert } from 'node:assert';
import { LAYER } from '../consts.js';
import { POWERUP_DEFS, POWERUP_TYPES, Powerup, makePowerup } from '../powerup.js';
import { Checkpoint, makeCheckpoint } from '../object.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// --- Minimal stand-in hero ---------------------------------------------------
// A plain object with the fields the powerup effects mutate. Not a full Hero
// (which pulls in Entity/anim deps we don't need here).
function fakeHero(overrides = {}) {
  return {
    x: 80, y: 400, w: 32, h: 48, alive: true,
    energy: 50, maxEnergy: 100,
    shield: 0, ammo: 200, specialAmmo: 0, coins: 0, lives: 3,
    invincibleTimer: 0, rapidTimer: 0,
    checkpoint: { x: 80, y: 400 },
    combatStats: { powerupsCollected: {} },
    ...overrides,
  };
}

// --- Minimal stand-in enemies ------------------------------------------------
// Plain targets with hp + alive (no takeDamage) AND real-style ones with takeDamage.
function fakeEnemy(hp = 20) {
  return { x: 0, y: 0, w: 36, h: 40, alive: true, hp, maxHp: hp, type: 'target' };
}
function fakeTakeDamageEnemy(hp = 20) {
  const e = fakeEnemy(hp);
  e.takeDamage = (amt, _src, _method) => {
    if (!e.alive) return 0;
    e.hp -= amt;
    if (e.hp <= 0) { e.hp = 0; e.alive = false; }
    return Math.min(amt, e.hp + amt);
  };
  return e;
}

console.log('Definitions');
ok('POWERUP_DEFS has all 8 documented types', () => {
  const expected = ['ammo','invincibility','special','rapid','shield','clear','energy','oneUp'];
  for (const t of expected) assert.ok(POWERUP_DEFS[t], `missing ${t}`);
  assert.equal(POWERUP_TYPES.length, 8);
});
ok('invincibility duration is ~5s', () => approx(POWERUP_DEFS.invincibility.duration, 5));
ok('rapid duration is ~6s', () => approx(POWERUP_DEFS.rapid.duration, 6));

console.log('Powerup entity');
ok('constructor sets PICKUP layer + def + not collected', () => {
  const p = new Powerup('ammo', 100, 200);
  assert.equal(p.layer, LAYER.PICKUP);
  assert.equal(p.powerType, 'ammo');
  assert.equal(p.def.label, '+100 Ammo');
  assert.equal(p.collected, false);
  assert.equal(p.alive, true);
  assert.equal(p.w, 28); assert.equal(p.h, 28);
});
ok('unknown type throws', () => {
  assert.throws(() => new Powerup('bogus', 0, 0), /Unknown powerup type/);
});
ok('makePowerup factory returns a Powerup', () => {
  const p = makePowerup('rapid', 50, 60);
  assert.ok(p instanceof Powerup);
  assert.equal(p.x, 50); assert.equal(p.y, 60);
});

console.log('Effects (acceptance #1: each applies its documented effect)');
ok('ammo: +100 ammo', () => {
  const h = fakeHero({ ammo: 200 });
  new Powerup('ammo', 0, 0).collect(h, {});
  assert.equal(h.ammo, 300);
});
ok('invincibility: sets invincibleTimer to 5 (acceptance #2)', () => {
  const h = fakeHero();
  new Powerup('invincibility', 0, 0).collect(h, {});
  assert.equal(h.invincibleTimer, 5);
});
ok('invincibility: extends existing timer (max, not reset-lower)', () => {
  const h = fakeHero({ invincibleTimer: 7 });
  new Powerup('invincibility', 0, 0).collect(h, {});
  assert.equal(h.invincibleTimer, 7); // keeps the longer remaining time
});
ok('special: +50 special ammo', () => {
  const h = fakeHero({ specialAmmo: 0 });
  new Powerup('special', 0, 0).collect(h, {});
  assert.equal(h.specialAmmo, 50);
});
ok('rapid: sets rapidTimer to 6', () => {
  const h = fakeHero();
  new Powerup('rapid', 0, 0).collect(h, {});
  assert.equal(h.rapidTimer, 6);
});
ok('shield: +50 shield', () => {
  const h = fakeHero({ shield: 0 });
  new Powerup('shield', 0, 0).collect(h, {});
  assert.equal(h.shield, 50);
});
ok('clear: kills all live enemies via takeDamage (real Enemy path)', () => {
  const e1 = fakeTakeDamageEnemy(20);
  const e2 = fakeTakeDamageEnemy(9999);
  const dead = fakeTakeDamageEnemy(20); dead.alive = false;
  new Powerup('clear', 0, 0).collect(fakeHero(), { enemies: [e1, e2, dead] });
  assert.equal(e1.alive, false);
  assert.equal(e2.alive, false);
  assert.equal(dead.alive, false); // already-dead stays dead, untouched
});
ok('clear: handles plain placeholder enemies (no takeDamage) via hp drain', () => {
  const e1 = fakeEnemy(20);
  const e2 = fakeEnemy(50);
  new Powerup('clear', 0, 0).collect(fakeHero(), { enemies: [e1, e2] });
  assert.equal(e1.alive, false);
  assert.equal(e2.alive, false);
});
ok('clear: tolerates missing context.enemies (no crash)', () => {
  const h = fakeHero();
  assert.doesNotThrow(() => new Powerup('clear', 0, 0).collect(h, undefined));
});
ok('energy: +30 energy clamped at maxEnergy', () => {
  const h = fakeHero({ energy: 90, maxEnergy: 100 });
  new Powerup('energy', 0, 0).collect(h, {});
  assert.equal(h.energy, 100); // clamped, not 120
});
ok('energy: +30 when below max', () => {
  const h = fakeHero({ energy: 50, maxEnergy: 100 });
  new Powerup('energy', 0, 0).collect(h, {});
  assert.equal(h.energy, 80);
});
ok('oneUp: +1 life', () => {
  const h = fakeHero({ lives: 3 });
  new Powerup('oneUp', 0, 0).collect(h, {});
  assert.equal(h.lives, 4);
});

console.log('Collection contract (acceptance #4: latch + telemetry)');
ok('collect() latches: second call does NOT re-apply', () => {
  const h = fakeHero({ ammo: 200 });
  const p = new Powerup('ammo', 0, 0);
  assert.equal(p.collect(h, {}), true);
  assert.equal(p.collect(h, {}), false); // latched
  assert.equal(h.ammo, 300);             // applied exactly once
  assert.equal(p.alive, false);
  assert.equal(p.collected, true);
});
ok('collect() bumps combatStats.powerupsCollected[type]', () => {
  const h = fakeHero();
  new Powerup('rapid', 0, 0).collect(h, {});
  new Powerup('rapid', 0, 0).collect(h, {});
  assert.equal(h.combatStats.powerupsCollected.rapid, 2);
});
ok('collect() works without combatStats (no crash)', () => {
  const h = fakeHero(); delete h.combatStats;
  assert.doesNotThrow(() => new Powerup('ammo', 0, 0).collect(h, {}));
});

console.log('Checkpoint (acceptance #3: stores restart position)');
ok('constructor sets CHECKPOINT layer + id + not triggered', () => {
  const c = new Checkpoint('1-1', 1500, 452);
  assert.equal(c.layer, LAYER.CHECKPOINT);
  assert.equal(c.checkpointId, '1-1');
  assert.equal(c.triggered, false);
  assert.equal(c.w, 24); assert.equal(c.h, 48);
});
ok('trigger() sets hero.checkpoint to the flag position', () => {
  const c = new Checkpoint('1-2', 3000, 452);
  const h = fakeHero({ checkpoint: { x: 80, y: 400 } });
  assert.equal(c.trigger(h), true);
  assert.deepEqual(h.checkpoint, { x: 3000, y: 452 });
  assert.equal(c.triggered, true);
});
ok('trigger() latches: second call is a no-op (returns false)', () => {
  const c = new Checkpoint('1-3', 4500, 452);
  const h = fakeHero();
  assert.equal(c.trigger(h), true);
  assert.equal(c.trigger(h), false);
});
ok('trigger() starts a flash timer for the VFX', () => {
  const c = new Checkpoint('1-4', 6000, 452);
  const h = fakeHero();
  c.trigger(h);
  assert.ok(c.flashTimer > 0);
});
ok('update(dt) decays the flash timer toward 0', () => {
  const c = new Checkpoint('1-1', 1500, 452);
  c.flashTimer = 0.4;
  c.update(0.5);
  assert.equal(c.flashTimer, 0);
});
ok('makeCheckpoint factory returns a Checkpoint', () => {
  const c = makeCheckpoint('1-1', 1500, 452);
  assert.ok(c instanceof Checkpoint);
  assert.equal(c.checkpointId, '1-1');
});

console.log(`\n${passed} passed`);
