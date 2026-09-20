// Task 1.3 — node-based unit tests for the generic effect carrier interface (js/effects/carrier.js).
// Run: node js/test/effectCarrier.test.js
// No DOM needed: carrier is a pure module. Fixed dt = 1/60 per project convention.

import { strict as assert } from 'node:assert';
import { attachEffects, makeCarrier } from '../effects/carrier.js';
import { TRIGGERS, registerEffect, fire, updateContinuous, updateEffects, activeCount, resetEffects } from '../effects/index.js';

const DT = 1 / 60;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('attachEffects normalization');
ok('stores normalized config with default params', () => {
  const carrier = {};
  const result = attachEffects(carrier, [
    { on: 'collision', type: 'particle-burst' },
    { on: 'attackActive', type: 'beam', params: { length: 120 } },
  ]);
  assert.equal(result.attached, 2);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(carrier.effects, [
    { on: 'collision', type: 'particle-burst', params: {} },
    { on: 'attackActive', type: 'beam', params: { length: 120 } },
  ]);
});
ok('rejects unknown triggers and reports them without throwing', () => {
  const carrier = {};
  const result = attachEffects(carrier, [
    { on: 'collision', type: 'a', params: {} },
    { on: 'bogusTrigger', type: 'b', params: {} },
    { on: undefined, type: 'c', params: {} },
    null,
  ]);
  assert.equal(result.attached, 1);
  assert.deepEqual(result.rejected.map(r => r.on), ['bogusTrigger', undefined, undefined]);
  assert.deepEqual(result.rejected.map(r => r.index), [1, 2, 3]);
  assert.deepEqual(carrier.effects, [{ on: 'collision', type: 'a', params: {} }]);
});
ok('accepts a continuous-only declaration (no discrete trigger)', () => {
  const carrier = {};
  const result = attachEffects(carrier, [
    { type: 'trail', continuous: { condition: 'moving' } },
  ]);
  assert.equal(result.attached, 1);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(carrier.effects, [
    { type: 'trail', params: {}, continuous: { condition: 'moving' } },
  ]);
});
ok('rejects entries with neither a valid trigger nor a continuous declaration', () => {
  const carrier = {};
  const result = attachEffects(carrier, [
    { type: 'x' },
    { on: 'bogus', type: 'y' },
  ]);
  assert.equal(result.attached, 0);
  assert.deepEqual(result.rejected.map(r => r.index), [0, 1]);
  assert.deepEqual(carrier.effects, []);
});
ok('preserves continuous declarations verbatim by condition', () => {
  const carrier = {};
  attachEffects(carrier, [
    { on: 'spawn', type: 'trail', continuous: { condition: 'moving' } },
  ]);
  assert.deepEqual(carrier.effects[0].continuous, { condition: 'moving' });
});
ok('stored configs are copies — mutating the input list later has no effect', () => {
  const raw = [{ on: 'death', type: 'x' }];
  const carrier = {};
  attachEffects(carrier, raw);
  raw[0].on = 'bogus';
  raw[0].params = { n: 999 };
  assert.equal(carrier.effects[0].on, 'death');
  assert.equal(carrier.effects[0].type, 'x');
});
ok('accepts every trigger in the fixed vocabulary', () => {
  const carrier = {};
  const list = TRIGGERS.map(on => ({ on, type: 't', params: {} }));
  const result = attachEffects(carrier, list);
  assert.equal(result.attached, TRIGGERS.length);
  assert.deepEqual(result.rejected, []);
});
ok('throws on a non-object carrier', () => {
  assert.throws(() => attachEffects(null, []));
  assert.throws(() => attachEffects('nope', []));
});

console.log('makeCarrier geometry');
ok('builds a working carrier from plain geometry', () => {
  const c = makeCarrier({ x: 10, y: 20, w: 40, h: 8, dir: { x: 0, y: -1 } });
  assert.deepEqual(c.origin(), { x: 10, y: 20 });
  assert.deepEqual(c.facing(), { x: 0, y: -1 });
  assert.deepEqual(c.size(), { w: 40, h: 8 });
  assert.ok(Array.isArray(c.effects));
});
ok('defaults anchor to box center and facing to +x when omitted', () => {
  const c = makeCarrier({ w: 40, h: 8 });
  assert.deepEqual(c.origin(), { x: 20, y: 4 });
  assert.deepEqual(c.facing(), { x: 1, y: 0 });
});
ok('normalizes non-unit facing vectors', () => {
  const c1 = makeCarrier({ dir: { x: 3, y: 4 } });
  assert.ok(Math.abs(c1.facing().x - 0.6) < 1e-9);
  assert.ok(Math.abs(c1.facing().y - 0.8) < 1e-9);
});
ok('surfaces a zero-length dir vector via console.warn instead of silently defaulting', () => {
  const warned = [];
  const origWarn = console.warn;
  console.warn = (msg) => warned.push(String(msg));
  try {
    const c = makeCarrier({ dir: { x: 0, y: 0 } });
    assert.deepEqual(c.facing(), { x: 1, y: 0 });
    assert.equal(warned.length, 1);
    assert.match(warned[0], /zero-length dir/);
  } finally { console.warn = origWarn; }
});
ok('attaches effects config and carries an isConditionMet evaluator', () => {
  const c = makeCarrier({
    x: 0, y: 0, w: 10, h: 10,
    effects: [{ on: 'spawn', type: 'burst', params: { count: 5 } }, { on: 'bad', type: 'x' }],
    isConditionMet(cond) { return cond === 'moving'; },
  });
  assert.equal(c.effects.length, 1, 'unknown trigger dropped during attach');
  assert.deepEqual(c.effects[0], { on: 'spawn', type: 'burst', params: { count: 5 } });
  assert.equal(typeof c.isConditionMet, 'function');
  assert.equal(c.isConditionMet('moving'), true);
  assert.equal(c.isConditionMet('fastMoving'), false);
});

console.log('Engine integration');
ok('fire() from index.js works on a carrier produced by makeCarrier', () => {
  let seen = null;
  registerEffect('carrier-probe', (params, carrier) => {
    seen = { params, origin: carrier.origin(), facing: carrier.facing() };
    return { update() {}, render() {}, done: true };
  });
  resetEffects();
  const c = makeCarrier({ x: 5, y: 7, w: 12, h: 4, dir: { x: -1, y: 0 },
    effects: [{ on: 'hitLanded', type: 'carrier-probe', params: { p: 1 } }] });
  const spawned = fire('hitLanded', c);
  assert.equal(spawned, 1);
  assert.equal(seen.params.p, 1);
  assert.deepEqual(seen.origin, { x: 5, y: 7 });
  assert.deepEqual(seen.facing, { x: -1, y: 0 });
});
ok('updateContinuous drives a continuous declaration on a makeCarrier carrier', () => {
  const bodies = [];
  registerEffect('carrier-trail', (params, carrier) => {
    const body = { life: 999, elapsed: 0, done: false, completeCalled: false,
      update(dt) { this.elapsed += dt; if (this.elapsed >= this.life) this.done = true; },
      render() {}, complete() { this.completeCalled = true; } };
    bodies.push(body);
    return body;
  });
  resetEffects();
  let moving = true;
  const c = makeCarrier({ x: 0, y: 0, w: 8, h: 8,
    effects: [{ on: 'spawn', type: 'carrier-trail', continuous: { condition: 'moving' } }],
    isConditionMet(cond) { return cond === 'moving' && moving; } });
  updateContinuous(c);
  assert.equal(activeCount(), 1, 'spawns while the condition holds');
  updateContinuous(c);
  assert.equal(activeCount(), 1, 'keeps exactly one instance');
  moving = false;
  updateContinuous(c);
  assert.equal(activeCount(), 0, 'completes when the condition stops');
  assert.equal(bodies[0].completeCalled, true);
});

console.log('Cross-kind carriers (plain objects, no shared class)');
// Representative entity kinds each expose just the minimal shape they need.
// The engine's fire path must work on all of them unchanged — proof that the
// REQUIRED contract is only `effects` (+ `isConditionMet` for continuous).
function probeFactory(label) {
  const seen = [];
  registerEffect(`probe-${label}`, (params, carrier) => {
    seen.push({ params, carrier });
    return { update() {}, render() {}, done: true };
  });
  return seen;
}
function fireProbe(kind, carrier, trigger) {
  const seen = probeFactory(kind);
  resetEffects();
  const spawned = fire(trigger, carrier);
  assert.equal(spawned, 1, `${kind}: fires one effect through the real fire() path`);
  assert.equal(seen.length, 1);
  return seen[0];
}
ok('projectile-shaped plain object fires an effect', () => {
  const projectile = {
    x: 100, y: 50, w: 16, h: 6, dir: { x: 1, y: 0 },
    effects: [{ on: 'hitLanded', type: 'probe-projectile', params: { dmg: 2 } }],
  };
  const hit = fireProbe('projectile', projectile, 'hitLanded');
  assert.equal(hit.params.dmg, 2);
  assert.equal(hit.carrier.x, 100);
});
ok('hitbox-shaped plain object fires an effect', () => {
  const hitbox = {
    x: 30, y: 30, w: 40, h: 40, dir: { x: 0, y: -1 },
    effects: [{ on: 'attackActive', type: 'probe-hitbox', params: { len: 120 } }],
  };
  const hit = fireProbe('hitbox', hitbox, 'attackActive');
  assert.equal(hit.params.len, 120);
  assert.equal(hit.carrier.w, 40);
});
ok('collision-event-shaped plain object fires an effect', () => {
  const event = {
    x: 12, y: 34, other: { x: 13, y: 35 },
    effects: [{ on: 'collision', type: 'probe-collision', params: { n: 3 } }],
  };
  const hit = fireProbe('collision', event, 'collision');
  assert.equal(hit.params.n, 3);
  assert.deepEqual(hit.carrier.other, { x: 13, y: 35 });
});
ok('marker-shaped plain object fires an effect', () => {
  const marker = {
    x: 7, y: 9,
    effects: [{ on: 'pickup', type: 'probe-marker', params: { id: 'gem' } }],
  };
  const hit = fireProbe('marker', marker, 'pickup');
  assert.equal(hit.params.id, 'gem');
  assert.equal(hit.carrier.y, 9);
});
ok('radius-shaped plain object fires an effect', () => {
  const radius = {
    x: 50, y: 50, r: 60,
    effects: [{ on: 'explosion', type: 'probe-radius', params: { shake: 4 } }],
  };
  const hit = fireProbe('radius', radius, 'explosion');
  assert.equal(hit.params.shake, 4);
  assert.equal(hit.carrier.r, 60);
});
ok('continuous-only plain-object carrier (no shared class) tracks via updateContinuous', () => {
  const bodies = [];
  registerEffect('probe-cont', () => {
    const body = { life: 999, elapsed: 0, done: false,
      update(dt) { this.elapsed += dt; }, render() {}, complete() {} };
    bodies.push(body);
    return body;
  });
  resetEffects();
  const carrier = {
    x: 0, y: 0,
    effects: [{ type: 'probe-cont', params: {}, continuous: { condition: 'moving' } }],
    isConditionMet(cond) { return cond === 'moving'; },
  };
  updateContinuous(carrier);
  assert.equal(activeCount(), 1, 'spawns while the condition holds');
  updateEffects(DT); // advance one frame at the fixed dt
  assert.equal(bodies[0].elapsed, DT);
});

console.log(`${passed} passed`);
