// Theater cleanup #3 — single-owner hitFlash rule.
// Any target whose HP/energy actually decreases from an attack gets
// `hitFlash = 0.1` set exactly once, owned by the damage pipeline
// (flashTarget in combat/damage.js). No scattered ad-hoc assignments.
// Run: node js/test/hitFlashOwnership.test.js

import { strict as assert } from 'node:assert';
import { damage, flashTarget } from '../combat/damage.js';
import { Enemy } from '../enemies/enemy.js';
import { GameObj } from '../objects/object.js';
import { makeHitbox, processHitboxes } from '../combat/hitbox.js';
import { Effects } from '../effects.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const ENEMY_DEF = {
  id: 'testEnemy', name: 'Test Enemy', w: 32, h: 48,
  stats: { stamina: 100, defense: 0, fly: false },
};
const OBJ_DEF = { id: 'testBarrel', w: 32, h: 48, hp: 60, explosion: null };
const source = {}; // plain attacker, no traceStats

ok('damage() on a live enemy target sets hitFlash = 0.1 via takeDamage', () => {
  const e = new Enemy(ENEMY_DEF, 0, 0);
  const before = e.hp;
  const dealt = e.takeDamage(10, source, 'projectile');
  assert.ok(dealt > 0, 'damage should land');
  assert.equal(e.hp, before - dealt, 'hp drained by real amount');
  assert.equal(e.hitFlash, 0.1, 'hitFlash set to 0.1 exactly once');
});

ok('damage() on a dead target does not touch hitFlash', () => {
  const e = new Enemy(ENEMY_DEF, 0, 0);
  e.alive = false;
  const dealt = damage(source, e, 10, 'melee');
  assert.equal(dealt, 0, 'no damage to a dead target');
  assert.equal(e.hitFlash, 0, 'hitFlash untouched');
});

ok('GameObj.hit() sets hitFlash when applied > 0, not when clamped to 0', () => {
  const o = new GameObj(OBJ_DEF, 0, 0);
  const applied = o.hit(10, source, 'projectile');
  assert.equal(applied, 10);
  assert.equal(o.hitFlash, 0.1, 'flash set on real hit');
  // Destroyed object: hit() returns 0 and must not re-flash.
  o.destroyed = true;
  const again = o.hit(10, source, 'projectile');
  assert.equal(again, 0);
});

ok('flashTarget is a no-op for null / targets without a hitFlash field', () => {
  flashTarget(null); // must not throw
  flashTarget(undefined);
  const plain = { alive: true, hp: 50 };
  flashTarget(plain);
  assert.equal(plain.hitFlash, undefined, 'field not invented on foreign objects');
});

ok('processHitboxes does not double-set hitFlash on pipeline targets', () => {
  // A real Enemy goes through takeDamage(), which owns the flash. The engine
  // must NOT assign it a second time (idempotent value, but ownership stays
  // with the pipeline). Spy on the property to count writes — the sprite-shake
  // effect is stubbed so beginEnemyShake() doesn't write the field itself.
  const e = new Enemy(ENEMY_DEF, 0, 0);
  let writes = 0;
  Object.defineProperty(e, 'hitFlash', {
    configurable: true,
    get() { return this._hf; },
    set(v) { this._hf = v; writes++; },
  });
  e._hf = 0;

  const origShake = Effects.beginEnemyShake;
  Effects.beginEnemyShake = () => {};
  try {
    const hb = makeHitbox({ owner: {}, team: 'ally', box: { x: -10, y: -10, w: 60, h: 60 }, damage: 5, method: 'melee' });
    processHitboxes([hb], [e]);
  } finally {
    Effects.beginEnemyShake = origShake;
  }
  assert.equal(e.hitFlash, 0.1, 'flash is live after the swing');
  assert.equal(writes, 1, `exactly one write per damaging event (got ${writes})`);
});

ok('processHitboxes leaves non-pipeline placeholders untouched by the engine', () => {
  // Plain placeholder entity: no takeDamage, no hit. The engine's damage
  // branch deals nothing to it (dealt stays 0), so the juice block never runs
  // and the engine assigns no flash — matching pre-cleanup behavior for such
  // targets (the old line only fired when dealt > 0, which required a
  // pipeline target).
  const t = { alive: true, hp: 999, layer: 2 /* LAYER.ENEMY */, hitFlash: 0, x: 0, y: 0, w: 32, h: 48 };
  const hb = makeHitbox({ owner: {}, team: 'ally', box: { x: -10, y: -10, w: 60, h: 60 }, damage: 5, method: 'melee' });
  processHitboxes([hb], [t]);
  assert.equal(t.hitFlash, 0, 'engine did not invent a flash for a non-damaged target');
});

console.log(`\nhitFlash ownership: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
