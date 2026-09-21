// Petal Panic — ground wave (effects.md §4, catalog #4). A visual wave that
// travels horizontally along the ground for stomps, earthquakes, and ground
// attacks; commonly paired with a moving collision volume by an Attack Pattern
// (the wave itself does NOT hit the player — presentation only, per the core
// rule in effects.md).
//
// STATE/DRAW effect: this instance stays active over its whole lifetime and
// owns its own timer. It advances a deterministic wavefront from its origin
// along the ground line at `speed` px/s in `direction`, clamped to `distance`
// px total travel. Each render() draws the visible crest as a filled shape:
// a leading edge of width `width` (a rounded crest bulging up to `height`
// above the ground line) plus a trailing body behind it up to `width`. The
// wavefront x is computed PURELY from elapsed time (origin.x ± speed·elapsed,
// clamped to distance), so the draw is fully deterministic — no randomness —
// and the front reaches exactly the declared distance at the declared time.
//
// Lifetime: `duration` is the WHOLE-instance lifetime and equals the total
// lifetime exactly — the instance completes when `elapsed >= duration - EPS`
// (fixed-dt epsilon convention). This is a discrete fire: it is spawned on a
// trigger (typically 'attackActive', paired with the moving collision volume)
// or fired manually / standalone in the theater (null carrier → params alone
// drive it). No continuous-persistence rule applies (B2-style recency is not
// needed: the wave has a fixed finite travel window, not a fade-out tail).
//
// Origin: if the carrier exposes origin(), its position wins over params.x/y
// (same block pattern as trail/afterimage); params.x/y are the
// standalone/theater fallback used when the effect is fired with a null
// carrier.
//
// params: { direction?, speed?, distance?, height?, width?, duration?, style? }
//   direction  — horizontal travel sign: 1 = +x (right), -1 = -x (left)
//                (default 1). Any non-zero number is normalized to its sign;
//                zero falls back to the default (a ground wave must travel
//                somewhere).
//   speed      — wavefront advance rate in px/s (default 300). Must be > 0;
//                non-positive values fall back to the default.
//   distance   — total travel distance of the wavefront in px (default 150).
//                Non-negative; negative values clamp to 0.
//   height     — crest height above the ground line in px (default 18).
//                Non-negative; negative values clamp to 0.
//   width      — leading-edge / trailing-body length in px (default 24).
//                Non-negative; negative values clamp to 0.
//   duration   — whole-instance lifetime in seconds (default 0.5). Also the
//                natural travel time: at the defaults, speed·duration = 150 =
//                distance, so the front arrives at full travel exactly when
//                the wave completes. Callers may set duration longer than
//                distance/speed — the front then HOLDS at max travel (clamped)
//                until completion. If duration < distance/speed, the instance
//                completes before the front reaches `distance`; the wave stops
//                at its current x (no teleport, no forced arrival). Must be
//                > 0; non-positive values fall back to the default.
//   style      — cosmetic variant tag (default 'crest'). Reserved for future
//                visual variants (e.g. 'dust', 'ripple'); all styles currently
//                render the same deterministic crest shape. Kept in the param
//                surface so configs can declare intent without engine changes.
//   x, y       — standalone origin (fallback when no carrier origin() exists):
//                the point on the ground line where the wave starts (default
//                { x: 0, y: 0 }).
//
// Geometry: the ground line is the horizontal line through the origin's y.
// At elapsed t the front sits at fx = origin.x + dir · min(speed·t, distance).
// The crest is drawn as an ELLIPSE centered at (frontX, groundY) with
// horizontal radius width/2 and vertical radius `height`: a semicircular arc
// of radius width/2 is scaled vertically by height/(width/2) via a translate+
// scale transform so its peak reaches exactly `height` above the ground line.
// A trailing base runs back `width` behind the front along the ground line.
// Drawn inside a save/restore bracket (recording-canvas friendly). Degenerate
// cases (height ≤ 0 or width ≤ 0) draw nothing but the instance still runs
// its timer and completes at `duration`.
//
// Duration vs travel time: if `duration < distance/speed`, the instance
// completes BEFORE the front reaches `distance` — the wave simply stops at
// whatever x it has reached at that moment (it does NOT teleport to the
// declared distance). This models a short-lived wave that hasn't finished
// crossing; the speed is unchanged and no forced-arrival occurs.
//
// Endpoint frame: when arrival coincides with completion (speed·duration ==
// distance), the engine prunes the instance during updateEffects() before
// drawEffects() runs, so the final frame at the exact endpoint is not drawn.
// The wave's last visible frame shows the crest one step short of the
// endpoint (at t = duration − dt). This is intentional: the wave fades out
// exactly as it completes.

const DEFAULT_DIRECTION = 1;    // +x (right)
const DEFAULT_SPEED = 300;      // px/s — wavefront advance rate
const DEFAULT_DISTANCE = 150;   // px — total travel of the wavefront
const DEFAULT_HEIGHT = 18;      // px — crest height above the ground line
const DEFAULT_WIDTH = 24;       // px — leading-edge / trailing-body length
const DEFAULT_DURATION = 0.5;   // s  — whole-instance lifetime (== total lifetime)
const DEFAULT_STYLE = 'crest';  // cosmetic variant tag (see header)
const WAVE_COLOR = '#ffd97a';   // warm dust/gold tint — reads as churned-up ground
const EPS = 1e-9;               // fixed-dt epsilon convention

/**
 * @param {{direction?:number, speed?:number, distance?:number, height?:number,
 *          width?:number, duration?:number, style?:string, x?:number, y?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number, frontX:number,
 *            origin:{x:number,y:number}}}
 */
export function groundWave(params = {}, carrier = null) {
  const rawDir = params.direction ?? DEFAULT_DIRECTION;
  const direction = rawDir === 0 ? DEFAULT_DIRECTION : Math.sign(rawDir);
  const speed = params.speed > 0 ? params.speed : DEFAULT_SPEED;
  const distance = Math.max(0, params.distance ?? DEFAULT_DISTANCE);
  const height = Math.max(0, params.height ?? DEFAULT_HEIGHT);
  const width = Math.max(0, params.width ?? DEFAULT_WIDTH);
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const style = params.style ?? DEFAULT_STYLE;
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };

  const api = {
    space: 'world', // the wave rides the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,
    /** Current wavefront x (recomputed each update; clamped to max travel). */
    frontX: resolveOrigin(carrier, fallback).x,
    /** Resolved origin on the ground line (carrier origin() wins over params). */
    origin: resolveOrigin(carrier, fallback),

    /**
     * Advance the clock. The wavefront position is derived from elapsed time
     * (not integrated per step), so fixed-dt accumulation drift never leaks
     * into the geometry. Completes exactly at `elapsed >= duration - EPS`.
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      this.frontX = this.origin.x + direction * Math.min(speed * this.elapsed, distance);
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    /**
     * Draw the visible crest: an ellipse of horizontal radius width/2 and
     * vertical radius `height`, trailing back `width` behind the front.
     * No-op once done, or when the degenerate geometry (height/width ≤ 0)
     * leaves nothing to draw.
     *
     * Endpoint frame note: when arrival coincides with completion (the common
     * case where speed·duration == distance), the engine prunes the instance
     * during updateEffects() before drawEffects() runs, so the final frame at
     * the endpoint is intentionally NOT drawn — the wave fades out exactly as
     * it completes. This is by design: the wave's visual lifetime ends with
     * its logical lifetime, and the last VISIBLE frame shows the crest one
     * step short of the endpoint (at t = duration − dt).
     * @param {object} c2d CanvasRenderingContext2D
     * @param {object} [renderCtx] unused (world-space effect)
     */
    render(c2d, renderCtx = {}) {
      if (this.done || height <= EPS || width <= EPS) return;
      const ox = this.origin.x, oy = this.origin.y;
      const fx = this.frontX;
      const r = width / 2; // crest bulge horizontal radius
      c2d.save();
      // Scale vertically so the semicircular arc (radius width/2) becomes an
      // ellipse whose peak reaches exactly `height` above the ground line.
      // Horizontal extent stays width/2; vertical extent becomes `height`.
      c2d.translate(fx, oy);
      c2d.scale(1, height / r);
      c2d.fillStyle = WAVE_COLOR;
      c2d.beginPath();
      // Trailing base along the ground line, from behind the front to the
      // rear of the crest bulge.
      c2d.moveTo(-direction * width, 0);
      c2d.lineTo(-direction * r, 0);
      // Semicircular crest: rear of the bulge up over the peak and down to
      // the front. Sweep direction flips with travel direction so the arc
      // always bulges UPWARD (−y) regardless of which way the wave travels.
      c2d.arc(0, 0, r, direction > 0 ? Math.PI : 0, direction > 0 ? 0 : Math.PI, direction < 0);
      c2d.closePath();
      c2d.fill();
      // Crest accent: a thin bright line tracing the top of the bulge so the
      // leading edge reads as a sharp wave rather than a solid blob.
      c2d.strokeStyle = WAVE_COLOR;
      c2d.lineWidth = 2;
      c2d.beginPath();
      c2d.arc(0, 0, r, direction > 0 ? Math.PI : 0, direction > 0 ? 0 : Math.PI, direction < 0);
      c2d.stroke();
      c2d.restore();
      // Keep `style` referenced so future variants can branch here without a
      // signature change; today every style shares the crest shape.
      void style;
    },

    complete() { this.done = true; },
  };

  return api;
}

/**
 * Resolve the wave's starting point on the ground line. Carrier origin() wins
 * (live entity / marker / box carrier); params.x/y are the standalone/theater
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
