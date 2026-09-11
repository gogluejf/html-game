// Petal Panic — Home & Select screens (design §20, Milestone 8).
// ES module; no frameworks. Images are loaded via loadImages() called from
// main.js at startup; draw methods handle missing images gracefully with
// placeholder boxes.

import { S, getState, tryTransition } from './state.js';
import { HEROES } from './heroDefs.js';
import { VIEW_W, VIEW_H } from './view.js';
import { calculateScore } from './stats.js';
import {
  FONT_TITLE, FONT_UI, CREAM, GOLD, RED, PINK,
  drawMarqueeTitle, drawPrompt, drawMenace,
} from './fonts.js';

// Continue cost (design §1/§14: 1000 coins per continue). update.js exports the
// same constant; this local copy keeps screens.js self-contained for draw/onKey.
const CONTINUE_COST = 1000;

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
    squidLogo: 'assets/home/squid_os_logo_f1.png',
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

// --- Home-screen full viewport ---------------------------------------------
// Uses the full 960×540 logical viewport. No letterbox bars.
const HOME_W = VIEW_W;                   // 960
const HOME_H = VIEW_H;                   // 540
const HOME_X = 0;
const HOME_Y = 0;

// Wide layers (bigtop/stage/crowd) are 1536×1024 (3:2). Scale to COVER the
// 960×540 box: scale = max(960/1536, 540/1024) = max(0.625, 0.5273) = 0.625.
// Display = 960×640 → fills box width exactly, overflows 100px vertically.
const WIDE_SCALE = Math.max(HOME_W / 1536, HOME_H / 1024); // 0.625
const DW = 1536 * WIDE_SCALE;            // 960
const DH = 1024 * WIDE_SCALE;            // 640
const OVERFLOW_X = DW - HOME_W;          // 0 — no horizontal pan room

/**
 * One-directional pan that STOPS at the far edge (no bounce/ping-pong).
 * Eases from `start` toward `end` over `duration` seconds (ease-in-out), then
 * clamps at `end` forever. Returns a value between start and end.
 */
function oneWayPan(t, duration, start, end) {
  const p = Math.min(1, t / duration);
  const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
  return start + (end - start) * ease;
}

export const Home = {
  parallaxOffset: 0,

  /** Advance parallax animation (called each render frame). */
  update(dt) {
    this.parallaxOffset += dt;
  },

  draw(ctx) {
    const t = this.parallaxOffset;

    // Smooth scaling for the large art assets.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // --- Background (always black during intro, dark gradient after) ---------
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#020208');
    grad.addColorStop(0.5, '#060312');
    grad.addColorStop(1, '#0a0518');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // ========================================================================
    // INTRO SEQUENCE (t < 12s): text cards on black, then layer fades
    // ========================================================================
    const INTRO_END = 9.5;
    if (t < INTRO_END) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Helper: fade in/out a text card between [start, end]
      const drawCard = (text, start, end, size, color) => {
        if (t < start || t > end) return;
        const fadeIn = Math.min(1, (t - start) / 0.5);
        const fadeOut = Math.min(1, (end - t) / 0.5);
        ctx.globalAlpha = Math.min(fadeIn, fadeOut);
        drawMarqueeTitle(ctx, text, VIEW_W / 2, VIEW_H / 2, size, { color });
      };

      // Card 1: "JF Rene presents" (1s – 3.5s)
      drawCard('JF RENE PRESENTS', 1, 3.5, 46, CREAM);

      // Card 2: "AI Qwen 3.8 7B AI Slop production" (4s – 6.5s)
      drawCard('AI QWEN 3.8 7B · AI SLOP PRODUCTION', 4, 6.5, 30, '#d8c9a0');

      // Card 3: "Built with [squid logo]" (7s – 9.5s) — small, humble
      if (t >= 7 && t <= 9.5) {
        const fadeIn = Math.min(1, (t - 7) / 0.5);
        const fadeOut = Math.min(1, (9.5 - t) / 0.5);
        const alpha = Math.min(fadeIn, fadeOut);
        ctx.globalAlpha = alpha;
        drawPrompt(ctx, 'built with', VIEW_W / 2, VIEW_H / 2 - 22, 20, { color: '#b9a98a' });
        const sq = images.squidLogo;
        if (sq?.complete && sq.naturalWidth > 0) {
          const lw = 120;
          const lh = lw * (sq.naturalHeight / sq.naturalWidth);
          ctx.drawImage(sq, VIEW_W / 2 - lw / 2, VIEW_H / 2 + 5, lw, lh);
        }
      }

      ctx.restore();
      return; // skip all game layers during intro
    }

    // Game time: everything below uses gt (game time) starting from 0
    const gt = t - INTRO_END;

    // Clip to the box and translate origin.
    ctx.save();
    ctx.beginPath();
    ctx.rect(HOME_X, HOME_Y, HOME_W, HOME_H);
    ctx.clip();
    ctx.translate(HOME_X, HOME_Y);

    // Fade-in for layers: bigtop 0–1s, stage+crowd 0–0.5s
    const bigtopAlpha = Math.min(1, gt / 1.0);
    const frontAlpha = Math.min(1, gt / 0.5);

    // --- Screen shake (logo stamp impact at t=2s) ----------------------------
    const STAMP_T = 2.2;
    let shakeX = 0, shakeY = 0;
    if (gt >= STAMP_T && gt < STAMP_T + 0.35) {
      const sp = (gt - STAMP_T) / 0.35; // 0→1 over 350ms
      const intensity = 12 * (1 - sp); // 12px → 0
      shakeX = (Math.random() - 0.5) * 2 * intensity;
      shakeY = (Math.random() - 0.5) * 2 * intensity;
    }
    ctx.translate(shakeX, shakeY);

    // --- Layer 1: BIGTOP (elephant bg) — slow vertical parallax --------------
    // Subtle up/down drift (±4px) over 60s. Background moves least.
    {
      const src = images.homeBigtop;
      const osc = Math.max(0, gt - 2) * 2 * Math.PI / 60;
      const vOsc = Math.sin(osc) * 10; // reverses: was going up, now goes down
      const vDrift = -100 + (-8 * (1 - Math.pow(1 - Math.min(1, gt / 2), 3))) + vOsc;
      if (src?.complete && src.naturalWidth > 0) {
        ctx.save();
        ctx.globalAlpha = 0.65 * bigtopAlpha;
        ctx.drawImage(src, 0, vDrift, DW, DH);
        ctx.restore();
      } else {
        drawPlaceholder(ctx, 20, 130, HOME_W - 40, 280, 'bigtop');
      }
    }

    // --- Layer 2: STAGE (tiger) — opposite vertical parallax -----------------
    // ±8px, opposite direction to bigtop. Midground.
    {
      const src = images.homeStage;
      const ready = src?.complete && src.naturalWidth > 0;
      const osc = Math.max(0, gt - 2) * 2 * Math.PI / 60;
      const vOsc = Math.sin(osc) * 20; // reverses: was going up, now goes down
      const vDrift = -15 * (1 - Math.pow(1 - Math.min(1, gt / 2), 3)) + vOsc;
      if (ready) {
        ctx.save();
        ctx.globalAlpha = frontAlpha;
        ctx.drawImage(src, -20, vDrift, DW, DH);
        ctx.restore();
      } else {
        drawPlaceholder(ctx, 0, 380, HOME_W, 160, 'stage');
      }
    }

    // --- Layer 3: CROWD — foreground vertical parallax -----------------------
    // ±15px, same direction as stage (opposite to bigtop). Foreground moves most.
    {
      const src = images.homeCrowd;
      const cx = (HOME_W - DW) / 2;   // centered
      const maxDrop = 0.05 * DH;      // 5% settle
      const settleT = Math.min(1, gt / 2);
      const easeOut = 1 - Math.pow(1 - settleT, 3);
      const osc = Math.max(0, gt - 2) * 2 * Math.PI / 60;
      const vOsc = -Math.sin(osc) * 30; // reverses: was going down, now goes up
      const cy = maxDrop * easeOut - 40 + vOsc;
      if (src?.complete && src.naturalWidth > 0) {
        ctx.save();
        ctx.globalAlpha = frontAlpha;
        ctx.drawImage(src, cx, cy, DW, DH);
        ctx.restore();
      } else {
        drawPlaceholder(ctx, 30, 380, HOME_W - 60, 140, 'crowd');
      }
    }

    // --- Layer 4: SCARLET — trapeze swing entrance + idle pendulum -----------
    // Timeline:
    //   t < 1.5s: invisible (waiting for vertical parallax to settle)
    //   t = 1.5–2.5s: swings IN from -45° (off-screen left) with damped pendulum
    //   t > 2.5s: settles into gentle ±9° idle pendulum
    // The damped swing uses a real pendulum formula: θ(t) = A·e^(-λt)·cos(ωt)
    // giving natural overshoot and decay like a human on a rope.
    {
      const portrait = images.homePortrait;
      if (portrait?.complete && portrait.naturalHeight > 0) {
        const ph = HOME_H * 0.68;
        const pw = ph * (portrait.naturalWidth / portrait.naturalHeight);
        const ax = HOME_W * 0.18;
        const ay = -5;

        let angle, alpha = 1;

        if (gt < 0.95) {
          // Not visible yet
          angle = -Math.PI / 4;
          alpha = 0;
        } else {
          // Single continuous pendulum. Amplitude decays 45°→9°, frequency
          // ramps 4.0→0.4. Slow decay so she swings many times before settling.
          const st = gt - 0.95;
          const startAmp = 45 * Math.PI / 180;
          const finalAmp = 9 * Math.PI / 180;
          const lambda = 0.25; // slow decay — many bounces before settling
          const amp = finalAmp + (startAmp - finalAmp) * Math.exp(-lambda * st);
          const fFinal = 0.4;
          const fStart = 4.0;
          const phase = fFinal * st + (fStart - fFinal) * (1 - Math.exp(-lambda * st)) / lambda;
          angle = -amp * Math.cos(phase);
          alpha = Math.min(1, st / 0.3);
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(ax, ay);
        ctx.rotate(angle);
        ctx.drawImage(portrait, -pw / 2, 0, pw, ph);
        ctx.restore();
      } else {
        drawPlaceholder(ctx, HOME_W * 0.18 - 70, 20, 140, 340, 'scarlet');
      }
    }

    // --- Layer 5: LOGO — upper area, clear of the tiger ----------------------
    // Width ~35% of HOME_W (≈252px). Brutal stamp: appears at t=2s with a
    // fast zoom-in + screen shake on all layers.
    {
      const logo = images.logo;
      if (logo?.complete && logo.naturalWidth > 0) {
        const STAMP_T = 2.2;       // when the stamp hits
        const p = Math.min(1, Math.max(0, (gt - STAMP_T) / 0.1)); // 100ms appear
        if (p > 0) {
          const lw = HOME_W * 0.31;
          const lh = lw * (logo.naturalHeight / logo.naturalWidth);
          const lx = (HOME_W - lw) / 2;
          const ly = HOME_H * 0.02;
          ctx.save();
          ctx.globalAlpha = Math.min(1, p * 5); // instant pop
          ctx.drawImage(logo, lx, ly, lw, lh);
          ctx.restore();
        }
      } else {
        drawPlaceholder(ctx, (HOME_W - 252) / 2, 20, 252, 40, 'logo');
      }
    }

    // --- Layer 6: "PRESS ENTER" hint — only after logo + 500ms (gt > 2.7) ----
    if (gt > 2.7) {
      const blink = Math.floor(gt * 2) % 2 === 0;
      drawPrompt(ctx, 'PRESS ENTER', HOME_W / 2, HOME_H - 24, 30, { blink });
    }

    ctx.restore(); // end 4:3 clip
  },

  /** Handle key input. During intro: skip to next card. After intro: go to SELECT. */
  onKey(code) {
    if (code !== 'Enter' && code !== 'Space') return;
    const t = this.parallaxOffset;
    // Skip through intro cards on press
    if (t < 1) { this.parallaxOffset = 1; return; }       // black → JF Rene
    if (t < 4) { this.parallaxOffset = 4; return; }       // JF Rene → Qwen
    if (t < 7) { this.parallaxOffset = 7; return; }       // Qwen → Squid
    if (t < 9.5) { this.parallaxOffset = 9.5; return; }   // Squid → scene
    // After intro + logo + 500ms: go to SELECT
    if (t - 9.5 > 2.7) {
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
    drawMarqueeTitle(ctx, 'SELECT YOUR HERO', VIEW_W / 2, 58, 40, { color: CREAM });

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
      drawPrompt(ctx, hero.name.toUpperCase(), px + panelW / 2, panelY + panelH - 58, 24, {
        color: focused ? CREAM : '#b9a98a', font: FONT_TITLE,
      });

      // Special ability label.
      const specialLabel = hero.stats.special === 'saw' ? 'Petal Saw' : 'Bomb Burst';
      drawPrompt(ctx, `Special: ${specialLabel}`, px + panelW / 2, panelY + panelH - 36, 17, {
        color: focused ? PINK : '#8a6a7a',
      });

      // Stats mini-display.
      ctx.save();
      ctx.font = `13px ${FONT_UI}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = focused ? '#d8cdb4' : '#777';
      const sx = px + 20, sy = panelY + panelH - 16;
      ctx.fillText(`SPD:${hero.stats.speed}  ATK:${hero.stats.attack}  DEF:${hero.stats.defense}`, sx, sy);
      ctx.restore();
    }

    // Focus indicator arrows.
    if (this.focus >= 0) {
      const fx = this.focus === 0
        ? startX + panelW / 2
        : startX + panelW + gap + panelW / 2;
      ctx.save();
      ctx.fillStyle = GOLD;
      ctx.font = `bold 26px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(255,215,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.fillText('▼', fx, panelY - 8);
      ctx.restore();
    }

    // Controls hint.
    drawPrompt(ctx, '← → SELECT   |   ENTER CONFIRM', VIEW_W / 2, VIEW_H - 26, 18, { color: '#b9a98a' });
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
// PAUSE SCREEN (design §20, Task 8.2)
// Drawn as a semi-transparent overlay on top of the frozen Play frame — the
// world is still rendered behind it by render.js; this screen only adds the
// dim + title + options. Toggled with Esc/P; Resume with Enter/Esc/P.
// =============================================================================

export const Pause = {
  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    // Dim the frozen play frame behind the overlay.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Title.
    drawMarqueeTitle(ctx, 'PAUSED', VIEW_W / 2, VIEW_H / 2 - 70, 56, { color: CREAM });

    // Options.
    drawPrompt(ctx, 'ENTER / ESC — Resume', VIEW_W / 2, VIEW_H / 2 - 5, 24, { color: GOLD });
    drawPrompt(ctx, 'R — Retry Level', VIEW_W / 2, VIEW_H / 2 + 35, 22, { color: '#d8cdb4' });
    drawPrompt(ctx, 'Q — Quit to Home', VIEW_W / 2, VIEW_H / 2 + 75, 22, { color: '#d8cdb4' });
    ctx.restore();
  },

  /**
   * Handle key input. `retry`/`quit` are injected by update.js so the level
   * reset logic (which lives in systems/update.js) stays in one place.
   * @param {string} code KeyboardEvent.code
   * @param {{ retry?: () => void, quit?: () => void }} [actions]
   */
  onKey(code, actions = {}) {
    if (code === 'Escape' || code === 'Enter' || code === 'Space' || code === 'KeyP') {
      if (tryTransition(S.PLAY)) console.log('[screens] PAUSE → PLAY (resume)');
      return true;
    }
    if (code === 'KeyR') {
      if (actions.retry) actions.retry(); else tryTransition(S.HOME);
      return true;
    }
    if (code === 'KeyQ') {
      if (actions.quit) actions.quit(); else tryTransition(S.HOME);
      return true;
    }
    return false;
  },
};

// =============================================================================
// GAME OVER SCREEN (design §20, Task 8.2)
// Full-screen dark panel: "GAME OVER", final score + key stats, and the three
// options (Retry / Continue / Quit). Continue is highlighted only when it is
// affordable (continues left AND enough coins).
// =============================================================================

/** Shared continue-availability check (draw + onKey must agree). */
export function canContinue(hero) {
  return !!(hero && hero.continuesUsed < hero.maxContinues && hero.coins >= CONTINUE_COST);
}

export const GameOver = {
  /** @param {CanvasRenderingContext2D} ctx @param {object} hero the hero entity */
  draw(ctx, hero) {
    // Dark background over the frozen play frame.
    ctx.save();
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const s = hero.runStats ?? {};
    const kills = Object.values(s.enemiesKilled ?? {}).reduce((a, b) => a + b, 0);
    const coins = s.coinsCollected?.total ?? 0;
    const distance = Math.round(s.distanceTraveled ?? 0);
    const score = calculateScore(s, hero);

    // Title.
    drawMenace(ctx, 'GAME OVER', VIEW_W / 2, 110, 64);

    // Score + key stats.
    ctx.textAlign = 'center';
    drawPrompt(ctx, `SCORE  ${score}`, VIEW_W / 2, 185, 30, { color: CREAM, font: FONT_TITLE });
    ctx.font = `22px ${FONT_UI}`;
    ctx.fillStyle = '#d8cdb4';
    ctx.fillText(`Enemies Killed: ${kills}`, VIEW_W / 2, 235);
    ctx.fillText(`Coins Collected: ${coins}`, VIEW_W / 2, 270);
    ctx.fillText(`Distance: ${distance} px`, VIEW_W / 2, 305);

    // Options.
    let oy = 375;
    drawPrompt(ctx, 'R — Retry', VIEW_W / 2, oy, 24, { color: GOLD });
    oy += 40;

    const okCont = canContinue(hero);
    const remaining = (hero.maxContinues ?? 3) - (hero.continuesUsed ?? 0);
    drawPrompt(
      ctx,
      `C — Continue (${remaining} left, ${CONTINUE_COST} coins)`,
      VIEW_W / 2, oy, 22,
      { color: okCont ? GOLD : '#555555' },
    );
    oy += 40;
    drawPrompt(ctx, 'Q — Quit', VIEW_W / 2, oy, 22, { color: '#cccccc' });
    ctx.restore();
  },

  /**
   * Handle key input. `retry`/`cont`/`quit` are injected by update.js so the
   * respawn logic stays in systems/update.js.
   * @param {string} code KeyboardEvent.code
   * @param {object} hero the hero entity
   * @param {{ retry?: () => void, cont?: () => void, quit?: () => void }} [actions]
   */
  onKey(code, hero, actions = {}) {
    if (code === 'KeyR') {
      if (actions.retry) actions.retry();
      return true;
    }
    if (code === 'KeyC') {
      if (actions.cont) actions.cont();
      return true;
    }
    if (code === 'KeyQ') {
      if (actions.quit) actions.quit();
      return true;
    }
    return false;
  },
};

// =============================================================================
// WIN SCREEN (design §20, Task 8.2)
// Celebratory full-screen panel: "VICTORY!", prominent score, and the full
// §4.1 stats summary. dumpStats() already fired on the transition into WIN
// (console + JSON download); this screen shows the same data inline.
// =============================================================================

export const Win = {
  /** @param {CanvasRenderingContext2D} ctx @param {object} hero the hero entity */
  draw(ctx, hero) {
    // Celebratory background.
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#1a0a2e');
    grad.addColorStop(1, '#2e1a4e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const s = hero.runStats ?? {};
    const kills = Object.values(s.enemiesKilled ?? {}).reduce((a, b) => a + b, 0);
    const barrels = (s.barrelsDestroyed?.barrel ?? 0) + (s.barrelsDestroyed?.coinBarrel ?? 0);
    const score = calculateScore(s, hero);

    // Title.
    drawMarqueeTitle(ctx, '🎉 VICTORY! 🎉', VIEW_W / 2, 90, 58, { color: CREAM });

    // Score prominently.
    drawPrompt(ctx, `SCORE: ${score}`, VIEW_W / 2, 155, 34, { color: GOLD, font: FONT_TITLE });

    // Full §4.1 stats summary.
    ctx.textAlign = 'center';
    ctx.font = `19px ${FONT_UI}`;
    ctx.fillStyle = '#d8cdb4';
    const lines = [
      `Hero: ${hero.heroDef?.name ?? ''}`,
      `Time: ${(s.timePlayed ?? 0).toFixed(1)}s`,
      `Enemies: ${kills}`,
      `Boss: ${s.bossKilled ? 'DEFEATED ✓' : '—'}`,
      `Coins: ${s.coinsCollected?.total ?? 0}`,
      `Barrels: ${barrels}`,
      `Checkpoints: ${s.checkpointsHit ?? 0}`,
      `Distance: ${Math.round(s.distanceTraveled ?? 0)}px`,
    ];
    let y = 200;
    for (const line of lines) {
      ctx.fillText(line, VIEW_W / 2, y);
      y += 28;
    }

    // Options.
    drawPrompt(ctx, 'ENTER — Play Again', VIEW_W / 2, VIEW_H - 60, 24, { color: GOLD });
    drawPrompt(ctx, 'Q — Quit', VIEW_W / 2, VIEW_H - 30, 20, { color: '#cccccc' });
    ctx.restore();
  },

  /**
   * Handle key input. `playAgain`/`quit` are injected by update.js.
   * @param {string} code KeyboardEvent.code
   * @param {{ playAgain?: () => void, quit?: () => void }} [actions]
   */
  onKey(code, actions = {}) {
    if (code === 'Enter' || code === 'Space') {
      if (actions.playAgain) actions.playAgain();
      else if (tryTransition(S.SELECT)) console.log('[screens] WIN → SELECT (play again)');
      return true;
    }
    if (code === 'KeyQ') {
      if (actions.quit) actions.quit();
      else if (tryTransition(S.HOME)) console.log('[screens] WIN → HOME (quit)');
      return true;
    }
    return false;
  },
};

// =============================================================================
// Screen dispatch helpers (used by render.js + update.js)
// =============================================================================

/**
 * Draw the appropriate screen for the current state. Returns true if a screen
 * was drawn. HOME/SELECT are full-screen; PAUSE/OVER/WIN are overlays that
 * render.js draws after the (frozen) game world so the world stays visible
 * behind them.
 */
export function drawScreen(ctx, hero) {
  const s = getState();
  if (s === S.HOME) {
    Home.draw(ctx);
    return true;
  }
  if (s === S.SELECT) {
    Select.draw(ctx);
    return true;
  }
  if (s === S.PAUSE) {
    Pause.draw(ctx);
    return true;
  }
  if (s === S.OVER) {
    GameOver.draw(ctx, hero);
    return true;
  }
  if (s === S.WIN) {
    Win.draw(ctx, hero);
    return true;
  }
  return false;
}

/**
 * Route a key event to the active screen. Returns true if the screen consumed
 * it. PAUSE/OVER/WIN receive an `actions` bag of closures supplied by
 * update.js (level retry, continue, quit) so game-reset logic stays there.
 */
export function screenOnKey(code, hero, actions) {
  const s = getState();
  if (s === S.HOME) {
    Home.onKey(code);
    return true;
  }
  if (s === S.SELECT) {
    Select.onKey(code);
    return true;
  }
  if (s === S.PAUSE) {
    return Pause.onKey(code, actions);
  }
  if (s === S.OVER) {
    return GameOver.onKey(code, hero, actions);
  }
  if (s === S.WIN) {
    return Win.onKey(code, actions);
  }
  return false;
}

/** Update screen-specific per-frame logic (parallax, etc.). */
export function screenUpdate(dt) {
  const s = getState();
  if (s === S.HOME) Home.update(dt);
}
