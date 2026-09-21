// Petal Panic — fade-out effect (effects.md §17, catalog #17). Gradually
// reduces a sprite or visual object's opacity until it disappears, after death
// animations, destroyed objects, temporary entities, summoned objects, or
// disappearing effects.
//
// SPRITE-STATE effect (M6): unlike the draw-effects above it in the catalog,
// this instance does NOT paint new geometry of its own. It ramps an ALPHA
// MULTIPLIER over time that the renderer consumes when drawing the carrier's
// sprite — the same consumption pattern as spriteFlash's tint (the engine
// never mutates the carrier; the effect exposes state and the render pass
// applies it). The multiplier is exposed two ways so either integration works:
//   - `alpha()` — pure query: current alpha multiplier for the carrier's
//     sprite at the live clock. The entity render loop calls it and folds it
//     into globalAlpha before drawing the sprite (e.g.
//     ctx.globalAlpha *= inst.alpha()).
//   - `render(ctx)` — standalone fallback for the debug theater / null-carrier
//     demos, where there is no real sprite to modulate: it draws a white
//     reference box at the resolved sprite position with alpha = startOpacity
//     · alphaMultiplier(t), so the demo visibly fades from the declared start
//     opacity down to the declared end opacity using ONLY params + carrier
//     geometry.
// Both paths read the SAME ramp, so the multiplier the renderer consumes and
// the demo's drawn alpha are identical values.
//
// Renderer consumption status: as of this task (6.1) the production renderer
// (systems/render.js) does NOT yet read active fade-out instances' alpha() at
// the drawable entity sites — wiring that per-entity consumption across all
// carrier draw sites is deferred (follow-up / M7 handoff), the same way the
// sprite-shake consumption was added separately at wave 3. Until then the
// standalone/theater path (render() reference box) demonstrates the ramp and
// the alpha() contract is fully implemented and tested; a declaratively
// attached fade-out will drive in-game sprite opacity once render.js folds
// inst.alpha() into the carrier's globalAlpha.
//
// Ramp model: the multiplier starts at 1.0 (fully opaque) and eases toward
// `endOpacity / startOpacity` over the fade window. At t = delay the
// multiplier is exactly 1.0 (nothing has faded yet); at t = delay + duration
// it is exactly end/start; the whole-instance lifetime is EXACTLY
// delay + duration — done-detection uses the 1e-9 epsilon convention so a
// fixed-dt accumulator landing ~1e-16 past the boundary still completes.
// The effective sprite alpha at elapsed t is therefore
//   startOpacity · lerp(1, end/start, curve(clamp((t − delay)/duration)))
// which equals startOpacity at t ≤ delay, endOpacity at t ≥ delay+duration,
// and follows the declared curve between.
//
// Curve vocabulary (`curve` param): 'linear' (default), 'easeIn', 'easeOut'.
// All three are pure functions of normalized progress p ∈ [0,1]:
//   linear : p          easeIn : p²         easeOut : 1 − (1 − p)²
// Unknown/absent values fall back to 'linear' (deterministic; no randomness
// anywhere — rendering is a pure function of elapsed time and params).
//
// Config precondition: like attackArc/groundWave/shockwave, a VISIBLE fade
// requires delay + duration >= ~2·dt (at least ~2 frames at dt = 1/60). The
// engine prunes the instance during update() before drawEffects() runs once
// done, so any total lifetime <= dt completes on the FIRST update and is
// pruned before rendering — a sub-frame fade is degenerate/nonsensical.
//
// params: { startOpacity?, endOpacity?, duration?, delay?, curve? }
//   startOpacity — opacity the sprite has at fire time (default 1.0). Clamped
//                  to [0,1]. This is the BASE alpha the ramp scales FROM:
//                  effective alpha = startOpacity · multiplier(t). A value of
//                  0 collapses the whole ramp to 0 (invisible throughout —
//                  degenerate but valid config).
//   endOpacity   — opacity the sprite reaches at the end of the fade
//                  (default 0.0 = fully transparent). Clamped to [0,1]. May
//                  exceed startOpacity (a "fade IN" is just a fade whose end
//                  is brighter than its start — the same ramp, reversed).
//   duration     — length of the FADE WINDOW in seconds (default 0.5). Must
//                  be > 0; non-positive values fall back to the default. The
//                  WHOLE-instance lifetime is delay + duration exactly.
//   delay        — hold time in seconds BEFORE the fade begins (default 0).
//                  During the delay the multiplier stays pinned at 1.0 (full
//                  start opacity). Negative values clamp to 0.
//   curve        — easing name: 'linear' | 'easeIn' | 'easeOut' (default
//                  'linear'). See Curve vocabulary above.
//
// Carrier geometry (standalone/demo path only): the reference box drawn by
// render() resolves the sprite box at DRAW time via carrier.worldBox()
// ({ x, y, w, h }) when available, falling back to carrier.origin()/size(),
// then to factory-time params.box { x, y, w, h } for carriers without
// geometry accessors (tests, theater demos). A null carrier falls back to
// params.box only; absent or non-positive w/h → render() is a no-op. The
// alpha() query needs NO geometry — it is purely a function of the clock.

const DEFAULT_START_OPACITY = 1.0; // base alpha the ramp scales from
const DEFAULT_END_OPACITY = 0.0;   // target alpha (0 = fully transparent)
const DEFAULT_DURATION = 0.5;      // s — fade-window length (lifetime = delay + duration)
const DEFAULT_DELAY = 0;           // s — hold before the fade begins
const DEFAULT_CURVE = 'linear';    // easing name (see Curve vocabulary)
const DEMO_COLOR = '#ffffff';      // standalone demo reference-box fill
const EPS = 1e-9;                  // fixed-dt epsilon convention

/**
 * @param {{startOpacity?:number, endOpacity?:number, duration?:number,
 *          delay?:number, curve?:string}} params
 * @param {object} [carrier] entity with worldBox()/origin()+size(), or null
 * @returns {{alpha:Function, update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number}}
 */
export function fadeOut(params = {}, carrier = null) {
  const startOpacity = Math.min(1, Math.max(0, params.startOpacity ?? DEFAULT_START_OPACITY));
  const endOpacity = Math.min(1, Math.max(0, params.endOpacity ?? DEFAULT_END_OPACITY));
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const delay = Math.max(0, params.delay ?? DEFAULT_DELAY);
  const curveName = typeof params.curve === 'string' && params.curve
    ? params.curve : DEFAULT_CURVE;
  const lifetime = delay + duration; // whole-instance lifetime == declared total
  // End-of-ramp multiplier relative to the start opacity. Guarded against a
  // zero start (degenerate all-invisible config) so the math stays finite.
  const endRatio = startOpacity > EPS ? endOpacity / startOpacity : 0;

  return {
    space: 'world', // rides the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,

    /**
     * Current alpha MULTIPLIER for the carrier's sprite at the live clock:
     * 1.0 during the delay, easing toward endOpacity/startOpacity over the
     * fade window. Pure function of elapsed time — deterministic. The
     * renderer multiplies the sprite's base alpha by this value.
     * @returns {number}
     */
    alpha() {
      if (this.elapsed <= delay + EPS) return 1;
      const p = Math.min(1, Math.max(0, (this.elapsed - delay) / duration));
      return 1 + (endRatio - 1) * curveFn(curveName)(p);
    },

    /**
     * Advance the clock. Completes exactly at `elapsed >= lifetime - EPS`
     * (total lifetime == delay + duration, the documented contract).
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      if (this.elapsed >= lifetime - EPS) this.done = true;
    },

    /**
     * Standalone/theater fallback draw: a reference box at the resolved
     * sprite position with alpha = startOpacity · multiplier(t). No-op once
     * done, when nothing is visible (effective alpha <= EPS), or when no
     * geometry resolves. Mirrors the exact alpha the renderer would consume
     * via alpha(), so the demo shows the real fade.
     * @param {object} c2d CanvasRenderingContext2D
     */
    render(c2d) {
      if (this.done) return;
      const alpha = startOpacity * this.alpha();
      if (alpha <= EPS) return;
      const box = resolveBox(carrier, params.box);
      if (!box) return;
      c2d.save();
      c2d.globalAlpha = alpha;
      c2d.fillStyle = DEMO_COLOR;
      c2d.fillRect(box.x, box.y, box.w, box.h);
      c2d.restore();
    },

    complete() { this.done = true; },
  };
}

/** Easing lookup: returns the named curve as f(p) -> eased progress. */
function curveFn(name) {
  switch (name) {
    case 'easeIn':  return (p) => p * p;
    case 'easeOut': return (p) => 1 - (1 - p) * (1 - p);
    default:        return (p) => p; // 'linear' (and unknown names)
  }
}

/**
 * Resolve the sprite box for the standalone demo draw at draw time.
 * Preference order: carrier.worldBox() → carrier.origin()+size() →
 * factory-time params.box. Read at draw time so the demo tracks a moving
 * carrier. @returns {{x,y,w,h}|null}
 */
function resolveBox(carrier, fallbackBox) {
  if (carrier && typeof carrier.worldBox === 'function') {
    const b = carrier.worldBox();
    if (b && b.w > 0 && b.h > 0) return b;
  }
  if (carrier && typeof carrier.origin === 'function' && typeof carrier.size === 'function') {
    const o = carrier.origin();
    const s = carrier.size();
    if (o && s && s.w > 0 && s.h > 0) {
      return { x: o.x - s.w / 2, y: o.y - s.h / 2, w: s.w, h: s.h };
    }
  }
  if (fallbackBox && fallbackBox.w > 0 && fallbackBox.h > 0) return fallbackBox;
  return null;
}
