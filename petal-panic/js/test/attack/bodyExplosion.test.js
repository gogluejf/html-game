// Body Explosion / Kamikaze macro tests (pure logic, no DOM).
// Run: node js/test/attack/bodyExplosion.test.js

import { strict as assert } from 'node:assert';
import { killAttacker } from '../../combat/attack/macros/bodyExplosion.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import '../../combat/attack/primitives/explosion.js'; // payload target for chaining
import '../../combat/attack/primitives/beam.js';      // async payload for wait tests
import '../../combat/attack/macros/bodyExplosion.js'; // registers the macro

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;

function dummyEnemy(hp = 30) {
  return {
    x: 100, y: 100, w: 32, h: 32, alive: true, hp,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

ok('kill behavior routes through the death pipeline', () => {
  const e = dummyEnemy(30);
  const dead = killAttacker(e, 'kill');
  assert.equal(dead, true);
  assert.equal(e.alive, false);
  assert.ok(e.hp <= 0, `hp=${e.hp}`);
});

ok('remove behavior skips the pipeline', () => {
  let pipelineCalled = false;
  const e = { alive: true, hp: 50, takeDamage() { pipelineCalled = true; } };
  killAttacker(e, 'remove');
  assert.equal(e.alive, false);
  assert.equal(e.hp, 50, 'hp untouched');
  assert.equal(pipelineCalled, false);
});

ok('immediate body explosion kills the attacker and completes', () => {
  const e = dummyEnemy();
  const ctx = makeContext(e, {});
  const h = invoke('bodyExplosion', { triggerPayloadFirst: false }, ctx);
  // Subscribers attach after the sync finish — terminal events are not
  // replayed by contract, so assert on STATE here (per Wave-1 rule #5).
  assert.equal(e.alive, false, 'attacker dead');
  assert.equal(h._completed, true, 'handle completed');
});

ok('payload fires before death (synchronous payload)', () => {
  const e = dummyEnemy();
  const victim = dummyEnemy(100);
  victim.x = 110; victim.y = 110; // inside the blast
  const ctx = makeContext(e, { world: { targets: [victim] } });
  const h = invoke('bodyExplosion', {
    triggerPayloadFirst: true,
    payload: { id: 'explosion', params: { x: 116, y: 116, radius: 40, damage: 25, targets: [victim] } },
  }, ctx);
  assert.equal(e.alive, false, 'attacker died');
  assert.ok(victim.hp < 100, `payload damaged the victim (hp=${victim.hp})`);
  assert.equal(h._completed, true);
});

ok('default payload: explosion centered on the target', () => {
  const e = dummyEnemy();
  const victim = dummyEnemy(100);
  victim.x = 110; victim.y = 110;
  const ctx = makeContext(e, { world: { targets: [victim] }, target: victim });
  const h = invoke('bodyExplosion', {}, ctx);
  assert.equal(e.alive, false, 'attacker died');
  assert.ok(victim.hp < 100, `default blast damaged the target (hp=${victim.hp})`);
  assert.equal(h._completed, true);
});

ok('async payload: waits via step(dt) then dies', () => {
  // Use a beam as the async payload (it completes after its duration).
  const e = dummyEnemy();
  const ctx = makeContext(e, {});
  const h = invoke('bodyExplosion', {
    triggerPayloadFirst: true,
    payloadDelay: 0.3,
    payload: { id: 'beam', params: { direction: 0, length: 100, width: 20, duration: 0.5, damage: 5 } },
  }, ctx);
  assert.equal(e.alive, true, 'still alive while payload runs');
  let finished = false;
  for (let i = 0; i < 30 && !finished; i++) finished = h.step(DT); // 0.5s
  assert.ok(finished, 'completed when the payload finished');
  assert.equal(e.alive, false, 'died after the payload');
});

ok('payloadDelay caps the wait', () => {
  const e = dummyEnemy();
  const ctx = makeContext(e, {});
  const h = invoke('bodyExplosion', {
    triggerPayloadFirst: true,
    payloadDelay: 0.1,
    payload: { id: 'beam', params: { direction: 0, length: 100, width: 20, duration: 5, damage: 5 } },
  }, ctx);
  let finished = false;
  for (let i = 0; i < 10 && !finished; i++) finished = h.step(DT); // 0.1s
  assert.ok(finished, 'gave up waiting at payloadDelay');
  assert.equal(e.alive, false);
});

ok('unknown payload id does not throw — just dies', () => {
  const e = dummyEnemy();
  const ctx = makeContext(e, {});
  const h = invoke('bodyExplosion', {
    triggerPayloadFirst: true,
    payload: { id: 'does_not_exist' },
  }, ctx);
  assert.equal(e.alive, false);
  assert.equal(h._completed, true);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
