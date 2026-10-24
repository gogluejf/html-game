// Petal Panic — ground strike (effects.md §4 family, catalog #4b). The VISUAL
// twin of the surfaceStrike attack primitive: a stationary band of churned-up
// ground that slams in from above and fades out. Presentation only — the
// damage lives in the primitive's hitbox, never here.
//
// STATE/DRAW effect: owns its own timer over `duration`. Two visual beats:
//   1. SLAM-IN (first ~20% of duration): the band drops from `slamFrom` px
//      above the ground line and lands with a slight overshoot squash — reads
//      as "the ground just got hit".
//   2. HOLD + FADE: the band stays put at full opacity for the middle of the
//      window, then fades to nothing over the last ~30%.
//
// The band is drawn as a filled rounded slab along the ground line: width
// `width`, resting thickness `thickness`, tinted warm dust/gold (same family
// as ground-wave) with a bright top edge so it reads as a hot strip of floor.
// Deterministic: position/opacity are pure functions of elapsed time.
//
// Origin: if the carrier exposes origin(), its position wins over params.x/y
// (same convention as groundWave); params.x/y are the standalone/theater
// fallback fired with a null carrier.
//
// params: { x?, y?, width?, thickness?, duration?, slamFrom?, style? }
//   x, y        — center point ON the ground line (band spans ±width/2 around x,
//                 sits ABOVE the line: top = y - thickness)
//   width       — horizontal extent of the hot band (px, default 240)
//   thickness   — resting vertical thickness of the band (px, default 14)
//   duration    — whole-instance lifetime (s, default 0.35)
//   slamFrom    — how far above the line the band starts before slamming in (px,
//                 default 26)
//   style       — cosmetic variant tag (default 'slab'); reserved for future
//                 variants ('crack', 'fire'...). All styles render the same slab.

const DEFAULT_WIDTH = 240;
const DEFAULT_THICKNESS = 14;
const DEFAULT_DURATION = 0.35;
const DEFAULT_SLAM_FROM = 26;
const STRIKE_COLOR = '#ff9d5c';   // hot amber — reads as a fresh impact strip
const EDGE_COLOR = '#ffe08a';     // bright top edge
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
  const style = params.style ?? 'slab';
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
     * Draw the band at its current slam/fade state. No-op once done or when
     * geometry degenerates (width/thickness ≤ 0).
     */
    render(c2d, _renderCtx = {}) {
      if (this.done || width <= EPS || thickness <= EPS) return;
      const k = Math.min(1, this.elapsed / duration);

      // Beat 1: slam-in over the first 20% (easeOutBack → small overshoot).
      const slamK = Math.min(1, k / 0.2);
      const dropY = (1 - easeOutBack(slamK)) * slamFrom; // >0 while falling, ~0 landed
      // Beat 2: fade over the last 30%.
      const fadeStart = 0.7;
      const alpha = k < fadeStart ? 1 : 1 - (k - fadeStart) / (1 - fadeStart);
      if (alpha <= EPS) return;

      const x = origin.x - width / 2;
      const y = origin.y - thickness + dropY; // band bottom rests on the line

      c2d.save();
      c2d.globalAlpha = alpha;
      // Slab body.
      c2d.fillStyle = STRIKE_COLOR;
      roundRect(c2d, x, y, width, thickness, Math.min(6, thickness / 2));
      c2d.fill();
      // Hot top edge — the "just struck" highlight line.
      c2d.strokeStyle = EDGE_COLOR;
      c2d.lineWidth = 2;
      c2d.beginPath();
      c2d.moveTo(x + 3, y + 1.5);
      c2d.lineTo(x + width - 3, y + 1.5);
      c2d.stroke();
      c2d.restore();
      void style;
    },

    complete() { this.done = true; },
  };

  return api;
}

/** Rounded-rect path helper (no fill/stroke). */
function roundRect(c2d, x, y, w, h, r) {
  c2d.beginPath();
  c2d.moveTo(x + r, y);
  c2d.lineTo(x + w - r, y);
  c2d.arcTo(x + w, y, x + w, y + r, r);
  c2d.lineTo(x + w, y + h - r);
  c2d.arcTo(x + w, y + h, x + w - r, y + h, r);
  c2d.lineTo(x + r, y + h);
  c2d.arcTo(x, y + h, x, y + h - r, r);
  c2d.lineTo(x, y + r);
  c2d.arcTo(x, y, x + r, y, r);
  c2d.closePath();
}

/** Carrier origin() wins; params.x/y are the null-carrier fallback. */
function resolveOrigin(carrier, fallback) {
  if (carrier && typeof carrier.origin === 'function') {
    const o = carrier.origin();
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x, y: o.y };
  }
  return { x: fallback.x, y: fallback.y };
}
