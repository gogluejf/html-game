// Petal Panic — squash & stretch effect (effects.md §19, catalog #19).
// Temporarily distorts a sprite's scale along its X and Y axes for landings,
// jumps, boss stomps, impacts, bouncing objects, and exaggerated cartoon
// movement.
// SPRITE-STATE effect (M6): like fade-out () and scale / pulse
// (), this instance does NOT paint new geometry of its own. It ramps
// NON-UNIFORM X/Y SCALE MULTIPLIERS over time that the renderer consumes when
// drawing the carrier's sprite — the same consumption pattern as scalePulse's
// uniform multiplier (the engine never mutates the carrier; the effect
// exposes state and the render pass applies it). The multipliers are exposed
// two ways so either integration works:
//   - `xScale()` / `yScale()` — pure queries: current per-axis scale
//     multipliers at the live clock. The entity render loop calls them and
//     folds them into the sprite transform before drawing (e.g.
//     ctx.scale(xScale(), yScale()) around the sprite draw, or combined with
//     any existing transform). Both equal 1.0 at rest, so an idle or
//     completed instance is visually neutral.
//   - `render(ctx)` — standalone fallback for the debug theater / null-carrier
//     demos, where there is no real sprite to modulate: it draws a white
//     reference box centered on the resolved sprite center with side lengths
//     w · xScale() and h · yScale() — EXACTLY the values the renderer
//     consumes. The demo box therefore squashes and stretches using ONLY
//     params + carrier geometry.
// Both paths read the SAME ramp: render() uses xScale()/yScale() alone,
// mirroring scalePulse/fadeOut's "both paths read the SAME ramp" rule, so the
// standalone demo and the exposed multipliers are identical values.
// Renderer consumption status: as of this task (6.3) the production renderer
// (systems/render.js) does NOT yet read active squash-stretch instances'
// xScale()/yScale() at the drawable entity sites — wiring that per-entity
// consumption across all carrier draw sites is deferred (follow-up / M7
// handoff), the same way the fade-out and scale-pulse consumption were left
// to the same handoff. Until then the standalone/theater path (render()
// reference box) demonstrates the distortion and the xScale()/yScale()
// contract is fully implemented and tested; a declaratively attached
// squash-stretch will drive in-game sprite distortion once render.js folds
// inst.xScale()/inst.yScale() into the carrier's sprite transform.
// Distortion model & parameter semantics (§19 knobs as independent
// declarations): the effect has TWO windows inside one lifetime:
//   - DISTORT window (length `duration`): the multipliers ease from their
//     neutral value 1.0 toward the peak distortion. The peak is
//       xPeak = 1 + intensity · (xScale − 1)
//       yPeak = 1 + intensity · (yScale − 1)
//     i.e. `intensity` scales how far each axis departs from 1.0 toward the
//     declared target scale. A landing config (xScale > 1, yScale < 1)
//     flattens wide-and-short; a jump/stretch config (xScale < 1, yScale > 1)
//     elongates tall-and-narrow.
//   - RECOVERY window (length `recoveryDuration`): the multipliers ease back
//     from the peaks to EXACTLY 1.0 on both axes.
// Each window follows an easeOut curve p → 1 − (1 − p)² (fast onset, gentle
// settle — the classic cartoon feel), which equals 0 at p = 0 and exactly 1
// at p = 1, so the terminal recovery lands on 1.0/1.0 by construction.
// Concretely, with d = delay, D = duration, R = recoveryDuration:
//   t ≤ d            : x = y = 1                                   (hold)
//   d < t < d+D      : e = 1 − (1 − (t−d)/D)²
//                      x = 1 + (xPeak − 1)·e        y = 1 + (yPeak − 1)·e
//   d+D ≤ t < d+D+R  : e = 1 − (1 − (t−d−D)/R)²
//                      x = 1 + (xPeak − 1)·(1 − e)   y = 1 + (yPeak − 1)·(1 − e)
//   t ≥ d+D+R        : x = y = 1                                (settled)
// At the exact boundary t = d+D both branches evaluate to xPeak/yPeak, so the
// ramp is continuous. No randomness anywhere — rendering is a pure function
// of elapsed time and params (deterministic). Unknown/absent numeric params
// fall back to the named defaults below.
// Lifetime & completion (the documented contract): the WHOLE-instance
// lifetime is EXACTLY `delay + duration + recoveryDuration` seconds — the
// total of the declared distort and recovery windows. The instance completes
// on the update whose accumulated elapsed time reaches `lifetime - EPS`
// (EPS = 1e-9), i.e. after exactly round((delay + duration +
// recoveryDuration) / dt) fixed steps of dt = 1/60. Because the recovery
// window ends at an eased progress of exactly 1, the terminal multipliers are
// EXACTLY 1.0 on both axes — the sprite settles back to its undistorted size
// within the declared durations (the acceptance criterion).
// Config precondition: like attackArc/groundWave/shockwave/fadeOut/
// scalePulse, a VISIBLE distortion requires delay + duration +
// recoveryDuration >= ~2·dt (at least ~2 frames at dt = 1/60). The engine
// prunes the instance during update() before drawEffects() runs once done, so
// any total lifetime <= dt completes on the FIRST update and is pruned before
// rendering — a sub-frame distortion is degenerate/nonsensical.
// params: { xScale?, yScale?, duration?, recoveryDuration?, intensity?,
//           delay? }
//   xScale         — TARGET horizontal scale at the peak of the distortion
//                    (default 1.4 = wider). Multiplied against the sprite's
//                    base width at the peak; the actual peak is
//                    1 + intensity · (xScale − 1). Must be > 0; non-positive
//                    values fall back to the default. Values < 1 narrow the
//                    sprite (stretch-tall configs).
//   yScale         — TARGET vertical scale at the peak (default 0.6 =
//                    shorter). Same semantics as xScale on the Y axis.
//                    Together with xScale they define the DEFAULT landing
//                    pose (wide-and-short); flip them for a jump/stretch.
//   duration       — length of the DISTORT window in seconds (default 0.1).
//                    Must be > 0; non-positive values fall back to the
//                    default.
//   recoveryDuration — length of the RECOVERY window in seconds (default
//                    0.15). Must be > 0; non-positive values fall back to the
//                    default. Longer recovery = a more languid settle-back.
//   intensity      — how far the multipliers travel from 1.0 toward the
//                    declared targets (default 1.0 = full distortion).
//                    Clamped to [0, 2]: 0 collapses the whole effect to
//                    neutral (valid degenerate config), values > 1 overshoot
//                    past the declared targets (exaggerated impact).
//   delay          — hold time in seconds BEFORE the distortion begins
//                    (default 0). During the delay both multipliers stay
//                    pinned at 1.0. Negative values clamp to 0.
// Carrier geometry (standalone/demo path only): the reference box drawn by
// render() resolves the sprite box at DRAW time via carrier.worldBox()
// ({ x, y, w, h }) when available, falling back to carrier.origin()/size(),
// then to factory-time params.box { x, y, w, h } for carriers without
// geometry accessors (tests, theater demos). A null carrier falls back to
// params.box only; absent or non-positive w/h → render() is a no-op. The
// xScale()/yScale() queries need NO geometry — they are purely functions of
// the clock. The demo box is drawn CENTERED on the resolved box center with
// side lengths w · xScale(t) and h · yScale(t) — exactly the multipliers the
// renderer consumes — so the distortion visibly pivots around the sprite's
// anchor point and matches the query contract sample-for-sample.

const DEFAULT_X_SCALE = 1.4;        // target horizontal scale at peak (wider)
const DEFAULT_Y_SCALE = 0.6;        // target vertical scale at peak (shorter)
const DEFAULT_DURATION = 0.1;       // s — distort-window length
const DEFAULT_RECOVERY_DURATION = 0.15; // s — recovery-window length
const DEFAULT_INTENSITY = 1.0;      // full distortion toward the declared targets
const MIN_INTENSITY = 0.0;          // 0 → neutral throughout (degenerate but valid)
const MAX_INTENSITY = 2.0;          // 2 → overshoots twice as far past the targets
const DEFAULT_DELAY = 0;            // s — hold before the distortion begins
const NEUTRAL = 1.0;                // resting multiplier on both axes
const DEMO_COLOR = '#ffffff';       // standalone demo reference-box fill
const EPS = 1e-9;                   // fixed-dt epsilon convention

/**
 * @param {{xScale?:number, yScale?:number, duration?:number,
 *          recoveryDuration?:number, intensity?:number, delay?:number}} params
 * @param {object} [carrier] entity with worldBox()/origin()+size(), or null
 * @returns {{xScale:Function, yScale:Function, update:Function, render:Function,
 *            complete:Function, done:boolean, space:string, elapsed:number}}
 */
export function squashStretch(params = {}, carrier = null) {
  const xTarget = params.xScale > 0 ? params.xScale : DEFAULT_X_SCALE;
  const yTarget = params.yScale > 0 ? params.yScale : DEFAULT_Y_SCALE;
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const recovery = params.recoveryDuration > 0 ? params.recoveryDuration : DEFAULT_RECOVERY_DURATION;
  const intensity = Math.min(MAX_INTENSITY, Math.max(MIN_INTENSITY, params.intensity ?? DEFAULT_INTENSITY));
  const delay = Math.max(0, params.delay ?? DEFAULT_DELAY);
  // Peak multipliers: how far each axis departs from neutral, scaled by
  // intensity (1.0 = exactly the declared targets).
  const xPeak = NEUTRAL + intensity * (xTarget - NEUTRAL);
  const yPeak = NEUTRAL + intensity * (yTarget - NEUTRAL);
  const xTravel = xPeak - NEUTRAL; // signed distance neutral → peak (may be negative)
  const yTravel = yPeak - NEUTRAL;
  const lifetime = delay + duration + recovery; // whole-instance lifetime == declared total

  return {
    space: 'world', // rides the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,

    /**
     * Current X scale MULTIPLIER for the carrier's sprite at the live clock:
     * 1.0 during the delay, easing out toward xPeak over the distort window,
     * then easing back to exactly 1.0 over the recovery window. Pure function
     * of elapsed time — deterministic. The renderer multiplies the sprite's
     * base horizontal draw scale by this value.
     * @returns {number}
     */
    xScale() {
      if (this.elapsed <= delay + EPS) return NEUTRAL;
      if (this.elapsed < delay + duration) {
        const e = easeOut(Math.min(1, (this.elapsed - delay) / duration));
        return NEUTRAL + xTravel * e;
      }
      if (this.elapsed < delay + duration + recovery) {
        const e = easeOut(Math.min(1, (this.elapsed - delay - duration) / recovery));
        return NEUTRAL + xTravel * (1 - e);
      }
      return NEUTRAL;
    },

    /**
     * Current Y scale MULTIPLIER for the carrier's sprite at the live clock —
     * same two-window ramp as xScale() on the Y axis. See xScale().
     * @returns {number}
     */
    yScale() {
      if (this.elapsed <= delay + EPS) return NEUTRAL;
      if (this.elapsed < delay + duration) {
        const e = easeOut(Math.min(1, (this.elapsed - delay) / duration));
        return NEUTRAL + yTravel * e;
      }
      if (this.elapsed < delay + duration + recovery) {
        const e = easeOut(Math.min(1, (this.elapsed - delay - duration) / recovery));
        return NEUTRAL + yTravel * (1 - e);
      }
      return NEUTRAL;
    },

    /**
     * Advance the clock. Completes exactly at `elapsed >= lifetime - EPS`
     * (total lifetime == delay + duration + recoveryDuration, the documented
     * contract).
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      if (this.elapsed >= lifetime - EPS) this.done = true;
    },

    /**
     * Standalone/theater fallback draw: a reference box centered on the
     * resolved sprite center, sized by EXACTLY xScale()/yScale() — the same
     * values the renderer consumes. No-op once done or when no geometry
     * resolves. Mirrors the exact multipliers the renderer would consume via
     * xScale()/yScale(), so the demo shows the real distortion.
     * @param {object} c2d CanvasRenderingContext2D
     */
    render(c2d) {
      if (this.done) return;
      const box = resolveBox(carrier, params.box);
      if (!box) return;
      const sx = this.xScale();
      const sy = this.yScale();
      if (sx <= EPS || sy <= EPS) return;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const w = box.w * sx;
      const h = box.h * sy;
      c2d.save();
      c2d.fillStyle = DEMO_COLOR;
      c2d.fillRect(cx - w / 2, cy - h / 2, w, h);
      c2d.restore();
    },

    complete() { this.done = true; },
  };
}

/** EaseOut: f(0) = 0, f(1) = 1 exactly — fast onset, gentle settle. */
function easeOut(p) {
  return 1 - (1 - p) * (1 - p);
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
