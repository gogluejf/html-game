// Petal Panic — invulnerability flicker effect (design §27).
// Source-driven invulnerability looks, moved out of the render pass into the
// effect engine so any carrier (hero today; enemies/projectiles later) can
// get the same treatment.
//
// Two visual modes, selected by `mode` (mirrors the hero's invulnSource):
//   'powerup' — SMB1-style multi-phase color flicker at a FIXED rate:
//               white → orange → white → black tints, then NORMAL sprite,
//               then fully INVISIBLE. A 5s powerup and a short grant look
//               identical. The terminal phase is forced to a visible one so
//               the sprite is VISIBLE at expiry (no vanishing exactly when
//               protection ends).
//   'hit'     — classic transparent blink: N full on/off alpha cycles across
//               the whole window. Fades but never fully invisible.
//
// TIMING MODEL — externally driven. Unlike most effects this instance does
// NOT own its clock. The caller steps it every frame with
//   setProgress(fraction)
// where fraction = remaining/total of the carrier's immunity timer (1 → 0).
// update(dt) is therefore a no-op. This keeps the blink locked to the actual
// immunity window: extending the timer extends the blink, and the last
// visible state lands on the exact frame immunity ends — no wall-clock drift.
//
// RENDER OWNERSHIP — this effect REPLACES the carrier's normal draw for the
// duration (it is not an overlay like spriteFlash/spriteColorPulse). The
// carrier must suppress its own sprite draw while the effect is active:
//   if (!carrier.invulnFx?.active) <normal draw>
// The effect draws either the real sprite (alpha-modulated or full) or a
// flat-color silhouette via the shared tintedImage pipeline.
//
// params: { mode?, hz?, phases?, cycles?, alphaOn?, alphaOff?, flashAlpha?,
//           colors? }
//   mode       — 'powerup' | 'hit' (default 'hit')
//   hz         — powerup: flicker cycles per second (default 12)
//   phases     — powerup: [{ name:'white'|'orange'|'black'|'normal'|'gone', dur }]
//                durations in ms; default is the canonical 6-phase table
//   cycles     — hit: full on/off cycles across the whole window (default 6)
//   alphaOn    — hit: "on" visibility (default 0.8)
//   alphaOff   — hit: "off" visibility (default 0.4)
//   flashAlpha — powerup: uniform alpha for tint beats (default 0.8)
//
// carrier: entity exposing spriteFrame() (silhouette + normal draw) and/or
// worldBox() (box fallback for the silhouette). Null carrier → box fallback
// only; without a box the effect draws nothing.

import { tintedImage } from './spriteFlash.js';

const DEFAULT_PHASES = [
  { name: 'white',  dur: 24 },
  { name: 'orange', dur: 24 },
  { name: 'white',  dur: 24 },
  { name: 'black',  dur: 24 },
  { name: 'normal', dur: 12 },
  { name: 'gone',   dur: 48 },
];
const PHASE_COLORS = {
  white:  '#ffffff',
  orange: '#ff9f43',
  black:  '#000000',
};

/**
 * @param {{mode?:string, hz?:number, phases?:Array, cycles?:number,
 *          alphaOn?:number, alphaOff?:number, flashAlpha?:number}} params
 * @param {object|null} [carrier]
 * @returns {{space:string, active:boolean, done:boolean,
 *            setProgress:Function, update:Function, render:Function,
 *            complete:Function}}
 */
export function invulnFlicker(params = {}, carrier = null) {
  const mode = params.mode === 'powerup' ? 'powerup' : 'hit';
  const hz = Math.max(0.1, params.hz ?? 12);
  const phases = Array.isArray(params.phases) && params.phases.length > 0
    ? params.phases : DEFAULT_PHASES;
  const cycles = Math.max(1, Math.round(params.cycles ?? 6));
  const alphaOn = clamp01(params.alphaOn ?? 0.8);
  const alphaOff = clamp01(params.alphaOff ?? 0.4);
  const flashAlpha = clamp01(params.flashAlpha ?? 0.8);

  // Remaining-fraction of the immunity window (1 → 0), set by the caller.
  let frac = 1;

  return {
    space: 'world', // rides the world-space camera pass (two-pass model)
    active: true,   // caller reads this to suppress the carrier's own draw
    done: false,

    /** External clock: fraction = remaining/total of the immunity timer. */
    setProgress(f) {
      frac = Math.min(1, Math.max(0, f));
    },

    /** No-op — timing is owned by the carrier's immunity timer. */
    update(_dt) {},

    render(ctx) {
      if (this.done || !carrier) return;
      if (mode === 'powerup') renderPowerup(ctx, carrier, frac);
      else renderHit(ctx, carrier, frac);
    },

    complete() { this.done = true; this.active = false; },
  };

  // --- powerup: fixed-rate multi-phase cycle --------------------------------
  function renderPowerup(ctx, c, f) {
    const totalPhases = Math.max(1, Math.round(hz * phases.length * (1 - f)));
    const idx = Math.min(totalPhases - 1,
      Math.floor((1 - f) * hz * phases.length));
    let phase = phases[idx % phases.length].name;
    // Expiry guard: on the final frame(s) of the window (less than one render
    // frame from expiry), never show the invisible phase — the sprite must be
    // VISIBLE when protection ends. Mid-window gone beats render normally.
    if (f < 1 / 60 && idx === totalPhases - 1 && phase === 'gone') phase = 'normal';
    if (phase === 'gone') {
      ctx.save();
      ctx.globalAlpha = 0;
      drawNormal(ctx, c);
      ctx.restore();
    } else if (phase === 'normal' || !(phase in PHASE_COLORS)) {
      // Soft white lift on the "normal" beat: the REAL sprite first, then a
      // translucent white pass over its silhouette (source-atop keeps the
      // shape) — a faint glow, not a flat-color replacement.
      drawNormal(ctx, c);
      drawOverlayTint(ctx, c, '#ffffff', 0.5);
    } else {
      drawTinted(ctx, c, PHASE_COLORS[phase], flashAlpha);
    }
  }

  // --- hit: N on/off alpha cycles across the whole window -------------------
  function renderHit(ctx, c, f) {
    const on = Math.floor(f * cycles) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = on ? alphaOn : alphaOff;
    drawNormal(ctx, c);
    ctx.restore();
  }
}

function clamp01(v) { return Math.min(1, Math.max(0, v)); }

/** Draw the carrier's real sprite through its transform pipeline. */
function drawNormal(ctx, c) {
  const f = typeof c.spriteFrame === 'function' ? c.spriteFrame() : null;
  if (f && f.img) {
    ctx.save();
    ctx.translate(f.anchorX, f.anchorY);
    if (f.mirrorX) ctx.scale(-1, 1);
    if (f.mirrorY) ctx.scale(1, -1);
    if (f.rotation) ctx.rotate(f.rotation);
    ctx.scale(f.scale, f.scale);
    ctx.drawImage(f.img, 0, 0, f.img.naturalWidth || f.img.width,
      f.img.naturalHeight || f.img.height, f.dx, f.dy, f.w, f.h);
    ctx.restore();
    return;
  }
  // No sheet frame: nothing to draw (the carrier's primitive path handles
  // non-high-graphic mode; the effect is high-graphic-only by contract).
}

/** Flat-color silhouette at the given alpha (shared tint pipeline). */
function drawTinted(ctx, c, color, alpha) {
  const f = typeof c.spriteFrame === 'function' ? c.spriteFrame() : null;
  if (f && f.img) {
    const tinted = tintedImage(f.img, color);
    if (tinted) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(f.anchorX, f.anchorY);
      if (f.mirrorX) ctx.scale(-1, 1);
      if (f.mirrorY) ctx.scale(1, -1);
      if (f.rotation) ctx.rotate(f.rotation);
      ctx.scale(f.scale, f.scale);
      ctx.drawImage(tinted, 0, 0, tinted.width, tinted.height, f.dx, f.dy, f.w, f.h);
      ctx.restore();
      return;
    }
  }
  // BOX fallback: tinted rect over the live collision box.
  const b = typeof c.worldBox === 'function' ? c.worldBox() : null;
  if (!b) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.restore();
}

/**
 * Translucent overlay tint: draws a flat color OVER whatever is already on
 * the canvas within the carrier's silhouette (source-atop), so the sprite's
 * own colors show through at (1 - alpha). Used for the "normal" beat's soft
 * white lift — unlike drawTinted it does NOT replace the sprite's pixels.
 */
function drawOverlayTint(ctx, c, color, alpha) {
  const f = typeof c.spriteFrame === 'function' ? c.spriteFrame() : null;
  if (f && f.img) {
    const tinted = tintedImage(f.img, color);
    if (tinted) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.translate(f.anchorX, f.anchorY);
      if (f.mirrorX) ctx.scale(-1, 1);
      if (f.mirrorY) ctx.scale(1, -1);
      if (f.rotation) ctx.rotate(f.rotation);
      ctx.scale(f.scale, f.scale);
      ctx.drawImage(tinted, 0, 0, tinted.width, tinted.height, f.dx, f.dy, f.w, f.h);
      ctx.restore();
      return;
    }
  }
  // BOX fallback: translucent rect over the live collision box.
  const b = typeof c.worldBox === 'function' ? c.worldBox() : null;
  if (!b) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.restore();
}
