// Petal Panic — Home & Select screens (design §20, Milestone 8).
// ES module; no frameworks. Images are loaded via loadImages() called from
// main.js at startup; draw methods handle missing images gracefully with
// placeholder boxes.

import { S, getState, tryTransition } from './state.js';
import { HEROES } from './heroDefs.js';
import { VIEW_W, VIEW_H } from './view.js';

// --- Image cache -------------------------------------------------------------
const images = {};
let loadedCount = 0;
let totalCount = 0;

/**
 * Kick off loading of all screen assets. Safe to call once on page load.
 * Images load asynchronously; draw methods check .complete before using them.
 */
export function loadImages() {
  const paths = {
    homeBigtop: 'assets/home/home_bigtop_f1.png',
    homeCrowd: 'assets/home/home_crowd_f1.png',
    homeStage: 'assets/home/home_stage_f1.png',
    homePortrait: 'assets/home/home_scarlet_portrait_f1.png',
    logo: 'assets/interface/logo_f1.png',
    selectScarlet: 'assets/interface/select_scarlet_vale_f1.png',
    selectBalthazar: 'assets/interface/select_balthazar_f1.png',
    selectNone: 'assets/interface/select_none_f1.png',
  };
  totalCount = Object.keys(paths).length;
  for (const [key, path] of Object.entries(paths)) {
    const img = new Image();
    img.onload = () => { loadedCount++; };
    img.onerror = () => { /* mark as failed; draw will show placeholder */ };
    img.src = path;
    images[key] = img;
  }
}

/** Returns true when all images have finished loading (or errored). */
export function imagesReady() { return loadedCount >= totalCount; }

// Helper: draw an image fitted into a box preserving aspect ratio, centered.
function drawFitted(ctx, img, bx, by, bw, bh) {
  if (!img || !img.complete || img.naturalWidth === 0) return false;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.min(bw / iw, bh / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(img, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
  return true;
}

// Placeholder box drawn when an image hasn't loaded yet.
function drawPlaceholder(ctx, x, y, w, h, label) {
  ctx.save();
  ctx.strokeStyle = '#555';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#666';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label || 'loading…', x + w / 2, y + h / 2 + 4);
  ctx.restore();
}

// =============================================================================
// HOME SCREEN
// =============================================================================

export const Home = {
  parallaxOffset: 0,

  /** Advance parallax animation (called each render frame). */
  update(dt) {
    this.parallaxOffset += dt;
  },

  draw(ctx) {
    // Background gradient (night sky).
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#0d0d1a');
    grad.addColorStop(0.6, '#1a1a2e');
    grad.addColorStop(1, '#2a1a3e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Parallax layers: bigtop (back), crowd (mid), stage (front).
    // Each scrolls horizontally at a different speed for depth.
    const t = this.parallaxOffset;

    // Back layer: bigtop tent — slowest.
    if (images.homeBigtop?.complete && images.homeBigtop.naturalWidth > 0) {
      const speed = 8; // px/s
      const offset = (t * speed) % (images.homeBigtop.naturalWidth + VIEW_W);
      ctx.globalAlpha = 0.5;
      const y1 = 120;
      const h1 = 320;
      ctx.drawImage(images.homeBigtop, -offset, y1, VIEW_W + 200, h1);
      ctx.drawImage(images.homeBigtop, VIEW_W + 200 - offset, y1, VIEW_W + 200, h1);
      ctx.globalAlpha = 1;
    } else {
      drawPlaceholder(ctx, 100, 150, VIEW_W - 200, 280, 'bigtop');
    }

    // Mid layer: crowd silhouettes — medium speed.
    if (images.homeCrowd?.complete && images.homeCrowd.naturalWidth > 0) {
      const speed = 18;
      const offset = (t * speed) % (images.homeCrowd.naturalWidth + VIEW_W);
      ctx.globalAlpha = 0.7;
      const y2 = 280;
      const h2 = 200;
      ctx.drawImage(images.homeCrowd, -offset, y2, VIEW_W + 200, h2);
      ctx.drawImage(images.homeCrowd, VIEW_W + 200 - offset, y2, VIEW_W + 200, h2);
      ctx.globalAlpha = 1;
    } else {
      drawPlaceholder(ctx, 50, 300, VIEW_W - 100, 160, 'crowd');
    }

    // Front layer: stage — fastest.
    if (images.homeStage?.complete && images.homeStage.naturalWidth > 0) {
      const speed = 30;
      const offset = (t * speed) % (images.homeStage.naturalWidth + VIEW_W);
      ctx.globalAlpha = 0.9;
      const y3 = 380;
      const h3 = 160;
      ctx.drawImage(images.homeStage, -offset, y3, VIEW_W + 200, h3);
      ctx.drawImage(images.homeStage, VIEW_W + 200 - offset, y3, VIEW_W + 200, h3);
      ctx.globalAlpha = 1;
    } else {
      drawPlaceholder(ctx, 0, 400, VIEW_W, 140, 'stage');
    }

    // Logo centered (above the parallax scene).
    if (images.logo?.complete && images.logo.naturalWidth > 0) {
      const lw = 320;
      const lh = lw * (images.logo.naturalHeight / images.logo.naturalWidth);
      ctx.drawImage(images.logo, (VIEW_W - lw) / 2, 50, lw, lh);
    } else {
      drawPlaceholder(ctx, (VIEW_W - 320) / 2, 50, 320, 80, 'logo');
    }

    // "Press Enter" hint (blinking).
    if (Math.floor(Date.now() / 500) % 2 === 0) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText('PRESS ENTER TO CONTINUE', VIEW_W / 2, VIEW_H - 40);
      ctx.restore();
    }
  },

  /** Handle key input. Any key advances to SELECT. */
  onKey(code) {
    if (code === 'Enter' || code === 'Space') {
      if (tryTransition(S.SELECT)) {
        console.log('[screens] HOME → SELECT');
      }
    }
  },
};

// =============================================================================
// SELECT SCREEN
// =============================================================================

export const Select = {
  focus: -1, // -1 = none, 0 = scarlet, 1 = balthazar

  reset() { this.focus = -1; },

  draw(ctx) {
    // Background.
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#0d0d1a');
    grad.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Title.
    ctx.save();
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    ctx.fillText('SELECT YOUR HERO', VIEW_W / 2, 55);
    ctx.restore();

    // Panel geometry.
    const panelW = 260, panelH = 340;
    const gap = 80;
    const totalW = panelW * 2 + gap;
    const startX = (VIEW_W - totalW) / 2;
    const panelY = 90;

    const heroes = [HEROES.scarlet, HEROES.balthazar];
    const imgKeys = ['selectScarlet', 'selectBalthazar'];

    for (let i = 0; i < 2; i++) {
      const px = startX + i * (panelW + gap);
      const focused = this.focus === i;
      const hero = heroes[i];

      // Panel background.
      ctx.save();
      ctx.fillStyle = focused ? 'rgba(255,215,0,0.08)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(px, panelY, panelW, panelH);

      // Border (gold when focused, grey otherwise).
      ctx.strokeStyle = focused ? '#ffd700' : '#555';
      ctx.lineWidth = focused ? 4 : 2;
      ctx.strokeRect(px, panelY, panelW, panelH);
      ctx.restore();

      // Hero art.
      const artX = px + 15, artY = panelY + 15, artW = panelW - 30, artH = panelH - 100;
      const img = images[imgKeys[i]];
      if (img?.complete && img.naturalWidth > 0) {
        drawFitted(ctx, img, artX, artY, artW, artH);
      } else {
        drawPlaceholder(ctx, artX, artY, artW, artH, hero.name);
      }

      // Name.
      ctx.save();
      ctx.fillStyle = focused ? '#ffd700' : '#aaa';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(hero.name.toUpperCase(), px + panelW / 2, panelY + panelH - 55);
      ctx.restore();

      // Special ability label.
      const specialLabel = hero.stats.special === 'saw' ? 'Petal Saw' : 'Bomb Burst';
      ctx.save();
      ctx.fillStyle = focused ? '#ff6ec7' : '#888';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Special: ${specialLabel}`, px + panelW / 2, panelY + panelH - 35);
      ctx.restore();

      // Stats mini-display.
      ctx.save();
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = focused ? '#ccc' : '#777';
      const sx = px + 20, sy = panelY + panelH - 18;
      ctx.fillText(`SPD:${hero.stats.speed}  ATK:${hero.stats.attack}  DEF:${hero.stats.defense}`, sx, sy);
      ctx.restore();
    }

    // Focus indicator arrows.
    if (this.focus >= 0) {
      const fx = this.focus === 0
        ? startX + panelW / 2
        : startX + panelW + gap + panelW / 2;
      ctx.save();
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▼', fx, panelY - 8);
      ctx.restore();
    }

    // Controls hint.
    ctx.save();
    ctx.fillStyle = '#888';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('← → Select   |   ENTER Confirm', VIEW_W / 2, VIEW_H - 25);
    ctx.restore();
  },

  /** Handle key input for hero selection. */
  onKey(code) {
    switch (code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.focus = this.focus <= 0 ? 1 : this.focus - 1;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.focus = this.focus >= 1 ? 0 : this.focus + 1;
        break;
      case 'Enter':
      case 'Space':
        if (this.focus >= 0) {
          const heroId = this.focus === 0 ? 'scarlet' : 'balthazar';
          window.__selectedHero = heroId;
          if (tryTransition(S.PLAY)) {
            console.log(`[screens] SELECT → PLAY (hero: ${heroId})`);
          }
        }
        break;
    }
  },
};

// =============================================================================
// Screen dispatch helpers (used by render.js + update.js)
// =============================================================================

/** Draw the appropriate screen for the current state. Returns true if a screen was drawn. */
export function drawScreen(ctx) {
  const s = getState();
  if (s === S.HOME) {
    Home.draw(ctx);
    return true;
  }
  if (s === S.SELECT) {
    Select.draw(ctx);
    return true;
  }
  return false;
}

/** Route a key event to the active screen. Returns true if the screen consumed it. */
export function screenOnKey(code) {
  const s = getState();
  if (s === S.HOME) {
    Home.onKey(code);
    return true;
  }
  if (s === S.SELECT) {
    Select.onKey(code);
    return true;
  }
  return false;
}

/** Update screen-specific per-frame logic (parallax, etc.). */
export function screenUpdate(dt) {
  const s = getState();
  if (s === S.HOME) Home.update(dt);
}
