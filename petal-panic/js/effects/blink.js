// Petal Panic — Blink (design §27).
//
// A DUMB constant-rate on/off blink of the carrier's REAL sprite. It knows
// nothing about hits, powerups, or timers: given a `duration` and a number of
// `cycles`, it plays N full on/off pairs spread EVENLY across that duration
// (no acceleration), fading between alphaOn and alphaOff. No colors, no wash
// — just visibility.
//
//   blink({ duration = 0.6, cycles = 6, alphaOn = 0.8, alphaOff = 0.4 }, carrier)
//
// SIBLING EFFECT — blinkTransition is a DIFFERENT job: same self-timed clock
// but an ACCELERATING switch rate (ease-in) and color/image frames instead of
// the real sprite. This one is constant-rate and blinks the sprite itself.
//
// TIMING MODEL — self-timed. update(dt) advances an internal elapsed clock;
// the effect completes when `duration` elapses. The caller picks the duration
// from the gameplay window it wants covered (i-frame length, grace period);
// if that window extends (re-hit), the caller respawns the effect with the
// new duration.
//
// RENDER OWNERSHIP — this effect REPLACES the carrier's normal draw for the
// duration (it is not an overlay like spriteFlash/spriteColorPulse). The
// carrier must suppress its own sprite draw while the effect is active:
//   if (!carrier.invulnFx?.active) <normal draw>

/**
 * @param {{duration?:number, cycles?:number, alphaOn?:number, alphaOff?:number}} params
 *   duration — total lifetime in seconds (default 0.6).
 *   cycles   — full on/off pairs across the duration (default 6).
 *   alphaOn  — "on" visibility (default 0.8).
 *   alphaOff — "off" visibility (default 0.4).
 * @param {object|null} [carrier] entity exposing spriteFrame() and/or worldBox()
 * @returns {{space:string, active:boolean, done:boolean,
 *            update:Function, render:Function, complete:Function}}
 */
export function blink(params = {}, carrier = null) {
  const duration = Math.max(1e-3, Number.isFinite(params.duration) && params.duration > 0 ? params.duration : 0.6);
  const cycles = Math.max(1, Math.round(params.cycles ?? 6));
  const alphaOn = clamp01(params.alphaOn ?? 0.8);
  const alphaOff = clamp01(params.alphaOff ?? 0.4);

  let elapsed = 0;

  return {
    space: 'world', // rides the world-space camera pass (two-pass model)
    active: true,   // caller reads this to suppress the carrier's own draw
    done: false,

    /** Self-timed: advance the internal clock. */
    update(dt) {
      if (this.done || !Number.isFinite(dt) || dt <= 0) return;
      elapsed = Math.min(duration, elapsed + dt);
      if (elapsed >= duration - 1e-9) this.done = true;
    },

    render(ctx) {
      if (this.done || !carrier) return;
      const frac = 1 - elapsed / duration; // remaining fraction (1 → 0)
      // Constant rate: 2×cycles even beats across the duration, beat i spans
      // frac ∈ ((N-1-i)/N, (N-i)/N] with N = 2×cycles. Even beats are ON.
      // Terminal visibility: at frac→0 the raw index lands on N (an OFF beat
      // for even N), so force the final frame ON — the sprite is VISIBLE
      // exactly when the blink ends.
      const n = cycles * 2;
      const raw = (1 - frac) * n; // beats elapsed since t=0 (0 → n)
      const idx = Math.min(n - 1, Math.floor(raw + 1e-9));
      // Even beat indices are ON (beat 0 at t=0 is ON). Terminal visibility:
      // the last beat (idx n-1) is forced ON so the sprite is VISIBLE exactly
      // when the blink ends.
      const on = idx === n - 1 || idx % 2 === 0;
      ctx.save();
      ctx.globalAlpha = on ? alphaOn : alphaOff;
      drawNormal(ctx, carrier);
      ctx.restore();
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
