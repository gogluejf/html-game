// Plan 3.1 — ATTACK_IDS + invokeChild tests (pure logic, no DOM).
// Run: node js/test/attack/attackIds.test.js

import { strict as assert } from 'node:assert';
import { ATTACK_IDS, CHILD_TARGETS, invokeChild } from '../../combat/attack/attackIds.js';
import { getPrimitive, getMacro } from '../../combat/attack/registry.js';
// Register the concrete invoke targets so the mapping table can be verified.
import '../../combat/attack/primitives/projectile.js';      // projectile
import '../../combat/attack/macros/explosiveBomb.js';       // bomb
import '../../combat/attack/macros/throwMine.js';           // mine
import '../../combat/attack/macros/molotov.js';             // molotov
import '../../combat/attack/macros/throwEnemy.js';          // enemy
import '../../combat/attack/macros/explosiveProjectile.js'; // explosion
import '../../combat/attack/macros/shockwaveProjectile.js'; // shockwave
import '../../combat/attack/macros/napalm.js';              // napalm
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// Stub projectile pool (same shape spawnSplit.test.js uses).
const mkPool = () => {
  const items = [];
  return {
    activeItems: items,
    spawn(...a) {
      const e = { alive: true, x: a[0], y: a[1], w: 12, h: 12, vx: 0, vy: 0, orientSprite() {}, setLife() {}, timers: new Map() };
      items.push(e);
      return e;
    },
    updateAll() {},
  };
};
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });
const ctx = () => makeContext(attacker(), { pools: { projectilePool: mkPool() } });

// --- ATTACK_IDS: the shared list -------------------------------------------

ok('ATTACK_IDS is the exact 8-value flat list (no ballistic, no plain)', () => {
  assert.deepEqual(ATTACK_IDS, [
    'projectile', 'bomb', 'mine', 'molotov', 'enemy', 'expl_proj', 'shock_proj', 'shock_bomb', 'napalm',
  ]);
});

ok('ATTACK_IDS is frozen and non-extensible', () => {
  assert.ok(Object.isFrozen(ATTACK_IDS));
  assert.throws(() => { ATTACK_IDS.push('ballistic'); });
});

// --- CHILD_TARGETS: the value → invoke-target map ---------------------------

ok('CHILD_TARGETS keys cover exactly the ATTACK_IDS values', () => {
  assert.deepEqual(Object.keys(CHILD_TARGETS).sort(), [...ATTACK_IDS].sort());
});

ok('CHILD_TARGETS pins the user-confirmed mappings', () => {
  assert.deepEqual(CHILD_TARGETS, {
    projectile: 'projectile',
    bomb: 'explosiveBomb',
    mine: 'throwMine',
    molotov: 'molotov',
    enemy: 'throwEnemy',
    expl_proj: 'explosiveProjectile',
    shock_proj: 'shockwaveProjectile',
    shock_bomb: 'shockwaveBomb',
    napalm: 'napalm',
  });
});

ok('every CHILD_TARGETS target is a registered attack', () => {
  for (const [child, target] of Object.entries(CHILD_TARGETS)) {
    const def = getPrimitive(target) ?? getMacro(target);
    assert.ok(def, `target '${target}' (child '${child}') must be registered`);
  }
});

// --- invokeChild: delegation + failure --------------------------------------

ok('invokeChild rejects unknown children with the valid list in the error', () => {
  for (const bad of ['ballistic', 'plain', 'rock', 'blast', undefined, 42]) {
    assert.throws(
      () => invokeChild(bad, {}, ctx()),
      (e) => e instanceof Error && e.message.includes(`'${bad}'`) && e.message.includes('projectile') && e.message.includes('napalm'),
      `expected a descriptive throw for ${JSON.stringify(bad)}`,
    );
  }
});

ok('invokeChild delegates projectile → invoke("projectile")', () => {
  const h = invokeChild('projectile', { x: 400, y: 300, speed: 300 }, ctx());
  assert.equal(h.id, 'projectile');
  assert.ok(h.entity, 'live entity spawned from the pool');
});

ok('invokeChild delegates explosion → invoke("explosiveProjectile")', () => {
  const h = invokeChild('expl_proj', { x: 400, y: 300, speed: 300, radius: 60 }, ctx());
  assert.equal(h.id, 'explosiveProjectile');
  assert.ok(h.entity, 'carrier entity spawned');
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
