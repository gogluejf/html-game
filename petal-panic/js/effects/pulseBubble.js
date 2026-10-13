// Petal Panic — pulse bubble effect (effects.md §27, catalog #27). A circular
// energy ring that breathes between a minimum and maximum radius in a smooth
// cosine cycle. Rendered as a FILLED DISC with a radial gradient from `colorIn`
// at the center to `colorOut` at the edge (soft alpha falloff), plus a thin
// bright rim for definition. An optional flash overlay adds a brightness spike
// at pulse peaks. Generic reusable pulse visual — used by shields, barriers,
// auras, and any entity that needs a breathing ring around itself.
//
// STATE/DRAW effect: this instance stays active over its whole lifetime and
// owns its own timer. Each update() advances the clock; each render() draws
// one filled circle centered on the resolved origin whose radius oscillates
// sinusoidally between `minRadius` and `maxRadius`. The fill is a radial
// gradient from `colorIn` (center, full opacity) through `colorOut` (mid,
// 60% opacity) to `colorOut` at alpha 15% at the edge — a soft membrane look.
// A thin rim stroke in `colorOut` defines the boundary. An optional flash
// layer adds a brief brightness spike at each pulse peak when `flashSpeed > 0`.
//
// Pulse model: the radius follows a cosine wave:
//   r(t) = midR + ampR · cos(2π · pulseSpeed · t)
// where midR = (maxRadius + minRadius) / 2 and ampR = (maxRadius - minRadius) / 2.
// At t=0 the circle is at MAXIMUM radius (cos(0)=1) and contracts toward
// minRadius at half-period, then expands back — a natural breathing rhythm.
// `pulseSpeed` is in Hz (cycles per second); at 0 the radius holds at
// maxRadius (static ring).
//
// Flash model: when `flashSpeed > 0`, a white-ish overlay ring flashes at a
// rate of `flashSpeed` Hz. The flash alpha follows:
//   flashAlpha(t) = flashIntensity · max(0, sin(2π · flashSpeed · t))^4
// The ^4 sharpens the spike so it reads as a quick blink rather than a slow
// fade. At flashSpeed 0 or flashIntensity 0 the flash is disabled.
//
// Lifetime: `duration` is the whole-instance lifetime in seconds. The
// instance completes when `elapsed >= duration - EPS`. For indefinite use
// (e.g. a boss phase that lasts many seconds), pass a large duration; the
// engine prunes at completion.
//
// Origin & offset: if the carrier exposes origin(), its position wins over
// params.x/y (same block pattern as auraGlow/beam/trail/etc.); params.x/y are
// the standalone/theater fallback. The origin is re-resolved live each update
// so the bubble tracks a moving carrier.
//
// params: { maxRadius?, minRadius?, pulseSpeed?, colorOut?, colorIn?,
//           flashSpeed?, flashIntensity?, opacity?, lineWidth?, duration?,
//           offset?, x?, y? }
//   maxRadius    — maximum bubble radius in px (default 40). Must be > 0.
//                  Negative/non-positive values fall back to the default.
//   minRadius    — minimum bubble radius in px (default 28). Clamped to
//                  [0, maxRadius]. If >= maxRadius, the radius holds at
//                  maxRadius (no visible pulse — a static ring).
//   pulseSpeed   — pulse frequency in Hz (default 1.5): how fast the circle
//                  cycles max→min→max. Any value >= 0 works verbatim;
//                  negative values fall back to the default. At 0 the radius
//                  holds at maxRadius (static ring).
//   colorOut     — CSS color for the OUTER edge of the gradient (default
//                  '#00e5ff', bright cyan). This is the rim/membrane color.
//                  Callers may pass any CSS color.
//   colorIn      — CSS color for the CENTER of the gradient (default
//                  '#4488ff', deep blue). The gradient interpolates from
//                  this color at the center outward to colorOut at the edge,
//                  creating the blue-cyan look by default.

import { colorWithAlpha } from './colorUtil.js';

const DEFAULT_MAX_RADIUS = 40;
const DEFAULT_MIN_RADIUS = 28;
const DEFAULT_PULSE_SPEED = 1.5;
const DEFAULT_COLOR_OUT = '#00e5ff';
const DEFAULT_COLOR_IN = '#4488ff';
const DEFAULT_FLASH_SPEED = 0;
const DEFAULT_FLASH_INTENSITY = 0.6;
const DEFAULT_OPACITY = 0.85;
const DEFAULT_LINE_WIDTH = 3;
const DEFAULT_DURATION = 3.0;
const TWO_PI = Math.PI * 2;
const EPS = 1e-9;

/**
 * @param {{maxRadius?:number, minRadius?:number, pulseSpeed?:number,
 *          colorOut?:string, colorIn?:string, flashSpeed?:number,
 *          flashIntensity?:number, opacity?:number, lineWidth?:number,
 *          duration?:number, offset?:{x:number,y:number}, x?:number, y?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number, radius:number,
 *            origin:{x:number,y:number}}}
 */
export function pulseBubble(params = {}, carrier = null) {
  const maxRadius = params.maxRadius > 0 ? params.maxRadius : DEFAULT_MAX_RADIUS;
  const minRadius = Math.min(Math.max(0, params.minRadius ?? DEFAULT_MIN_RADIUS), maxRadius);
  const pulseSpeed = params.pulseSpeed >= 0 ? params.pulseSpeed : DEFAULT_PULSE_SPEED;
  const colorOut = params.colorOut ?? DEFAULT_COLOR_OUT;
  const colorIn = params.colorIn ?? DEFAULT_COLOR_IN;
  const flashSpeed = params.flashSpeed >= 0 ? params.flashSpeed : DEFAULT_FLASH_SPEED;
  const flashIntensity = Math.min(1, Math.max(0, params.flashIntensity ?? DEFAULT_FLASH_INTENSITY));
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const lineWidth = Math.max(0, params.lineWidth ?? DEFAULT_LINE_WIDTH);
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const offset = {
    x: Number.isFinite(params.offset?.x) ? params.offset.x : 0,
    y: Number.isFinite(params.offset?.y) ? params.offset.y : 0,
  };
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };

  const midR = (maxRadius + minRadius) / 2;
  const ampR = (maxRadius - minRadius) / 2;

  const api = {
    space: 'world',
    done: false,
    elapsed: 0,
    /** Current (pulsing) bubble radius (recomputed each update). */
    radius: maxRadius,
    /** Resolved origin (carrier origin() wins over params.x/y; re-resolved
     *  live each update so the bubble follows a moving carrier). */
    origin: resolveOrigin(carrier, fallback),
    /** Center offset applied on top of the origin (params.offset). */
    offset,

    /**
     * Advance the clock. Radius is derived purely from elapsed time (cosine
     * wave), so fixed-dt accumulation drift never leaks into the geometry.
     * With a live carrier the origin is re-resolved each frame. Completes
     * exactly at `elapsed >= duration - EPS`.
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      if (carrier && typeof carrier.origin === 'function') {
        const o = carrier.origin();
        if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) {
          this.origin = { x: o.x, y: o.y };
        }
      }
      // Cosine starts at 1 (max radius) at t=0.
      this.radius = pulseSpeed > EPS
        ? midR + ampR * Math.cos(TWO_PI * pulseSpeed * this.elapsed)
        : maxRadius;
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    /**
     * Draw the bubble: one filled circle with a radial gradient from
     * colorIn (center) → colorOut (edge). The pulse animates the radius.
     * Optional flash overlay adds a brighter ring at flash peaks. No-op once
     * done or when maxRadius is 0.
     * @param {object} c2d CanvasRenderingContext2D
     * @param {object} [renderCtx] unused (world-space effect)
     */
    render(c2d, renderCtx = {}) {
      if (this.done || maxRadius <= EPS) return;
      const cx = this.origin.x + offset.x;
      const cy = this.origin.y + offset.y;
      const r = Math.max(this.radius, EPS);

      c2d.save();

      // Filled disc: radial gradient from colorIn at center to colorOut at
      // the outer edge. Alpha fades toward the edge so the boundary is soft
      // (a bubble membrane, not a hard-edged blob).
      const grad = c2d.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, colorWithAlpha(colorIn, opacity));
      grad.addColorStop(0.7, colorWithAlpha(colorOut, opacity * 0.6));
      grad.addColorStop(1, colorWithAlpha(colorOut, opacity * 0.15));
      c2d.fillStyle = grad;
      c2d.beginPath();
      c2d.arc(cx, cy, r, 0, TWO_PI);
      c2d.fill();

      // Thin bright rim at the outer edge for definition.
      c2d.strokeStyle = colorWithAlpha(colorOut, opacity * 0.9);
      c2d.lineWidth = lineWidth;
      c2d.beginPath();
      c2d.arc(cx, cy, r, 0, TWO_PI);
      c2d.stroke();

      // Flash overlay: a brighter, slightly wider ring that spikes at flash
      // peaks. Only drawn when flashSpeed > 0 and flashIntensity > 0.
      if (flashSpeed > EPS && flashIntensity > EPS) {
        const sinVal = Math.sin(TWO_PI * flashSpeed * this.elapsed);
        const flashAlpha = flashIntensity * Math.pow(Math.max(0, sinVal), 4);
        if (flashAlpha > EPS) {
          c2d.strokeStyle = colorWithAlpha('#ffffff', flashAlpha);
          c2d.lineWidth = lineWidth + 2;
          c2d.beginPath();
          c2d.arc(cx, cy, r, 0, TWO_PI);
          c2d.stroke();
        }
      }

      c2d.restore();
    },

    complete() { this.done = true; },
  };

  return api;
}

/**
 * Resolve the bubble's base center point at fire time. Carrier origin() wins
 * (live entity / marker / box carrier); params.x/y are the standalone/theater
 * fallback for null-carrier fires. This value is the INITIAL origin only —
 * with a live carrier, update() re-resolves it each frame.
 * @returns {{x:number, y:number}}
 */
function resolveOrigin(carrier, fallback) {
  if (carrier && typeof carrier.origin === 'function') {
    const o = carrier.origin();
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x, y: o.y };
  }
  return { x: fallback.x, y: fallback.y };
}
