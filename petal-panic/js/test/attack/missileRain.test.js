// Missile Rain macro tests (pure logic, no DOM).
// Run: node --test petal-panic/js/test/attack/missileRain.test.js

import { strict as assert } from 'node:assert';
import '../../combat/attack/primitives/projectile.js';
import '../../combat/attack/primitives/explosion.js';
import '../../combat/attack/macros/explosiveProjectile.js';
import '../../combat/attack/macros/skyMissile.js';
import { resolvePositions, resolveOrder } from '../../combat/attack/macros/missileRain.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { Pool, Projectile, Special } from '../../objects/projectile.js';
import { LAYER } from '../../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const GROUND_Y = 400;
const attacker = () => ({ x: 300, y: GROUND_Y - 48, w: 32, h: 48 });

function ctx(extra = {}) {
  return makeContext(attacker(), {
    world: { targets: [], hero: null },
    effects: { spawnHitSparkles() {}, fireManual() {}, triggerShake() {}, spawnExplosion() {}, bigExplosion() {} },
    groundY: GROUND_Y,
    pools: { projectilePool: new Pool(Projectile, 32), specialPool: new Pool(Special, 8) },
    ...extra,
  });
}

function dummyEnemy(x, y, hp = 100) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

// --- Position math -----------------------------------------------------------

ok('fixed: symmetric around the center', () => {
  const xs = resolvePositions({ count: 5, xCoordinate: 480, distanceType: 'fixed', distance: 90, margin: 40 });
  assert.equal(xs.length, 5);
  assert.deepEqual(xs, [300, 390, 480, 570, 660], `got ${xs}`);
});

ok('fixed: pattern that overflows the view is shrunk to fit', () => {
  // center 480, d=300, n=5 → raw span 1200..840 would exit [40, 920].
  const xs = resolvePositions({ count: 5, xCoordinate: 480, distanceType: 'fixed', distance: 300, margin: 40 });
  assert.ok(Math.min(...xs) >= 40, `min inside (${Math.min(...xs)})`);
  assert.ok(Math.max(...xs) <= 920, `max inside (${Math.max(...xs)})`);
  // Still symmetric around the center.
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  assert.ok(Math.abs(mid - 480) < 1, `symmetric (${mid})`);
});

ok('relative: evenly distributed edge-to-edge across the usable span', () => {
  const xs = resolvePositions({ count: 4, xCoordinate: 480, distanceType: 'relative', distance: 0, margin: 40 });
  assert.equal(xs.length, 4);
  assert.ok(Math.abs(xs[0] - 40) < 1e-9, `first at span start (${xs[0]})`);
  assert.ok(Math.abs(xs[3] - 920) < 1e-9, `last at span end (${xs[3]})`);
  const gaps = [1, 2, 3].map((i) => xs[i] - xs[i - 1]);
  assert.ok(gaps.every((g) => Math.abs(g - gaps[0]) < 1e-9), `even gaps (${gaps})`);
});

ok('count 1 collapses to the clamped center', () => {
  const xs = resolvePositions({ count: 1, xCoordinate: 500, distanceType: 'fixed', distance: 90, margin: 40 });
  assert.deepEqual(xs, [500]);
});

// --- Sequential coordination --------------------------------------------------

ok('from_left: natural order', () => {
  assert.deepEqual(resolveOrder(4, 'from_left'), [0, 1, 2, 3]);
});

ok('from_right: reversed order', () => {
  assert.deepEqual(resolveOrder(4, 'from_right'), [3, 2, 1, 0]);
});

ok('random: a permutation of the same indices (deterministic with seeded rng)', () => {
  let seed = 42;
  const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const order = resolveOrder(5, 'random', rng);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4], 'permutation');
});

// --- Sequence ------------------------------------------------------------------

ok('sequence: launch → rain → complete, all missiles activated', () => {
  const c = ctx();
  const h = invoke('missileRain', {
    count: 3, xCoordinate: 480, distanceType: 'fixed', distance: 120,
    pattern: 'simultaneous', launchInterval: 0.1, timeToTarget: 0.2, descentSpeed: 600, dropHeight: 120,
  }, c);
  const phases = new Set();
  let finished = false;
  for (let i = 0; i < 1200 && !finished; i++) {
    c.pools.projectilePool.updateAll(DT);
    finished = h.step(DT, []);
    phases.add(h.state.phase);
  }
  assert.ok(finished, 'completes');
  assert.ok(phases.has('launch'), 'had a launch phase');
  assert.ok(phases.has('rain'), 'had a rain phase');
  assert.equal(h.state.missiles.length, 3, `all 3 missiles activated (${h.state.missiles.length})`);
});

ok('sequential: activation order follows coordination (from_right drops rightmost first)', () => {
  const c = ctx();
  const h = invoke('missileRain', {
    count: 3, xCoordinate: 480, distanceType: 'fixed', distance: 120,
    pattern: 'sequential', interval: 0.5, coordination: 'from_right',
    launchInterval: 0.1, timeToTarget: 0.1, descentSpeed: 600, dropHeight: 120,
  }, c);
  const activationXs = [];
  let finished = false;
  for (let i = 0; i < 1200 && !finished; i++) {
    c.pools.projectilePool.updateAll(DT);
    finished = h.step(DT, []);
    if (h.state.missiles.length > activationXs.length) {
      activationXs.push(h.state.missiles[activationXs.length].state.impact.x);
    }
  }
  assert.ok(finished);
  assert.equal(activationXs.length, 3, `all activated (${activationXs})`);
  // Rightmost position activates first → impacts strictly decreasing in x.
  assert.ok(activationXs[0] > activationXs[1] && activationXs[1] > activationXs[2],
    `right-to-left order (${activationXs})`);
});

ok('sequential: activation gaps are EVEN for every coordination (no double-drops)', () => {
  // Regression: the drop schedule once mixed in the per-position launch
  // stagger (posIdx·launchInterval), so from_right's first two slots landed
  // closer together than `interval` — close to simultaneous drops. Gaps must
  // be exactly `interval` no matter the order.
  const interval = 0.35;
  for (const coordination of ['from_left', 'from_right', 'random']) {
    let seed = 7;
    const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const c = ctx();
    const h = invoke('missileRain', {
      count: 4, xCoordinate: 480, distanceType: 'fixed', distance: 120,
      pattern: 'sequential', interval, coordination,
      launchInterval: 0.12, timeToTarget: 0.1, descentSpeed: 600, dropHeight: 120,
    }, c);
    const times = [];
    let prevLen = 0, finished = false;
    for (let i = 0; i < 1200 && !finished; i++) {
      c.pools.projectilePool.updateAll(DT);
      finished = h.step(DT, []);
      if (h.state.missiles.length > prevLen) times.push(h.state.t);
      prevLen = h.state.missiles.length;
    }
    assert.equal(times.length, 4, `${coordination}: all activated`);
    for (let k = 1; k < times.length; k++) {
      const gap = times[k] - times[k - 1];
      assert.ok(Math.abs(gap - interval) < DT * 1.5,
        `${coordination}: gap[${k}] = ${gap.toFixed(3)} ≈ ${interval}`);
    }
  }
});

ok('a target under one of the marked spots takes a blast', () => {
  // Pattern centered at 480 with spacing 120 → drops at 360/480/600.
  const e = dummyEnemy(480 - 12, GROUND_Y - 24); // under the center drop
  const c = ctx();
  c.world.targets = [e];
  const h = invoke('missileRain', {
    count: 3, xCoordinate: 480, distanceType: 'fixed', distance: 120,
    pattern: 'simultaneous', launchInterval: 0.05, timeToTarget: 0.2, descentSpeed: 600, dropHeight: 120, damage: 30, radius: 60,
  }, c);
  let finished = false;
  for (let i = 0; i < 1200 && !finished; i++) {
    c.pools.projectilePool.updateAll(DT);
    finished = h.step(DT, [e]);
    // Sandbox-style contact resolution for the falling carriers.
    for (const m of h.state.missiles) {
      const ent = m.state?.missile?.entity;
      if (ent?.alive && e.alive &&
          ent.x < e.x + e.w && ent.x + ent.w > e.x &&
          ent.y < e.y + e.h && ent.y + ent.h > e.y) {
        e.takeDamage(ent.damage ?? 30);
        ent._attackHit = true;
        ent.alive = false;
      }
    }
  }
  assert.ok(finished, 'completes');
  assert.ok(e.hp < 100, `target damaged (hp=${e.hp})`);
});

console.log(`\nmissileRain: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
