// Task 1.17 — Spawn / Split primitive tests (pure logic, no DOM).
// Run: node js/test/attack/spawnSplit.test.js

import { strict as assert } from 'node:assert';
import { splitChildren } from '../../combat/attack/macros/spawnSplit.js'; // also registers the macro
import '../../combat/attack/primitives/projectile.js'; // for macro materialization
import '../../combat/attack/primitives/bomb.js';       // throwEnemy carrier (enemy children)
import '../../combat/attack/macros/throwEnemy.js';     // enemy children are thrown
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
  const mk = () => { const items=[]; return { activeItems:items, spawn(...a){const e={alive:true,x:a[0],y:a[1],w:12,h:12,vx:0,vy:0,setLife(){},timers:new Map()};items.push(e);return e;}, updateAll(){} }; };
  const ctx = makeContext(attacker(), { pools: { projectilePool: mk(), specialPool: mk() } });
  const h = invoke('spawnSplit', P, ctx); // default spawnType = projectile
  assert.equal(h.children.length, 3, 'raw vectors exposed');
  assert.equal(h.handles.length, 3, 'each child → a live projectile handle');
});

ok('macro materializes enemy children as thrown carriers (throwEnemy)', () => {
  const mk = () => { const items=[]; return { activeItems:items, spawn(...a){const e={alive:true,x:a[0],y:a[1],w:18,h:18,vx:0,vy:0,setLife(){},timers:new Map()};items.push(e);return e;}, updateAll(){} }; };
  const ctx = makeContext(attacker(), { pools: { projectilePool: mk(), specialPool: mk() } });
  const h = invoke('spawnSplit', { ...P, spawnType: 'enemy' }, ctx);
  assert.equal(h.handles.length, 3, 'each child → a live throwEnemy handle');
  assert.ok(h.handles.every((ch) => ch.id === 'throwEnemy'));
});

ok('macro materializes immediate enemy children when enemy.thrown=false', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('spawnSplit', { ...P, spawnType: 'enemy', enemy: { thrown: false } }, ctx);
  assert.equal(h.enemies.length, 3, 'each child → a live enemy entity');
  for (const e of h.enemies) {
    assert.ok(Math.abs(e.vx) > 0 || Math.abs(e.vy) > 0, 'enemy carries fan velocity');
    assert.ok(e.hitstunTimer > 0, 'enemy is hit-stunned during its arc');
  }
});

ok('spawnSplit thrown monkey detonates on victim contact through host stepping', () => {
  const mk = () => { const items=[]; return { activeItems:items, spawn(...a){const e={alive:true,x:a[0],y:a[1],w:18,h:18,vx:0,vy:0,gravityValue:0,setLife(){},timers:new Map()};items.push(e);return e;}, updateAll(dt){ for(const e of items){ if(!e.alive) continue; if(e.gravityValue>0) e.vy+=e.gravityValue*dt; e.x+=e.vx*dt; e.y+=e.vy*dt; } } }; };
  const hero = { x: 260, y: 92, w: 24, h: 24, alive: true, hp: 100, team: 'hero', worldBox(){return this;}, loseSelectedSpecial(){}, takeHit(){} };
  const ctx = makeContext(attacker(), { pools: { projectilePool: mk(), specialPool: mk() }, world: { targets: [hero], hero } });
  const h = invoke('spawnSplit', { spawnType: 'enemy', enemyType: 'explosive_monkey', count: 1, centerDirection: 0, angle: 0, force: 80, groundY: 100, target: hero }, ctx);
  for (let i = 0; i < 240 && !h._completed; i++) {
    ctx.pools.specialPool.updateAll(1/60);
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

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
