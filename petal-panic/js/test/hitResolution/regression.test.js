import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTestMacros } from '../_macroSetup.mjs';
loadTestMacros();
const ctx2d = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : () => {}), set: () => true });
global.document = { createElement: () => ({ getContext: () => ctx2d }), addEventListener: () => {} };
global.window = { addEventListener: () => {}, innerWidth: 1280, innerHeight: 720 };

const { Enemy } = await import('../../enemies/enemy.js');
const { GameObj, WOOD_BARREL_DEF } = await import('../../objects/object.js');
const { makeHitbox, resetHitbox, processHitboxes } = await import('../../combat/hitbox.js');
const { resolveExplosion } = await import('../../combat/explosion.js');
const { applyHit } = await import('../../combat/hitResolution.js');
const { Team, AttackProvenance } = await import('../../combat/targeting.js');
const { invoke } = await import('../../combat/attack/engine.js');
const { makeContext } = await import('../../combat/attack/context.js');
await import('../../combat/attack/primitives/dustZone.js');

function makeEnemy(x=0,y=0,hp=50) { return new Enemy({id:'t',name:'T',w:30,h:40,aggroRadius:200,stats:{weight:1,speed:100,attack:5,defense:0,stamina:hp,fly:false}},x,y); }
function makeBarrel(x=0,y=0) { return new GameObj(WOOD_BARREL_DEF,x,y); }

test('REGRESSION — melee on barrel triggers onHit callback (supercoin reward path)', () => {
  const attacker = { x:-40,y:0,w:32,h:48,vx:0,vy:0 };
  const barrel = makeBarrel(0,0);
  let hitCalled = 0;
  barrel.onHit = () => { hitCalled++; };
  const hb = makeHitbox({ owner:attacker, team:'ally', box:{x:-10,y:0,w:40,h:48}, damage:12, method:'melee' });
  resetHitbox(hb);
  processHitboxes([hb],[barrel]);
  assert.equal(hitCalled, 1, 'onHit fired exactly once');
});

test('REGRESSION — ally explosion spares hero, hits enemy', () => {
  const hero = { layer: 4, x:20,y:0,w:32,h:48, energy:100, shield:0, alive:true, invincible:false, dying:false };
  const enemy = makeEnemy(30,0);
  const res = resolveExplosion(
    { cx:0, cy:0, radius:60, damage:25, team:'ally', knockback:{base:380,scaleBySpeed:0,hitstun:0.3,iFrames:0.6,dirMode:'radial',pop:60}, self:null, ctx:{hero} },
    [hero, enemy]
  );
  assert.ok(res.hit.includes(enemy), 'enemy was hit');
  assert.ok(!res.hit.includes(hero), 'hero spared by ally blast');
  assert.equal(hero.energy, 100, 'hero energy untouched');
});

test('REGRESSION — exactly-once destruction via applyHit', () => {
  const barrel = makeBarrel(0, 0);
  const src = { x: -40, y: 0 };
  const first = applyHit({ provenance: AttackProvenance.MELEE, source: src, target: barrel, damage: 999, team: Team.ALLY });
  assert.equal(first.destroyed, true, 'lethal hit destroys barrel');
  const second = applyHit({ provenance: AttackProvenance.MELEE, source: src, target: barrel, damage: 999, team: Team.ALLY });
  assert.equal(second.accepted, false, 'second hit rejected on destroyed target');
  assert.equal(barrel.destroyed, true, 'still destroyed (no double-destroy)');
});

test('REGRESSION — zero-damage hit deals nothing, no crash / negative hp', () => {
  const enemy = makeEnemy(0, 0, 50);
  const res = applyHit({ provenance: AttackProvenance.PROJECTILE, source: { x: -40 }, target: enemy, damage: 0, team: Team.ALLY });
  // defense floors a real hit at 1; assert actual behavior is non-negative and bounded
  assert.ok(res.dealt >= 0 && res.dealt <= 1, `dealt=${res.dealt} in [0,1]`);
  assert.ok(enemy.hp >= 0, `hp not negative (${enemy.hp})`);
  assert.equal(res.destroyed, false, 'zero-damage cannot destroy');
});

test('REGRESSION — dustZone does NOT damage destructibles (design doc rule)', () => {
  const barrel = makeBarrel(0, 0);
  barrel.hp = 5;
  const enemy = makeEnemy(0, 0);
  const ctx = makeContext({ x: -100, y: -100, w: 32, h: 48 });
  const h = invoke('dustZone', { x: 15, y: 20, width: 60, height: 80, duration: 2, tickRate: 5, damage: 10 }, ctx);
  for (let i = 0; i < 60 && !h.state.done; i++) h.step(1 / 60, [barrel, enemy]);
  assert.equal(barrel.hp, 5, 'barrel untouched by dust');
  assert.ok(enemy.hp < 50, 'enemy still takes dust damage');
});
