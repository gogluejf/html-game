// Sky Dive Stomp macro tests (pure logic, no DOM).
// Run: node --test petal-panic/js/test/attack/skyDiveStomp.test.js

import { strict as assert } from 'node:assert';
import '../../combat/attack/primitives/surfaceWave.js'; // register stomp's wave payload
import '../../combat/attack/macros/stomp.js';           // register the payload macro
import '../../combat/attack/macros/skyDiveStomp.js';    // register the macro under test
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

// --- Column resolution (shared with skyMissile) ------------------------------

ok('impact defaults to the floor when nothing is in the column', () => {
  const c = ctx();
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.1 }, c);
  assert.deepEqual(h.state.impact, { x: 500, y: GROUND_Y });
});

ok('impact lands on a platform top inside the column (highest surface wins)', () => {
  const platTop = GROUND_Y - 70;
  const c = ctx({ platforms: [{ x: 450, y: platTop, w: 100 }] });
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.1 }, c);
  assert.deepEqual(h.state.impact, { x: 500, y: platTop });
});

ok('explicit groundY param overrides the column lookup', () => {
  const c = ctx({ platforms: [{ x: 450, y: GROUND_Y - 70, w: 100 }] });
  const h = invoke('skyDiveStomp', { x: 500, groundY: 123, timeToTarget: 0.1 }, c);
  assert.equal(h.state.impact.y, 123);
});

// --- Sequence ----------------------------------------------------------------

ok('sequence: warning → drop → waves → complete', () => {
  const c = ctx();
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.2, dropHeight: 120, fallSpeed: 600, stomp: { ttl: 0.5 } }, c);
  const phases = new Set();
  let finished = false;
  for (let i = 0; i < 900 && !finished; i++) {
    finished = h.step(DT, []);
    phases.add(h.state.phase);
  }
  assert.ok(finished, 'completes');
  assert.ok(phases.has('warning'), 'had a warning phase');
  assert.ok(phases.has('drop'), 'had a drop phase');
  assert.ok(phases.has('slam'), 'had a slam phase');
});

ok('zero timeToTarget skips the warning window', () => {
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0, dropHeight: 120, fallSpeed: 600, stomp: { ttl: 0.3 } }, ctx());
  h.step(DT, []);
  assert.equal(h.state.phase, 'drop', `phase after first step (${h.state.phase})`);
});

ok('the diver falls strictly vertically and lands ON the impact line', () => {
  const platTop = GROUND_Y - 70;
  const c = ctx({ platforms: [{ x: 450, y: platTop, w: 100 }] });
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.1, dropHeight: 200, fallSpeed: 400, stomp: { ttl: 0.4 } }, c);
  // Step through the drop; record the diver bottom at the frame it lands.
  let landBottom = null;
  let finished = false;
  for (let i = 0; i < 900 && !finished; i++) {
    finished = h.step(DT, []);
    if (h.state.phase === 'slam' && landBottom == null) landBottom = h.state.diverY + 14; // size default 14
  }
  assert.ok(finished, 'completes');
  assert.ok(landBottom != null, 'diver landed');
  // It must land AT the platform top (within one frame of travel), not fall
  // through to the floor or fizzle below the platform.
  assert.ok(Math.abs(landBottom - platTop) <= 400 * DT + 1,
    `landing at platform top (${landBottom} vs ${platTop})`);
  assert.ok(landBottom < GROUND_Y - 20, 'did NOT fall through to the floor');
});

// --- Impact: stomp wave per side ---------------------------------------------

ok('both sides: each wave catches its own side victim', () => {
  const rightE = dummyEnemy(500 + 90, GROUND_Y - 24);
  const leftE = dummyEnemy(500 - 90 - 24, GROUND_Y - 24);
  const c = ctx();
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.1, dropHeight: 120, fallSpeed: 600, stomp: { sides: 'both', waveSpeed: 300, damage: 20, ttl: 2 } }, c);
  const hits = [];
  h.on('hit', (i) => hits.push(i.target));
  let finished = false;
  for (let i = 0; i < 900 && !finished; i++) finished = h.step(DT, [rightE, leftE]);
  assert.ok(finished, 'completes');
  assert.ok(hits.includes(rightE), 'right wave caught right enemy');
  assert.ok(hits.includes(leftE), 'left wave caught left enemy');
});

ok('sides: right → only a right-going wave exists (left-side enemy untouched)', () => {
  // The left enemy sits BEHIND the impact point. A right-only wave travels
  // away from it, so it must stay safe. (An enemy IN the right wave's path
  // WOULD be hit — that's correct wave behavior.)
  const rightE = dummyEnemy(500 + 90, GROUND_Y - 24);
  const leftE = dummyEnemy(500 - 90 - 24, GROUND_Y - 24);
  const c = ctx();
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.1, dropHeight: 120, fallSpeed: 600, stomp: { sides: 'right', waveSpeed: 300, damage: 20, ttl: 0.3 } }, c);
  let finished = false;
  for (let i = 0; i < 900 && !finished; i++) finished = h.step(DT, [rightE, leftE]);
  assert.ok(finished, 'completes');
  assert.ok(rightE.hp < 100, 'right enemy hit by the right wave');
  assert.equal(leftE.hp, 100, 'left enemy untouched (no left wave)');
});

ok('a target far beyond the wave ttl is untouched', () => {
  // ttl 0.2 at 300px/s → the wave dies ~60px from the impact. An enemy at
  // x=900 (400px away) is never reached.
  const e = dummyEnemy(900, GROUND_Y - 24);
  const c = ctx();
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.1, dropHeight: 120, fallSpeed: 600, stomp: { sides: 'both', waveSpeed: 300, damage: 20, ttl: 0.2 } }, c);
  let finished = false;
  for (let i = 0; i < 900 && !finished; i++) finished = h.step(DT, [e]);
  assert.ok(finished, 'completes');
  assert.equal(e.hp, 100, 'far target untouched (wave died on ttl before reaching it)');
});

// --- Impact mode: 'strike' ----------------------------------------------------

ok('impact: strike → burns every surface under the span on landing', () => {
  const platTop = GROUND_Y - 70;
  const onPlat = dummyEnemy(500 - 40, platTop - 24);  // on a platform in the column
  const onFloor = dummyEnemy(500 + 40, GROUND_Y - 24); // on the floor
  const c = ctx({ platforms: [{ x: 440, y: platTop, w: 120 }] });
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.1, dropHeight: 120, fallSpeed: 600, impact: 'strike', stomp: { damage: 20 } }, c);
  let finished = false;
  for (let i = 0; i < 900 && !finished; i++) finished = h.step(DT, [onPlat, onFloor]);
  assert.ok(finished, 'completes');
  assert.ok(onPlat.hp < 100, `platform victim hit (hp=${onPlat.hp})`);
  assert.ok(onFloor.hp < 100, `floor victim hit (hp=${onFloor.hp})`);
});

// --- Vanish (blink-out) ------------------------------------------------------

ok('vanish: sequence gains linger + vanish phases and fires a vanish event', () => {
  const c = ctx();
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.1, dropHeight: 120, fallSpeed: 600, stomp: { ttl: 0.3 }, lingerOnGround: 0.2, vanishTime: 0.2 }, c);
  const phases = new Set();
  let vanished = null;
  h.on('vanish', (info) => { vanished = info; });
  let finished = false;
  for (let i = 0; i < 900 && !finished; i++) {
    finished = h.step(DT, []);
    phases.add(h.state.phase);
  }
  assert.ok(finished, 'completes');
  assert.ok(phases.has('linger'), 'had a linger phase');
  assert.ok(phases.has('vanish'), 'had a vanish phase');
  assert.ok(vanished, 'fired a vanish event');
  assert.deepEqual({ x: vanished.x, y: vanished.y }, { x: 500, y: GROUND_Y }, 'vanish at the impact point');
});

ok('vanish: zero linger goes straight to the blink (no linger phase)', () => {
  const c = ctx();
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.1, dropHeight: 120, fallSpeed: 600, stomp: { ttl: 0.3 }, lingerOnGround: 0, vanishTime: 0.2 }, c);
  const phases = new Set();
  let finished = false;
  for (let i = 0; i < 900 && !finished; i++) {
    finished = h.step(DT, []);
    phases.add(h.state.phase);
  }
  assert.ok(finished, 'completes');
  assert.ok(!phases.has('linger'), 'no linger phase when lingerOnGround=0');
  assert.ok(phases.has('vanish'), 'still vanishes');
});

ok('vanish: false → enemy stays put (no linger/vanish phases, no event)', () => {
  const c = ctx();
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.1, dropHeight: 120, fallSpeed: 600, stomp: { ttl: 0.3 }, vanish: false }, c);
  const phases = new Set();
  let vanished = false;
  h.on('vanish', () => { vanished = true; });
  let finished = false;
  for (let i = 0; i < 900 && !finished; i++) {
    finished = h.step(DT, []);
    phases.add(h.state.phase);
  }
  assert.ok(finished, 'completes');
  assert.ok(!phases.has('linger'), 'no linger phase');
  assert.ok(!phases.has('vanish'), 'no vanish phase');
  assert.ok(!vanished, 'no vanish event fired');
});

ok('land: fires once at impact with the impact point (before the waves)', () => {
  const c = ctx();
  const h = invoke('skyDiveStomp', { x: 500, timeToTarget: 0.1, dropHeight: 120, fallSpeed: 600, stomp: { ttl: 0.3 } }, c);
  const lands = [];
  h.on('land', (info) => lands.push({ ...info, phase: h.state.phase }));
  let finished = false;
  for (let i = 0; i < 900 && !finished; i++) finished = h.step(DT, []);
  assert.ok(finished, 'completes');
  assert.equal(lands.length, 1, 'landed exactly once');
  assert.deepEqual({ x: lands[0].x, y: lands[0].y }, { x: 500, y: GROUND_Y }, 'land at the impact point');
  assert.equal(lands[0].phase, 'slam', 'land fires as the slam phase begins');
});

console.log(`\nskyDiveStomp: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
