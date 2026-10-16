// Projectile Shot macro tests (pure logic, no DOM).
// Run: node js/test/attack/projectileShot.test.js

import { strict as assert } from 'node:assert';
import { resolveAim } from '../../combat/attack/macros/projectileShot.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { Pool, Projectile, Special } from '../../objects/projectile.js';
import '../../combat/attack/primitives/projectile.js'; // the macro composes it
import '../../combat/attack/macros/projectileShot.js'; // registers the macro

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const close = (a, b) => Math.abs(a - b) < 1e-9;

function pools() {
  return { projectilePool: new Pool(Projectile, 8), specialPool: new Pool(Special, 4) };
}
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 }); // center (116, 116)

ok('resolveAim: explicit direction wins when no target', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  assert.equal(resolveAim({ direction: 0.7 }, ctx), 0.7);
});

ok('resolveAim: target right of attacker → 0 radians', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const a = resolveAim({ target: { x: 200, y: 100, w: 32, h: 32 } }, ctx);
  assert.ok(close(a, 0), `got ${a}`);
});

ok('resolveAim: target below-right → positive angle (screen-y-down)', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  // target center (216, 216) vs attacker center (116, 116): dx=100, dy=100
  const a = resolveAim({ target: { x: 200, y: 200, w: 32, h: 32 } }, ctx);
  assert.ok(close(a, Math.PI / 4), `got ${a}`);
});

ok('resolveAim: target left of attacker → π', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const a = resolveAim({ target: { x: 0, y: 100, w: 32, h: 32 } }, ctx);
  assert.ok(Math.abs(a - Math.PI) < 1e-9, `got ${a}`);
});

ok('invokes one projectile aimed at the target', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const h = invoke('projectileShot', {
    target: { x: 200, y: 100, w: 32, h: 32 }, speed: 300, ttl: 1, damage: 5,
  }, ctx);
  assert.ok(h.entity, 'entity attached');
  assert.ok(close(h.entity.vx, 300) && close(h.entity.vy, 0), `v=(${h.entity.vx},${h.entity.vy})`);
  assert.equal(h.entity.damage, 5);
});

ok('forwards hit event with dealt damage', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const h = invoke('projectileShot', { direction: 0, speed: 100, ttl: 5, damage: 9 }, ctx);
  const seen = [];
  h.on('hit', (i) => seen.push(['hit', i.dealt]));
  h.on('complete', () => seen.push('done'));
  // Simulate the child shot's terminal path (host would call stepProjectile).
  h.handles[0]._emit('hit', { dealt: 9 });
  h.handles[0]._emit('complete', {});
  assert.deepEqual(seen, [['hit', 9], 'done']);
});

ok('pool exhaustion expires cleanly without throwing', () => {
  const tiny = { projectilePool: new Pool(Projectile, 0), specialPool: new Pool(Special, 0) };
  const ctx = makeContext(attacker(), { pools: tiny });
  const h = invoke('projectileShot', { direction: 0 }, ctx);
  assert.equal(h._completed, true, 'handle completed');
  assert.equal(h.entity, undefined, 'no entity');
});

console.log(`\n${passed} passed`);
