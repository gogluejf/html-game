// Petal Panic — Play HUD (design §20, ).
// Viewport-space overlay drawn AFTER the camera translate is restored, so it
// never scrolls with the world. Pure canvas rects + text (functional-first;
// visual polish later). Reads only live player state:
//   - energy bar (red fill) with cyan shield overlay on top
//   - thorn ammo + special ammo counts (hero-specific special icon)
//   - coins + lives (top-right)
//   - selected-hero portrait (32×32, top-right corner)
// ES module, no frameworks. No DOM access beyond the passed ctx.

import { VIEW_W } from './view.js';
import { FONT_UI, GOLD } from './fonts.js';

const PAD = 12;

/**
 * Draw the full play HUD in viewport space.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} hero live Hero instance (energy, maxEnergy, shield, ammo,
 *        specialAmmo, coins, lives, x, w, heroDef, currentArea)
 * @param {object} _camera unused for now (kept in signature per design §20;
 *        the HUD is viewport-space and needs no camera math)
 * @param {object} levelDef level definition (LEVELS entry; provides index)
 */
export function drawHUD(ctx, hero, _camera, levelDef) {
  if (!hero || !levelDef) return;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  drawEnergyBar(ctx, hero);
  drawSuperMeter(ctx, hero);
  drawAmmo(ctx, hero);
  drawCoinsAndLives(ctx, hero);
  drawPortrait(ctx, hero);

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

  // Border.
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barW, barH);
}

// --- Super meter (below energy): purple fill, blinks when full ---------------

function drawSuperMeter(ctx, hero) {
  const barX = PAD, barY = PAD + 16 + 4, barW = 100, barH = 8; // half size of energy bar

  // Background.
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(barX, barY, barW, barH);

  // Fill (purple).
  const frac = Math.max(0, Math.min(1, hero.supermoveMeter / hero.SUPERMOVE_MAX));
  ctx.fillStyle = '#9b59b6';
  ctx.fillRect(barX, barY, barW * frac, barH);

  // Blink when full: alternate visibility at ~4Hz.
  if (frac >= 1 && !hero.supermoveActive) {
    const blink = Math.floor(performance.now() * 0.004) % 2 === 0;
    if (blink) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillRect(barX, barY, barW, barH);
    }
  }

  // Border.
  ctx.strokeStyle = frac >= 1 ? '#fff' : '#666';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barW, barH);
}

// --- Ammo (below energy): thorn count + special count ------------------------
// §21: the currently SELECTED weapon is indicated with a '>' marker so the
// player always knows which weapon J will fire. N toggles the selection.

function drawAmmo(ctx, hero) {
  const y = PAD + 16 + 19; // just below the energy bar (no label anymore)
  ctx.font = `15px ${FONT_UI}`;
  ctx.textAlign = 'left';
  const thornSelected = hero.selectedWeapon !== 'special';
  const thornMark = thornSelected ? '> ' : '  ';
  ctx.fillStyle = thornSelected ? '#2ecc71' : 'rgba(46, 204, 113, 0.45)';
  ctx.fillText(`${thornMark}🌿 ${hero.ammo ?? 0}`, PAD, y);
  const specialIcon = hero.heroDef?.special === 'saw' ? '⚙️' : '💣';
  const specialMark = thornSelected ? '  ' : '> ';
  ctx.fillStyle = thornSelected ? 'rgba(155, 89, 182, 0.45)' : '#9b59b6';
  ctx.fillText(`${specialMark}${specialIcon} ${hero.specialAmmo ?? 0}`, PAD + 80, y);
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


