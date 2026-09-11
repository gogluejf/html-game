// Petal Panic — render system. Draws in 960x540 logical coords; the
// logical→screen transform is applied by main.js before this runs.
//
// Task 1.4: world entities are drawn under a camera translate so the level
// scrolls horizontally, and F3 toggles the full design §16 colored-box debug
// overlay (orange/green/red/blue/pink by collision layer).

import { VIEW_W, VIEW_H } from '../view.js';
import { getHero, getSolids, getEnemies, getAnimTestEnemy, getProjectiles, getPickups, getCamera, isDebugEnabled } from './update.js';
import { getState, STATE_NAMES } from '../state.js';

export function render(ctx) {
  const cam = getCamera();

  // Background (viewport-space; not affected by the camera).
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // --- World (camera-translated) -------------------------------------------
  ctx.save();
  ctx.translate(-cam.x, -cam.y);

  // Solid platforms (orange per design §16 debug palette).
  for (const s of getSolids()) {
    ctx.fillStyle = '#ff9f43';
    ctx.fillRect(s.x, s.y, s.w, s.h);
  }

  // Placeholder pickups / enemies / projectiles (debug-colored bodies).
  for (const p of getPickups()) p.draw(ctx);
  for (const e of getEnemies()) {
    if (e.alive === false) continue; // destroyed target — no longer drawn
    e.draw(ctx);
    if (e.hp != null && e.maxHp > 0) drawHpBar(ctx, e);
  }
  getAnimTestEnemy().draw(ctx);
  for (const p of getProjectiles()) p.draw(ctx);

  // Hero test box — drawn through Entity.draw() so the full transform
  // pipeline (mirror/rotate/scale + debug rect fallback) is exercised.
  getHero().draw(ctx);

  // Debug overlay (F3): full §16 colored boxes over every entity's worldBox().
  if (isDebugEnabled()) {
    drawDebugOverlay(ctx);
  }

  ctx.restore();

  // --- Viewport-space HUD hint (not scrolled with the world) -----------------
  if (isDebugEnabled()) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '12px monospace';
    ctx.fillText('DEBUG ON — F3 to toggle', 8, 16);
  }

  // Task 3.1 — thorn ammo readout so "no fire at 0" is observable.
  const hero = getHero();
  ctx.save();
  ctx.fillStyle = '#ff6ec7';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`THORNS ${hero.ammo}`, 8, VIEW_H - 12);
  ctx.restore();

  // --- State overlay (skeleton; replaced by real screens in Milestone 8) -----
  drawStateOverlay(ctx);
}

/**
 * Minimal state indicator shown when not in PLAY. The full per-state screens
 * land in Milestone 8; this keeps the skeleton visible/testable today.
 */
function drawStateOverlay(ctx) {
  const s = getState();
  const label = STATE_NAMES[s] || String(s);
  const hint =
    s === 0 ? 'HOME — press Enter' :
    s === 1 ? 'SELECT — press Enter' :
    s === 3 ? 'PAUSE' :
    s === 4 ? 'GAME OVER' :
    s === 5 ? 'WIN' : '';

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 48px monospace';
  ctx.fillText(label, VIEW_W / 2, VIEW_H / 2 - 8);
  if (hint) {
    ctx.font = '18px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(hint, VIEW_W / 2, VIEW_H / 2 + 28);
  }
  ctx.restore();
}

/**
 * Design §16 debug overlay: semi-transparent filled rects + outlines over each
 * entity's worldBox(), color-coded by collision layer.
 *   Orange — SOLID (level platforms)
 *   Green  — HERO
 *   Red    — ENEMY
 *   Blue   — PICKUP (objects / powerups)
 *   Pink   — PROJ_ALLY / PROJ_FOE (projectiles / explosions)
 */
function drawDebugOverlay(ctx) {
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 2;

  const layers = [
    { match: L => L & 0b0000001000, color: '#ff9f43' }, // SOLID → orange
    { match: L => L & 0b0000000001, color: '#2ecc71' }, // HERO  → green
    { match: L => L & 0b0000000010, color: '#e74c3c' }, // ENEMY → red
    { match: L => L & 0b0000010000, color: '#3498db' }, // PICKUP→ blue
    { match: L => L & 0b0001100000, color: '#ff6ec7' }, // PROJ  → pink
  ];

  const all = [...getSolids().map(s => solidEntityProxy(s)),
               ...getPickups(), ...getEnemies(), ...getProjectiles(), getHero()];

  for (const ent of all) {
    const layer = ent.layer ?? 0;
    const rule = layers.find(r => r.match(layer));
    if (!rule) continue;
    const b = ent.worldBox ? ent.worldBox() : ent;
    ctx.fillStyle = rule.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = rule.color;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }

  ctx.restore();
}

// SOLIDS are plain AABBs ({x,y,w,h}); wrap them as a minimal proxy so the
// overlay loop can treat them uniformly with Entity instances (worldBox()).
function solidEntityProxy(box) {
  return { x: box.x, y: box.y, w: box.w, h: box.h, layer: 0b0000001000, worldBox: () => box };
}

/** Task 3.1 — small HP bar above a targetable enemy so thorn damage is visible. */
function drawHpBar(ctx, e) {
  const frac = Math.max(0, e.hp / e.maxHp);
  const w = e.w, h = 4;
  const x = e.x, y = e.y - 8;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#2ecc71';
  ctx.fillRect(x, y, w * frac, h);
}
