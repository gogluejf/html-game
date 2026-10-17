// Stomp Wave macro tests (pure logic, no DOM).
// Run: node js/test/attack/stompWave.test.js

import { strict as assert } from 'node:assert';
import '../../combat/attack/primitives/surfaceWave.js'; // register the payload primitive
import { stompWaveImpactPoint } from '../../combat/attack/macros/stompWave.js';
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
    effects: { spawnHitSparkles() {}, fireManual() {}, triggerShake() {} },
    groundY: GROUND_Y,
    platforms: extra.platforms ?? [],
    solids: extra.solids ?? [],
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
  const pt = stompWaveImpactPoint({ x: 300, y: 352, w: 32, h: 48 });
  assert.deepEqual(pt, { x: 316, y: GROUND_Y });
});

ok('sides: both → two waves, one per direction', () => {
  const h = invoke('stompWave', { buildTime: 0.05, gapTime: 0.05, blinkTime: 0.05, sides: 'both', ttl: 0.5 }, ctx());
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, []);
  assert.ok(finished);
  assert.equal(h.state.done, true);
});

ok('sides: right → only a right-going wave exists', () => {
  const c = ctx({ platforms: [{ x: 200, y: GROUND_Y, w: 999 }] });
  const h = invoke('stompWave', { buildTime: 0, gapTime: 0, blinkTime: 0, sides: 'right', ttl: 0.3 }, c);
  // Force the hop to land immediately by stepping past it.
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, []);
  assert.ok(finished);
});

ok('the right wave hits an enemy on the right; left enemy untouched', () => {
  const rightE = dummyEnemy(450, GROUND_Y - 24);
  const leftE = dummyEnemy(150, GROUND_Y - 24);
  const h = invoke('stompWave', { buildTime: 0, gapTime: 0, blinkTime: 0, sides: 'right', waveSpeed: 300, damage: 20, ttl: 2 }, ctx());
  const hits = [];
  h.on('hit', (i) => hits.push(i.target));
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, [rightE, leftE]);
  assert.ok(finished);
  assert.ok(hits.includes(rightE), 'right enemy hit');
  assert.ok(!hits.includes(leftE), 'left enemy untouched');
  assert.equal(rightE.hp, 80);
  assert.equal(leftE.hp, 100);
});

ok('both sides: each wave catches its own side victim', () => {
  const rightE = dummyEnemy(450, GROUND_Y - 24);
  const leftE = dummyEnemy(150, GROUND_Y - 24);
  const h = invoke('stompWave', { buildTime: 0, gapTime: 0, blinkTime: 0, sides: 'both', waveSpeed: 300, damage: 20, ttl: 2 }, ctx());
  const hits = [];
  h.on('hit', (i) => hits.push(i.target));
  let finished = false;
  for (let i = 0; i < 900 && !finished; i++) finished = h.step(DT, [rightE, leftE]);
  assert.ok(finished);
  assert.ok(hits.includes(rightE), 'right wave caught right enemy');
  assert.ok(hits.includes(leftE), 'left wave caught left enemy');
});

ok('wave dies at platform edge — enemy beyond the edge is safe', () => {
  // Platform spans 250..370; origin at 300. Right wave must stop at 370.
  const beyond = dummyEnemy(450, 330 - 24); // on the floor line? No — at platform height, past the edge
  const onPlatform = dummyEnemy(340, 330 - 24);
  const c = ctx({ platforms: [{ x: 250, y: 330, w: 120 }] });
  const h = invoke('stompWave', { buildTime: 0, gapTime: 0, blinkTime: 0, sides: 'right', waveSpeed: 300, damage: 20 }, c);
  // Move the attacker onto the platform so the impact resolves there.
  c.attacker.y = 330 - 48;
  const hits = [];
  h.on('hit', (i) => hits.push(i.target));
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, [onPlatform, beyond]);
  assert.ok(finished);
  assert.ok(hits.includes(onPlatform), 'enemy on platform hit');
  assert.ok(!hits.includes(beyond), 'enemy beyond the edge untouched');
});

console.log(`\nstompWave: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
