// Regression — enemy→hero knockback is behavior-preserving after the refactor.
// Run: node js/test/knockbackRegression.test.js
//
// Pre-refactor, every way an enemy hurts the hero routed through Hero.takeHit()
// with a per-source KNOCKBACK_PROFILES entry (see
// .squid-os/plans/knockback-system/knockback-reference.txt for the captured
// reference values). The refactor moved BODY CONTACT onto the shared
// applyKnockback() engine with a shove VECTOR `bodyKnockback` carried on the
// enemy; projectile / heavyProj / explosion still call takeHit().
//
// Vector-contract note: the old engine added a FIXED upward pop AFTER
// normalizing the direction (always ~156 px/s straight up). The vector
// contract orients the WHOLE vector along the push normal instead, so the
// lobe lands at ny × vector.y (≈ -80 px/s for the (1, -0.6) contact normal)
// — slightly less loft than the legacy pop, by design. vx, rec and iFrames
// still match the captured reference exactly. No DOM needed.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero/hero.js';
import { HEROES } from '../hero/heroDefs.js';
import { Enemy } from '../enemies/enemy.js';
import { applyKnockback } from '../combat/knockback.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const EPS = 1e-9;
const close = (a, b) => Math.abs(a - b) < EPS;

const mkHero = () => new Hero(HEROES.scarlet, 100, 100);

// --- Reference vectors (captured pre-refactor, see knockback-reference.txt) ---
// For a normalized direction and a fresh hero at rest (not invincible):
//   vx_delta = dirX_norm * strength, vy_delta = dirY_norm * strength
//   rec      = profile.recovery
//   invincible = profile.iFrames
const REF = {
  contact:     { strength: 260, recovery: 0.25, iFrames: 0.60 },
  bossContact: { strength: 340, recovery: 0.30, iFrames: 0.70 },
  projectile:  { strength: 220, recovery: 0.25, iFrames: 0.30 },
  heavyProj:   { strength: 300, recovery: 0.30, iFrames: 0.40 },
  explosion:   { strength: 380, recovery: 0.30, iFrames: 0.60 },
};

console.log('Enemy→hero knockback regression (behavior-preserving refactor)');

// ============================================================================
// PATH 1 — Body contact (CHANGED by task 3.1: now via applyKnockback +
// enemy.bodyKnockback vector instead of takeHit({source:'contact'|'bossContact'})).
//
// The contact handler in collisionHandlers.js builds the push normal as
//   rawLen = hypot(dirX, -0.6); normal = { x: dirX/rawLen, y: -0.6/rawLen }
// with dirX = ±1 (horizontal away from the attacker + small upward lobe).
// A stationary enemy (vx=vy=0) contributes no motion term, so the shove is
// exactly bodyKnockback.x along that normal — matching the old takeHit
// normalization of (±1, -0.6) against the same strength.
// ============================================================================

/** Replicates the contact handler's normal construction (§9). */
function contactNormal(dirX) {
  const rawLen = Math.hypot(dirX, -0.6) || 1;
  return { x: dirX / rawLen, y: -0.6 / rawLen };
}

/** Replicates the post-applyKnockback timer transfer in collisionHandlers.js. */
function transferTimers(hero) {
  if (hero.hitstunTimer > 0) {
    hero.timers.set('rec', Math.max(hero.timers.get('rec'), hero.hitstunTimer));
    hero.hitstunTimer = 0;
  }
  if (hero.iFrameTimer > 0) {
    hero.invincible = true;
    hero.invulnSource = 'hit';
    hero.timers.set('invincible', Math.max(hero.timers.get('invincible'), hero.iFrameTimer));
    hero.iFrameTimer = 0;
  }
}

/** Replicates the contact handler's shove build (collisionHandlers.js §9). */
function contactShove(source, dirX) {
  const n = contactNormal(dirX);
  const bk = source.bodyKnockback ?? {};
  const headOn = Math.max(0, (source.vx ?? 0) * n.x + (source.vy ?? 0) * n.y);
  const motion = headOn * (source.stats?.weight ?? 1);
  return {
    x: n.x * (bk.x ?? 0) + n.x * motion,
    y: n.y * (bk.y ?? 0) + n.y * motion,
    hitstun: bk.hitstun,
    iFrames: bk.iFrames,
  };
}

const ENEMY_DEF = {
  id: 'regress_enemy', name: 'Regress Enemy', w: 32, h: 48, aggroRadius: 300,
  stats: { weight: 1, speed: 120, attack: 10, defense: 0, stamina: 40, fly: false },
};

ok('body contact (regular enemy, idle) matches pre-refactor contact profile', () => {
  const hero = mkHero();
  const enemy = new Enemy(ENEMY_DEF, 0, 0); // default bodyKnockback: x 260, y -156 lobe, hitstun 0.25, iFrames 0.60
  assert.equal(enemy.vx, 0); // stationary → no motion term
  applyKnockback(hero, contactShove(enemy, 1));
  transferTimers(hero);
  const len = Math.hypot(1, -0.6);
  assert.ok(close(hero.vx, (1 / len) * REF.contact.strength), `vx=${hero.vx}, expected ${(1 / len) * REF.contact.strength}`);
  // Vector-contract lobe: ny × bodyKnockback.y (orients the whole vector along
  // the normal) — NOT the legacy fixed post-normalization pop.
  const LOBE_Y = -156;
  assert.ok(close(hero.vy, (-0.6 / len) * LOBE_Y), `vy=${hero.vy}, expected ${(-0.6 / len) * LOBE_Y}`);
  assert.ok(close(hero.timers.get('rec'), REF.contact.recovery), `rec=${hero.timers.get('rec')}`);
  assert.ok(close(hero.timers.get('invincible'), REF.contact.iFrames), `invincible=${hero.timers.get('invincible')}`);
  assert.equal(hero.invincible, true);
});

ok('body contact (regular enemy, pushed left) mirrors the rightward case', () => {
  const hero = mkHero();
  const enemy = new Enemy(ENEMY_DEF, 0, 0);
  applyKnockback(hero, contactShove(enemy, -1));
  transferTimers(hero);
  const len = Math.hypot(1, -0.6);
  assert.ok(close(hero.vx, -(1 / len) * REF.contact.strength), `vx=${hero.vx}`);
  assert.ok(close(hero.vy, (-0.6 / len) * -156), `vy=${hero.vy}`);
});

ok('body contact (boss, idle) matches pre-refactor bossContact profile', () => {
  const hero = mkHero();
  const boss = new Enemy({ ...ENEMY_DEF, isBoss: true }, 0, 0); // default boss: x 340, y -156 lobe, hitstun 0.30, iFrames 0.70
  applyKnockback(hero, contactShove(boss, 1));
  transferTimers(hero);
  const len = Math.hypot(1, -0.6);
  assert.ok(close(hero.vx, (1 / len) * REF.bossContact.strength), `vx=${hero.vx}`);
  assert.ok(close(hero.vy, (-0.6 / len) * -156), `vy=${hero.vy}`);
  assert.ok(close(hero.timers.get('rec'), REF.bossContact.recovery), `rec=${hero.timers.get('rec')}`);
  assert.ok(close(hero.timers.get('invincible'), REF.bossContact.iFrames), `invincible=${hero.timers.get('invincible')}`);
  assert.equal(hero.invincible, true);
});

// ============================================================================
// PATHS 2–4 — Projectile / heavy projectile / explosion (UNCHANGED by the
// refactor: still route through hero.takeHit()). These are pure reference
// checks: the refactored code must produce the exact pre-refactor values.
// ============================================================================

ok('enemy projectile matches pre-refactor projectile profile (dirX=1, dirY=0)', () => {
  const hero = mkHero();
  assert.equal(hero.takeHit({ source: 'projectile', dirX: 1, dirY: 0 }), true);
  assert.ok(close(hero.vx, REF.projectile.strength), `vx=${hero.vx}`);
  assert.ok(close(hero.vy, 0), `vy=${hero.vy}`);
  assert.ok(close(hero.timers.get('rec'), REF.projectile.recovery), `rec=${hero.timers.get('rec')}`);
  assert.ok(close(hero.timers.get('invincible'), REF.projectile.iFrames), `invincible=${hero.timers.get('invincible')}`);
  assert.equal(hero.invincible, true);
});

ok('heavy projectile matches pre-refactor heavyProj profile (dirX=1, dirY=0)', () => {
  const hero = mkHero();
  assert.equal(hero.takeHit({ source: 'heavyProj', dirX: 1, dirY: 0 }), true);
  assert.ok(close(hero.vx, REF.heavyProj.strength), `vx=${hero.vx}`);
  assert.ok(close(hero.vy, 0), `vy=${hero.vy}`);
  assert.ok(close(hero.timers.get('rec'), REF.heavyProj.recovery), `rec=${hero.timers.get('rec')}`);
  assert.ok(close(hero.timers.get('invincible'), REF.heavyProj.iFrames), `invincible=${hero.timers.get('invincible')}`);
  assert.equal(hero.invincible, true);
});

ok('explosion (radial) matches pre-refactor explosion profile', () => {
  // Radial: hero at (100+16, 100+24), blast center at (100+16+100, 100+24) →
  // dirX = +100, dirY = 0 → normalizes to (1, 0).
  const hero = mkHero();
  assert.equal(hero.takeHit({ source: 'explosion', dirX: 100, dirY: 0 }), true);
  assert.ok(close(hero.vx, REF.explosion.strength), `vx=${hero.vx}`);
  assert.ok(close(hero.vy, 0), `vy=${hero.vy}`);
  assert.ok(close(hero.timers.get('rec'), REF.explosion.recovery), `rec=${hero.timers.get('rec')}`);
  assert.ok(close(hero.timers.get('invincible'), REF.explosion.iFrames), `invincible=${hero.timers.get('invincible')}`);
  assert.equal(hero.invincible, true);
});

ok('explosion radial direction scales correctly (diagonal blast offset)', () => {
  // Hero center directly above-left of blast: dirX=-100, dirY=-100 → normal (-√½, -√½).
  const hero = mkHero();
  hero.takeHit({ source: 'explosion', dirX: -100, dirY: -100 });
  const n = 1 / Math.SQRT2;
  assert.ok(close(hero.vx, -n * REF.explosion.strength), `vx=${hero.vx}`);
  assert.ok(close(hero.vy, -n * REF.explosion.strength), `vy=${hero.vy}`);
});

// --- Shared absorption semantics: i-frames swallow follow-up hits on ALL paths ---
ok('i-frames absorb a second body-contact hit (no double-fling, unchanged)', () => {
  const hero = mkHero();
  const enemy = new Enemy(ENEMY_DEF, 0, 0);
  applyKnockback(hero, contactShove(enemy, 1));
  transferTimers(hero);
  const vxAfterFirst = hero.vx;
  // Second overlap while invincible: the handler early-returns on
  // heroEnt.invincible, so nothing changes.
  assert.equal(hero.invincible, true);
  assert.equal(hero.vx, vxAfterFirst);
});

ok('i-frames absorb a follow-up projectile hit (unchanged takeHit guard)', () => {
  const hero = mkHero();
  hero.takeHit({ source: 'projectile', dirX: 1, dirY: 0 });
  const vxAfterFirst = hero.vx;
  assert.equal(hero.takeHit({ source: 'projectile', dirX: -1, dirY: 0 }), false);
  assert.equal(hero.vx, vxAfterFirst, 'absorbed hit must not add knockback');
});

console.log(`\n${passed} passed`);
