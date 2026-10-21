// Task 1.9 — Beam primitive tests (pure logic, no DOM).
// Run: node js/test/attack/beam.test.js

import { strict as assert } from 'node:assert';
import { beamBox, stepBeam, announceMarkerPoint } from '../../combat/attack/primitives/beam.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { activeInstances, resetEffects } from '../../effects/index.js';
import '../../effects/registry.js'; // side effect: registers the types
import '../../combat/attack/macros/sweepingBeam.js';
import '../../combat/attack/macros/targetedBeam.js';
import { LAYER } from '../../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });
const P = { direction: 0, length: 200, width: 24, duration: 0.5, damage: 10, tickRate: 10, team: 'ally', announceMarker: false };

function dummyEnemy(x, y, hp = 100) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

ok('box: horizontal beam extends right from attacker facing edge', () => {
  const ctx = makeContext(attacker(), {});
  const box = beamBox(P, ctx);
  // Attacker 32×32 at (100,100), center (116,116), dir=0 → gun tip at x=132.
  // AABB: x = 132 - width/2 = 120, w = length + width = 224, y = 116 - 12 = 104.
  assert.ok(Math.abs(box.x - 120) < 1e-9, `x=${box.x}`);
  assert.ok(Math.abs(box.w - 224) < 1e-9, `w=${box.w}`);
  assert.ok(Math.abs(box.y - 104) < 1e-9, `y=${box.y}`);
  assert.ok(Math.abs(box.h - 24) < 1e-9, `h=${box.h}`);
});

ok('box: explicit origin overrides attacker center', () => {
  const ctx = makeContext(attacker(), {});
  const box = beamBox({ ...P, origin: { x: 500, y: 300 } }, ctx);
  assert.ok(Math.abs(box.x - 488) < 1e-9, `x=${box.x}`);
  assert.ok(Math.abs(box.y - 288) < 1e-9, `y=${box.y}`);
});

ok('marker origin resolves via sprite-crop schema', () => {
  const a = attacker();
  a.markers = [{ label: 'chest', x: 16, y: 16 }];
  const ctx = makeContext(a, {});
  const box = beamBox({ ...P, origin: 'chest' }, ctx);
  // marker world (116,116) → same as center here; shift marker to verify use.
  a.markers[0].x = 40;
  const box2 = beamBox({ ...P, origin: 'chest' }, ctx);
  assert.ok(Math.abs(box2.x - (140 - 12)) < 1e-9, `x=${box2.x}`);
});

ok('damage ticks at tickRate while overlapping', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(200, 105); // inside the beam
  const h = invoke('beam', P, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  // 20 frames (0.333s) at 10Hz → exactly 3 ticks of 10 dmg.
  for (let i = 0; i < 20; i++) h.step(DT, [enemy]);
  assert.equal(hits.length, 3, `got ${hits.length} ticks`);
  assert.deepEqual(hits, [10, 10, 10]);
  assert.equal(enemy.hp, 70);
});

ok('tick accumulator: no drift over a full run', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(200, 105);
  const h = invoke('beam', P, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  // Full 0.5s lifetime at 10Hz → exactly 5 ticks (no float drift).
  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(finished);
  assert.equal(hits.length, 5, `got ${hits.length} ticks over full life`);
  assert.equal(enemy.hp, 50);
});

ok('no damage when target is outside the beam', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(200, 300); // far below
  const h = invoke('beam', P, ctx);
  let hitCount = 0;
  h.on('hit', () => hitCount++);
  for (let i = 0; i < 30; i++) h.step(DT, [enemy]);
  assert.equal(hitCount, 0);
  assert.equal(enemy.hp, 100);
});

ok('completes after duration', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('beam', P, ctx);
  let done = null;
  h.on('complete', (i) => { done = i; });
  for (let i = 0; i < 30; i++) assert.equal(h.step(DT, []), false, `frame ${i} still active`);
  assert.equal(h.step(DT, []), true, 'finishes at frame 31 (~0.517s)');
  assert.ok(done.ticks >= 4 && done.ticks <= 6, `ticks=${done.ticks}`);
});

ok('step is idempotent after completion', () => {
  const ctx = makeContext(attacker(), {});
  const h = invoke('beam', P, ctx);
  h.step(1, []); // over-duration
  assert.equal(h.step(DT, []), true);
});

ok('team routing: foe beam skips enemies', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(200, 105);
  const h = invoke('beam', { ...P, team: 'foe' }, ctx);
  let hitCount = 0;
  h.on('hit', () => hitCount++);
  for (let i = 0; i < 12; i++) h.step(DT, [enemy]);
  assert.equal(hitCount, 0, 'foe beams only hit HERO layer');
});

ok('announced beam marker: squash aligns ALONG the beam axis (normal passed)', () => {
  // Horizontal beam (direction 0): the marker receives angle = direction + π/2.
  // In local space the squash is always on Y; the context rotation of π/2 then
  // maps local Y onto world X — so in WORLD space the ellipse is tall and
  // narrow (stretched along the horizontal laser). Verify via the fired
  // instance's context rotation + local radii.
  const ctx = makeContext({ x: -50, y: 100, w: 32, h: 32 }, {});
  resetEffects();
  invoke('beam', { origin: { x: 0, y: 100 }, direction: 0, length: 9999, width: 24, duration: 0.5, damage: 5, tickRate: 8, team: 'ally', announceMarker: true, announceDelay: 0.6 }, ctx);
  const inst = activeInstances().find((i) => i.body?.space === 'world');
  assert.ok(inst, 'marker instance fired');
  const c2d = { calls: [], save() {}, restore() {}, beginPath() {}, stroke() {},
    set globalAlpha(v) {}, get globalAlpha() { return 1; },
    set lineWidth(v) {}, set strokeStyle(v) {},
    translate(...a) { this.calls.push(['translate', ...a]); },
    rotate(...a) { this.calls.push(['rotate', ...a]); },
    ellipse(...a) { this.calls.push(['ellipse', ...a]); },
    moveTo(...a) { this.calls.push(['moveTo', ...a]); },
    lineTo(...a) { this.calls.push(['lineTo', ...a]); } };
  inst.body.render(c2d, {});
  const rot = c2d.calls.find(c => c[0] === 'rotate');
  assert.ok(rot && Math.abs(rot[1] - Math.PI / 2) < 1e-9, `context rotated π/2 for a horizontal beam (${rot?.[1]})`);
  resetEffects();
});

// --- Announcement marker (announceMarker / announceDelay) -------------------

ok('announceMarkerPoint: full-screen beam exits at right edge, pulled back 5%', () => {
  // Beam from (0,100) pointing right, length 9999 → exit point is the right
  // screen edge (x=960), pulled back by 0.05·VIEW_W = 48 → x=912.
  const ctx = makeContext({ x: -50, y: 100, w: 32, h: 32 }, {});
  const pt = announceMarkerPoint({ origin: { x: 0, y: 100 }, direction: 0, length: 9999 }, ctx);
  assert.ok(Math.abs(pt.x - (960 - 48)) < 1e-6, `x=${pt.x}`);
  assert.ok(Math.abs(pt.y - 100) < 1e-6, `y=${pt.y}`);
});

ok('announceMarkerPoint: marker ALWAYS at the screen boundary, even for short beams', () => {
  // Short beam (length 200) from mid-screen origin: the marker still sits at
  // the right edge (boundary), NOT at the beam tip.
  const ctx = makeContext({ x: 400, y: 100, w: 32, h: 32 }, {});
  const pt = announceMarkerPoint({ origin: { x: 400, y: 100 }, direction: 0, length: 200 }, ctx);
  assert.ok(Math.abs(pt.x - (960 - 48)) < 1e-6, `x=${pt.x} (expected 912)`);
});

ok('announceMarkerPoint: camera offset shifts the visible exit edge', () => {
  const cam = { x: 500, y: 0 };
  const ctx = makeContext({ x: -50, y: 100, w: 32, h: 32 }, { camera: cam });
  const pt = announceMarkerPoint({ origin: { x: 0, y: 100 }, direction: 0, length: 9999 }, ctx);
  // Right edge of view = 500+960 = 1460, pulled back 48 → 1412.
  assert.ok(Math.abs(pt.x - 1412) < 1e-6, `x=${pt.x}`);
});

ok('announced beam: no damage during announceDelay + gap, then ticks', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(200, 105);
  const p = { ...P, duration: 1.0, announceMarker: true, announceDelay: 0.3 };
  const h = invoke('beam', p, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  // 0.3s delay + 0.12s gap = 0.42s inert → ~25 frames with zero damage.
  for (let i = 0; i < 25; i++) h.step(DT, [enemy]);
  assert.equal(hits.length, 0, `no damage pre-ignition (got ${hits.length})`);
  assert.equal(enemy.hp, 100);
  // Run to completion: a full 1.0 active seconds at 10Hz after ignition.
  let finished = false;
  for (let i = 0; i < 70 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(finished);
  assert.equal(hits.length, 10, `got ${hits.length} ticks post-ignition`);
  assert.ok(enemy.hp < 100, 'damage landed after ignition');
});

ok('defaults: announcement is ON (marker + 1.0s delay) unless opted out', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(200, 105);
  // No announce params given → defaults apply: 1.0s marker + 0.12s gap inert.
  const p = { direction: 0, length: 200, width: 24, duration: 2.0, damage: 10, tickRate: 10, team: 'ally' };
  const h = invoke('beam', p, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  for (let i = 0; i < 65; i++) h.step(DT, [enemy]); // ~1.08s
  assert.equal(hits.length, 0, `default announcement keeps the beam inert for its window (got ${hits.length})`);
  assert.equal(enemy.hp, 100);
  // Opting out restores immediate behavior.
  const ctx2 = makeContext(attacker(), {});
  const enemy2 = dummyEnemy(200, 105);
  const h2 = invoke('beam', P, ctx2); // P already opts out (announceMarker: false)
  const hits2 = [];
  h2.on('hit', (i) => hits2.push(i.dealt));
  for (let i = 0; i < 20; i++) h2.step(DT, [enemy2]);
  assert.equal(hits2.length, 3, `announceMarker:false ticks immediately (got ${hits2.length})`);
});

ok('announced beam: non-announced behavior unchanged (immediate ticks)', () => {
  const ctx = makeContext(attacker(), {});
  const enemy = dummyEnemy(200, 105);
  const h = invoke('beam', P, ctx);
  const hits = [];
  h.on('hit', (i) => hits.push(i.dealt));
  h.step(DT, [enemy]);
  assert.ok(hits.length === 0 || hits.length === 1, 'first frame tick boundary');
  for (let i = 0; i < 19; i++) h.step(DT, [enemy]);
  assert.equal(hits.length, 3, `got ${hits.length} ticks at 0.333s`);
});

// Moving targets use the same update-before-attack order as theater staging.
for (const useWorldBox of [false, true]) {
  ok(`sweep: moving off-axis target is safe, on-axis target hits (worldBox=${useWorldBox})`, () => {
    resetEffects();
    const h = invoke('sweepingBeam', {
      origin: { x: 0, y: 0 }, direction: Math.PI / 6,
      sweepAngle: Math.PI / 6, length: 300, width: 20,
      holdDuration: 0.1, sweepDuration: 1, endHoldDuration: 0.2,
      fadeOut: 0.2, announceMarker: false, tickRate: 60, damage: 1,
      beamStyle: { gradientRadius: 0 },
    }, makeContext(attacker(), {}));
    const outside = dummyEnemy(0, 0, 1000);
    const inside = dummyEnemy(0, 0, 1000);
    for (const t of [outside, inside]) {
      t.w = t.h = 4;
      if (useWorldBox) t.worldBox = function () {
        return { x: this.x + 500, y: this.y + 500, w: 4, h: 4 };
      };
    }
    for (let frame = 1; frame <= 60; frame++) {
      const time = frame * DT;
      const angle = Math.PI / 6 + Math.PI / 6 * Math.max(0, time - 0.1);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      // Entire outside box has perpendicular distance >= 40 - 2sqrt(2),
      // well beyond the drawn half-width of 10, yet inside the broad AABB.
      for (const [t, offset] of [[outside, 40], [inside, 0]]) {
        t.x = cos * 150 - sin * offset - 2 - (useWorldBox ? 500 : 0);
        t.y = sin * 150 + cos * offset - 2 - (useWorldBox ? 500 : 0);
      }
      h.state.beam.state._fx.body.update(DT);
      h.step(DT, [outside, inside]);
      const body = h.state.beam.state._fx.body;
      let drawnAngle, drawnOrigin, filled = false;
      body.render({
        save() {}, restore() {}, beginPath() {}, closePath() {},
        moveTo() {}, lineTo() {}, quadraticCurveTo() {},
        translate(x, y) { drawnOrigin = { x, y }; },
        rotate(a) { drawnAngle = a; }, fill() { filled = true; },
        createLinearGradient() { return { addColorStop() {} }; },
      });
      assert.ok(filled, 'beam actually produces a draw path');
      assert.deepEqual(drawnOrigin, { x: 0, y: 0 });
      assert.ok(Math.abs(drawnAngle - angle) < 1e-9, 'same-frame render angle');
      assert.equal(outside.hp, 1000, `outside drawn beam at frame ${frame}`);
      assert.equal(inside.hp, 1000 - frame, `actual overlap at frame ${frame}`);
    }
    resetEffects();
  });
}

ok('theater default beam: announcement does not consume active lifetime', () => {
  resetEffects();
  const enemy = dummyEnemy(200, 105, 1000);
  const h = invoke('beam', { direction: 0, length: 1000, width: 24,
    duration: 0.6, damage: 15, tickRate: 8, team: 'ally' }, makeContext(attacker()));
  for (let i = 0; i < 67; i++) h.step(DT, [enemy]);
  assert.equal(enemy.hp, 1000, 'announcement is inert');
  let finished = false;
  for (let i = 0; i < 50 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(h.state._fx.body, 'actual beam effect ignited');
  assert.ok(finished);
  assert.equal(enemy.hp, 940, '0.6 active seconds at 8Hz = four ticks');
  resetEffects();
});

for (const id of ['beam', 'targetedBeam']) {
  ok(`${id}: diagonal empty AABB corner is safe; moving full worldBox overlaps hit`, () => {
    resetEffects();
    const aim = dummyEnemy(200, 200, 1000);
    aim.w = aim.h = 0;
    const h = invoke(id, id === 'beam' ? {
      origin: { x: 0, y: 0 }, direction: Math.PI / 4, length: 300,
      width: 20, duration: 1, damage: 1, tickRate: 60, announceMarker: false,
      style: { gradientRadius: 0 },
    } : {
      target: aim, duration: 0, lockTime: 0, beamLength: 300,
      beamWidth: 20, beamDuration: 1, damage: 1, tickRate: 60,
      beamStyle: { gradientRadius: 0 },
    }, makeContext({ x: 0, y: 0, w: 0, h: 0 }));
    const outside = dummyEnemy(40, 140, 1000);
    const inside = dummyEnemy(-400, -400, 1000);
    inside.worldBox = function () { return { x: this.x + 500, y: this.y + 500, w: 24, h: 24 }; };
    for (let frame = 1; frame <= 20; frame++) {
      inside.x += 1; inside.y += 1;
      h.step(DT, [outside, inside]);
      const body = (h.beam ?? h).state._fx.body;
      assert.deepEqual(body.origin, { x: 0, y: 0 });
      assert.equal(body.angle, Math.PI / 4);
      assert.equal(outside.hp, 1000, 'empty corner is not the beam');
      assert.equal(inside.hp, 1000 - frame, 'live offset worldBox hits');
    }
    resetEffects();
  });
}

ok('primitive: rendered geometry stays authoritative with style overrides and moving attacker', () => {
  const a = attacker();
  const h = invoke('beam', { ...P, origin: { x: 0, y: 0 }, length: 200, width: 20,
    style: { x: 800, y: 900, orientation: 2, length: 5, width: 100, gradientRadius: 0 } }, makeContext(a));
  const body = h.state._fx.body;
  body.update(0.1);
  const points = [];
  body.render({ save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {},
    translate(x, y) { assert.deepEqual([x, y], [0, 0]); },
    rotate(angle) { assert.equal(angle, 0); },
    moveTo() {}, quadraticCurveTo() {}, lineTo(x, y) { points.push([x, y]); },
    createLinearGradient() { return { addColorStop() {} }; },
  });
  assert.ok(points.some(([x, y]) => x === 200 && y === 10));
  const edge = dummyEnemy(80, 9);
  const behind = dummyEnemy(-25, -5); behind.w = 4;
  const past = dummyEnemy(201, -5);
  const touch = dummyEnemy(80, 10);
  a.x += 500;
  h.step(0.1, [edge, behind, past, touch]);
  assert.equal(edge.hp, 90, 'bounds overlap even though center is outside');
  for (const t of [behind, past, touch]) assert.equal(t.hp, 100);
  resetEffects();
});

ok('primitive: implicit origin is captured with the visual, not dragged by attacker', () => {
  const a = attacker();
  const h = invoke('beam', P, makeContext(a));
  const enemy = dummyEnemy(200, 105);
  a.x += 500;
  h.step(0.1, [enemy]);
  assert.equal(enemy.hp, 90);
  assert.equal(h.state._fx.body.origin.x, 132);
  resetEffects();
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
