import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();
import { strict as assert } from 'node:assert';
const noop = () => {};
// Gradient stub: the fire-zone drawer builds a linear gradient and calls
// addColorStop on it — a bare Proxy returning `noop` would hand back undefined.
const gradientStub = { addColorStop: noop };
const canvas = new Proxy({}, {
  get: (t, key) => key === 'createLinearGradient' || key === 'createRadialGradient' ? () => gradientStub : noop,
  set: () => true,
});
globalThis.document = {
  createElement: () => ({ getContext: () => canvas, addEventListener: noop }),
};
globalThis.window = { addEventListener: noop, __selectedHero: 'scarlet' };
const U = await import('../systems/update.js');
const { S, setState } = await import('../core/state.js');
const { ZONE_GROUND_Y } = await import('../world/level.js');
const { projectilePool } = await import('../objects/projectile.js');
const dt = 1 / 60;
const hero = U.getHero();
const zone = U.getActiveZone(hero);
function reset(platform) {
  // Floor width must be lattice-legal for the tile renderer: blocks are fixed
  // 2-cell columns (squareGrid.js), so width in 48px units must be EVEN.
  // 3000px = 62.5 units → rounds to 63 (odd) and blockColumns() throws.
  // 2976px = exactly 62 units.
  U.loadActiveZone(zone, { solids: [
    { x: 0, y: ZONE_GROUND_Y, w: 2976, h: 50 },
    ...(platform ? [platform] : []),
  ], enemies: [], barrels: [], powerups: [], checkpoints: [] });
  hero.x = 100; hero.y = ZONE_GROUND_Y - hero.h;
  hero.vx = hero.vy = 0;
  Object.assign(U.getClearSequence(), { state: 'idle', timer: 0 });
  U.bossZone.reset();
  setState(S.PLAY);
}

const { makePropaneBarrel } = await import('../objects/object.js');
const { AttackLifecycle } = await import('../combat/attack/lifecycle.js');

// Exercise real collision → objectImpact → barrelSync → spawnSplit → molotov,
// not a hand-written copy of the fan parameters. Put the killing thorn in the
// fifth reusable slot to reproduce the reported rightmost/last-child failure.
for (const capacity of [5, 3, 1]) {
  AttackLifecycle.clear();
  for (const e of projectilePool.items) {
    U.getCollisionWorld().remove(e);
    e.alive = false;
    e._attackDone = true;
  }
  projectilePool.active.length = 0;
  reset();
  const barrel = makePropaneBarrel(400, ZONE_GROUND_Y - 48);
  const world = U.getCollisionWorld();
  world.add(barrel);
  const reserved = [];
  for (let i = 0; i < capacity - 1; i++) {
    reserved.push(projectilePool.spawn(200, 200, 0, true));
  }
  const shot = projectilePool.spawn(400, barrel.y + 12, 0, true);
  shot.damage = 100; shot.vx = shot.vy = 0;
  world.add(shot);
  // Exhaust all remaining slots. These stationary, long-lived thorns are
  // outside the barrel's cells and do not collide with the fan.
  while (projectilePool.count < projectilePool.items.length) {
    const blocker = projectilePool.spawn(200, 200, 0, true);
    blocker.vx = blocker.vy = 0; blocker.setLife(30);
  }
  for (const e of reserved) e.alive = false;
  let hits = 0;
  const hit = barrel.hit.bind(barrel);
  barrel.hit = (...args) => { hits++; return hit(...args); };
  U.update(dt);
  assert.equal(barrel.destroyed, true);
  const fan = [...AttackLifecycle._live].find(h => h.id === 'spawnSplit');
  assert.ok(fan, 'barrel aftermath registers its own root');
  assert.equal(fan.handles.length, capacity, 'exhausted launches are skipped');
  assert.equal(new Set(fan.handles.map(h => h.entity)).size, capacity);
  assert.equal(fan.handles[capacity - 1].entity, shot, 'last child reuses killing shot');
  assert.equal(hits, 1, 'stale broadphase must not hit the destroyed barrel again');
  const starts = fan.handles.map(h => ({ x: h.entity.x, y: h.entity.y,
    vx: h.entity.vx, vy: h.entity.vy }));
  const impacts = new Map();
  for (const h of fan.handles) {
    assert.equal(h.entity.alive, true);
    assert.equal(h.entity._attackHit, false);
    assert.equal(h.entity._bombSurfaceY, null);
    assert.equal(h.handles.length, 0, 'no fire at launch origin');
    assert.equal(h.entity._attackHandle, h.inner, 'distinct carrier owner');
    assert.equal(AttackLifecycle._live.has(h), false, 'parent alone drives child');
    h.inner.on('detonate', e => {
      assert.equal(impacts.has(h), false, 'exactly one terminal event');
      impacts.set(h, e);
    });
  }
  assert.equal(new Set(projectilePool.active).size, projectilePool.active.length,
    'recycling never duplicates pool integration');
  U.update(dt);
  for (const [i, h] of fan.handles.entries()) {
    const e = h.entity, start = starts[i];
    assert.ok(Math.abs(e.x - (start.x + start.vx * dt)) < 1e-9);
    assert.ok(Math.abs(e.y - (start.y + (start.vy + 800 * dt) * dt)) < 1e-9,
      'each carrier integrates exactly once');
    assert.equal(h.handles.length, 0);
  }
  for (let frame = 0; frame < 120 && impacts.size < capacity; frame++) U.update(dt);
  assert.equal(impacts.size, capacity, 'all launched bottles reach genuine impacts');
  for (const h of fan.handles) {
    const impact = impacts.get(h);
    assert.equal(impact.contact, true);
    assert.equal(impact.surfaceY, ZONE_GROUND_Y);
    assert.equal(h.handles.length, 1);
    const fire = h.handles[0].zone;
    assert.equal(fire.x + fire.w / 2, impact.x);
    assert.equal(fire.y + fire.h, impact.surfaceY);
    assert.notEqual(fire.y + fire.h / 2, starts[0].y + 9,
      'fire is not left at airborne launch origin');
  }
  console.log(`PASS real propane fan: ${capacity} independent launches, pool reuse, impact fire`);
}

// Shared collision contract: even with live targets, a recycled object must
// not inherit the previous generation's broadphase contacts in this pass.
const { CollisionWorld } = await import('../core/collision.js');
const { Pool, Projectile } = await import('../objects/projectile.js');
const { LAYER } = await import('../consts.js');
{
  const world = new CollisionWorld({ cellSize: 64 });
  const pool = new Pool(Projectile, 1);
  const shot = pool.spawn(60, 60, 0, true);
  const target = { x: 58, y: 58, w: 24, h: 24, layer: LAYER.SOLID, alive: true };
  world.add(shot); world.add(target);
  let contacts = 0;
  world.on('hit', () => {
    contacts++;
    if (contacts === 1) {
      shot.alive = false;
      assert.equal(pool.spawn(60, 60, 0, true), shot);
      world.add(shot); // assigns the new generation's collision identity
    }
  });
  world.update();
  assert.equal(contacts, 1, 'new generation cannot consume stale pairs from other cells');
  world.update();
  assert.equal(contacts, 2, 'new generation participates normally on the next pass');
  console.log('PASS shared collision generation guard with live target');
}
AttackLifecycle.clear();
