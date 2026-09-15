// Hero anim state selection (render.heroAnimName) — the fix for the
// "idle flicker at jump apex": anim must stay jump/djump for the WHOLE
// flight once a jump is initiated, not depend on vy.
// Run: node js/test/heroAnim.test.js

import { strict as assert } from 'node:assert';

// --- Minimal DOM stub (render.js → update.js builds placeholder frames at
// import time). Same pattern as lives.test.js.
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: (tag) => ({
    width: 0, height: 0,
    getContext: () => ctxStub,
    addEventListener: noop,
  }),
};
globalThis.window = { addEventListener: noop };

const { heroAnimName } = await import('../systems/render.js');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
// Plain state objects — heroAnimName is a pure reader of hero fields.
const hero = (o = {}) => ({
  dying: false, crouching: false, meleeFrame: 0,
  jumpsUsed: 0, vx: 0, vy: 0,
  ...o,
});

console.log('Ground states');
ok('standing still → idle', () => assert.equal(heroAnimName(hero()), 'idle'));
ok('running on ground → run', () => assert.equal(heroAnimName(hero({ vx: 250 })), 'run'));
ok('crouch wins over everything else', () =>
  assert.equal(heroAnimName(hero({ crouching: true, vx: 250, jumpsUsed: 1 })), 'crouch'));
ok('melee wins over movement', () =>
  assert.equal(heroAnimName(hero({ meleeFrame: 3, vx: 250 })), 'melee'));
ok('dying wins over everything', () =>
  assert.equal(heroAnimName(hero({ dying: true, crouching: true })), 'dead'));

console.log('Flight states (the apex-flicker fix)');
ok('launch (vy=-500, jumpsUsed=1) → jump', () =>
  assert.equal(heroAnimName(hero({ jumpsUsed: 1, vy: -500 })), 'jump'));
ok('apex (vy≈0, jumpsUsed=1) → jump, NOT idle', () => {
  assert.equal(heroAnimName(hero({ jumpsUsed: 1, vy: 0 })), 'jump');
  assert.equal(heroAnimName(hero({ jumpsUsed: 1, vy: -5, vx: 0 })), 'jump');
});
ok('descent (vy=+300, jumpsUsed=1) → jump', () =>
  assert.equal(heroAnimName(hero({ jumpsUsed: 1, vy: 300 })), 'jump'));
ok('double jump, whole remaining flight → djump (apex included)', () => {
  assert.equal(heroAnimName(hero({ jumpsUsed: 2, vy: -425 })), 'djump');
  assert.equal(heroAnimName(hero({ jumpsUsed: 2, vy: 0 })), 'djump');
  assert.equal(heroAnimName(hero({ jumpsUsed: 2, vy: 400 })), 'djump');
});
ok('walking off a ledge (no jump initiated) → NOT jump', () => {
  assert.equal(heroAnimName(hero({ vy: 100 })), 'idle');      // airborne, falling
  assert.equal(heroAnimName(hero({ vy: 100, vx: 250 })), 'run');
});

console.log(`\n${passed} passed`);
