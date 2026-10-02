// Barrel stacking via the SHARED dynamic-solid step (stepDynamicSolid):
// a barrel resolves against static terrain AND every other live barrel, so
// two barrels in the same column stack instead of passing through each other,
// and destroying the lower one drops the upper one to the floor. Hero/enemies
// are NOT surfaces — only statics + live dynamic solids are.
// Run: node js/test/barrel.stack.test.js

import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

import { strict as assert } from 'node:assert';

// --- DOM stub so the update module boots headless ---------------------------
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, addEventListener: noop }),
};
globalThis.window = { addEventListener: () => {} };

const U = await import('../systems/update.js');
const { setState, S } = await import('../core/state.js');
const { makeWoodBarrel } = await import('../objects/object.js');
const { ctx } = await import('../world/context.js');

const DT = 1 / 60;
const hero = U.getHero();
const FLOOR_TOP = U.getSolids()[0].y; // ground surface y

// Keep the real hero far away so it never interferes with the test barrels.
setState(S.PLAY);
hero.x = -99999; hero.y = -99999;
hero.invincibleTimer = 999;

/**
 * Find world columns (x) that have NO static solid above the floor AND no live
 * dynamic solid already occupying them — so any stacking observed is purely
 * the pair under test, not leftover barrels from an earlier case.
 */
const usedColumns = new Set();
function emptyColumns(n) {
  const out = [];
  for (let cx = 500; cx < 3800 && out.length < n; cx += 32) {
    let blocked = false;
    for (const s of U.SOLIDS) if (s.y < FLOOR_TOP && s.x <= cx + 32 && s.x + s.w >= cx) blocked = true;
    for (const b of [...ctx.barrels, ...ctx.woodBarrels, ...ctx.coinBarrels])
      if (b.alive && Math.abs(b.x - cx) < 64) blocked = true;
    if (!blocked && !usedColumns.has(cx)) { usedColumns.add(cx); out.push(cx); }
  }
  if (out.length < n) throw new Error('not enough empty columns');
  return out;
}

/** Register a wood barrel into the live zone exactly like instantiateZone does. */
function addBarrel(x, y) {
  const b = makeWoodBarrel(x, y);
  ctx.woodBarrels.push(b);
  return b;
}

const bottom = (b) => b.worldBox().y + b.worldBox().h;
const top = (b) => b.worldBox().y;

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log(`Floor top=${FLOOR_TOP}, barrel h=${makeWoodBarrel(0, 0).h}`);

ok('two airborne barrels in the same column STACK (upper rests on lower)', () => {
  const [x] = emptyColumns(1);
  const lower = addBarrel(x, FLOOR_TOP - 48);        // resting on floor
  const upper = addBarrel(x, FLOOR_TOP - 48 - 96);   // 2 units up, same column
  for (let i = 0; i < 120; i++) U.update(DT);        // settle
  assert.ok(Math.abs(bottom(upper) - top(lower)) <= 2,
    `upper bottom=${bottom(upper).toFixed(1)} should rest on lower top=${top(lower).toFixed(1)}`);
  assert.equal(upper.vy, 0, 'resting barrel has zero fall velocity');
});

ok('destroying the LOWER barrel drops the UPPER one to the floor', () => {
  const [x] = emptyColumns(1);
  const lower = addBarrel(x, FLOOR_TOP - 48);
  const upper = addBarrel(x, FLOOR_TOP - 48 - 96);
  for (let i = 0; i < 60; i++) U.update(DT);
  assert.ok(Math.abs(bottom(upper) - top(lower)) <= 2, 'precondition: upper stacked on lower');
  lower.hit(9999, null, 'projectile'); // destroy the support
  assert.equal(lower.alive, false, 'lower barrel destroyed');
  for (let i = 0; i < 120; i++) U.update(DT);
  assert.ok(Math.abs(bottom(upper) - FLOOR_TOP) <= 2,
    `upper bottom=${bottom(upper).toFixed(1)} should land on floor=${FLOOR_TOP}`);
  assert.equal(upper.vy, 0, 'landed barrel at rest');
});

ok('single barrel still falls to the floor (no self-resolution artifact)', () => {
  const [x] = emptyColumns(1);
  const b = addBarrel(x, FLOOR_TOP - 48 - 200); // dropped from height
  for (let i = 0; i < 120; i++) U.update(DT);
  assert.ok(Math.abs(bottom(b) - FLOOR_TOP) <= 2,
    `barrel bottom=${bottom(b).toFixed(1)} should rest on floor=${FLOOR_TOP}`);
  assert.equal(b.vy, 0, 'at rest');
});

console.log(`\n${passed} passed`);
