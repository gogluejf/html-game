// Task 1.14 — Spike / Static Hazard primitive tests (pure logic, no DOM).
// Run: node js/test/attack/spike.test.js

import { strict as assert } from 'node:assert';
import { spikeBox, stepSpike } from '../../combat/attack/primitives/spike.js';
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
const P = { x: 400, y: 380, width: 32, warningTime: 0.5, visibleTTL: 0.5, hiddenTTL: 0.5, repeatCount: 1, damage: 10, tickRate: 10, team: 'ally' };

function dummyEnemy(x, y, hp = 100) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

ok('box is centered on the given point', () => {
  const box = spikeBox(P);
  assert.deepEqual(box, { x: 384, y: 372, w: 32, h: 16 });
});

ok('phase machine: warning → visible → done (single cycle)', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('spike', P, ctx);
  assert.equal(h.state.phase, 'warning');
  for (let i = 0; i < 31; i++) h.step(DT, []); // just past 0.5s
  assert.equal(h.state.phase, 'visible', `after warning (got ${h.state.phase})`);
  let finished = false;
  for (let i = 0; i < 62 && !finished; i++) finished = h.step(DT, []);
  assert.ok(finished, 'completes after visible + hidden windows');
});

ok('no damage during the warning phase', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(390, 370);
  const h = invoke('spike', P, ctx);
  let n = 0;
  h.on('hit', () => n++);
  for (let i = 0; i < 30; i++) h.step(DT, [enemy]); // still in warning
  assert.equal(n, 0, 'warning does not damage');
  assert.equal(enemy.hp, 100);
});

ok('damage only while visible', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(390, 370);
  const h = invoke('spike', P, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  // Warning (30f) + visible (30f) at 10Hz → ~5 ticks of 10.
  for (let i = 0; i < 60; i++) h.step(DT, [enemy]);
  assert.ok(hits.length >= 4 && hits.length <= 6, `got ${hits.length} ticks`);
  assert.equal(enemy.hp, 100 - hits.length * 10);
});

ok('repeat: second cycle adds another damaging window', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(390, 370, 1000);
  // repeatCount 3 = 3 total cycles → 2+ damaging windows before teardown.
  const h = invoke('spike', { ...P, repeatCount: 3 }, ctx);
  const phases = new Set();
  let finished = false;
  for (let i = 0; i < 400 && !finished; i++) {
    finished = h.step(DT, [enemy]);
    phases.add(h.state.phase);
  }
  assert.ok(finished, 'finishes after 3 cycles');
  assert.ok(phases.has('hidden'), 'entered the hidden phase between cycles');
  // Multiple visible windows at 10Hz × 10 dmg → well past one window's worth.
  assert.ok(enemy.hp < 950, `took damage across cycles (hp=${enemy.hp})`);
});

ok('infinite repeat (-1) runs until ttl cap', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('spike', { ...P, repeatCount: -1, ttl: 3 }, ctx);
  let finished = false;
  for (let i = 0; i < 200 && !finished; i++) finished = h.step(DT, []);
  assert.ok(finished, 'ttl caps infinite repeats');
  assert.ok(h.state.cycle >= 2, `cycled ${h.state.cycle} times`);
});

ok('cancel tears down an infinite spike', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('spike', { ...P, repeatCount: -1 }, ctx);
  let expired = false;
  h.on('expire', () => { expired = true; });
  h.cancel();
  assert.equal(expired, true);
  // Cancel is terminal: the host stops stepping it.
  assert.equal(h._cancelled, true);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
