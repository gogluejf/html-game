// Migration guard: after routing the melee hitbox damage path through
// applyHit() (unified-hit-resolution §3), a MELEE swing must still drain an
// enemy's hp AND apply knockback — identical to the pre-migration behaviour.
// Mirrors baseline.test.js's MELEE case but asserts the resolver wiring holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ctx2d = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : () => {}), set: () => true });
global.document = { createElement: () => ({ getContext: () => ctx2d }), addEventListener: () => {} };
global.window = { addEventListener: () => {}, innerWidth: 1280, innerHeight: 720 };

const { Enemy } = await import('../../enemies/enemy.js');
const { makeHitbox, resetHitbox, processHitboxes } = await import('../../combat/hitbox.js');
const { applyObjectImpact } = await import('../../combat/objectImpact.js');
const { makeWoodBarrel } = await import('../../objects/object.js');

function makeEnemy(x = 0, y = 0) {
  return new Enemy({ id: 't', name: 'T', w: 30, h: 40, aggroRadius: 200,
    stats: { weight: 1, speed: 100, attack: 5, defense: 0, stamina: 50, fly: false } }, x, y);
}

test('MELEE (post-migration) — ally hitbox drains enemy hp and applies knockback via applyHit()', () => {
  const attacker = { x: -40, y: 0, w: 32, h: 48, vx: 0, vy: 0 };
  const enemy = makeEnemy(0, 0); // hp 50, defense 0 → full 12 lands
  const hb = makeHitbox({ owner: attacker, team: 'ally', box: { x: -10, y: 0, w: 40, h: 48 }, damage: 12, method: 'melee' });
  hb.knockback = { base: 200, scaleBySpeed: 0, hitstun: 0.25, iFrames: 0.5, dirMode: 'fromAttacker' };
  resetHitbox(hb);
  processHitboxes([hb], [enemy]);
  assert.equal(enemy.hp, 38, 'damage routed through applyHit() still drains hp');
  assert.ok(enemy.vx > 0, `knockback still applied (vx=${enemy.vx})`);
});

test('PROJECTILE (post-migration) — object impact drains barrel hp and fires destroy callback via applyHit()', () => {
  const barrel = makeWoodBarrel(0, 0); // hp 40
  // Rewards/destruction are owned by the target's own hooks (GameObj.prototype
  // onHit/onDestroyed wired in update.js), not external callbacks.
  let hitFired = 0, destroyedFired = 0;
  const oh = barrel.onHit, od = barrel.onDestroyed;
  barrel.onHit = (...a) => { hitFired++; if (oh) return oh(...a); };
  barrel.onDestroyed = (...a) => { destroyedFired++; if (od) return od(...a); };
  const proj = { alive: true, friendly: true, damage: 999 };
  applyObjectImpact(proj, barrel, null);
  assert.equal(barrel.hp, 0, 'barrel hp drained to 0');
  assert.ok(barrel.destroyed, 'destroyed latched');
  assert.equal(proj.alive, false, 'projectile consumed');
  assert.equal(hitFired, 1, 'target onHit fired exactly once');
  assert.equal(destroyedFired, 1, 'target onDestroyed fired exactly once');
});
