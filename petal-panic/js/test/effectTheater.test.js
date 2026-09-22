// Task 7.1 — node-based tests for the per-effect theater demos
// (js/effects/index.js `theaterList()`, effects.md catalog §1→§24 + §26). Run:
// node js/test/effectTheater.test.js
// No DOM needed: every demo is exercised with a recording canvas stub ctx and a
// null carrier (no real gameplay entity). Fixed dt = 1/60 per project
// convention. The demo clock is stateless/deterministic: demo(ctx, t) clears
// the engine, fires the effect fresh at t=0, steps to elapsed time t, then
// draws that single frame.
//
// Scope note: Heat Distortion (§25) is deferred/out-of-scope and NOT
// registered, so it must be ABSENT from the list. The theater lists the 25
// CONCEPTUAL catalog entries (§1–§24 + §26 Beam) in catalog order. The
// registry holds 29 granular types because some catalog concepts map to
// multiple implementations: §1 "Particle Burst / Sparks" → particle-burst,
// hit-sparkle, death-sparkle, pickup-pop; §15 "Sprite Shake" → sprite-shake
// (legacy hitFlash-driven) + sprite-shake-standalone. The theater previews the
// canonical catalog entry per concept (particle-burst for §1, sprite-shake for
// §15), matching the plan's "catalog order §1→§24 then Beam" acceptance.

import { strict as assert } from 'node:assert';
import { theaterList, fireManual, activeCount } from '../effects/index.js';
import { Theater } from '../effects/theater.js';
import '../effects/registry.js'; // side effect: registers all types

const DT = 1 / 60;
let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Recording canvas stub: captures draw calls AND gradient creation so we can
 *  assert representative effects actually paint something. */
function makeCtx() {
  const calls = [];
  const gradObj = () => { const g = { stops: [] }; g.addColorStop = (s, c) => g.stops.push([s, c]); return g; };
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    closePath() { calls.push(['closePath']); },
    rect(...a) { calls.push(['rect', ...a]); },
    fillRect(...a) { calls.push(['fillRect', ...a]); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    moveTo(...a) { calls.push(['moveTo', ...a]); },
    lineTo(...a) { calls.push(['lineTo', ...a]); },
    arc(...a) { calls.push(['arc', ...a]); },
    translate(...a) { calls.push(['translate', ...a]); },
    rotate(...a) { calls.push(['rotate', ...a]); },
    scale(...a) { calls.push(['scale', ...a]); },
    set globalAlpha(v) { calls.push(['alpha', v]); },
    get globalAlpha() { return this._ga ?? 1; },
    set fillStyle(v) { calls.push(['style', v]); },
    get fillStyle() { return undefined; },
    set lineWidth(v) { calls.push(['lineWidth', v]); },
    set lineCap(v) { calls.push(['lineCap', v]); },
    set lineJoin(v) { calls.push(['lineJoin', v]); },
    set globalCompositeOperation(v) { calls.push(['gco', v]); },
    createLinearGradient(...a) { const g = gradObj(); calls.push(['gradL', ...a, g]); return g; },
    createRadialGradient(...a) { const g = gradObj(); calls.push(['gradR', ...a, g]); return g; },
    fillText(...a) { calls.push(['fillText', ...a]); },
    set textAlign(v) { calls.push(['textAlign', v]); },
    get textAlign() { return this._ta ?? 'start'; },
    set font(v) { calls.push(['font', v]); },
    strokeRect(...a) { calls.push(['strokeRect', ...a]); },
    setLineDash(...a) { calls.push(['setLineDash', ...a]); },
    arcTo(...a) { calls.push(['arcTo', ...a]); },
    quadraticCurveTo(...a) { calls.push(['quadraticCurveTo', ...a]); },
    bezierCurveTo(...a) { calls.push(['bezierCurveTo', ...a]); },
  };
}

const has = (ctx, op) => ctx.calls.some(c => c[0] === op);
const anyDraw = (ctx) => ['fill', 'stroke', 'rect', 'fillRect', 'arc', 'gradL', 'gradR'].some(op => has(ctx, op));

console.log('theaterList shape');
const list = theaterList();
ok('returns an array', () => assert.ok(Array.isArray(list), 'theaterList() returns an array'));
ok('has exactly 25 entries (all catalog effects, Heat Distortion excluded)', () => {
  assert.equal(list.length, 25, `expected 25 entries, got ${list.length}`);
});
ok('every entry has { type, name, demo } with demo a function', () => {
  for (const e of list) {
    assert.equal(typeof e.type, 'string', `${e.type}: type is a string`);
    assert.equal(typeof e.name, 'string', `${e.type}: name is a string`);
    assert.ok(e.name.length > 0, `${e.type}: name non-empty`);
    assert.equal(typeof e.demo, 'function', `${e.type}: demo is a function`);
  }
});
ok('types are unique', () => {
  const seen = new Set(list.map(e => e.type));
  assert.equal(seen.size, list.length, 'no duplicate types');
});

console.log('catalog ordering');
ok('first three are particle-burst, explosion, debris (§1,§2,§3)', () => {
  assert.deepEqual(list.slice(0, 3).map(e => e.type), ['particle-burst', 'explosion', 'debris']);
});
ok('last entry is beam (§26)', () => {
  assert.equal(list.at(-1).type, 'beam', `last is beam (got ${list.at(-1).type})`);
});
ok('sections are strictly increasing (catalog order preserved)', () => {
  // Re-derive section numbers from the registry-independent catalog by index:
  // the only out-of-order risk would be a mis-sorted CATALOG row. Verify the
  // full expected sequence of types matches the documented §1→§24+§26 order.
  const expected = [
    'particle-burst', 'explosion', 'debris', 'ground-wave', 'shockwave',
    'trail', 'afterimage', 'telegraph-circle', 'ground-target-marker',
    'target-reticle', 'vignette', 'sprite-flash', 'camera-shake',
    'screen-flash', 'sprite-shake', 'impact-star', 'fade-out', 'scale-pulse',
    'squash-stretch', 'dust-cloud', 'slash', 'aura-glow', 'screen-overlay',
    'composite-explosion', 'beam',
  ];
  assert.deepEqual(list.map(e => e.type), expected, 'full catalog order matches §1→§24 then Beam');
});
ok('Heat Distortion is NOT in the list', () => {
  assert.ok(!list.some(e => /heat/i.test(e.type) || /heat distortion/i.test(e.name)),
    'no heat-distortion entry present');
});

console.log('smoke: every demo runs from params alone (null carrier) without throwing');
ok('demo(ctx, t) callable at t=0, 0.1, 0.5 for every effect', () => {
  for (const e of list) {
    for (const t of [0, 0.1, 0.5]) {
      const ctx = makeCtx();
      e.demo(ctx, t); // must not throw
    }
  }
});
ok('demo is deterministic/stateless: same t twice → identical call count', () => {
  // composite-explosion is intentionally stochastic (randomized child timing +
  // positions per its spec §24), so its pool-particle draw count varies run to
  // run. All other effects are pure functions of (type, params, t).
  const STOCHASTIC = new Set(['composite-explosion']);
  for (const e of list) {
    if (STOCHASTIC.has(e.type)) continue;
    const a = makeCtx(); e.demo(a, 0.3);
    const b = makeCtx(); e.demo(b, 0.3);
    assert.equal(a.calls.length, b.calls.length, `${e.type}: stable across two runs at t=0.3`);
  }
});

console.log('representative demos actually produce draw calls');
const byType = Object.fromEntries(list.map(e => [e.type, e]));
ok('explosion produces fill/rect particle draws over its life', () => {
  const ctx = makeCtx();
  byType['explosion'].demo(ctx, 0.1); // particles mid-flight
  assert.ok(has(ctx, 'fillRect') || has(ctx, 'fill'), 'explosion painted particles');
});
ok('beam produces a filled rotated rectangle (rect + fill + linear gradient)', () => {
  const ctx = makeCtx();
  byType['beam'].demo(ctx, 0.6); // past the 500ms boss-appear delay
  assert.ok(has(ctx, 'rect'), 'beam drew a rect');
  assert.ok(has(ctx, 'fill'), 'beam filled');
  assert.ok(has(ctx, 'gradL'), 'beam built a linear halo gradient');
});
ok('aura-glow produces a radial-gradient arc fill', () => {
  const ctx = makeCtx();
  byType['aura-glow'].demo(ctx, 0.2);
  assert.ok(has(ctx, 'gradR'), 'aura built a radial gradient');
  assert.ok(has(ctx, 'arc'), 'aura stroked/filled an arc');
  assert.ok(has(ctx, 'fill'), 'aura filled the glow');
});
ok('vignette (screen-space) paints a viewport fill with a radial gradient', () => {
  const ctx = makeCtx();
  byType['vignette'].demo(ctx, 0.05);
  assert.ok(has(ctx, 'gradR'), 'vignette built a radial gradient');
  assert.ok(has(ctx, 'fillRect'), 'vignette filled the viewport');
});
ok('trail feeds synthetic motion and draws a ribbon (stroke)', () => {
  const ctx = makeCtx();
  byType['trail'].demo(ctx, 0.3);
  assert.ok(has(ctx, 'stroke') || has(ctx, 'moveTo'), 'trail drew a ribbon');
});
ok('afterimage feeds synthetic ghosts and draws rects', () => {
  const ctx = makeCtx();
  byType['afterimage'].demo(ctx, 0.3);
  assert.ok(has(ctx, 'fillRect') || has(ctx, 'fill'), 'afterimage drew ghost frames');
});
ok('shake proxy (camera-shake) draws a visible offset box', () => {
  const ctx = makeCtx();
  byType['camera-shake'].demo(ctx, 0.1);
  assert.ok(has(ctx, 'strokeRect') || has(ctx, 'fillRect'), 'camera-shake proxy painted a box');
});
ok('at least one draw call on average across ALL demos at t=0.05', () => {
  let drew = 0;
  for (const e of list) {
    const ctx = makeCtx();
    e.demo(ctx, 0.05); // early enough to be within most effects' lifetimes
    if (anyDraw(ctx)) drew++;
  }
  assert.ok(drew >= list.length - 2, `most demos visibly draw (drew ${drew}/${list.length})`);
});

console.log('Theater overlay object (task 7.2) — pure logic, no DOM');
// Reset to a known state so these tests are independent of ordering.
Theater.close();
ok('list length matches theaterList().length', () => {
  assert.equal(Theater.count, theaterList().length);
});
ok('open() sets active=true and resets index/clock to pre-roll', () => {
  // Start from a non-zero state to prove open() actually resets.
  Theater.open(); Theater.step(1); Theater.update(DT * 5);
  Theater.open();
  assert.equal(Theater.active, true);
  assert.equal(Theater.index, 0);
  assert.ok(Theater.clock <= 0, 'clock reset to pre-roll (≤ 0)');
});
ok('step(+1) advances the index', () => {
  Theater.open();
  const before = Theater.index;
  Theater.step(1);
  assert.equal(Theater.index, (before + 1) % Theater.count);
});
ok('step(-1) goes back one', () => {
  Theater.open(); Theater.step(1); Theater.step(1);
  const before = Theater.index;
  Theater.step(-1);
  assert.equal(Theater.index, (before - 1 + Theater.count) % Theater.count);
});
ok('step wraps forward at the last entry to 0', () => {
  Theater.open();
  Theater.index = Theater.count - 1;
  Theater.step(1);
  assert.equal(Theater.index, 0);
});
ok('step wraps backward at index 0 to the last entry', () => {
  Theater.open();
  Theater.index = 0;
  Theater.step(-1);
  assert.equal(Theater.index, Theater.count - 1);
});
ok('step() resets the clock to pre-roll', () => {
  Theater.open();
  Theater.update(DT * 40); // advance past the -0.5 pre-roll into positive territory
  assert.ok(Theater.clock > 0, 'clock advanced before step');
  Theater.step(1);
  assert.ok(Theater.clock <= 0, 'clock reset to pre-roll after step');
});
ok('update(dt) advances the clock only when active', () => {
  Theater.open();
  Theater.clock = 0;
  Theater.update(DT);
  assert.ok(Math.abs(Theater.clock - DT) < 1e-9, `clock ≈ dt (got ${Theater.clock})`);
  Theater.close();
  const frozen = Theater.clock;
  Theater.update(DT * 3);
  assert.equal(Theater.clock, frozen, 'clock does not advance while inactive');
});
ok('close() sets active=false', () => {
  Theater.open();
  assert.equal(Theater.active, true);
  Theater.close();
  assert.equal(Theater.active, false);
});
ok('open()/close() clear engine instances so demos do not leak into gameplay', () => {
  // Fire a real effect into the shared engine, then prove that opening AND
  // closing the theater both resetEffects() — so no demo/gameplay instance
  // survives across the boundary (a lingering camera-shake/vignette would
  // otherwise show for one frame after the overlay lifts).
  fireManual({ type: 'vignette', params: { strength: 1, viewW: 320, viewH: 180 } });
  assert.ok(activeCount() >= 1, 'a live instance exists before close');
  Theater.close(); // must drop it
  assert.equal(activeCount(), 0, 'close() cleared the engine');
  fireManual({ type: 'screen-flash', params: { strength: 1, viewW: 320, viewH: 180 } });
  assert.ok(activeCount() >= 1, 'a live instance exists before open');
  Theater.open(); // must drop it
  assert.equal(activeCount(), 0, 'open() cleared the engine');
  Theater.close();
});
ok('draw is a no-op when inactive (no calls recorded)', () => {
  Theater.close();
  const ctx = makeCtx();
  Theater.draw(ctx, 960, 540);
  assert.equal(ctx.calls.length, 0, 'no draw calls when inactive');
});
ok('draw when active fills the viewport black and runs the demo', () => {
  Theater.open(); // first effect = particle-burst
  const ctx = makeCtx();
  Theater.draw(ctx, 960, 540);
  // Black full-viewport fillRect present.
  const blackFill = ctx.calls.some(c => c[0] === 'fillRect' && c[1] === 0 && c[2] === 0 && c[3] === 960 && c[4] === 540);
  assert.ok(blackFill, 'black fillRect covers the full 960x540 viewport');
  // The current demo was invoked (particle-burst paints pool particles).
  assert.ok(anyDraw(ctx), 'active draw produced demo draw calls');
  // Balanced save/restore.
  const saves = ctx.calls.filter(c => c[0] === 'save').length;
  const restores = ctx.calls.filter(c => c[0] === 'restore').length;
  assert.equal(saves, restores, 'save/restore balanced');
  Theater.close();
});
ok('current() returns the selected entry with type/name/demo', () => {
  Theater.open();
  const cur = Theater.current();
  assert.equal(cur.type, list[0].type);
  assert.equal(typeof cur.name, 'string');
  assert.equal(typeof cur.demo, 'function');
  Theater.close();
});

console.log(`${passed} passed`);
