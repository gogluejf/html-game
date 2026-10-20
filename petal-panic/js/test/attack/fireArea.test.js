// Task 1.13 — Fire / Persistent Area primitive tests (pure logic, no DOM).
// Run: node js/test/attack/fireArea.test.js

import { strict as assert } from 'node:assert';
import { fireAreaBox } from '../../combat/attack/primitives/fireArea.js';
import '../../combat/attack/macros/molotov.js';
import { Pool, Special } from '../../objects/projectile.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { LAYER } from '../../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });
const P = { x: 400, y: 380, width: 96, duration: 1, tickRate: 5, damage: 6, team: 'ally' };

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
  const ctx = makeContext(attacker(), {});
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
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(600, 100);
  const h = invoke('fireArea', P, ctx);
  let n = 0;
  h.on('hit', () => n++);
  for (let i = 0; i < 60; i++) h.step(DT, [enemy]);
  assert.equal(n, 0);
  assert.equal(enemy.hp, 100);
});

ok('a target that walks in only burns while inside', () => {
  const ctx = makeContext(attacker(), {});
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
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(390, 370);
  const h = invoke('fireArea', P, ctx);
  let done = null;
  h.on('complete', (i) => { done = i; });
  for (let i = 0; i < 60; i++) h.step(DT, [enemy]);
  assert.equal(h.step(DT, [enemy]), true, 'idempotent after done');
  assert.ok(done.ticks >= 4 && done.ticks <= 6, `ticks=${done.ticks}`);
});

ok('team routing: foe area skips enemies', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(390, 370);
  const h = invoke('fireArea', { ...P, team: 'foe' }, ctx);
  let n = 0;
  h.on('hit', () => n++);
  for (let i = 0; i < 30; i++) h.step(DT, [enemy]);
  assert.equal(n, 0);
});

for (const scenario of [
  { name: 'floor impact', y: 391, surface: 400, impact: true },
  { name: 'airborne fuse drops to floor', y: 200, surface: 400 },
  { name: 'platform impact', y: 291, surface: 300, impact: true, platforms: [{ x: 350, y: 300, w: 100 }] },
  { name: 'platform above bottle drops to floor', y: 350, surface: 400, platforms: [{ x: 350, y: 300, w: 100 }] },
  { name: 'platform outside column drops to floor', y: 200, surface: 400, platforms: [{ x: 500, y: 300, w: 100 }] },
]) {
  ok(`Molotov ${scenario.name}: rendered fire and damage share the impact box`, () => {
    const ctx = {
      attacker: attacker(), groundY: 400, platforms: scenario.platforms ?? [],
      pools: { specialPool: new Pool(Special, 4) }, world: { targets: [] },
    };
    const h = invoke('molotov', {
      origin: { x: 400, y: scenario.y }, speed: 0, arc: 0, ttl: DT,
    }, ctx);
    if (scenario.impact) h.entity.vy = 10;
    else ctx.pools.specialPool.updateAll(DT);
    h.step(DT);
    assert.equal(h.handles.length, 1);
    const fire = h.handles[0];
    assert.equal(fire.zone.y + fire.zone.h, scenario.surface);
    const rects = [];
    fire.zone.draw({ save() {}, restore() {}, strokeRect() {}, fillRect(...args) { rects.push(args); } });
    assert.deepEqual(rects, [[352, scenario.surface - 48, 96, 48]]);
    const enemy = dummyEnemy(390, scenario.surface - 24);
    fire.step(0.2, [enemy]);
    assert.equal(enemy.hp, 92);
    assert.deepEqual(fire.zone._hb.box, { x: 352, y: scenario.surface - 48, w: 96, h: 48 });
  });
}

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
