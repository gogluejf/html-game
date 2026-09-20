// Petal Panic — damage-vignette effect (migrated from the pre-refactor
// monolith, js/effects.js `Effects.heroDamaged` + vignette half of
// `drawOverlay`; reference: .squid-os/plans/effect-engine/effect-reference.txt).
// Red edge glow when the hero takes damage (design §12, CoD-style radial
// gradient): kicks to full on fire, decays linearly over 0.5s, renders as a
// screen-space overlay after the camera transform is restored.
//
// Screen-space state lives on the instance (not module scope) so multiple
// instances each keep their own timer; the compat shim (task 2.2) routes the
// old singleton semantics through one instance.
//
// params: { strength?, viewW, viewH } — strength defaults to 1 (clamped 0..1);
// viewW/viewH are read at DRAW time from the render ctx ({ view: { w, h } })
// that drawEffects hands every instance, falling back to factory-time
// params.viewW/viewH (or fire-time ctx.view) when the draw-time view is absent.

const VIGNETTE_DECAY = 1 / 0.5; // full fade over 0.5s (CoD-style, subtle)

/**
 * @param {{strength?:number, viewW?:number, viewH?:number}} params
 * @param {object} carrier
 * @param {{view?:{w:number,h:number}}} [ctx]
 * @returns {{value:number, update:Function, render:Function, done:boolean}}
 */
export function vignette(params = {}, carrier, ctx = {}) {
  const view = ctx.view ?? {};
  // Clamp to [0,1] (monolith parity): a negative strength must not stay
  // negative — it collapses to 0 so render() is a no-op and update() marks
  // done immediately.
  const value = Math.min(1, Math.max(0, params.strength ?? 1));
  return {
    value,
    update(dt) {
      this.value = Math.max(0, this.value - VIGNETTE_DECAY * dt);
      // <= (not <): floating-point decay lands at ~2e-16 after 30 frames, so a
      // strict comparison would never mark the effect done.
      if (this.value <= 1e-9) this.done = true;
    },
    render(c2d, renderCtx = {}) {
      const v = this.value;
      if (this.done || v <= 1e-9) return;
      // Prefer the DRAW-TIME viewport (renderCtx.view, passed by drawEffects)
      // so declaratively-fired overlays without fire-time view context still
      // render; fall back to factory-time params.viewW/viewH, then fire-time
      // ctx.view, for callers that only supply dims at construction.
      const dv = renderCtx.view ?? {};
      const viewW = dv.w ?? params.viewW ?? view.w;
      const viewH = dv.h ?? params.viewH ?? view.h;
      if (!viewW || !viewH) return;
      const cx = viewW / 2, cy = viewH / 2;
      // Gradient reaches full red only at the corners; the center stays clear.
      const r = Math.hypot(cx, cy);
      const grad = c2d.createRadialGradient(cx, cy, r * 0.45, cx, cy, r);
      grad.addColorStop(0, 'rgba(180, 20, 20, 0)');
      grad.addColorStop(0.7, `rgba(180, 20, 20, ${0.15 * v})`);
      grad.addColorStop(1, `rgba(150, 10, 10, ${0.55 * v})`);
      c2d.save();
      c2d.fillStyle = grad;
      c2d.fillRect(0, 0, viewW, viewH);
      c2d.restore();
    },
    done: false,
  };
}
