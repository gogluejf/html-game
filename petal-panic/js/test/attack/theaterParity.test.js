// Theater vs gameplay parity regression tests (theater-cleanup plan, step 8).
//
// The attack theater is now a pure host/staging layer: bomb family routes
// through the shared BombAttackHost, projectile hits route through a
// CollisionWorld 'hit' handler mirroring the gameplay PROJ_ALLY×ENEMY branch,
// staged victims are real Enemy instances, and hit-flash is owned by the
// damage pipeline. These tests pin that parity at the shared seams so a
// future drift between sandbox and gameplay fails loudly.
//
// Run: node js/test/attack/theaterParity.test.js

import { strict as assert } from 'node:assert';
import { AttackTheater } from '../../debug/attack-theater.js';
import { Enemy } from '../../enemies/enemy.js';
import { BombAttackHost } from '../../combat/attack/bombAttackHost.js';
import { stepBombTerrain } from '../../combat/attack/primitives/bomb.js';
import { Pool, Special } from '../../objects/projectile.js';
import { LAYER } from '../../consts.js';
import '../../combat/attack/primitives/projectile.js';
import '../../combat/attack/primitives/bomb.js';
import '../../combat/attack/macros/index.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const GROUND_Y = 400;

// --- Helpers -----------------------------------------------------------------

/** Drive the theater headlessly: open, select an entry by id, run N frames. */
function runTheater(id, frames) {
  const t = AttackTheater;
  t.open();
  const idx = t.entries.indexOf(id);
  assert.ok(idx >= 0, `entry ${id} exists`);
  t.index = idx;
  t._loadParams();
  t._replay();
  for (let i = 0; i < frames; i++) t.update(DT * 2); // 2 sub-steps per call
  return t;
}

/** Collect deferred fireArea zones under a set of root handles. */
function collectZones(roots) {
  const zones = [];
  const walk = (h) => { for (const c of h.handles ?? []) { if (c.zone) zones.push(c.zone); walk(c); } };
  for (const h of roots ?? []) walk(h);
  return zones;
}

/** All live attack handles in the theater (direct + bomb-host roots). */
function allHandles(t) {
  return [...(t._handles ?? []), ...(t._bombHost?.roots ?? [])];
}

// --- 1. Theater module is a pure host -----------------------------------------

ok('theater imports headlessly and exposes the sandbox', () => {
  assert.equal(typeof AttackTheater.open, 'function');
  assert.equal(typeof AttackTheater._ctx, 'function');
});

// --- 2. Projectile hit routing (sandbox 'hit' handler ≈ gameplay branch) ------

ok('projectile hit routes through takeDamage + consume (HP drops)', () => {
  const t = runTheater('projectile', 90);
  assert.ok(t._log.some((l) => l.startsWith('HIT')), `log has HIT line: ${JSON.stringify(t._log.slice(0, 3))}`);
  assert.ok(t._target.hp < 999, `target hp decreased: ${t._target.hp}`);
  t.close();
});

ok('hit-flash field driven by the damage pipeline on theater target', () => {
  const t = runTheater('projectile', 30);
  assert.equal(typeof t._target.hitFlash, 'number');
  t.close();
});

// --- 3. Molotov: fire anchored to ground via shared host ----------------------

ok('molotov fire zone sits ON the ground (shared surface context)', () => {
  const t = runTheater('molotov', 60); // mid-burn: zone still alive
  const zones = collectZones(allHandles(t));
  assert.ok(zones.length >= 1, 'fire zone promoted by the shared host');
  for (const z of zones) {
    assert.ok(Math.abs(z.y + z.h - GROUND_Y) < 1, `zone bottom ${z.y + z.h} == ground ${GROUND_Y}`);
  }
  t.close();
});

// --- 4. Stomp victims are REAL enemies (actual damage pipeline) ---------------

ok('stomp victims are real Enemy instances with the death pipeline', () => {
  const t = runTheater('stomp', 300);
  assert.ok(t._stompVics?.length > 0, 'victims staged');
  for (const v of t._stompVics) {
    assert.ok(v instanceof Enemy, 'victim is a real Enemy');
    assert.equal(typeof v.takeDamage, 'function');
  }
  const hurt = t._stompVics.filter((v) => v.hp < 999 || !v.alive);
  assert.ok(hurt.length >= 1, `a victim was hit: ${hurt.length}/${t._stompVics.length}`);
  t.close();
});

// --- 5. Dash combo shove applies through the shared knockback path ------------

ok('dashCombo shoves the target (macro-owned applyKnockback)', () => {
  const t = runTheater('dashCombo', 180);
  const startX = 140 + 60; // staged next to the attacker home
  assert.ok(Math.abs(t._target.x - startX) > 4, `target displaced: ${Math.round(startX)} → ${Math.round(t._target.x)}`);
  t.close();
});

// --- 6. Shared-seam parity: same molotov, gameplay-shaped vs theater ctx ------

ok('molotov parity: identical zone placement across context shapes', () => {
  const params = { direction: -0.5, arc: 800, bounce: false, ttl: 2, damage: 12,
    fireWidth: 96, fireDuration: 3, fireTickRate: 5, fireDamage: 8 };
  const attacker = { x: 140, y: GROUND_Y - 48, w: 32, h: 48, alive: true, layer: LAYER.HERO };

  const run = (targets) => {
    const pool = new Pool(Special, 16);
    const ctx = { pools: { specialPool: pool }, groundY: GROUND_Y, platforms: [],
      bombTerrainStepped: true, world: { targets } };
    const host = new BombAttackHost(() => ctx);
    const h = host.spawn('molotov', { ...params }, attacker);
    let zones = [];
    for (let i = 0; i < 180; i++) {
      pool.updateAll(DT);
      // Same external terrain stepping both hosts rely on (gameplay pattern).
      for (const s of pool.items) if (s._attackId === 'bomb' && !s._attackDone) stepBombTerrain(s, DT, GROUND_Y);
      host.step(DT);
      const z = collectZones([h]);
      if (z.length > 0) zones = z; // remember the last live zone
    }
    return zones;
  };

  // Real Enemy target (gameplay shape) vs plain dummy (theater shape).
  const enemyTarget = new Enemy({ id: 't', name: 'T', w: 32, h: 48, stats: { stamina: 999, defense: 0, fly: false } }, 560, GROUND_Y - 48);
  const dummyTarget = { x: 560, y: GROUND_Y - 48, w: 32, h: 48, alive: true, hp: 999, layer: LAYER.ENEMY, hitFlash: 0 };
  const za = run([enemyTarget]);
  const zb = run([dummyTarget]);
  assert.ok(za.length >= 1 && zb.length >= 1, `both contexts promote a fire zone (${za.length}/${zb.length})`);
  assert.equal(Math.round(za[0].y), Math.round(zb[0].y), `same zone y: ${za[0].y} vs ${zb[0].y}`);
  assert.equal(Math.round(za[0].x), Math.round(zb[0].x), 'same zone x');
});

console.log(`\ntheaterParity: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
