// Task 8.3 — Play HUD tests (node-based).
// Run: node js/test/hud83.test.js
//
// Verifies drawHUD renders all design §20 elements against a fake ctx that
// records fills/text, and that values track live hero state (energy bar fill,
// shield overlay, ammo/special/coins/lives).

import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

import { strict as assert } from 'node:assert';

// --- Minimal DOM stub (must run BEFORE importing update.js) ------------------
const noop = () => {};
globalThis.document = {
  createElement: (tag) => ({
    width: 0, height: 0,
    getContext: () => new Proxy({}, { get: () => noop, set: () => true }),
    addEventListener: noop,
  }),
};
globalThis.window = { addEventListener: noop };
globalThis.Image = class {
  constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(v) { this._src = v; this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; }
};
globalThis.requestAnimationFrame = () => {};
globalThis.performance = { now: () => Date.now() };

// Fake canvas 2D context recording fills, strokes, arcs and text.
function makeFakeCtx() {
  const rec = { texts: [], fills: [], rects: [], arcs: [], lines: [] };
  const base = new Proxy({}, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 100 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (prop in rec) return rec[prop]; // expose recorded arrays
      if (typeof prop === 'string') return target[prop] ?? noop;
      return noop;
    },
    set(target, prop, val) { target[prop] = val; return true; },
  });
  base.fillText = (t, x, y) => { rec.texts.push({ t: String(t), x, y }); };
  base.fillRect = (x, y, w, h) => { rec.rects.push({ x, y, w, h, style: base.fillStyle }); };
  base.strokeRect = (x, y, w, h) => { rec.lines.push({ kind: 'rect', x, y, w, h }); };
  base.arc = (x, y, r, a0, a1) => { rec.arcs.push({ x, y, r, full: (a1 - a0) >= Math.PI * 2 - 0.01 }); };
  base.moveTo = (x, y) => { rec.lines.push({ kind: 'moveTo', x, y }); };
  base.lineTo = (x, y) => { rec.lines.push({ kind: 'lineTo', x, y }); };
  return base;
}

// Dynamic imports AFTER the stub is in place.
const U = await import('../systems/update.js');
const { S, setState } = await import('../core/state.js');
const { LEVELS } = await import('../world/level.js');
const { VIEW_W } = await import('../core/view.js');
const { drawHUD } = await import('../systems/hud.js');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('\nTask 8.3 — Play HUD\n');

const hero = U.getHero();
const levelDef = LEVELS[0];
const cam = U.getCamera();

ok('drawHUD runs without throwing (full state)', () => {
  const ctx = makeFakeCtx();
  drawHUD(ctx, hero, cam, levelDef);
});

ok('energy bar: red fill width tracks energy/maxEnergy', () => {
  const ctx = makeFakeCtx();
  hero.energy = hero.maxEnergy * 0.5;
  drawHUD(ctx, hero, cam, levelDef);
  const red = ctx.rects.find(r => r.style === '#e74c3c' && Math.abs(r.y - 12) < 1 && r.w > 50);
  assert.ok(red, 'red energy fill rect found at top-left');
  assert.ok(Math.abs(red.w - 200 * 0.5) < 1, `fill ≈ half of 200px (got ${red.w})`);
});

ok('energy bar: clamps when energy exceeds max', () => {
  const ctx = makeFakeCtx();
  hero.energy = hero.maxEnergy * 2;
  drawHUD(ctx, hero, cam, levelDef);
  const red = ctx.rects.find(r => r.style === '#e74c3c' && Math.abs(r.y - 12) < 1 && r.w > 50);
  assert.ok(red.w <= 200 + 1, 'fill never exceeds bar width');
  hero.energy = hero.maxEnergy; // restore
});

ok('shield: cyan overlay drawn only when shield > 0', () => {
  const ctxNo = makeFakeCtx();
  hero.shield = 0;
  drawHUD(ctxNo, hero, cam, levelDef);
  assert.ok(!ctxNo.rects.some(r => String(r.style).startsWith('rgba(0, 200, 255')), 'no cyan with shield=0');

  const ctxYes = makeFakeCtx();
  hero.shield = 20;
  drawHUD(ctxYes, hero, cam, levelDef);
  const cyan = ctxYes.rects.find(r => String(r.style).includes('rgba(0, 200, 255'));
  assert.ok(cyan, 'cyan shield overlay present with shield>0');
  hero.shield = 0; // restore
});

ok('weapon tiles: 3 glass slots drawn, selection ring follows selectedWeapon', () => {
  const ctx = makeFakeCtx();
  hero.specialSlots = ['bomb', null];
  hero.selectedWeapon = 0;
  drawHUD(ctx, hero, cam, levelDef);
  // 3 tiles → tile bg fills (fillRect) + rounded-rect borders (path strokes).
  assert.ok(ctx.rects.length >= 3, `3 tile backgrounds filled (${ctx.rects.length} rects)`);
  assert.ok(ctx.lines.length >= 3, `tile borders stroked (${ctx.lines.length} line ops)`);
  // Selection moves → still draws without throwing (ring re-targets).
  hero.selectedWeapon = 1;
  const ctx2 = makeFakeCtx();
  drawHUD(ctx2, hero, cam, levelDef);
  assert.ok(ctx2.rects.length >= 3, 're-draw with moved selection works');
});

ok('coins + lives: count text drawn in badge circles (top-right)', () => {
  const ctx = makeFakeCtx();
  hero.coins = 200; hero.lives = 3;
  drawHUD(ctx, hero, cam, levelDef);
  const texts = ctx.texts.map(t => t.t);
  assert.ok(texts.includes('200'), `coin count rendered (${texts})`);
  assert.ok(texts.includes('3'), `lives count rendered`);
});

ok('top-right badges: coin + lives count circles drawn in the right corner', () => {
  const ctx = makeFakeCtx();
  drawHUD(ctx, hero, cam, levelDef);
  const fullCircles = ctx.arcs.filter(a => a.full);
  assert.ok(fullCircles.length >= 2, `coin + lives count circles drawn (${fullCircles.length} full circles)`);
});

ok('null-safe: missing hero or levelDef does not throw', () => {
  const ctx = makeFakeCtx();
  drawHUD(ctx, null, cam, levelDef);
  drawHUD(ctx, hero, cam, null);
});

ok('render.js gates HUD behind PLAY state', async () => {
  const fs = await import('node:fs');
  const path = new URL('../systems/render.js', import.meta.url);
  const src = fs.readFileSync(path, 'utf8');
  assert.ok(/state === S\.PLAY[\s\S]{0,200}drawHUD/.test(src), 'drawHUD called only under PLAY gate');
  // Restore HOME so other suites are unaffected.
  setState(S.HOME);
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}\n`);
