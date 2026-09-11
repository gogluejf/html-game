// Petal Panic — Play HUD (design §20, Task 8.3).
//
// Viewport-space overlay drawn AFTER the camera translate is restored, so it
// never scrolls with the world. Pure canvas rects + text (functional-first;
// visual polish later). Reads only live player state:
//   - energy bar (red fill) with cyan shield overlay on top
//   - thorn ammo + special ammo counts (hero-specific special icon)
//   - coins + lives (top-right)
//   - selected-hero portrait (32×32, top-right corner)
//   - checkpoint progress line: track + checkpoint markers + hero position
//
// ES module, no frameworks. No DOM access beyond the passed ctx.

import { VIEW_W, VIEW_H } from './view.js';
import { FONT_UI, CREAM, GOLD } from './fonts.js';

const PAD = 12;

/**
 * Draw the full play HUD in viewport space.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} hero live Hero instance (energy, maxEnergy, shield, ammo,
 *        specialAmmo, coins, lives, x, w, heroDef)
 * @param {object} _camera unused for now (kept in signature per design §20;
 *        the HUD is viewport-space and needs no camera math)
 * @param {object} levelDef level definition ({ length, checkpoints: [{id,x}] })
 */
export function drawHUD(ctx, hero, _camera, levelDef) {
  if (!hero || !levelDef) return;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  drawEnergyBar(ctx, hero);
  drawAmmo(ctx, hero);
  drawCoinsAndLives(ctx, hero);
  drawPortrait(ctx, hero);
  drawProgressLine(ctx, hero, levelDef);

  ctx.restore();
}

// --- Energy bar (top-left): red fill + cyan shield overlay -------------------

function drawEnergyBar(ctx, hero) {
  const barX = PAD, barY = PAD, barW = 200, barH = 16;

  // Background.
  ctx.fillStyle = '#333';
  ctx.fillRect(barX, barY, barW, barH);

  // Energy fill (red), clamped to [0,1].
  const energyFrac = Math.max(0, Math.min(1, hero.energy / hero.maxEnergy));
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(barX, barY, barW * energyFrac, barH);

  // Shield overlay (cyan) stacked after the energy fill, scaled down so a
  // full shield reads as half the bar width.
  if (hero.shield > 0) {
    const shieldFrac = Math.min(1, hero.shield / hero.maxEnergy);
    const start = barX + barW * energyFrac;
    const w = Math.min(barW * shieldFrac * 0.5, barW - barW * energyFrac);
    ctx.fillStyle = 'rgba(0, 200, 255, 0.7)';
    ctx.fillRect(start, barY, w, barH);
  }

  // Border + label.
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barW, barH);
  ctx.fillStyle = CREAM;
  ctx.font = `12px ${FONT_UI}`;
  ctx.textAlign = 'left';
  ctx.fillText('ENERGY', barX, barY + barH + 11);
}

// --- Ammo (below energy): thorn count + special count ------------------------

function drawAmmo(ctx, hero) {
  const y = PAD + 16 + 28; // below the ENERGY label
  ctx.font = `15px ${FONT_UI}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2ecc71';
  ctx.fillText(`🌿 ${hero.ammo ?? 0}`, PAD, y);
  const specialIcon = hero.heroDef?.special === 'saw' ? '⚙️' : '💣';
  ctx.fillStyle = '#9b59b6';
  ctx.fillText(`${specialIcon} ${hero.specialAmmo ?? 0}`, PAD + 80, y);
}

// --- Coins + lives (top-right) -----------------------------------------------

function drawCoinsAndLives(ctx, hero) {
  ctx.textAlign = 'right';
  ctx.font = `17px ${FONT_UI}`;
  ctx.fillStyle = GOLD;
  ctx.fillText(`💰 ${hero.coins ?? 0}`, VIEW_W - PAD, PAD + 16);
  ctx.fillStyle = '#e74c3c';
  ctx.fillText(`❤️ × ${hero.lives ?? 0}`, VIEW_W - PAD, PAD + 36);
}

// --- Selected-hero portrait (32×32, top-right corner, above coins) -----------

const PORTRAIT_PATHS = {
  scarlet: 'assets/heroes/scarlet_vale_idle_f1.png',
  balthazar: 'assets/heroes/balthazar_idle_f1.png',
};

// Lazily-created Image cache (one per hero id). Missing images fall back to a
// colored box + initial so the HUD still works before assets load or in node.
const portraits = new Map();

function getPortraitImage(heroId) {
  let img = portraits.get(heroId);
  if (img) return img;
  const path = PORTRAIT_PATHS[heroId];
  if (!path || typeof Image === 'undefined') return null;
  img = new Image();
  img.src = path;
  portraits.set(heroId, img);
  return img;
}

function drawPortrait(ctx, hero) {
  const size = 32;
  const x = VIEW_W - PAD - size;
  const y = PAD + 44; // below the lives line

  const img = getPortraitImage(hero.heroDef?.id);
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, x, y, size, size);
  } else {
    // Placeholder: hero-colored box + name initial.
    ctx.fillStyle = hero.heroDef?.id === 'balthazar' ? '#5a3d8a' : '#8a2d3b';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#fff';
    ctx.font = `bold 15px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((hero.heroDef?.name ?? '?').charAt(0), x + size / 2, y + size / 2);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size, size);
}

// --- Checkpoint progress line (bottom-center) ---------------------------------

function drawProgressLine(ctx, hero, levelDef) {
  const lineY = VIEW_H - 30;
  const lineX = VIEW_W * 0.2;
  const lineW = VIEW_W * 0.6;

  // Track.
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(lineX, lineY);
  ctx.lineTo(lineX + lineW, lineY);
  ctx.stroke();

  // Checkpoint markers (dimmed once the hero has passed them).
  if (Array.isArray(levelDef.checkpoints)) {
    ctx.font = `10px ${FONT_UI}`;
    ctx.textAlign = 'center';
    for (const cp of levelDef.checkpoints) {
      const frac = Math.max(0, Math.min(1, cp.x / levelDef.length));
      const cx = lineX + frac * lineW;
      const passed = hero.x >= cp.x;
      ctx.fillStyle = passed ? 'rgba(243, 156, 18, 0.4)' : '#f39c12';
      ctx.beginPath();
      ctx.arc(cx, lineY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = passed ? 'rgba(255,255,255,0.4)' : '#fff';
      ctx.fillText(cp.id, cx, lineY - 8);
    }
  }

  // Hero position marker (clamped to the track).
  const heroFrac = Math.max(0, Math.min(1, (hero.x + hero.w / 2) / levelDef.length));
  const hx = lineX + heroFrac * lineW;
  ctx.fillStyle = '#2ecc71';
  ctx.beginPath();
  ctx.arc(hx, lineY, 6, 0, Math.PI * 2);
  ctx.fill();
  // Small triangle pointer below the dot.
  ctx.beginPath();
  ctx.moveTo(hx - 4, lineY + 8);
  ctx.lineTo(hx + 4, lineY + 8);
  ctx.lineTo(hx, lineY + 14);
  ctx.closePath();
  ctx.fill();
}
