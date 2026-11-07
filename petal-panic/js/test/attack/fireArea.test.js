// Task 1.13 — Fire / Persistent Area primitive tests (pure logic, no DOM).
// Run: node js/test/attack/fireArea.test.js

import { strict as assert } from 'node:assert';
import { fireAreaBox } from '../../combat/attack/primitives/fireArea.js';
import '../../combat/attack/macros/molotov.js';
import '../../combat/attack/macros/napalm.js';
import { Pool, Projectile } from '../../objects/projectile.js';
import { invoke } from '../../combat/attack/engine.js';
import { AttackLifecycle } from '../../combat/attack/lifecycle.js';
import { makeContext } from '../../combat/attack/context.js';
import { stepBombTerrain } from '../../combat/attack/primitives/projectile.js';
import { LAYER } from '../../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });
const P = { x: 400, y: 380, segments: 2, duration: 1, tickRate: 5, damage: 6, team: 'ally' };

function dummyEnemy(x, y, hp = 100) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

ok('box is centered on the given point', () => {
  const box = fireAreaBox(P);
  assert.ok(Math.abs(box.x - 352) < 1e-9, `x=${box.x}`);
  assert.ok(Math.abs(box.y - 356) < 1e-9, `y=${box.y}`);
  assert.equal(box.w, 96);
  assert.equal(box.h, 48);
});

ok('ticks damage while a target stands in the area', () => {
  const ctx = makeContext(attacker(), { groundY: P.y + 24 });
  const enemy = dummyEnemy(390, 370); // inside
  const h = invoke('fireArea', P, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  // Run to completion at 5Hz over ~1s → 4–5 ticks of 6 dmg (frame quantization).
  let finished = false;
  for (let i = 0; i < 62 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(finished);
  assert.ok(hits.length >= 4 && hits.length <= 5, `got ${hits.length} ticks`);
  assert.equal(enemy.hp, 100 - hits.length * 6);
});

ok('target outside the area takes nothing', () => {
  const ctx = makeContext(attacker(), { groundY: P.y + 24 });
  const enemy = dummyEnemy(600, 100);
  const h = invoke('fireArea', P, ctx);
  let n = 0;
  h.on('hit', () => n++);
  for (let i = 0; i < 60; i++) h.step(DT, [enemy]);
  assert.equal(n, 0);
  assert.equal(enemy.hp, 100);
});

ok('a target that walks in only burns while inside', () => {
  const ctx = makeContext(attacker(), { groundY: P.y + 24 });
  const enemy = dummyEnemy(200, 370); // starts left of the area
  const h = invoke('fireArea', P, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  for (let i = 0; i < 60; i++) {
    h.step(DT, [enemy]);
    enemy.x += 4 * DT * 60; // walk right at 4px/frame
  }
  // It crosses ~96px of the 96px-wide area → several but not all 5 ticks.
  assert.ok(hits.length >= 2 && hits.length <= 4, `got ${hits.length} ticks`);
});

ok('completes after duration and stops ticking', () => {
  const ctx = makeContext(attacker(), { groundY: P.y + 24 });
  const enemy = dummyEnemy(390, 370);
  const h = invoke('fireArea', P, ctx);
  let done = null;
  h.on('complete', (i) => { done = i; });
  for (let i = 0; i < 60; i++) h.step(DT, [enemy]);
  assert.equal(h.step(DT, [enemy]), true, 'idempotent after done');
  assert.ok(done.ticks >= 4 && done.ticks <= 6, `ticks=${done.ticks}`);
});

ok('team routing: foe area skips enemies', () => {
  const ctx = makeContext(attacker(), { groundY: P.y + 24 });
  const enemy = dummyEnemy(390, 370);
  const h = invoke('fireArea', { ...P, team: 'foe' }, ctx);
  let n = 0;
  h.on('hit', () => n++);
  for (let i = 0; i < 30; i++) h.step(DT, [enemy]);
  assert.equal(n, 0);
});

for (const scenario of [
  { name: 'floor impact', y: 391, surface: 400, impact: true },
  { name: 'platform impact', y: 291, surface: 300, impact: true, platforms: [{ x: 350, y: 300, w: 100 }] },
]) {
  ok(`Molotov ${scenario.name}: rendered fire and damage share the impact box`, () => {
    const ctx = {
      attacker: attacker(), groundY: 400, platforms: scenario.platforms ?? [],
      pools: { projectilePool: new Pool(Projectile, 4) }, world: { targets: [] },
    };
    const h = invoke('molotov', {
      origin: { x: 400, y: scenario.y }, speed: 0, arc: 0, ttl: DT,
    }, ctx);
    if (scenario.impact) h.entity.vy = 10;
    else ctx.pools.projectilePool.updateAll(DT);
    h.step(DT);
    assert.equal(h.handles.length, 1);
    const fire = h.handles[0];
    if (scenario.impact) {
      assert.equal(fire.zone.y + fire.zone.h, scenario.surface, 'landing: box bottom on the surface');
    } else {
      // Midair: anchored near the bottle's break-time position (gravity drift
      // makes the exact y engine-internal — the invariant is below).
      assert.ok(fire.zone.y > 0 && fire.zone.y < 400, `midair: box in-bounds (top=${fire.zone.y})`);
    }
    const rects = [];
    const gradStub = { addColorStop() {} };
    fire.zone.draw({ save() {}, restore() {}, strokeRect() {},
      fillRect(...args) { rects.push(args); },
      createLinearGradient: () => gradStub, createRadialGradient: () => gradStub });
    // The fire drawer paints the base glow rect PLUS time-based flicker
    // columns (performance.now()-driven), so assert the glow rect specifically.
    // The glow rect is the zone box itself (the drawer paints it from z.x/y/w/h).
    assert.ok(rects.some(r => r[0] === fire.zone.x && r[1] === fire.zone.y && r[2] === fire.zone.w && r[3] === fire.zone.h),
      `glow rect matches the zone box (zone=${JSON.stringify([fire.zone.x, fire.zone.y, fire.zone.w, fire.zone.h])}, got ${JSON.stringify(rects.slice(0, 3))})`);
    // Probe INSIDE the actual zone box — if render and damage ever drift,
    // a target standing in the visible fire stops taking damage (or vice versa).
    const enemy = dummyEnemy(fire.zone.x + fire.zone.w / 2 - 12, fire.zone.y + fire.zone.h / 2 - 12);
    fire.step(0.2, [enemy]);
    assert.equal(enemy.hp, 92, 'one tick (8 dmg) lands on a target inside the visible fire');
    // The damage box must match the RENDERED zone exactly (see-what-hurts).
    assert.deepEqual(fire.zone._hb.box,
      { x: fire.zone.x, y: fire.zone.y, w: fire.zone.w, h: fire.zone.h },
      'damage box matches the rendered zone');
  });
}

function molotovFixture() {
  const pool = new Pool(Projectile, 4);
  const ctx = { attacker: attacker(), groundY: 480, platforms: [],
    pools: { projectilePool: pool }, world: { targets: [] } };
  return { pool, h: invoke('molotov', {
    origin: { x: 400, y: 100 }, speed: 0, arc: 0, ttl: DT,
  }, ctx) };
}
ok('Molotov ignores a caller-supplied flight TTL', () => {
  const { pool, h } = molotovFixture();
  for (let i = 0; i < 120; i++) { pool.updateAll(DT); h.step(DT); }
  assert.equal(h.entity.alive, true);
  assert.equal(h.handles.length, 0);
});
ok('Molotov offscreen removal produces no fire', () => {
  const { h } = molotovFixture();
  h.entity.y = -60;
  h.entity.alive = false;
  h.step(DT);
  assert.equal(h.handles.length, 0);
  assert.equal(h._completed, true);
});
ok('Molotov side contact uses recorded impact, not floor or carrier center', () => {
  const { h } = molotovFixture();
  h.entity._impactPoint = { x: 420, y: 160 };
  h.entity._attackHit = true;
  h.entity.alive = false;
  h.step(DT);
  assert.equal(h.handles.length, 1);
  const z = h.handles[0].zone;
  assert.equal(z.x + z.w / 2, 420);
  assert.ok(z.y + z.h / 2 > 160, 'side-contact fire starts falling immediately');
  assert.ok(z.y + z.h < 480, 'does not teleport to the floor');
});
ok('One-way platform cannot catch a bottle far above its top', () => {
  const { h } = molotovFixture();
  const e = h.entity;
  e.y = 21.2; e._bombPrevBottom = 39.1; e.vy = 4;
  assert.equal(stepBombTerrain(e, DT, 480,
    [{ x: 350, y: 384, w: 100, oneWay: true }]), false);
  assert.equal(e.y, 21.2);
  e.y = 377; e._bombPrevBottom = 380; e.vy = 900;
  assert.equal(stepBombTerrain(e, DT, 480,
    [{ x: 350, y: 384, w: 100, oneWay: true }]), true);
  assert.equal(e.y + e.h, 384);
});

ok('airborne fire falls, sweeps to floor, and moves its damage box', () => {
  const h = invoke('fireArea', { x: 100, y: 50, segments: 3, duration: 10 }, { groundY: 400 });
  h.step(0.1);
  assert.ok(h.zone.y > 26);
  h.step(1);
  assert.equal(h.zone.y + h.zone.h, 400);
  assert.equal(h.zone.w, 144);
  assert.deepEqual(h.zone._hb.box, { x: h.zone.x, y: h.zone.y, w: 144, h: 48 });
});
for (const kind of ['platform', 'block', 'barrel']) {
  ok(`fire lands on ${kind} and falls after support disappears`, () => {
    const support = { x: 50, y: 200, w: 100, h: 40, alive: true, layer: LAYER.SOLID };
    const ctx = { groundY: 400, platforms: kind === 'platform' ? [support] : [],
      collisionWorld: { entities: new Set(kind === 'platform' ? [] : [support]) } };
    const h = invoke('fireArea', { x: 100, y: 50, duration: 10 }, ctx);
    h.step(0.5);
    assert.equal(h.zone.y + h.zone.h, 200);
    support.alive = false;
    h.step(0.5);
    assert.equal(h.zone.y + h.zone.h, 400);
  });
}
ok('enemies, projectiles and overhead platforms do not retain fire', () => {
  const ctx = { groundY: 400, platforms: [{ x: 0, y: 10, w: 200, h: 20 }],
    collisionWorld: { entities: new Set([LAYER.ENEMY, LAYER.PROJ_ALLY].map(layer =>
      ({ x: 0, y: 200, w: 200, h: 40, alive: true, layer }))) } };
  const h = invoke('fireArea', { x: 100, y: 50, duration: 10 }, ctx);
  h.step(1);
  assert.equal(h.zone.y + h.zone.h, 400);
});
ok('napalm expiry creates airborne fire, then gravity lands it', () => {
  const ctx = { groundY: 400, platforms: [{ x: 0, y: 10, w: 200, h: 10 }],
    pools: { projectilePool: new Pool(Projectile, 4) } };
  const h = invoke('napalm', { origin: { x: 100, y: 100 }, speed: 0, ttl: 1 }, ctx);
  ctx.pools.projectilePool.updateAll(1);
  h.step(0);
  assert.equal(h.handles.length, 1);
  const fire = h.handles[0];
  assert.equal(fire.zone.y + 24, 100);
  fire.step(0.1);
  assert.ok(fire.zone.y > 76);
  fire.step(1);
  assert.equal(fire.zone.y + fire.zone.h, 400);
});

for (const kind of ['ground', 'platform', 'block']) {
  ok(`bare fire receives live ${kind} terrain through the registry`, () => {
    AttackLifecycle.clear();
    const support = { x: 50, y: 200, w: 100, h: 40, alive: true, layer: LAYER.SOLID };
    const live = { groundY: kind === 'ground' ? 200 : 400,
      platforms: kind === 'platform' ? [support] : [],
      collisionWorld: { entities: new Set(kind === 'block' ? [support] : []) } };
    const h = invoke('fireArea', { x: 100, y: 100, duration: 10 }, { world: { targets: [] } });
    for (let i = 0; i < 120; i++) AttackLifecycle.stepAll(DT, [], { refreshCtx: () => live });
    assert.equal(h.zone.y + h.zone.h, 200);
    if (kind !== 'ground') {
      support.alive = false;
      for (let i = 0; i < 60; i++) AttackLifecycle.stepAll(DT, [], { refreshCtx: () => live });
      assert.equal(h.zone.y + h.zone.h, 400);
    }
    AttackLifecycle.clear();
  });
}
ok('bare molotov passes refreshed terrain to its deferred fire', () => {
  AttackLifecycle.clear();
  const pool = new Pool(Projectile, 4);
  const h = invoke('molotov', { origin: { x: 100, y: 100 }, speed: 0, arc: 0 },
    { pools: { projectilePool: pool }, world: { targets: [] } });
  h.entity._impactPoint = { x: 100, y: 100 };
  h.entity._attackHit = true;
  h.entity.alive = false;
  for (let i = 0; i < 120; i++) AttackLifecycle.stepAll(DT, [], {
    refreshCtx: () => ({ groundY: 200, platforms: [] }),
  });
  assert.equal(h.handles[0].zone.y + h.handles[0].zone.h, 200);
  AttackLifecycle.clear();
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
