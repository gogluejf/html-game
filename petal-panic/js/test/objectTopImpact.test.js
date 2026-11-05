import { strict as assert } from 'node:assert';
import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();
const noop = () => {};
const canvas = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => canvas, addEventListener: noop }) };
globalThis.window = { addEventListener: noop, __selectedHero: 'scarlet' };
await import('../systems/update.js');
const { CollisionWorld } = await import('../core/collision.js');
const { registerCollisionHandlers } = await import('../combat/collisionHandlers.js');
const { applyObjectImpact } = await import('../combat/objectImpact.js');
const { refreshBarrelSolidBoxes } = await import('../objects/barrelSync.js');
const { GameObj, makeBarrel } = await import('../objects/object.js');
const { Pool, Projectile } = await import('../objects/projectile.js');
const { invoke } = await import('../combat/attack/engine.js');
const { stepBombTerrain } = await import('../combat/attack/primitives/projectile.js');
const { ctx } = await import('../world/context.js');
await import('../combat/attack/macros/index.js');
const dt = 1 / 60;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
function setup(object = makeBarrel(400, 300)) {
  const world = new CollisionWorld({ cellSize: 64 });
  registerCollisionHandlers(world);
  world.add(object);
  const pool = new Pool(Projectile, 8);
  let destroys = 0;
  const hooks = { onObjectDestroyed(t) { destroys++; world.remove(t); }, onObjectReward() {} };
  Object.assign(ctx, { collisionWorld: world, barrelSolidBoxes: [],
    handleBarrelDestroyed: hooks.onObjectDestroyed, popSuperCoinHit: hooks.onObjectReward });
  refreshBarrelSolidBoxes();
  const context = { attacker: ctx.hero, pools: { projectilePool: pool },
    collisionWorld: world, bombTerrainStepped: true, groundY: 480, world: { targets: [object] } };
  const options = { onSurfaceContact: (e, s) => applyObjectImpact(e, s.owner, ctx.hero, hooks) };
  const spawn = (id = 'explosiveBomb', params = {}) => invoke(id, {
    origin: { x: 416, y: 200 }, speed: 0, arc: 0, ttl: 30,
    team: 'ally', blastTeam: 'ally', damage: 100, ...params,
  }, context);
  function frame(h) {
    pool.updateAll(dt);
    for (const e of pool.items) stepBombTerrain(e, dt, 480, ctx.barrelSolidBoxes, options);
    world.update();
    h.step(dt, [object]);
  }
  return { world, object, pool, spawn, frame, options, destroys: () => destroys };
}
for (const side of ['top', 'side']) test(`${side} contact destroys object and detonates exactly once`, () => {
  const f = setup(); const h = f.spawn(); const e = h.entity;
  const box = f.object.worldBox();
  if (side === 'top') { e.x = box.x + 4; e.y = box.y - e.h - 2; e.vy = 240; }
  else { e.x = box.x - e.w - 2; e.y = box.y + 4; e.vx = 240; }
  let detonations = 0; h.inner.on('detonate', () => detonations++);
  f.frame(h);
  assert.equal(e.alive, false);
  assert.equal(f.object.destroyed, true);
  assert.equal(f.world.entities.has(f.object), false);
  assert.equal(f.destroys(), 1);
  assert.equal(detonations, 1);
  f.frame(h);
  assert.equal(f.destroys(), 1); assert.equal(detonations, 1);
});
test('generic non-barrel GameObj is registered with usable geometry and owner', () => {
  const object = new GameObj({ id: 'futureCrate', w: 32, h: 48, hp: 60 }, 400, 300);
  const f = setup(object);
  assert.equal(ctx.barrelSolidBoxes[0].owner, object);
  assert.equal(ctx.barrelSolidBoxes[0].y, object.worldBox().y);
  const h = f.spawn(); const e = h.entity; const box = object.worldBox();
  e.x = box.x + 4; e.y = box.y - e.h - 2; e.vy = 240;
  f.frame(h); assert.equal(object.destroyed, true); assert.equal(f.destroys(), 1);
});
test('mine lands without contact damage and retains delayed detonation', () => {
  const f = setup(); const h = f.spawn('throwMine', { bounce: false, ttl: 0.2, blinkDuration: 0.1 });
  const e = h.entity; const box = f.object.worldBox();
  e.x = box.x + 4; e.y = box.y - e.h - 2; e.vy = 240;
  let detonations = 0; h.on('detonate', () => detonations++);
  f.frame(h);
  assert.equal(f.object.hp, 60); assert.equal(h.state.settled, true);
  assert.equal(h.state.box.y + h.state.box.h, box.y);
  assert.equal(detonations, 0);
  for (let i = 0; i < 120 && !h._completed; i++) f.frame(h);
  assert.equal(h._completed, true); assert.equal(detonations, 1);
});
test('static terrain keeps bounce and foe shots do not damage objects', () => {
  const f = setup(); const h = f.spawn(); const e = h.entity;
  e.x = 410; e.y = 250 - e.h - 1; e.vy = 120; e.vx = 30;
  f.pool.updateAll(dt);
  stepBombTerrain(e, dt, 480, [{ x: 350, y: 250, w: 100, h: 40 }], f.options);
  assert.equal(e.alive, true); assert.equal(e.vy, -60); assert.equal(e.vx, 21);
  h.cancel();
  const foe = f.spawn('explosiveBomb', { team: 'foe', blastTeam: 'foe' });
  const b = f.object.worldBox();
  foe.entity.x = b.x + 4; foe.entity.y = b.y - foe.entity.h - 1; foe.entity.vy = 120;
  f.frame(foe);
  assert.equal(f.object.hp, 60); assert.equal(foe.entity.alive, true);
});
test('fast top crossing still hits the destructible', () => {
  const f = setup(); const h = f.spawn(); const e = h.entity;
  const b = f.object.worldBox();
  e.x = b.x + 4; e.y = b.y - e.h - 2; e.vy = 12000;
  f.frame(h);
  assert.equal(f.object.destroyed, true);
  assert.equal(f.destroys(), 1);
});
test('molotov object-top fire stays on the contacted surface', () => {
  const f = setup(); const h = f.spawn('molotov', { damage: 12 });
  const e = h.entity; const b = f.object.worldBox();
  e.x = b.x + 4; e.y = b.y - e.h - 2; e.vy = 240;
  f.frame(h);
  assert.equal(h.handles.length, 1);
  const z = h.handles[0].zone;
  assert.equal(z.y + z.h, b.y);
  assert.ok(f.object.hp < 60);
});
console.log(`objectTopImpact: ${passed} passed`);
