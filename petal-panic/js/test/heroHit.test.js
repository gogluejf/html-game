// Hero hit reaction — contextual knockback + hit-stun + i-frames (design §24-§27).
// Run: node js/test/heroHit.test.js
// Exercises takeHit() with the per-source KNOCKBACK_PROFILES table, i-frame
// absorption, hit-stun input lock, and clean control resumption. No DOM needed.

import { strict as assert } from 'node:assert';
import { Hero, KNOCKBACK_PROFILES } from '../hero.js';
import { HEROES } from '../heroDefs.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const mk = () => new Hero(HEROES.scarlet, 100, 100);
const DT = 1 / 60;

console.log('Hero hit reaction (contextual knockback, §25)');

ok('takeHit applies knockback velocity in the impact direction', () => {
  const h = mk();
  h.takeHit({ source: 'contact', dirX: -1, dirY: 0 });
  assert.ok(h.vx < 0); // pushed left
});

ok('each damage source produces its own distinct knockback magnitude (§25)', () => {
  const mags = {};
  for (const key of ['contact', 'bossContact', 'projectile', 'heavyProj', 'explosion']) {
    const h = mk();
    h.takeHit({ source: key, dirX: 1, dirY: 0 });
    mags[key] = Math.abs(h.vx);
  }
  // Every profile resolves to a real, positive magnitude...
  for (const key of Object.keys(mags)) assert.ok(mags[key] > 0, `${key} has no knockback`);
  // ...and each documented source is DISTINCT from the others.
  const values = [...new Set(Object.values(mags))];
  assert.equal(values.length, Object.keys(mags).length,
    `expected all sources distinct, got ${JSON.stringify(mags)}`);
  // Magnitudes come from the shared table, not call-site numbers.
  assert.equal(mags.contact, KNOCKBACK_PROFILES.contact.strength);
  assert.equal(mags.explosion, KNOCKBACK_PROFILES.explosion.strength);
});

ok('damage and knockback are independent properties (§25)', () => {
  // Equal-damage attacks can carry different knockback: the profiles themselves
  // prove the table decouples the two (same table, different strengths), and
  // takeHit never reads any damage value.
  assert.notEqual(KNOCKBACK_PROFILES.contact.strength, KNOCKBACK_PROFILES.projectile.strength);
  assert.notEqual(KNOCKBACK_PROFILES.projectile.iFrames, KNOCKBACK_PROFILES.explosion.iFrames);
  const h = mk();
  const before = h.energy;
  h.takeHit({ source: 'explosion', dirX: 1, dirY: 0 });
  assert.equal(h.energy, before, 'takeHit must not touch damage/energy');
});

ok('takeHit sets rec + intangible timers from the profile (§24/§28)', () => {
  const h = mk();
  h.takeHit({ source: 'contact', dirX: 1, dirY: 0 });
  assert.ok(Math.abs(h.timers.get('rec') - KNOCKBACK_PROFILES.contact.recovery) < 1e-9);
  assert.ok(Math.abs(h.timers.get('intangible') - KNOCKBACK_PROFILES.contact.iFrames) < 1e-9);
  assert.equal(h.intangible, true);
});

ok('second hit during i-frames is absorbed (no double-fling)', () => {
  const h = mk();
  assert.equal(h.takeHit({ source: 'contact', dirX: 1, dirY: 0 }), true);
  const vxAfterFirst = h.vx;
  assert.equal(h.takeHit({ source: 'contact', dirX: -1, dirY: 0 }), false);
  assert.equal(h.vx, vxAfterFirst, 'absorbed hit must not add knockback');
});

ok('hitStunned is true right after a hit, false after recovery ticks out', () => {
  const h = mk();
  h.takeHit({ source: 'contact', dirX: 1, dirY: 0 });
  assert.equal(h.hitStunned, true);
  h.update(0.3, {}, null); // tick past the 0.25s recovery
  assert.equal(h.hitStunned, false);
});

ok('knockback decays over the hit-stun window (§26)', () => {
  const h = mk();
  h.grounded = true;
  h.takeHit({ source: 'contact', dirX: 1, dirY: 0 });
  const v0 = h.vx;
  assert.ok(v0 > 0);
  h.update(DT, {}, null);
  assert.ok(h.vx < v0, `vx should decay during stun (${v0} → ${h.vx})`);
});

ok('normal control resumes cleanly after hit-stun, no residual lock (§26)', () => {
  const h = mk();
  h.grounded = true;
  h.takeHit({ source: 'contact', dirX: 1, dirY: 0 });
  h.update(0.3, {}, null); // let the recovery window fully elapse
  h.update(DT, { left: true }, null);
  // Grounded arcade-immediate: full run speed toward the held direction.
  assert.ok(Math.abs(h.vx - (-h.stats.speed)) < 1e-9,
    `control should resume at full run speed, got vx=${h.vx}`);
  assert.equal(h.crouching, false);
  assert.equal(h.sliding, false);
});

ok('input is ignored while stunned (vx not set by moveDir)', () => {
  const h = mk();
  h.grounded = true;
  h.takeHit({ source: 'contact', dirX: 0, dirY: 0 });
  h.update(DT, { left: true }, null);
  // While stunned, held-left must NOT drive vx to full run speed.
  assert.ok(Math.abs(h.vx) < h.stats.speed);
});

ok('i-frame flag clears exactly when the intangible timer expires (§27)', () => {
  const h = mk();
  h.takeHit({ source: 'projectile', dirX: 1, dirY: 0 }); // 0.30s i-frames
  assert.equal(h.intangible, true);
  // Tick just short of expiry: still intangible.
  h.update(KNOCKBACK_PROFILES.projectile.iFrames - DT, {}, null);
  assert.equal(h.intangible, true);
  // Cross the expiry frame: flag drops on the same frame the timer hits zero.
  h.update(DT * 2, {}, null);
  assert.equal(h.intangible, false);
  assert.equal(h.timers.get('intangible'), 0);
});

ok('dying hero takes no hit', () => {
  const h = mk();
  h.die();
  assert.equal(h.takeHit({ source: 'contact', dirX: 1, dirY: 0 }), false);
});

console.log(`\n${passed} passed`);
