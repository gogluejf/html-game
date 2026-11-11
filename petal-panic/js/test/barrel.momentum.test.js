// Barrel-on-barrel momentum transfer (issue #1): when a MOVING dynamic solid
// overlaps another live dynamic solid, the mover shoves the other along the
// overlap axis and loses part of its own velocity — real physics (momentum is
// transferred, not destroyed). Two reported symptoms this fixes:
//   1. A kicked barrel striking a resting barrel used to stop dead against it;
//      now it transfers a portion of its energy and keeps rolling.
//   2. Kicking a barrel into two adjacent barrels used to shove nothing; now
//      each struck barrel receives an impulse.
// Run: node js/test/barrel.momentum.test.js

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
const B = makeWoodBarrel(0, 0);
const W = B.w, H = B.h;

setState(S.PLAY);
hero.x = -99999; hero.y = -99999;
hero.invincibleTimer = 999;

/** Register wood barrels into the live zone exactly like instantiateZone does. */
function addBarrels(...specs) {
  return specs.map(([x, y]) => {
    const b = makeWoodBarrel(x, y);
    ctx.woodBarrels.push(b);
    return b;
  });
}

const bottom = (b) => b.worldBox().y + b.worldBox().h;

// Find world columns with NO static solid above the floor and no live dynamic
// solid already there — so observed motion is purely the pair under test.
const usedColumns = new Set();
function emptyColumns(n) {
  const out = [];
  for (let cx = 500; cx < 3800 && out.length < n; cx += W) {
    let blocked = false;
    for (const s of U.SOLIDS) if (s.y < FLOOR_TOP && s.x <= cx + W && s.x + s.w >= cx) blocked = true;
    for (const b of [...ctx.barrels, ...ctx.woodBarrels, ...ctx.coinBarrels])
      if (b.alive && Math.abs(b.x - cx) < 96) blocked = true;
    if (!blocked && !usedColumns.has(cx)) { usedColumns.add(cx); out.push(cx); }
  }
  if (out.length < n) throw new Error('not enough empty columns');
  return out;
}

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log(`Floor top=${FLOOR_TOP}, barrel ${W}×${H}`);

ok('kicked barrel hitting a RESTING barrel transfers momentum (does not stop dead)', () => {
  const [x] = emptyColumns(1);
  const [a, b] = addBarrels([x, FLOOR_TOP - H], [x + W + 44, FLOOR_TOP - H]); // gap 44px
  for (let i = 0; i < 30; i++) U.update(DT); // settle both at rest
  const ax0 = a.x, bx0 = b.x;
  a.vx = 400; // kick A toward B (contact in ~0.1s)
  for (let i = 0; i < 120; i++) U.update(DT);
  assert.ok(b.x > bx0 + 4, `struck barrel moved: Δ=${(b.x - bx0).toFixed(1)}px`);
  assert.ok(a.x > ax0 + 4, `kicker still advanced: Δ=${(a.x - ax0).toFixed(1)}px`);
  // Momentum was TRANSFERRED, not destroyed: the kicker slowed vs its launch
  // speed (it gave up speed to the peer), while the peer gained speed.
  assert.ok(Math.abs(a.vx) < 400, `kicker lost speed (vx=${a.vx.toFixed(0)})`);
  assert.ok(b.vx > 0 || b.x > bx0 + 20, `peer carries the shove (vx=${b.vx.toFixed(0)}, Δ=${(b.x - bx0).toFixed(1)})`);
});

ok('kicking a barrel into TWO adjacent barrels moves BOTH', () => {
  const [x] = emptyColumns(1);
  // Touching (2px), not 44px apart: a real wood-on-wood thud gives the first
  // struck barrel only ~2/3 of the closing speed, which slides a short
  // distance — it cannot bridge a whole barrel-width of empty floor.
  const [a, b, c] = addBarrels([x, FLOOR_TOP - H], [x + W + 2, FLOOR_TOP - H], [x + 2 * (W + 2), FLOOR_TOP - H]);
  for (let i = 0; i < 30; i++) U.update(DT);
  const ax0 = a.x, bx0 = b.x, cx0 = c.x;
  a.vx = 400;
  for (let i = 0; i < 180; i++) U.update(DT);
  // The MIDDLE barrel is a pusher: it bridges the 2px gap and stops (resolve
  // zeroes it into the next barrel). The FAR barrel is what carries the shove.
  assert.ok(b.x > bx0, `first struck barrel bridged the gap: Δ=${(b.x - bx0).toFixed(1)}px`);
  assert.ok(c.x > cx0 + 4, `far barrel carries the shove: Δ=${(c.x - cx0).toFixed(1)}px`);
});

ok('resting barrels do NOT spontaneously shove each other (no transfer at rest)', () => {
  const [x] = emptyColumns(1);
  const [a, b] = addBarrels([x, FLOOR_TOP - H], [x + W, FLOOR_TOP - H]); // touching
  for (let i = 0; i < 60; i++) U.update(DT);
  assert.equal(a.vx, 0, 'left barrel at rest stays at rest');
  assert.equal(b.vx, 0, 'right barrel at rest stays at rest');
  assert.ok(Math.abs(bottom(a) - FLOOR_TOP) <= 2 && Math.abs(bottom(b) - FLOOR_TOP) <= 2,
    'both still on the floor');
});

ok('fast-falling barrel onto a resting one settles without NaN/instability', () => {
  const [x] = emptyColumns(1);
  const lower = addBarrels([x, FLOOR_TOP - H])[0];
  const upper = makeWoodBarrel(x, FLOOR_TOP - H - 3 * H);
  ctx.woodBarrels.push(upper);
  upper.vy = 500;
  for (let i = 0; i < 120; i++) U.update(DT);
  assert.ok(Number.isFinite(lower.x) && Number.isFinite(lower.y), 'lower barrel position sane');
  assert.ok(Number.isFinite(upper.x) && Number.isFinite(upper.y), 'upper barrel position sane');
  assert.ok(Math.abs(bottom(lower) - FLOOR_TOP) <= 2, 'lower still on floor');
  assert.ok(Math.abs(bottom(upper) - lower.worldBox().y) <= 2, 'upper rests on lower');
});

ok('barrel striking a WALL bounces back with energy absorbed (not stop dead)', () => {
  // Find a static solid whose left face is exposed (open floor to its left).
  let wall = null, wx = 0;
  for (const s of U.SOLIDS) {
    if (s.y >= FLOOR_TOP - 4) continue; // skip the floor itself
    const probeX = s.x - W - 8;
    let blocked = false;
    for (const o of U.SOLIDS) if (o !== s && o.y < FLOOR_TOP && o.x <= probeX + W && o.x + o.w >= probeX) blocked = true;
    if (!blocked) { wall = s; wx = probeX; break; }
  }
  assert.ok(wall, 'found an exposed wall face to test against');
  const b = makeWoodBarrel(wx, FLOOR_TOP - H);
  ctx.woodBarrels.push(b);
  for (let i = 0; i < 30; i++) U.update(DT); // settle at rest
  const x0 = b.x;
  b.vx = 500; // kick into the wall
  let bounced = false;
  for (let i = 0; i < 60; i++) {
    U.update(DT);
    if (b.vx < -40) { bounced = true; break; } // rebounded away from the wall
  }
  assert.ok(bounced, `barrel rebounded off the wall (final vx=${b.vx.toFixed(0)})`);
  // Energy absorbed: it did NOT bounce back at full speed (restitution < 1).
  assert.ok(Math.abs(b.vx) < 500, `bounce speed absorbed (|vx|=${Math.abs(b.vx).toFixed(0)} < 500)`);
  // It stopped AT the wall, not through it.
  assert.ok(b.x > x0, `barrel reached the wall (Δ=${(b.x - x0).toFixed(1)}px)`);
});

console.log(`\n${passed} passed`);
