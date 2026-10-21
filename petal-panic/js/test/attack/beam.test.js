// Task 1.9 — Beam primitive tests (pure logic, no DOM).
// Run: node js/test/attack/beam.test.js

import { strict as assert } from 'node:assert';
import { beamBox, stepBeam, announceMarkerPoint } from '../../combat/attack/primitives/beam.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { activeInstances, resetEffects } from '../../effects/index.js';
import '../../effects/registry.js'; // side effect: registers the types
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

ok('announceMarkerPoint: short beam stays at its tip (not screen edge)', () => {
  const ctx = makeContext({ x: -50, y: 100, w: 32, h: 32 }, {});
  const pt = announceMarkerPoint({ origin: { x: 0, y: 100 }, direction: 0, length: 200 }, ctx);
  // Tip at x=200, pulled back 48 → x=152.
  assert.ok(Math.abs(pt.x - 152) < 1e-6, `x=${pt.x}`);
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
  // Run to completion: total 1.0s at 10Hz → ~5 ticks after ignition.
  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) finished = h.step(DT, [enemy]);
  assert.ok(finished);
  assert.ok(hits.length >= 4 && hits.length <= 6, `got ${hits.length} ticks post-ignition`);
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

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
