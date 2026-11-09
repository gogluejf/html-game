// Baseline hit-resolution tests: MELEE path only (other methods added later).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadTestMacros } from '../_macroSetup.mjs';
loadTestMacros();

const ctx2d = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : () => {}), set: () => true });
global.document = { createElement: () => ({ getContext: () => ctx2d }), addEventListener: () => {} };
global.window = { addEventListener: () => {}, innerWidth: 1280, innerHeight: 720 };

const { Enemy } = await import('../../enemies/enemy.js');
const { makeHitbox, resetHitbox, processHitboxes } = await import('../../combat/hitbox.js');
const { applyObjectImpact } = await import('../../combat/objectImpact.js');
const { resolveExplosion } = await import('../../combat/explosion.js');
const { makeWoodBarrel } = await import('../../objects/object.js');
const { damage } = await import('../../combat/damage.js');
const { resolveStompBlast } = await import('../../combat/attack/macros/stomp.js');
// SPECIAL_MELEE and SUPER_MOVE use the same hitbox engine as MELEE (different method string, same code path) — covered above.
test.skip('SHOCKWAVE — requires collisionWorld event bus and effect registry', () => {});
test.skip('OBJECT_IMPACT — covered by PROJECTILE tests above (applyObjectImpact already imported)', () => {});
const { invoke } = await import('../../combat/attack/engine.js');
const { makeContext } = await import('../../combat/attack/context.js');
await import('../../combat/attack/primitives/fireArea.js');
await import('../../combat/attack/primitives/dustZone.js');
await import('../../combat/attack/primitives/spike.js');

function makeEnemy(x = 0, y = 0) {
  return new Enemy({ id: 't', name: 'T', w: 30, h: 40, aggroRadius: 200,
    stats: { weight: 1, speed: 100, attack: 5, defense: 0, stamina: 50, fly: false } }, x, y);
}

test('MELEE — ally hitbox drains enemy hp and applies knockback', () => {
  const attacker = { x: -40, y: 0, w: 32, h: 48, vx: 0, vy: 0 };
  const enemy = makeEnemy(0, 0);
  const hb = makeHitbox({ owner: attacker, team: 'ally', box: { x: -10, y: 0, w: 40, h: 48 }, damage: 12, method: 'melee' });
  hb.knockback = { base: 200, scaleBySpeed: 0, hitstun: 0.25, iFrames: 0.5, dirMode: 'fromAttacker' };
  resetHitbox(hb);
  processHitboxes([hb], [enemy]);
  assert.equal(enemy.hp, 38);
  assert.ok(enemy.vx > 0, `knocked +x (vx=${enemy.vx})`);
});

test('MELEE — hitSet dedupe: same victim not re-hit without reset', () => {
  const attacker = { x: -40, y: 0, w: 32, h: 48, vx: 0, vy: 0 };
  const enemy = makeEnemy(0, 0);
  const hb = makeHitbox({ owner: attacker, team: 'ally', box: { x: -10, y: 0, w: 40, h: 48 }, damage: 12, method: 'melee' });
  resetHitbox(hb);
  processHitboxes([hb], [enemy]);
  const hp1 = enemy.hp;
  processHitboxes([hb], [enemy]);
  assert.equal(enemy.hp, hp1, 'no re-damage without reset');
  resetHitbox(hb);
  processHitboxes([hb], [enemy]);
  assert.ok(enemy.hp < hp1, 'fresh swing damages again');
});

test('CONTACT — damage() drains hero energy by the hit amount', () => {
  const hero = { x: 0, y: 0, w: 32, h: 48, energy: 100, shield: 0, alive: true };
  const dealt = damage({ id: 'enemy' }, hero, 10, 'contact');
  assert.equal(dealt, 10);
  assert.equal(hero.energy, 90);
});

test('CONTACT — shield absorbs before energy drains', () => {
  const hero = { x: 0, y: 0, w: 32, h: 48, energy: 100, shield: 6, defense: 0, alive: true };
  damage({ id: 'enemy' }, hero, 10, 'contact');
  assert.equal(hero.shield, 0);
  assert.equal(hero.energy, 96, 'shield absorbed 6, remaining 4 hit energy');
});

test('STOMP — resolveStompBlast damages enemies in radius, spares far ones', () => {
  const attacker = { x: -16, y: 0, w: 32, h: 48 }; // feet center (0, 48)
  const near = makeEnemy(-15, 20);   // center (0, 40): dist ~8 from blast point
  const far = makeEnemy(200, 20);    // way outside radius
  const hits = resolveStompBlast({ radius: 60, damage: 20, method: 'stomp' }, { attacker }, [near, far]);
  assert.ok(near.hp < 50, `near enemy damaged (hp=${near.hp})`);
  assert.equal(far.hp, 50, 'far enemy untouched');
  assert.ok(hits.some((h) => h.target === near));
});

test('STOMP — barrel.hit(40, hero, "stomp") destroys a wood barrel', () => {
  const barrel = makeWoodBarrel(0, 0);
  const applied = barrel.hit(40, { id: 'hero' }, 'stomp');
  assert.ok(applied > 0);
  assert.ok(barrel.destroyed, 'overkill stomp latches destroyed');
});

test('DASH — resolveDashDirection returns 0 for non-finite input', () => {
  assert.equal(resolveDashDirection(NaN), 0);
  assert.equal(resolveDashDirection(undefined), 0);
  assert.equal(resolveDashDirection(1.57), 1.57);
});

test('DASH — normalizeSegment derives knockback.base from speed when omitted', () => {
  const seg = normalizeSegment({ speed: 400, knockback: {} });
  assert.equal(seg.knockback.base, 100); // 400 * 0.25
  assert.equal(seg.duration, 0.18, 'default duration');
});

test.skip('BEAM — beamOrigin/beamBox have circular dep through engine.js; needs full invoke() ctx', () => {});

const { resolveDashDirection, normalizeSegment } = await import('../../combat/attack/macros/dashCombo.js');

test('HAZARD_FIRE — fireArea ticks damage on a target inside the zone', () => {
  const enemy = makeEnemy(0, 0); // box x[0,30] y[0,40]; segs settle at groundY=50
  const ctx = makeContext({ x: -100, y: -100, w: 32, h: 48 }, { groundY: 50 });
  const h = invoke('fireArea', { x: 15, y: 40, segments: 1, duration: 1, tickRate: 5, damage: 10 }, ctx);
  for (let i = 0; i < 10 && !h.state.done; i++) h.step(0.05, [enemy]);
  assert.ok(enemy.hp < 50, `enemy took fire damage (hp=${enemy.hp})`);
});

test('HAZARD_DUST — dustZone ticks damage on a target inside the cloud', () => {
  const enemy = makeEnemy(0, 0);
  const ctx = makeContext({ x: -100, y: -100, w: 32, h: 48 });
  const h = invoke('dustZone', { x: 15, y: 20, width: 60, height: 80, duration: 1, tickRate: 5, damage: 10 }, ctx);
  for (let i = 0; i < 10 && !h.state.done; i++) h.step(0.05, [enemy]);
  assert.ok(enemy.hp < 50, `enemy took dust damage (hp=${enemy.hp})`);
});

test('SPIKE — no damage during warning; damage lands once visible', () => {
  const enemy = makeEnemy(-72, 0); // center (0,0) inside spike box x[-72,72] y[-8,8]
  const ctx = makeContext({ x: -100, y: -100, w: 32, h: 48 });
  const h = invoke('spike', { x: 0, y: 0, warningTime: 0.4, visibleTTL: 0.8, repeatCount: 1, damage: 15, tickRate: 10 }, ctx);
  h.step(0.2, [enemy]);
  assert.equal(enemy.hp, 50, 'warning phase deals no damage');
  h.step(0.2, [enemy]); // crosses into visible → first tick fires
  assert.ok(enemy.hp < 50, `visible phase damages (hp=${enemy.hp})`);
});

test('PROJECTILE — impact drains barrel hp, consumes projectile, fires reward', () => {
  const barrel = makeWoodBarrel(0, 0);
  let reward = null;
  applyObjectImpact({ alive: true, friendly: true, damage: 15 }, barrel, null, { onObjectReward: (t, d) => { reward = [t, d]; } });
  assert.equal(barrel.hp, 25);
  assert.ok(!barrel.destroyed);
  assert.deepEqual(reward, [barrel, 15]);
});

test('PROJECTILE — killing blow latches destroyed and fires onObjectDestroyed once', () => {
  const barrel = makeWoodBarrel(0, 0);
  let destroyed = 0;
  applyObjectImpact({ alive: true, friendly: true, damage: 999 }, barrel, null, { onObjectDestroyed: () => destroyed++ });
  assert.ok(barrel.destroyed);
  assert.equal(destroyed, 1);
  applyObjectImpact({ alive: true, friendly: true, damage: 999 }, barrel, null, { onObjectDestroyed: () => destroyed++ });
  assert.equal(destroyed, 1, 'no double-fire');
});

test('EXPLOSION — ally blast damages enemies in radius, spares hero', () => {
  const enemy = makeEnemy(60, 0);
  const hero = { x: 40, y: 0, w: 32, h: 48, energy: 100 };
  const res = resolveExplosion({ cx: 0, cy: 0, radius: 120, damage: 20, team: 'ally', knockback: null, self: {}, ctx: { hero } }, [enemy, hero]);
  assert.equal(enemy.hp, 30);
  assert.equal(hero.energy, 100, 'hero spared by ally blast');
  assert.ok(res.hit.includes(enemy));
});

test('EXPLOSION — detonator excluded from own neutral blast', () => {
  const self = { x: -16, y: 0, w: 32, h: 48, hp: 60, defense: 0 };
  const other = makeEnemy(60, 0);
  const res = resolveExplosion({ cx: 0, cy: 0, radius: 120, damage: 25, team: 'neutral', knockback: null, self }, [self, other]);
  assert.equal(self.hp, 60, 'detonator not damaged');
  assert.equal(other.hp, 25);
  assert.ok(!res.hit.includes(self));
});
