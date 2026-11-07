// Task 1.13 — Fire / Persistent Area primitive tests (pure logic, no DOM).
// Run: node js/test/attack/fireArea.test.js

import { strict as assert } from 'node:assert';
import { fireAreaBox, FIRE_UNIT, FIRE_HEIGHT } from '../../combat/attack/primitives/fireArea.js';
import '../../combat/attack/macros/molotov.js';
import '../../combat/attack/macros/napalm.js';
import { Pool, Projectile } from '../../objects/projectile.js';
import { invoke } from '../../combat/attack/engine.js';
import { AttackLifecycle } from '../../combat/attack/lifecycle.js';
import { makeContext } from '../../combat/attack/context.js';
import { stepBombTerrain } from '../../combat/attack/primitives/projectile.js';
import { LAYER } from '../../consts.js';
import { molotovDrawer } from '../../combat/attack/drawers/ballistic/molotov.js';
import { fireballDrawer } from '../../combat/attack/drawers/ballistic/fireball.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });
const P = { x: 400, y: 380, segments: 3, duration: 1, tickRate: 5, damage: 6, team: 'ally' };

function dummyEnemy(x, y, hp = 100) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

ok('box is centered on the given point', () => {
  const box = fireAreaBox(P);
  assert.ok(Math.abs(box.x - 328) < 1e-9, `x=${box.x}`); // 400 - 72
  assert.ok(Math.abs(box.y - 356) < 1e-9, `y=${box.y}`);
  assert.equal(box.w, 144); // 3 × 48
  assert.equal(box.h, 48);
});

ok('ticks damage while a target stands in ONE segment (no double-dip)', () => {
  const ctx = makeContext(attacker(), { groundY: P.y + 24 });
  const enemy = dummyEnemy(390, 370); // inside the LEFT segment only
  const h = invoke('fireArea', P, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  // One segment under the target → 5Hz over ~1s → 4–5 ticks of 6 dmg.
  let finished = false;
  for (let i = 0; i < 62 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(finished);
  assert.ok(hits.length >= 4 && hits.length <= 5, `got ${hits.length} ticks`);
  assert.equal(enemy.hp, 100 - hits.length * 6);
});

ok('a target spanning TWO segments takes ONE tick (union box, no double-dip)', () => {
  const ctx = makeContext(attacker(), { groundY: P.y + 24 });
  const enemy = dummyEnemy(396, 370, 999); // straddles the seam at x=400
  const h = invoke('fireArea', P, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  for (let i = 0; i < 30; i++) h.step(DT, [enemy]);
  // Union box = one hitbox → same tick count as a single-segment target (~2-3 in 0.5s).
  assert.ok(hits.length >= 2 && hits.length <= 3, `got ${hits.length} ticks`);
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
  ok(`Molotov ${scenario.name}: rendered fire and damage share the impact boxes`, () => {
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
    const segs = fire.zone.segs;
    assert.equal(segs.length, 3);
    if (scenario.impact) {
      for (const s of segs) {
        assert.equal(s.y + s.h, scenario.surface, 'landing: segment bottom on the surface');
      }
    } else {
      for (const s of segs) {
        assert.ok(s.y > 0 && s.y < 400, `midair: segment in-bounds (top=${s.y})`);
      }
    }
    // Let the center-out APPEARANCE spread finish (max delay < 0.1s for 3
    // segs) so the render/damage lockstep check runs with every flame visible.
    for (let i = 0; i < 12; i++) fire.step(DT);
    const rects = [];
    const gradStub = { addColorStop() {} };
    fire.zone.draw({ save() {}, restore() {}, strokeRect() {},
      fillRect(...args) { rects.push(args); },
      createLinearGradient: () => gradStub, createRadialGradient: () => gradStub });
    // The drawer paints one glow rect PER SEGMENT from its live box.
    for (const s of segs) {
      assert.ok(rects.some(r => r[0] === s.x && r[1] === s.y && r[2] === FIRE_UNIT && r[3] === FIRE_HEIGHT),
        `glow rect matches a segment box (seg=${JSON.stringify([s.x, s.y, s.w, s.h])}, got ${JSON.stringify(rects.slice(0, 4))})`);
    }
    // Probe INSIDE the left segment — render/damage lockstep per segment.
    const left = segs[0];
    const enemy = dummyEnemy(left.x + left.w / 2 - 12, left.y + left.h / 2 - 12);
    fire.step(0.2, [enemy]);
    assert.equal(enemy.hp, 92, 'one tick (8 dmg) lands on a target inside the visible fire');
    // Per-segment damage boxes must match their rendered segment (see-what-hurts).
    const leftHb = fire._segHbs[0].box;
    assert.deepEqual(leftHb, { x: left.x, y: left.y, w: FIRE_UNIT, h: FIRE_HEIGHT });
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
ok('Molotov flight fuse (flightTtl) shatters into fire midair', () => {
  const pool = new Pool(Projectile, 4);
  const ctx = { attacker: attacker(), groundY: 480, platforms: [],
    pools: { projectilePool: pool }, world: { targets: [] } };
  const h = invoke('molotov', { origin: { x: 400, y: 100 }, speed: 0, arc: 0, flightTtl: 1 }, ctx);
  for (let i = 0; i < 62 && !h._completed; i++) { pool.updateAll(DT); h.step(DT); }
  assert.equal(h.entity.alive, false, 'fuse expired');
  assert.equal(h.handles.length, 1, 'fire spawned at the death point');
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
  const segs = h.handles[0].zone.segs;
  const cx = segs[0].x + (segs.length * FIRE_UNIT) / 2;
  assert.equal(cx, 420);
  assert.ok(segs[0].y + FIRE_HEIGHT / 2 > 160, 'side-contact fire starts falling immediately');
  assert.ok(segs[0].y + FIRE_HEIGHT < 480, 'does not teleport to the floor');
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

ok('airborne fire falls, sweeps to floor, and moves its damage boxes', () => {
  const h = invoke('fireArea', { x: 100, y: 50, segments: 3, duration: 10 }, { groundY: 400 });
  h.step(0.1);
  assert.ok(h.zone.segs[0].y > 26);
  h.step(1);
  for (const s of h.zone.segs) assert.equal(s.y + s.h, 400);
  assert.equal(h.zone.segs.length * FIRE_UNIT, 144);
  const hb0 = h._segHbs[0].box;
  assert.equal(hb0.w, FIRE_UNIT, 'segment hitbox is one unit wide');
});
for (const kind of ['platform', 'block', 'barrel']) {
  ok(`fire lands on ${kind} and falls after support disappears`, () => {
    const support = { x: 50, y: 200, w: 100, h: 40, alive: true, layer: LAYER.SOLID };
    const ctx = { groundY: 400, platforms: kind === 'platform' ? [support] : [],
      collisionWorld: { entities: new Set(kind === 'platform' ? [] : [support]) } };
    const h = invoke('fireArea', { x: 100, y: 50, duration: 10 }, ctx);
    h.step(0.5);
    for (const s of h.zone.segs) assert.equal(s.y + s.h, 200);
    support.alive = false;
    h.step(0.5);
    for (const s of h.zone.segs) assert.equal(s.y + s.h, 400);
  });
}
ok('enemies, projectiles and overhead platforms do not retain fire', () => {
  const ctx = { groundY: 400, platforms: [{ x: 0, y: 10, w: 200, h: 20 }],
    collisionWorld: { entities: new Set([LAYER.ENEMY, LAYER.PROJ_ALLY].map(layer =>
      ({ x: 0, y: 200, w: 200, h: 40, alive: true, layer }))) } };
  const h = invoke('fireArea', { x: 100, y: 50, duration: 10 }, ctx);
  h.step(1);
  for (const s of h.zone.segs) assert.equal(s.y + s.h, 400);
});
ok('segment over a gap falls past a neighbor\'s platform (per-column support)', () => {
  // Platform spans only the LEFT half of a 2-segment fire (x 50..98, segs at 50..98 and 98..146).
  const plat = { x: 50, y: 200, w: 48, h: 40, alive: true, layer: LAYER.PLATFORM };
  const ctx = { groundY: 400, platforms: [plat], collisionWorld: { entities: new Set() } };
  const h = invoke('fireArea', { x: 98, y: 50, segments: 2, duration: 10 }, ctx);
  h.step(1);
  const [left, right] = h.zone.segs;
  assert.equal(left.y + left.h, 200, 'left segment rests on the platform');
  assert.equal(right.y + right.h, 400, 'right segment fell through the gap to the floor');
});
ok('destroying a support releases ONLY the segments standing on it', () => {
  const barrel = { x: 98, y: 200, w: 48, h: 40, alive: true, layer: LAYER.SOLID };
  const ctx = { groundY: 400, platforms: [], collisionWorld: { entities: new Set([barrel]) } };
  const h = invoke('fireArea', { x: 98, y: 50, segments: 2, duration: 10 }, ctx);
  h.step(1);
  const [left, right] = h.zone.segs;
  assert.equal(left.y + left.h, 400, 'left segment on the floor');
  assert.equal(right.y + right.h, 200, 'right segment on the barrel');
  barrel.alive = false;
  h.step(1);
  assert.equal(right.y + right.h, 400, 'released segment fell to the floor');
});
ok('napalm expiry creates airborne fire, then gravity lands it', () => {
  const ctx = { groundY: 400, platforms: [{ x: 0, y: 10, w: 200, h: 10 }],
    pools: { projectilePool: new Pool(Projectile, 4) } };
  const h = invoke('napalm', { origin: { x: 100, y: 100 }, speed: 0, ttl: 1 }, ctx);
  ctx.pools.projectilePool.updateAll(1);
  h.step(0);
  assert.equal(h.handles.length, 1);
  const fire = h.handles[0];
  const segs = fire.zone.segs;
  assert.equal(segs[0].y + FIRE_HEIGHT / 2, 100);
  fire.step(0.1);
  assert.ok(segs[0].y > 76);
  fire.step(1);
  for (const s of segs) assert.equal(s.y + s.h, 400);
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
    for (const s of h.zone.segs) assert.equal(s.y + s.h, 200);
    if (kind !== 'ground') {
      support.alive = false;
      for (let i = 0; i < 60; i++) AttackLifecycle.stepAll(DT, [], { refreshCtx: () => live });
      for (const s of h.zone.segs) assert.equal(s.y + s.h, 400);
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
  for (const s of h.handles[0].zone.segs) assert.equal(s.y + s.h, 200);
  AttackLifecycle.clear();
});

ok('direct molotov uses bottle drawer and spin; direct napalm keeps fireball', () => {
  const pool = new Pool(Projectile, 4);
  const ctx = makeContext(attacker(), { pools: { projectilePool: pool }, groundY: 480 });
  const m = invoke('molotov', { origin: { x: 100, y: 100 } }, ctx);
  const n = invoke('napalm', { origin: { x: 200, y: 100 } }, ctx);
  assert.equal(m.entity.type, 'molotov');
  assert.equal(m.entity.drawer, molotovDrawer);
  assert.ok(m.entity._rockTumble && Math.abs(m.entity._rockSpin) > 0);
  assert.equal(n.entity.drawer, fireballDrawer);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
