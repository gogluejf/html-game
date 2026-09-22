// Task 8.3 — Play HUD tests (node-based).
// Run: node js/test/hud83.test.js
//
// Verifies drawHUD renders all design §20 elements against a fake ctx that
// records fills/text, and that values track live hero state (energy bar fill,
// shield overlay, ammo/special/coins/lives, checkpoint markers + hero marker).

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
  base.arc = (x, y, r) => { rec.arcs.push({ x, y, r }); };
  base.moveTo = (x, y) => { rec.lines.push({ kind: 'moveTo', x, y }); };
  base.lineTo = (x, y) => { rec.lines.push({ kind: 'lineTo', x, y }); };
  return base;
}

// Dynamic imports AFTER the stub is in place.
const U = await import('../systems/update.js');
const { S, setState } = await import('../state.js');
const { LEVELS } = await import('../level.js');
const { VIEW_W, VIEW_H } = await import('../view.js');
const { drawHUD } = await import('../hud.js');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('\nTask 8.3 — Play HUD\n');

const hero = U.getHero();
const levelDef = LEVELS[0];
// Task 2.1: the HUD progress track renders the DEPRECATED single corridor, so
// its geometry (checkpoints, length) lives on levelDef.LEGACY.
const corridor = levelDef.LEGACY;
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

ok('ammo readout shows thorn + special counts live', () => {
  const ctx = makeFakeCtx();
  hero.ammo = 123;
  hero.specialAmmo = 7;
  drawHUD(ctx, hero, cam, levelDef);
  const joined = ctx.texts.map(t => t.t).join(' | ');
  assert.ok(joined.includes('123'), `thorn count visible (${joined})`);
  assert.ok(joined.includes('7'), 'special count visible');
  assert.ok(joined.includes('🌿'), 'thorn icon present');
  const specialIcon = hero.heroDef?.special === 'saw' ? '⚙️' : '💣';
  assert.ok(joined.includes(specialIcon), `hero-specific special icon (${specialIcon}) present`);
});

ok('coins + lives display live', () => {
  const ctx = makeFakeCtx();
  hero.coins = 150;
  hero.lives = 2;
  drawHUD(ctx, hero, cam, levelDef);
  const joined = ctx.texts.map(t => t.t).join(' | ');
  assert.ok(joined.includes('💰 150'), `coin readout (${joined})`);
  assert.ok(joined.includes('❤️ × 2'), 'lives readout');
});

ok('checkpoint line: markers for every checkpoint id', () => {
  const ctx = makeFakeCtx();
  drawHUD(ctx, hero, cam, levelDef);
  const ids = corridor.checkpoints.map(c => c.id);
  for (const id of ids) {
    assert.ok(ctx.texts.some(t => t.t === id), `marker label "${id}" drawn`);
  }
  // One arc per checkpoint marker + one for the hero dot.
  assert.ok(ctx.arcs.length >= ids.length + 1, `arcs ≥ checkpoints+hero (${ctx.arcs.length})`);
});

ok('checkpoint line: marker positions scale by cp.x / length', () => {
  const ctx = makeFakeCtx();
  drawHUD(ctx, hero, cam, levelDef);
  const lineX = VIEW_W * 0.2, lineW = VIEW_W * 0.6;
  for (const cp of corridor.checkpoints) {
    const expectX = lineX + (cp.x / corridor.length) * lineW;
    const m = ctx.arcs.find(a => a.r === 5 && Math.abs(a.x - expectX) < 1);
    assert.ok(m, `checkpoint ${cp.id} marker at expected x≈${expectX.toFixed(1)}`);
  }
});

ok('hero position marker clamped to [start, end] of track', () => {
  const lineX = VIEW_W * 0.2, lineW = VIEW_W * 0.6;
  const before = hero.x;
  try {
    // At start → marker near track start.
    hero.x = 0;
    let ctx = makeFakeCtx();
    drawHUD(ctx, hero, cam, levelDef);
    let dot = ctx.arcs.find(a => a.r === 6);
    assert.ok(dot && Math.abs(dot.x - lineX) < 2, 'hero dot at track start');

    // Mid-level → proportional position.
    hero.x = corridor.length / 2;
    ctx = makeFakeCtx();
    drawHUD(ctx, hero, cam, levelDef);
    dot = ctx.arcs.find(a => a.r === 6);
    assert.ok(dot && Math.abs(dot.x - (lineX + lineW / 2)) < 2, 'hero dot mid-track');

    // Past the end → clamped to track end.
    hero.x = corridor.length * 2;
    ctx = makeFakeCtx();
    drawHUD(ctx, hero, cam, levelDef);
    dot = ctx.arcs.find(a => a.r === 6);
    assert.ok(dot && Math.abs(dot.x - (lineX + lineW)) < 2, 'hero dot clamped at track end');
  } finally {
    hero.x = before;
  }
});

ok('portrait: 32×32 box drawn in top-right corner', () => {
  const ctx = makeFakeCtx();
  drawHUD(ctx, hero, cam, levelDef);
  const box = ctx.lines.find(l => l.kind === 'rect' && l.w === 32 && l.h === 32);
  assert.ok(box, '32×32 portrait frame stroked');
  assert.ok(box.x > VIEW_W - 60, 'portrait sits in the right corner');
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
