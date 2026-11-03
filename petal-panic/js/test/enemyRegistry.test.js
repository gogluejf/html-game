// Task 2.1 (typed spawn) — enemy registry cross-check: ENEMY_TYPES ids in the
// leaf registry (world/enemyTypes.js) must match ENEMY_FACTORIES keys in
// world/build.js exactly. Drift here would let resolveSlotType (macros.js)
// pass an id with no factory, so makeEnemy silently returns null and a typed
// slot spawns nothing. This test is the guard; enemyTypes.js stays import-free.
// Run: node --test petal-panic/js/test/
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ENEMY_TYPES, ENEMY_TYPE_IDS, enemyById, isEnemyType } from '../world/enemyTypes.js';
import { ENEMY_FACTORIES_KEYS } from '../world/build.js';

test('ENEMY_TYPES ids match ENEMY_FACTORIES keys in build.js (no drift)', () => {
  const registryIds = new Set(ENEMY_TYPE_IDS);
  const factoryKeys = new Set(Object.keys(ENEMY_FACTORIES_KEYS));

  // Every registry id has a factory (resolveSlotType can never roll an
  // unspawable type).
  for (const id of ENEMY_TYPE_IDS) {
    assert.ok(factoryKeys.has(id), `ENEMY_TYPES id "${id}" has no entry in ENEMY_FACTORIES`);
  }
  // Every factory key is declared in the registry (a factory without a
  // registry entry is dead code that typed spawn can never reach).
  for (const key of Object.keys(ENEMY_FACTORIES_KEYS)) {
    assert.ok(registryIds.has(key), `ENEMY_FACTORIES key "${key}" is missing from ENEMY_TYPES`);
  }
  assert.equal(registryIds.size, factoryKeys.size, 'registry and factory sets are the same size');
});

test('ENEMY_TYPES labels match the factory labels (display names stay in sync)', () => {
  for (const t of ENEMY_TYPES) {
    assert.equal(t.label, ENEMY_FACTORIES_KEYS[t.id]?.label ?? null, `${t.id}: label matches factory`);
  }
});

test('leaf registry helpers still agree with the list', () => {
  for (const t of ENEMY_TYPES) {
    assert.equal(enemyById[t.id], t, `enemyById[${t.id}] resolves to its own entry`);
    assert.ok(isEnemyType(t.id), `isEnemyType accepts ${t.id}`);
  }
  assert.ok(!isEnemyType('random'), "'random' is a roll marker, not a concrete type");
});
