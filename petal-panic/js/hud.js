// Petal Panic — Play HUD (design §20, ).
// Viewport-space overlay drawn AFTER the camera translate is restored, so it
// never scrolls with the world. Pure canvas rects + text (functional-first;
// visual polish later). Reads only live player state:
//   - energy bar (red fill) with cyan shield overlay on top
//   - thorn ammo + special ammo counts (hero-specific special icon)
//   - coins + lives (top-right)
//   - selected-hero portrait (32×32, top-right corner)
//   - checkpoint progress line: track + checkpoint markers + hero position
// ES module, no frameworks. No DOM access beyond the passed ctx.

import { VIEW_W, VIEW_H } from './view.js';
import { FONT_UI, CREAM, GOLD } from './fonts.js';
import { buildLevelZones } from './level.js';

const PAD = 12;

/**
 * Resolve the level's zones for the progress track (zone model, MINOR 11).
 * @param {object} levelDef a LEVELS entry (provides the level index)
 * @returns {object[]} the zones in play order
 */
function buildZones(levelDef) {
  return buildLevelZones(levelDef);
}

/**
 * The active zone's index within the zone list, from the hero's currentArea
 * (zone-model convention: -1..-4 → zones 0..3, boss → last zone).
 */
function activeZoneIndex(hero, zones) {
  const a = hero?.currentArea;
  if (typeof a !== 'number') return 0;
  const idx = a <= -1 ? -(a) - 1 : a;
  return Math.min(Math.max(idx, 0), zones.length - 1);
}

/**
 * Draw the full play HUD in viewport space.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} hero live Hero instance (energy, maxEnergy, shield, ammo,
 *        specialAmmo, coins, lives, x, w, heroDef, currentArea)
 * @param {object} _camera unused for now (kept in signature per design §20;
 *        the HUD is viewport-space and needs no camera math)
 * @param {object} levelDef level definition (LEVELS entry; provides index)
 * @param {object[]} [zones] the level's zones (buildLevelZones); defaults to
 *        the first level's zones (MINOR 11: zone-model progress track).
 */
export function drawHUD(ctx, hero, _camera, levelDef, zones) {
  if (!hero || !levelDef) return;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  drawEnergyBar(ctx, hero);
  drawSuperMeter(ctx, hero);
  drawAmmo(ctx, hero);
  drawCoinsAndLives(ctx, hero);
  drawPortrait(ctx, hero);
  drawProgressLine(ctx, hero, zones ?? buildZones(levelDef), activeZoneIndex(hero, zones ?? buildZones(levelDef)));

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

// --- Checkpoint progress line (bottom-center) ---------------------------------

/**
 * Draw the zone progress track. MINOR 11: the track is ZONE-MODEL driven —
 * one marker per sealed zone (areas -1..-4 + boss, in play order) plus a
 * hero-position marker inside the ACTIVE zone (its own local width). The
 * deprecated single-corridor track (levelDef.LEGACY) is gone.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} hero live Hero instance
 * @param {object[]} zones the level's zones (buildLevelZones)
 * @param {number} activeIdx index of the active zone within `zones`
 */
function drawProgressLine(ctx, hero, zones, activeIdx) {
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

  const n = zones.length;
  ctx.font = `10px ${FONT_UI}`;
  ctx.textAlign = 'center';
  zones.forEach((z, i) => {
    const cx = lineX + (i + 0.5) / n * lineW;
    const passed = i < activeIdx;
    const isCurrent = i === activeIdx;
    ctx.fillStyle = passed ? 'rgba(243, 156, 18, 0.4)'
      : isCurrent ? '#2ecc71' : '#f39c12';
    ctx.beginPath();
    ctx.arc(cx, lineY, isCurrent ? 6 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = passed ? 'rgba(255,255,255,0.4)' : '#fff';
    ctx.fillText(z.kind === 'boss' ? 'B' : `${-z.areaIdx}`, cx, lineY - 8);
  });

  // Hero position marker: a marker inside the ACTIVE zone's cell, at the
  // hero's local x fraction (zones are independent worlds, so the hero's
  // progress is only meaningful within its own zone).
  const zone = zones[activeIdx];
  if (zone && zone.bounds && zone.bounds.w > 0) {
    const frac = Math.max(0, Math.min(1, (hero.x - zone.bounds.x) / zone.bounds.w));
    const cellW = lineW / n;
    const hx = lineX + (activeIdx + 0.5 + (frac - 0.5) * 0.8) * cellW;
    ctx.fillStyle = '#2ecc71';
    ctx.beginPath();
    ctx.arc(hx, lineY, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
