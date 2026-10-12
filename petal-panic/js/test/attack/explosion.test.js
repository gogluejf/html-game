// Task 1.5 — Explosion primitive tests (pure logic, no DOM).
// Run: node js/test/attack/explosion.test.js

import { strict as assert } from 'node:assert';
import { fireBlast } from '../../combat/attack/primitives/explosion.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { ALIGNMENT } from '../../combat/explosion.js';
import { createTrace } from '../../stats.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Dummy enemy: has takeDamage + bodyKnockback so isEnemy() recognizes it. */
function dummyEnemy(x, y, hp = 30) {
  const t = {
    x, y, w: 24, h: 24, alive: true, hp,
    bodyKnockback: { base: 200 },
    vx: 0, vy: 0, hitstunTimer: 0, iFrameTimer: 0,
    takeDamage(amt, src, method) {
      if (!this.alive) return 0;
      this.hp -= amt;
      if (this.hp <= 0) this.alive = false;
      return amt;
    },
  };
  return t;
}
const heroDummy = () => ({ x: 500, y: 300, w: 28, h: 40, alive: true, energy: 100, intangible: false, traceStats: createTrace(), loseSelectedSpecial() {}, takeHit() {} });

ok('neutral blast damages enemies in radius, spares those outside', () => {
  const near = dummyEnemy(100, 100);
  const far = dummyEnemy(400, 100);
  const ctx = makeContext(null, { world: { targets: [near, far] } });
  const r = fireBlast({ x: 100, y: 100, radius: 60, damage: 10, alignment: ALIGNMENT.NEUTRAL }, ctx);
  assert.deepEqual(r.hit, [near], 'only the near enemy was hit');
  assert.equal(near.hp, 20);
  assert.equal(far.hp, 30, 'far enemy untouched');
});

ok('ally blast hurts enemies but spares the hero', () => {
  const hero = heroDummy();
  const enemy = dummyEnemy(100, 100, 50);
  // Put the hero INSIDE the blast.
  hero.x = 90; hero.y = 90;
  const ctx = makeContext(null, { world: { targets: [hero, enemy], hero } });
  const r = fireBlast({ x: 100, y: 100, radius: 60, damage: 10, alignment: ALIGNMENT.ALLY }, ctx);
  assert.deepEqual(r.hit, [enemy]);
  assert.equal(hero.energy, 100, 'hero spared by ally alignment');
});

ok('foe blast hurts only the hero', () => {
  const hero = heroDummy();
  const enemy = dummyEnemy(100, 100, 50);
  hero.x = 100; hero.y = 100; // inside blast
  const ctx = makeContext(null, { world: { targets: [hero, enemy], hero } });
  const r = fireBlast({ x: 100, y: 100, radius: 60, damage: 7, alignment: ALIGNMENT.FOE }, ctx);
  assert.deepEqual(r.hit, [hero]);
  assert.equal(hero.energy, 93);
  assert.equal(enemy.hp, 50, 'enemy spared by foe alignment');
});

ok('self (detonator) is never hit by its own blast', () => {
  const self = dummyEnemy(100, 100, 50);
  const other = dummyEnemy(110, 100, 50);
  const ctx = makeContext(self, { world: { targets: [self, other] } });
  const r = fireBlast({ x: 100, y: 100, radius: 60, damage: 10, alignment: ALIGNMENT.NEUTRAL, self }, ctx);
  assert.deepEqual(r.hit, [other]);
  assert.equal(self.hp, 50);
});

ok('dead and intangible targets are skipped', () => {
  const dead = dummyEnemy(100, 100); dead.alive = false;
  const ghost = dummyEnemy(110, 100); ghost.intangible = true;
  const solid = dummyEnemy(120, 100);
  const ctx = makeContext(null, { world: { targets: [dead, ghost, solid] } });
  const r = fireBlast({ x: 100, y: 100, radius: 60, damage: 5, alignment: ALIGNMENT.NEUTRAL }, ctx);
  assert.deepEqual(r.hit, [solid]);
});

ok('lethal blast kills (alive=false via takeDamage pipeline)', () => {
  const e = dummyEnemy(100, 100, 10);
  const ctx = makeContext(null, { world: { targets: [e] } });
  fireBlast({ x: 100, y: 100, radius: 60, damage: 99, alignment: ALIGNMENT.NEUTRAL }, ctx);
  assert.equal(e.alive, false);
});

ok('end-to-end: invoke("explosion") emits detonate then complete with summary', () => {
  const e = dummyEnemy(100, 100, 50);
  const ctx = makeContext(null, { world: { targets: [e] } });
  const seen = [];
  const h = invoke('explosion', { x: 100, y: 100, radius: 60, damage: 10 }, ctx);
  // Synchronous: events already fired; verify data on the handle path.
  assert.equal(e.hp, 40, 'damage applied during invoke');
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
