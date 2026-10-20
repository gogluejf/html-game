// Task 1.19 — Attack integration test: all 12 primitives + composable macros.
// Run: node js/test/attack/integration.test.js
//
// Verifies the Wave 1 + Wave 2 surface together:
//   - every primitive id is registered with meta + defaults
//   - the engine can invoke each one in a minimal context without throwing
//   - composition chains work (spreadShot fan, predictiveShot aim→fire,
//     homingMissile steer, explosion→spawnSplit→projectiles, bodyExplosion payload)

import { strict as assert } from 'node:assert';
import { listPrimitives, getPrimitive, listMacros, getMacro } from '../../combat/attack/registry.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { LAYER } from '../../consts.js';
import { resolveEffects } from '../../combat/attack/effectsMeta.js';

// Import every primitive for its registration side effect.
import '../../combat/attack/primitives/projectile.js';
import '../../combat/attack/primitives/bomb.js';
import '../../combat/attack/primitives/explosion.js';
import '../../combat/attack/primitives/meleeHitbox.js';
import '../../combat/attack/primitives/movement.js'; // registers 'charge'
import '../../combat/attack/primitives/bodyContact.js';
import '../../combat/attack/primitives/beam.js';
import '../../combat/attack/primitives/fireArea.js';
import '../../combat/attack/primitives/spike.js';
import '../../combat/attack/primitives/orbit.js';
import '../../combat/attack/primitives/boomerang.js';
// Macros (composition layer; each declares meta.invokes).
// Macro barrel (composition layer; each macro declares meta.invokes).
import '../../combat/attack/macros/index.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const ALL_PRIMITIVES = [
  'projectile', 'bomb', 'explosion', 'meleeHitbox', 'charge', 'bodyContact',
  'beam', 'fireArea', 'spike', 'orbit', 'boomerang', 'shockwave',
];

const ALL_MACROS = [
  'reticleShot', 'spawnSplit', 'homingMissile', 'predictiveShot', 'spreadShot', 'bodyExplosion', 'explosiveBomb', 'explosiveProjectile',
];

const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });
function pools() {
  // Minimal pool stubs satisfying the spawn contract used by the tests.
  const mk = (size) => {
    const items = [];
    return {
      activeItems: items,
      spawn(...args) {
        const e = { alive: true, x: args[0], y: args[1], w: 12, h: 12, vx: 0, vy: 0, layer: LAYER.PROJ_ALLY, setLife() {}, timers: new Map() };
        items.push(e);
        return e;
      },
      updateAll() {},
    };
  };
  return { projectilePool: mk(64), specialPool: mk(16) };
}

ok('all 12 primitives are registered', () => {
  const ids = listPrimitives();
  for (const id of ALL_PRIMITIVES) assert.ok(ids.includes(id), `missing '${id}'`);
  assert.equal(ids.length, 12, `expected exactly 12, got ${ids.length}: ${ids.join(',')}`);
});

ok('every registration carries meta + default params', () => {
  for (const id of ALL_PRIMITIVES) {
    const def = getPrimitive(id);
    assert.ok(def?.meta?.name, `${id} has meta.name`);
    assert.ok(Array.isArray(def?.meta?.params), `${id} has meta.params list`);
    assert.ok(def?.params != null, `${id} has default params`);
  }
});

ok('every macro is registered with an invokes list (composition metadata)', () => {
  const ids = listMacros();
  for (const id of ALL_MACROS) assert.ok(ids.includes(id), `missing macro '${id}'`);
  for (const id of ALL_MACROS) {
    const def = getMacro(id);
    assert.ok(def?.meta?.name, `${id} has meta.name`);
    assert.ok(Array.isArray(def?.meta?.invokes) && def.meta.invokes.length > 0,
      `${id} declares meta.invokes (what it composes)`);
  }
});

ok("resolveEffects: macros inherit invoked primitives' effects dynamically", () => {
  // homingMissile declares no native effects — its row must come from invoking projectile.
  const hm = resolveEffects('homingMissile').map((r) => r.type);
  assert.ok(hm.includes('hit-sparkle'), `homingMissile inherits hit-sparkle (got ${hm})`);
  // spawnSplit: inherited projectile + explosiveBomb effects, deduped by type.
  // (explosiveBomb → bomb primitive: landing burst + camera shake; the
  // explosion payload's VFX are suppressed in the composition, so no
  // screen-flash row.)
  const ss = resolveEffects('spawnSplit');
  const types = ss.map((r) => r.type);
  for (const t of ['explosion', 'hit-sparkle', 'camera-shake']) {
    assert.ok(types.includes(t), `spawnSplit resolves ${t}`);
  }
  assert.equal(new Set(types).size, types.length, 'no duplicate types');
  // Inherited rows carry a via-label naming the source attack.
  assert.ok(ss.some((r) => r.via), 'inherited rows are labeled with their source');
});

ok('explosiveBomb: macro composes bomb → explosion and inherits honest effects', () => {
  const def = getMacro('explosiveBomb');
  assert.ok(def?.meta?.name, 'registered with meta.name');
  assert.deepEqual([...def.meta.invokes].sort(), ['bomb', 'explosion'], 'declares both invokes');
  // The macro declares NO native effects — every row is inherited from the
  // invoked attacks (same pattern as bodyExplosion/spawnSplit).
  assert.deepEqual(def.meta.effects ?? [], [], 'macro owns no effects of its own');
  const rows = resolveEffects('explosiveBomb').map((r) => r.type);
  assert.ok(rows.includes('explosion'), 'blast burst inherited from explosion primitive');
  assert.ok(rows.includes('camera-shake'), 'shake inherited from explosion primitive');
  assert.ok(rows.includes('debris'), 'carrier landing puff inherited from bomb');
  // NOTE: screen-flash is suppressed per call (screenFlash: false) — the
  // primitive still declares it, so resolveEffects lists it; the macro's
  // effective VFX at runtime is burst + shake only.
});

ok('explosiveProjectile: macro composes projectile → explosion', () => {
  const def = getMacro('explosiveProjectile');
  assert.ok(def?.meta?.name, 'registered with meta.name');
  assert.deepEqual([...def.meta.invokes].sort(), ['explosion', 'projectile'], 'declares both invokes');
  assert.deepEqual(def.meta.effects ?? [], [], 'macro owns no effects of its own');
  const rows = resolveEffects('explosiveProjectile').map((r) => r.type);
  assert.ok(rows.includes('explosion'), 'blast burst inherited from explosion primitive');
  assert.ok(rows.includes('hit-sparkle'), 'carrier hit juice inherited from projectile');
});

ok('primitives that fire VFX declare meta.effects', () => {
  // The five primitives that own their own effect firing must declare it;
  // the rest may omit the field entirely (no VFX owned).
  for (const id of ['projectile', 'bomb', 'explosion', 'beam', 'meleeHitbox', 'spike']) {
    const def = getPrimitive(id);
    assert.ok(Array.isArray(def?.meta?.effects) && def.meta.effects.length > 0,
      `${id} declares meta.effects`);
    for (const fx of def.meta.effects) {
      assert.ok(typeof fx.type === 'string' && fx.type.length > 0, `${id} effect has a type`);
    }
  }
});

ok('every primitive invokes without throwing in a minimal context', () => {
  const ctx = makeContext(attacker(), { pools: pools(), target: { x: 400, y: 200, w: 32, h: 32, alive: true, vx: 0, vy: 0 } });
  for (const id of ALL_PRIMITIVES) {
    let h;
    try {
      h = invoke(id, {}, ctx);
    } catch (e) {
      throw new Error(`${id} threw on invoke: ${e.message}`);
    }
    assert.ok(h && typeof h.on === 'function' && typeof h.cancel === 'function', `${id} returns a handle`);
  }
});

ok('composition: spreadShot macro fans out live projectiles', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const fan = invoke('spreadShot', { count: 3, direction: 0, angle: Math.PI / 3 }, ctx);
  assert.equal(fan.angles.length, 3);
  assert.equal(fan.handles.length, 3);
  for (const h of fan.handles) assert.ok(h.entity, 'each shot spawned an entity');
});

ok('composition: predictiveShot macro aims ahead and fires one projectile', () => {
  const t = { x: 400, y: 200, w: 32, h: 32, alive: true, vx: 200, vy: 0 };
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const h = invoke('predictiveShot', { speed: 600 }, ctx);
  assert.ok(h.entity, 'shot spawned');
  // Aimed at the intercept point: ahead of the target's current center.
  assert.ok(h.point.x > 416, `intercept point x=${h.point.x}`);
});

ok('composition: homingMissile macro steers its own projectile', () => {
  // Target BELOW-RIGHT of the attacker (screen y grows downward) → steering
  // must turn the velocity downward (vy > 0).
  const t = { x: 400, y: 300, w: 32, h: 32, alive: true, vx: 0, vy: 0 };
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const h = invoke('homingMissile', { target: t, turnRate: 4, ttl: 2 }, ctx);
  assert.ok(h.entity, 'missile spawned');
  for (let i = 0; i < 60; i++) {
    if (h.step(1 / 60)) break;
    h.entity.x += h.entity.vx / 60;
    h.entity.y += h.entity.vy / 60;
  }
  assert.ok(h.entity.vy > 0, `steered downward (vy=${h.entity.vy})`);
});

ok('composition: spawnSplit macro materializes child projectiles', () => {
  const ctx = makeContext(attacker(), { pools: pools(), world: { targets: [] } });
  // The macro owns materialization: one invoke → live projectile handles.
  const fan = invoke('spawnSplit', { x: 300, y: 300, count: 4, centerDirection: -Math.PI / 2, angle: 2 * Math.PI, force: 250, spawnType: 'projectile' }, ctx);
  assert.equal(fan.children.length, 4, 'raw vectors exposed');
  assert.equal(fan.handles.length, 4, 'each child → a live projectile handle');
  for (const k of fan.handles) assert.ok(k.entity, 'child projectile spawned');
});

ok('composition: bodyExplosion fires an explosion payload then dies', () => {
  const e = { x: 300, y: 300, w: 32, h: 32, alive: true, hp: 20, takeDamage(a) { this.hp -= a; if (this.hp <= 0) this.alive = false; return a; } };
  const victim = { x: 310, y: 310, w: 24, h: 24, alive: true, hp: 100, layer: LAYER.ENEMY, takeDamage(a) { this.hp -= a; return a; } };
  const ctx = makeContext(e, { world: { targets: [victim] }, target: victim });
  const h = invoke('bodyExplosion', {
    triggerPayloadFirst: true,
    payload: { id: 'explosion', params: { x: 316, y: 316, radius: 40, damage: 30, targets: [victim] } },
  }, ctx);
  assert.equal(e.alive, false, 'kamikaze died');
  assert.equal(victim.hp, 70, 'payload blast landed');
  assert.equal(h._completed, true);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
