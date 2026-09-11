// Petal Panic — render system. Draws in 960x540 logical coords; the
// logical→screen transform is applied by main.js before this runs.
//
// Task 1.4: world entities are drawn under a camera translate so the level
// scrolls horizontally, and F3 toggles the full design §16 colored-box debug
// overlay (orange/green/red/blue/pink by collision layer).

import { VIEW_W, VIEW_H } from '../view.js';
import { getHero, getSolids, getEnemies, getAnimTestEnemy, getProjectiles, getPickups, getCamera, isDebugEnabled, getJester, getParticles, getCoins, getBarrels, getShakeOffset, getPowerups, getCheckpoints, getFloatTexts } from './update.js';
import { getState, STATE_NAMES } from '../state.js';

export function render(ctx) {
  const cam = getCamera();

  // Background (viewport-space; not affected by the camera).
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // --- World (camera-translated) -------------------------------------------
  ctx.save();
  // Task 4.1 — explosion screen shake offsets the whole world by a decaying
  // random vector (getShakeOffset returns {x:0,y:0} when idle).
  const shake = getShakeOffset();
  ctx.translate(-cam.x + shake.x, -cam.y + shake.y);

  // Solid platforms (orange per design §16 debug palette).
  for (const s of getSolids()) {
    ctx.fillStyle = '#ff9f43';
    ctx.fillRect(s.x, s.y, s.w, s.h);
  }

  // Task 4.1 — destructible barrels (drawn via Entity.draw; white flash on hit).
  for (const b of getBarrels()) {
    if (!b.alive) continue; // destroyed barrel is removed from play
    b.draw(ctx);
    if (isDebugEnabled() && b.hp != null && b.maxHp > 0) drawHpBar(ctx, b);
  }

  // Placeholder pickups / enemies / projectiles (debug-colored bodies).
  for (const p of getPickups()) p.draw(ctx);
  for (const e of getEnemies()) {
    if (e.alive === false) continue; // destroyed target — no longer drawn
    e.draw(ctx);
    // Task 3.2 — white flash when struck (melee or projectile).
    if (e.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, e.hitFlash * 10);
      const eb = e.worldBox();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(eb.x, eb.y, eb.w, eb.h);
      ctx.restore();
    }
    if (e.hp != null && e.maxHp > 0) drawHpBar(ctx, e);
  }

  // Task 3.3 — Jester enemy (draws itself including death shrink/fade + whip).
  const jester = getJester();
  if (jester.alive) {
    jester.draw(ctx);
    if (jester.hp != null && jester.maxHp > 0 && jester.aiState !== 'dead') {
      drawHpBar(ctx, jester);
    }
  }

  // Task 3.3 — sparkle particles + dropped coins.
  for (const s of getParticles().activeItems) s.draw(ctx);
  for (const c of getCoins().activeItems) c.draw(ctx);

  // Task 4.3 — checkpoints (flags) + powerups (signboards). Both draw themselves
  // (Entity transform pipeline + bob/flash overlays).
  for (const c of getCheckpoints()) c.draw(ctx);
  for (const p of getPowerups()) p.draw(ctx);

  // Task 4.3 — floating value-text popups (powerup labels, checkpoint ids).
  for (const t of getFloatTexts()) t.draw(ctx);

  // Task 4.2 — F3 debug: show each coin's value as small text above it so the
  // per-type weight/value difference is visible during development.
  if (isDebugEnabled()) {
    ctx.save();
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    for (const c of getCoins().activeItems) {
      if (!c.alive || c.collected) continue;
      const cx = c.x + c.w / 2;
      const cy = c.y - 4;
      ctx.fillStyle = c.debugColor ?? '#fff';
      ctx.fillText(String(c.value), cx, cy);
    }
    // Task 4.3 — F3 debug: powerup type label above each live powerup, and the
    // checkpoint id above each flag (triggered ones dimmed).
    for (const p of getPowerups()) {
      if (!p.alive || p.collected) continue;
      const cx = p.x + p.w / 2;
      const cy = p.y - 6;
      ctx.fillStyle = p.def.color;
      ctx.fillText(p.powerType.toUpperCase(), cx, cy);
    }
    for (const c of getCheckpoints()) {
      if (!c.alive) continue;
      const cx = c.x + c.w / 2;
      const cy = c.y - 6;
      ctx.fillStyle = c.triggered ? 'rgba(255,215,0,0.4)' : '#ffd700';
      ctx.fillText(`[${c.checkpointId}]`, cx, cy);
    }
    ctx.restore();
  }

  getAnimTestEnemy().draw(ctx);
  for (const p of getProjectiles()) p.draw(ctx);

  // Hero test box — drawn through Entity.draw() so the full transform
  // pipeline (mirror/rotate/scale + debug rect fallback) is exercised.
  // Task 4.3 — Invincibility blink: while invincibleTimer > 0 the hero sprite
  // alternates visible/invisible every 0.1s (design §12 "Invincibility active").
  {
    const h = getHero();
    if (h.invincibleTimer > 0 && Math.floor(h.invincibleTimer / 0.1) % 2 === 0) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      h.draw(ctx);
      ctx.restore();
    } else {
      h.draw(ctx);
    }
  }

  // Debug overlay (F3): full §16 colored boxes over every entity's worldBox().
  if (isDebugEnabled()) {
    drawDebugOverlay(ctx);
    // Task 3.3 — jester-specific debug: aggro radius circle + AI state label.
    drawJesterDebug(ctx, getJester());
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
  // Task 4.2 — coin + lives readout (design §14). Shows total coins collected
  // and current lives; the 1up threshold (every 100) is visible via the lives
  // counter incrementing.
  ctx.fillStyle = '#ffd700';
  ctx.fillText(`COINS ${hero.stats.coinsCollected?.total ?? 0}   LIVES ${hero.lives}`, 8, VIEW_H - 30);
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
               ...getPickups(), ...getEnemies(), ...getProjectiles(), getHero(),
               ...getBarrels()];

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

  // Task 3.2 — draw the melee hitbox in YELLOW when active (debug only).
  const hero = getHero();
  const mh = hero.meleeHitboxWorld;
  if (mh) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(mh.x, mh.y, mh.w, mh.h);
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 2;
    ctx.strokeRect(mh.x, mh.y, mh.w, mh.h);
    ctx.restore();
  }

  // Task 4.1 — magenta rings showing each live explosive barrel's AoE radius
  // (design §16: "Magenta ring — explosion AoE radius").
  for (const b of getBarrels()) {
    if (!b.alive || !b.explosive || b.explodeRadius <= 0) continue;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#ff6ec7';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, b.explodeRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
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

// --- Task 3.3 — Jester debug overlay (F3) ------------------------------------
// Draws the aggro radius as a faint circle and the current AI state as a label
// above the jester's head. Helps validate the state machine during development.

/**
 * Draw jester-specific debug info: aggro circle + AI state label.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Jester} j the jester entity
 */
function drawJesterDebug(ctx, j) {
  if (!j || !j.alive) return; // only draw while the jester exists (including death anim)

  const cx = j.x + j.w / 2;
  const cy = j.y + j.h / 2;

  // Aggro radius circle (faint).
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, j.aggroRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // AI state label above head.
  ctx.save();
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = j.aiState === 'chase' ? '#f39c12' :
                  j.aiState === 'attack' ? '#e74c3c' :
                  j.aiState === 'dead' ? '#999' : '#aaa';
  ctx.fillText(j.aiState.toUpperCase(), cx, j.y - 14);
  // Whip cooldown indicator (small number below state).
  if (j.whipCooldown > 0) {
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`cd:${j.whipCooldown.toFixed(1)}s`, cx, j.y - 4);
  }
  ctx.restore();
}
