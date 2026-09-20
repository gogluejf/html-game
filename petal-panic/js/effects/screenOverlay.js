// Petal Panic — screen-overlay effect (effects.md §23, catalog #23).
// A long-lived full-viewport tinted layer: fades in over `fadeIn`, holds at
// full opacity for the middle of its life, then fades out over `fadeOut`.
// Unlike the brief Screen Flash (§14), it can remain active for a longer
// period and change gradually — danger states, boss phases, environmental
// mood, poison-like states, dramatic transitions.
//
// Screen-space state lives on the instance (not module scope) so multiple
// instances each keep their own timer; render() is a no-op once done.
//
// params: { color?, opacity?, duration?, fadeIn?, fadeOut?, blendMode? }
//   color     — CSS color of the tint (default '#ffffff')
//   opacity   — peak opacity 0..1 (default 0.5)
//   duration  — TOTAL lifetime in seconds; the effect is done exactly when
//               `duration` elapses (hold = max(0, duration - fadeIn - fadeOut))
//   fadeIn    — ramp from 0 to peak (default 0.2s)
//   fadeOut   — ramp from peak to 0 (default 0.2s)
//   blendMode — canvas globalCompositeOperation (default 'source-over')
//
// Ramp clamping: `duration` is the total lifetime and must never be exceeded.
// When fadeIn + fadeOut > duration, both ramps are scaled proportionally so
// they fit within `duration` (hold = 0); the curve still reaches its peak at
// the end of the (scaled) fade-in window.
//
// viewW/viewH are NOT documented params (see effects.md §23). Viewport dims
// are delivered at DRAW time via renderCtx ({ view: { w, h } }) per the
// Lifecycle contract. A factory-time params.viewW/viewH fallback exists only
// for direct-body callers (tests / non-engine use) and is undocumented.

/**
 * @param {{color?:string, opacity?:number, duration?:number, fadeIn?:number,
 *         fadeOut?:number, blendMode?:string, viewW?:number, viewH?:number}} params
 * @param {object} carrier
 * @param {{view?:{w:number,h:number}}} [ctx]
 * @returns {{value:number, update:Function, render:Function, complete:Function, done:boolean}}
 */
export function screenOverlay(params = {}, carrier, ctx = {}) {
  const view = ctx.view ?? {};
  // Clamp peak opacity to [0,1]: a negative value collapses to 0 so render()
  // is a no-op and update() marks done immediately (same policy as screenFlash).
  const peak = Math.min(1, Math.max(0, params.opacity ?? 0.5));
  let fadeIn = Math.max(0, params.fadeIn ?? 0.2);
  let fadeOut = Math.max(0, params.fadeOut ?? 0.2);
  const duration = Math.max(0, params.duration ?? 1);
  // `duration` is the TOTAL lifetime and must never be exceeded. When the two
  // ramps together exceed it, scale both proportionally so they fit exactly
  // (hold = 0). The curve still reaches its peak at the end of the scaled
  // fade-in window.
  const rampSum = fadeIn + fadeOut;
  if (rampSum > duration && rampSum > 0) {
    const scale = duration / rampSum;
    fadeIn *= scale;
    fadeOut *= scale;
  }
  const hold = Math.max(0, duration - fadeIn - fadeOut);
  const total = duration; // lifetime always equals the declared duration

  return {
    peak,
    elapsed: 0,
    value: 0,
    update(dt) {
      this.elapsed += dt;
      if (this.elapsed >= total) {
        this.value = 0;
        // <= (not <): floating-point accumulation lands at ~1e-16 past the
        // exact boundary, so a strict comparison would never mark done.
        this.done = true;
        return;
      }
      if (this.elapsed < fadeIn) {
        this.value = peak * (fadeIn > 0 ? this.elapsed / fadeIn : 1);
      } else if (this.elapsed < fadeIn + hold) {
        this.value = peak;
      } else {
        const t = (this.elapsed - fadeIn - hold) / fadeOut;
        this.value = peak * (fadeOut > 0 ? 1 - t : 0);
      }
    },
    render(c2d, renderCtx = {}) {
      const v = this.value;
      if (this.done || v <= 1e-9) return;
      // Prefer the DRAW-TIME viewport (renderCtx.view, passed by drawEffects) —
      // this is the DOCUMENTED path per effects.md §Lifecycle. The factory-time
      // params.viewW/viewH and fire-time ctx.view are an UNDOCUMENTED fallback
      // for direct-body callers only (tests / non-engine use); they are not in
      // §23's param list.
      const dv = renderCtx.view ?? {};
      const viewW = dv.w ?? params.viewW ?? view.w;
      const viewH = dv.h ?? params.viewH ?? view.h;
      if (!viewW || !viewH) return;
      c2d.save();
      c2d.globalAlpha = v;
      c2d.globalCompositeOperation = params.blendMode ?? 'source-over';
      c2d.fillStyle = params.color ?? '#ffffff';
      c2d.fillRect(0, 0, viewW, viewH);
      c2d.restore();
    },
    complete() {
      this.done = true;
    },
    done: false,
  };
}
