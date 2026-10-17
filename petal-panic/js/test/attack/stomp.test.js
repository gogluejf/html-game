// Stomp macro tests (pure logic, no DOM).
// Run: node js/test/attack/stomp.test.js

import { strict as assert } from 'node:assert';
import '../../combat/attack/primitives/explosion.js'; // register the payload primitive
import { stompImpactPoint, resolveStompBlast } from '../../combat/attack/macros/stomp.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { LAYER } from '../../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const GROUND_Y = 400;
const attacker = () => ({ x: 300, y: GROUND_Y - 48, w: 32, h: 48 });

function ctx(extra = {}) {
  return makeContext(attacker(), {
    world: { targets: [], hero: null },
    effects: { spawnHitSparkles() {}, fireManual() {}, triggerShake() {}, spawnExplosion() {}, bigExplosion() {} },
    groundY: GROUND_Y,
    ...extra,
  });
}

function dummyEnemy(x, y, hp = 100) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

ok('impact point is the attacker feet center', () => {
  const pt = stompImpactPoint({ x: 300, y: 352, w: 32, h: 48 });
  assert.deepEqual(pt, { x: 316, y: GROUND_Y });
});

ok('sequence: telegraph → hop → impact → complete (count 1)', () => {
  const h = invoke('stomp', { buildTime: 0.2, gapTime: 0.1, blinkTime: 0.1, count: 1 }, ctx());
  const phases = new Set();
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    finished = h.step(DT, []);
    phases.add(h.state.phase);
  }
  assert.ok(finished, 'completes');
  assert.ok(phases.has('telegraph'), 'had a telegraph phase');
  assert.ok(phases.has('hop'), 'had a hop phase');
  assert.ok(phases.has('impact'), 'had an impact phase');
});

ok('radius blast hits an enemy on the ground inside the radius', () => {
  const e = dummyEnemy(316 + 40, GROUND_Y - 24); // 40px right of impact, r=90
  const c = ctx();
  c.world.targets = [e]; // the blast resolves against world targets
  const h = invoke('stomp', { buildTime: 0.05, gapTime: 0.05, blinkTime: 0.05, count: 1, radius: 90, damage: 30 }, c);
  const hits = [];
  h.on('hit', (i) => hits.push(i));
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, [e]);
  assert.ok(finished);
  assert.ok(hits.length >= 1, `blast hit (${hits.length})`);
  assert.ok(e.hp < 100, `enemy damaged (hp=${e.hp})`);
});

ok('an enemy ABOVE the radius is untouched', () => {
  const e = dummyEnemy(316 + 40, 200); // high up, far above the blast circle
  const c = ctx();
  c.world.targets = [e];
  const h = invoke('stomp', { buildTime: 0.05, gapTime: 0.05, blinkTime: 0.05, count: 1, radius: 90, damage: 30 }, c);
  const hits = [];
  h.on('hit', (i) => hits.push(i));
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, [e]);
  assert.ok(finished);
  assert.equal(hits.length, 0, 'above-radius enemy not hit');
  assert.equal(e.hp, 100);
});

ok('count 3 stomps three times with intervals between', () => {
  const h = invoke('stomp', { buildTime: 0.05, gapTime: 0.05, blinkTime: 0.05, count: 3, interval: 0.2, radius: 60, damage: 10 }, ctx());
  let impacts = 0, finished = false;
  let prevPhase = null;
  for (let i = 0; i < 1200 && !finished; i++) {
    finished = h.step(DT, []);
    if (h.state.phase === 'impact' && prevPhase !== 'impact') impacts++;
    prevPhase = h.state.phase;
  }
  assert.ok(finished);
  assert.equal(impacts, 3, `three impacts (got ${impacts})`);
  assert.equal(h.state.stompIndex, 3);
});

ok('the full telegraph plays only ONCE (not per stomp)', () => {
  const h = invoke('stomp', { buildTime: 0.1, gapTime: 0.05, blinkTime: 0.05, count: 3, interval: 0.1 }, ctx());
  let telegraphs = 0, finished = false;
  let prevPhase = null;
  for (let i = 0; i < 1200 && !finished; i++) {
    finished = h.step(DT, []);
    if (h.state.phase === 'telegraph' && prevPhase !== 'telegraph') telegraphs++;
    prevPhase = h.state.phase;
  }
  assert.ok(finished);
  assert.equal(telegraphs, 1, `one telegraph (got ${telegraphs})`);
});

ok('zero telegraph starts straight in the hop', () => {
  const h = invoke('stomp', { buildTime: 0, gapTime: 0, blinkTime: 0, count: 1 }, ctx());
  assert.equal(h.state.phase, 'hop');
});

console.log(`\nstomp: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
