// Star power (mario star) — invincibility split + contact kill.
// Run: node petal-panic/js/test/starPower.test.js
// No DOM needed: exercises the real Hero, Enemy, and the production
// collision-handler starPowerKill() path.

import { strict as assert } from 'node:assert';
import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();
const ctx2d = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => ctx2d }), addEventListener: () => {} };
globalThis.window = { addEventListener: () => {}, innerWidth: 1280, innerHeight: 720, __selectedHero: 'scarlet' };

const { Hero } = await import('../hero/hero.js');
const { HEROES } = await import('../hero/heroDefs.js');
const { Enemy } = await import('../enemies/enemy.js');
const { hitstopActive, consumeHitstop, resetHitstop } = await import('../core/hitstop.js');
const { POWERUP_DEFS } = await import('../objects/powerup.js');
const { starPowerKill } = await import('../combat/collisionHandlers.js');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const mkHero = () => new Hero(HEROES.scarlet, 100, 100);
const ENEMY_DEF = {
  id: 'star_test', name: 'Star Test', w: 32, h: 48, aggroRadius: 300,
  stats: { weight: 1, speed: 120, attack: 10, defense: 0, stamina: 40, fly: false },
};
const mkEnemy = (x = 0, y = 0) => new Enemy(ENEMY_DEF, x, y);

console.log('Invincible vs intangible split');

ok('hit i-frames grant invincible (NOT intangible)', () => {
  const h = mkHero();
  h.takeHit({ source: 'contact', dirX: 1, dirY: 0 });
  assert.equal(h.invincible, true);
  assert.equal(h.intangible, false, 'i-frames must not phase through solids');
});

ok('respawn grace grants invincible (NOT intangible)', () => {
  const h = mkHero();
  h.dying = true;
  h.energy = 0;
  h.respawn();
  assert.equal(h.invincible, true);
  assert.equal(h.intangible, false);
});

ok('supermove dash grants invincible (NOT intangible — stays a body in the world)', () => {
  const h = mkHero();
  h.facing = 1;
  h.supermoveMeter = h.SUPERMOVE_MAX; // full meter so the trigger fires
  const inp = { left: false, right: false, up: false, down: false, jump: false, shoot: false, special: false, melee: false, super: true };
  h.update(DT, inp);
  assert.ok(h.supermoveActive, 'dash should be active');
  assert.equal(h.invincible, true, 'dash is untouchable');
  assert.equal(h.intangible, false, 'dash does NOT leave the collision system (immunity.md)');
});

ok('star powerup grants invincible + starPower (NOT intangible)', () => {
  const h = mkHero();
  POWERUP_DEFS.invincibility.apply(h);
  assert.equal(h.invincible, true);
  assert.equal(h.starPower, true);
  assert.equal(h.intangible, false, 'star does not phase through solids');
  assert.equal(h.invulnSource, 'powerup');
});

ok('starPower clears when the invincible window expires', () => {
  const h = mkHero();
  POWERUP_DEFS.invincibility.apply(h);
  // syncImmunityStates() is the single expiry site (immunity.md) — in the full
  // game loop it runs every frame after timers.tick(); drive it explicitly here.
  for (let i = 0; i < Math.ceil(7 / DT) + 2; i++) { h.timers.tick(DT); h.syncImmunityStates(); }
  assert.equal(h.invincible, false);
  assert.equal(h.starPower, false, 'star ends with the window');
});

console.log('Star-power contact kill');

ok('starPowerKill one-shots a healthy enemy through its death pipeline', () => {
  resetHitstop();
  const h = mkHero();
  const e = mkEnemy(140, 100);
  const hpBefore = e.hp;
  starPowerKill(h, e);
  assert.equal(e.hp, 0, `hp drained to 0 (was ${hpBefore})`);
  assert.equal(e.aiState, 'dead', 'death pipeline entered');
  assert.equal(e.alive, true, 'corpse still alive during shrink/fade anim');
  assert.ok(hitstopActive(), 'hit-stop armed on the kill frame');
  resetHitstop();
});

ok('starPowerKill launches the victim away from the hero', () => {
  resetHitstop();
  const h = mkHero(); // hero at x=100
  const e = mkEnemy(140, 100); // enemy to the RIGHT of the hero
  starPowerKill(h, e);
  assert.ok(e.vx > 0, `enemy launched rightward (vx=${e.vx})`);
  assert.ok(e.vy < 0, `enemy popped upward (vy=${e.vy})`);
  resetHitstop();
});

ok('starPowerKill is a no-op on an already-dead enemy', () => {
  resetHitstop();
  const h = mkHero();
  const e = mkEnemy(140, 100);
  e.aiState = 'dead';
  e.alive = false;
  starPowerKill(h, e);
  assert.equal(hitstopActive(), false, 'no juice on a dead target');
  resetHitstop();
});

ok('two overlapping kills max-merge the hit-stop (never stack)', () => {
  resetHitstop();
  const h = mkHero();
  const e1 = mkEnemy(140, 100);
  const e2 = mkEnemy(180, 100);
  starPowerKill(h, e1);
  starPowerKill(h, e2);
  let frozen = 0;
  while (consumeHitstop()) frozen++;
  assert.equal(frozen, 5, `max-merged window is one default (5), got ${frozen}`);
});

console.log(`\n${passed} passed`);
