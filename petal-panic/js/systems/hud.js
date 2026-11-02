// Petal Panic — Play HUD (design §20, ).
// Viewport-space overlay drawn AFTER the camera translate is restored, so it
// never scrolls with the world. Pure canvas rects + text (functional-first;
// visual polish later). Reads only live player state:
//   - energy bar (red fill) with cyan shield overlay on top
//   - weapon readout: default marker + special slot icons
//   - coins + lives (top-right)
//   - selected-hero portrait (32×32, top-right corner)
// ES module, no frameworks. No DOM access beyond the passed ctx.

import { surfaceBounds } from '../core/layout.js';
import { FONT_UI, GOLD } from '../ui/fonts.js';
import { specialById } from '../objects/specialWeapons.js';
import { getProjectileSpriteData, getProjectileFrames, getSpecialSpriteData } from '../objects/projectile.js';

const PAD = 12;
const ROW_GAP = 6;   // vertical gap between HUD rows (cursor stack)

/**
 * Draw the full play HUD in viewport space.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} hero live Hero instance (energy, maxEnergy, shield,
 *        specialSlots, selectedWeapon, coins, lives, x, w, heroDef, currentArea)
 * @param {object} _camera unused for now (kept in signature per design §20;
 *        the HUD is viewport-space and needs no camera math)
 * @param {object} levelDef level definition (LEVELS entry; provides index)
 */
export function drawHUD(ctx, hero, _camera, levelDef) {
  if (!hero || !levelDef) return;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const bounds = surfaceBounds();

  // Cursor stack: one Y cursor, each row draws at the cursor and reports its
  // height — nobody hardcodes their own Y, so rows can never overlap.
  let y = bounds.y + PAD;
  const energyH = drawEnergyBar(ctx, hero, bounds);  // row 1: red energy bar
  y += energyH + ROW_GAP;
  const superH = drawSuperMeter(ctx, hero, bounds, y); // row 2: purple, under red
  y += superH + ROW_GAP;
  drawAmmo(ctx, hero, bounds, y);                 // row 3: weapons, below both bars
  drawCoinsAndLives(ctx, hero, bounds);
  drawPortrait(ctx, hero, bounds);

  ctx.restore();
}

// --- Row 1: energy bar (red fill + cyan shield overlay) ----------------------
// Returns its pixel height so the cursor stack can place the next row below.

function drawEnergyBar(ctx, hero, bounds) {
  const barX = bounds.x + PAD, barY = bounds.y + PAD, barW = 200, barH = 16;

  // Energy fraction (0..1).
  const energyFrac = Math.max(0, Math.min(1, hero.energy / hero.maxEnergy));
  // Shield fraction: same scale as energy.
  const shieldFrac = Math.max(0, hero.shield / hero.maxEnergy);

  // Bar container: ALWAYS at least full width (barW). Extends beyond 100%
  // only when energy + shield exceeds max. Never shrinks below the full bar.
  const totalFrac = Math.max(1, energyFrac + shieldFrac);
  const extW = barW * totalFrac;

  // Background (full bar, possibly extended).
  ctx.fillStyle = '#333';
  ctx.fillRect(barX, barY, extW, barH);

  // Energy fill (red) — shows current energy as a fraction of the FULL bar.
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(barX, barY, barW * energyFrac, barH);

  // Shield (cyan) — stacked after the red. When energy < 100%, the blue
  // fills the gap inside the bar. When energy + shield > 100%, it extends
  // beyond the normal bar edge.
  if (shieldFrac > 0) {
    const shieldStart = barX + barW * energyFrac;
    const shieldW = barW * shieldFrac;
    ctx.fillStyle = 'rgba(0, 200, 255, 0.8)';
    ctx.fillRect(shieldStart, barY, shieldW, barH);
  }

  // Border tracks the container width.
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, extW, barH);

  return barH; // row height for the cursor stack
}

// --- Row 2: super meter (purple fill, blinks when full) ----------------------
// Drawn at the cursor Y (below the energy bar), left-aligned with it.

function drawSuperMeter(ctx, hero, bounds, y) {
  const barX = bounds.x + PAD, barY = y, barW = 100, barH = 8; // half size of energy bar

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

  return barH; // row height for the cursor stack
}

// --- Row 3: weapon slots (glass tiles with REAL projectile art) --------------
// special-weapons.md: the default weapon (thorn) is built-in; each special
// slot shows its held weapon. Every tile renders frame f1 of that weapon's
// ACTUAL projectile sheet — borrowed from the loaders the game already runs
// (projectile.js: getProjectileSpriteData for thorn, getSpecialSpriteData for
// specials). No duplicated images, no emoji icons. The selected tile gets a
// bright ring + chevron. Living effect: every 10–20s a random filled tile
// plays its sheet anim once at the sheet's real fps, with a tiny scale pulse.


const TILE = 40;        // tile size (px)
const TILE_GAP = 8;     // gap between tiles
const ICON_FRAC = 0.72; // icon drawn at 72% of the tile (breathing room)

// Per-tile living-effect state (module-level; HUD is single-instance).
const _slotFx = new Map(); // slotIndex → { start, dur }

/** Resolve the {list, fps} for a tile: thorn or a special type. Null pre-boot. */
function tileIcon(slotIdx, type) {
  let data, animName, imgs;
  if (type == null) return null;                    // empty slot
  if (slotIdx === 0) {
    // Thorn: parseSheet data has NO _frames attached (only specials get that);
    // its frame images live in the shared projectileFrames cache.
    data = getProjectileSpriteData();
    animName = 'shoot';
    imgs = getProjectileFrames();
  } else {
    // type IS the weapon id ('bomb' | 'saw' | ...) — specialSlots stores ids.
    const meta = specialById[type];
    if (!meta) return null;
    data = getSpecialSpriteData(type);
    animName = meta.spriteAnim;
    imgs = data?.anims[animName]?._frames ?? null;
  }
  if (!data?.anims[animName]) return null;
  const anim = data.anims[animName];
  if (!imgs || imgs.size === 0) return null;        // pre-boot / node
  const list = anim.frames.map(f => imgs.get(f.file)).filter(Boolean);
  if (list.length === 0) return null;
  return { list, fps: anim.fps ?? 12 };
}

function drawAmmo(ctx, hero, bounds, y) {
  const now = performance.now();
  const baseX = bounds.x + PAD;
  const n = 1 + (hero.specialSlots?.length ?? 0); // thorn + special slots

  for (let i = 0; i < n; i++) {
    const isThorn = i === 0;
    const type = isThorn ? 'thorn' : hero.specialSlots[i - 1];
    const sel = isThorn ? !Number.isInteger(hero.selectedWeapon) : hero.selectedWeapon === i - 1;
    const tx = baseX + i * (TILE + TILE_GAP);
    const ty = y + 2; // small extra breathing room below the super meter

    // --- Glass tile ----------------------------------------------------------
    ctx.save();
    // Fill: dark translucent glass.
    ctx.fillStyle = sel ? 'rgba(20, 24, 34, 0.85)' : 'rgba(16, 18, 26, 0.72)';
    roundRect(ctx, tx, ty, TILE, TILE, 6);
    ctx.fill();
    // Border: bright ring when selected, dim otherwise; empty slots dashed.
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeStyle = sel ? '#ffffff' : (type ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.14)');
    if (!type) ctx.setLineDash([4, 3]);
    roundRect(ctx, tx + 0.5, ty + 0.5, TILE - 1, TILE - 1, 6);
    ctx.stroke();
    ctx.setLineDash([]);
    // Selection glow (soft outer halo).
    if (sel) {
      ctx.shadowColor = 'rgba(255,255,255,0.55)';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      roundRect(ctx, tx + 0.5, ty + 0.5, TILE - 1, TILE - 1, 6);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // --- Icon (real sheet frame) ---------------------------------------------
    const icon = tileIcon(i, type);
    if (icon) {
      // Living effect: schedule / advance a one-shot playback per tile.
      let fx = _slotFx.get(i);
      if (!fx && Math.random() < (0.016 / 15)) {  // ~once per 15s avg (10–20s window)
        const durMs = (icon.list.length / icon.fps) * 1000;
        fx = { start: now, dur: durMs };
        _slotFx.set(i, fx);
      }
      let idx = 0, pulse = 1;
      if (fx) {
        const t = (now - fx.start) / fx.dur;
        if (t >= 1) { _slotFx.delete(i); fx = null; }
        else {
          idx = Math.min(icon.list.length - 1, Math.floor(t * icon.list.length));
          pulse = 1 + 0.08 * Math.sin(Math.PI * t); // subtle scale pulse
        }
      }
      const img = icon.list[idx];
      const s = (TILE * ICON_FRAC) / Math.max(img.naturalWidth, img.naturalHeight);
      const dw = img.naturalWidth * s * pulse, dh = img.naturalHeight * s * pulse;
      ctx.drawImage(img, tx + (TILE - dw) / 2, ty + (TILE - dh) / 2, dw, dh);
    }

    // --- Chevron marker (left edge, selection indicator) ----------------------
    if (sel) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(tx - 7, ty + TILE / 2 - 5);
      ctx.lineTo(tx - 2, ty + TILE / 2);
      ctx.lineTo(tx - 7, ty + TILE / 2 + 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Rounded-rect path helper (HUD-local; canvas has no native rr everywhere). */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// --- Coins + lives (top-right) -----------------------------------------------

function drawCoinsAndLives(ctx, hero, bounds) {
  ctx.textAlign = 'right';
  ctx.font = `17px ${FONT_UI}`;
  ctx.fillStyle = GOLD;
  ctx.fillText(`💰 ${hero.coins ?? 0}`, bounds.x + bounds.w - PAD, bounds.y + PAD + 16);
  ctx.fillStyle = '#e74c3c';
  ctx.fillText(`❤️ × ${hero.lives ?? 0}`, bounds.x + bounds.w - PAD, bounds.y + PAD + 36);
}

// --- Selected-hero portrait (32×32, top-right corner, above coins) -----------

const PORTRAIT_PATHS = {
  scarlet: '../../assets/heroes/scarlet_vale/idle_f1.png',
  balthazar: '../../assets/heroes/balthazar/idle_f1.png',
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
  img.src = new URL(path, import.meta.url).href;
  portraits.set(heroId, img);
  return img;
}

function drawPortrait(ctx, hero, bounds) {
  const size = 32;
  const x = bounds.x + bounds.w - PAD - size;
  const y = bounds.y + PAD + 44; // below the lives line

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


