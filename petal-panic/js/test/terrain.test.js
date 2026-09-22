// Petal Panic — terrain.js tests (terrain grammar + seeded RNG).
// Run: node --test petal-panic/js/test/terrain.test.js
//
// Pure module (no DOM). We assert the grammar invariants and the per-game
// determinism contract, not pixel tuning:
//   - same seed → identical sequence of generation choices (across calls)
//   - blocks: solid, 1w, heights 1/2/3, rising from ground, not one-way
//   - platforms: one-way, widths 1/2/3, tiers 1/2/3, thin, not solid
//   - tier spacing is double-jump reachable with margin for BOTH heroes

import { strict as assert } from 'node:assert';
import {
  createRng,
  hashSeed,
  BLOCK,
  PLATFORM,
  makeBlock,
  makePlatform,
  doubleJumpReach,
  minHeroDoubleJumpReach,
  maxClearableStep,
  tierToOffset,
  HERO_REACH,
  REACH_MARGIN,
  GRAVITY,
  DOUBLE_JUMP_FACTOR,
} from '../terrain.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('Seeded RNG — determinism');
ok('same numeric seed produces an identical stream', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next(), `diverges at step ${i}`);
});

ok('different seeds produce different streams', () => {
  const a = createRng(1);
  const b = createRng(2);
  let same = 0;
  for (let i = 0; i < 32; i++) if (a.next() === b.next()) same++;
  assert.ok(same < 32, 'two seeds should not share an entire 32-step prefix');
});

ok('next() always yields floats in [0, 1)', () => {
  const r = createRng(99);
  for (let i = 0; i < 5000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

ok('int() returns inclusive integers within [min, max]', () => {
  const r = createRng(7);
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const v = r.int(1, 3);
    assert.ok(Number.isInteger(v), `not an integer: ${v}`);
    assert.ok(v >= 1 && v <= 3, `out of range: ${v}`);
    seen.add(v);
  }
  // With 20k draws across 3 buckets, all three must appear.
  assert.deepEqual([...seen].sort(), [1, 2, 3], 'all values in range must be reachable');
});

ok('pick() only returns elements of the array', () => {
  const r = createRng(42);
  const arr = [10, 20, 30];
  const seen = new Set();
  for (let i = 0; i < 10000; i++) {
    const v = r.pick(arr);
    assert.ok(arr.includes(v), `picked value not in array: ${v}`);
    seen.add(v);
  }
  assert.equal(seen.size, 3, 'every element must be pickable');
});

ok('pick() throws on an empty array (no silent failure)', () => {
  const r = createRng(1);
  assert.throws(() => r.pick([]), /empty array/);
});

ok('string seed is deterministic and hash-based', () => {
  const a = createRng('big-top-1');
  const b = createRng('big-top-1');
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
  assert.equal(typeof hashSeed('big-top-1'), 'number');
  assert.equal(hashSeed('big-top-1'), hashSeed('big-top-1'), 'same string → same hash');
});

console.log('Seeded RNG — per-game generation choices');
ok('same seed reproduces an identical block/platform choice sequence', () => {
  // Simulate what a macro composer would do: draw a run of terrain choices.
  function rollChoices(seed) {
    const r = createRng(seed);
    const out = [];
    for (let i = 0; i < 40; i++) {
      const isBlock = r.next() < 0.5;
      if (isBlock) out.push({ kind: 'block', h: r.int(1, 3) });
      else out.push({ kind: 'platform', w: r.int(1, 3), tier: r.int(1, 3) });
    }
    return out;
  }
  const first = rollChoices(20240517);
  const again = rollChoices(20240517); // "regenerate" after death/continue
  assert.deepEqual(again, first, 'same seed must rebuild the SAME world, not re-roll');
  assert.ok(first.length === 40, 'sequence length preserved');
});

ok('a different seed yields a different choice sequence', () => {
  function rollChoices(seed) {
    const r = createRng(seed);
    const out = [];
    for (let i = 0; i < 40; i++) {
      const isBlock = r.next() < 0.5;
      if (isBlock) out.push({ kind: 'block', h: r.int(1, 3) });
      else out.push({ kind: 'platform', w: r.int(1, 3), tier: r.int(1, 3) });
    }
    return out;
  }
  assert.notDeepEqual(rollChoices(1), rollChoices(2), 'different seeds → different world');
});

console.log('Block grammar (structure.md §5)');
ok('BLOCK grammar: 1 width unit, heights 1/2/3, solid, not one-way', () => {
  assert.deepEqual(BLOCK.widths, [1]);
  assert.deepEqual(BLOCK.heights, [1, 2, 3]);
  assert.equal(BLOCK.solid, true);
  assert.equal(BLOCK.oneWay, false);
  assert.equal(BLOCK.risesFromGround, true);
});

ok('makeBlock() builds a solid, ground-rising unit for each height', () => {
  for (const h of [1, 2, 3]) {
    const b = makeBlock(h);
    assert.equal(b.kind, 'block');
    assert.equal(b.width, 1, 'always one width unit');
    assert.equal(b.height, h);
    assert.equal(b.solid, true, 'solid from every side');
    assert.equal(b.oneWay, false, 'a block is never one-way');
  }
});

ok('makeBlock() encodes a solid AABB rising from the ground', () => {
  for (const h of [1, 2, 3]) {
    const b = makeBlock(h);
    assert.equal(b.risesFromGround, true, 'flagged as rising from ground');
    assert.ok(b.aabb, 'must expose a placement AABB');
    assert.equal(b.aabb.x, 0, 'local origin x=0 (composer assigns world x)');
    assert.equal(b.aabb.y, 0, 'base sits on the ground (y=0)');
    assert.equal(b.aabb.w, 1, 'one width unit');
    assert.equal(b.aabb.h, h, 'height matches the requested units');
    // Top edge = y + h rises above the ground.
    assert.equal(b.aabb.y + b.aabb.h, h, 'top surface is `height` above ground');
  }
});

ok('makeBlock() rejects invalid heights', () => {
  assert.throws(() => makeBlock(0), /height/);
  assert.throws(() => makeBlock(4), /height/);
  assert.throws(() => makeBlock(1.5), /height/);
});

console.log('Platform grammar (structure.md §5)');
ok('PLATFORM grammar: widths 1/2/3, tiers 1/2/3, one-way, one thickness, not solid', () => {
  assert.deepEqual(PLATFORM.widths, [1, 2, 3]);
  assert.deepEqual(PLATFORM.tiers, [1, 2, 3]);
  assert.equal(PLATFORM.oneWay, true);
  assert.equal(PLATFORM.thickness, 1);
  assert.equal(PLATFORM.solid, false);
});

ok('makePlatform() builds a one-way unit for every width/tier combo', () => {
  for (const w of [1, 2, 3]) {
    for (const t of [1, 2, 3]) {
      const p = makePlatform(w, t);
      assert.equal(p.kind, 'platform');
      assert.equal(p.width, w);
      assert.equal(p.tier, t);
      assert.equal(p.thickness, 1, 'one platform thickness');
      assert.equal(p.oneWay, true, 'one-way landing surface');
      assert.equal(p.solid, false, 'not a solid block');
    }
  }
});

ok('makePlatform() encodes a one-way AABB at the tier elevation', () => {
  for (const w of [1, 2, 3]) {
    for (const t of [1, 2, 3]) {
      const p = makePlatform(w, t);
      assert.ok(p.aabb, 'must expose a placement AABB');
      assert.equal(p.aabb.x, 0, 'local origin x=0 (composer assigns world x)');
      assert.equal(p.aabb.w, w, 'width matches the requested units');
      assert.equal(p.aabb.h, 1, 'one platform thickness');
      // Top edge (the landing face) sits exactly at the tier's elevation.
      assert.equal(p.aabb.y, tierToOffset(t), 'top surface at the tier offset');
      assert.ok(p.aabb.y > 0, 'a platform floats above the ground');
    }
  }
});

ok('makePlatform() rejects invalid widths and tiers', () => {
  assert.throws(() => makePlatform(0, 1), /width/);
  assert.throws(() => makePlatform(4, 1), /width/);
  assert.throws(() => makePlatform(1, 0), /tier/);
  assert.throws(() => makePlatform(1, 4), /tier/);
});

console.log('Double-jump reach + tier spacing (generation.md §6, structure.md §5)');
ok('doubleJumpReach matches the hero physics formula', () => {
  for (const [id, def] of Object.entries(HERO_REACH)) {
    const groundApex = (def.jump * def.jump) / (2 * GRAVITY);
    const doubleImpulse = DOUBLE_JUMP_FACTOR * def.jump;
    const doubleApex = (doubleImpulse * doubleImpulse) / (2 * GRAVITY);
    assert.ok(Math.abs(doubleJumpReach(id) - (groundApex + doubleApex)) < 1e-9, id);
  }
});

ok('the weakest hero governs the reach bound', () => {
  // Balthazar (jump 420) has the smaller reach; the min must equal his.
  assert.ok(Math.abs(minHeroDoubleJumpReach() - doubleJumpReach('balthazar')) < 1e-9);
  assert.ok(doubleJumpReach('balthazar') < doubleJumpReach('scarlet'),
    'Balthazar is the binding (weaker) jumper');
});

ok('maxClearableStep reserves a usable margin below the min reach', () => {
  assert.ok(Math.abs(maxClearableStep() - (minHeroDoubleJumpReach() - REACH_MARGIN)) < 1e-9);
  assert.ok(maxClearableStep() < minHeroDoubleJumpReach(), 'margin must reduce the raw reach');
  assert.ok(maxClearableStep() > 0, 'a usable step must remain');
});

ok('every tier step is double-jump reachable for BOTH heroes', () => {
  const step = maxClearableStep();
  // Successive top-surface steps: ground→1, 1→2, 2→3 are each exactly `step`.
  for (const heroId of Object.keys(HERO_REACH)) {
    const reach = doubleJumpReach(heroId);
    assert.ok(step <= reach, `${heroId}: step ${step.toFixed(2)} must be ≤ reach ${reach.toFixed(2)}`);
    // And with margin: the step is comfortably below the apex, not a perfect jump.
    assert.ok(step < reach, `${heroId}: step must leave margin below the apex`);
  }
});

ok('tierToOffset yields monotonically increasing, equal-spaced elevations', () => {
  const offsets = [0, 1, 2, 3].map(tierToOffset);
  assert.equal(offsets[0], 0, 'ground (tier 0) is at offset 0');
  for (let t = 1; t <= 3; t++) {
    assert.ok(offsets[t] > offsets[t - 1], `tier ${t} must be higher than tier ${t - 1}`);
  }
  // Equal spacing between consecutive tiers.
  const step = offsets[1] - offsets[0];
  for (let t = 2; t <= 3; t++) {
    assert.ok(Math.abs((offsets[t] - offsets[t - 1]) - step) < 1e-9, `uneven spacing at tier ${t}`);
  }
});

ok('tierToOffset rejects out-of-range tiers', () => {
  assert.throws(() => tierToOffset(0.5), /tier/);
  assert.throws(() => tierToOffset(-1), /tier/);
  assert.throws(() => tierToOffset(4), /tier/);
});

console.log(`\n${passed} passed`);
