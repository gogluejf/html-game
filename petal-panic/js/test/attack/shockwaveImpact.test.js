// Shockwave Projectile / Bomb — impact-point precision tests.
//
// Regression: the telegraph blink + shockwave ring must center on the CARRIER'S
// DEATH POINT, not wherever its pool slot is recycled to afterwards. Pool slots
// are reused after death; a bridge that re-reads ent.x/y at event time lands
// the warning dot and the ring on the victim (or the next shot's spawn), not
// the true impact. stepProjectile/stepBomb capture {x,y} at the moment of
// death and carry it in the terminal event payload; the macros must use THAT.
// Run: node js/test/attack/shockwaveImpact.test.js

import { strict as assert } from 'node:assert';
import '../../combat/attack/macros/index.js'; // register all macros + primitives
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { stepProjectile } from '../../combat/attack/primitives/projectile.js';
import { Pool, Projectile } from '../../objects/projectile.js';
import { LAYER } from '../../consts.js';
import { activeInstances, resetEffects } from '../../effects/index.js';
import '../../effects/registry.js'; // side effect: registers the types

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const GROUND_Y = 400;
const attacker = () => ({ x: 50, y: GROUND_Y - 48, w: 32, h: 48 });

function ctx(extra = {}) {
  return makeContext(attacker(), {
    world: { targets: [], hero: null },
    effects: null,
    groundY: GROUND_Y,
    ...extra,
  });
}

/** Find the live telegraph-circle effect instance among active effects. */
function telegraphOrigin() {
  for (const inst of activeInstances()) {
    if (inst.type === 'telegraph-circle' && !inst.done) return inst.body.origin;
  }
  return null;
}

/** Find the live shockwave effect instance (the ring visual). */
function ringOrigin() {
  for (const inst of activeInstances()) {
    if (inst.type === 'shockwave' && !inst.done) return inst.body.origin;
  }
  return null;
}

// ---------------------------------------------------------------------------
// shockwaveProjectile
// ---------------------------------------------------------------------------

ok('projectile: telegraph centers on the carrier death point, not the recycled slot', () => {
  resetEffects();
  const pools = { projectilePool: new Pool(Projectile, 4), specialPool: new Pool(Projectile, 2) };
  const c = ctx({ pools });
  const h = invoke('shockwaveProjectile', {
    origin: { x: 100, y: 300 }, direction: 0, speed: 700, ttl: 99,
    damage: 50, radius: 120, duration: 0.5,
    telegraphGap: 0.05, telegraphBlink: 0.2, impactDelay: 0.2,
  }, c);
  const ent = h.entity;
  assert.ok(ent, 'carrier spawned');

  // Fly the carrier to a known spot, then kill it by "hitting" something.
  for (let i = 0; i < 30; i++) ent.update(DT);
  const impactX = ent.x + ent.w / 2, impactY = ent.y + ent.h / 2;
  ent._attackHit = true;
  ent.alive = false;
  stepProjectile(ent, h.inner ?? h);

  // The slot is now free: recycle it with a NEW shot far away (and off the
  // impact's Y line, so an x-only assertion can't pass by accident). A bridge
  // that re-reads ent.x/y would see THIS position instead of the impact point.
  const recycled = pools.projectilePool.spawn(500, 100, 0, true);
  assert.ok(recycled, 'slot recycled');

  // Step the beat clock until the telegraph fires.
  let armed = false;
  for (let i = 0; i < 60 && !armed; i++) { h.step(DT, []); armed = h._shockwaveArmed; }
  assert.ok(armed, 'beat armed');
  const o = telegraphOrigin();
  assert.ok(o, 'telegraph-circle effect is live');
  assert.ok(Math.abs(o.x - impactX) < 0.01, `telegraph x ${o.x} == impact ${impactX}`);
  assert.ok(Math.abs(o.y - impactY) < 0.01, `telegraph y ${o.y} == impact ${impactY}`);
  // The recycled slot sits at (506, 106) — different on BOTH axes from the
  // impact (450, 300), so this catches any re-read of the live entity.
  assert.ok(Math.hypot(o.x - 506, o.y - 106) > 100, 'NOT at the recycled slot position');
  resetEffects();
});

ok('projectile: shockwave ring launches at the captured impact point', () => {
  resetEffects();
  const pools = { projectilePool: new Pool(Projectile, 4), specialPool: new Pool(Projectile, 2) };
  const c = ctx({ pools });
  const h = invoke('shockwaveProjectile', {
    origin: { x: 100, y: 300 }, direction: 0, speed: 700, ttl: 99,
    damage: 50, radius: 120, duration: 0.5,
    telegraphGap: 0.05, telegraphBlink: 0.1, impactDelay: 0.1,
  }, c);
  const ent = h.entity;
  for (let i = 0; i < 30; i++) ent.update(DT);
  const impactX = ent.x + ent.w / 2, impactY = ent.y + ent.h / 2;
  ent._attackHit = true;
  ent.alive = false;
  stepProjectile(ent, h.inner ?? h);
  pools.projectilePool.spawn(500, 100, 0, true); // recycle the slot far away

  // Run past the beat so the ring actually launches.
  let fired = false;
  for (let i = 0; i < 240; i++) {
    h.step(DT, []);
    if (ringOrigin()) { fired = true; break; }
  }
  assert.ok(fired, 'shockwave ring launched');
  const o = ringOrigin();
  assert.ok(Math.abs(o.x - impactX) < 0.01, `ring x ${o.x} == impact ${impactX}`);
  assert.ok(Math.abs(o.y - impactY) < 0.01, `ring y ${o.y} == impact ${impactY}`);
  resetEffects();
});

// ---------------------------------------------------------------------------
// stepProjectile contract: terminal events carry the death point
// ---------------------------------------------------------------------------

ok('stepProjectile: hit/expire payloads carry the death point at emit time', () => {
  const pools = { projectilePool: new Pool(Projectile, 4), specialPool: new Pool(Projectile, 2) };
  const c = ctx({ pools });
  const h = invoke('projectile', { origin: { x: 100, y: 300 }, direction: 0, speed: 700, ttl: 99, damage: 5 }, c);
  const ent = h.entity;
  for (let i = 0; i < 10; i++) ent.update(DT);
  const dx = ent.x + ent.w / 2, dy = ent.y + ent.h / 2;
  let hitPayload = null;
  h.on('hit', (p) => { hitPayload = p; });
  h.on('expire', (p) => { expirePayload = p; });
  ent._attackHit = true;
  ent.alive = false;
  stepProjectile(ent, h);
  assert.ok(hitPayload && Math.abs(hitPayload.x - dx) < 0.01 && Math.abs(hitPayload.y - dy) < 0.01,
    `hit payload at death point (${hitPayload?.x}, ${hitPayload?.y})`);
  // TTL path on a second shot.
  const h2 = invoke('projectile', { origin: { x: 200, y: 300 }, direction: 0, speed: 700, ttl: 99, damage: 5 }, c);
  const e2 = h2.entity;
  let expirePayload = null;
  h2.on('expire', (p) => { expirePayload = p; });
  e2.life = DT; // dies by TTL this frame
  const d2x = e2.x + e2.vx * DT + e2.w / 2, d2y = e2.y + e2.h / 2;
  e2.update(DT);
  stepProjectile(e2, h2);
  assert.ok(expirePayload && Math.abs(expirePayload.x - d2x) < 0.01 && Math.abs(expirePayload.y - d2y) < 0.01,
    `expire payload at death point (${expirePayload?.x}, ${expirePayload?.y})`);
});

console.log(`\nshockwaveImpact: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
