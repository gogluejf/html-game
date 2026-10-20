import { strict as assert } from 'node:assert';
import { BombAttackHost } from '../../combat/attack/bombAttackHost.js';
import { Pool, Special } from '../../objects/projectile.js';
import { stepBombTerrain } from '../../combat/attack/primitives/bomb.js';
import { LAYER } from '../../consts.js';

const dt = 1 / 60;
const attacker = { x: 0, y: 0, w: 32, h: 32 };
function setup(size = 16, platforms = []) {
  const pool = new Pool(Special, size);
  const target = { x: 390, y: 376, w: 24, h: 24, layer: LAYER.ENEMY,
    alive: true, hp: 1000, takeDamage(n) { this.hp -= n; return n; } };
  const context = { pools: { specialPool: pool }, groundY: 400, platforms,
    bombTerrainStepped: true, world: { targets: [target] } };
  const host = new BombAttackHost(() => context);
  const frame = () => {
    pool.updateAll(dt);
    // Gameplay order: integrate (including fuse death), shared terrain,
    // collision dispatch, then root lifecycle. No theater child promotion.
    for (const e of pool.items) stepBombTerrain(e, dt, 400, platforms);
    host.step(dt);
  };
  return { pool, target, context, host, frame };
}

for (const platform of [null, { x: 350, y: 300, w: 100, oneWay: true },
  { x: 350, y: 250, w: 100, h: 80 }]) {
  const surface = platform?.y ?? 400;
  const { host, target, frame } = setup(4, platform ? [platform] : []);
  target.y = surface - 24;
  const h = host.spawn('molotov', { origin: { x: 400, y: surface - 10 },
    direction: Math.PI / 2, speed: 120, arc: 0, fireDuration: 0.5 }, attacker);
  let completes = 0;
  h.on('complete', () => completes++);
  frame();
  assert.equal(completes, 0, 'carrier completion must not escape as root completion');
  assert.equal(h._completed, false);
  assert.equal(h.handles[0].zone.y + 48, surface);
  const rects = [];
  host.draw({ save() {}, restore() {}, strokeRect() {}, fillRect(...r) { rects.push(r); } });
  assert.deepEqual(rects, [[352, surface - 48, 96, 48]]);
  for (let i = 0; i < 40; i++) frame();
  assert.ok(target.hp < 1000, 'host steps damage after carrier death');
  assert.equal(completes, 1);
  assert.equal(host.roots.size, 0);
  console.log(`PASS host molotov surface ${surface}: placement, draw, damage, completion`);
}

for (const id of ['bomb', 'explosiveBomb', 'molotov', 'clusterBomb', 'bombSpread', 'spawnSplit']) {
  const { host, pool, frame } = setup(2);
  const h = host.spawn(id, { origin: { x: 400, y: 200 }, x: 400, y: 200,
    speed: 0, force: 0, arc: 0, ttl: dt, childTtl: dt, childForce: 0,
    childArc: 0, count: 4, fireDuration: 0.1, spawnType: 'bomb',
    bomb: { ttl: dt, arc: 0, blastTeam: 'foe' } }, attacker);
  let completes = 0;
  h.on('complete', () => completes++);
  for (let i = 0; i < 180; i++) frame();
  assert.equal(h._completed, true, `${id} completes despite partial pool exhaustion`);
  assert.equal(completes, 1, `${id} completes exactly once`);
  assert.equal(host.roots.size, 0);
  assert.equal(pool.items.filter(e => e.alive).length, 0);
  console.log(`PASS host ${id}: fuse, child lifecycle, pool exhaustion`);
}

{
  const { pool, host, frame } = setup(1);
  const h = host.spawn('clusterBomb', { speed: 0, arc: 0, ttl: dt, count: 1,
    childTtl: 0.2, childArc: 0 }, attacker);
  frame();
  const child = h.handles[0];
  assert.equal(child.entity, h.entity, 'child recycles parent slot');
  assert.equal(child.entity._attackDone, false, 'parent cannot poison child generation');
  for (let i = 0; i < 20; i++) frame();
  assert.equal(h._completed, true);
  const reused = pool.spawn(0, 0, 0, 'saw');
  assert.equal(reused._attackHandle, undefined);
  assert.equal(reused._attackId, undefined);
  assert.equal(reused._bombSurfaceY, undefined);
  console.log('PASS recycled carrier and legacy special have no stale attack state');
}

{
  const { host, frame } = setup();
  const h = host.spawn('molotov', { origin: { x: 400, y: 200 }, speed: 0, arc: 0, ttl: dt }, attacker);
  frame();
  assert.equal(h.handles[0].zone.y, 352, 'midair fire anchors to ground (400 - 48/2 center → 352 top)');
  host.clear();
  assert.equal(h._cancelled, true);
  assert.equal(h.handles[0]._cancelled, true);
  assert.equal(host.roots.size, 0);
  console.log('PASS midair policy and zone teardown');
}

{
  const { pool, host } = setup(1);
  const h = host.spawn('explosiveBomb', { ttl: dt }, attacker);
  pool.updateAll(dt);
  assert.equal(pool.spawn(0, 0, 0, 'saw'), null, 'pending detonation reserves dead slot');
  host.step(dt);
  assert.ok(pool.spawn(0, 0, 0, 'saw'));
  assert.equal(h._completed, true);
  console.log('PASS dead carrier cannot be stolen before terminal dispatch');
}

{
  const e = { x: 390, y: 450, w: 18, h: 18, vy: 20000, vx: 0,
    alive: true, solidBehavior: 'stop', _bombPrevBottom: 200 };
  stepBombTerrain(e, dt, 400, [{ x: 350, y: 350, w: 100 }, { x: 350, y: 300, w: 100 }]);
  assert.equal(e.y + e.h, 300, 'first crossed surface wins over floor and array ordering');
  console.log('PASS swept landing chooses highest crossed platform');
}

{
  const { host, frame } = setup();
  const h = host.spawn('molotov', { origin: { x: 400, y: 390 },
    speed: 120, direction: Math.PI / 2, arc: 0, ttl: dt }, attacker);
  frame();
  assert.equal(h.handles[0].zone.y + 48, 400, 'fuse-frame landing uses actual surface');
  console.log('PASS simultaneous landing and fuse expiry');
}
for (const id of ['clusterBomb', 'bombSpread', 'spawnSplit']) {
  const { host, pool, frame } = setup();
  const h = host.spawn(id, { ttl: dt, count: 3, spawnType: 'bomb',
    blastTeam: 'foe', bomb: { blastTeam: 'foe' } }, attacker);
  frame();
  assert.ok(h.handles.every(ch => ch.entity.layer === LAYER.PROJ_FOE));
  host.clear();
  assert.ok(pool.items.every(e => !e.alive), 'teardown kills every child carrier');
  console.log(`PASS ${id} foe routing and child cancellation`);
}
