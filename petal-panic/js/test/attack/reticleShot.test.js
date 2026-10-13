// Reticle Shot macro tests (Reticle → Projectile composition).
// Run: node js/test/attack/reticleShot.test.js

import { strict as assert } from 'node:assert';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { Pool, Projectile } from '../../objects/projectile.js';
import '../../combat/attack/primitives/reticle.js';
import '../../combat/attack/primitives/projectile.js';
import '../../combat/attack/macros/reticleShot.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 }); // center (116,116)
const target = () => ({ x: 400, y: 200, w: 32, h: 32, alive: true, vx: -160, vy: 0 });
const pools = () => ({ projectilePool: new Pool(Projectile, 32), specialPool: new Pool(Projectile, 8) });

ok('tracks then locks: ONE shot fires at the LOCKED point, not current position', () => {
  const t = target();
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const h = invoke('reticleShot', { duration: 1.0, lockTime: 0.5, speed: 500, ttl: 2, damage: 10 }, ctx);
  // Step to just past lockTime (0.5s): reticle still tracking, no shot yet.
  for (let i = 0; i < 29; i++) { t.x += -160 / 60; h.step(1 / 60); }
  assert.equal(h.shot, undefined, 'no shot before duration ends');
  // Keep stepping to duration end (t ≈ 1.0s). Target keeps moving.
  let completed = null;
  h.on('complete', (info) => { completed = info; });
  for (let i = 0; i < 32 && !completed; i++) { t.x += -160 / 60; h.step(1 / 60); }
  assert.ok(completed, 'complete fired with the locked point');
  assert.ok(h.shot?.entity, 'a projectile was spawned');
  // Exactly one bullet in the pool — no double fire.
  assert.equal(ctx.pools.projectilePool.active.length, 1, `one live bullet, got ${ctx.pools.projectilePool.active.length}`);
  // The locked point must be AHEAD of where the target is now (it kept walking
  // left after the lock) — proof we shot the lock, not the live position.
  assert.ok(completed.point.x > t.x + t.w / 2, `locked ${Math.round(completed.point.x)} > current ${Math.round(t.x + 16)}`);
});

ok('shot direction points from attacker center at the locked point', () => {
  const t = target();
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const h = invoke('reticleShot', { duration: 0.8, lockTime: 0.4, speed: 500, ttl: 2, damage: 10 }, ctx);
  let completed = null;
  h.on('complete', (info) => { completed = info; });
  for (let i = 0; i < 60 && !completed; i++) { t.x += -160 / 60; h.step(1 / 60); }
  assert.ok(completed, 'completed');
  const expected = Math.atan2(completed.point.y - 116, completed.point.x - 116);
  assert.ok(Math.abs(h.shot.entity.vx - Math.cos(expected) * 500) < 1, 'vx matches aim');
  assert.ok(Math.abs(h.shot.entity.vy - Math.sin(expected) * 500) < 1, 'vy matches aim');
});

ok('shot entity carries the configured damage (host routes contact)', () => {
  const t = target();
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const h = invoke('reticleShot', { duration: 0.6, lockTime: 0.3, speed: 900, ttl: 2, damage: 7 }, ctx);
  let completed = null;
  h.on('complete', (info) => { completed = info; });
  for (let i = 0; i < 120 && !completed; i++) h.step(1 / 60);
  assert.ok(completed, 'completed');
  // The macro's job ends at spawning a correctly-armed bullet; contact routing
  // (overlap → takeDamage) belongs to the host, as with every projectile.
  assert.equal(h.shot.entity.damage, 7, 'damage passed through to the entity');
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
