import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoke } from '../../combat/attack/engine.js';
import '../../combat/attack/macros/index.js';
import { Pool, Special, Projectile } from '../../objects/projectile.js';

function context() {
  return {
    attacker: { x: 0, y: 0, w: 20, h: 20 },
    pools: { specialPool: new Pool(Special, 2), projectilePool: new Pool(Projectile, 2) },
    world: { targets: [] }, groundY: 400,
  };
}
for (const [id, defaultType] of [['homingMissile', 'homing'], ['explosiveProjectile', 'explosive'], ['skyMissile', 'explosive']]) {
  for (const [label, params, expected] of [
    ['default', {}, defaultType],
    ['override', { specialType: 'spread' }, 'spread'],
    ['plain', { specialType: null }, null],
  ]) {
    test(`${id}: ${label} style survives composition`, () => {
      const h = invoke(id, { ...params, timeToTarget: 0 }, context());
      let entity = h.entity;
      if (id === 'skyMissile') {
        // Skip warning VFX only; execute the real payload invocation.
        h.state.markerFired = true;
        h.step(1 / 60, []);
        entity = h.state.missile.entity;
      }
      assert.ok(entity instanceof (expected === null ? Projectile : Special));
      assert.equal(entity.type ?? null, expected);
    });
  }
}
