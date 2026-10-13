// Task 1.9 — Beam primitive tests (pure logic, no DOM).
// Run: node js/test/attack/beam.test.js

import { strict as assert } from 'node:assert';
import { beamBox, stepBeam } from '../../combat/attack/primitives/beam.js';
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
const P = { direction: 0, length: 200, width: 24, duration: 0.5, damage: 10, tickRate: 10, team: 'ally' };

function dummyEnemy(x, y, hp = 100) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

ok('box: horizontal beam extends right from attacker center', () => {
  const ctx = makeContext(attacker(), {});
  const box = beamBox(P, ctx);
  // Center (116,116), length 200 → spans x 104..316 (+width), y 104..128.
  assert.ok(Math.abs(box.x - 104) < 1e-9, `x=${box.x}`);
  assert.ok(Math.abs(box.w - 224) < 1e-9, `w=${box.w}`);
  assert.ok(Math.abs(box.y - 104) < 1e-9, `y=${box.y}`);
  assert.ok(Math.abs(box.h - 24) < 1e-9, `h=${box.h}`);
});

ok('box: explicit origin overrides attacker center', () => {
  const ctx = makeContext(attacker(), {});
  const box = beamBox({ ...P, origin: { x: 500, y: 300 } }, ctx);
  assert.ok(Math.abs(box.x - 488) < 1e-9, `x=${box.x}`);
  assert.ok(Math.abs(box.y - 288) < 1e-9, `y=${box.y}`);
});

ok('marker origin resolves via sprite-crop schema', () => {
  const a = attacker();
  a.markers = [{ label: 'chest', x: 16, y: 16 }];
  const ctx = makeContext(a, {});
  const box = beamBox({ ...P, origin: 'chest' }, ctx);
  // marker world (116,116) → same as center here; shift marker to verify use.
  a.markers[0].x = 40;
  const box2 = beamBox({ ...P, origin: 'chest' }, ctx);
  assert.ok(Math.abs(box2.x - (140 - 12)) < 1e-9, `x=${box2.x}`);
});

ok('damage ticks at tickRate while overlapping', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(200, 105); // inside the beam
  const h = invoke('beam', P, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  // 20 frames (0.333s) at 10Hz → exactly 3 ticks of 10 dmg.
  for (let i = 0; i < 20; i++) h.step(DT, [enemy]);
  assert.equal(hits.length, 3, `got ${hits.length} ticks`);
  assert.deepEqual(hits, [10, 10, 10]);
  assert.equal(enemy.hp, 70);
});

ok('tick accumulator: no drift over a full run', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(200, 105);
  const h = invoke('beam', P, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  // Full 0.5s lifetime at 10Hz → exactly 5 ticks (no float drift).
  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(finished);
  assert.equal(hits.length, 5, `got ${hits.length} ticks over full life`);
  assert.equal(enemy.hp, 50);
});

ok('no damage when target is outside the beam', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(200, 300); // far below
  const h = invoke('beam', P, ctx);
  let hitCount = 0;
  h.on('hit', () => hitCount++);
  for (let i = 0; i < 30; i++) h.step(DT, [enemy]);
  assert.equal(hitCount, 0);
  assert.equal(enemy.hp, 100);
});

ok('completes after duration', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('beam', P, ctx);
  let done = null;
  h.on('complete', (i) => { done = i; });
  for (let i = 0; i < 30; i++) assert.equal(h.step(DT, []), false, `frame ${i} still active`);
  assert.equal(h.step(DT, []), true, 'finishes at frame 31 (~0.517s)');
  assert.ok(done.ticks >= 4 && done.ticks <= 6, `ticks=${done.ticks}`);
});

ok('step is idempotent after completion', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('beam', P, ctx);
  h.step(1, []); // over-duration
  assert.equal(h.step(DT, []), true);
});

ok('team routing: foe beam skips enemies', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(200, 105);
  const h = invoke('beam', { ...P, team: 'foe' }, ctx);
  let hitCount = 0;
  h.on('hit', () => hitCount++);
  for (let i = 0; i < 12; i++) h.step(DT, [enemy]);
  assert.equal(hitCount, 0, 'foe beams only hit HERO layer');
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
