// Reticle Shot macro tests (target-reticle effect → Projectile composition).
// Run: node js/test/attack/reticleShot.test.js

import { strict as assert } from 'node:assert';
import { invoke } from '../../combat/attack/engine.js';
import { invokeChild } from '../../combat/attack/attackIds.js';
import { makeContext } from '../../combat/attack/context.js';
import { Pool, Projectile } from '../../objects/projectile.js';
import { fireManual, resetEffects, activeInstances } from '../../effects/index.js';
import '../../effects/registry.js'; // side effect: registers target-reticle
import '../../combat/attack/primitives/projectile.js';
import '../../combat/attack/macros/reticleShot.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 }); // center (116,116)
const target = () => ({ x: 400, y: 200, w: 32, h: 32, alive: true, vx: -160, vy: 0 });
const pools = () => ({ projectilePool: new Pool(Projectile, 32) });

ok('tracks then locks: ONE shot fires at the LOCKED point, not current position', () => {
  const t = target();
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const h = invoke('reticleShot', { duration: 1.0, lockTime: 0.5, speed: 500, ttl: 2, damage: 10 }, ctx);
  // Step to just past lockTime (0.5s): reticle still tracking, no shot yet.
  for (let i = 0; i < 29; i++) { t.x += -160 / 60; h.step(1 / 60); }
  assert.equal(h.shot, undefined, 'no shot before duration ends');
  // Keep stepping to duration end (t ≈ 1.0s). Target keeps moving.
  let completed = null;
  h.on('complete', (info) => { completed = info; });
  for (let i = 0; i < 32 && !completed; i++) { t.x += -160 / 60; h.step(1 / 60); }
  assert.ok(completed, 'complete fired with the locked point');
  assert.ok(h.shot?.entity, 'a projectile was spawned');
  // Exactly one bullet in the pool — no double fire.
  assert.equal(ctx.pools.projectilePool.active.length, 1, `one live bullet, got ${ctx.pools.projectilePool.active.length}`);
  // The locked point must be AHEAD of where the target is now (it kept walking
  // left after the lock) — proof we shot the lock, not the live position.
  assert.ok(completed.point.x > t.x + t.w / 2, `locked ${Math.round(completed.point.x)} > current ${Math.round(t.x + 16)}`);
});

ok('shot direction points from attacker center at the locked point', () => {
  const t = target();
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const h = invoke('reticleShot', { duration: 0.8, lockTime: 0.4, speed: 500, ttl: 2, damage: 10 }, ctx);
  let completed = null;
  h.on('complete', (info) => { completed = info; });
  for (let i = 0; i < 60 && !completed; i++) { t.x += -160 / 60; h.step(1 / 60); }
  assert.ok(completed, 'completed');
  const expected = Math.atan2(completed.point.y - 116, completed.point.x - 116);
  assert.ok(Math.abs(h.shot.entity.vx - Math.cos(expected) * 500) < 1, 'vx matches aim');
  assert.ok(Math.abs(h.shot.entity.vy - Math.sin(expected) * 500) < 1, 'vy matches aim');
});

ok('shot entity carries the configured damage (host routes contact)', () => {
  const t = target();
  const ctx = makeContext(attacker(), { pools: pools(), target: t });
  const h = invoke('reticleShot', { duration: 0.6, lockTime: 0.3, speed: 900, ttl: 2, damage: 7 }, ctx);
  let completed = null;
  h.on('complete', (info) => { completed = info; });
  for (let i = 0; i < 120 && !completed; i++) h.step(1 / 60);
  assert.ok(completed, 'completed');
  // The macro's job ends at spawning a correctly-armed bullet; contact routing
  // (overlap → takeDamage) belongs to the host, as with every projectile.
  assert.equal(h.shot.entity.damage, 7, 'damage passed through to the entity');
});

// --- Effect lifecycle (the macro owns the telegraph directly) -----------------

ok('fires ONE target-reticle effect instance and tracks it by moving origin', () => {
  resetEffects();
  const t = target();
  const ctx = makeContext(attacker(), { pools: pools(), target: t, effects: { fireManual } });
  const h = invoke('reticleShot', { duration: 1.0, lockTime: 0.5, speed: 500, ttl: 2, damage: 10 }, ctx);
  assert.ok(h.state._fx, 'effect instance fired at start');
  const before = activeInstances().length;
  // Step through the tracking phase: the SAME instance moves, no stacking.
  for (let i = 0; i < 30; i++) { t.x += -160 / 60; h.step(1 / 60); }
  assert.equal(activeInstances().length, before, 'no new instances while tracking');
  assert.ok(Math.abs(h.state._fx.body.origin.x - (t.x + 16)) < 0.01, 'origin follows the target');
  h.cancel(); resetEffects();
});

ok('lock freezes the effect origin even as the target keeps moving', () => {
  resetEffects();
  const t = target();
  const ctx = makeContext(attacker(), { pools: pools(), target: t, effects: { fireManual } });
  const h = invoke('reticleShot', { duration: 1.0, lockTime: 0.4, speed: 500, ttl: 2, damage: 10 }, ctx);
  for (let i = 0; i < 30; i++) { t.x += -160 / 60; h.step(1 / 60); } // past lockTime 0.4
  const frozenX = h.state._fx.body.origin.x;
  for (let i = 0; i < 30; i++) { t.x += -160 / 60; h.step(1 / 60); }
  assert.equal(h.state._fx.body.origin.x, frozenX, 'origin frozen after lock');
  h.cancel(); resetEffects();
});

ok('cancel tears down the effect instance (no ghost reticle)', () => {
  resetEffects();
  const t = target();
  const ctx = makeContext(attacker(), { pools: pools(), target: t, effects: { fireManual } });
  const h = invoke('reticleShot', { duration: 2.0, lockTime: 1.0, speed: 500, ttl: 2, damage: 10 }, ctx);
  assert.ok(h.state._fx, 'instance live');
  h.cancel();
  assert.equal(activeInstances().length, 0, 'instance removed from the engine');
  resetEffects();
});

ok('child=bomb / child=mine / child=napalm: one shot fires through invokeChild', () => {
  // Full-child contract: every ATTACK_IDS child resolves to a live carrier
  // (straight payload macros keep the plain projectile path; arc children —
  // bomb, mine — fly the arc recipe and settle via the host's terrain pass).
  for (const child of ['bomb', 'mine', 'napalm']) {
    const t = target();
    const ctx = makeContext(attacker(), { pools: pools(), target: t, effects: { fireManual } });
    const h = invoke('reticleShot', { duration: 0.4, lockTime: 0.2, speed: 500, ttl: 2, child }, ctx);
    for (let i = 0; i < 30; i++) h.step(1 / 60);
    assert.ok(h.shot?.entity, `child=${child}: carrier spawned`);
    if (child === 'bomb' || child === 'mine') {
      assert.equal(h.shot.entity._arcRecipe, true, `child=${child}: arc carrier`);
    } else {
      assert.equal(h.shot.entity._arcRecipe, false, `child=${child}: straight carrier`);
    }
  }
});

ok('child=enemy: thrown enemy lands via the land relay', () => {
  const t = target();
  const ctx = makeContext(attacker(), { pools: pools(), target: t, effects: { fireManual }, groundY: 400, bombTerrainStepped: true });
  const h = invoke('reticleShot', { duration: 0.3, lockTime: 0.15, speed: 700, ttl: 2, child: 'enemy' }, ctx);
  const DT = 1 / 60;
  let landed = null;
  for (let i = 0; i < 300 && !landed; i++) {
    ctx.pools.projectilePool.updateAll(DT);
    h.step(DT);
    const shot = h.shot;
    if (!shot) continue;
    // Force-settle the carrier, THEN step the payload macro: its step() reads
    // _bombSettled → settles → lands → emits 'land' (the relay is the subject).
    if (shot.entity && shot.entity._arcRecipe) shot.entity._bombSettled = true;
    if (shot.step) shot.step(DT, []);
    landed = h.enemies?.[0];
  }
  assert.ok(landed, 'landed enemy surfaced on h.enemies');
});

// Regression: verify actual pooled carrier motion, not just the returned angle.
for (const child of ['bomb', 'mine', 'molotov', 'enemy']) {
  for (const [dx, dy] of [[144, 88], [-144, 88], [160, -40], [200, 0], [350, 100]]) {
    ok(`${child}: real carrier crosses locked point (${dx}, ${dy})`, () => {
      const t = { x: 116 + dx - 16, y: 116 + dy - 16, w: 32, h: 32, alive: true };
      const ctx = makeContext(attacker(), { pools: pools(), target: t });
      const h = invoke('reticleShot', { child, duration: 0.2, lockTime: 0.1, speed: 500, ttl: 5 }, ctx);
      h.step(0.1);
      const locked = { ...h.state.locked };
      t.x += 300; // target moves AFTER lock: the shot must ignore this.
      h.step(0.1);
      const e = h.shot.entity;
      let closest = Infinity;
      for (let i = 0; i < 720 && e.alive; i++) {
        closest = Math.min(closest, Math.hypot(e.x + e.w / 2 - locked.x, e.y + e.h / 2 - locked.y));
        ctx.pools.projectilePool.updateAll(1 / 240);
      }
      assert.ok(closest < 5, `missed locked point by ${closest.toFixed(2)}px`);
      h.cancel();
    });
  }
}

for (const child of ['projectile', 'expl_proj', 'shock_proj', 'napalm', 'bomb', 'mine', 'molotov', 'enemy']) {
  ok(`${child}: reticle preserves the child's default terrain policy`, () => {
    const ctx = makeContext(attacker(), { pools: pools(), target: target() });
    const direct = invokeChild(child, {}, ctx);
    const h = invoke('reticleShot', { child, duration: 0.2, lockTime: 0.1 }, ctx);
    h.step(0.2);
    assert.ok(direct.entity && h.shot.entity);
    assert.equal(h.shot.entity.solidBehavior, direct.entity.solidBehavior);
    if (child === 'projectile') assert.equal(h.shot.entity.solidBehavior, 'phase');
    direct.cancel(); h.cancel();
  });
}
for (const [child, payload, expected] of [
  ['projectile', { solidBehavior: 'stop' }, 'stop'],
  ['bomb', { bounce: false }, 'stop'],
  ['mine', { bounce: false }, 'stop'],
  ['molotov', { bounce: true }, 'reflect'],
]) {
  ok(`${child}: explicit payload collision override remains supported`, () => {
    const ctx = makeContext(attacker(), { pools: pools(), target: target() });
    const h = invoke('reticleShot', { child, duration: 0.2, payload: { [child]: payload } }, ctx);
    h.step(0.2);
    assert.equal(h.shot.entity.solidBehavior, expected);
    h.cancel();
  });
}

for (const child of ['bomb', 'mine', 'molotov', 'enemy']) {
  ok(`${child}: keeps native gravity while solving a slow, distant throw`, () => {
    const ctx = makeContext(attacker(), { pools: pools(), target: { x: 700, y: 200, w: 32, h: 32, alive: true } });
    const direct = invokeChild(child, {}, ctx);
    const gravity = direct.entity.gravityValue;
    direct.cancel();
    const h = invoke('reticleShot', { child, duration: 0.2, speed: 100, ttl: 10 }, ctx);
    h.step(0.2);
    const e = h.shot.entity;
    assert.equal(e.gravityValue, gravity, 'gravity must match direct invocation');
    assert.ok(Math.hypot(e.vx, e.vy) > 100, 'raise speed rather than lower gravity');
    const pt = h.state.locked ?? h.state.pt;
    const t = (pt.x - (e.x + e.w / 2)) / e.vx;
    const y = e.y + e.h / 2 + e.vy * t + 0.5 * gravity * t * t;
    assert.ok(Math.abs(y - pt.y) < 0.001, 'launch trajectory must intersect reticle');
    h.cancel();
  });
}

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
