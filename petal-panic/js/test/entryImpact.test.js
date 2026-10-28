import { strict as assert } from 'node:assert';
import { loadTestMacros } from './_macroSetup.mjs';
import { entryImpactPoint, snapToImpact } from '../combat/entryImpact.js';
import { Pool, Projectile, Special } from '../objects/projectile.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { console.error(`FAIL ${name}`, e); process.exitCode = 1; }
}
const center = p => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 });
const floor = { x: 0, y: 476, w: 2000, h: 100 };
test('diagonal floor uses bounded actual travel, not max-axis velocity rewind', () => {
  const p = new Projectile(694, 454, 0);
  p.vx = p.vy = 1200;
  p.update(1 / 60);
  const before = { ...p };
  assert.deepEqual(entryImpactPoint(p, floor), { x: 710, y: 470 });
  assert.deepEqual({ ...p }, before);
  p.vx = 0; p.vy = 1e-300; // steering after integration cannot change contact
  assert.deepEqual(entryImpactPoint(p, floor), { x: 710, y: 470 });
  snapToImpact(p, { x: -999, y: -999 });
  assert.deepEqual(center(p), { x: 720, y: 480 }, 'live physics never snapped');
});
test('missing history, initially overlapping, stationary, invalid and no crossing fall back', () => {
  const box = { x: 100, y: 100, w: 100, h: 100 };
  for (const data of [
    {}, { _impactPrevX: 120, _impactPrevY: 120 },
    { _impactPrevX: 130, _impactPrevY: 130 },
    { _impactPrevX: NaN, _impactPrevY: 0 },
    { x: 30, y: 30, _impactPrevX: 0, _impactPrevY: 0 },
    { x: 300, y: 0, _impactPrevX: 0, _impactPrevY: 0 },
  ]) {
    const p = { x: 130, y: 130, w: 12, h: 12, vx: 1e-300, vy: 0, ...data };
    assert.deepEqual(entryImpactPoint(p, box), center(p));
  }
});
test('negative travel and subpixel travel have bounded entry', () => {
  const p = { x: 180, y: 110, w: 12, h: 12, _impactPrevX: 220, _impactPrevY: 110 };
  assert.deepEqual(entryImpactPoint(p, { x: 100, y: 100, w: 100, h: 100 }), { x: 206, y: 116 });
  const q = { x: 88 + 1e-10, y: 110, w: 12, h: 12, _impactPrevX: 88 - 1e-10, _impactPrevY: 110 };
  assert.equal(entryImpactPoint(q, { x: 100, y: 100, w: 100, h: 100 }).x, 94);
});
test('both real integrators record position and reset history on pooled reuse', () => {
  for (const Class of [Projectile, Special]) {
    const pool = new Pool(Class, 1);
    const p = pool.spawn(10, 20, 0, ...(Class === Special ? ['bomb'] : []));
    p.update(1 / 60);
    assert.equal(p._impactPrevX, 10); assert.equal(p._impactPrevY, 20);
    p._impactPoint = { x: 999, y: 999 }; p.alive = false;
    const reused = pool.spawn(300, 400, 0, ...(Class === Special ? ['bomb'] : []));
    assert.equal(reused, p);
    assert.equal(reused._impactPrevX, null); assert.equal(reused._impactPrevY, null);
    assert.equal(reused._impactPoint, null);
  }
});

// Same headless setup as bombGameplay.test.js; import the real gameplay graph
// before registering an isolated CollisionWorld with the production handlers.
loadTestMacros();
const noop = () => {};
const canvas = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => canvas, addEventListener: noop }) };
globalThis.window = { addEventListener: noop, __selectedHero: 'scarlet' };
await import('../systems/update.js');
const { registerCollisionHandlers } = await import('../combat/collisionHandlers.js');
const { CollisionWorld } = await import('../core/collision.js');
const { SolidBox } = await import('../core/solidBox.js');
const { Entity } = await import('../core/entity.js');
const { LAYER } = await import('../consts.js');
const { invoke } = await import('../combat/attack/engine.js');
const { makeContext } = await import('../combat/attack/context.js');
const { stepBombTerrain } = await import('../combat/attack/primitives/ballistic.js');
const { stepProjectile } = await import('../combat/attack/primitives/projectile.js');
const { activeInstances, resetEffects } = await import('../effects/index.js');
const { particles } = await import('../effects/particles.js');
await import('../combat/attack/macros/index.js');
function setup() {
  resetEffects();
  const world = new CollisionWorld({ cellSize: 64 });
  registerCollisionHandlers(world);
  const pools = { specialPool: new Pool(Special, 4), projectilePool: new Pool(Projectile, 4) };
  const context = makeContext({ x: 0, y: 0, w: 32, h: 32 }, {
    pools, collisionWorld: world, world: { targets: [] }, bombTerrainStepped: true,
  });
  return { world, pools, context };
}
function victim(world, x, y) {
  const e = new Entity({ x, y, w: 24, h: 24, gravity: 0, layer: LAYER.ENEMY });
  e.hp = 1000; e.takeDamage = n => { e.hp -= n; return n; };
  world.add(e); return e;
}
for (const correction of ['top', 'wall']) test(`${correction} bounce then enemy: actual explosion stays at corrected position`, () => {
  const { world, pools, context } = setup();
  const h = invoke('explosiveBomb', { origin: { x: 340, y: 290 }, speed: 0, arc: 0,
    team: 'ally', blastTeam: 'ally', ttl: 2 }, context);
  const p = h.entity; p.vx = 120; p.vy = 120;
  pools.specialPool.updateAll(1 / 60);
  if (correction === 'top') stepBombTerrain(p, 1 / 60, 300);
  else { world.add(new SolidBox({ x: 350, y: 250, w: 100, h: 100 })); world.update(); }
  assert.ok(p.alive); assert.equal(p._impactPoint, null);
  assert.equal(p._impactPrevX, null);
  const expected = center(p);
  victim(world, p.x, p.y);
  world.update();
  assert.equal(p.alive, false);
  assert.deepEqual(center(p), expected);
  const emitted = [];
  const spawnOne = particles.spawnOne;
  particles.spawnOne = function(x, y, ...args) {
    emitted.push({ x, y });
    return spawnOne.call(this, x, y, ...args);
  };
  try { h.step(1 / 60, []); } finally { particles.spawnOne = spawnOne; }
  const blast = activeInstances().find(e => e.type === 'explosion');
  assert.ok(blast, 'real macro emitted explosion VFX');
  assert.ok(emitted.length > 0);
  for (const point of emitted) assert.deepEqual(point, expected);
});
for (const behavior of ['phase', 'reflect']) test(`${behavior} terrain survival cannot retain an impact point`, () => {
  const { world, pools } = setup();
  const p = pools.projectilePool.spawn(340, 280, 0);
  p.solidBehavior = behavior;
  p._impactPoint = { x: -999, y: -999 };
  world.add(p); world.add(new SolidBox({ x: 350, y: 250, w: 100, h: 100 }));
  world.update();
  assert.ok(p.alive); assert.equal(p._impactPoint, null);
});
test('real terrain dispatch preserves precise shockwave contact and recycled-slot snapshot', () => {
  const { world, pools, context } = setup();
  const h = invoke('shockwaveProjectile', { origin: { x: 700, y: 460 }, speed: Math.hypot(1200, 1200),
    direction: Math.PI / 4, ttl: 99, telegraphGap: 0, telegraphBlink: 0, impactDelay: 0 }, context);
  pools.projectilePool.updateAll(1 / 60);
  world.add(new SolidBox(floor)); world.update();
  const p = h.entity;
  assert.equal(p.alive, false);
  assert.ok(Math.abs(p._impactPoint.x - 710) < 1e-9);
  assert.equal(p._impactPoint.y, 470);
  stepProjectile(p, h.inner);
  pools.projectilePool.spawn(1500, 100, 0);
  h.step(1 / 60, []);
  for (const type of ['telegraph-circle', 'shockwave']) {
    const effect = activeInstances().find(e => e.type === type);
    assert.ok(effect, type);
    assert.ok(Math.abs(effect.body.origin.x - 710) < 1e-9);
    assert.equal(effect.body.origin.y, 470);
  }
});
console.log(`entryImpact: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
