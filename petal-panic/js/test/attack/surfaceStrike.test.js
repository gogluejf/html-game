// Surface Strike primitive tests (pure logic, no DOM).
// Run: node js/test/attack/surfaceStrike.test.js

import { strict as assert } from 'node:assert';
import { segmentBox, resolveStrikeSegments, stepSurfaceStrike } from '../../combat/attack/primitives/surfaceStrike.js';
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
const P = { x: 400, y: GROUND_Y, width: 240, height: 30, reach: 120, duration: 0.35, damage: 25, team: 'neutral' };

function ctxWith({ platforms = [], solids = [] } = {}) {
  return makeContext(attacker(), { groundY: GROUND_Y, platforms, solids });
}

function dummyEnemy(x, y, hp = 100) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

ok('default (infinite span+reach) → EVERY surface burns at FULL extent', () => {
  const platTop = GROUND_Y - 70;
  const segs = resolveStrikeSegments({ ...P, width: Infinity, reach: Infinity }, ctxWith({ platforms: [{ x: 300, y: platTop, w: 200 }] }));
  assert.equal(segs.length, 2, 'platform + floor');
  const floorSeg = segs.find((s) => s.y === GROUND_Y);
  const platSeg = segs.find((s) => s.y === platTop);
  assert.equal(floorSeg.w, 4000, `floor spans the whole arena (got ${floorSeg.w})`);
  assert.equal(platSeg.w, 200, `platform spans its full width (got ${platSeg.w})`);
});

ok('finite width clamps segments to the strike span', () => {
  const segs = resolveStrikeSegments({ ...P, width: 100 }, ctxWith());
  assert.equal(segs[0].w, 100, 'floor segment limited to the span');
});

ok('finite reach ignores surfaces outside the window', () => {
  const highTop = GROUND_Y - 300; // far above a ±120 scan window
  const segs = resolveStrikeSegments(
    { ...P, width: Infinity, reach: 120, y: GROUND_Y - 100 },
    ctxWith({ platforms: [{ x: 300, y: highTop, w: 200 }] }),
  );
  assert.ok(!segs.some((s) => s.y === highTop), 'high platform not scanned');
});

ok('ALL surfaces in the span burn: platform + floor = two segments', () => {
  const platTop = GROUND_Y - 70;
  const segs = resolveStrikeSegments({ ...P, y: platTop }, ctxWith({ platforms: [{ x: 300, y: platTop, w: 200 }] }));
  const ys = segs.map((s) => s.y).sort((a, b) => a - b);
  assert.deepEqual(ys, [platTop, GROUND_Y], `platform AND floor both hot (got ${ys})`);
});

ok('segment clamps to the surface extent near an edge', () => {
  const platTop = GROUND_Y - 70;
  // Platform spans 500..600; strike center x=590 width 240 → platform seg clamped to 500..600.
  const segs = resolveStrikeSegments({ ...P, x: 590, y: platTop }, ctxWith({ platforms: [{ x: 500, y: platTop, w: 100 }] }));
  const platSeg = segs.find((s) => s.y === platTop);
  assert.equal(platSeg.w, 100, `clamped width (got ${platSeg?.w})`);
  assert.equal(platSeg.x, 500);
});

ok('block solid tops count as strikable surfaces', () => {
  const blockTop = GROUND_Y - 50;
  const segs = resolveStrikeSegments({ ...P, y: blockTop }, ctxWith({ solids: [{ x: 350, y: blockTop, w: 100, h: 50 }] }));
  const ys = segs.map((s) => s.y).sort((a, b) => a - b);
  assert.deepEqual(ys, [blockTop, GROUND_Y], 'block top + floor');
});

ok('surface outside the vertical reach window is ignored', () => {
  const highTop = GROUND_Y - 300; // far above the ±120 scan window
  const segs = resolveStrikeSegments({ ...P, y: GROUND_Y - 100 }, ctxWith({ platforms: [{ x: 300, y: highTop, w: 200 }] }));
  assert.ok(!segs.some((s) => s.y === highTop), 'high platform not scanned');
});

ok('no surface under the span → no-surface complete', () => {
  const h = invoke('surfaceStrike', { ...P, x: 400, y: 100, reach: 50 }, makeContext(attacker(), {}));
  assert.equal(h._completed, true);
  assert.equal(h.state.done, true);
});

ok('damage lands once per target across ALL segments', () => {
  const platTop = GROUND_Y - 70;
  const onPlat = dummyEnemy(390, platTop - 24);   // standing on the platform
  const onFloor = dummyEnemy(390, GROUND_Y - 24); // standing on the floor
  const h = invoke('surfaceStrike', { ...P, y: platTop }, ctxWith({ platforms: [{ x: 300, y: platTop, w: 200 }] }));
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) finished = h.step(DT, [onPlat, onFloor]);
  assert.ok(finished, 'window closed');
  assert.equal(onPlat.hp, 75, 'platform victim hit once');
  assert.equal(onFloor.hp, 75, 'floor victim hit once');
  assert.equal(hits.length, 2, `two hit events total (got ${hits.length})`);
});

ok('target outside the span takes nothing', () => {
  const enemy = dummyEnemy(600, GROUND_Y - 24); // right of the 280..520 span
  const h = invoke('surfaceStrike', P, ctxWith());
  let n = 0;
  h.on('hit', () => n++);
  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(finished);
  assert.equal(n, 0);
  assert.equal(enemy.hp, 100);
});

ok('airborne target above every band height is safe (jump dodge)', () => {
  const enemy = dummyEnemy(390, GROUND_Y - 24 - 40); // 40px above the 30px bands
  const h = invoke('surfaceStrike', P, ctxWith());
  let n = 0;
  h.on('hit', () => n++);
  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(finished);
  assert.equal(n, 0, 'jumping clears the bands');
});

ok('complete carries hit count + segment count', () => {
  const a = dummyEnemy(300, GROUND_Y - 24);
  const b = dummyEnemy(450, GROUND_Y - 24);
  const h = invoke('surfaceStrike', P, ctxWith());
  let result = null;
  h.on('complete', (r) => { result = r; });
  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) finished = h.step(DT, [a, b]);
  assert.ok(finished);
  assert.equal(result.hits, 2, `both victims counted (got ${result?.hits})`);
  assert.equal(result.segments, 1, 'floor-only scene → 1 segment');
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
