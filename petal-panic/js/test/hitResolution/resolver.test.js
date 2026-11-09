// Unified hit resolver tests (M2 skeleton).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ctx2d = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : () => {}), set: () => true });
global.document = { createElement: () => ({ getContext: () => ctx2d }), addEventListener: () => {} };
global.window = { addEventListener: () => {}, innerWidth: 1280, innerHeight: 720 };

const { LAYER } = await import('../../consts.js');
const { applyHit } = await import('../../combat/hitResolution.js');
const { AttackProvenance } = await import('../../combat/targeting.js');

// Plain-object fakes carrying layer bits so getTargetClass() routes correctly.
const enemyFake = () => ({ hp: 50, alive: true, layer: LAYER.ENEMY, vx: 0, vy: 0 });
const heroFake = () => ({ energy: 100, shield: 0, defense: 0, alive: true, layer: LAYER.HERO });

test('applyHit on an enemy: hp drops, accepted, dealt matches', () => {
  const target = enemyFake();
  const res = applyHit({ provenance: AttackProvenance.MELEE, source: { id: 'hero' }, target, damage: 12, team: 'ALLY' });
  assert.equal(res.accepted, true);
  assert.equal(res.dealt, 12);
  assert.equal(target.hp, 38);
});

test('applyHit self-exclusion: source===target rejected', () => {
  const t = enemyFake();
  const res = applyHit({ provenance: AttackProvenance.MELEE, source: t, target: t, damage: 5, team: 'ALLY' });
  assert.equal(res.accepted, false);
  assert.equal(res.rejectReason, 'self-exclusion');
  assert.equal(t.hp, 50);
});

test('applyHit on dead target: rejected', () => {
  const t = enemyFake();
  t.alive = false;
  const res = applyHit({ provenance: AttackProvenance.MELEE, source: { id: 'h' }, target: t, damage: 5, team: 'ALLY' });
  assert.equal(res.accepted, false);
  assert.ok(res.rejectReason);
});

test('applyHit lethal: onDestroyed called once', () => {
  const t = enemyFake();
  let destroyed = 0, hits = 0;
  t.onHit = () => hits++;
  t.onDestroyed = () => destroyed++;
  const res = applyHit({ provenance: AttackProvenance.PROJECTILE, source: { id: 'h' }, target: t, damage: 999, team: 'ALLY' });
  assert.equal(res.destroyed, true);
  assert.equal(destroyed, 1);
  assert.equal(hits, 1);
});

test('applyHit non-lethal: onHit once, onDestroyed NOT called', () => {
  const t = enemyFake();
  let destroyed = 0, hits = 0;
  t.onHit = () => hits++;
  t.onDestroyed = () => destroyed++;
  const res = applyHit({ provenance: AttackProvenance.MELEE, source: { id: 'h' }, target: t, damage: 5, team: 'ALLY' });
  assert.equal(res.destroyed, false);
  assert.equal(hits, 1);
  assert.equal(destroyed, 0);
});
