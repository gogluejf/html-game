// Burst Shot macro tests (pure logic, no DOM).
// Run: node js/test/attack/burstShot.test.js

import { strict as assert } from 'node:assert';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { Pool, Projectile, Special } from '../../objects/projectile.js';
import { stepProjectile } from '../../combat/attack/primitives/projectile.js'; // burst invokes it natively
import '../../combat/attack/macros/burstShot.js';       // registers the macro

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const close = (a, b) => Math.abs(a - b) < 1e-9;

function pools() {
  return { projectilePool: new Pool(Projectile, 16), specialPool: new Pool(Special, 4) };
}
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 }); // center (116, 116)

ok('timed burst: one shot per interval, step-driven', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const h = invoke('burstShot', { count: 5, interval: 0.2, direction: 0, speed: 300, ttl: 5 }, ctx);
  assert.equal(h.handles.length, 0, 'nothing spawned before first step');
  assert.equal(typeof h.step, 'function', 'exposes step()');
  const spawnTimes = [];
  const DT = 1 / 60;
  // Step until the LAST shot has spawned: the first shot fires at t=0, so
  // shot N needs t >= (N-1)*interval — a little extra time is required.
  for (let f = 0; f < 400 && h.state.spawned < 5; f++) {
    const before = h.handles.length;
    h.step(DT);
    if (h.handles.length > before) spawnTimes.push(+(f * DT).toFixed(2));
  }
  assert.equal(h.handles.length, 5, 'all 5 spawned');
  // Gaps ≈ 0.2s (±1 frame of fixed-step quantization).
  for (let i = 1; i < spawnTimes.length; i++) {
    const gap = spawnTimes[i] - spawnTimes[i - 1];
    assert.ok(Math.abs(gap - 0.2) < 0.05, `gap[${i}] = ${gap}`);
  }
});

ok('completion is owned by the macro: early child death does NOT end the burst', () => {
  // Regression guard for the theater bug: a shot dying while later shots are
  // still pending must not complete the handle. (Bullets die via TTL — the
  // pool's updateAll drives entity.update, same as the theater host.)
  const { projectilePool } = pools();
  const ctx = makeContext(attacker(), { pools: { projectilePool, specialPool: new Pool(Special, 4) } });
  const h = invoke('burstShot', { count: 4, interval: 0.2, direction: 0, speed: 300, ttl: 5 }, ctx);
  const DT = 1 / 60;
  let completedAt = null;
  for (let f = 0; f < 600; f++) {
    projectilePool.updateAll(DT); // real bullet flight + TTL death
    const fin = h.step(DT);
    for (const ch of h.handles) stepProjectile(ch.entity, ch);
    if (fin && completedAt === null) completedAt = f * DT;
  }
  assert.equal(h.handles.length, 4, 'all 4 spawned');
  assert.ok(h._completed, 'completes after last shot dies');
  // Shot #1 died at ~5s; the burst must have outlived that (last shot spawns
  // at ~0.6s and lives until ~5.6s) — completion well after the first death.
  assert.ok(completedAt > 5.2, `completed too early: ${completedAt}s`);
});

ok('all shots fly the caller-computed direction (pattern-only, no targeting)', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const h = invoke('burstShot', { count: 3, interval: 0.2, direction: Math.PI / 4, speed: 300, ttl: 5 }, ctx);
  const DT = 1 / 60;
  for (let f = 0; f < 30 && h.handles.length < 3; f++) h.step(DT);
  assert.equal(h.handles.length, 3, 'all 3 spawned');
  for (const ch of h.handles) {
    const e = ch.entity;
    // Every shot shares the exact caller direction (45° down-right).
    assert.ok(Math.abs(e.vx - 300 * Math.cos(Math.PI / 4)) < 1e-6, `vx=${e.vx}`);
    assert.ok(Math.abs(e.vy - 300 * Math.sin(Math.PI / 4)) < 1e-6, `vy=${e.vy}`);
  }
});

ok('forwards hit with dealt damage', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const h = invoke('burstShot', { count: 2, interval: 0.1, direction: 0, speed: 300, ttl: 5, damage: 7 }, ctx);
  const seen = [];
  h.on('hit', (i) => seen.push(['hit', i.dealt]));
  h.step(1 / 60);
  h.handles[0]._emit('hit', { dealt: 7 });
  assert.deepEqual(seen, [['hit', 7]]);
});

ok('interval 0: whole group fires at once, completes when all die', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const h = invoke('burstShot', { count: 3, interval: 0, direction: 0, speed: 300, ttl: 5 }, ctx);
  assert.equal(h.handles.length, 3, 'all 3 immediate');
  assert.equal(typeof h.step, 'undefined', 'no step needed');
  h.handles.forEach((ch) => { ch.entity.alive = false; ch._emit('complete', {}); });
  assert.ok(h._completed, 'completes after all children done');
});

console.log(`\n${passed} passed`);
