// Task 1.19 — Primitive integration test: all 17 registered + composable.
// Run: node js/test/attack/integration.test.js
//
// Verifies the Wave 1 + Wave 2 surface together:
//   - every primitive id is registered with meta + defaults
//   - the engine can invoke each one in a minimal context without throwing
//   - composition chains work (spread→projectile, predictive→projectile,
//     projectile+homing, explosion→spawnSplit→projectiles, selfDestruct payload)

import { strict as assert } from 'node:assert';
import { listPrimitives, getPrimitive } from '../../combat/attack/registry.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { LAYER } from '../../consts.js';

// Import every primitive for its registration side effect.
import '../../combat/attack/primitives/projectile.js';
import '../../combat/attack/primitives/spread.js';
import '../../combat/attack/primitives/bomb.js';
import '../../combat/attack/primitives/explosion.js';
import '../../combat/attack/primitives/meleeHitbox.js';
import '../../combat/attack/primitives/movement.js'; // registers 'charge'
import '../../combat/attack/primitives/bodyContact.js';
import '../../combat/attack/primitives/reticle.js';
import '../../combat/attack/primitives/homing.js';
import '../../combat/attack/primitives/predictive.js';
import '../../combat/attack/primitives/beam.js';
import '../../combat/attack/primitives/fireArea.js';
import '../../combat/attack/primitives/spike.js';
import '../../combat/attack/primitives/orbit.js';
import '../../combat/attack/primitives/boomerang.js';
import '../../combat/attack/primitives/spawnSplit.js';
import '../../combat/attack/primitives/selfDestruct.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const ALL_17 = [
  'projectile', 'spread', 'bomb', 'explosion', 'meleeHitbox', 'charge', 'bodyContact',
  'reticle', 'homing', 'predictive', 'beam', 'fireArea', 'spike', 'orbit', 'boomerang',
  'spawnSplit', 'selfDestruct',
];

const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });
function pools() {
  // Minimal pool stubs satisfying the spawn contract used by the tests.
  const mk = (size) => {
    const items = [];
    return {
      activeItems: items,
      spawn(...args) {
        const e = { alive: true, x: args[0], y: args[1], w: 12, h: 12, vx: 0, vy: 0, layer: LAYER.PROJ_ALLY };
        items.push(e);
        return e;
      },
      updateAll() {},
    };
  };
  return { projectilePool: mk(64), specialPool: mk(16) };
}

ok('all 17 primitives are registered', () => {
  const ids = listPrimitives();
  for (const id of ALL_17) assert.ok(ids.includes(id), `missing '${id}'`);
  assert.equal(ids.length, 17, `expected exactly 17, got ${ids.length}: ${ids.join(',')}`);
});

ok('every registration carries meta + default params', () => {
  for (const id of ALL_17) {
    const def = getPrimitive(id);
    assert.ok(def?.meta?.name, `${id} has meta.name`);
    assert.ok(Array.isArray(def?.meta?.params), `${id} has meta.params list`);
    assert.ok(def?.params != null, `${id} has default params`);
  }
});

ok('every primitive invokes without throwing in a minimal context', () => {
  const ctx = makeContext(attacker(), { pools: pools(), target: { x: 400, y: 200, w: 32, h: 32, alive: true, vx: 0, vy: 0 } });
  for (const id of ALL_17) {
    let h;
    try {
      h = invoke(id, {}, ctx);
    } catch (e) {
      throw new Error(`${id} threw on invoke: ${e.message}`);
    }
    assert.ok(h && typeof h.on === 'function' && typeof h.cancel === 'function', `${id} returns a handle`);
  }
});

ok('composition: spread angles feed projectile shots', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const fan = invoke('spread', { count: 3, direction: 0, angle: Math.PI / 3 }, ctx);
  assert.equal(fan.angles.length, 3);
  const handles = fan.angles.map((a) => invoke('projectile', { direction: a, speed: 500, ttl: 1, damage: 5 }, ctx));
  for (const h of handles) assert.ok(h.entity, 'each shot spawned an entity');
});

ok('composition: predictive aim drives a projectile direction', () => {
  const t = { x: 400, y: 200, w: 32, h: 32, alive: true, vx: 200, vy: 0 };
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const aim = invoke('predictive', { speed: 600 }, ctx);
  const shot = invoke('projectile', { direction: aim.direction, speed: 600, ttl: 1, damage: 5 }, ctx);
  assert.ok(shot.entity, 'shot spawned');
  // Aimed at the intercept point: ahead of the target's current center.
  assert.ok(aim.point.x > 416, `intercept point x=${aim.point.x}`);
});

ok('composition: homing modifier steers a spawned projectile', () => {
  // Target BELOW-RIGHT of the attacker (screen y grows downward) → steering
  // must turn the velocity downward (vy > 0).
  const t = { x: 400, y: 300, w: 32, h: 32, alive: true, vx: 0, vy: 0 };
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const shot = invoke('projectile', { direction: 0, speed: 400, ttl: 3, damage: 5 }, ctx);
  const homing = invoke('homing', { target: t, turnRate: 4, ttl: 2 }, ctx);
  homing.bind(shot.entity);
  for (let i = 0; i < 60; i++) homing.step(1 / 60);
  assert.ok(shot.entity.vy > 0, `steered downward (vy=${shot.entity.vy})`);
});

ok('composition: explosion detonation triggers spawnSplit children', () => {
  const ctx = makeContext(attacker(), { pools: pools(), world: { targets: [] } });
  const boom = invoke('explosion', { x: 300, y: 300, radius: 50, damage: 10 }, ctx);
  assert.equal(boom._completed, true, 'explosion is synchronous');
  const split = invoke('spawnSplit', { x: 300, y: 300, count: 4, centerDirection: -Math.PI / 2, angle: 2 * Math.PI, force: 250 }, ctx);
  const kids = split.children.map((c) => invoke('projectile', {
    origin: { x: c.x, y: c.y }, direction: c.angle, speed: Math.hypot(c.vx, c.vy), ttl: 1, damage: 5,
  }, ctx));
  for (const k of kids) assert.ok(k.entity, 'child projectile spawned');
});

ok('composition: selfDestruct fires an explosion payload then dies', () => {
  const e = { x: 300, y: 300, w: 32, h: 32, alive: true, hp: 20, takeDamage(a) { this.hp -= a; if (this.hp <= 0) this.alive = false; return a; } };
  const victim = { x: 310, y: 310, w: 24, h: 24, alive: true, hp: 100, layer: LAYER.ENEMY, takeDamage(a) { this.hp -= a; return a; } };
  const ctx = makeContext(e, { world: { targets: [victim] } });
  const h = invoke('selfDestruct', {
    triggerPayloadFirst: true,
    payload: { id: 'explosion', params: { x: 316, y: 316, radius: 40, damage: 30, targets: [victim] } },
  }, ctx);
  assert.equal(e.alive, false, 'kamikaze died');
  assert.equal(victim.hp, 70, 'payload blast landed');
  assert.equal(h._completed, true);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
