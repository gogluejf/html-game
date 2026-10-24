// Petal Panic — ground strike (effects.md §4 family, catalog #4b). The VISUAL
// twin of the surfaceStrike attack primitive: a SHARP red band that slams in
// from above and fades out. Presentation only — the damage lives in the
// primitive's hitbox, never here.
//
// STATE/DRAW effect: owns its own timer over `duration`. Two visual beats:
//   1. SLAM-IN (first ~20% of duration): the band drops from `slamFrom` px
//      above the ground line and lands with a slight overshoot squash — reads
//      as "the ground just got hit".
//   2. HOLD + FADE: the band stays put at HALF OPACITY for the middle of the
//      window, then fades to nothing over the last ~30%. Same half-opacity
//      convention as dustZone / fireArea hazard zones: visible but not
//      obnoxious while hot.
//
// The band is drawn as a plain RECTANGULAR strip along the ground line: width
// `width`, resting thickness `thickness`, solid red (#e74c3c — the shared
// BLOOD/FIRE red) so it reads as a deadly strip of floor. No rounding, no
// gradient, no barrel look. Deterministic: position/opacity are pure
// functions of elapsed time.
//
// Origin: if the carrier exposes origin(), its position wins over params.x/y
// (same convention as groundWave); params.x/y are the standalone/theater
// fallback fired with a null carrier.
//
// params: { x?, y?, width?, thickness?, duration?, slamFrom?, color?, style? }
//   x, y        — center point ON the ground line (band spans ±width/2 around x,
//                 sits ABOVE the line: top = y - thickness)
//   width       — horizontal extent of the hot band (px, default 240)
//   thickness   — resting vertical thickness of the band (px, default 10)
//   duration    — whole-instance lifetime (s, default 0.35)
//   slamFrom    — how far above the line the band starts before slamming in (px,
//                 default 26)
//   color       — override tint (default '#e74c3c')
//   style       — cosmetic variant tag (default 'strip'); reserved for future
//                 variants ('crack', 'fire'...). All styles render the same strip.

const DEFAULT_WIDTH = 240;
const DEFAULT_THICKNESS = 10;
const DEFAULT_DURATION = 0.35;
const DEFAULT_SLAM_FROM = 26;
const STRIKE_COLOR = '#e74c3c'; // shared blood/fire red (palettes.js)
const HOT_ALPHA = 0.5;          // half opacity while hot (dustZone/fireArea convention)
const EPS = 1e-9;

/** easeOutBack — slight overshoot past 1, settles at 1. t in [0,1]. */
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * @param {{x?:number, y?:number, width?:number, thickness?:number,
 *          duration?:number, slamFrom?:number, style?:string}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number}}
 */
export function groundStrike(params = {}, carrier = null) {
  const width = params.width > 0 ? params.width : DEFAULT_WIDTH;
  const thickness = params.thickness > 0 ? params.thickness : DEFAULT_THICKNESS;
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const slamFrom = params.slamFrom >= 0 ? params.slamFrom : DEFAULT_SLAM_FROM;
  const color = params.color ?? STRIKE_COLOR;
  const style = params.style ?? 'strip';
  const fb = { x: params.x ?? 0, y: params.y ?? 0 };
  const origin = resolveOrigin(carrier, fb);

  const api = {
    space: 'world',
    done: false,
    elapsed: 0,
    origin,

    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    /**
     * Draw the sharp rectangular band at its current slam/fade state. No-op
     * once done or when geometry degenerates (width/thickness ≤ 0).
     */
    render(c2d, _renderCtx = {}) {
      if (this.done || width <= EPS || thickness <= EPS) return;
      const k = Math.min(1, this.elapsed / duration);

      // Beat 1: slam-in over the first 20% (easeOutBack → small overshoot).
      const slamK = Math.min(1, k / 0.2);
      const dropY = (1 - easeOutBack(slamK)) * slamFrom; // >0 while falling, ~0 landed
      // Beat 2: half opacity while hot (dustZone/fireArea convention), then
      // fade to nothing over the last 30%.
      const fadeStart = 0.7;
      const alpha = (k < fadeStart ? HOT_ALPHA : HOT_ALPHA * (1 - (k - fadeStart) / (1 - fadeStart)));
      if (alpha <= EPS) return;

      const x = origin.x - width / 2;
      const y = origin.y - thickness + dropY; // band bottom rests on the line

      c2d.save();
      c2d.globalAlpha = alpha;
      // Plain rectangular strip — no rounding, no edge highlight.
      c2d.fillStyle = color;
      c2d.fillRect(x, y, width, thickness);
      c2d.restore();
      void style;
    },

    complete() { this.done = true; },
  };

  return api;
}

/** Carrier origin() wins; params.x/y are the null-carrier fallback. */
function resolveOrigin(carrier, fallback) {
  if (carrier && typeof carrier.origin === 'function') {
    const o = carrier.origin();
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x, y: o.y };
  }
  return { x: fallback.x, y: fallback.y };
}
