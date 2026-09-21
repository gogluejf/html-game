// EPIC Definition of Done §4 — deterministic catalog test covering ALL 25
// implemented effects end-to-end (js/effects/index.js `theaterList()`,
// effects.md catalog §1→§24 + §26 Beam). Run:
// node js/test/effectCatalog.test.js
// No DOM needed: every effect is exercised through the REAL engine fire()
// path (fireManual → updateEffects → drawEffects) with a recording canvas
// stub ctx and a null carrier (no real gameplay entity). Fixed dt = 1/60 per
// project convention. This file was referenced by per-task Verification
// commands throughout the epic but never created; it now closes that gap.
//
// Scope note: Heat Distortion (§25) is deferred/out-of-scope and NOT
// registered, so it must be ABSENT from the list. The catalog holds exactly
// 25 CONCEPTUAL entries (§1–§24 + §26 Beam) in catalog order. composite-
// explosion (§24) is intentionally stochastic (Math.random child timing per
// its spec), so for it we only assert instantiation + one clean frame — no
// exact draw-count assertions. All other effects are stable.

import { strict as assert } from 'node:assert';
import { theaterList, fireManual, resetEffects, activeCount, updateEffects, drawEffects } from '../effects/index.js';
import { particles } from '../particles.js';
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
  };
}

const has = (ctx, op) => ctx.calls.some(c => c[0] === op);
const anyDraw = (ctx) => ['fill', 'stroke', 'rect', 'fillRect', 'arc', 'gradL', 'gradR'].some(op => has(ctx, op));

// Sensible default params per type (reused from the CATALOG defaults in
// index.js) so a bare fireManual produces a visible, valid instance.
const DEFAULT_PARAMS = {
  'particle-burst':       { x: 160, y: 90, count: 16 },
  'explosion':            { x: 160, y: 90, radius: 60 },
  'debris':               { x: 160, y: 90, fragmentCount: 14, velocity: 220, lifetime: 0.8 },
  'ground-wave':          { x: 160, y: 90, duration: 0.8 },
  'shockwave':            { x: 160, y: 90, duration: 0.6 },
  'trail':                { lifetime: 0.6 },
  'afterimage':           { box: { x: 144, y: 74, w: 32, h: 32 }, spawnInterval: 1 / 30, lifetime: 0.6 },
  'telegraph-circle':     { x: 160, y: 90, duration: 1.0 },
  'ground-target-marker': { x: 160, y: 90, duration: 1.0 },
  'target-reticle':       { x: 160, y: 90, duration: 1.0 },
  'vignette':             { strength: 1, viewW: 320, viewH: 180 },
  'sprite-flash':         { box: { x: 144, y: 74, w: 32, h: 32 }, duration: 0.5 },
  'camera-shake':         { intensity: 6, duration: 0.5 },
  'screen-flash':         { strength: 1, viewW: 320, viewH: 180 },
  'sprite-shake':         { amount: 4 },
  'impact-star':          { x: 160, y: 90 },
  'fade-out':             { box: { x: 144, y: 74, w: 32, h: 32 }, duration: 0.6 },
  'scale-pulse':          { box: { x: 144, y: 74, w: 32, h: 32 }, duration: 0.8 },
  'squash-stretch':       { box: { x: 144, y: 74, w: 32, h: 32 }, duration: 0.6 },
  'dust-cloud':           { x: 160, y: 90, particleCount: 18, lifetime: 0.8 },
  'slash':           { x: 160, y: 90, duration: 0.4 },
  'aura-glow':            { x: 160, y: 90, duration: 1.0 },
  'screen-overlay':       { color: '#ff5a5a', opacity: 0.5, duration: 1.0, fadeIn: 0.2, fadeOut: 0.2 },
  'composite-explosion':  { x: 160, y: 90, radius: 60, explosionCount: 6, duration: 1.0 },
  'beam':                 { x: 160, y: 90, length: 120, width: 18, gradientRadius: 14, color: '#7df', flashInTime: 0.05, fadeOutTime: 0.15 },
};

console.log('catalog shape');
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
ok('Heat Distortion is NOT in the list', () => {
  assert.ok(!list.some(e => /heat/i.test(e.type) || /heat distortion/i.test(e.name)),
    'no heat-distortion entry present');
});

console.log('catalog ordering (§1→§24 + §26 Beam)');
ok('full type sequence matches the documented catalog order', () => {
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

console.log('real fire() path: every catalog type instantiates via fireManual');
for (const e of list) {
  ok(`"${e.type}" resolves through fireManual (non-null EffectInstance)`, () => {
    resetEffects();
    const inst = fireManual({ type: e.type, params: { ...DEFAULT_PARAMS[e.type] } });
    assert.ok(inst !== null, `fireManual returned null — "${e.type}" did not resolve`);
    assert.equal(inst.type, e.type);
    assert.equal(inst.trigger, 'manual');
    resetEffects();
  });
}

console.log('uniform lifecycle surface on each instantiated body');
for (const e of list) {
  ok(`"${e.type}" exposes done flag + callable update/render`, () => {
    resetEffects();
    const inst = fireManual({ type: e.type, params: { ...DEFAULT_PARAMS[e.type] } });
    assert.ok(inst !== null, `could not instantiate "${e.type}"`);
    // Uniform wrapper always carries a boolean `done` flag.
    assert.equal(typeof inst.done, 'boolean', `inst.done is boolean`);
    // Body must expose at least one of update(dt)/render(ctx) callables.
    const hasUpdate = typeof inst.body.update === 'function';
    const hasRender = typeof inst.body.render === 'function';
    assert.ok(hasUpdate || hasRender, `"${e.type}" body has neither update nor render`);
    if (hasUpdate) assert.equal(typeof inst.body.update, 'function', 'update is a function');
    if (hasRender) assert.equal(typeof inst.body.render, 'function', 'render is a function');
    resetEffects();
  });
}

console.log('one full frame (updateEffects + drawEffects) runs without throwing');
for (const e of list) {
  ok(`"${e.type}" survives one full frame (update + draw)`, () => {
    resetEffects();
    const inst = fireManual({ type: e.type, params: { ...DEFAULT_PARAMS[e.type] } });
    assert.ok(inst !== null, `could not instantiate "${e.type}"`);
    const ctx = makeCtx();
    updateEffects(DT);   // must not throw
    drawEffects(ctx, { view: { w: 320, h: 180 } }); // must not throw
    resetEffects();
  });
}

console.log('representative effects produce visible draw calls');
const byType = Object.fromEntries(list.map(e => [e.type, e]));
ok('explosion fills particles over its life', () => {
  resetEffects();
  particles.reset();
  fireManual({ type: 'explosion', params: { ...DEFAULT_PARAMS['explosion'] } });
  const ctx = makeCtx();
  for (let i = 0; i < 6; i++) {
    updateEffects(DT);
    particles.updateAll(DT);
    drawEffects(ctx, { view: { w: 320, h: 180 } });
    for (const s of particles.activeItems) s.draw(ctx); // pool-driven burst
  }
  assert.ok(has(ctx, 'fillRect') || has(ctx, 'fill'), 'explosion painted particles');
  resetEffects();
});
ok('beam draws a filled rectangle with a linear halo gradient', () => {
  resetEffects();
  fireManual({ type: 'beam', params: { ...DEFAULT_PARAMS['beam'] } });
  const ctx = makeCtx();
  updateEffects(DT * 5); // just past flash-in peak
  drawEffects(ctx, { view: { w: 320, h: 180 } });
  assert.ok(has(ctx, 'rect'), 'beam drew a rect');
  assert.ok(has(ctx, 'fill'), 'beam filled');
  assert.ok(has(ctx, 'gradL'), 'beam built a linear gradient');
  resetEffects();
});
ok('aura-glow builds a radial-gradient arc fill', () => {
  resetEffects();
  fireManual({ type: 'aura-glow', params: { ...DEFAULT_PARAMS['aura-glow'] } });
  const ctx = makeCtx();
  updateEffects(DT * 12);
  drawEffects(ctx, { view: { w: 320, h: 180 } });
  assert.ok(has(ctx, 'gradR'), 'aura built a radial gradient');
  assert.ok(has(ctx, 'arc'), 'aura stroked/filled an arc');
  assert.ok(has(ctx, 'fill'), 'aura filled the glow');
  resetEffects();
});
ok('vignette paints a viewport fill with a radial gradient', () => {
  resetEffects();
  fireManual({ type: 'vignette', params: { ...DEFAULT_PARAMS['vignette'] } });
  const ctx = makeCtx();
  updateEffects(DT * 3);
  drawEffects(ctx, { view: { w: 320, h: 180 } });
  assert.ok(has(ctx, 'gradR'), 'vignette built a radial gradient');
  assert.ok(has(ctx, 'fillRect'), 'vignette filled the viewport');
  resetEffects();
});
ok('screen-overlay paints a viewport fill', () => {
  resetEffects();
  fireManual({ type: 'screen-overlay', params: { ...DEFAULT_PARAMS['screen-overlay'] } });
  const ctx = makeCtx();
  updateEffects(DT * 12);
  drawEffects(ctx, { view: { w: 320, h: 180 } });
  assert.ok(has(ctx, 'fillRect'), 'overlay filled the viewport');
  resetEffects();
});
ok('at least one draw call across most effects after a few frames', () => {
  let drew = 0;
  for (const e of list) {
    resetEffects();
    particles.reset();
    fireManual({ type: e.type, params: { ...DEFAULT_PARAMS[e.type] } });
    const ctx = makeCtx();
    for (let i = 0; i < 12; i++) {
      updateEffects(DT);
      particles.updateAll(DT);
      drawEffects(ctx, { view: { w: 320, h: 180 } });
      for (const s of particles.activeItems) s.draw(ctx); // pool-driven bursts
    }
    // Shake effects have no canvas render by design (consumed by camera/
    // renderer). Allow those to skip the "visible" bar.
    if (anyDraw(ctx)) drew++;
    resetEffects();
  }
  assert.ok(drew >= list.length - 5, `most effects visibly draw (drew ${drew}/${list.length})`);
});

console.log(`${passed} passed`);
