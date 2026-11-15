// Task 3.2 — node-based unit tests for melee swing + central damage routing.
// Run: node js/test/melee.test.js
// No DOM needed: entity.js / consts.js / hero.js / damage.js are pure modules.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero/hero.js';
import { HEROES } from '../hero/heroDefs.js';
import { LAYER } from '../consts.js';
import { Entity } from '../core/entity.js';
import { heroDamage as damage } from '../combat/damage.js';
import { createTrace } from '../stats.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// --- Helpers -----------------------------------------------------------------
function makeHero() {
  return new Hero(HEROES.scarlet, 0, 0); // attack 10, defense 2
}
function makeEnemy(x, y, hp = 20, def = 0) {
  const e = new Entity({ x, y, w: 36, h: 40, gravity: 0, layer: LAYER.ENEMY });
  e.hp = hp; e.maxHp = hp; e.type = 'target';
  if (def > 0) e.defense = def; // explicit defense override (placeholder target)
  return e;
}
// Advance a swing to a specific integer frame index without running update().
function setSwingFrame(h, idx) {
  h.meleeActive = true;
  h.meleeFrame = idx;
}

console.log('Melee state init');
ok('default: no active swing, zero cooldown', () => {
  const h = makeHero();
  assert.equal(h.meleeActive, false);
  assert.equal(h.meleeCooldown, 0);
  assert.equal(h.meleeHitboxWorld, null);
});
ok('swing constants per spec (sheet-driven duration)', () => {
  const h = makeHero();
  assert.equal(h.MELEE_TOTAL_FRAMES, 5);
  assert.equal(h.MELEE_ACTIVE_FRAME, 3);
  // §30 v2: no sheet attached in node tests → legacy 0.4s fallback; with a
  // sheet the getter returns the live cycleDuration instead.
  assert.ok(approx(h.MELEE_DURATION, 0.4));
  assert.ok(approx(h.MELEE_FRAME_DURATION, 0.4 / h.MELEE_TOTAL_FRAMES));
});

console.log('tryMelee / cooldown');
ok('tryMelee starts a swing and sets full cooldown', () => {
  const h = makeHero();
  h.tryMelee();
  assert.equal(h.meleeActive, true);
  assert.ok(approx(h.meleeCooldown, h.MELEE_DURATION), `cd=${h.meleeCooldown}`);
});
ok('cannot re-swing while active (no spam)', () => {
  const h = makeHero();
  h.tryMelee();
  const cdBefore = h.meleeCooldown;
  h.tryMelee(); // ignored
  assert.ok(approx(h.meleeCooldown, cdBefore));
  assert.equal(h.meleeFrame, 0); // still at start of first swing
});
ok('cooldown decrements over time via updateMelee', () => {
  const h = makeHero();
  h.tryMelee();
  h.updateMelee(0.1);
  assert.ok(h.meleeCooldown < h.MELEE_DURATION && h.meleeCooldown > 0);
});

console.log('active-frame window (sheet-only contract)');
ok('hitbox is null on every swing frame without an authored sheet box', () => {
  const h = makeHero();
  for (const f of [0, 1, 2, 3, 4]) {
    setSwingFrame(h, f);
    assert.equal(h.meleeHitboxWorld, null, `frame ${f} → no sheet boxes in node tests → null`);
  }
});
ok('hitbox null when not swinging at all', () => {
  const h = makeHero();
  h.meleeActive = false;
  assert.equal(h.meleeHitboxWorld, null);
});
ok('updateMelee ends the swing after total frames', () => {
  const h = makeHero();
  h.tryMelee();
  h.updateMelee(h.MELEE_DURATION + 0.01); // run past the end (sheet-driven duration)
  assert.equal(h.meleeActive, false);
  assert.equal(h.meleeFrame, 0);
  assert.equal(h.meleeHitboxWorld, null);
});

console.log('central damage() — defense + telemetry (acceptance #2)');
ok('reduces by target defense override, floors at 1', () => {
  const src = makeHero(); // attack 10, own defense 2
  const tgt = makeEnemy(0, 0, 100, 4); // explicit defense override = 4
  const real = damage(src, tgt, 10, 'melee');
  assert.equal(real, 6, `real=${real} want 10-4`);
  assert.equal(tgt.hp, 94);
});
ok('minimum 1 damage even when defense >= attack', () => {
  const src = makeHero();
  const tgt = makeEnemy(0, 0, 100, 50);
  const real = damage(src, tgt, 10, 'melee');
  assert.equal(real, 1);
  assert.equal(tgt.hp, 99);
});
ok('no defense → full raw amount', () => {
  const src = makeHero();
  const tgt = makeEnemy(0, 0, 100, 0);
  const real = damage(src, tgt, 10, 'projectile');
  assert.equal(real, 10);
});
ok('hero vs hero: target defense DOES reduce incoming damage', () => {
  // Hero B has stats.defense = 2 (from scarlet def). When hero A deals 10 raw,
  // B's defense mitigates it to 8. This is correct: defense protects the target.
  const a = makeHero();
  const b = makeHero();
  b.energy = 100;
  const real = damage(a, b, 10, 'contact');
  assert.equal(real, 8, `expected 8 (10 - target def 2), got ${real}`);
  assert.equal(b.energy, 92);
});
ok('updates source telemetry (hitsLanded) into the trace', () => {
  const src = makeHero();
  src.traceStats = createTrace();
  const tgt = makeEnemy(0, 0, 100, 0);
  damage(src, tgt, 10, 'melee');
  damage(src, tgt, 10, 'melee');
  assert.equal(src.traceStats.total.hitsLanded.melee, 2);
});
ok('drains hero energy (not hp) for hero targets', () => {
  const src = makeHero();
  const heroTgt = makeHero();
  heroTgt.energy = 100;
  // Hero target has stats.defense = 2, so 10 raw → 8 real.
  const real = damage(src, heroTgt, 10, 'contact');
  assert.equal(real, 8);
  assert.equal(heroTgt.energy, 92);
});
ok('returns 0 and does nothing if target already dead', () => {
  const src = makeHero();
  const tgt = makeEnemy(0, 0, 100, 0);
  tgt.alive = false;
  const before = tgt.hp;
  const real = damage(src, tgt, 10, 'melee');
  assert.equal(real, 0);
  assert.equal(tgt.hp, before);
});
ok('flags alive=false when HP drops to <= 0', () => {
  const src = makeHero();
  const tgt = makeEnemy(0, 0, 5, 0);
  damage(src, tgt, 10, 'melee');
  assert.equal(tgt.alive, false);
});
ok('works with no combatStats on source (no crash)', () => {
  const src = makeEnemy(0, 0, 100, 0); // enemy source, no combatStats
  const tgt = makeEnemy(0, 0, 100, 0);
  const real = damage(src, tgt, 7, 'melee');
  assert.equal(real, 7);
});

console.log('\nMelee + damage integration');
ok('melee attack value routes through damage() to kill a target', () => {
  const h = makeHero();
  h.traceStats = createTrace();
  const e = makeEnemy(0, 0, 20, 0); // 20hp, hero attack 10 → 2 swings
  // Simulate two active-frame hits (damage routing is sheet-independent).
  const dealt1 = damage(h, e, h.stats.attack, 'melee');
  assert.equal(dealt1, 10);
  assert.equal(e.alive, true);
  const dealt2 = damage(h, e, h.stats.attack, 'melee');
  assert.equal(dealt2, 10);
  assert.equal(e.alive, false);
  assert.equal(h.traceStats.total.hitsLanded.melee, 2);
});

console.log(`\n${passed} assertions passed.`);
