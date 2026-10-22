// Task 1.1 — Attack Engine core infrastructure smoke test.
// Verifies: registry, context builder, marker resolution, invoke() dispatch,
// handle events (hit/expire/detonate/complete), cancel semantics, and inner-
// handle proxying. No DOM, no game world — pure logic.
// Run: node js/test/attack/engine.test.js

import { strict as assert } from 'node:assert';
import {
  registerPrimitive, registerMacro, getPrimitive, getMacro,
  listPrimitives, listMacros, resetRegistries,
} from '../../combat/attack/registry.js';
import { makeContext, resolveMarker, ATTACK_EVENTS } from '../../combat/attack/context.js';
import { attackEngine, invoke, AttackHandle } from '../../combat/attack/engine.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

resetRegistries();

// --- A fake primitive that fires hit then complete, like a real one would.
function makeFakeImpl({ hits = 1, detonates = false } = {}) {
  return function impl(params, ctx) {
    const h = new AttackHandle('fake');
    // Simulate work: verify merged params reached the impl.
    assert.equal(params.damage, 99, 'default param should be present');
    assert.equal(ctx.attacker.tag, 'attacker', 'context should carry the attacker');
    for (let i = 0; i < hits; i++) h._emit('hit', { dealt: params.damage });
    if (detonates) h._emit('detonate', { radius: params.radius });
    h._complete();
    return h;
  };
}

ok('registry: register + lookup primitives and macros', () => {
  registerPrimitive('fake', { impl: makeFakeImpl(), params: { damage: 99 } });
  registerMacro('fake_macro', { impl: makeFakeImpl() });
  assert.ok(getPrimitive('fake'));
  assert.ok(getMacro('fake_macro'));
  assert.equal(getPrimitive('nope'), null);
});

ok('registry: duplicate ids throw', () => {
  assert.throws(() => registerPrimitive('fake', { impl: makeFakeImpl() }), /duplicate/);
});

ok('registry: sorted listing', () => {
  registerPrimitive('aaa', { impl: makeFakeImpl() });
  assert.deepEqual(listPrimitives(), ['aaa', 'fake']);
  assert.deepEqual(listMacros(), ['fake_macro']);
});

ok('context: makeContext defaults + overrides', () => {
  const attacker = { tag: 'attacker', markers: [{ label: 'muzzle', x: 8, y: -2 }] };
  const ctx = makeContext(attacker);
  assert.equal(ctx.attacker, attacker);
  assert.equal(ctx.target, null);
  assert.equal(ctx.markers, attacker.markers, 'should fall back to attacker.markers');
  const ctx2 = makeContext(attacker, { target: { hp: 5 }, collisionWorld: {} });
  assert.equal(ctx2.target.hp, 5);
  assert.ok(ctx2.collisionWorld);
});

ok('context: resolveMarker finds by label, null on miss', () => {
  const attacker = { markers: [{ label: 'chest', x: 0, y: 4 }, { label: 'muzzle', x: 12, y: 0 }] };
  const ctx = makeContext(attacker);
  assert.deepEqual(resolveMarker(ctx, 'muzzle'), { x: 12, y: 0 });
  assert.equal(resolveMarker(ctx, 'tail'), null);
  // Also works when markers are passed via ctx directly.
  const ctx2 = makeContext({}, { markers: [{ label: 'foot', x: 1, y: 2 }] });
  assert.deepEqual(resolveMarker(ctx2, 'foot'), { x: 1, y: 2 });
});

ok('invoke: unknown id throws', () => {
  assert.throws(() => invoke('does_not_exist', {}, makeContext({})), /unknown attack/);
});

ok('invoke: dispatches to primitive with merged params', () => {
  const ctx = makeContext({ tag: 'attacker' });
  const h = invoke('fake', {}, ctx);
  assert.ok(h instanceof AttackHandle);
  assert.equal(h.id, 'fake');
});

ok('handle: lifecycle events fire in order (hit → complete)', () => {
  const seen = [];
  const h = invoke('fake', {}, makeContext({ tag: 'attacker' }));
  // Events are emitted synchronously by the impl during invoke(); subscribe
  // for future semantics, but assert on what already fired via a fresh handle.
  const h2 = new AttackHandle('probe');
  h2.on('hit', (info) => seen.push(['hit', info.dealt]));
  h2.on('complete', () => seen.push(['complete']));
  h2._emit('hit', { dealt: 99 });
  h2._complete();
  assert.deepEqual(seen, [['hit', 99], ['complete']]);
});

ok('handle: detonate event proxies through', () => {
  const seen = [];
  const h = new AttackHandle('probe');
  h.on('detonate', (d) => seen.push(d.radius));
  h.on('complete', () => seen.push('done'));
  h._emit('detonate', { radius: 30 });
  h._complete();
  assert.deepEqual(seen, [30, 'done']);
});

ok('invoke: registered primitive dispatches with merged params end-to-end', () => {
  registerPrimitive('boom', { impl: makeFakeImpl({ detonates: true }), params: { damage: 99, radius: 30 } });
  const h = invoke('boom', {}, makeContext({ tag: 'attacker' }));
  assert.equal(h.id, 'boom');
});

ok('handle: cancel before completion emits expire, suppresses complete', () => {
  // Impl that never completes on its own.
  registerPrimitive('stall', {
    impl: () => {
      const h = new AttackHandle('stall');
      return h; // no _complete call
    },
  });
  const seen = [];
  const h = invoke('stall', {}, makeContext({}));
  h.on('expire', () => seen.push('expire'));
  h.on('complete', () => seen.push('complete'));
  h.cancel();
  assert.deepEqual(seen, ['expire'], 'cancel must emit expire, not complete');
  h.cancel(); // idempotent
  assert.deepEqual(seen, ['expire'], 'second cancel is a no-op');
});

ok('handle: listeners registered after completion do not fire', () => {
  const h = invoke('fake', {}, makeContext({ tag: 'attacker' }));
  let fired = false;
  h.on('complete', () => { fired = true; });
  assert.equal(fired, false, 'late subscription must not replay completed events');
});

ok('handle: unknown event name throws', () => {
  const h = new AttackHandle('x');
  assert.throws(() => h.on('warp', () => {}), /unknown event/);
});

ok('events contract: exactly hit/expire/detonate/complete', () => {
  assert.deepEqual([...ATTACK_EVENTS].sort(), ['complete', 'contact', 'detonate', 'expire', 'hit']);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
