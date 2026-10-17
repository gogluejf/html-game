// Surface Wave primitive tests (pure logic, no DOM).
// Run: node js/test/attack/surfaceWave.test.js

import { strict as assert } from 'node:assert';
import { waveSign, resolveSurface, stepSurfaceWave } from '../../combat/attack/primitives/surfaceWave.js';
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

ok('waveSign normalizes left/right and numeric signs', () => {
  assert.equal(waveSign('left'), -1);
  assert.equal(waveSign('right'), 1);
  assert.equal(waveSign(-1), -1);
  assert.equal(waveSign(2), 1);
});

ok('resolveSurface picks the floor for a ground origin', () => {
  const s = resolveSurface({ x: 300, y: GROUND_Y, direction: 'right' }, ctx());
  assert.equal(s.y, GROUND_Y);
  assert.ok(s.max > 300);
});

ok('resolveSurface picks the platform under the origin, not the floor', () => {
  const c = ctx({ platforms: [{ x: 250, y: 330, w: 120 }] });
  const s = resolveSurface({ x: 300, y: 330, direction: 'right' }, c);
  assert.equal(s.y, 330);
  assert.equal(s.max, 370); // right-going: clamped to platform edge
});

ok('resolveSurface clamps travel range to the going side', () => {
  const c = ctx({ platforms: [{ x: 250, y: 330, w: 120 }] });
  const right = resolveSurface({ x: 300, y: 330, direction: 'right' }, c);
  assert.equal(right.min, 300);   // starts at origin
  assert.equal(right.max, 370);   // ends at platform edge
  const left = resolveSurface({ x: 300, y: 330, direction: 'left' }, c);
  assert.equal(left.min, 250);    // ends at platform edge
  assert.equal(left.max, 300);    // starts at origin
});

ok('no surface under the origin → expire + no-surface complete', () => {
  // Floating origin with NO floor line in ctx (pure-logic test world).
  const c = makeContext(attacker(), {
    world: { targets: [], hero: null },
    effects: { spawnHitSparkles() {}, fireManual() {}, triggerShake() {} },
  });
  const h = invoke('surfaceWave', { x: 300, y: 100, direction: 'right' }, c);
  assert.equal(h.state.done, true);
});

ok('wave travels right and hits an enemy in its path once', () => {
  const e = dummyEnemy(400, GROUND_Y - 24);
  const h = invoke('surfaceWave', { x: 300, y: GROUND_Y, direction: 'right', speed: 300, damage: 15, ttl: 2 }, ctx());
  const hits = [];
  h.on('hit', (i) => hits.push(i));
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, [e]);
  assert.ok(finished, 'wave completes');
  assert.equal(hits.length, 1, `one hit per target (got ${hits.length})`);
  assert.equal(e.hp, 85);
});

ok('wave does NOT hit an enemy behind its origin', () => {
  const e = dummyEnemy(200, GROUND_Y - 24);
  const h = invoke('surfaceWave', { x: 300, y: GROUND_Y, direction: 'right', speed: 300, damage: 15 }, ctx());
  const hits = [];
  h.on('hit', (i) => hits.push(i));
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, [e]);
  assert.equal(hits.length, 0, 'behind-origin enemy untouched');
  assert.equal(e.hp, 100);
});

ok('ttl kills the wave mid-travel', () => {
  const h = invoke('surfaceWave', { x: 300, y: GROUND_Y, direction: 'right', speed: 300, ttl: 0.2 }, ctx());
  let finished = false, frames = 0;
  for (let i = 0; i < 600 && !finished; i++) { finished = h.step(DT, []); frames++; }
  assert.ok(finished);
  assert.ok(frames < 120, `died before full travel (${frames} frames)`);
});

ok('wave dies at the end of a platform (surface-end)', () => {
  const c = ctx({ platforms: [{ x: 250, y: 330, w: 100 }] });
  const h = invoke('surfaceWave', { x: 300, y: 330, direction: 'right', speed: 300 }, c);
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, []);
  assert.ok(finished);
  assert.equal(h.state.surfaceY, 330);
  // Front stopped AT the platform edge (350), not beyond it.
  assert.ok(h.state.x <= 350 + 1, `front at edge (x=${h.state.x})`);
});

ok('solid geometry blocks the wave', () => {
  const c = ctx({ solids: [{ x: 420, y: GROUND_Y - 60, w: 20, h: 60 }] });
  const h = invoke('surfaceWave', { x: 300, y: GROUND_Y, direction: 'right', speed: 300 }, c);
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, []);
  assert.ok(finished);
  // Front never advanced INTO the block.
  assert.ok(h.state.x <= 420 + 0.01, `stopped at the block (x=${h.state.x})`);
});

ok('floor waves are unlimited (no ttl) and run off-screen-safe via ttl cap only', () => {
  // Floor has infinite extent — without ttl the wave would never end.
  // This documents why callers pass ttl for ground waves.
  const h = invoke('surfaceWave', { x: 300, y: GROUND_Y, direction: 'right', speed: 300, ttl: 0.5 }, ctx());
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, []);
  assert.ok(finished);
});

console.log(`\nsurfaceWave: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
