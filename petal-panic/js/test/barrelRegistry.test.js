// Task 1.1 — Barrel registry: BARREL_TYPES / barrelById / isBarrelType in
// objects/object.js are the single source of truth for barrel types. Ids must
// match BARREL_FACTORIES keys in world/build.js (wood/explosive/coin).
// Run: node --test petal-panic/js/test/
import { strict as assert } from 'node:assert';
import { BARREL_TYPES, barrelById, isBarrelType } from '../objects/object.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('barrel registry');

ok('BARREL_TYPES is an ordered list with exactly wood/explosive/coin', () => {
  assert.deepEqual(
    BARREL_TYPES.map((t) => t.id),
    ['wood', 'explosive', 'coin'],
  );
});

ok('every entry carries a non-empty display label', () => {
  for (const t of BARREL_TYPES) {
    assert.equal(typeof t.label, 'string', `${t.id}: label missing`);
    assert.ok(t.label.length > 0, `${t.id}: label empty`);
  }
});

ok('barrelById resolves every id to its own entry', () => {
  for (const t of BARREL_TYPES) {
    assert.equal(barrelById[t.id], t, `barrelById[${t.id}] mismatch`);
  }
});

ok('isBarrelType accepts known ids and rejects unknowns', () => {
  for (const t of BARREL_TYPES) assert.ok(isBarrelType(t.id), `${t.id} rejected`);
  assert.ok(!isBarrelType('jester'), 'enemy id leaked into barrel family');
  assert.ok(!isBarrelType('random'), "'random' is not a concrete type");
  assert.ok(!isBarrelType(undefined), 'undefined rejected');
  assert.ok(!isBarrelType(null), 'null rejected');
  assert.ok(!isBarrelType('Wood'), 'ids are case-sensitive');
});

console.log(`${passed} passed`);
