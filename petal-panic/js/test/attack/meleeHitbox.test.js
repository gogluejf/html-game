// Task 1.6 — Melee Hitbox primitive tests (pure logic, no DOM).
// Run: node js/test/attack/meleeHitbox.test.js

import { strict as assert } from 'node:assert';
import { meleeBox, stepMelee } from '../../combat/attack/primitives/meleeHitbox.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { LAYER } from '../../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });
const P = { activeFrames: 4, w: 40, h: 32, offset: { x: 30, y: 0 }, damage: 12, team: 'ally', method: 'melee' };

/** Dummy enemy on the ENEMY layer with a takeDamage pipeline. */
function dummyEnemy(x, y, hp = 30) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

ok('box is centered on attacker + offset', () => {
  const ctx = makeContext(attacker(), {});
  const box = meleeBox(P, ctx);
  // attacker center (116,116) + offset (30,0) → (146,116); box 40x32.
  assert.ok(Math.abs(box.x - 126) < 1e-9, `x=${box.x}`);
  assert.ok(Math.abs(box.y - 100) < 1e-9, `y=${box.y}`);
  assert.equal(box.w, 40); assert.equal(box.h, 32);
});

ok('marker offset resolves via sprite-crop schema', () => {
  const a = attacker();
  a.markers = [{ label: 'fist', x: 28, y: 4 }];
  const ctx = makeContext(a, {});
  const box = meleeBox({ ...P, offset: 'fist' }, ctx);
  // marker at attacker-relative (28,4) → world (128,104)
  assert.ok(Math.abs(box.x - (128 - 20)) < 1e-9, `x=${box.x}`);
  assert.ok(Math.abs(box.y - (104 - 16)) < 1e-9, `y=${box.y}`);
});

ok('hit: overlapping enemy takes damage once per swing (hitSet)', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(140, 105); // inside the box
  const h = invoke('meleeHitbox', P, ctx);
  const seen = [];
  h.on('hit', (i) => seen.push(i.dealt));
  // Frame 1: hit lands.
  assert.equal(h.step([enemy]), false, 'still active mid-swing');
  // Frame 2: same target already in hitSet → no second hit.
  assert.equal(h.step([enemy]), false);
  assert.equal(enemy.hp, 18, 'damaged exactly once');
  assert.deepEqual(seen, [12]);
});

ok('action completes after activeFrames ticks', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('meleeHitbox', P, ctx);
  let done = false;
  h.on('complete', () => { done = true; });
  for (let i = 0; i < P.activeFrames - 1; i++) h.step([]);
  assert.equal(done, false, 'not complete before the last frame');
  assert.equal(h.step([]), true, 'last frame returns finished');
  assert.equal(done, true);
});

ok('step is idempotent after completion', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('meleeHitbox', P, ctx);
  for (let i = 0; i < P.activeFrames; i++) h.step([]);
  let n = 0;
  h.on('complete', () => n++);
  assert.equal(h.step([]), true);
  assert.equal(n, 0);
});

ok('team routing: foe team hits only the hero layer', () => {
  const hero = { x: 140, y: 105, w: 24, h: 24, alive: true, energy: 100, layer: LAYER.HERO, intangible: false, dying: false,
    takeDamage(amt) { this.energy -= amt; return amt; } };
  const enemy = dummyEnemy(140, 105);
  const ctx = makeContext(attacker(), {});
  const h = invoke('meleeHitbox', { ...P, team: 'foe' }, ctx);
  const seen = [];
  h.on('hit', (i) => seen.push(i.target === hero ? 'hero' : 'enemy'));
  h.step([hero, enemy]);
  assert.deepEqual(seen, ['hero'], 'only the hero-layer target was struck');
  assert.equal(enemy.hp, 30, 'enemy untouched by foe-team box');
});

ok('owner is never self-hit', () => {
  const a = attacker();
  a.layer = LAYER.ENEMY; // pretend the attacker is enemy-shaped
  const ctx = makeContext(a, {});
  const h = invoke('meleeHitbox', { ...P, team: 'neutral' }, ctx);
  const seen = [];
  h.on('hit', () => seen.push(1));
  h.step([a]);
  assert.deepEqual(seen, [], 'self-exclusion holds');
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
