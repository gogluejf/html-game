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
const { render } = await import('../systems/render.js');
const { S, setState } = await import('../core/state.js');
const { ZONE_GROUND_Y } = await import('../world/level.js');
const { specialPool } = await import('../objects/projectile.js');
const { tryFire } = await import('../combat/shooting.js');
const { Entity } = await import('../core/entity.js');
const { LAYER } = await import('../consts.js');
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
for (const platform of [null, { x: 350, y: 300, w: 100, h: 12, oneWay: true },
  { x: 350, y: 300, w: 100, h: 80 }]) {
  reset(platform);
  const surface = platform?.y ?? ZONE_GROUND_Y;
  const h = U.spawnBombAttack('molotov', { origin: { x: 400, y: surface - 10 },
    speed: 120, direction: Math.PI / 2, arc: 0, fireDuration: 0.5, team: 'ally' });
  U.update(dt);
  assert.equal(h.handles.length, 1);
  assert.equal(h.handles[0].zone.y + 48, surface);
  assert.equal(h._completed, false);
  const rects = [];
  const draw = new Proxy({}, {
    get: (_, key) => key === 'fillRect' ? (...r) => rects.push(r)
      : key === 'createLinearGradient' || key === 'createRadialGradient' ? () => gradientStub
      : noop,
    set: () => true,
  });
  render(draw);
  assert.ok(rects.some(r => r.join(',') === [352, surface - 48, 96, 48].join(',')), 'real render draws fire');
  for (let i = 0; i < 40; i++) U.update(dt);
  assert.equal(h._completed, true);
  assert.equal(U.bombAttacks.roots.size, 0);
  console.log(`PASS real update/render molotov ${platform ? platform.oneWay ? 'platform' : 'block' : 'floor'}`);
}
reset();
hero.acquireSpecial('bomb');
hero.timers.clear('special');
tryFire(hero, { shoot: true, aimX: 1, aimY: 0 }, dt);
assert.equal(U.bombAttacks.roots.size, 1, 'real weapon input registers a root');
const weapon = [...U.bombAttacks.roots][0].h;
assert.equal(weapon.id, 'explosiveBomb');
// The macro's carrier is the ballistic primitive (renamed from 'bomb' in
// d3c7571e) — the entity carries the PRIMITIVE id, the handle carries the
// MACRO id ('explosiveBomb', asserted above).
assert.equal(weapon.entity._attackId, 'ballistic');
for (let i = 0; i < 100; i++) U.update(dt);
assert.equal(weapon._completed, true);
console.log('PASS real tryFire bomb → host → fuse detonation');

reset();
const target = new Entity({ x: 390, y: 200, w: 32, h: 32, gravity: 0, layer: LAYER.ENEMY });
target.hp = 200;
target.takeDamage = (n) => { target.hp -= n; return n; };
U.getCollisionWorld().add(target);
const h = U.spawnBombAttack('molotov', { origin: { x: 400, y: 210 }, speed: 0, arc: 0, ttl: 2 });
U.update(dt);
assert.equal(h.handles.length, 1, 'real collision detonates engine payload');
// Enemy contact detonates midair: the fire anchors at the BOTTLE's break-time
// position (no surface landing), so the box sits near the impact point — not
// glued to the floor. The invariant: the zone is in-bounds and damage matches render.
assert.ok(h.handles[0].zone.y > 100 && h.handles[0].zone.y + h.handles[0].zone.h < ZONE_GROUND_Y + 48,
  `midair fire anchored near the impact (top=${h.handles[0].zone.y})`);
assert.equal(target.hp, 188, 'contact damage applied once');
U.getCollisionWorld().remove(target);
U.loadActiveZone(zone, { solids: zone.platforms, enemies: [], barrels: [], powerups: [], checkpoints: [] });
assert.equal(h._cancelled, true);
assert.equal(U.bombAttacks.roots.size, 0);
assert.ok(!specialPool.items.some(s => s.alive && s._attackId === 'ballistic'));
console.log('PASS real collision dispatch and zone teardown');

// 'bomb' was the PRIMITIVE id, renamed to 'ballistic' in d3c7571e — it is not
// a spawnable attack anymore; the macro list below covers the real ids.
for (const id of ['explosiveBomb', 'clusterBomb', 'bombSpread', 'spawnSplit']) {
  reset();
  const h = U.spawnBombAttack(id, { origin: { x: 600, y: 200 }, x: 600, y: 200,
    speed: 0, force: 0, arc: 0, ttl: dt, childForce: 0, childArc: 0,
    childTtl: dt, count: 3, spawnType: 'bomb', ballistic: { ttl: dt, arc: 0 } });
  for (let i = 0; i < 10; i++) U.update(dt);
  assert.equal(h._completed, true, `${id}: real gameplay drains all payloads`);
  assert.equal(U.bombAttacks.roots.size, 0);
  console.log(`PASS real update ${id} lifecycle`);
}

// Terrain regressions: use the real pool integration, terrain pass, collision
// world and attack host (not a direct handler/reflectVelocity invocation).
for (const team of ['ally', 'foe']) {
  const block = { x: 350, y: 250, w: 100, h: 100 };
  for (const [name, origin, vx, vy, expectedX, expectedY] of [
    ['left wall', { x: 340, y: 290 }, 120, 30, -96, 30],
    ['right wall', { x: 460, y: 290 }, -120, 30, 96, 30],
    ['ceiling', { x: 400, y: 360 }, 30, -120, 30, 96],
    ['top', { x: 400, y: 240 }, 30, 120, 21, -60],
    ['top corner', { x: 342, y: 240 }, 30, 120, 21, -60],
  ]) {
    reset(block);
    const h = U.spawnBombAttack('ballistic', { origin, speed: 0, arc: 0, ttl: 2, team });
    const e = h.entity;
    e.vx = vx; e.vy = vy;
    U.update(dt);
    assert.equal(e.vx, expectedX, `${team} ${name}: horizontal response`);
    assert.equal(e.vy, expectedY, `${team} ${name}: vertical response`);
    assert.ok(e.alive);
    const box = e.worldBox();
    assert.ok(box.x + box.w <= block.x || box.x >= block.x + block.w ||
      box.y + box.h <= block.y || box.y >= block.y + block.h, 'separated from block');
    U.update(dt);
    assert.equal(e.vx, expectedX, 'no duplicate horizontal bounce');
    assert.equal(e.vy, expectedY, 'no duplicate vertical bounce');
    console.log(`PASS real ${team} bomb ${name} reflection`);
  }
  reset(block);
  const h = U.spawnBombAttack('molotov', { origin: { x: 340, y: 290 },
    speed: 120, direction: 0, arc: 0, ttl: 2, team });
  // Record the event; assert AFTER the update so an assertion inside the
  // synchronous _emit callback cannot throw mid-step (uncaught → test crash).
  let detonations = 0;
  let ev = null;
  h.entity._attackHandle.on('detonate', (e) => { detonations++; ev = e; });
  U.update(dt);
  assert.equal(detonations, 1);
  // A SIDE impact kills the carrier via collision dispatch (not terrain
  // settling), so it reports as a timed end — only TOP landings carry
  // surfaceY. The invariant: no surface claim for a side hit.
  assert.equal(ev.surfaceY, null, 'side impact claims no surface landing');
  assert.equal(h.handles.length, 1, 'side impact spawns actual fire payload');
  U.update(dt);
  assert.equal(detonations, 1, 'payload only fires once');
  console.log(`PASS real ${team} stop bomb wall payload`);

  for (const bounce of [true, false]) {
    reset({ ...block, h: 12, oneWay: true });
    const h = U.spawnBombAttack('ballistic', { origin: { x: 400, y: 272 },
      speed: 0, arc: 0, ttl: 2, team, bounce });
    h.entity.vy = -120;
    for (let i = 0; i < 20; i++) U.update(dt);
    assert.ok(h.entity.alive, 'one-way underside must not stop bomb');
    assert.equal(h.entity.vy, -120, 'one-way underside must not reflect bomb');
    assert.ok(h.entity.y + h.entity.h < block.y, 'passes completely through from below');
    console.log(`PASS real ${team} bomb one-way pass below (bounce=${bounce})`);
  }
}
