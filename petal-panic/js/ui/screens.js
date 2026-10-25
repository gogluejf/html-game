// Petal Panic — Home & Select screens (design §20, ).
// ES module; no frameworks. Images are loaded via loadImages() called from
// main.js at startup; draw methods handle missing images gracefully with
// placeholder boxes.

import {S, getState, tryTransition} from '../core/state.js';
import { hasSave } from '../systems/progressStore.js';
import { areaEntryOnAction, setAreaEntryDataCallback, getAreaEntryData as getAreaEntryDataFromLifecycle } from '../systems/lifecycle.js';
import { newGameFromMenu, continueFromMenu, setMenuHeroRegistrar, saveCurrentRun } from '../systems/lifecycle.js';
import { startArea } from '../systems/lifecycle.js';
import { showLevelReward, rewardOnAction, setRewardDataCallback, setEndOfGameScoreCallback, setBossRushReturn } from '../systems/lifecycle.js';
import { HEROES } from '../hero/heroDefs.js';
import { VIEW_W, VIEW_H } from '../core/view.js';
import { calculateScore } from '../stats.js';
import { onTransition } from '../core/state.js';
import {input, navHintEntries, navLabels, markNavPressed, clearNavFlash} from '../core/input.js';


import { surfaceBounds, fillSurface } from '../core/layout.js';

function drawHubBackground(ctx, top = '#0d0d1a', bottom = '#1a1a2e') {
  const b = surfaceBounds();
  const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  fillSurface(ctx);
}
function fillFullSurface(ctx, color) {
  ctx.fillStyle = color;
  fillSurface(ctx);
}
/** Home scenic layers expand for width only; portrait keeps authored sizing.
 * Foreground portraits, logo, and input hints retain their authored layout. */
function drawHomeScenery(ctx, img, x, y, w, h) {
  const b = surfaceBounds();
  // Portrait adds background above/below, never enlarges the stage to fill height.
  if (b.w <= VIEW_W) { ctx.drawImage(img, x, y, w, h); return; }
  const scale = Math.max(1, (b.w + 2 * Math.abs(x)) / w);
  const dw = w * scale, dh = h * scale;
  ctx.drawImage(img, b.x + (b.w - dw) / 2 + x,
    b.y + (b.h - dh) / 2 + y, dw, dh);
}

// --- Image cache -------------------------------------------------------------
import {
  FONT_TITLE, FONT_UI, CREAM, GOLD, RED, PINK, roundRect,
  drawMarqueeTitle, drawPrompt, drawMenace, drawNavBar,
} from './fonts.js';

import { Remap } from '../core/remap.js';
import { setLayoutMode, requestRefit } from '../core/layout.js';
import { setVirtualPadEnabled } from './touchControls.js';
const images = {};
let loadedCount = 0;
let totalCount = 0;

/**
 * Kick off loading of all screen assets. Safe to call once on page load.
 * Images load asynchronously; draw methods check .complete before using them.
 */
export function loadImages() {
  const paths = {
    homeBigtop: '../../assets/interface/home/bigtop_f1.png',
    homeCrowd: '../../assets/interface/home/crowd_f1.png',
    homeStage: '../../assets/interface/home/stage_f1.png',
    homePortrait: '../../assets/interface/home/scarlet_portrait_f1.png',
    squidLogo: '../../assets/interface/squid_os_logo/squid_os_logo_f1.png',
    logo: '../../assets/interface/home/logo_f1.png',
    selectScarlet: '../../assets/interface/select/scarlet_vale_f1.png',
    selectBalthazar: '../../assets/interface/select/balthazar_f1.png',
    selectNone: '../../assets/interface/select/none_f1.png',
  };  totalCount = Object.keys(paths).length;
  for (const [key, path] of Object.entries(paths)) {
    const img = new Image();
    img.onload = () => { loadedCount++; };
    img.onerror = () => { /* mark as failed; draw will show placeholder */ };
    img.src = new URL(path, import.meta.url).href;
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

// Rounded-rect path (works on older canvas without native roundRect).
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
    // FULL SCREEN layout: the gradient runs edge-to-edge across the canvas.
    const homeBounds = surfaceBounds();
    // Home scenery expands horizontally only. Portrait margins are not part
    // of the scene: retain the authored 540-high crop, centered by main.js.
    fillFullSurface(ctx, '#000');
    const grad = ctx.createLinearGradient(0, 0, 0, HOME_H);
    grad.addColorStop(0, '#020208');
    grad.addColorStop(0.5, '#060312');
    grad.addColorStop(1, '#0a0518');
    ctx.fillStyle = grad;
    ctx.fillRect(homeBounds.x, HOME_Y, homeBounds.w, HOME_H);

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
      drawCard('JF RENE PRESENTS', 1, 3.5, 40, CREAM);

      // Card 2: "AI Qwen 3.8 7B / AI Slop production" (4s – 6.5s) — two lines
      if (t >= 4 && t <= 6.5) {
        const fadeIn = Math.min(1, (t - 4) / 0.5);
        const fadeOut = Math.min(1, (6.5 - t) / 0.5);
        ctx.globalAlpha = Math.min(fadeIn, fadeOut);
        drawMarqueeTitle(ctx, 'A QWEN 3.8 7B', VIEW_W / 2, VIEW_H / 2 - 26, 34, { color: '#d8c9a0' });
        drawMarqueeTitle(ctx, 'AI SLOP PRODUCTION', VIEW_W / 2, VIEW_H / 2 + 26, 34, { color: '#d8c9a0' });
      }

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
    const surface = surfaceBounds();
    ctx.rect(surface.x, HOME_Y, surface.w, HOME_H);
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
        drawHomeScenery(ctx, src, 0, vDrift, DW, DH);
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
        drawHomeScenery(ctx, src, -20, vDrift, DW, DH);
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
        drawHomeScenery(ctx, src, cx, cy, DW, DH);
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

    // --- Layer 6: "PRESS ENTER" hint — after logo delay OR after skip ------
    if (gt > 2.7 || this._promptShown) {
      const blink = Math.floor(gt * 2) % 2 === 0;
      drawPrompt(ctx, 'PRESS ENTER', HOME_W / 2, HOME_H - 24, 30, { blink });
    }

    ctx.restore(); // end 4:3 clip
  },

  /** Handle semantic input. During intro: skip to next card. After intro: go to MENU. */
  onAction(action) {
    if (action !== 'confirm') return;
    const t = this.parallaxOffset;
    // Skip through intro cards on press
    if (t < 1) { this.parallaxOffset = 1; return; }       // black → JF Rene
    if (t < 4) { this.parallaxOffset = 4; return; }       // JF Rene → Qwen
    if (t < 7) { this.parallaxOffset = 7; return; }       // Qwen → Squid
    if (t < 9.5) { this.parallaxOffset = 9.5; return; }   // Squid → scene
    // After intro: show "PRESS ENTER" immediately and accept on NEXT press.
    // First press after scene: set the flag so draw shows the prompt.
    // Second press: transition.
    if (!this._promptShown) {
      this._promptShown = true;
      return;
    }
    if (tryTransition(S.MENU)) {
      console.log('[screens] HOME → MENU');
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
    // Background — deep midnight so the cream art cards pop.
    drawHubBackground(ctx, '#0d0d1a', '#1a1a2e');

    // Title.
    drawMarqueeTitle(ctx, 'SELECT YOUR PERFORMER', VIEW_W / 2, 46, 38, { color: CREAM });

    // Layout: one large central art card (swaps by focus) + a right-hand info
    // column (name, special, stat bars). The art is a full-body duo on cream —
    // the focused hero is lit, the other dimmed (see asset inspection).
    const artW = 390, artH = 418;
    const artX = (VIEW_W - artW) / 2 - 150;   // shift left to leave room for info col
    const artY = 78;

    const infoX = artX + artW + 40;
    const infoW = 250;

    const heroes = [HEROES.scarlet, HEROES.balthazar];
    const hero = this.focus >= 0 ? heroes[this.focus] : null;

    // --- Central art card ----------------------------------------------------
    // Thin cream mat (8px) inside the frame so the artwork doesn't touch the
    // border. The PNGs are 1212×1297 (aspect 0.934); the inner box matches that
    // aspect so the art fills it edge-to-edge with no extra letterboxing.
    {
      const MAT = 8;
      const aspect = 1212 / 1297;
      const innerW = Math.min(artW - 2 * MAT, (artH - 2 * MAT) * aspect);
      const innerH = innerW / aspect;
      const ix = artX + (artW - innerW) / 2;
      const iy = artY + (artH - innerH) / 2;

      ctx.save();
      ctx.fillStyle = '#efe4c8';
      roundRect(ctx, artX, artY, artW, artH, 10);
      ctx.fill();
      // Frame is always a neutral dark line — focus is shown by the keycap
      // chips below, never by the card border.
      ctx.strokeStyle = '#5a4a3a';
      ctx.lineWidth = 3;
      roundRect(ctx, artX, artY, artW, artH, 10);
      ctx.stroke();
      ctx.restore();

      // Artwork: pick the focus-state variant (none / scarlet / balthazar).
      const artKey = this.focus === 0 ? 'selectScarlet'
                 : this.focus === 1 ? 'selectBalthazar'
                 : 'selectNone';
      const img = images[artKey];
      if (img?.complete && img.naturalWidth > 0) {
        drawFitted(ctx, img, ix, iy, innerW, innerH);
      } else {
        drawPlaceholder(ctx, ix, iy, innerW, innerH, 'hero art');
      }
    }

    // --- Info column ---------------------------------------------------------
    if (hero) {
      const cy = artY + 30;
      // Name.
      drawMarqueeTitle(ctx, hero.name.toUpperCase(), infoX, cy, 30, {
        align: 'left', color: CREAM,
      });

      // Special ability plaque.
      const specialLabel = 'Specials: Petal Saw / Bomb Burst';
      const plqY = cy + 34;
      ctx.save();
      ctx.fillStyle = 'rgba(255,110,199,0.12)';
      roundRect(ctx, infoX, plqY, infoW, 34, 8);
      ctx.fill();
      ctx.strokeStyle = PINK;
      ctx.lineWidth = 2;
      roundRect(ctx, infoX, plqY, infoW, 34, 8);
      ctx.stroke();
      drawPrompt(ctx, `★ ${specialLabel}`, infoX + infoW / 2, plqY + 17, 19, { color: PINK });
      ctx.restore();

      // Stat bars (small table): SPD / ATK / DEF / JUMP / ENERGY.
      const rows = [
        ['SPEED',  hero.stats.speed,    300],
        ['ATTACK', hero.stats.attack,   25],
        ['DEFENSE',hero.stats.defense,  8],
        ['JUMP',   hero.stats.jump,     560],
        ['ENERGY', hero.stats.stamina,  120],
      ];
      let by = plqY + 34 + 34;
      const labelW = 74, barX = infoX + labelW, barMaxW = infoW - labelW - 6;
      for (const [label, val, max] of rows) {
        ctx.save();
        ctx.font = `14px ${FONT_UI}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#b9a98a';
        ctx.fillText(label, infoX, by + 7);

        // Track.
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        roundRect(ctx, barX, by, barMaxW, 14, 7);
        ctx.fill();
        // Fill.
        const frac = Math.max(0, Math.min(1, val / max));
        const fw = Math.max(8, barMaxW * frac);
        const bg = ctx.createLinearGradient(barX, 0, barX + barMaxW, 0);
        bg.addColorStop(0, '#c0392b');
        bg.addColorStop(1, GOLD);
        ctx.fillStyle = bg;
        roundRect(ctx, barX, by, fw, 14, 7);
        ctx.fill();
        // Value.
        ctx.fillStyle = CREAM;
        ctx.font = `12px ${FONT_UI}`;
        ctx.textAlign = 'right';
        ctx.fillText(String(val), infoX + infoW, by + 7);
        ctx.restore();
        by += 26;
      }
    } else {
      // Nothing focused yet — hint plaque over the art (readable dark bg).
      const pw = 240, ph = 58;
      const px = artX + artW / 2 - pw / 2;
      const py = artY + artH / 2 - ph / 2;
      ctx.save();
      ctx.fillStyle = 'rgba(13,13,26,0.78)';
      roundRect(ctx, px, py, pw, ph, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,215,0,0.35)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, px, py, pw, ph, 10);
      ctx.stroke();
      ctx.font = `18px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e8dcc0';
      const lrIcons = [...navLabels('left', { simple: true }), ...navLabels('right', { simple: true })].join(' ');
      ctx.fillText(`Use ${lrIcons} to choose`, artX + artW / 2, py + ph / 2 - 11);
      ctx.fillText('your performer', artX + artW / 2, py + ph / 2 + 13);
      ctx.restore();
    }

    // --- Controls bar (below the card) ---------------------------------------
    // Keycap chips via drawNavBar + navHintEntries (layout-aware). Each chip
    // highlights ITSELF from the shared input engine — no per-screen wiring.
    // Left/Right stay lit while held; Confirm flashes on press. The same bar
    // works identically on every screen that uses it.
    const barY = artY + artH + 23;
    const cx0 = artX + artW / 2;

    const entries = navHintEntries([
      { actions: ['left', 'right'], label: 'Select', opts: { mode: 'select_layout' } },
      { action: 'confirm', label: 'Confirm', opts: { mode: 'select_layout' } },
    ]);
    drawNavBar(ctx, cx0, barY, entries);
  },

  /** One semantic press per step; adapter handles physical repeat and releases. */
  onAction(action) {
    switch (action) {
      case 'left':
        // none(-1) → scarlet(0); otherwise step left (balthazar → scarlet).
        this.focus = this.focus === -1 ? 0 : Math.max(0, this.focus - 1);
        break;
      case 'right':
        // none(-1) → balthazar(1); otherwise step right (scarlet → balthazar).
        // Right means "the hero on the right", so first-press-right lands on
        // Balthazar, not Scarlet.
        this.focus = this.focus === -1 ? 1 : Math.min(1, this.focus + 1);
        break;
      case 'up':
        // Up loses focus — back to the "no selection" art state.
        this.focus = -1;
        break;
      case 'back':
        // Back to home.
        if (tryTransition(S.HOME)) console.log('[screens] SELECT → HOME (back)');
        break;
      case 'confirm':
        if (this.focus < 0) {
          // No selection yet → focus Scarlet (like pressing ←)
          this.focus = 0;
          return true;
        }
        const heroId = this.focus === 0 ? 'scarlet' : 'balthazar';
        window.__selectedHero = heroId;
        if (tryTransition(S.PLAY)) {
          console.log(`[screens] SELECT → PLAY (hero: ${heroId})`);
        }
        break;
    }
  },


};

// =============================================================================
// MAIN MENU HUB (menu-hub plan §2.2)
// Full-screen entry point between Home and gameplay. Same ergonomics as the
// Pause menu: centered option list, pink focus pill, keycap nav bar — both
// rendered by the shared drawOptionList() below.
// Continue is disabled when no resumable save exists (progressStore.hasSave).
// Back from MENU returns HOME (plan §2.2 acceptance).
// Credits opens a minimal canvas-drawn overlay presented by this screen; any
// key dismisses it back to the hub.
// =============================================================================

// --- Shared option-list layout constants (Pause + Menu + GameOver) -----------
// Hoisted from the inline literals each screen carried before the shared
// renderer existed; values are identical to the previous per-screen output.
const PILL_H = 32;          // focus-pill height
const PILL_R = 6;           // focus-pill corner radius
const PILL_Y_OFF = 16;      // pill top offset above the row baseline
const PILL_ROW_GAP = 40;    // vertical gap between rows (pause/game-over lists)
const TITLE_FONT = FONT_TITLE;
const OPT_FONT_FOCUSED = 22;   // focused row font size (px)
const OPT_FONT_NORMAL = 20;    // unfocused row font size (px)
const COLOR_PILL_FILL = 'rgba(255,110,199,0.10)';
const COLOR_PILL_STROKE = 'rgba(255,110,199,0.4)';
const COLOR_OPT_FOCUSED = '#ff6ec7';
const COLOR_OPT_NORMAL = '#d8cdb4';
const COLOR_OPT_DISABLED = '#555555';

// --- Menu-hub layout constants (task 2.2) ------------------------------------
// The hub's own geometry, hoisted from the drawOptionList() call site so the
// renderer never carries inline magic numbers. Values are identical to the
// first implementation of this screen.
const MENU_TITLE_Y = 74;        // "PETAL PANIC" marquee baseline
const MENU_TITLE_SIZE = 52;     // title font size
const MENU_LIST_START_Y = 150;  // first option row baseline
const MENU_ROW_GAP = 38;        // gap between option rows
const MENU_PILL_W = 260;        // focus-pill width (wider than pause's 240)
const MENU_NAV_GAP = 20;        // space between last row and the nav bar

/**
 * Shared parameterized option-list renderer (F3): draws the pause-style
 * centered list — title, rows with the pink focus pill, and the keycap nav
 * bar. Used by Pause.draw, Menu.draw and GameOver.draw so the three screens
 * cannot drift apart.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {string} [o.title]           marquee title text (omitted → no title)
 * @param {number} [o.titleY]          title baseline Y
 * @param {number} [o.titleSize]      title font size (default 56)
 * @param {Array<{label:string, enabled?:boolean}>} o.items
 * @param {number} [o.focus]            focused index (-1 = none)
 * @param {number} o.startY           first row baseline Y
 * @param {number} [o.gap]            row gap (default PILL_ROW_GAP)
 * @param {number} [o.pillW]          focus-pill width (default 240)
 * @param {Array} [o.navEntries]      navHintEntries() result for the bar
 * @param {number} [o.navGap]         extra space between last row and bar (default 24)
 */
export function drawOptionList(ctx, {
  title, titleY, titleSize = 56, items, focus, startY,
  gap = PILL_ROW_GAP, pillW = 240, navEntries, navGap = 24,
}) {
  if (title) {
    drawMarqueeTitle(ctx, title, VIEW_W / 2, titleY, titleSize, { color: CREAM });
  }

  for (let i = 0; i < items.length; i++) {
    const y = startY + i * gap;
    const focused = i === focus;
    if (focused) {
      ctx.save();
      ctx.fillStyle = COLOR_PILL_FILL;
      roundRect(ctx, VIEW_W / 2 - pillW / 2, y - PILL_Y_OFF, pillW, PILL_H, PILL_R);
      ctx.fill();
      ctx.strokeStyle = COLOR_PILL_STROKE;
      ctx.lineWidth = 1;
      roundRect(ctx, VIEW_W / 2 - pillW / 2, y - PILL_Y_OFF, pillW, PILL_H, PILL_R);
      ctx.stroke();
      ctx.restore();
    }
    drawPrompt(ctx, (focused ? '▸ ' : '  ') + items[i].label, VIEW_W / 2, y + 2,
      focused ? OPT_FONT_FOCUSED : OPT_FONT_NORMAL, {
        color: !items[i].enabled ? COLOR_OPT_DISABLED
             : (focused ? COLOR_OPT_FOCUSED : COLOR_OPT_NORMAL),
      });
  }

  if (navEntries) {
    const hintY = startY + items.length * gap + navGap;
    drawNavBar(ctx, VIEW_W / 2, hintY, navEntries);
  }
}

/** The hero the menu hub routes Continue to (set by update.js via setMenuHero). */
let _menuHero = null;

/** Register the current hero for the menu's Continue flow (update.js calls
 *  this at boot and on every hero swap, so MENU → AREA_ENTRY always resumes
 *  on the live hero instance). */
export function setMenuHero(h) { _menuHero = h ?? null; }

/** @returns {object|null} the hero registered for the menu's Continue flow. */
export function getMenuHero() { return _menuHero; }

// Register setMenuHero with lifecycle.js so startGame() can record every freshly
// built hero as the Continue target (menu-hub plan §2.3). This runs at module
// evaluation — before any game boots — so the very first startGame registers
// the boot hero. The callback indirection (rather than a direct import) avoids
// a circular module-evaluation TDZ error between screens.js and lifecycle.js.
setMenuHeroRegistrar(setMenuHero);

export const Menu = {
  focus: 0,
  creditsOpen: false,

  /** The top-level options with live enabled flags (draw + onAction share this).
   * Each option carries its own routing data (F5): `go` transitions to the
   * named state, or `action` names a special handler. execute() dispatches on
   * this data — never on label strings. */
  options() {
    const saved = hasSave();
    return [
      ...(saved ? [
        { label: 'Continue', enabled: true, action: 'continue' },
        { label: 'New Game', enabled: true, action: 'newGame' },
      ] : [
        { label: 'New Game', enabled: true, action: 'newGame' },
        { label: 'No Save', enabled: false, action: 'continue' },
      ]),
      { label: 'Level Select', enabled: true,  go: S.LEVEL_SELECT },
      { label: 'Boss Rush',    enabled: true,  go: S.BOSS_RUSH },
      { label: 'Media',        enabled: true,  go: S.MEDIA },
      { label: 'Controls',     enabled: true,  go: S.REMAP },
      { label: 'Options',      enabled: true,  go: S.OPTIONS },
      { label: 'Credits',      enabled: true,  action: 'credits' },
    ];
  },

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    // Full-opaque dark background — like SELECT, the world is hidden behind
    // this full-screen hub.
    drawHubBackground(ctx, '#0d0d1a', '#1a1a2e');

    if (this.creditsOpen) {
      this.drawCredits(ctx);
      return;
    }

    drawOptionList(ctx, {
      title: 'PETAL PANIC',
      titleY: MENU_TITLE_Y,
      titleSize: MENU_TITLE_SIZE,
      items: this.options(),
      focus: this.focus,
      startY: MENU_LIST_START_Y,
      gap: MENU_ROW_GAP,
      pillW: MENU_PILL_W,
      navGap: MENU_NAV_GAP,
      navEntries: navHintEntries([
        { actions: ['up', 'down'], label: 'Navigate', opts: { mode: 'select_layout' } },
        { action: 'confirm', opts: { mode: 'select_layout' } },
        { action: 'back', label: 'Home', opts: { mode: 'select_layout' } },
      ]),
    });
  },

  /** Minimal canvas-drawn credits overlay (F1): title + a few lines + a
   * dismissal prompt. Any nav action dismisses it back to the hub. */
  drawCredits(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    fillSurface(ctx);

    drawMarqueeTitle(ctx, 'CREDITS', VIEW_W / 2, 110, 44, { color: CREAM });

    const lines = [
      ['Design & Code', 'JF Rene'],
      ['Art Direction', 'AI Qwen 3.8 7B'],
      ['Built with', 'Squid-OS'],
    ];
    let y = 200;
    for (const [role, name] of lines) {
      ctx.font = `16px ${TITLE_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#b9a98a';
      ctx.fillText(role.toUpperCase(), VIEW_W / 2, y);
      ctx.font = `24px ${FONT_UI}`;
      ctx.fillStyle = CREAM;
      ctx.fillText(name, VIEW_W / 2, y + 28);
      y += 78;
    }

    // G3: the input system only forwards NAV actions (KEY_NAV/PAD_NAV) to
    // screens — unmapped keys never reach onAction — so "PRESS ANY KEY" was
    // inaccurate. We chose option (b): name the real dismiss keys instead of
    // routing raw keydowns through a new path (which would bypass the shared
    // action pipeline and its remap/flash semantics). Escape covers both
    // 'back' and 'pause'; Enter/Space cover 'confirm'.
    drawPrompt(ctx, 'PRESS ENTER OR ESC', VIEW_W / 2, VIEW_H - 40, 20, { blink: true });
    ctx.restore();
  },

  /**
   * Handle semantic input. While the credits overlay is open, ANY action
   * closes it and CONSUMES THE ENTIRE INPUT GENERATION (G2): KEY_NAV maps a
   * single physical key (Escape) to multiple actions in one poll ('back' AND
   * 'pause'), and screenOnAction rewrites leftover 'pause' edges to 'confirm'.
   * If dismissal only ate the first action, the second would immediately
   * reopen the overlay (or fire the focused option). Returning true from
   * screenOnAction makes dispatchScreenInput stop processing this generation;
   * the engine's barrier() on any transition clears the rest of the batch.
   * Otherwise up/down move focus (skipping disabled entries); confirm routes
   * via the option's own routing data; back returns HOME.
   * @returns {boolean} whether the action was handled
   */
  onAction(action) {
    if (this.creditsOpen) {
      this.creditsOpen = false;
      // G2: consume the rest of THIS input generation — KEY_NAV maps one
      // physical key (Escape) to multiple actions in one poll ('back' AND
      // 'pause'), and screenOnAction rewrites leftover 'pause' edges to
      // 'confirm'. Without this, the second action would immediately reopen
      // the overlay. dispatchScreenInput reads the flag after each action
      // and stops the batch; it is cleared at the top of every tick so a
      // stale flag can never swallow the NEXT generation's actions.
      consumedGeneration = true;
      return true; // eat the whole generation — nothing else runs this frame
    }
    const n = this.options().length;
    switch (action) {
      case 'up':
        this.moveFocus(-1, n);
        return true;
      case 'down':
        this.moveFocus(1, n);
        return true;
      case 'back':
        if (tryTransition(S.HOME)) console.log('[screens] MENU → HOME (back)');
        return true;
      case 'confirm':
        this.execute();
        return true;
    }
    return false;
  },

  /** Step focus by `dir`, skipping disabled entries (wrap-around). */
  moveFocus(dir, n) {
    let next = this.focus;
    for (let step = 0; step < n; step++) {
      next = (next + dir + n) % n;
      if (this.options()[next].enabled) { this.focus = next; return; }
    }
  },

  /** Route to the focused destination using the option's own routing data
   * (F5): `go` → transition, `action` → special handler. No-op when disabled. */
  execute() {
    const opt = this.options()[this.focus];
    if (!opt || !opt.enabled) return;
    if (opt.go !== undefined) {
      if (tryTransition(opt.go)) console.log(`[screens] MENU → ${S[opt.go]} (${opt.label})`);
      return;
    }
    switch (opt.action) {
      case 'newGame':
        // Plan §2.3: New Game drops the resumable run save (meta unlocks are
        // preserved by clearRunSave) and opens the hero-select screen.
        window.__selectedHero = null; // force hero selection
        if (newGameFromMenu()) console.log('[screens] MENU → SELECT (new game)');
        break;
      case 'continue':
        // Plan §2.3: Continue restores the saved level/area on the hero and
        // opens the shared area-entry screen (AREA_ENTRY). No-op when no save
        // exists (the option is disabled in that case — safety net only).
        continueFromMenu(_menuHero);
        break;
      case 'credits':
        this.creditsOpen = true;
        break;
    }
  },

  reset() { this.focus = 0; this.creditsOpen = false; },
};

import { buildLevelMap, buildSubAreasForLevel } from './levelSelectModel.js';
import { loadStore, updateSettings } from '../systems/progressStore.js';
import { buildBossRushCards } from './bossRushModel.js';

// =============================================================================
// LEVEL SELECT SCREEN (menu-hub plan §3.2 — grid rework)
//
// Two-pane canvas screen in the hub's card/focus style:
//   left  — classic GRID of stage cells: 8 rows (levels 1..8) × 5 columns
//           (zones 1,2,3,4,B). Each cell keeps the sub-area chip look; locked
//           cells are dimmed with a padlock, completed cells get a gold star.
//           Level names sit to the left of each row. The cursor is one cell.
//   right — detail card for the FOCUSED cell: status line, and for locked
//           cards the "Pass <previous stage> to unlock" hint (the model's
//           tooltip); for unlocked/completed cards a play/replay hint.
// Navigation: up/down/left/right move the cursor one cell on the grid (edges
// clamp, no wrap). Locked cells CAN be focused so you always see what blocks
// them — confirm on a locked cell is a no-op. Confirm starts the focused
// UNLOCKED zone through AREA_ENTRY (startArea → showAreaEntry), back returns
// MENU. On entry the cursor lands on the next playable stage (first unlocked
// non-completed cell, else first unlocked, else top-left).
// The zone+checkpoint installation for the LEVEL_SELECT→AREA_ENTRY transition
// is owned by update.js's area-entry install hook (generalized from MENU).
// =============================================================================

// --- Level-select layout constants ------------------------------------------
const LS_TITLE_Y = 60;               // "LEVEL SELECT" marquee baseline
const LS_TITLE_SIZE = 44;
const LS_GRID_COLS = 5;              // zones per level row (1,2,3,4,B)
const LS_GRID_ROWS = 8;              // levels 1..8
const LS_CELL_W = 92;                // cell width
const LS_CELL_H = 42;                // cell height (nav bar keeps a clear strip below)
const LS_CELL_DX = 104;              // horizontal spacing between cell centers
const LS_CELL_DY = 44;               // vertical spacing between cell centers
const LS_NAME_X = 34;                // level-name text center X (left of grid)
const LS_GRID_CX0 = 170;             // first column center X
const LS_GRID_CY0 = 138;             // first row center Y
const LS_CARD_X = 700;               // right detail-card left edge
const LS_CARD_Y = 110;               // right detail-card top edge
const LS_CARD_W = 240;
const LS_CARD_H = 320;
const LS_NAV_Y = 502;                // keycap nav bar Y (centered in the bottom strip below the grid)

/** Draw a small padlock glyph centered at (x, y) with `size` px body height. */
function drawLockIcon(ctx, x, y, size, color) {
  const w = size * 0.8, h = size;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, size / 8);
  // shackle
  ctx.beginPath();
  ctx.arc(x, y - h * 0.25, w * 0.32, Math.PI, 0);
  ctx.stroke();
  // body
  roundRect(ctx, x - w / 2, y - h * 0.25, w, h * 0.75, size / 10);
  ctx.fill();
  ctx.restore();
}

export const LevelSelect = {
  /** Focus is a grid cell: levelIdx (0..7) × zoneIdx (0..4). */
  focus: { levelIdx: 0, zoneIdx: 0 },

  /** Live model data (rebuilt every draw + onAction so progress changes show). */
  _map() { return buildLevelMap(loadStore().progress); },
  _zones(levelIdx) { return buildSubAreasForLevel(this._map()[levelIdx].level, loadStore().progress); },

  /** Cell center coordinates for (row, col). */
  _cellX(col) { return LS_GRID_CX0 + col * LS_CELL_DX; },
  _cellY(row) { return LS_GRID_CY0 + row * LS_CELL_DY; },

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    drawHubBackground(ctx, '#0d0d1a', '#1a1a2e');

    drawMarqueeTitle(ctx, 'LEVEL SELECT', VIEW_W / 2, LS_TITLE_Y, LS_TITLE_SIZE, { color: CREAM });

    const map = this._map();

    // --- Left pane: 8×5 grid of stage cells ----------------------------------
    for (let r = 0; r < LS_GRID_ROWS; r++) {
      const m = map[r];
      const y = this._cellY(r);
      // Level name to the left of the row.
      ctx.save();
      ctx.globalAlpha = m.status === 'locked' ? 0.45 : 1;
      ctx.fillStyle = m.status === 'completed' ? GOLD : CREAM;
      ctx.font = `bold 13px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.name.toUpperCase(), LS_NAME_X, y - 9);
      ctx.font = `11px ${FONT_UI}`;
      ctx.fillStyle = '#b9a98a';
      ctx.fillText(`LVL ${m.level}`, LS_NAME_X, y + 9);
      ctx.restore();

      const zones = this._zones(r);
      for (let c = 0; c < LS_GRID_COLS; c++) {
        const z = zones[c];
        const x = this._cellX(c);
        const cx = x - LS_CELL_W / 2;
        const cy = y - LS_CELL_H / 2;
        const focusedCell = r === this.focus.levelIdx && c === this.focus.zoneIdx;
        ctx.save();
        // Focused cell: pink pill behind everything else.
        if (focusedCell) {
          ctx.fillStyle = COLOR_PILL_FILL;
          roundRect(ctx, cx - 3, cy - 3, LS_CELL_W + 6, LS_CELL_H + 6, 10);
          ctx.fill();
          ctx.strokeStyle = COLOR_PILL_STROKE;
          ctx.lineWidth = 2;
          roundRect(ctx, cx - 3, cy - 3, LS_CELL_W + 6, LS_CELL_H + 6, 10);
          ctx.stroke();
        }
        ctx.globalAlpha = z.status === 'locked' ? 0.45 : 1;
        ctx.strokeStyle = z.boss ? GOLD : '#8a7f68';
        ctx.lineWidth = 1.5;
        roundRect(ctx, cx, cy, LS_CELL_W, LS_CELL_H, 8);
        ctx.stroke();
        // Label + status glyph.
        ctx.fillStyle = focusedCell ? COLOR_OPT_FOCUSED : CREAM;
        ctx.font = `bold 17px ${FONT_UI}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (z.status === 'locked') {
          drawLockIcon(ctx, x, y - 8, 12, '#8a8a9a');
          ctx.globalAlpha = 0.45;
          ctx.font = `13px ${FONT_UI}`;
          ctx.fillText(z.label, x, y + 12);
        } else if (z.status === 'completed') {
          ctx.fillText(`${z.label} ★`, x, y);
        } else {
          ctx.fillText(z.label, x, y);
        }
        ctx.restore();
      }
    }

    // --- Right pane: detail card for the focused cell ------------------------
    const selLevel = map[this.focus.levelIdx];
    const focused = this._zones(this.focus.levelIdx)[this.focus.zoneIdx];
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(ctx, LS_CARD_X, LS_CARD_Y, LS_CARD_W, LS_CARD_H, 12);
    ctx.fill();
    ctx.strokeStyle = focused.status === 'locked' ? 'rgba(138,138,154,0.5)' : COLOR_PILL_STROKE;
    ctx.lineWidth = 2;
    roundRect(ctx, LS_CARD_X, LS_CARD_Y, LS_CARD_W, LS_CARD_H, 12);
    ctx.stroke();

    const ccx = LS_CARD_X + LS_CARD_W / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Card header: big area id.
    ctx.globalAlpha = focused.status === 'locked' ? 0.5 : 1;
    drawMarqueeTitle(ctx, focused.label, ccx, LS_CARD_Y + 55, 40, {
      color: focused.status === 'completed' ? GOLD : CREAM,
    });
    ctx.font = `15px ${FONT_UI}`;
    ctx.fillStyle = '#b9a98a';
    ctx.fillText(focused.boss ? `${selLevel.name} — BOSS ZONE` : `${selLevel.name} — AREA ${focused.zone}`, ccx, LS_CARD_Y + 95);

    // Status line + hint (the hover-style tooltip lives here, plan §3.2).
    if (focused.status === 'locked') {
      drawLockIcon(ctx, ccx, LS_CARD_Y + 140, 22, '#8a8a9a');
      ctx.globalAlpha = 1;
      ctx.font = `16px ${FONT_UI}`;
      ctx.fillStyle = '#ff9f9f';
      ctx.fillText(focused.tooltip ?? '', ccx, LS_CARD_Y + 175);
      ctx.font = `13px ${FONT_UI}`;
      ctx.fillStyle = '#8a8a9a';
      ctx.fillText('LOCKED', ccx, LS_CARD_Y + 205);
    } else if (focused.status === 'completed') {
      ctx.font = `17px ${FONT_UI}`;
      ctx.fillStyle = GOLD;
      ctx.fillText('COMPLETED ★', ccx, LS_CARD_Y + 150);
      ctx.font = `14px ${FONT_UI}`;
      ctx.fillStyle = '#b9a98a';
      ctx.fillText('Press Confirm to replay', ccx, LS_CARD_Y + 180);
    } else {
      ctx.font = `17px ${FONT_UI}`;
      ctx.fillStyle = COLOR_OPT_FOCUSED;
      ctx.fillText('READY TO PLAY', ccx, LS_CARD_Y + 150);
      ctx.font = `14px ${FONT_UI}`;
      ctx.fillStyle = '#b9a98a';
      ctx.fillText('Press Confirm to start', ccx, LS_CARD_Y + 180);
    }
    ctx.restore();

    // --- Keycap nav bar -------------------------------------------------------
    drawNavBar(ctx, VIEW_W / 2, LS_NAV_Y, navHintEntries([
      { actions: ['up', 'down', 'left', 'right'], label: 'Browse', opts: { mode: 'select_layout' } },
      { action: 'confirm', label: 'Start', opts: { mode: 'select_layout' } },
      { action: 'back', label: 'Menu', opts: { mode: 'select_layout' } },
    ]));
  },

  /** Move the cursor one cell on the grid; edges clamp (no wrap). */
  _moveGrid(dRow, dCol) {
    this.focus.levelIdx = Math.max(0, Math.min(LS_GRID_ROWS - 1, this.focus.levelIdx + dRow));
    this.focus.zoneIdx = Math.max(0, Math.min(LS_GRID_COLS - 1, this.focus.zoneIdx + dCol));
  },

  /**
   * Handle semantic input. Arrows move the cursor one cell on the 8×5 grid
   * (locked cells can be focused — they show their gate in the detail card),
   * confirm starts the focused UNLOCKED zone through AREA_ENTRY, back returns
   * MENU.
   * @returns {boolean} whether the action was handled
   */
  onAction(action) {
    switch (action) {
      case 'up':
        this._moveGrid(-1, 0);
        return true;
      case 'down':
        this._moveGrid(1, 0);
        return true;
      case 'left':
        this._moveGrid(0, -1);
        return true;
      case 'right':
        this._moveGrid(0, 1);
        return true;
      case 'back':
        if (tryTransition(S.MENU)) console.log('[screens] LEVEL_SELECT → MENU (back)');
        return true;
      case 'confirm': {
        const focused = this._zones(this.focus.levelIdx)[this.focus.zoneIdx];
        if (!focused || focused.status === 'locked') return true; // safety net
        const h = getMenuHero();
        // I2 (review round 1): no registered hero (fresh boot → MENU → Level
        // Select) means there is NO live hero instance for the install hook in
        // update.js to resume on — fabricating a stub here would show the
        // entry screen with stub lives while AREA_ENTRY→PLAY starts play on a
        // different instance. Do NOT fabricate: warn and stay on LEVEL_SELECT.
        // In real gameplay a hero always exists by the time this screen is
        // reachable (startGame registers it via setMenuHero at boot).
        if (!h) {
          console.warn('[screens] LEVEL_SELECT confirm blocked: no menu hero registered yet');
          return true;
        }
        // startArea sets currentLevel/currentArea, resets specials, records the
        // entry snapshot and opens the shared AREA_ENTRY screen (showAreaEntry).
        // Zone content + spawn checkpoint install via update.js's
        // LEVEL_SELECT→AREA_ENTRY hook (same path as MENU continue).
        startArea(h, focused.start.level, focused.start.area);
        console.log(`[screens] LEVEL_SELECT → AREA_ENTRY (${focused.label})`);
        return true;
      }
    }
    return false;
  },

  /**
   * Reset on entry: land the cursor on the next playable stage — first
   * unlocked non-completed cell scanning rows top-to-bottom; if everything
   * unlocked is already completed, the first unlocked cell; else top-left.
   */
  reset() {
    let fallback = null;
    outer:
    for (let r = 0; r < LS_GRID_ROWS; r++) {
      const zones = this._zones(r);
      for (let c = 0; c < LS_GRID_COLS; c++) {
        if (zones[c].status === 'unlocked') {
          this.focus = { levelIdx: r, zoneIdx: c };
          break outer;
        }
        if (fallback === null && zones[c].status !== 'locked') fallback = { levelIdx: r, zoneIdx: c };
      }
    }
    if (fallback && !this.focus.levelIdx && !this.focus.zoneIdx) this.focus = fallback;
  },
};

// =============================================================================
// BOSS RUSH SCREEN (menu-hub plan §3.3)
//
// Canvas screen of boss cards — one per LEVEL_CONFIGS entry (8), laid out as a
// grid in the left/center pane with a right-side detail card for the FOCUSED
// boss (the hover-style tooltip pattern shared with Level Select):
//   - locked   → silhouette disc + lock icon, NO name or image anywhere; the
//                detail card shows 'Pass Level X to unlock this boss'
//   - unlocked → boss card art (assets/boss/<id>/card_f1.png) + name
//   - defeated → card art dimmed + gold star + name (defeated is revealed)
// Navigation: left/right AND up/down step through the cards, skipping locked
// ones (wrap-around) so focus can only rest on playable bosses. Confirm starts
// the focused boss through AREA_ENTRY (startArea → showAreaEntry, the same
// path Level Select uses); the zone install hook in update.js handles the
// world swap. Back returns MENU.
// Post-battle routing (user decision 2026-10-24): confirm arms
// setBossRushReturn(true) in lifecycle.js; after the NORMAL victory reward
// summary, rewardOnAction routes REWARD → BOSS_RUSH instead of advancing to
// the next level (no auto-advance). The flag lives in lifecycle.js precisely
// so it survives the PLAY/REWARD detour — screenReset(to) runs on every
// transition and would clobber any screen-local copy. Focus preservation:
// screenReset(BOSS_RUSH) keeps this.focus when the return comes from REWARD
// (the post-battle route); a fresh entry from MENU resets it.
// =============================================================================

// --- Boss-rush layout constants ---------------------------------------------
const BR_TITLE_Y = 60;                 // "BOSS RUSH" marquee baseline
const BR_TITLE_SIZE = 44;
const BR_CARD_W = 132;                 // card width
const BR_CARD_H = 168;                 // card height (nav bar keeps a clear strip below)
const BR_PAD_X = 16;                   // inner side padding (art box inset)
const BR_GAP_X = 18;                   // horizontal gap between cards
const BR_GAP_Y = 18;                   // vertical gap between rows
const BR_COLS = 4;                     // 4 × 2 grid of 8 cards
const BR_GRID_X = 50;                  // first card's left edge
const BR_GRID_Y = 120;                 // first row's top edge
const BR_CARD_ART_H = 92;              // art box height inside a card
const BR_DETAIL_X = 650;               // right detail-card left edge (grid end 632 + 18 gap)
const BR_DETAIL_Y = 120;               // top matches first grid row top
const BR_DETAIL_W = 290;               // fills to x=940 (20px viewport margin)
const BR_DETAIL_ART_H = 190;           // ends at +268; status at +290 stays below art
const BR_DETAIL_H = 358;               // 120..478: matches both grid rows' extent
const BR_NAV_Y = 509;                 // keycap nav bar Y (centered in the bottom strip below the cards)

/** Boss card art cache (loaded lazily; drawFitted guards .complete). */
const bossCardImages = {};
function bossCardImage(bossId) {
  if (!bossCardImages[bossId]) {
    const img = new Image();
    img.src = new URL(`../../assets/boss/${bossId}/card_f1.png`, import.meta.url).href;
    bossCardImages[bossId] = img;
  }
  return bossCardImages[bossId];
}

/**
 * Draw boss card art COVER-fit into a box: fit the height, center-crop the
 * sides. The source rect is computed from the image's natural size so no
 * asset changes are needed. `grayscale` renders B&W (unselected/locked look);
 * false renders full color (selected). Falls back to plain color when the
 * canvas has no filter support.
 */
function drawBossCardCover(ctx, img, x, y, w, h, grayscale) {
  if (!img || !img.complete || img.naturalWidth === 0) return false;
  const scale = h / img.naturalHeight;
  const srcW = w / scale;
  const srcX = (img.naturalWidth - srcW) / 2;
  ctx.save();
  if (grayscale && 'filter' in ctx) ctx.filter = 'grayscale(1)';
  ctx.drawImage(img, srcX, 0, srcW, img.naturalHeight, x, y, w, h);
  ctx.restore();
  return true;
}

/**
 * Draw `text` centered at (cx, cy) in bold FONT_UI, shrinking the font from
 * `maxSize` down to `minSize` until it fits within `maxW` px. Returns the size
 * used. (Lilita One is wider than typical UI fonts — long boss names like
 * 'Ratchet Rumbelow' need this on the small grid cards.)
 */
function drawFittingText(ctx, text, cx, cy, maxW, maxSize, minSize, color) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `bold ${size}px ${FONT_UI}`;
    if (ctx.measureText(text).width <= maxW) break;
    size -= 0.5;
  }
  ctx.font = `bold ${size}px ${FONT_UI}`;
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
  return size;
}

export const BossRush = {
  /** Focus is an index into buildBossRushCards() (0..7). */
  focus: 0,

  /** Live model data (rebuilt every draw + onAction so progress changes show). */
  _cards() { return buildBossRushCards(loadStore().progress); },

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    drawHubBackground(ctx, '#0d0d1a', '#1a1a2e');

    drawMarqueeTitle(ctx, 'BOSS RUSH', VIEW_W / 2, BR_TITLE_Y, BR_TITLE_SIZE, { color: CREAM });

    const cards = this._cards();
    const focused = cards[this.focus];

    // --- Card grid (4 × 2) ----------------------------------------------------
    cards.forEach((card, i) => {
      const col = i % BR_COLS, row = Math.floor(i / BR_COLS);
      const x = BR_GRID_X + col * (BR_CARD_W + BR_GAP_X);
      const y = BR_GRID_Y + row * (BR_CARD_H + BR_GAP_Y);
      const isFocused = i === this.focus;
      const locked = card.status === 'locked';
      const defeated = card.status === 'defeated';
      ctx.save();
      // Card body.
      ctx.fillStyle = isFocused ? COLOR_PILL_FILL : 'rgba(255,255,255,0.04)';
      roundRect(ctx, x, y, BR_CARD_W, BR_CARD_H, 10);
      ctx.fill();
      ctx.strokeStyle = isFocused ? COLOR_PILL_STROKE : (locked ? 'rgba(138,138,154,0.35)' : '#8a7f68');
      ctx.lineWidth = isFocused ? 2 : 1.5;
      roundRect(ctx, x, y, BR_CARD_W, BR_CARD_H, 10);
      ctx.stroke();

      const cx = x + BR_CARD_W / 2;
      const artY = y + 14;
      // Boss art on EVERY card (spoilers accepted by design): cover-fit into
      // the art box. Selected → full color; unselected → grayscale B&W.
      const img = bossCardImage(card.bossId);
      if (img?.complete && img.naturalWidth > 0) {
        drawBossCardCover(ctx, img, x + BR_PAD_X, artY, BR_CARD_W - 2 * BR_PAD_X, BR_CARD_ART_H, !isFocused);
      } else {
        drawPlaceholder(ctx, x + BR_PAD_X, artY, BR_CARD_W - 2 * BR_PAD_X, BR_CARD_ART_H, 'boss card');
      }
      if (locked) {
        // Locked overlay: dim wash + lock icon over the B&W art.
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#0d0d1a';
        roundRect(ctx, x + BR_PAD_X, artY, BR_CARD_W - 2 * BR_PAD_X, BR_CARD_ART_H, 6);
        ctx.fill();
        ctx.globalAlpha = 1;
        drawLockIcon(ctx, cx, artY + BR_CARD_ART_H / 2, 26, '#c9c9d6');
      }
      if (defeated) {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = GOLD;
        ctx.font = `bold 18px ${FONT_UI}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('★', x + BR_CARD_W - 14, y + 8);
        ctx.globalAlpha = 1;
      }
      // "LEVEL n" thin white above the name.
      ctx.font = `11px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`LEVEL ${card.index}`, cx, y + BR_CARD_H - 36);
      drawFittingText(ctx, card.name, cx, y + BR_CARD_H - 18, BR_CARD_W - 2 * BR_PAD_X, 15, 10,
        isFocused ? COLOR_OPT_FOCUSED : CREAM);
      ctx.restore();
    });

    // --- Right pane: detail card for the focused boss -------------------------
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(ctx, BR_DETAIL_X, BR_DETAIL_Y, BR_DETAIL_W, BR_DETAIL_H, 12);
    ctx.fill();
    ctx.strokeStyle = focused.status === 'locked' ? 'rgba(138,138,154,0.5)' : COLOR_PILL_STROKE;
    ctx.lineWidth = 2;
    roundRect(ctx, BR_DETAIL_X, BR_DETAIL_Y, BR_DETAIL_W, BR_DETAIL_H, 12);
    ctx.stroke();

    const ccx = BR_DETAIL_X + BR_DETAIL_W / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (focused.status === 'locked') {
      // Locked: B&W boss art (spoilers accepted) + lock glyph + tooltip.
      drawMarqueeTitle(ctx, focused.name.toUpperCase(), ccx, BR_DETAIL_Y + 50, 26, {
        color: CREAM,
      });
      const limg = bossCardImage(focused.bossId);
      if (limg?.complete && limg.naturalWidth > 0) {
        drawBossCardCover(ctx, limg, BR_DETAIL_X + 35, BR_DETAIL_Y + 78, BR_DETAIL_W - 70, BR_DETAIL_ART_H, true);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#0d0d1a';
        roundRect(ctx, BR_DETAIL_X + 35, BR_DETAIL_Y + 78, BR_DETAIL_W - 70, BR_DETAIL_ART_H, 6);
        ctx.fill();
        ctx.globalAlpha = 1;
        drawLockIcon(ctx, ccx, BR_DETAIL_Y + 78 + BR_DETAIL_ART_H / 2, 34, '#e8e8f2');
      } else {
        drawPlaceholder(ctx, BR_DETAIL_X + 35, BR_DETAIL_Y + 78, BR_DETAIL_W - 70, BR_DETAIL_ART_H, 'boss card');
        drawLockIcon(ctx, ccx, BR_DETAIL_Y + 78 + BR_DETAIL_ART_H / 2, 34, '#8a8a9a');
      }
      ctx.font = `17px ${FONT_UI}`;
      ctx.fillStyle = '#ff9f9f';
      ctx.fillText(focused.tooltip ?? '', ccx, BR_DETAIL_Y + 290);
      ctx.font = `13px ${FONT_UI}`;
      ctx.fillStyle = '#8a8a9a';
      ctx.fillText('LOCKED', ccx, BR_DETAIL_Y + 322);
    } else {
      // Unlocked/defeated: boss name headline + COLOR card art + status line.
      drawMarqueeTitle(ctx, focused.name.toUpperCase(), ccx, BR_DETAIL_Y + 50, 26, {
        color: focused.status === 'defeated' ? GOLD : CREAM,
      });
      const img = bossCardImage(focused.bossId);
      if (img?.complete && img.naturalWidth > 0) {
        drawBossCardCover(ctx, img, BR_DETAIL_X + 35, BR_DETAIL_Y + 78, BR_DETAIL_W - 70, BR_DETAIL_ART_H, false);
      } else {
        drawPlaceholder(ctx, BR_DETAIL_X + 35, BR_DETAIL_Y + 78, BR_DETAIL_W - 70, BR_DETAIL_ART_H, 'boss card');
      }
      ctx.font = `17px ${FONT_UI}`;
      if (focused.status === 'defeated') {
        ctx.fillStyle = GOLD;
        ctx.fillText('DEFEATED ★', ccx, BR_DETAIL_Y + 290);
        ctx.font = `14px ${FONT_UI}`;
        ctx.fillStyle = '#b9a98a';
        ctx.fillText('Press Confirm to fight again', ccx, BR_DETAIL_Y + 322);
      } else {
        ctx.fillStyle = COLOR_OPT_FOCUSED;
        ctx.fillText('READY TO FIGHT', ccx, BR_DETAIL_Y + 290);
        ctx.font = `14px ${FONT_UI}`;
        ctx.fillStyle = '#b9a98a';
        ctx.fillText('Press Confirm to start', ccx, BR_DETAIL_Y + 322);
      }
    }
    ctx.restore();

    // --- Keycap nav bar -------------------------------------------------------
    drawNavBar(ctx, VIEW_W / 2, BR_NAV_Y, navHintEntries([
      { actions: ['left', 'right'], label: 'Boss', opts: { mode: 'select_layout' } },
      { actions: ['up', 'down'], label: 'Row', opts: { mode: 'select_layout' } },
      { action: 'confirm', label: 'Fight', opts: { mode: 'select_layout' } },
      { action: 'back', label: 'Menu', opts: { mode: 'select_layout' } },
    ]));
  },

  /** Step the focus by dir (±1), skipping locked cards (wrap-around). */
  _move(dir) {
    const cards = this._cards();
    let next = this.focus;
    for (let step = 0; step < cards.length; step++) {
      next = (next + dir + cards.length) % cards.length;
      if (cards[next].status !== 'locked') { this.focus = next; return; }
    }
  },

  /** Move one ROW on the grid (up/down): same column, adjacent row. Clamps at
   * the top/bottom rows; a locked card in the target cell is skipped to the
   * next unlocked card in that row (leftmost first). */
  _moveRow(dRow) {
    const cards = this._cards();
    const fromCol = this.focus % BR_COLS;
    const targetRow = Math.max(0, Math.min(1, Math.floor(this.focus / BR_COLS) + dRow));
    if (targetRow === Math.floor(this.focus / BR_COLS)) return; // clamped
    for (let col = 0; col < BR_COLS; col++) {
      const idx = targetRow * BR_COLS + ((fromCol + col) % BR_COLS);
      if (cards[idx].status !== 'locked') { this.focus = idx; return; }
    }
  },

  /**
   * Handle semantic input. Left/right step along the row (skipping locked
   * cards, wrap-around); up/down move one ROW on the grid (same column,
   * clamped at the edges). Confirm starts the focused unlocked boss through
   * AREA_ENTRY, back returns MENU.
   * @returns {boolean} whether the action was handled
   */
  onAction(action) {
    switch (action) {
      case 'left':
        this._move(-1);
        return true;
      case 'right':
        this._move(1);
        return true;
      case 'up':
        this._moveRow(-1);
        return true;
      case 'down':
        this._moveRow(1);
        return true;
      case 'back':
        if (tryTransition(S.MENU)) console.log('[screens] BOSS_RUSH → MENU (back)');
        return true;
      case 'confirm': {
        const focused = this._cards()[this.focus];
        if (!focused || focused.status === 'locked') return true; // safety net
        const h = getMenuHero();
        // Same I2 guard as Level Select: no registered hero means there is no
        // live instance for the install hook to resume on — do NOT fabricate.
        if (!h) {
          console.warn('[screens] BOSS_RUSH confirm blocked: no menu hero registered yet');
          return true;
        }
        // Arm the post-victory return BEFORE starting: the battle then runs
        // the normal AREA_ENTRY → boss fight → reward flow, and rewardOnAction
        // routes REWARD → BOSS_RUSH (no auto-advance) when it sees the flag.
        setBossRushReturn(true);
        // startArea sets currentLevel/currentArea, opens the shared AREA_ENTRY
        // screen; zone content + spawn checkpoint install via update.js's
        // BOSS_RUSH→AREA_ENTRY hook (same path as MENU continue / Level Select).
        startArea(h, focused.start.level, focused.start.area);
        console.log(`[screens] BOSS_RUSH → AREA_ENTRY (${focused.name})`);
        return true;
      }
    }
    return false;
  },

  /**
   * Reset focus — but PRESERVE it when returning from REWARD (the post-battle
   * boss-rush return). screenReset(to, from) runs on EVERY transition, so a
   * blanket reset here would clobber the focus the player had before the
   * battle; the user decision requires landing back at the SAME card.
   */
  reset(from) {
    // Preserve the player's focus when returning from a boss battle (REWARD),
    // otherwise land on the first non-locked card (theoretically always one —
    // the highest unlocked/defeated level). If every card is locked, fall back
    // to index 0 so the screen still renders.
    if (from === S.REWARD) return;
    const cards = this._cards();
    const firstPlayable = cards.findIndex(c => c.status !== 'locked');
    this.focus = firstPlayable >= 0 ? firstPlayable : 0;
  },
};

// =============================================================================
// MEDIA SCREEN (menu-hub plan §5.2)
//
// Canvas screen of media cards — one per mediaModel entry (10: intro, eight
// level clips, ending) in a 5 × 2 grid, laid out in the same card/focus style
// as Boss Rush with a right-side detail card for the FOCUSED card (the shared
// hover-style tooltip pattern):
//   - locked   → silhouette disc + lock icon, NO preview image; the detail
//                card shows the model's unlock-requirement tooltip
//   - unlocked → clip art (level background still/pan) or placeholder panel +
//                title; confirm opens the playback overlay
// Playback overlay (in-screen flag, no new state — the Menu credits-overlay
// pattern): large view of the focused clip + a back-to-grid prompt. Back from
// the overlay closes it first; back from the grid returns MENU. Navigation
// skips locked cards (wrap-around) so focus can only rest on playable content.
// =============================================================================

import { buildMediaCards } from './mediaModel.js';

// --- Media layout constants ---------------------------------------------------
const MD_TITLE_Y = 60;                 // "MEDIA" marquee baseline
const MD_TITLE_SIZE = 44;
const MD_CARD_W = 150;                 // card width (Boss Rush parity)
const MD_CARD_H = 168;                 // card height (nav bar keeps a clear strip below)
const MD_GAP_X = 18;                   // horizontal gap between cards
const MD_GAP_Y = 18;                   // vertical gap between rows
const MD_COLS = 5;                     // 5 × 2 grid of 10 cards
const MD_GRID_X = 30;                  // first card's left edge
const MD_GRID_Y = 120;                 // first row's top edge
const MD_CARD_ART_H = 92;              // art box height inside a card
const MD_DETAIL_X = 700;               // right detail-card left edge
const MD_DETAIL_Y = 120;               // right detail-card top edge
const MD_DETAIL_W = 230;
const MD_DETAIL_H = 358;               // 120..478: matches both grid rows' extent
const MD_NAV_Y = 509;                 // keycap nav bar Y (centered in the bottom strip below the cards)
const MD_VIEW_W = 640;                 // playback overlay view width
const MD_VIEW_H = 320;                 // playback overlay view height

/** Clip art cache for level backgrounds (loaded lazily; drawFitted guards .complete). */
const mediaClipImages = {};
function mediaClipImage(assetPath) {
  if (!mediaClipImages[assetPath]) {
    const img = new Image();
    img.src = new URL(assetPath, import.meta.url).href;
    mediaClipImages[assetPath] = img;
  }
  return mediaClipImages[assetPath];
}

export const Media = {
  /** Focus is an index into buildMediaCards() (0..9). */
  focus: 0,
  /** The id of the clip open in the playback overlay (null = grid view). */
  playing: null,

  /** Live model data (rebuilt every draw + onAction so progress changes show). */
  _cards() { return buildMediaCards(loadStore().progress); },

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    drawHubBackground(ctx, '#0d0d1a', '#1a1a2e');

    drawMarqueeTitle(ctx, 'MEDIA', VIEW_W / 2, MD_TITLE_Y, MD_TITLE_SIZE, { color: CREAM });

    const cards = this._cards();
    const focused = cards[this.focus];

    // --- Card grid (5 × 2) ----------------------------------------------------
    cards.forEach((card, i) => {
      const col = i % MD_COLS, row = Math.floor(i / MD_COLS);
      const x = MD_GRID_X + col * (MD_CARD_W + MD_GAP_X);
      const y = MD_GRID_Y + row * (MD_CARD_H + MD_GAP_Y);
      const isFocused = i === this.focus;
      const locked = card.status === 'locked';
      ctx.save();
      // Card body — same presentation language as Boss Rush.
      ctx.fillStyle = isFocused ? COLOR_PILL_FILL : 'rgba(255,255,255,0.04)';
      roundRect(ctx, x, y, MD_CARD_W, MD_CARD_H, 10);
      ctx.fill();
      ctx.strokeStyle = isFocused ? COLOR_PILL_STROKE : (locked ? 'rgba(138,138,154,0.35)' : '#8a7f68');
      ctx.lineWidth = isFocused ? 2 : 1.5;
      roundRect(ctx, x, y, MD_CARD_W, MD_CARD_H, 10);
      ctx.stroke();

      const cx = x + MD_CARD_W / 2;
      const artY = y + 14;
      if (locked) {
        // Silhouette disc + lock icon — NO preview image (plan §5.2).
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#2a2a3a';
        ctx.beginPath();
        ctx.arc(cx, artY + MD_CARD_ART_H / 2, MD_CARD_ART_H / 2 - 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        drawLockIcon(ctx, cx, artY + MD_CARD_ART_H / 2, 26, '#8a8a9a');
        ctx.font = `13px ${FONT_UI}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#8a8a9a';
        ctx.fillText(card.level !== null ? `LEVEL ${card.level}` : card.title.toUpperCase(), cx, y + MD_CARD_H - 22);
      } else {
        // Unlocked: clip art (or placeholder panel when the asset is null /
        // not loaded) + title.
        if (card.asset) {
          const img = mediaClipImage(card.asset);
          if (img?.complete && img.naturalWidth > 0) {
            drawFitted(ctx, img, x + 10, artY, MD_CARD_W - 20, MD_CARD_ART_H);
          } else {
            drawPlaceholder(ctx, x + 10, artY, MD_CARD_W - 20, MD_CARD_ART_H, 'clip');
          }
        } else {
          drawPlaceholder(ctx, x + 10, artY, MD_CARD_W - 20, MD_CARD_ART_H, 'coming soon');
        }
        ctx.font = `bold 15px ${FONT_UI}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isFocused ? COLOR_OPT_FOCUSED : CREAM;
        ctx.fillText(card.title, cx, y + MD_CARD_H - 22);
      }
      ctx.restore();
    });

    // --- Right pane: detail card for the focused clip -------------------------
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(ctx, MD_DETAIL_X, MD_DETAIL_Y, MD_DETAIL_W, MD_DETAIL_H, 12);
    ctx.fill();
    ctx.strokeStyle = focused.status === 'locked' ? 'rgba(138,138,154,0.5)' : COLOR_PILL_STROKE;
    ctx.lineWidth = 2;
    roundRect(ctx, MD_DETAIL_X, MD_DETAIL_Y, MD_DETAIL_W, MD_DETAIL_H, 12);
    ctx.stroke();

    const ccx = MD_DETAIL_X + MD_DETAIL_W / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (focused.status === 'locked') {
      // Locked: no preview image — lock glyph + the model's unlock requirement.
      drawLockIcon(ctx, ccx, MD_DETAIL_Y + 105, 34, '#8a8a9a');
      ctx.font = `17px ${FONT_UI}`;
      ctx.fillStyle = '#ff9f9f';
      ctx.fillText(focused.tooltip ?? '', ccx, MD_DETAIL_Y + 175);
      ctx.font = `13px ${FONT_UI}`;
      ctx.fillStyle = '#8a8a9a';
      ctx.fillText('LOCKED', ccx, MD_DETAIL_Y + 210);
    } else {
      // Unlocked: title headline + clip art + play hint.
      drawMarqueeTitle(ctx, focused.title.toUpperCase(), ccx, MD_DETAIL_Y + 50, 26, { color: CREAM });
      if (focused.asset) {
        const img = mediaClipImage(focused.asset);
        if (img?.complete && img.naturalWidth > 0) {
          drawFitted(ctx, img, MD_DETAIL_X + 25, MD_DETAIL_Y + 80, MD_DETAIL_W - 50, 170);
        } else {
          drawPlaceholder(ctx, MD_DETAIL_X + 25, MD_DETAIL_Y + 80, MD_DETAIL_W - 50, 170, 'clip');
        }
      } else {
        drawPlaceholder(ctx, MD_DETAIL_X + 25, MD_DETAIL_Y + 80, MD_DETAIL_W - 50, 170, 'coming soon');
      }
      ctx.font = `17px ${FONT_UI}`;
      ctx.fillStyle = COLOR_OPT_FOCUSED;
      ctx.fillText('READY TO PLAY', ccx, MD_DETAIL_Y + 290);
      ctx.font = `14px ${FONT_UI}`;
      ctx.fillStyle = '#b9a98a';
      ctx.fillText('Press Confirm to watch', ccx, MD_DETAIL_Y + 322);
    }
    ctx.restore();

    // --- Keycap nav bar -------------------------------------------------------
    drawNavBar(ctx, VIEW_W / 2, MD_NAV_Y, navHintEntries([
      { actions: ['left', 'right'], label: 'Clip', opts: { mode: 'select_layout' } },
      { action: 'confirm', label: 'Watch', opts: { mode: 'select_layout' } },
      { action: 'back', label: 'Menu', opts: { mode: 'select_layout' } },
    ]));

    if (this.playing !== null) this.drawPlayback(ctx);
  },

  /** Playback overlay (plan §5.2): dim layer + large view of the open clip +
   * a back-to-grid prompt. In-screen flag — no new state (credits pattern). */
  drawPlayback(ctx) {
    const card = this._cards().find(c => c.id === this.playing) ?? null;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    fillSurface(ctx);

    const vx = (VIEW_W - MD_VIEW_W) / 2;
    const vy = (VIEW_H - MD_VIEW_H) / 2 - 20;
    ctx.fillStyle = '#0d0d1a';
    roundRect(ctx, vx, vy, MD_VIEW_W, MD_VIEW_H, 12);
    ctx.fill();
    ctx.strokeStyle = COLOR_PILL_STROKE;
    ctx.lineWidth = 2;
    roundRect(ctx, vx, vy, MD_VIEW_W, MD_VIEW_H, 12);
    ctx.stroke();

    if (card) {
      drawMarqueeTitle(ctx, card.title.toUpperCase(), VIEW_W / 2, vy - 24, 28, { color: CREAM });
      if (card.asset) {
        const img = mediaClipImage(card.asset);
        if (img?.complete && img.naturalWidth > 0) {
          drawFitted(ctx, img, vx + 20, vy + 20, MD_VIEW_W - 40, MD_VIEW_H - 40);
        } else {
          drawPlaceholder(ctx, vx + 20, vy + 20, MD_VIEW_W - 40, MD_VIEW_H - 40, 'clip');
        }
      } else {
        // Null asset (intro/ending): placeholder panel until real clips land.
        drawPlaceholder(ctx, vx + 20, vy + 20, MD_VIEW_W - 40, MD_VIEW_H - 40, 'coming soon');
      }
    }

    drawPrompt(ctx, 'PRESS ESC TO CLOSE', VIEW_W / 2, VIEW_H - 40, 20, { blink: true });
    ctx.restore();
  },

  /** Step the focus by dir (±1), skipping locked cards (wrap-around). */
  _move(dir) {
    const cards = this._cards();
    let next = this.focus;
    for (let step = 0; step < cards.length; step++) {
      next = (next + dir + cards.length) % cards.length;
      if (cards[next].status !== 'locked') { this.focus = next; return; }
    }
  },

  /**
   * Handle semantic input. While the playback overlay is open, ANY action
   * closes it and consumes the whole input generation (same G2 rationale as
   * the Menu credits overlay — Escape emits both 'back' and 'pause'). On the
   * grid: left/right AND up/down step the clip focus (skipping locked cards),
   * confirm opens the playback overlay for the focused unlocked clip, back
   * returns MENU.
   * @returns {boolean} whether the action was handled
   */
  onAction(action) {
    if (this.playing !== null) {
      this.playing = null;
      consumedGeneration = true;
      return true; // eat the whole generation — nothing else runs this frame
    }
    switch (action) {
      case 'left':
      case 'up':
        this._move(-1);
        return true;
      case 'right':
      case 'down':
        this._move(1);
        return true;
      case 'back':
        if (tryTransition(S.MENU)) console.log('[screens] MEDIA → MENU (back)');
        return true;
      case 'confirm': {
        const focused = this._cards()[this.focus];
        if (!focused || focused.status === 'locked') return true; // safety net
        this.playing = focused.id;
        return true;
      }
    }
    return false;
  },

  reset() { this.focus = 0; this.playing = null; },
};

// =============================================================================
// OPTIONS SCREEN (menu-hub plan §4.1)
//
// Shared settings screen reachable from BOTH the main menu hub and Pause:
//   MENU  → OPTIONS → back returns MENU
//   PAUSE → OPTIONS → back returns PAUSE
// The origin is tracked exactly like remapParent: screenReset(to, from) runs
// on every transition, so optionsOrigin is captured when entering OPTIONS and
// the back action transitions to it.
//
// Four toggle rows (Music / SFX / Screen Shake / Vibration), rendered with the
// same pause-style focus pill via drawOptionList(). Up/down move focus; left/
// right OR confirm toggles the focused row and persists immediately through
// progressStore.updateSettings() (atomic write — survives reloads).
//
// Setting consumers (wired where a consumer exists; honest no-ops otherwise):
//   - screenShake → the gate lives at the shake-STATE funnel in
//     effects/cameraShake.js: update() skips its random re-roll when off, so
//     getShakeOffset() stays {0,0} for EVERY camera-shake instance — legacy
//     Effects.triggerShake AND declaratively fired instances alike.
//   - vibration   → buzz() in ui/touchControls.js skips navigator.vibrate
//     when off (the single haptics funnel).
//   - music / sfx → NO audio system exists yet (tuning.js §"deferred": audio
//     is explicitly out of scope for the level engine v1). These rows persist
//     their values honestly; there is nothing to consume them until an audio
//     engine lands. Do NOT stub a fake player here.
// =============================================================================

const OPT_ROWS = [
  { key: 'layout',       label: 'Layout',           values: ['FIT', 'FULL SCREEN'] },
  { key: 'virtualPad',   label: 'Virtual Gamepad',  values: ['ON (MOBILE)', 'OFF'] },
  { key: 'music',        label: 'Music' },
  { key: 'sfx',          label: 'SFX' },
  { key: 'screenShake',  label: 'Screen Shake' },
  { key: 'vibration',    label: 'Vibration' },
];

export const Options = {
  focus: 0,

  /** Live toggle rows straight from the persisted store (draw + onAction share this).
   * Boolean rows carry value=true/false; enum rows (layout, virtualPad) carry
   * value=index into r.values. */
  rows() {
    const s = loadStore().settings;
    return OPT_ROWS.map(r => {
      if (r.values) {
        const idx = r.values.indexOf(
          r.key === 'layout'
            ? (s.layout === 'fullscreen' ? 'FULL SCREEN' : 'FIT')
            : (s.virtualPad ? 'ON (MOBILE)' : 'OFF'));
        return { ...r, value: Math.max(0, idx) };
      }
      return { ...r, value: !!s[r.key] };
    });
  },

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    // Full-opaque dark background — like the menu hub, the world is hidden
    // behind this full-screen settings screen.
    drawHubBackground(ctx, '#0d0d1a', '#1a1a2e');

    // Toggle state rides on the row label ("MUSIC  ON" / "LAYOUT  FULL SCREEN")
    // so the shared pause-style list renderer is reused as-is.
    const items = this.rows().map(r => ({
      label: r.values
        ? `${r.label.toUpperCase()}  ${r.values[r.value]}`
        : `${r.label.toUpperCase()}  ${r.value ? 'ON' : 'OFF'}`,
      enabled: true,
    }));
    drawOptionList(ctx, {
      title: 'OPTIONS',
      titleY: VIEW_H / 2 - 130,
      items,
      focus: this.focus,
      startY: VIEW_H / 2 - 60,
      navEntries: navHintEntries([
        { actions: ['up', 'down'], label: 'Navigate', opts: { mode: 'select_layout' } },
        { actions: ['left', 'right'], label: 'Toggle', opts: { mode: 'select_layout' } },
        { action: 'back', label: 'Back', opts: { mode: 'select_layout' } },
      ]),
    });
  },

  /** Advance the focused row and persist immediately (atomic write).
   * Boolean rows flip; enum rows cycle through their values (wrap). Side
   * effects (canvas re-fit, pad visibility) apply right away so the change is
   * visible without a reload. */
  _toggle() {
    const row = OPT_ROWS[this.focus];
    if (!row) return;
    if (row.values) {
      updateSettings((settings) => {
        if (row.key === 'layout') {
          settings.layout = settings.layout === 'fit' ? 'fullscreen' : 'fit';
        } else if (row.key === 'virtualPad') {
          settings.virtualPad = !settings.virtualPad;
        }
      });
      // Apply immediately.
      setLayoutMode(loadStore().settings.layout);
      requestRefit();
      setVirtualPadEnabled(loadStore().settings.virtualPad);
      console.log(`[screens] OPTIONS ${row.key} →`, loadStore().settings[row.key]);
      return;
    }
    updateSettings((settings) => { settings[row.key] = !settings[row.key]; });
  },

  /**
   * Handle semantic input. Up/down move focus (wrap-around); left/right or
   * confirm toggle the focused row; back returns to the origin (MENU or
   * PAUSE, tracked by screenReset like remapParent).
   * @returns {boolean} whether the action was handled
   */
  onAction(action) {
    switch (action) {
      case 'up':
        this.focus = (this.focus + OPT_ROWS.length - 1) % OPT_ROWS.length;
        return true;
      case 'down':
        this.focus = (this.focus + 1) % OPT_ROWS.length;
        return true;
      case 'left':
      case 'right':
      case 'confirm':
        this._toggle();
        return true;
      case 'back':
        if (tryTransition(optionsOrigin)) console.log(`[screens] OPTIONS → ${S[optionsOrigin]} (back)`);
        return true;
    }
    return false;
  },

  reset() { this.focus = 0; },
};

// =============================================================================
// PAUSE SCREEN (design §20, )
// Drawn as a semi-transparent overlay on top of the frozen Play frame — the
// world is still rendered behind it by render.js; this screen only adds the
// dim + title + options. Toggled with Esc/P; Resume with Enter/Esc/P.
// =============================================================================

export const Pause = {
  focus: 0, // index into options() — draw + onAction share it

  /** The five pause options with live routing data (menu-hub plan §4.2), in
   * the same data-driven shape as Menu.options(): `go` transitions to the
   * named state; `action` names a special handler. execute() dispatches on
   * this data — never on label strings or hardcoded indices. */
  options() {
    return [
      { label: 'Resume',      enabled: true, action: 'resume' },
      { label: 'Retry Level', enabled: true, action: 'retry' },
      { label: 'Save & Quit', enabled: true, action: 'saveQuit' },
      { label: 'Controls',    enabled: true, go: S.REMAP },
      { label: 'Options',     enabled: true, go: S.OPTIONS },
    ];
  },

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    fillSurface(ctx);

    // Shared option-list renderer (same layout as before extraction).
    drawOptionList(ctx, {
      title: 'PAUSED',
      titleY: VIEW_H / 2 - 80,
      items: this.options(),
      focus: this.focus,
      startY: VIEW_H / 2 - 20,
      navEntries: navHintEntries([
        { actions: ['up', 'down'], label: 'Navigate', opts: { mode: 'select_layout' } },
        { action: 'confirm', opts: { mode: 'select_layout' } },
        { action: 'back', label: 'Close', opts: { mode: 'select_layout' } },
      ]),
    });
    ctx.restore();
  },

  /**
   * Handle input. Uses action-based navigation.
   * @param {string} action semantic navigation action
   * @param {{ retry?: () => void, quit?: () => void }} [actions]
   * @param {object} [hero] the live hero (Save & Quit persists its run)
   */
  onAction(action, actions = {}, hero) {
    // Back (○/Escape) ALWAYS exits the menu, regardless of focus.
    if (action === 'back' || action === 'pause') {
      if (tryTransition(S.PLAY)) console.log('[screens] PAUSE → PLAY (back)');
      return true;
    }
    switch (action) {
      case 'up':
        this.focus = (this.focus + 4) % 5;
        return true;
      case 'down':
        this.focus = (this.focus + 1) % 5;
        return true;
      case 'confirm':
        this.execute(actions, hero);
        return true;
      case 'retry':
        if (actions.retry) actions.retry(); else tryTransition(S.HOME);
        return true;
      case 'quit':
        if (actions.quit) actions.quit(); else tryTransition(S.HOME);
        return true;
    }
    return false;
  },

  /** Route to the focused destination using the option's own routing data
   * (same F5 pattern as Menu.execute): `go` → transition, `action` → special
   * handler. No-op when disabled. */
  execute(actions, hero) {
    const opt = this.options()[this.focus];
    if (!opt || !opt.enabled) return;
    if (opt.go !== undefined) {
      // Controls → REMAP and Options → OPTIONS both capture their origin in
      // screenReset(to, from) — remapParent/optionsOrigin become PAUSE, so
      // back from either returns here.
      if (tryTransition(opt.go)) console.log(`[screens] PAUSE → ${S[opt.go]} (${opt.label})`);
      return;
    }
    switch (opt.action) {
      case 'resume':
        if (tryTransition(S.PLAY)) console.log('[screens] PAUSE → PLAY (resume)');
        break;
      case 'retry':
        if (actions.retry) actions.retry(); else tryTransition(S.HOME);
        break;
      case 'saveQuit':
        // Plan §4.2: persist the resumable run (saveMeta) via lifecycle.js,
        // then return to the hub. The transition is owned by the caller side
        // of saveCurrentRun (lifecycle docs §4.2).
        // Contract: if saveCurrentRun returns null (persist failed), we stay
        // in PAUSE so the player can retry — nothing is lost because no
        // transition happened.
        if (saveCurrentRun(hero ?? getMenuHero())) {
          if (tryTransition(S.MENU)) console.log('[screens] PAUSE → MENU (save & quit)');
        }
        break;
    }
  },

  reset() { this.focus = 0; },
};

// =============================================================================
// GAME OVER SCREEN (design §20, )
// Same ergonomics as the pause menu: dim overlay, centered title, a ▸-style
// option list with a keycap nav bar below. Two options only — Continue and
// Quit. Continue shows how many remain; no coin cost.
// =============================================================================

/** Shared continue-availability check (draw + onAction must agree).
 * The pool is a growable global balance owned by lifecycle.js; with no
 * continues remaining, Continue cannot be activated (game-rules.md §1). */
export function canContinue(hero) {
  const pool = hero?.continues;
  if (pool) return pool.remaining > 0;
  // Fallback for a hero built before lifecycle wiring (e.g. bare tests).
  return !!(hero && hero.continuesUsed < hero.maxContinues);
}

export const GameOver = {
  focus: 0, // 0=Continue, 1=Quit
  /** @param {CanvasRenderingContext2D} ctx @param {object} hero the hero entity */
  draw(ctx, hero) {
    // Full-opaque dark background (game over hides the world, unlike pause).
    ctx.save();
    fillFullSurface(ctx, '#0d0d1a');

    const s = hero.traceStats?.total ?? {};
    const kills = Object.values(s.enemiesKilled ?? {}).reduce((a, b) => a + b, 0);
    const coins = s.coinsCollected?.total ?? 0;
    const distance = Math.round(hero.traceStats?.distanceTraveled ?? 0);
    const score = calculateScore(s, hero);

    drawMenace(ctx, 'GAME OVER', VIEW_W / 2, VIEW_H / 2 - 130, 56);

    // Score + key stats.
    ctx.textAlign = 'center';
    drawPrompt(ctx, `SCORE  ${score}`, VIEW_W / 2, VIEW_H / 2 - 75, 24, { color: CREAM, font: FONT_TITLE });
    ctx.font = `16px ${FONT_UI}`;
    ctx.fillStyle = '#d8cdb4';
    ctx.fillText(`Enemies Killed: ${kills}   ·   Coins: ${coins}   ·   Distance: ${distance} px`, VIEW_W / 2, VIEW_H / 2 - 45);

    // Options — same shared list layout as the pause menu.
    const pool = hero.continues;
    const remaining = pool ? pool.remaining
      : (hero.maxContinues ?? 3) - (hero.continuesUsed ?? 0);
    const okCont = canContinue(hero);
    const options = [
      { label: `Continue (${remaining} left)`, enabled: okCont },
      { label: 'Quit to Home', enabled: true },
    ];
    drawOptionList(ctx, {
      items: options,
      focus: this.focus,
      startY: VIEW_H / 2 - 5,
      navEntries: navHintEntries([
        { actions: ['up', 'down'], label: 'Navigate', opts: { mode: 'select_layout' } },
        { action: 'confirm', opts: { mode: 'select_layout' } },
        { action: 'back', label: 'Quit', opts: { mode: 'select_layout' } },
      ]),
    });
    ctx.restore();
  },

  /**
   * Handle semantic input. `cont`/`quit` are injected by update.js so the
   * respawn logic stays in systems/update.js.
   * @param {string} action semantic navigation action
   * @param {object} hero the hero entity
   * @param {{ cont?: () => void, quit?: () => void }} [actions]
   */
  onAction(action, hero, actions = {}) {
    // Back (○/Escape) ALWAYS quits to home.
    if (action === 'back') {
      if (actions.quit) actions.quit(); else tryTransition(S.HOME);
      return true;
    }
    switch (action) {
      case 'up':
        this.focus = (this.focus + 1) % 2;
        return true;
      case 'down':
        this.focus = (this.focus + 1) % 2;
        return true;
      case 'confirm':
        this.execute(hero, actions);
        return true;
      case 'cont':
        if (canContinue(hero) && actions.cont) actions.cont();
        return true;
      case 'quit':
        if (actions.quit) actions.quit(); else tryTransition(S.HOME);
        return true;
    }
    return false;
  },

  execute(hero, actions) {
    switch (this.focus) {
      case 0: // Continue
        if (canContinue(hero) && actions.cont) actions.cont();
        break;
      case 1: // Quit
        if (actions.quit) actions.quit(); else tryTransition(S.HOME);
        break;
    }
  },
};

// =============================================================================
// WIN SCREEN (design §20, )
// Celebratory full-screen panel: "VICTORY!", prominent score, and the full
// §4.1 stats summary. dumpStats() already fired on the transition into WIN
// (console + JSON download); this screen shows the same data inline.
// =============================================================================

export const Win = {
  /** @param {CanvasRenderingContext2D} ctx @param {object} hero the hero entity */
  draw(ctx, hero) {
    // Celebratory background.
    ctx.save();
    drawHubBackground(ctx, '#1a0a2e', '#2e1a4e');

    const s = hero.traceStats?.total ?? {};
    const t = hero.traceStats ?? {};
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
      `Time: ${(t.timePlayed ?? 0).toFixed(1)}s`,
      `Enemies: ${kills}`,
      `Boss: ${Object.values(s.bossKilled ?? {}).some(n => n > 0) ? 'DEFEATED ✓' : '—'}`,
      `Coins: ${s.coinsCollected?.total ?? 0}`,
      `Barrels: ${barrels}`,
      `Distance: ${Math.round(t.distanceTraveled ?? 0)}px`,
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
   * Handle semantic input. `playAgain`/`quit` are injected by update.js.
   * @param {string} action semantic navigation action
   * @param {{ playAgain?: () => void, quit?: () => void }} [actions]
   */
  onAction(action, actions = {}) {
    // Back (○/Escape) ALWAYS exits to home.
    if (action === 'back') {
      if (actions.quit) actions.quit(); else tryTransition(S.HOME);
      return true;
    }
    if (action === 'confirm') {
      if (actions.playAgain) actions.playAgain();
      else if (tryTransition(S.SELECT)) console.log('[screens] WIN → SELECT (play again)');
      return true;
    }
    if (action === 'quit') {
      if (actions.quit) actions.quit();
      else if (tryTransition(S.HOME)) console.log('[screens] WIN → HOME (quit)');
      return true;
    }
    return false;
  },
};

// =============================================================================
// AREA-ENTRY SCREEN (checkpoints.md §3 — one shared screen)
//
// The SAME full-screen presentation is used for: starting the first area of a
// new game, advancing to another area or level, restarting an area after an
// ordinary death, restarting the current level's -1 after Continue, and
// entering/restarting the boss zone.
//
// It displays exactly three pieces of information (game-rules.md §3):
//   1. Level name
//   2. Area identifier
//   3. Number of lives remaining
// **No score appears here** — score is reserved for Game Over and the level
// reward screen (game-rules.md §4).
//
// Ergonomics follow the shared contract (game-rules.md §3): full-screen, the
// same list layout / focus pill / keycap nav bar as the pause menu. The data
// and the confirm-to-play flow are owned by lifecycle.js (showAreaEntry /
// areaEntryOnAction); this screen only presents that data.
// =============================================================================

/** The screen data as last presented (set by showAreaEntry in lifecycle.js). */
let areaEntryData = null;

/** Set the data the AreaEntry screen presents (called by lifecycle.js). */
export function setAreaEntryData(data) { areaEntryData = data; }

/** The currently presented data (for tests / render). */
export function getAreaEntryData() { return getAreaEntryDataFromLifecycle(); }

export const AreaEntry = {
  /** Present new data (level name, area id, lives). NO score field. */
  set(data) { areaEntryData = data; },

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    const d = areaEntryData ?? { levelName: '', areaId: '', lives: 0 };
    // Full-opaque dark background — like Game Over, the world is hidden
    // behind this screen (it is a full-screen presentation, not a panel).
    ctx.save();
    fillFullSurface(ctx, '#0d0d1a');

    // The entry view is a NON-interactive presentation: no menu, no options,
    // no navigation bar. It fades in fast, holds for TUNING.areaEntryHold,
    // then fades out just as fast and starts play on its own (lifecycle.md §2).
    // The three information blocks are vertically centered as one group.
    const cy = VIEW_H / 2;
    drawMarqueeTitle(ctx, d.levelName.toUpperCase(), VIEW_W / 2, cy - 70, 52, { color: CREAM });
    // Area identifier — the screen's headline.
    drawMarqueeTitle(ctx, d.areaId, VIEW_W / 2, cy + 6, 44, { color: GOLD });
    // Lives remaining — emphasized (checkpoints.md §3 allows the life-count
    // decrease to be emphasized within this same screen).
    drawPrompt(ctx, `LIVES  ${d.lives}`, VIEW_W / 2, cy + 78, 26, { color: CREAM, font: FONT_TITLE });

    ctx.restore();
  },
};

// =============================================================================
// LEVEL REWARD SCREEN (boss-arena.md §4–5, game-rules.md §3)
//
// The boss zone's second screen, shown after the boss's defeat presentation:
// a full-screen level reward summary (boss beaten, level passed). It shows the
// documented minimal set (game-rules.md §3):
//   1. Enemies killed
//   2. Score
//   3. Coins collected
//   4. Continues earned (one per full 1000-coin chunk) and their credit to
//      the global continue pool
//
// The data, the pool crediting (exactly once), and the confirm flow (next
// level's area -1 / end-of-game) are owned by lifecycle.js
// (showLevelReward / rewardOnAction); this screen only presents that data.
// It follows the shared screen ergonomics contract (game-rules.md §3): the
// same list layout / focus pill / keycap nav bar as the pause menu.
// =============================================================================

/** The screen data as last presented (set by showLevelReward in lifecycle.js). */
let rewardData = null;

/** Register the reward data callback with lifecycle.js (no circular import). */
setRewardDataCallback((data) => { rewardData = data; });

/** The currently presented reward data (for tests / render). */
export function getRewardData() { return rewardData; }

export const Reward = {
  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    const d = rewardData ?? { kills: 0, score: 0, coins: 0, continuesEarned: 0, continuesRemaining: 0, isFinalLevel: false };
    // Full-opaque dark background — like the area-entry and Game Over
    // screens, the world is hidden behind this full-screen presentation.
    ctx.save();
    fillFullSurface(ctx, '#0d0d1a');

    drawMarqueeTitle(ctx, 'BOSS BEATEN', VIEW_W / 2, VIEW_H / 2 - 210, 52, { color: CREAM });
    drawMarqueeTitle(ctx, 'LEVEL PASSED', VIEW_W / 2, VIEW_H / 2 - 160, 34, { color: GOLD });

    // The documented minimal set (game-rules.md §3): kills, score, coins,
    // continues earned.
    ctx.textAlign = 'center';
    drawPrompt(ctx, `ENEMIES KILLED  ${d.kills}`, VIEW_W / 2, VIEW_H / 2 - 95, 26, { color: CREAM, font: FONT_TITLE });
    drawPrompt(ctx, `SCORE  ${d.score}`, VIEW_W / 2, VIEW_H / 2 - 55, 26, { color: CREAM, font: FONT_TITLE });
    drawPrompt(ctx, `COINS  ${d.coins}`, VIEW_W / 2, VIEW_H / 2 - 15, 26, { color: CREAM, font: FONT_TITLE });
    // The continue credit is presented visibly (boss-arena.md §4: "visibly
    // credit the global continue counter"): the delta earned AND the resulting
    // global continue-pool balance, so the credit to the global counter is
    // visible, not just the "+N" earned this level.
    drawPrompt(ctx, d.continuesEarned > 0
      ? `CONTINUES EARNED  +${d.continuesEarned}`
      : 'CONTINUES EARNED  0', VIEW_W / 2, VIEW_H / 2 + 25, 26, {
        color: d.continuesEarned > 0 ? GOLD : '#b9a98a', font: FONT_TITLE,
      });
    drawPrompt(ctx, `CONTINUES  ${d.continuesRemaining}`, VIEW_W / 2, VIEW_H / 2 + 65, 26, {
      color: d.continuesEarned > 0 ? GOLD : CREAM, font: FONT_TITLE,
    });

    // No menu on this screen: the regular navigation bar only, with the
    // confirm keycap relabeled to what it does. Back triggers the same move.
    const hintY = VIEW_H / 2 + 130;
    drawNavBar(ctx, VIEW_W / 2, hintY, navHintEntries([
      { action: 'confirm', label: d.isFinalLevel ? 'Continue' : 'Next Level', opts: { mode: 'select_layout' } },
    ]));
    ctx.restore();
  },
};

// =============================================================================
// END-OF-GAME SCREEN (lifecycle.md §5, boss-arena.md §5)
//
// The minimal full-screen end-of-game presentation, shown after the final
// level's boss reward screen (lifecycle.md §5: "show a minimal end-of-game
// screen — a congratulations presentation with the final score and a single
// option to return home"). It follows the shared screen ergonomics contract
// (game-rules.md §3): full-screen, the same list layout / focus pill / keycap
// nav bar as the pause menu.
//
// The state transition and the confirm-to-home flow are owned by lifecycle.js
// (rewardOnAction → S.END_OF_GAME); this screen only presents the final score
// and the single return-home option. The full ending (story scenes, credits)
// belongs to the future story epic.
// =============================================================================

/** The final score presented (set by the transition into END_OF_GAME). */
let endOfGameScore = 0;

/** Register the end-of-game data callback with lifecycle.js (no circular import). */
// lifecycle.js owns the confirm flow; it pushes the final score here so the
// screen can present it without a circular import.
setEndOfGameScoreCallback((score) => { endOfGameScore = score; });

/** The currently presented final score (for tests / render). */
export function getEndOfGameScore() { return endOfGameScore; }

export const EndOfGame = {
  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    // Full-opaque dark background — like the reward and Game Over screens,
    // the world is hidden behind this full-screen presentation.
    ctx.save();
    fillFullSurface(ctx, '#0d0d1a');

    // Congratulations — the screen's headline (lifecycle.md §5).
    drawMarqueeTitle(ctx, 'CONGRATULATIONS', VIEW_W / 2, VIEW_H / 2 - 140, 56, { color: CREAM });
    drawMarqueeTitle(ctx, 'YOU HAVE PASSED EVERY LEVEL', VIEW_W / 2, VIEW_H / 2 - 85, 28, { color: GOLD });

    // Final score — the screen's headline number (lifecycle.md §5).
    ctx.textAlign = 'center';
    drawPrompt(ctx, `FINAL SCORE  ${endOfGameScore}`, VIEW_W / 2, VIEW_H / 2 - 15, 34, {
      color: GOLD, font: FONT_TITLE,
    });

    // No menu on this screen: the regular navigation bar only, with the
    // confirm keycap relabeled. Back triggers the same move.
    const hintY = VIEW_H / 2 + 55;
    drawNavBar(ctx, VIEW_W / 2, hintY, navHintEntries([
      { action: 'confirm', label: 'Return to Home', opts: { mode: 'select_layout' } },
    ]));
    ctx.restore();
  },

  /**
   * Handle input. Confirm (or back) returns home — the single documented
   * option (lifecycle.md §5).
   * @param {string} action semantic navigation action
   * @returns {boolean} whether the action was handled
   */
  onAction(action) {
    switch (action) {
      case 'up':
      case 'down':
        // No menu: navigation is a no-op.
        return true;
      case 'confirm':
      case 'back':
        if (tryTransition(S.HOME)) console.log('[screens] END_OF_GAME → HOME');
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
 * was drawn. HOME/SELECT/AREA_ENTRY are full-screen; PAUSE/OVER/WIN are
 * overlays that render.js draws after the (frozen) game world so the world
 * stays visible behind them.
 */
export function drawScreen(ctx, hero) {
  const s = getState();
  if (s === S.HOME) {
    Home.draw(ctx);
    return true;
  }
  if (s === S.MENU) {
    Menu.draw(ctx);
    return true;
  }
  if (s === S.LEVEL_SELECT) {
    LevelSelect.draw(ctx);
    return true;
  }
  if (s === S.OPTIONS) {
    Options.draw(ctx);
    return true;
  }
  if (s === S.BOSS_RUSH) {
    BossRush.draw(ctx);
    return true;
  }
  if (s === S.MEDIA) {
    Media.draw(ctx);
    return true;
  }
  if (s === S.SELECT) {
    Select.draw(ctx);
    return true;
  }
  if (s === S.REMAP) {
    Remap.draw(ctx);
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
  if (s === S.AREA_ENTRY) {
    AreaEntry.draw(ctx);
    return true;
  }
  if (s === S.REWARD) {
    Reward.draw(ctx);
    return true;
  }
  if (s === S.END_OF_GAME) {
    EndOfGame.draw(ctx);
    return true;
  }
  return false;
}

/**
 * Action-based input for screens. SINGLE entry point for all input sources.
 * Screens receive abstract actions, not raw key codes or button indices.
 *
 * @param {string} action 'confirm' | 'back' | 'left' | 'right' | 'up'
 * @param {object} [hero] current hero (for OVER/WIN screens)
 * @param {object} [actions] action bag (retry, cont, playAgain, quit)
 */
let remapParent = S.PAUSE;
// OPTIONS returns to wherever it was opened from: MENU (the hub's Options
// entry) or PAUSE (task 4.2 adds the pause entry). Same pattern as
// remapParent — captured in screenReset(to, from), which runs on EVERY
// transition, so the origin is always fresh when back is pressed.
let optionsOrigin = S.MENU;
// G2: one-shot flag set when a screen action CONSUMES the input generation
// (the credits overlay dismissal). dispatchScreenInput reads it after each
// action and stops processing the rest of that physical press's batch —
// Escape emits BOTH 'back' and 'pause' in one poll, and screenOnAction
// rewrites leftover 'pause' edges to 'confirm', which would immediately
// reopen the overlay. Cleared at the top of every dispatch tick so a stale
// flag can never swallow actions from the NEXT generation.
let consumedGeneration = false;
/** Test hook: clear the one-shot generation-consumed flag (unit tests drive
 * screenOnAction directly and never run dispatchScreenInput, which normally
 * clears it each tick). */
export function _resetConsumedGenerationForTest() { consumedGeneration = false; }
export function screenOnAction(action, hero, actions = {}) {
  const s = getState();
  if (s === S.PLAY) {
    if (action === 'pause') { tryTransition(S.PAUSE); return true; }
    return false;
  }
  if (action === 'pause' && s !== S.PAUSE) action = 'confirm';
  // G2: the credits overlay dismissal consumes the whole input generation —
  // no further actions from this physical press may run. Set by Menu.onAction
  // when it closes the overlay; cleared at the top of each dispatch tick.
  if (consumedGeneration) return true;
  if (s === S.HOME) { Home.onAction(action); return true; }
  if (s === S.MENU) return Menu.onAction(action);
  if (s === S.LEVEL_SELECT) return LevelSelect.onAction(action);
  if (s === S.OPTIONS) return Options.onAction(action);
  if (s === S.BOSS_RUSH) return BossRush.onAction(action);
  if (s === S.MEDIA) return Media.onAction(action);
  if (s === S.SELECT) { Select.onAction(action); return true; }
  if (s === S.REMAP) {
    if (Remap.onAction(action) === 'exit') tryTransition(remapParent);
    return true;
  }
  // PAUSE receives the live hero so Save & Quit can persist its run (plan §4.2).
  if (s === S.PAUSE) return Pause.onAction(action, actions, hero);
  if (s === S.OVER) return GameOver.onAction(action, hero, actions);
  if (s === S.WIN) return Win.onAction(action, actions);
  if (s === S.AREA_ENTRY) return areaEntryOnAction(action, hero);
  if (s === S.REWARD) return rewardOnAction(action, hero);
  if (s === S.END_OF_GAME) return EndOfGame.onAction(action);
  return false;
}

// Once per input tick. A state/capture boundary invalidates the entire batch.
export function dispatchScreenInput(engine, hero, actions) {
  const generation = engine.generation;
  // Record this tick's physical binding state so the shared instruction bar
  // can flash its momentary chips (confirm/back/...) even across an immediate
  // transition, and keep directional chips lit while held.
  markNavPressed(engine.heldBindings, engine.pressedBindings);
  if (engine.captureResult) { Remap.onCapture(engine.captureResult); engine.captureResult = null; }
  consumedGeneration = false; // G2: fresh tick — no stale generation-consumed flag
  for (const action of engine.nav.pressed) {
    const handled = screenOnAction(action, hero, actions);
    // G2: a screen that consumed the input generation (e.g. the credits
    // overlay dismissal) stops the batch here — remaining actions from the
    // SAME physical press (Escape emits both 'back' and 'pause') must not run.
    if (!handled || consumedGeneration || engine.generation !== generation) break;
  }
  consumedGeneration = false; // G2: batch done — clear so stale flag never leaks into next tick
}

export function screenReset(s, from) {
  if (s === S.SELECT) Select.reset();
  if (s === S.MENU) Menu.reset();
  if (s === S.LEVEL_SELECT) LevelSelect.reset();
  // OPTIONS: capture the origin so back returns to MENU or PAUSE depending on
  // where it was opened from (same pattern as remapParent below).
  if (s === S.OPTIONS) { optionsOrigin = [S.MENU, S.PAUSE].includes(from) ? from : S.MENU; Options.reset(); }
  // BOSS_RUSH: reset() preserves focus when returning from REWARD (the
  // post-battle boss-rush return, plan §3.3 user decision); fresh entries
  // (from MENU) reset to card 0.
  if (s === S.BOSS_RUSH) BossRush.reset(from);
  if (s === S.MEDIA) Media.reset();
  if (s === S.PAUSE) Pause.reset();
  if (s === S.OVER) GameOver.focus = 0;
  // REMAP returns to wherever it was opened from: HOME, PAUSE, or MENU.
  if (s === S.REMAP) { remapParent = [S.HOME, S.PAUSE, S.MENU].includes(from) ? from : S.PAUSE; Remap.resetState(); }
  // AREA_ENTRY: the screen data is pushed by lifecycle.js (showAreaEntry)
  // IMMEDIATELY before the transition into AREA_ENTRY; the transition listener
  // must NOT clear it here or the screen would render blank values.
}

/** Update screen-specific per-frame logic (parallax, etc.). */
export function screenUpdate(dt) {
  const s = getState();
  if (s === S.HOME) Home.update(dt);
  if (s === S.REMAP) Remap.update(dt);
}

onTransition((from, to) => { input.cancelCapture(); clearNavFlash(); screenReset(to, from); });

// Register the area-entry data callback with lifecycle.js so that
// showAreaEntry() can push the screen data here without a circular import.
setAreaEntryDataCallback((data) => { areaEntryData = data; });
