import { damage } from '../../combat/damage.js';
import '../../combat/attack/macros/molotov.js';
import { GameObj, WOOD_BARREL_DEF } from '../../objects/object.js';
// Task 1.17 — Spawn / Split primitive tests (pure logic, no DOM).
// Run: node js/test/attack/spawnSplit.test.js

import { strict as assert } from 'node:assert';
import { splitChildren } from '../../combat/attack/macros/spawnSplit.js'; // also registers the macro
import '../../combat/attack/primitives/projectile.js'; // for macro materialization
import '../../combat/attack/primitives/projectile.js';       // throwEnemy carrier (enemy children)
import '../../combat/attack/macros/throwEnemy.js';     // enemy children are thrown
import '../../combat/attack/macros/explosiveProjectile.js'; // impact children (child=explosion)
import '../../combat/attack/macros/shockwaveProjectile.js'; // child=shockwave
import '../../combat/attack/macros/napalm.js';          // child=napalm
import { Pool, Projectile } from '../../objects/projectile.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });
const P = { x: 400, y: 300, count: 3, centerDirection: 0, angle: Math.PI / 3, force: 300 };

ok('generates N children at the parent position', () => {
  const kids = splitChildren(P);
  assert.equal(kids.length, 3);
  for (const k of kids) assert.deepEqual({ x: k.x, y: k.y }, { x: 400, y: 300 });
});

ok('children fan out across the distribution angle', () => {
  const kids = splitChildren(P);
  // 3 shots across 60° centered on 0 → -30°, 0°, +30°.
  const angles = kids.map((k) => k.angle).sort((a, b) => a - b);
  assert.ok(Math.abs(angles[0] + Math.PI / 6) < 1e-9, `a0=${angles[0]}`);
  assert.ok(Math.abs(angles[1]) < 1e-9, `a1=${angles[1]}`);
  assert.ok(Math.abs(angles[2] - Math.PI / 6) < 1e-9, `a2=${angles[2]}`);
});

ok('velocity magnitude equals force (no inheritance)', () => {
  const kids = splitChildren(P);
  for (const k of kids) {
    assert.ok(Math.abs(Math.hypot(k.vx, k.vy) - 300) < 1e-9, `speed=${Math.hypot(k.vx, k.vy)}`);
  }
});

ok('inheritVelocity adds a fraction of the parent velocity', () => {
  const kids = splitChildren({ ...P, inheritVelocity: 0.5, parentVx: 200, parentVy: 0 });
  // Center child (angle 0): vx = 300 + 100 = 400.
  const center = kids.find((k) => Math.abs(k.angle) < 1e-9);
  assert.ok(Math.abs(center.vx - 400) < 1e-9, `vx=${center.vx}`);
  assert.ok(Math.abs(center.vy) < 1e-9, `vy=${center.vy}`);
});

ok('2π distribution produces a radial pattern', () => {
  const kids = splitChildren({ ...P, count: 4, angle: 2 * Math.PI });
  // Edge-to-edge spread over 2π centered on 0: -π, -π/3, +π/3, +π.
  const angles = kids.map((k) => k.angle).sort((a, b) => a - b);
  assert.ok(Math.abs(angles[0] + Math.PI) < 1e-9, `a0=${angles[0]}`);
  assert.ok(Math.abs(angles[1] + Math.PI / 3) < 1e-9, `a1=${angles[1]}`);
  assert.ok(Math.abs(angles[2] - Math.PI / 3) < 1e-9, `a2=${angles[2]}`);
  assert.ok(Math.abs(angles[3] - Math.PI) < 1e-9, `a3=${angles[3]}`);
});

ok('macro materializes projectile children into live handles', () => {
  const mk = () => { const items=[]; return { activeItems:items, spawn(...a){const e={alive:true,x:a[0],y:a[1],w:12,h:12,vx:0,vy:0,orientSprite(){},setLife(){},timers:new Map()};items.push(e);return e;}, updateAll(){} }; };
  const ctx = makeContext(attacker(), { pools: { projectilePool: mk() } });
  const h = invoke('spawnSplit', P, ctx); // default child = projectile
  assert.equal(h.children.length, 3, 'raw vectors exposed');
  assert.equal(h.handles.length, 3, 'each child → a live projectile handle');
});

ok('child=rock: fan materializes arcing rock carriers (arc recipe, no explosion)', () => {
  // Rock is an arc child: gravity recipe, decay bounce, contact damage only.
  // The rock macro's OWN default gravity (800) must apply — the projectile
  // primitive's default arc is null, so an undefined clobber would silently
  // make the rocks fly straight.
  const mk = () => { const items=[]; return { activeItems:items, spawn(...a){const e={alive:true,x:a[0],y:a[1],w:12,h:12,vx:0,vy:0,orientSprite(){},setLife(){},applyRockLook(){},timers:new Map()};items.push(e);return e;}, updateAll(){} }; };
  const ctx = makeContext(attacker(), { pools: { projectilePool: mk() }, world: { targets: [] } });
  const h = invoke('spawnSplit', { ...P, child: 'rock', count: 1 }, ctx);
  assert.equal(h.handles.length, 1, 'one rock handle');
  const rock = h.handles[0];
  assert.equal(rock.id, 'rock');
  assert.ok(rock.entity, 'live carrier entity');
  assert.equal(rock.entity._arcRecipe, true, 'arc carrier (gravity recipe)');
  assert.equal(rock.entity.gravityValue, 800, 'rock macro default gravity in play');
  assert.equal(rock.entity.solidBehavior, 'reflect', 'rock bounces (decay)');
  // Tumble: opt-in flag + slow per-rock spin; the tangent re-aim must NOT
  // have pinned the rotation at the launch angle.
  assert.ok(rock.entity._rockTumble, 'tumble enabled');
  const s1 = rock.entity.rotation;
  assert.ok(s1 >= 0 && s1 < Math.PI * 2, `rotation in [0,2π): ${s1}`);
  assert.ok(Math.abs(rock.entity._rockSpin) <= 6 && Math.abs(rock.entity._rockSpin) >= 2,
    `spin rate in 2..6 rad/s: ${rock.entity._rockSpin.toFixed(2)}`);
});

ok('child=rock: each rock in a fan starts at a different rotation', () => {
  const mk = () => { const items=[]; return { activeItems:items, spawn(...a){const e={alive:true,x:a[0],y:a[1],w:12,h:12,vx:0,vy:0,orientSprite(){},setLife(){},applyRockLook(){},timers:new Map()};items.push(e);return e;}, updateAll(){} }; };
  const ctx = makeContext(attacker(), { pools: { projectilePool: mk() }, world: { targets: [] } });
  const h = invoke('spawnSplit', { ...P, child: 'rock', count: 3 }, ctx);
  const rots = h.handles.map((ch) => ch.entity.rotation);
  const spins = h.handles.map((ch) => ch.entity._rockSpin);
  // All three distinct (random 0..2π — collision probability ~0) and per-rock
  // spin rates differ (random magnitude/sign).
  assert.equal(new Set(rots.map((r) => r.toFixed(6))).size, 3, `distinct starts: ${rots.map((r) => r.toFixed(2)).join(', ')}`);
  assert.equal(new Set(spins.map((s) => s.toFixed(6))).size, 3, `distinct spins: ${spins.map((s) => s.toFixed(2)).join(', ')}`);
});

ok('macro materializes enemy children as thrown carriers (throwEnemy)', () => {
  const mk = () => { const items=[]; return { activeItems:items, spawn(...a){const e={alive:true,x:a[0],y:a[1],w:18,h:18,vx:0,vy:0,orientSprite(){},setLife(){},applyRockLook(){},timers:new Map()};items.push(e);return e;}, updateAll(){} }; };
  const ctx = makeContext(attacker(), { pools: { projectilePool: mk() } });
  const h = invoke('spawnSplit', { ...P, child: 'enemy' }, ctx);
  assert.equal(h.handles.length, 3, 'each child → a live throwEnemy handle');
  assert.ok(h.handles.every((ch) => ch.id === 'throwEnemy'));
});

ok('macro materializes immediate enemy children when enemy.thrown=false', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('spawnSplit', { ...P, child: 'enemy', enemy: { thrown: false } }, ctx);
  assert.equal(h.enemies.length, 3, 'each child → a live enemy entity');
  for (const e of h.enemies) {
    assert.ok(Math.abs(e.vx) > 0 || Math.abs(e.vy) > 0, 'enemy carries fan velocity');
    assert.ok(e.hitstunTimer > 0, 'enemy is hit-stunned during its arc');
  }
});

ok('spawnSplit thrown monkey detonates on victim contact through host stepping', () => {
  const mk = () => { const items=[]; return { activeItems:items, spawn(...a){const e={alive:true,x:a[0],y:a[1],w:18,h:18,vx:0,vy:0,gravityValue:0,orientSprite(){},setLife(){},applyRockLook(){},timers:new Map()};items.push(e);return e;}, updateAll(dt){ for(const e of items){ if(!e.alive) continue; if(e.gravityValue>0) e.vy+=e.gravityValue*dt; e.x+=e.vx*dt; e.y+=e.vy*dt; } } }; };
  const hero = { x: 260, y: 92, w: 24, h: 24, alive: true, hp: 100, team: 'hero', worldBox(){return this;}, loseSelectedSpecial(){}, takeHit(){} };
  const ctx = makeContext(attacker(), { pools: { projectilePool: mk() }, world: { targets: [hero], hero } });
  const h = invoke('spawnSplit', { child: 'enemy', enemyType: 'explosive_monkey', count: 1, centerDirection: 0, angle: 0, force: 80, groundY: 100, target: hero }, ctx);
  for (let i = 0; i < 240 && !h._completed; i++) {
    ctx.pools.projectilePool.updateAll(1/60);
    h.step(1/60, [hero]);
    const e = h.enemies[0];
    if (e?.alive) {
      e.update?.(1/60, hero, {});
      // Snap to floor like the theater host does.
      if (e.vy > 0 && e.y + e.h >= 100) { e.y = 100 - e.h; e.vy = 0; }
      e.hostStep?.(1/60, [hero]);
    }
  }
  assert.ok(h.enemies[0]?._detonated || h.enemies[0]?.aiState === 'dead', 'monkey detonated');
  assert.ok(hero.hp < 100, `hero took damage (${hero.hp})`);
});

ok('child=explosion|shockwave|napalm: fan materializes straight impact carriers', () => {
  // Full-child contract: the 3 straight payload macros fly the fan vector and
  // detonate at their death point — one handle per child, straight carriers.
  const P = { x: 400, y: 300, count: 2, centerDirection: 0, angle: Math.PI / 3, force: 300 };
  for (const child of ['expl_proj', 'shock_proj', 'napalm']) {
    const ctx = makeContext(attacker(), { pools: { projectilePool: new Pool(Projectile, 32) } });
    const h = invoke('spawnSplit', { ...P, child }, ctx);
    assert.equal(h.handles.length, 2, `child=${child}: 2 live handles`);
    for (const ch of h.handles) {
      assert.ok(ch.entity, `child=${child}: carrier entity`);
      assert.equal(ch.entity._arcRecipe, false, `child=${child}: straight carrier`);
    }
  }
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);


ok('propane molotov fan preserves damage defaults and barrels remain killable', () => {
  const pool = new Pool(Projectile, 8);
  const h = invoke('spawnSplit', {
    x: 100, y: 100, count: 5, centerDirection: -Math.PI / 2,
    angle: Math.PI * 0.7, force: 520, child: 'molotov',
    molotov: { arc: 800, bounce: false, ttl: null, fireWidth: 96, team: 'neutral' },
    groundY: 480,
  }, { attacker: attacker(), pools: { projectilePool: pool },
    groundY: 480, world: { targets: [] } });
  assert.equal(pool.activeItems.length, 5);
  for (const e of pool.activeItems) {
    assert.equal(e.damage, 12);
    const barrel = new GameObj(WOOD_BARREL_DEF, 0, 0);
    barrel.hit(e.damage);
    assert.equal(barrel.hp, 28);
    barrel.hit(1000);
    assert.equal(barrel.destroyed, true);
    e._attackHit = true;
    e._impactPoint = { x: 100, y: 100 };
    e.alive = false;
  }
  h.step(1 / 60);
  for (const child of h.handles) {
    const fire = child.handles[0];
    assert.ok(fire, 'contact creates fire');
    assert.equal(fire.zone.damage, 8);
    assert.equal(fire.zone.duration, 3);
    assert.equal(fire.zone.tickRate, 5);
  }
});


ok('invalid damage throws before mutating barrel HP or hero/enemy resources', () => {
  const source = { type: 'molotov' };
  for (const invalid of [undefined, null, NaN, Infinity, -Infinity, -1, '12']) {
    const barrel = new GameObj(WOOD_BARREL_DEF, 0, 0);
    assert.throws(() => barrel.hit(invalid, source, 'fire'),
      { name: 'TypeError', message: /Invalid damage.*method=fire.*source=molotov/ });
    assert.equal(barrel.hp, 40);
    assert.equal(barrel.alive, true);
    for (const target of [
      { type: 'enemy', alive: true, hp: 40 },
      { type: 'hero', alive: true, energy: 40, shield: 10 },
    ]) {
      const before = { ...target };
      assert.throws(() => damage(source, target, invalid, 'fire'), TypeError);
      assert.deepEqual(target, before);
    }
  }
  const barrel = new GameObj(WOOD_BARREL_DEF, 0, 0);
  assert.equal(barrel.hit(0, source), 0);
  assert.equal(barrel.hp, 40);
  assert.equal(barrel.hit(12, source), 12);
  assert.equal(barrel.hp, 28);
});
