import { strict as assert } from 'node:assert';
import '../../combat/attack/primitives/explosion.js';
import '../../combat/attack/macros/index.js';
import { invoke } from '../../combat/attack/engine.js';
import { Pool, Special } from '../../objects/projectile.js';

const dt = 1 / 60;
function context() {
  return {
    attacker: { x: 0, y: 0, w: 32, h: 48 },
    pools: { specialPool: new Pool(Special, 16) },
    groundY: 10000, world: { targets: [] },
    effects: { spawnExplosion() {}, bigExplosion() {}, triggerShake() {} },
  };
}
for (const death of ['impact', 'fuse']) {
  const ctx = context();
  const h = invoke('clusterBomb', {
    origin: { x: 400, y: 200 }, ttl: dt,
    childAngle: Math.PI, childTtl: 2, arc: 800, childArc: 700,
  }, ctx);
  if (death === 'impact') {
    h.entity.alive = false;
    h.entity._attackHit = true;
  } else {
    ctx.pools.specialPool.updateAll(dt);
  }
  const x = h.entity.x + h.entity.w / 2;
  const y = h.entity.y + h.entity.h / 2;
  h.step(dt);
  assert.equal(h.handles.length, 4);
  assert.equal(h._completed, false, 'parent must wait for children');
  const pool = ctx.pools.specialPool;
  assert.equal(pool.active.length, 4);
  assert.equal(new Set(pool.active).size, 4, 'no duplicate active entries');

  const directCtx = context();
  const direct = invoke('spawnSplit', {
    x, y, count: 4, centerDirection: -Math.PI / 2,
    angle: Math.PI, force: 300, spawnType: 'ballistic',
    bomb: { arc: 700, bounce: false, ttl: 2, damage: 15, radius: 30 },
  }, directCtx);
  for (let frame = 0; frame < 30; frame++) {
    pool.updateAll(dt);
    directCtx.pools.specialPool.updateAll(dt);
    h.step(dt);
    direct.step(dt);
    for (let i = 0; i < 4; i++) {
      for (const key of ['x', 'y', 'vx', 'vy']) {
        assert.ok(Math.abs(h.handles[i].entity[key] - direct.handles[i].entity[key]) < 1e-9,
          `${death} frame ${frame} child ${i} ${key}`);
      }
    }
  }
  for (const ch of h.handles) ch.entity.alive = false;
  h.step(dt);
  assert.equal(h._completed, true);
  console.log(`PASS ${death}: all four trajectories match direct spawnSplit for 30 frames`);
}
