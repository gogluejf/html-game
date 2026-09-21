// Petal Panic — beam (effects.md §26, catalog #26). A directional rectangular
// beam with an alpha-gradient halo (lightsaber-style) that appears like a
// camera flash then fades out; its origin and orientation are read from the
// attached hitbox (carrier.origin()/facing()). Presentation only: the beam
// itself does NOT hit the player or execute anything (per the core rule in
// effects.md); an Attack Pattern pairs it with the actual collision volume.
//
// One-shot burst effect (like explosion): it fires, plays its flash-in →
// fade-out animation over its lifetime, then completes. It does NOT persist
// indefinitely. Lifetime = flashInTime + fadeOutTime (the total duration),
// so `duration` is derived, not declared — the instance completes when
// `elapsed >= (flashInTime + fadeOutTime) - EPS` (fixed-dt epsilon convention).
//
// STATE/DRAW effect: this instance stays active over its whole lifetime and
// owns its own timer. Each update() advances the clock; each render() draws
// one rotated rectangle centered on the resolved origin, oriented along the
// carrier's facing direction, whose alpha and halo extent are derived PURELY
// from elapsed time:
//   - Phase 1 (flash-in, 0..flashInTime): a bright core pops in and the halo
//     expands rapidly (a camera-flash "pop"). Alpha ramps up quickly from 0
//     to the peak via easeOutCubic (fast attack, slow settle), and the halo
//     radius grows from ~0 to `gradientRadius`.
//   - Phase 2 (fade-out, flashInTime..lifetime): the beam fades out. Alpha
//     decays linearly from the peak to 0, and the halo contracts back toward
//     the hard edge.
// Everything is a pure function of elapsed time — no randomness — so the
// geometry and alpha are fully deterministic and identical every run.
//
// Origin & orientation: if the carrier exposes origin(), its fire-time
// position wins over params.x/y (same block pattern as trail/afterimage/
// groundWave/shockwave/telegraphCircle/groundMarker/targetReticle/attackArc);
// params.x/y are the standalone/theater fallback used when the effect is fired
// with a null carrier. Orientation: the beam axis angle is taken from the
// carrier's facing() at fire time (angle = atan2(facing.y, facing.x)) when
// available, else from params.orientation (radians, default 0 = +x), else +x.
// Both the origin and the facing are captured ONCE at fire time and held
// frozen for the rest of the lifetime — a committed strike even if the carrier
// keeps rotating after the attack starts (a lightsaber swing is one committed
// direction, not a continuously re-aimed ribbon).
//
// params: { length?, width?, gradientRadius?, color?, flashInTime?,
//           fadeOutTime?, opacity?, orientation?, x?, y? }
//   length       — beam length in px along the facing axis (default 120).
//                  Non-negative; negative values clamp to 0 (degenerate:
//                  nothing visible, timer still runs).
//   width        — beam width in px perpendicular to the facing axis
//                  (default 18). Non-negative; negative values clamp to 0
//                  (degenerate: nothing visible, timer still runs).
//   gradientRadius — how far the soft glow extends beyond the hard edge, in
//                  px (default 14). Non-negative; negative values clamp to 0
//                  (no halo — a hard-edged beam). The halo is widest at the
//                  flash-in peak and contracts to 0 by completion.
//   color        — the beam's base color (hex string, default '#7df', a cool
//                  cyan-white energy tint that reads as a lightsaber blade
//                  against dark backgrounds). Callers may pass any CSS color;
//                  the core/halo are painted with this color at varying alphas.
//   flashInTime  — duration of the flash-in phase in seconds (default 0.05).
//                  Must be > 0; non-positive values fall back to the default.
//   fadeOutTime  — duration of the fade-out phase in seconds (default 0.15).
//                  Must be > 0; non-positive values fall back to the default.
//                  Total lifetime == flashInTime + fadeOutTime EXACTLY.
//   opacity      — peak alpha 0..1, clamped (default 0.95): the brightest the
//                  core gets at the flash-in peak.
//   coreAlpha    — optional override of the CORE line's alpha (default =
//                  `opacity`). Lets a config make the hard-edged core brighter
//                  than the surrounding halo without changing the peak envelope.
//   orientation  — beam axis angle (radians) used ONLY when the carrier does
//                  not expose facing() (default 0 = +x). When the carrier
//                  exposes facing(), its direction wins (see above). Any real
//                  number works verbatim.
//   x, y         — standalone origin (fallback when no carrier origin()
//                  exists): the point the beam is centered on (default
//                  { x: 0, y: 0 }).
//
// Geometry: at elapsed t the beam sits at the resolved origin, rotated by the
// fire-time facing angle, drawn as a filled rectangle of size `length` ×
// (width + 2·haloR) anchored AT the origin and extending FORWARD along the
// facing axis (local rect spans [0, length] × [−(width/2 + haloR),
// +(width/2 + haloR)]). The beam extends FROM the resolved origin along the
// facing axis (not centered on it): its near edge starts at the carrier's
// origin point and it projects `length` px in the facing direction. The halo is
// a LINEAR alpha gradient across the local Y axis (perpendicular to the beam)
// from −(width/2 + haloR) to +(width/2 + haloR): transparent at the outer edges,
// rising through the hard edge to the full core alpha at the center line — a
// symmetric soft glow that extends `haloR` px past each hard edge. The filled
// rectangle covers the FULL gradient span (width + 2·haloR tall) so the
// gradient's transparent falloff is visible as a soft glow around the hard beam
// core. Drawn inside a save/restore bracket (recording-canvas friendly).
// Degenerate cases (length ≤ 0, width ≤ 0, or effective alpha ≤ 0) draw nothing
// but the instance still runs its timer and completes at the total lifetime.
//
// Endpoint frame: the engine prunes the instance during updateEffects() before
// drawEffects() runs once done, so the completion frame (at t = lifetime) is
// never drawn. The last VISIBLE frame shows the beam one step short of full
// fade (alpha just above 0 at t = lifetime − dt). This is intentional: the
// beam's visual lifetime ends with its logical lifetime.

import { colorWithAlpha } from './colorUtil.js';

const DEFAULT_LENGTH = 120;          // px — beam length along the facing axis
const DEFAULT_WIDTH = 18;            // px — beam width perpendicular to the axis
const DEFAULT_GRADIENT_RADIUS = 14;  // px — halo extent beyond the hard edge
const DEFAULT_COLOR = '#7df';        // cool cyan-white energy tint
const DEFAULT_FLASH_IN_TIME = 0.05;  // s  — flash-in phase (camera-flash pop)
const DEFAULT_FADE_OUT_TIME = 0.15;  // s  — fade-out phase
const DEFAULT_OPACITY = 0.95;        // peak alpha at the flash-in peak
const DEFAULT_ORIENTATION = 0;       // rad — beam axis (+x) when no carrier facing()
const EPS = 1e-9;                    // fixed-dt epsilon convention

/**
 * @param {{length?:number, width?:number, gradientRadius?:number,
 *          color?:string, flashInTime?:number, fadeOutTime?:number,
 *          opacity?:number, orientation?:number, x?:number, y?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number,
 *            origin:{x:number,y:number}, angle:number,
 *            flashInTime:number, fadeOutTime:number, duration:number}}
 */
export function beam(params = {}, carrier = null) {
  const length = Math.max(0, params.length ?? DEFAULT_LENGTH);
  const width = Math.max(0, params.width ?? DEFAULT_WIDTH);
  const gradientRadius = Math.max(0, params.gradientRadius ?? DEFAULT_GRADIENT_RADIUS);
  const color = params.color ?? DEFAULT_COLOR;
  const flashInTime = params.flashInTime > 0 ? params.flashInTime : DEFAULT_FLASH_IN_TIME;
  const fadeOutTime = params.fadeOutTime > 0 ? params.fadeOutTime : DEFAULT_FADE_OUT_TIME;
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  // Core-line alpha: defaults to the peak `opacity` but may be overridden so a
  // config can make the hard-edged core brighter than the surrounding halo.
  const coreAlpha = Number.isFinite(params.coreAlpha)
    ? Math.min(1, Math.max(0, params.coreAlpha)) : opacity;
  const fallbackOrientation = Number.isFinite(params.orientation)
    ? params.orientation : DEFAULT_ORIENTATION;
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };
  // Total lifetime is DERIVED from the two phases (documented contract:
  // lifetime == flashInTime + fadeOutTime exactly).
  const duration = flashInTime + fadeOutTime;
  // Fire-time capture: origin + facing are frozen so a carrier that moves or
  // rotates after fire cannot drag the committed strike around.
  const origin = resolveOrigin(carrier, fallback);
  const angle = facingAngleOf(carrier, fallbackOrientation);

  const api = {
    space: 'world', // the beam rides the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,
    /** Resolved origin (carrier origin() wins over params.x/y at fire time). */
    origin,
    /** Beam axis angle (rad) frozen at fire time (carrier facing() or params). */
    angle,
    /** Flash-in phase length (s). */
    flashInTime,
    /** Fade-out phase length (s). */
    fadeOutTime,
    /** Total lifetime (s) == flashInTime + fadeOutTime. */
    duration,

    /**
     * Advance the clock. The alpha and halo are derived from elapsed time (not
     * integrated per step), so fixed-dt accumulation drift never leaks into the
     * geometry. Completes exactly at `elapsed >= duration - EPS`.
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    /**
     * Draw the beam: one rotated, gradient-filled rectangle anchored at the
     * origin and extending forward along the fire-time facing angle. No-op once
     * done, or when the degenerate geometry (length ≤ 0, width ≤ 0) or zero
     * effective alpha leaves nothing to draw.
     *
     * Endpoint frame note: the engine prunes the instance during updateEffects()
     * before drawEffects() runs, so the final frame at the exact endpoint is
     * intentionally NOT drawn — the beam fades out exactly as it completes.
     * @param {object} c2d CanvasRenderingContext2D
     * @param {object} [renderCtx] unused (world-space effect)
     */
    render(c2d, renderCtx = {}) {
      if (this.done || length <= EPS || width <= EPS) return;
      const { alpha, haloScale } = envelope(this.elapsed, flashInTime, fadeOutTime);
      if (alpha <= EPS) return;
      const haloR = gradientRadius * haloScale; // halo extent past the hard edge
      const halfW = width / 2;
      c2d.save();
      c2d.translate(origin.x, origin.y);
      c2d.rotate(angle);
      // Halo: a linear alpha gradient across the local Y axis (perpendicular to
      // the beam) from −(halfW + haloR) to +(halfW + haloR): transparent at the
      // outer edges, rising through the hard edge to the full core alpha at the
      // center line. When haloR is 0 the gradient collapses onto the hard edge
      // (a crisp beam with no soft glow).
      const grad = c2d.createLinearGradient(0, -(halfW + haloR), 0, halfW + haloR);
      const span = halfW + haloR;
      const edgeFrac = span > EPS ? halfW / span : 1;
      grad.addColorStop(0, colorWithAlpha(color, 0));
      grad.addColorStop(edgeFrac, colorWithAlpha(color, alpha * coreAlpha));
      grad.addColorStop(1, colorWithAlpha(color, 0));
      c2d.fillStyle = grad;
      c2d.beginPath();
      // The beam extends FROM the origin forward along the facing axis (near
      // edge at local x=0, projecting `length` px), and the filled rect covers
      // the FULL gradient span (width + 2·haloR tall) so the soft halo glow is
      // visible past each hard edge.
      c2d.rect(0, -(halfW + haloR), length, width + 2 * haloR);
      c2d.fill();
      c2d.restore();
    },

    complete() { this.done = true; },
  };

  return api;
}

/**
 * Two-phase alpha + halo envelope, a pure function of elapsed time.
 *   Phase 1 (flash-in, 0..flashInTime): alpha ramps 0→peak via easeOutCubic
 *   (fast attack, slow settle — the camera-flash "pop"); the halo expands
 *   0→1 (widest at the peak).
 *   Phase 2 (fade-out, flashInTime..lifetime): alpha decays linearly peak→0;
 *   the halo contracts 1→0 (back to the hard edge).
 * @returns {{alpha:number, haloScale:number}} alpha in [0,1], haloScale in [0,1]
 */
function envelope(t, flashInTime, fadeOutTime) {
  const duration = flashInTime + fadeOutTime;
  if (t <= EPS) return { alpha: 0, haloScale: 0 };
  if (t < flashInTime) {
    const p = Math.min(1, t / flashInTime);
    const ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
    return { alpha: ease, haloScale: p };
  }
  const q = Math.min(1, (t - flashInTime) / fadeOutTime);
  return { alpha: 1 - q, haloScale: 1 - q };
}

/**
 * Resolve the beam's center point at fire time. Carrier origin() wins (live
 * entity / marker / box carrier); params.x/y are the standalone/theater
 * fallback for null-carrier fires.
 * @returns {{x:number, y:number}}
 */
function resolveOrigin(carrier, fallback) {
  if (carrier && typeof carrier.origin === 'function') {
    const o = carrier.origin();
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x, y: o.y };
  }
  return { x: fallback.x, y: fallback.y };
}

/**
 * Beam axis angle (radians): the carrier's facing() direction (atan2) when it
 * exposes a usable one, else the caller-supplied `orientation` param.
 * @returns {number}
 */
function facingAngleOf(carrier, fallbackOrientation) {
  if (carrier && typeof carrier.facing === 'function') {
    const f = carrier.facing();
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
      const len = Math.hypot(f.x, f.y);
      if (len > EPS) return Math.atan2(f.y, f.x);
    }
  }
  return fallbackOrientation;
}

