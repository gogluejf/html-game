// Surface Strike primitive tests (pure logic, no DOM).
// Run: node js/test/attack/surfaceStrike.test.js

import { strict as assert } from 'node:assert';
import { strikeBox, resolveStrikeSurface, stepSurfaceStrike } from '../../combat/attack/primitives/surfaceStrike.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { LAYER } from '../../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const GROUND_Y = 480;
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });
const P = { x: 400, y: GROUND_Y, width: 240, height: 30, duration: 0.35, damage: 25, team: 'neutral' };

function ctxWith({ platforms = [], solids = [] } = {}) {
  return makeContext(attacker(), { groundY: GROUND_Y, platforms, solids });
}

function dummyEnemy(x, y, hp = 100) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

ok('surface resolves to the floor by default', () => {
  const surf = resolveStrikeSurface(P, ctxWith());
  assert.equal(surf.y, GROUND_Y);
  assert.equal(surf.w, 240); // full width, floor is wide
});

ok('band box sits ON the surface line (top = y - height)', () => {
  const surf = resolveStrikeSurface(P, ctxWith());
  const box = strikeBox(surf, P);
  assert.deepEqual(box, { x: 280, y: GROUND_Y - 30, w: 240, h: 30 });
});

ok('a platform under the point climbs up to it', () => {
  const platTop = GROUND_Y - 70;
  const surf = resolveStrikeSurface({ ...P, y: platTop }, ctxWith({ platforms: [{ x: 300, y: platTop, w: 200 }] }));
  assert.equal(surf.y, platTop, 'band rides the platform top');
});

ok('band clamps to the platform extent near an edge', () => {
  const platTop = GROUND_Y - 70;
  // Platform spans 500..600; center x=590 with width 240 → clamped to 500..600.
  const surf = resolveStrikeSurface({ ...P, x: 590, y: platTop }, ctxWith({ platforms: [{ x: 500, y: platTop, w: 100 }] }));
  assert.equal(surf.w, 100, `clamped width (got ${surf.w})`);
  assert.equal(surf.x, 550, 'clamped band centered on the remaining span');
});

ok('no surface under the point → no-surface complete', () => {
  const h = invoke('surfaceStrike', { ...P, x: 400, y: 100 }, makeContext(attacker(), {}));
  assert.equal(h._completed, true);
  assert.equal(h.state.done, true);
});

ok('damage lands once per target during the window', () => {
  const enemy = dummyEnemy(390, GROUND_Y - 24); // standing in the band
  const h = invoke('surfaceStrike', P, ctxWith());
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(finished, 'window closed');
  assert.equal(hits.length, 1, `one hit event (got ${hits.length})`);
  assert.equal(enemy.hp, 75, `took exactly one ${P.damage} hit`);
});

ok('target outside the band takes nothing', () => {
  const enemy = dummyEnemy(600, GROUND_Y - 24); // right of the 280..520 band
  const h = invoke('surfaceStrike', P, ctxWith());
  let n = 0;
  h.on('hit', () => n++);
  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(finished);
  assert.equal(n, 0);
  assert.equal(enemy.hp, 100);
});

ok('airborne target above the band height is safe (jump dodge)', () => {
  const enemy = dummyEnemy(390, GROUND_Y - 24 - 40); // 40px above the 30px band
  const h = invoke('surfaceStrike', P, ctxWith());
  let n = 0;
  h.on('hit', () => n++);
  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(finished);
  assert.equal(n, 0, 'jumping clears the band');
});

ok('complete carries the hit count', () => {
  const a = dummyEnemy(300, GROUND_Y - 24);
  const b = dummyEnemy(450, GROUND_Y - 24);
  const h = invoke('surfaceStrike', P, ctxWith());
  let result = null;
  h.on('complete', (r) => { result = r; });
  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) finished = h.step(DT, [a, b]);
  assert.ok(finished);
  assert.equal(result.hits, 2, `both victims counted (got ${result?.hits})`);
});

ok('cancel tears down the window', () => {
  const h = invoke('surfaceStrike', P, ctxWith());
  let expired = false;
  h.on('expire', () => { expired = true; });
  h.cancel();
  assert.equal(expired, true);
  assert.equal(h._cancelled, true);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
