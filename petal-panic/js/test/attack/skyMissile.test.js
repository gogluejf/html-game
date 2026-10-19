// Sky Missile macro tests (pure logic, no DOM).
// Run: node --test petal-panic/js/test/attack/skyMissile.test.js

import { strict as assert } from 'node:assert';
import '../../combat/attack/primitives/projectile.js'; // register carrier primitive
import '../../combat/attack/primitives/explosion.js';  // register blast primitive
import '../../combat/attack/macros/explosiveProjectile.js';
import { Pool, Projectile, Special } from '../../objects/projectile.js';
import { resolveImpactPoint } from '../../combat/attack/macros/skyMissile.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { LAYER } from '../../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const GROUND_Y = 400;
const attacker = () => ({ x: 300, y: GROUND_Y - 48, w: 32, h: 48 });

function pools() {
  return { projectilePool: new Pool(Projectile, 16), specialPool: new Pool(Special, 4) };
}

function ctx(extra = {}) {
  return makeContext(attacker(), {
    world: { targets: [], hero: null },
    effects: { spawnHitSparkles() {}, fireManual() {}, triggerShake() {}, spawnExplosion() {}, bigExplosion() {} },
    groundY: GROUND_Y,
    pools: pools(),
    ...extra,
  });
}

function dummyEnemy(x, y, hp = 100) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

// --- Column resolution -------------------------------------------------------

ok('impact defaults to the floor when nothing is in the column', () => {
  const pt = resolveImpactPoint({ x: 500, groundY: null }, { groundY: GROUND_Y, platforms: [] });
  assert.deepEqual(pt, { x: 500, y: GROUND_Y });
});

ok('impact lands on a platform top inside the column (highest surface wins)', () => {
  const platTop = GROUND_Y - 70;
  const pt = resolveImpactPoint(
    { x: 500, groundY: null },
    { groundY: GROUND_Y, platforms: [{ x: 450, y: platTop, w: 100 }] },
  );
  assert.deepEqual(pt, { x: 500, y: platTop });
});

ok('platforms OUTSIDE the column are ignored', () => {
  const pt = resolveImpactPoint(
    { x: 900, groundY: null },
    { groundY: GROUND_Y, platforms: [{ x: 450, y: GROUND_Y - 70, w: 100 }] },
  );
  assert.equal(pt.y, GROUND_Y, 'no platform under x=900 → floor');
});

ok('the HIGHEST platform in the column wins', () => {
  const pt = resolveImpactPoint(
    { x: 500, groundY: null },
    { groundY: GROUND_Y, platforms: [
      { x: 450, y: GROUND_Y - 40, w: 100 },
      { x: 450, y: GROUND_Y - 90, w: 100 },
    ] },
  );
  assert.equal(pt.y, GROUND_Y - 90, `highest top (${pt.y})`);
});

ok('explicit groundY param overrides the column lookup', () => {
  const pt = resolveImpactPoint(
    { x: 500, groundY: 123 },
    { groundY: GROUND_Y, platforms: [{ x: 450, y: GROUND_Y - 70, w: 100 }] },
  );
  assert.equal(pt.y, 123);
});

// --- Sequence ----------------------------------------------------------------

ok('sequence: warning → drop → complete', () => {
  const c = ctx();
  const h = invoke('skyMissile', { x: 500, timeToTarget: 0.2, dropHeight: 120, fallSpeed: 600 }, c);
  const phases = new Set();
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    c.pools.projectilePool.updateAll(DT); // real bullet flight + TTL death
    finished = h.step(DT, []);
    phases.add(h.state.phase);
  }
  assert.ok(finished, 'completes');
  assert.ok(phases.has('warning'), 'had a warning phase');
  assert.ok(phases.has('drop'), 'had a drop phase');
});

ok('impact point is resolved at invoke and exposed on state', () => {
  const platTop = GROUND_Y - 70;
  const c = ctx({ platforms: [{ x: 450, y: platTop, w: 100 }] });
  const h = invoke('skyMissile', { x: 500, timeToTarget: 0.2 }, c);
  assert.deepEqual(h.state.impact, { x: 500, y: platTop });
});

ok('zero timeToTarget drops immediately (no warning window)', () => {
  const h = invoke('skyMissile', { x: 500, timeToTarget: 0, dropHeight: 120, fallSpeed: 600 }, ctx());
  h.step(DT, []);
  assert.equal(h.state.phase, 'drop', `phase after first step (${h.state.phase})`);
  assert.ok(h.state.missile, 'missile launched');
});

ok('a target standing at the marked spot takes the blast', () => {
  const e = dummyEnemy(500 - 12, GROUND_Y - 24); // centered under the drop x
  const c = ctx();
  c.world.targets = [e];
  const h = invoke('skyMissile', { x: 500, timeToTarget: 0.1, dropHeight: 120, fallSpeed: 600, damage: 30, radius: 60 }, c);
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    c.pools.projectilePool.updateAll(DT);
    finished = h.step(DT, [e]);
    // Sandbox-style contact resolution: the falling carrier body vs the
    // target (the theater/gameplay collision handler does this in-engine).
    const ent = h.state.missile?.entity;
    if (ent?.alive && e.alive &&
        ent.x < e.x + e.w && ent.x + ent.w > e.x &&
        ent.y < e.y + e.h && ent.y + ent.h > e.y) {
      e.takeDamage(ent.damage ?? 30);
      ent._attackHit = true;
      ent.alive = false;
    }
  }
  assert.ok(finished, 'completes');
  assert.ok(e.hp < 100, `target damaged (hp=${e.hp})`);
});

ok('a target far from the marked spot is untouched', () => {
  const e = dummyEnemy(900, GROUND_Y - 24); // nowhere near x=500
  const c = ctx();
  c.world.targets = [e];
  const h = invoke('skyMissile', { x: 500, timeToTarget: 0.1, dropHeight: 120, fallSpeed: 600, damage: 30, radius: 60 }, c);
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    c.pools.projectilePool.updateAll(DT);
    finished = h.step(DT, [e]);
  }
  assert.ok(finished);
  assert.equal(e.hp, 100, 'far target untouched');
});

ok('the missile detonates ON the platform top, not below it (marker/blast agree)', () => {
  // Regression: plain projectiles phase through terrain. Without the surface
  // landing check the carrier falls past the platform and fizzles at TTL —
  // the blast lands BELOW the marker. The death point must be the impact line.
  const platTop = GROUND_Y - 70;
  const c = ctx({ platforms: [{ x: 450, y: platTop, w: 100 }] });
  const h = invoke('skyMissile', { x: 500, timeToTarget: 0.1, dropHeight: 200, fallSpeed: 400, damage: 30, radius: 60 }, c);
  let deathY = null;
  h.state.missile?.on?.('detonate', ({ y }) => { deathY = y; });
  // Watch the carrier entity directly: record its bottom when it dies.
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    const ent = h.state.missile?.entity;
    c.pools.projectilePool.updateAll(DT);
    finished = h.step(DT, []);
    if (ent && !ent.alive && deathY == null) deathY = ent.y + ent.h;
  }
  assert.ok(finished, 'completes');
  assert.ok(deathY != null, 'carrier died');
  // It must die AT the platform top (within one frame of travel), not keep
  // falling to the floor or fizzle at TTL below the platform.
  assert.ok(Math.abs(deathY - platTop) <= 400 * DT + 1,
    `death at platform top (${deathY} vs ${platTop})`);
  assert.ok(deathY < GROUND_Y - 20, 'did NOT fall through to the floor');
});

console.log(`\nskyMissile: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
