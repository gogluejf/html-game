// Task 1.2 — node-based unit tests for the Effects Engine core (js/effects/index.js).
// Run: node js/test/effectEngine.test.js
// No DOM needed: the engine is a pure module. Fixed dt = 1/60 per project convention.

import { strict as assert } from 'node:assert';
import {
  TRIGGERS,
  registerEffect,
  hasEffect,
  registeredTypes,
  fire,
  fireManual,
  updateEffects,
  updateContinuous,
  drawEffects,
  resetEffects,
  activeCount,
} from '../effects/index.js';

const DT = 1 / 60;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Deterministic test effect: counts updates/draws, completes after `life` seconds. */
function makeFactory(opts = {}) {
  const created = [];
  const factory = (params, carrier, ctx) => {
    const inst = {
      params, carrier, ctx,
      life: opts.life ?? 0.5,
      elapsed: 0,
      draws: 0,
      done: false,
      completeCalled: false,
      update(dt) {
        this.elapsed += dt;
        if (this.elapsed >= this.life) this.done = true;
      },
      render(ctx) { this.draws++; },
      complete() { this.completeCalled = true; },
    };
    created.push(inst);
    return inst;
  };
  return { factory, created };
}

console.log('Trigger vocabulary');
ok('TRIGGERS matches the spec vocabulary', () => {
  assert.deepEqual(TRIGGERS, [
    'spawn', 'death', 'collision', 'explosion', 'pickup',
    'damageTaken', 'hitLanded', 'attackActive', 'stateChange', 'manual',
  ]);
});

console.log('Registry');
ok('registerEffect + hasEffect round-trip', () => {
  const { factory } = makeFactory();
  assert.equal(hasEffect('test-burst'), false);
  registerEffect('test-burst', factory);
  assert.equal(hasEffect('test-burst'), true);
  assert.ok(registeredTypes().includes('test-burst'));
});
ok('registerEffect rejects bad type/factory', () => {
  assert.throws(() => registerEffect('', makeFactory().factory));
  assert.throws(() => registerEffect('x', null));
});

console.log('Fire + lifecycle');
ok('matching trigger spawns an instance that updates and draws until done', () => {
  const { factory, created } = makeFactory({ life: 0.5 });
  registerEffect('lifecycle', factory);
  resetEffects();
  const carrier = { effects: [{ on: 'collision', type: 'lifecycle', params: { n: 1 } }] };
  const spawned = fire('collision', carrier);
  assert.equal(spawned, 1);
  assert.equal(activeCount(), 1);

  // Fixed dt = 1/60; life = 0.5s = exactly 30 frames. The instance is drawn
  // once per active frame (render called before it reports done), so it must
  // render exactly 30 times, then be pruned.
  for (let i = 0; i < 31; i++) {
    updateEffects(DT);
    drawEffects({ marker: 'ctx' });
  }
  assert.equal(created[0].draws, 30, `rendered ${created[0].draws} over 30 active frames`);
  assert.equal(activeCount(), 0, 'instance pruned once done');
  assert.ok(created[0].elapsed >= 0.5);
});
ok('carrier with no matching trigger config produces no instance', () => {
  const { factory } = makeFactory();
  registerEffect('no-match', factory);
  resetEffects();
  const carrier = { effects: [{ on: 'death', type: 'no-match', params: {} }] };
  assert.equal(fire('collision', carrier), 0);
  assert.equal(activeCount(), 0);
});
ok('unknown effect types are ignored without throwing but warn', () => {
  resetEffects();
  const carrier = { effects: [{ on: 'spawn', type: 'does-not-exist', params: {} }] };
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warns.push(args.join(' ')); };
  try {
    assert.doesNotThrow(() => assert.equal(fire('spawn', carrier), 0));
  } finally {
    console.warn = origWarn;
  }
  assert.equal(activeCount(), 0);
  assert.equal(warns.length, 1, 'exactly one warning for the unregistered type');
  assert.match(warns[0], /unregistered effect type "does-not-exist"/);
});
ok('fire tolerates carriers without an effects array', () => {
  assert.equal(fire('collision', {}), 0);
  assert.equal(fire('collision', null), 0);
});
ok('multiple configs on one trigger all spawn', () => {
  const { factory } = makeFactory();
  registerEffect('multi', factory);
  resetEffects();
  const carrier = { effects: [
    { on: 'explosion', type: 'multi', params: { a: 1 } },
    { on: 'explosion', type: 'multi', params: { a: 2 } },
    { on: 'death',     type: 'multi', params: { a: 3 } },
  ]};
  assert.equal(fire('explosion', carrier), 2);
  assert.equal(activeCount(), 2);
});
ok('factory receives params, carrier, and ctx', () => {
  const seen = {};
  registerEffect('inspect', (params, carrier, ctx) => {
    Object.assign(seen, { params, carrier, ctx });
    return { update() {}, render() {}, done: true };
  });
  const carrier = { effects: [{ on: 'pickup', type: 'inspect', params: { p: 42 } }] };
  fire('pickup', carrier, { view: 99 });
  assert.equal(seen.params.p, 42);
  assert.equal(seen.carrier, carrier);
  assert.equal(seen.ctx.view, 99);
});
ok('fire ignores triggers outside the fixed vocabulary (deterministic no-op)', () => {
  const { factory } = makeFactory();
  registerEffect('vocab', factory);
  resetEffects();
  const carrier = { effects: [
    { on: 'collision', type: 'vocab', params: {} },
    { on: 'bogusTrigger', type: 'vocab', params: {} },
  ]};
  // A non-vocabulary trigger must never spawn anything, even if a config's
  // `on` happens to equal it — the engine resolves only against TRIGGERS.
  assert.equal(fire('bogusTrigger', carrier), 0);
  assert.equal(activeCount(), 0);
  // A valid vocabulary trigger still fires its matching config.
  assert.equal(fire('collision', carrier), 1);
  assert.equal(activeCount(), 1);
});

console.log('Manual fires');
ok('fireManual routes through the same spawn path with manual trigger', () => {
  const { factory, created } = makeFactory({ life: 0.1 });
  registerEffect('manual-type', factory);
  resetEffects();
  const inst = fireManual({ type: 'manual-type', params: { m: 1 } });
  assert.ok(inst);
  assert.equal(activeCount(), 1);
  // The instance records the trigger; the engine must NOT mutate the body.
  assert.equal(inst.trigger, 'manual');
  assert.equal(created[0].trigger, undefined, 'engine does not write trigger onto the body');
  assert.equal(created[0].carrier, null);
});
ok('fireManual returns null for unknown types', () => {
  const origWarn = console.warn;
  console.warn = () => {}; // silence expected warning
  try {
    assert.equal(fireManual({ type: 'nope' }), null);
  } finally {
    console.warn = origWarn;
  }
});
ok('an instance already done at spawn time is not stepped', () => {
  let stepped = false;
  registerEffect('instant', () => ({ update() { stepped = true; }, render() {}, done: true }));
  resetEffects(); // clear any instances left over from prior tests
  const inst = fireManual({ type: 'instant' });
  assert.ok(inst.done, 'instance reports done immediately');
  assert.equal(activeCount(), 0, 'not added to the active set');
  updateEffects(DT);
  assert.equal(stepped, false, 'update never called on a done-at-spawn instance');
});

console.log('Continuous activation');
ok('continuous condition spawns while held, completes when it stops', () => {
  const { factory, created } = makeFactory({ life: 999 }); // long-lived; only condition ends it
  registerEffect('trail', factory);
  resetEffects();
  const carrier = {
    moving: true,
    isConditionMet(c) { return c === 'moving' ? this.moving : false; },
    effects: [{ on: 'spawn', type: 'trail', continuous: { condition: 'moving' } }],
  };
  updateContinuous(carrier);
  assert.equal(activeCount(), 1, 'spawns when condition starts');
  updateContinuous(carrier);
  assert.equal(activeCount(), 1, 'keeps exactly one instance while held');
  carrier.moving = false;
  updateContinuous(carrier);
  assert.equal(activeCount(), 0, 'completes when condition stops');
  assert.equal(created[0].completeCalled, true);
});
ok('continuous tracking does not mutate the carrier (frozen carriers work)', () => {
  const { factory } = makeFactory({ life: 999 });
  registerEffect('frozen-trail', factory);
  resetEffects();
  const carrier = Object.freeze({
    isConditionMet(c) { return c === 'moving'; },
    effects: [{ on: 'spawn', type: 'frozen-trail', continuous: { condition: 'moving' } }],
  });
  // Writing __effectId onto a frozen object would throw in strict mode;
  // the WeakMap-backed identity must not touch the carrier at all.
  assert.doesNotThrow(() => updateContinuous(carrier));
  assert.equal(activeCount(), 1, 'frozen carrier tracked without mutation');
  updateContinuous(carrier);
  assert.equal(activeCount(), 1, 'still exactly one instance on re-eval');
});
ok('continuous declaration can accompany discrete triggers', () => {
  const { factory, created } = makeFactory({ life: 999 });
  registerEffect('dual', factory);
  resetEffects();
  const carrier = {
    isConditionMet() { return false; },
    effects: [{ on: 'spawn', type: 'dual', continuous: { condition: 'fastMoving' } }],
  };
  // Discrete fire still works alongside the continuous declaration.
  assert.equal(fire('spawn', carrier), 1);
  assert.equal(activeCount(), 1);
});
ok('two declarations sharing one condition each keep their own instance', () => {
  const { factory, created } = makeFactory({ life: 999 });
  registerEffect('shared-cond', factory);
  resetEffects();
  const carrier = {
    isConditionMet(c) { return c === 'moving'; },
    effects: [
      { on: 'spawn', type: 'shared-cond', params: { a: 1 }, continuous: { condition: 'moving' } },
      { on: 'spawn', type: 'shared-cond', params: { a: 2 }, continuous: { condition: 'moving' } },
    ],
  };
  updateContinuous(carrier);
  // Keyed by declaration identity, not just (carrier, condition): both spawn.
  assert.equal(activeCount(), 2, 'each declaration gets its own instance');
  assert.deepEqual(created.map(b => b.params.a), [1, 2]);
  updateContinuous(carrier);
  assert.equal(activeCount(), 2, 'still two distinct instances on re-eval');
  carrier.isConditionMet = () => false;
  updateContinuous(carrier);
  assert.equal(activeCount(), 0, 'both complete when the condition stops');
});
ok('a completed continuous instance respawns while its condition still holds', () => {
  const { factory, created } = makeFactory({ life: DT * 2 }); // completes after ~2 frames
  registerEffect('short-lived-trail', factory);
  resetEffects();
  const carrier = {
    isConditionMet(c) { return c === 'moving'; },
    effects: [{ on: 'spawn', type: 'short-lived-trail', continuous: { condition: 'moving' } }],
  };
  updateContinuous(carrier);
  assert.equal(activeCount(), 1, 'first instance spawned');
  // Let it run past its lifetime so it reports done.
  updateEffects(DT);
  updateEffects(DT);
  updateEffects(DT);
  assert.ok(created[0].done, 'first instance has completed');
  // Condition still holds → engine must drop the dead cache entry and respawn.
  updateContinuous(carrier);
  assert.equal(activeCount(), 1, 'respawned a fresh instance while condition held');
  assert.ok(created.length >= 2, 'a second body was created for the respawn');
  assert.ok(!created[created.length - 1].done, 'the new instance is alive');
});

console.log('Reset');
ok('resetEffects clears active instances and calls complete', () => {
  const { factory, created } = makeFactory({ life: 999 });
  registerEffect('stale', factory);
  resetEffects();
  fireManual({ type: 'stale' });
  assert.equal(activeCount(), 1);
  resetEffects();
  assert.equal(activeCount(), 0);
  assert.equal(created[0].completeCalled, true);
});
ok('resetEffects clears continuous tracking state', () => {
  const { factory, created } = makeFactory({ life: 999 }); // long-lived; only reset/condition ends it
  registerEffect('reset-trail', factory);
  resetEffects();
  const carrier = {
    isConditionMet(c) { return c === 'moving'; },
    effects: [{ on: 'spawn', type: 'reset-trail', continuous: { condition: 'moving' } }],
  };
  updateContinuous(carrier);
  assert.equal(activeCount(), 1, 'continuous instance tracked before reset');
  resetEffects();
  assert.equal(activeCount(), 0, 'active instance cleared');
  assert.equal(created[0].completeCalled, true, 'tracked instance completed by reset');
  // The continuous map must also be cleared: with the condition still holding,
  // a stale cache entry would suppress or duplicate the next spawn. Resetting
  // means a fresh start — the next update re-spawns exactly one instance.
  updateContinuous(carrier);
  assert.equal(activeCount(), 1, 're-spawns exactly one instance after reset');
  assert.equal(created.length, 2, 'fresh instance created, not resurrected from cache');
});
ok('updateEffects does not double-update completed instances', () => {
  const ticks = { n: 0 };
  registerEffect('tick', () => ({
    update() { ticks.n++; },
    render() {},
    done: true,
  }));
  resetEffects();
  fireManual({ type: 'tick' });
  updateEffects(DT); // pruned immediately since done=true at creation
  assert.equal(ticks.n, 0, 'completed instances are not stepped');
});

console.log(`${passed} passed`);
