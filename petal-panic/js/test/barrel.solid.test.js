// Barrels as dynamic SOLIDs through the REAL update pipeline (Task 4.1 fix):
// the hero is blocked by barrels like platforms, can stand on them (grounded),
// and a destroyed barrel stops blocking.
// Run: node js/test/barrel.solid.test.js

import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

import { strict as assert } from 'node:assert';

// --- DOM stub + event-listener capture so we can inject key input ----------
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
const listeners = {};
globalThis.document = {
  createElement: (tag) => ({
    width: 0, height: 0,
    getContext: () => ctxStub,
    addEventListener: noop,
  }),
};
globalThis.window = {
  addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
};
const press = (code) => listeners.keydown.forEach(fn => fn({ code, preventDefault: noop }));
const release = (code) => listeners.keyup.forEach(fn => fn({ code, preventDefault: noop }));

const U = await import('../systems/update.js');
const { S, setState } = await import('../core/state.js');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const hero = U.getHero();
const solids = U.getSolids();
const FLOOR_TOP = solids[0].y;
const DT = 1 / 60;

// Pick a live barrel in the mid-level (away from the boss arena).
const allBarrels = U.getBarrels();
const barrel = allBarrels.find(b => b.alive && b.x > 1000 && b.x < 5000)
  ?? allBarrels.find(b => b.alive);
assert.ok(barrel, 'need a live barrel in the level');

// Fresh, protected hero placed exactly where each case wants it.
function placeHero(x, y) {
  setState(S.PLAY);
  hero.x = x; hero.y = y;
  hero.vx = 0; hero.vy = 0;
  hero.grounded = false;
  hero.jumpsUsed = 0;
  hero.dying = false;
  hero.alive = true;
  hero.energy = hero.maxEnergy;
  hero.invincibleTimer = 999;
  for (let i = 0; i < 10; i++) U.update(DT); // settle (gravity + resolve)
}
const heroBottom = () => hero.y + hero.h;

console.log(`Barrel at x=${barrel.x}, top=${barrel.y}`);

ok('hero cannot pass through a barrel (blocked like a platform)', () => {
  // Place hero at the same elevation as the barrel (it may be on a block/platform).
  const heroY = barrel.y - hero.h;
  placeHero(barrel.x - hero.w - 40, heroY);
  press('KeyD'); // hold right
  const startX = hero.worldBox().x;
  const initialGap = barrel.worldBox().x - (startX + hero.worldBox().w);
  assert.ok(initialGap > 0, 'hero starts separated from the barrel after settling');
  for (let i = 0; i < 90; i++) U.update(DT);
  release('KeyD');
  const heroBox = hero.worldBox();
  const barrelBox = barrel.worldBox();
  const rightEdge = heroBox.x + heroBox.w;
  assert.ok(rightEdge <= barrelBox.x + 1,
    `hero right=${rightEdge.toFixed(1)} must not pass barrel left=${barrelBox.x}`);
  // placeHero runs real simulation frames to settle. Measure the gap AFTER
  // those frames instead of assuming its requested 40px gap is unchanged.
  assert.ok(Math.abs((heroBox.x - startX) - initialGap) <= 1,
    `hero must close the ${initialGap.toFixed(1)}px settled gap and stop at the barrel face; moved ${(heroBox.x - startX).toFixed(1)}px`);
  assert.ok(Math.abs(rightEdge - barrelBox.x) <= 1, 'hero is pinned at the barrel collision face');
});

ok('hero can stand on top of a barrel and is grounded', () => {
  placeHero(barrel.x, barrel.y - hero.h - 30); // hovering above the barrel
  assert.ok(heroBottom() <= barrel.y, 'starts above the barrel top');
  for (let i = 0; i < 60; i++) U.update(DT); // fall onto it
  assert.ok(Math.abs(heroBottom() - barrel.y) <= 2,
    `hero bottom=${heroBottom().toFixed(1)} should rest on barrel top=${barrel.y}`);
  assert.ok(hero.grounded, 'standing on a barrel should count as grounded');
});

ok('hero can jump off a barrel (grounded reset works)', () => {
  placeHero(barrel.x, barrel.y - hero.h - 30);
  for (let i = 0; i < 60; i++) U.update(DT); // land on it
  press('Space');
  U.update(DT);
  release('Space');
  assert.ok(hero.vy < 0, `jumping from a barrel should launch upward (vy=${hero.vy.toFixed(1)})`);
});

ok('destroyed barrel stops blocking (hero walks through its old spot)', () => {
  barrel.hit(9999, null, 'projectile'); // kill it
  assert.equal(barrel.alive, false, 'barrel should be destroyed');
  placeHero(barrel.x - hero.w - 4, FLOOR_TOP - hero.h);
  press('KeyD');
  for (let i = 0; i < 120; i++) U.update(DT);
  release('KeyD');
  assert.ok(hero.x > barrel.x,
    `hero should have passed through the destroyed barrel's spot (x=${hero.x.toFixed(1)} > ${barrel.x})`);
});

console.log(`\n${passed} passed`);
