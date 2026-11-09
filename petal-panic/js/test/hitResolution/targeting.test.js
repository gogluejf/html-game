// Targeting declaration tests: enums + team/target-class classifiers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadTestMacros } from '../_macroSetup.mjs';
loadTestMacros();

const ctx2d = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : () => {}), set: () => true });
global.document = { createElement: () => ({ getContext: () => ctx2d }), addEventListener: () => {} };
global.window = { addEventListener: () => {}, innerWidth: 1280, innerHeight: 720 };

const { Team, TargetClass, AttackProvenance, getTeam, getTargetClass, assertProvenance } = await import('../../combat/targeting.js');
const { LAYER } = await import('../../consts.js');
const { Enemy } = await import('../../enemies/enemy.js');
const { GameObj } = await import('../../objects/object.js');

test('enums carry the expected uppercase values', () => {
  assert.equal(Team.ALLY, 'ALLY'); assert.equal(Team.FOE, 'FOE'); assert.equal(Team.NEUTRAL, 'NEUTRAL');
  assert.equal(TargetClass.HERO, 'HERO'); assert.equal(TargetClass.ENEMY, 'ENEMY');
  assert.equal(TargetClass.BOSS, 'BOSS'); assert.equal(TargetClass.DESTRUCTIBLE, 'DESTRUCTIBLE');
  assert.equal(TargetClass.OTHER, 'OTHER');
  assert.equal(AttackProvenance.MELEE, 'MELEE'); assert.equal(AttackProvenance.STOMP, 'STOMP');
  assert.equal(AttackProvenance.OBJECT_IMPACT, 'OBJECT_IMPACT');
  assert.equal(Object.keys(TargetClass).length, 5, 'exactly 5 target classes');
  assert.equal(Object.keys(AttackProvenance).length, 14, 'exactly 14 provenance paths');
});

test('getTeam() routes by explicit team then layer bits', () => {
  assert.equal(getTeam({ team: 'ALLY' }), Team.ALLY);
  assert.equal(getTeam({ team: 'FOE' }), Team.FOE);
  assert.equal(getTeam({ layer: LAYER.HERO }), Team.ALLY);
  assert.equal(getTeam({ layer: LAYER.ENEMY }), Team.FOE);
  assert.equal(getTeam({ layer: LAYER.HAZARD }), Team.NEUTRAL);
});

test('getTeam() throws on an invalid explicit team', () => {
  assert.throws(() => getTeam({ team: 'ally' }), /invalid team/);
});

test('assertProvenance() accepts all 14 and throws on unknown', () => {
  for (const v of Object.values(AttackProvenance)) assert.equal(assertProvenance(v), v);
  assert.throws(() => assertProvenance('melee'), /unknown attack provenance/);
});

test('getTargetClass() classifies Enemy, boss-layer entity, and GameObj instances', () => {
  const enemy = new Enemy({ id: 't', name: 'T', w: 30, h: 40, aggroRadius: 200,
    stats: { weight: 1, speed: 100, attack: 5, defense: 0, stamina: 50, fly: false } }, 0, 0);
  const boss = { ...enemy, layer: LAYER.BOSS }; // same shape, boss layer bit
  const obj = new GameObj({ kind: 'wood_barrel', x: 0, y: 0 });
  assert.equal(getTargetClass(enemy), TargetClass.ENEMY);
  assert.equal(getTargetClass(boss), TargetClass.BOSS);
  assert.equal(getTargetClass(obj), TargetClass.DESTRUCTIBLE);
  assert.equal(getTargetClass({ layer: LAYER.NONE }), TargetClass.OTHER);
});
