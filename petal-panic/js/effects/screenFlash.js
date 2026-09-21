// Petal Panic — screen-flash effect (migrated from the pre-refactor monolith,
// js/effects.js `Effects.bigExplosion` + screenFlash half of `drawOverlay`;
// reference: .squid-os/plans/effect-engine/effect-reference.txt). Brief white
// full-screen flash on big explosions (barrel/bomb): kicks to full on fire,
// decays linearly over 0.15s, renders as a screen-space overlay after the
// camera transform is restored.
//
// Screen-space state lives on the instance (not module scope) so multiple
// instances each keep their own timer; the compat shim (task 2.2) routes the
// old singleton semantics through one instance.
//
// params: { strength?, viewW, viewH } — strength defaults to 1 (clamped 0..1);
// viewW/viewH are read at DRAW time from the render ctx ({ view: { w, h } })
// that drawEffects hands every instance, falling back to factory-time
// params.viewW/viewH (or fire-time ctx.view) when the draw-time view is absent.

const FLASH_DECAY = 1 / 0.15; // full fade over 0.15s (brief white pop)

/**
 * @param {{strength?:number, viewW?:number, viewH?:number}} params
 * @param {object} carrier
 * @param {{view?:{w:number,h:number}}} [ctx]
 * @returns {{value:number, update:Function, render:Function, done:boolean}}
 */
export function screenFlash(params = {}, carrier, ctx = {}) {
  const view = ctx.view ?? {};
  // Clamp to [0,1] (monolith parity): a negative strength must not stay
  // negative — it collapses to 0 so render() is a no-op and update() marks
  // done immediately.
  const value = Math.min(1, Math.max(0, params.strength ?? 1));
  return {
    space: 'screen', // viewport-space overlay (two-pass render model, effects.md §Lifecycle)
    value,
    update(dt) {
      this.value = Math.max(0, this.value - FLASH_DECAY * dt);
      // <= (not <): floating-point decay lands at ~1e-16 after 9 frames, so a
      // strict comparison would never mark the effect done.
      if (this.value <= 1e-9) this.done = true;
    },
    render(c2d, renderCtx = {}) {
      const f = this.value;
      if (this.done || f <= 1e-9) return;
      // Prefer the DRAW-TIME viewport (renderCtx.view, passed by drawEffects)
      // so declaratively-fired overlays without fire-time view context still
      // render; fall back to factory-time params.viewW/viewH, then fire-time
      // ctx.view, for callers that only supply dims at construction.
      const dv = renderCtx.view ?? {};
      const viewW = dv.w ?? params.viewW ?? view.w;
      const viewH = dv.h ?? params.viewH ?? view.h;
      if (!viewW || !viewH) return;
      c2d.save();
      c2d.globalAlpha = f;
      c2d.fillStyle = '#ffffff';
      c2d.fillRect(0, 0, viewW, viewH);
      c2d.restore();
    },
    done: false,
  };
}
