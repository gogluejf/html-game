// Petal Panic — Invincibility blink (design §27).
//
// A DUMB color-cycler. It knows nothing about hits, powerups, or timers:
// it takes an array of colors and plays them as a fixed-rate cycle, drawing
// each color OVER the carrier's real sprite at a fixed alpha — so the anim
// stays visible underneath the whole time the color iterates over it.
//
//   invulnFlicker({ colors: ['#fff', '#ff9f43', 'invisible'], ... }, carrier)
//
// Every entry is one beat of `beatMs` (default 16):
//   - a color string → sprite + that color at `alpha` (default 0.8)
//   - 'invisible'    → sprite drawn at alpha 0 (a vanish beat)
//
// TIMING MODEL — externally driven. This instance does NOT own its clock.
// The caller steps it every frame with setProgress(fraction), where
// fraction = remaining/total of the carrier's immunity timer (1 → 0).
// update(dt) is therefore a no-op. This keeps the blink locked to the
// actual immunity window: extending the timer extends the blink, and the
// last visible state lands on the exact frame immunity ends — no wall-clock
// drift.
//
// RENDER OWNERSHIP — this effect REPLACES the carrier's normal draw for the
// duration (it is not an overlay like spriteFlash/spriteColorPulse). The
// carrier must suppress its own sprite draw while the effect is active:
//   if (!carrier.invulnFx?.active) <normal draw>

import { tintedImage } from './spriteFlash.js';

/** The special beat entry that renders the carrier fully invisible. */
export const INVISIBLE = 'invisible';

/**
 * @param {{colors?:Array<string>, beatMs?:number, alpha?:number}} params
 *   colors — the cycle table (required; the caller owns the look).
 *   beatMs — duration of ONE beat in ms (default 16). The whole cycle is
 *            colors.length × beatMs.
 *   alpha  — flash alpha for color beats (default 0.8).
 * @param {object|null} [carrier] entity exposing spriteFrame() and/or worldBox()
 * @returns {{space:string, active:boolean, done:boolean,
 *            setProgress:Function, update:Function, render:Function,
 *            complete:Function}}
 */
export function invulnFlicker(params = {}, carrier = null) {
  const colors = Array.isArray(params.colors) && params.colors.length > 0
    ? params.colors : ['#ffffff'];
  const beatMs = Math.max(1, params.beatMs ?? 16);
  const alpha = clamp01(params.alpha ?? 0.8);
  const hz = 1000 / beatMs; // beats per second

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
      const totalBeats = Math.max(1, Math.round(hz * colors.length * (1 - frac)));
      const idx = Math.min(totalBeats - 1,
        Math.floor((1 - frac) * hz * colors.length));
      let color = colors[idx % colors.length];
      // Expiry guard: on the final frame(s) of the window, never end fully
      // invisible — the sprite must be VISIBLE when protection ends.
      if (frac < 1 / 60 && idx === totalBeats - 1 && color === INVISIBLE) {
        color = null; // plain visible sprite
      }
      if (color === INVISIBLE) {
        ctx.save();
        ctx.globalAlpha = 0;
        drawNormal(ctx, carrier);
        ctx.restore();
      } else if (color) {
        // Flash the color OVER the real sprite: the anim stays visible
        // underneath, the color washes over it at `alpha`.
        drawNormal(ctx, carrier);
        drawOverlayTint(ctx, carrier, color, alpha);
      } else {
        drawNormal(ctx, carrier);
      }
    },

    complete() { this.done = true; this.active = false; },
  };
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

/**
 * Translucent color OVER whatever is already on the canvas within the
 * carrier's silhouette (source-atop), so the sprite's own pixels show
 * through at (1 - alpha).
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
