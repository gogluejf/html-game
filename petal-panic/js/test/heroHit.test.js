// Hero hit reaction — knockback + hit-stun + invincibility (design §12).
// Run: node js/test/heroHit.test.js
// Exercises takeHit() + i-frame absorption + hit-stun input lock. No DOM needed.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const mk = () => new Hero(HEROES.scarlet, 100, 100);

console.log('Hero hit reaction');

ok('takeHit applies knockback velocity', () => {
  const h = mk();
  h.takeHit({ dirX: -1, dirY: 0, strength: 260 });
  assert.ok(h.vx < 0); // pushed left
});

ok('takeHit sets recovery + invincible timers', () => {
  const h = mk();
  h.takeHit({ dirX: 1, dirY: 0, strength: 260, recovery: 0.25, invincible: 0.6 });
  assert.ok(Math.abs(h.timers.get('rec') - 0.25) < 1e-9);
  assert.ok(Math.abs(h.timers.get('inv') - 0.6) < 1e-9);
});

ok('second hit during i-frames is absorbed (no double-fling)', () => {
  const h = mk();
  assert.equal(h.takeHit({ dirX: 1, dirY: 0, strength: 260 }), true);
  assert.equal(h.takeHit({ dirX: -1, dirY: 0, strength: 260 }), false);
});

ok('hitStunned is true right after a hit, false after recovery ticks out', () => {
  const h = mk();
  h.takeHit({ dirX: 1, dirY: 0, strength: 260, recovery: 0.25 });
  assert.equal(h.hitStunned, true);
  h.update(0.3, {}, null); // tick past the 0.25s recovery
  assert.equal(h.hitStunned, false);
});

ok('input is ignored while stunned (vx not set by moveDir)', () => {
  const h = mk();
  h.grounded = true;
  h.takeHit({ dirX: 0, dirY: 0, strength: 0, recovery: 0.25 });
  h.update(1 / 60, { left: true }, null);
  // While stunned, held-left must NOT drive vx to full run speed.
  assert.ok(Math.abs(h.vx) < h.stats.speed);
});

ok('dying hero takes no hit', () => {
  const h = mk();
  h.die();
  assert.equal(h.takeHit({ dirX: 1, dirY: 0, strength: 260 }), false);
});

console.log(`\n${passed} passed`);
