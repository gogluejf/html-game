// Petal Panic — Blink (design §27).
//
// A DUMB constant-rate on/off blink of the carrier's REAL sprite. It knows
// nothing about hits, powerups, or timers: N full on/off cycles are spread
// EVENLY across the whole window (no acceleration), fading between alphaOn
// and alphaOff. No colors, no wash — just visibility.
//
//   blink({ cycles = 6, alphaOn = 0.8, alphaOff = 0.4 }, carrier)
//
// SIBLING EFFECT — blinkTransition is a DIFFERENT job: self-timed (owns its
// own elapsed timer), accelerating switch rate, color/image frames, settles
// and holds. This one is externally clocked at a constant rate so it stays
// locked to the carrier's immunity window: extending the window extends the
// blink, and the sprite is VISIBLE exactly when the window ends.
//
// TIMING MODEL — externally driven. This instance does NOT own its clock.
// The caller steps it every frame with setProgress(fraction), where
// fraction = remaining/total of the carrier's immunity timer (1 → 0).
// update(dt) is therefore a no-op.
//
// RENDER OWNERSHIP — this effect REPLACES the carrier's normal draw for the
// duration (it is not an overlay like spriteFlash/spriteColorPulse). The
// carrier must suppress its own sprite draw while the effect is active:
//   if (!carrier.invulnFx?.active) <normal draw>

/**
 * @param {{cycles?:number, alphaOn?:number, alphaOff?:number}} params
 *   cycles   — full on/off cycles across the whole window (default 6).
 *   alphaOn  — "on" visibility (default 0.8).
 *   alphaOff — "off" visibility (default 0.4).
 * @param {object|null} [carrier] entity exposing spriteFrame() and/or worldBox()
 * @returns {{space:string, active:boolean, done:boolean,
 *            setProgress:Function, update:Function, render:Function,
 *            complete:Function}}
 */
export function blink(params = {}, carrier = null) {
  const cycles = Math.max(1, Math.round(params.cycles ?? 6));
  const alphaOn = clamp01(params.alphaOn ?? 0.8);
  const alphaOff = clamp01(params.alphaOff ?? 0.4);

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
      // Constant rate: N even beats across the window. Even beats are ON.
      const idx = Math.floor((1 - frac) * cycles + 1e-9);
      // Terminal visibility: at frac→0 the index lands on `cycles` — for
      // EVEN cycles that is an OFF beat and the sprite would vanish exactly
      // when protection ends. Widen the final ON beat to cover the whole
      // last segment (frac < 1/cycles): the sprite stays visible for the
      // tail of the window instead of flickering off on the last frames.
      const on = (cycles % 2 === 0 && frac < 1 / cycles) || idx % 2 === 0;
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
