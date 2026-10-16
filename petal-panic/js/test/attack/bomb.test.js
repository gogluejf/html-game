// Task 1.4 — Bomb primitive tests (pure logic, no DOM).
// Run: node js/test/attack/bomb.test.js

import { strict as assert } from 'node:assert';
import { spawnBomb, stepBomb } from '../../combat/attack/primitives/bomb.js';
import { invoke, AttackHandle } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { Pool, Special } from '../../objects/projectile.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const attacker = () => ({ x: 100, y: 200, w: 32, h: 32 });
function makeCtx() {
  return makeContext(attacker(), { pools: { specialPool: new Pool(Special, 4) } });
}
const P = { speed: 300, direction: -Math.PI / 4, arc: 800, bounce: true, explodeOnContact: true, ttl: 4, damage: 40, radius: 60 };

ok('spawns into specialPool with ballistic velocity + gravity', () => {
  const ctx = makeCtx();
  const ent = spawnBomb(P, ctx);
  assert.ok(ent, 'spawned');
  assert.equal(ctx.pools.specialPool.active.length, 1);
  const c = Math.SQRT1_2 * 300;
  assert.ok(Math.abs(ent.vx - c) < 1e-6, `vx=${ent.vx}`);
  assert.ok(Math.abs(ent.vy + c) < 1e-6, `vy=${ent.vy}`);
  assert.equal(ent.gravityValue, 800);
});

ok('bounce=true → solidBehavior reflect; bounce=false → stop', () => {
  const ctx = makeCtx();
  const e1 = spawnBomb({ ...P, bounce: true }, ctx);
  const e2 = spawnBomb({ ...P, bounce: false }, ctx);
  assert.equal(e1.solidBehavior, 'reflect');
  assert.equal(e2.solidBehavior, 'stop');
});

ok('ttl becomes the fuse on the entity', () => {
  const ctx = makeCtx();
  const ent = spawnBomb({ ...P, ttl: 2.5 }, ctx);
  // setLife drives the life/fuse timer; verify via the timers facade if present.
  assert.ok(ent.timers?.get('life') === 2.5 || ent.life === 2.5 || ent.timers?.get('fuse') === 2.5,
    `life=${ent.life} timers=${JSON.stringify([...(ent.timers?.entries?.() ?? [])])}`);
});

ok('stepBomb: alive bomb returns false (still in flight)', () => {
  const ctx = makeCtx();
  const h = new AttackHandle('bomb');
  const ent = spawnBomb(P, ctx);
  assert.equal(stepBomb(ent, P, ctx, h), false);
});

ok('detonation emits detonate with blast point + completes', () => {
  const ctx = makeCtx();
  const h = new AttackHandle('bomb');
  const ent = spawnBomb(P, ctx);
  const seen = [];
  h.on('detonate', (d) => seen.push(d));
  h.on('complete', () => seen.push('done'));
  ent._attackHit = true; // contact kill by collision handler
  ent.alive = false;
  assert.equal(stepBomb(ent, P, ctx, h), true);
  assert.equal(seen.length, 2);
  assert.equal(seen[1], 'done');
  assert.ok(typeof seen[0].x === 'number' && typeof seen[0].y === 'number');
  assert.equal(seen[0].contact, true);
});

ok('fuse expiry (no contact) still detonates, contact=false', () => {
  const ctx = makeCtx();
  const h = new AttackHandle('bomb');
  const ent = spawnBomb(P, ctx);
  const seen = [];
  h.on('detonate', (d) => seen.push(d.contact));
  ent.ttlExpired = true; // Special.update() sets this when the fuse runs out
  ent.alive = false;
  stepBomb(ent, P, ctx, h);
  assert.deepEqual(seen, [false]);
});

ok('stepBomb is idempotent after detonation', () => {
  const ctx = makeCtx();
  const h = new AttackHandle('bomb');
  const ent = spawnBomb(P, ctx);
  ent.alive = false;
  stepBomb(ent, P, ctx, h);
  let n = 0;
  h.on('detonate', () => n++);
  assert.equal(stepBomb(ent, P, ctx, h), true);
  assert.equal(n, 0);
});

ok('carrier contract: terminal detonate carries the death point (macros compose)', () => {
  // The carrier no longer takes payloads (primitive boundary) — composed
  // macros (explosiveBomb) subscribe to 'detonate' and fire the blast at the
  // carried death point.
  const ctx = makeCtx();
  const h = invoke('bomb', P, ctx);
  const ent = h.entity;
  ent._attackHit = true;
  ent.alive = false;
  let point = null;
  h.on('detonate', (info) => { point = info; });
  stepBomb(ent, P, ctx, h);
  assert.ok(point, 'detonate emitted');
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), 'death point carried');
});

ok('no payload → fizzle: detonate emits, no crash', () => {
  const ctx = makeCtx();
  const h = invoke('bomb', P, ctx);
  const ent = h.entity;
  ent._attackHit = true;
  ent.alive = false;
  let detonated = false;
  h.on('detonate', () => { detonated = true; });
  assert.equal(stepBomb(ent, P, ctx, h), true);
  assert.ok(detonated, 'detonate emitted on fizzle');
});

ok('pool exhaustion: spawn returns null, handle expires', () => {
  const ctx2 = makeContext(attacker(), { pools: { specialPool: new Pool(Special, 1) } });
  const h1 = invoke('bomb', { ...P }, ctx2);
  assert.ok(h1.entity, 'first bomb spawns');
  const h2 = invoke('bomb', { ...P }, ctx2);
  assert.equal(h2.entity, undefined, 'second bomb skipped (soft cap)');
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
