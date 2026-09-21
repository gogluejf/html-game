// Petal Panic — ground target marker (effects.md §9, catalog #9). A fixed
// target marker at a world GROUND position for missiles, falling objects,
// bombs, and artillery arriving from above. The marker stays FIXED at its
// resolved origin for the whole lifetime (no follow mode — that is the job of
// the Target Reticle, effects.md §10), letting the player read the danger
// area and escape before impact. Presentation only: the marker itself does
// NOT hit the player or execute anything (per the core rule in effects.md);
// an Attack Pattern pairs it with the actual collision volume.
//
// STATE/DRAW effect: this instance stays active over its whole lifetime and
// owns its own timer. Each update() advances the clock; each render() draws
// the marker centered on the resolved origin as two concentric stroked rings
// plus four cardinal tick marks, all sized deterministically from elapsed
// time:
//   - outer ring radius = `radius` · pulse(t)  (the "pulsing" part)
//   - inner ring radius = `radius` · INNER_RING_FRACTION · pulse(t)
//   - tick marks sit just outside the outer ring, length TICK_LENGTH
// where pulse(t) = 1 + PULSE_AMPLITUDE·sin(2π·pulseRate·t) oscillates between
// 1 − PULSE_AMPLITUDE and 1 + PULSE_AMPLITUDE around the declared radius.
// The outer-ring radius is computed once per frame in update() and stored on
// `this.radius` (initialized to the base radius at construction, so a render
// before any update still draws the correct t=0 geometry); render() reads the
// stored value — the core formula lives in exactly one place.
// The alpha is constant at `opacity` (a warning marker must stay legible the
// whole window — no fade-out tail), so t=0 starts at exactly `opacity`.
// Everything is a pure function of elapsed time — no randomness, no per-frame
// state — so the geometry is fully deterministic and identical every run.
//
// Lifetime: `duration` is the WHOLE-instance lifetime and equals the total
// lifetime exactly — the instance completes when `elapsed >= duration - EPS`
// (fixed-dt epsilon convention). This is a discrete fire: it is spawned on a
// trigger (typically 'spawn' when the incoming projectile/missile is created,
// per the effects.md trigger table) or fired manually / standalone in the
// theater (null carrier → params alone drive it). No continuous-persistence
// rule applies (B2-style recency is not needed: the marker has a fixed finite
// warning window, not a fade-out tail).
//
// Origin: if the carrier exposes origin(), its position wins over params.x/y
// (same block pattern as trail/afterimage/groundWave/shockwave/telegraphCircle);
// params.x/y are the standalone/theater fallback used when the effect is fired
// with a null carrier. The origin is captured ONCE at fire time and held fixed
// for the rest of the lifetime even if the carrier keeps moving — a ground
// marker is by definition a FIXED spot on the ground (effects.md §9: "The
// marker can remain fixed, allowing the player to escape the danger area").
// There is deliberately NO followTarget param here; following targets is the
// Target Reticle's contract (§10).
//
// params: { radius?, pulseRate?, rotation?, opacity?, duration?, animation?,
//           color?, x?, y? }
//   radius       — base (mid-pulse) marker radius in px (default 24). The
//                  drawn outer ring oscillates between radius·(1−PULSE_
//                  AMPLITUDE) and radius·(1+PULSE_AMPLITUDE) (i.e. 18–30 px
//                  at the defaults). Non-negative; negative values clamp to 0
//                  (degenerate: nothing visible, timer still runs).
//   pulseRate    — pulse frequency in Hz (default 2). The marker blinks ~2
//                  times per second; sin starts at 0 with positive slope, so
//                  the first beat grows outward from the base radius. Any
//                  value >= 0 works verbatim; negative values fall back to
//                  the default. pulseRate 0 disables the pulse (constant
//                  radius == `radius`).
//   rotation     — initial orientation of the cross ticks in radians
//                  (default 0, i.e. ticks point up/down/left/right). The
//                  ticks ROTATE at TICK_ROTATION_SPEED rad/s over the
//                  lifetime (rotation + TICK_ROTATION_SPEED·elapsed), giving
//                  the marker a slow, readable spin without any per-frame
//                  state. Callers may pass any real number.
//   opacity      — constant alpha 0..1, clamped (default 0.85). The marker
//                  holds this alpha for its whole life (no fade): the warning
//                  must stay legible right up to the moment of impact.
//   duration     — whole-instance lifetime in seconds (default 1.5). The
//                  warning window the player gets to leave the danger zone.
//                  Must be > 0; non-positive values fall back to the default.
//   animation    — cosmetic variant tag (default 'pulse'). Reserved for
//                  future visual variants (e.g. 'spin', 'blink'); all styles
//                  currently render the same deterministic pulsing double
//                  ring + rotating ticks. Kept in the param surface so
//                  configs can declare intent without engine changes (same
//                  pattern as groundWave's `style`).
//   color        — strokeStyle for all marker strokes (default '#7dff6a', a
//                  bright green targeting tint that reads as "aimed at"
//                  against dark backgrounds). Callers may pass any CSS
//                  color. Alpha behavior is unaffected (per-frame globalAlpha).
//   x, y         — standalone origin (fallback when no carrier origin()
//                  exists): the point on the ground the marker is centered on
//                  (default { x: 0, y: 0 }).
//
// Geometry: at elapsed t the marker sits at the resolved origin with
//   rOuter(t) = radius · (1 + PULSE_AMPLITUDE·sin(2π·pulseRate·t))
//   rInner(t) = rOuter(t) · INNER_RING_FRACTION
//   angle(t)  = rotation + TICK_ROTATION_SPEED·t
// The rOuter(t) formula is evaluated in update() and cached on `this.radius`;
// render() reads that stored value (no recompute). At construction
// `this.radius` equals the base radius, so a first draw before any update
// shows the correct t=0 frame.
// Drawn inside a save/restore bracket (recording-canvas friendly): one outer
// stroked circle (lineWidth MARKER_STROKE_WIDTH), one inner stroked circle
// (lineWidth MARKER_STROKE_WIDTH / 2), then four radial tick lines of length
// TICK_LENGTH at angles angle + k·π/2 (k = 0..3), starting at
// rOuter + TICK_GAP and ending at rOuter + TICK_GAP + TICK_LENGTH. Degenerate
// cases (radius ≤ 0 or opacity ≤ 0) draw nothing but the instance still runs
// its timer and completes at `duration`.
//
// Endpoint frame: the engine prunes the instance during updateEffects()
// before drawEffects() runs once done, so the final frame at the exact
// endpoint is not drawn. The marker's last visible frame shows it one step
// short of completion (at t = duration − dt). This is intentional: the
// warning ends exactly when the impact window ends.

const DEFAULT_RADIUS = 24;        // px — base (mid-pulse) marker radius
const DEFAULT_PULSE_RATE = 2;     // Hz — pulse frequency
const DEFAULT_ROTATION = 0;       // rad — initial tick orientation
const DEFAULT_OPACITY = 0.85;     // constant alpha (no fade)
const DEFAULT_DURATION = 1.5;     // s  — whole-instance lifetime (== total lifetime)
const DEFAULT_ANIMATION = 'pulse'; // cosmetic variant tag (see header)
const DEFAULT_COLOR = '#7dff6a';  // bright green targeting tint
const PULSE_AMPLITUDE = 0.25;     // ±25% radius swing around the base radius
const INNER_RING_FRACTION = 0.5;  // inner ring radius as a fraction of outer
const TICK_ROTATION_SPEED = Math.PI; // rad/s — slow deterministic tick spin
const MARKER_STROKE_WIDTH = 4;    // px — outer ring stroke width
const TICK_LENGTH = 8;            // px — radial tick mark length
const TICK_GAP = 4;               // px — gap between outer ring and tick start
const PERSPECTIVE_SQUASH = 0.3;   // y-axis squash for ground perspective (1 = flat circle)
const EPS = 1e-9;                 // fixed-dt epsilon convention

/**
 * @param {{radius?:number, pulseRate?:number, rotation?:number,
 *          opacity?:number, duration?:number, animation?:string,
 *          color?:string, x?:number, y?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number, radius:number,
 *            origin:{x:number,y:number}}}
 */
export function groundMarker(params = {}, carrier = null) {
  const radius = Math.max(0, params.radius ?? DEFAULT_RADIUS);
  const pulseRate = params.pulseRate >= 0 ? params.pulseRate : DEFAULT_PULSE_RATE;
  const rotation = Number.isFinite(params.rotation) ? params.rotation : DEFAULT_ROTATION;
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const animation = params.animation ?? DEFAULT_ANIMATION;
  const color = params.color ?? DEFAULT_COLOR;
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };

  const api = {
    space: 'world', // the marker rides the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,
    /** Current outer-ring radius (recomputed each update; mid-pulse base). */
    radius,
    /** Resolved origin (carrier origin() wins over params.x/y at fire time). */
    origin: resolveOrigin(carrier, fallback),

    /**
     * Advance the clock. The marker radius is derived from elapsed time (not
     * integrated per step), so fixed-dt accumulation drift never leaks into
     * the geometry. The origin is FIXED for the lifetime (no follow mode —
     * see header). Completes exactly at `elapsed >= duration - EPS`.
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      this.radius = radius * (1 + PULSE_AMPLITUDE * Math.sin(2 * Math.PI * pulseRate * this.elapsed));
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    /**
     * Draw the marker: outer + inner stroked rings and four rotating radial
     * ticks at the fixed origin, at constant alpha. No-op once done, or when
     * the degenerate geometry (radius ≤ 0 or opacity ≤ 0) leaves nothing to
     * draw.
     *
     * Endpoint frame note: the engine prunes the instance during
     * updateEffects() before drawEffects() runs, so the final frame at the
     * endpoint is intentionally NOT drawn — the warning ends exactly when the
     * impact window ends. This is by design: the marker's visual lifetime
     * ends with its logical lifetime, and the last VISIBLE frame shows the
     * marker one step short of completion (at t = duration − dt).
     * @param {object} c2d CanvasRenderingContext2D
     * @param {object} [renderCtx] unused (world-space effect)
     */
    render(c2d, renderCtx = {}) {
      if (this.done || radius <= EPS || opacity <= EPS) return;
      const o = this.origin;
      const rOuter = Math.max(0, this.radius);
      const rInner = rOuter * INNER_RING_FRACTION;
      const angle = rotation + TICK_ROTATION_SPEED * this.elapsed;
      const sq = PERSPECTIVE_SQUASH; // y-axis squash for ground perspective
      c2d.save();
      c2d.globalAlpha = opacity;
      c2d.strokeStyle = color;
      // Outer ring (ellipse — squashed y for ground perspective).
      c2d.lineWidth = MARKER_STROKE_WIDTH;
      c2d.beginPath();
      c2d.ellipse(o.x, o.y, rOuter, rOuter * sq, 0, 0, Math.PI * 2);
      c2d.stroke();
      // Inner ring.
      c2d.lineWidth = MARKER_STROKE_WIDTH / 2;
      c2d.beginPath();
      c2d.ellipse(o.x, o.y, rInner, rInner * sq, 0, 0, Math.PI * 2);
      c2d.stroke();
      // Four cardinal tick marks, rotating slowly at angle(t), squashed on y.
      c2d.lineWidth = MARKER_STROKE_WIDTH / 2;
      for (let k = 0; k < 4; k++) {
        const a = angle + (k * Math.PI) / 2;
        const cos = Math.cos(a), sin = Math.sin(a);
        const gapR = rOuter + TICK_GAP;
        const endR = gapR + TICK_LENGTH;
        c2d.beginPath();
        c2d.moveTo(o.x + cos * gapR, o.y + sin * gapR * sq);
        c2d.lineTo(o.x + cos * endR, o.y + sin * endR * sq);
        c2d.stroke();
      }
      c2d.restore();
      void animation;
    },

    complete() { this.done = true; },
  };

  return api;
}

/**
 * Resolve the marker's center point. Carrier origin() wins (live entity /
 * marker / box carrier); params.x/y are the standalone/theater fallback for
 * null-carrier fires. Captured once at fire time and held fixed for the
 * lifetime (the marker is a fixed ground spot — no follow mode).
 * @returns {{x:number, y:number}}
 */
function resolveOrigin(carrier, fallback) {
  if (carrier && typeof carrier.origin === 'function') {
    const o = carrier.origin();
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x, y: o.y };
  }
  return { x: fallback.x, y: fallback.y };
}
