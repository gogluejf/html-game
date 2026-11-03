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
  drawCoinsAndLives(ctx, hero, bounds);           // top-right: coin + lives badges

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
  const n = 1 + (hero.specialSlots?.length ?? 0); // thorn + special slots
  const totalW = n * TILE + (n - 1) * TILE_GAP;
  const baseX = bounds.x + (bounds.w - totalW) / 2; // centered horizontally

  for (let i = 0; i < n; i++) {
    const isThorn = i === 0;
    const type = isThorn ? 'thorn' : hero.specialSlots[i - 1];
    const sel = isThorn ? !Number.isInteger(hero.selectedWeapon) : hero.selectedWeapon === i - 1;
    const tx = baseX + i * (TILE + TILE_GAP);
    const ty = bounds.y + PAD; // same height as coin/lives badges (top-right)

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

// --- Coins + lives (top-right): glass badge tiles with real art --------------
// Notification style: each counter is a glass square (like the weapon tiles)
// holding REAL art — coin = gold sheet f7, lives = the hero's life avatar f1
// (assets/hud/<hero>/life_f1.png). A small circle badge at the bottom-left
// corner holds the count ("×N" style number). Living effect: every 10–20s a
// random badge does its motion once — coin plays f8→f7, hero shows one
// expression frame from its life sheet — then settles back.

const BADGE = 44;        // badge tile size (px)
const BADGE_GAP = 10;    // gap between the two badges
const BADGE_ICON_FRAC = 0.78;
const BADGE_COUNT_R = 11; // count circle radius

// Lazily-loaded HUD images (coin f7/f8 + per-hero life frames). Keyed by path.
const hudImgs = new Map();
function loadHudImg(key, relPath) {
  let entry = hudImgs.get(key);
  if (!entry) {
    entry = { img: null };
    if (typeof Image !== 'undefined') {
      const img = new Image();
      img.src = new URL(relPath, import.meta.url).href;
      entry.img = img;
    }
    hudImgs.set(key, entry);
  }
  return entry.img;
}

// Per-badge living-effect state: { start, dur, kind }
const _badgeFx = new Map(); // 'coin' | 'lives' → fx

/** One-shot playback scheduler: ~once per 15s average (10–20s window). */
function maybeStartFx(map, key, now, durMs) {
  let fx = map.get(key);
  if (fx) return fx;
  if (Math.random() < (0.016 / 15)) {
    fx = { start: now, dur: durMs };
    map.set(key, fx);
    return fx;
  }
  return null;
}

function drawCoinsAndLives(ctx, hero, bounds) {
  const now = performance.now();
  const rightX = bounds.x + bounds.w - PAD;
  const y = bounds.y + PAD;
  // Lives badge left of coins badge (coins hugs the right edge).
  const coinX = rightX - BADGE;
  const livesX = coinX - BADGE - BADGE_GAP;

  drawCoinBadge(ctx, hero, coinX, y, now);
  drawLivesBadge(ctx, hero, livesX, y, now);
}

/** Coin badge: gold coin in a glass tile. All timing comes from the sheet
 *  JSON (fps, frame count). Resting state plays a cull cycle f8↔f7 at the
 *  sheet's real fps. Living effect: full f1→f12 spin once, then back to cull. */
let _coinSheet = null; // cached parsed sheet data { fps, frames: [file,...] }
async function loadCoinSheet() {
  if (_coinSheet) return _coinSheet;
  try {
    // Browser: fetch. Node (tests/headless): fs fallback — same pattern as
    // object.js's barrel sheets (Chromium import-attributes are out).
    const url = new URL('../../assets/objects/coin/gold_sheet.json', import.meta.url);
    let json;
    if (url.protocol === 'file:') {
      const { readFile } = await import('node:fs/promises');
      const { fileURLToPath } = await import('node:url');
      json = JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
    } else {
      json = await (await fetch(url)).json();
    }
    const ent = json.entities[0];
    _coinSheet = { fps: ent.fps ?? 10, frames: ent.frames.map(f => f.file) };
  } catch { _coinSheet = { fps: 10, frames: [] }; }
  return _coinSheet;
}
// Kick off the fetch on first draw call (fire-and-forget).
loadCoinSheet();

function drawCoinBadge(ctx, hero, x, y, now) {
  ctx.save();
  drawGlassTile(ctx, x, y, BADGE, false);

  const sheet = _coinSheet;
  if (!sheet || sheet.frames.length === 0) { ctx.restore(); return; }

  const n = sheet.frames.length;
  const fps = sheet.fps;
  // Load all frames from the sheet.
  const seq = [];
  for (const file of sheet.frames) {
    const img = loadHudImg(`coin_${file}`, `../../assets/objects/coin/${file}`);
    if (img && img.complete && img.naturalWidth > 0) seq.push(img);
  }
  if (seq.length === 0) { ctx.restore(); return; }

  // Resting: static f7 (index 6).
  const rest = seq[6] || seq[0];

  // Living effect: wrap-around spin starting at f8, ending at f7.
  // Order: f8,f9,...,f12,f1,...,f7 → indices [6,7,...,n-1,0,1,...,5]
  const spinOrder = [];
  for (let i = 6; i < n; i++) spinOrder.push(i);   // f8..f12
  for (let i = 0; i < 6; i++) spinOrder.push(i);   // f1..f7

  const fx = maybeStartFx(_badgeFx, 'coin', now, (spinOrder.length / fps) * 1000);
  let img = rest, pulse = 1;
  if (fx) {
    const t = (now - fx.start) / fx.dur;
    if (t >= 1) { _badgeFx.delete('coin'); }
    else {
      const idx = Math.min(spinOrder.length - 1, Math.floor(t * spinOrder.length));
      img = seq[spinOrder[idx]];
      pulse = 1 + 0.08 * Math.sin(Math.PI * t);
    }
  }
  drawIconCentered(ctx, img, x, y, BADGE, BADGE_ICON_FRAC, pulse);
  drawCountBadge(ctx, x, y, hero.coins ?? 0, '#ffd700');
  ctx.restore();
}

/** Lives badge: hero life avatar in a glass tile; fx plays the FULL
 *  expression sequence (f1→f4) once at 8fps, then settles back on f1. */
function drawLivesBadge(ctx, hero, x, y, now) {
  ctx.save();
  drawGlassTile(ctx, x, y, BADGE, false);

  const heroId = hero.heroDef?.id === 'balthazar' ? 'balthazar' : 'scarlet';
  const base = `../../assets/hud/${heroId}/life_f`;
  // Full expression sequence from the real life sheet.
  const seq = [];
  for (let i = 1; i <= 4; i++) {
    const img = loadHudImg(`life_${heroId}_${i}`, `${base}${i}.png`);
    if (img && img.complete && img.naturalWidth > 0) seq.push(img);
  }
  const rest = seq[0] || null; // f1 = resting frame
  const fps = 8;
  const fx = maybeStartFx(_badgeFx, 'lives', now, (seq.length / fps) * 1000 || 1200);
  let img = rest, pulse = 1;
  if (fx && seq.length > 0) {
    const t = (now - fx.start) / fx.dur;
    if (t >= 1) { _badgeFx.delete('lives'); }
    else {
      img = seq[Math.min(seq.length - 1, Math.floor(t * seq.length))];
      pulse = 1 + 0.06 * Math.sin(Math.PI * t);
    }
  }
  if (img) drawIconCentered(ctx, img, x, y, BADGE, BADGE_ICON_FRAC, pulse);
  drawCountBadge(ctx, x, y, hero.lives ?? 0, '#ff5b5b');
  ctx.restore();
}

/** Shared glass-tile background (matches the weapon tiles). */
function drawGlassTile(ctx, x, y, size, selected) {
  ctx.fillStyle = selected ? 'rgba(20, 24, 34, 0.85)' : 'rgba(16, 18, 26, 0.72)';
  roundRect(ctx, x, y, size, size, 6);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  roundRect(ctx, x + 0.5, y + 0.5, size - 1, size - 1, 6);
  ctx.stroke();
}

/** Draw an image centered in a tile at the given fraction, with optional pulse.
 *  offX/offY nudge the icon (used to keep the bottom-left clear for the count badge). */
function drawIconCentered(ctx, img, x, y, size, frac, pulse = 1, offX = 0, offY = 0) {
  const s = (size * frac) / Math.max(img.naturalWidth, img.naturalHeight);
  const dw = img.naturalWidth * s * pulse, dh = img.naturalHeight * s * pulse;
  ctx.drawImage(img, x + (size - dw) / 2 + offX, y + (size - dh) / 2 + offY, dw, dh);
}

/** Small circle badge at the tile's bottom-left corner with the count inside. */
function drawCountBadge(ctx, x, y, value, color) {
  const cx = x + 2, cy = y + BADGE - 2; // bottom-left corner of the tile
  ctx.beginPath();
  ctx.arc(cx, cy, BADGE_COUNT_R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10, 12, 18, 0.92)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `bold 11px ${FONT_UI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), cx, cy + 0.5);
  ctx.textBaseline = 'alphabetic';
}

// --- Selected-hero life avatar: now rendered inside drawLivesBadge() ---------
// (assets/hud/<hero>/life_f1.png + expression fx). The old 32×32 idle portrait
// is retired — the life badge IS the hero representation.


