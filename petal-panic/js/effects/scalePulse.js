// Petal Panic — scale / pulse effect (effects.md §18, catalog #18). Temporarily
// grows and/or shrinks a visual element for charging attacks, pickups, warnings,
// power-ups, target indicators, impacts, and environmental objects.
//
// SPRITE-STATE effect (M6): like fade-out (task 6.1), this instance does NOT
// paint new geometry of its own. It ramps a SCALE MULTIPLIER over time that the
// renderer consumes when drawing the carrier's sprite — the same consumption
// pattern as fadeOut's alpha multiplier (the engine never mutates the carrier;
// the effect exposes state and the render pass applies it). The multiplier is
// exposed two ways so either integration works:
//   - `scale()` — pure query: current uniform scale multiplier for the carrier's
//     sprite at the live clock. The entity render loop calls it and folds it into
//     the sprite transform before drawing (e.g. ctx.scale(s, s) around the
//     sprite draw, or a combined scale factor in the existing transform).
//   - `render(ctx)` — standalone fallback for the debug theater / null-carrier
//     demos, where there is no real sprite to modulate: it draws a white
//     reference box at the resolved sprite position with side lengths multiplied
//     by EXACTLY scale() — the same value the renderer consumes. The demo box
//     therefore pulses between the declared bounds using ONLY params + carrier
//     geometry, and can NEVER exceed maxScale (or drop below minScale) once the
//     pulse window opens.
// Both paths read the SAME ramp: render() uses scale() alone (NOT startScale ·
// scale()), mirroring fadeOut's "both paths read the SAME ramp" rule, so the
// standalone demo and the exposed multiplier are identical values.
//
// Renderer consumption status: as of this task (6.2) the production renderer
// (systems/render.js) does NOT yet read active scale-pulse instances' scale() at
// the drawable entity sites — wiring that per-entity consumption across all
// carrier draw sites is deferred (follow-up / M7 handoff), the same way the
// fade-out consumption was left to the same handoff. Until then the
// standalone/theater path (render() reference box) demonstrates the ramp and
// the scale() contract is fully implemented and tested; a declaratively
// attached scale-pulse will drive in-game sprite size once render.js folds
// inst.scale() into the carrier's sprite transform.
//
// Ramp model & parameter semantics (§18 knobs as independent declarations):
//   - pulseFrequency — Hz: full pulse cycles PER SECOND (the oscillation rate).
//     Each cycle takes exactly 1/pulseFrequency seconds.
//   - loopCount      — the NUMBER of full pulse cycles to perform.
//   - duration       — REDUNDANT / DERIVED: the effective lifetime is fully
//     determined by delay + loopCount · (1/pulseFrequency). The `duration`
//     param is accepted for API compatibility with the §18 parameter list but
//     has NO runtime effect; it neither caps nor overrides the
//     loopCount-derived lifetime. (Chosen model: loopCount and pulseFrequency
//     fully determine the pulse timing.)
// One cycle is a full sine period (rest → peak → back to rest), so after every
// complete cycle the multiplier returns EXACTLY to its resting value — the
// pulse is bounded within [minScale, maxScale] at all times and always settles
// back on the band when it ends. Concretely, at elapsed t inside the pulse
// window (t ∈ [delay, delay + loopCount/pulseFrequency]):
//   phase    = 2π · pulseFrequency · (t − delay)
//   scale(t) = minScale + (maxScale − minScale) · (1 − cos(phase)) / 2
// which equals minScale at phase = 0 (and every 2π thereafter) and maxScale at
// phase = π/2 (a half cycle = 1/(2·pulseFrequency) seconds), staying inside
// [minScale, maxScale] throughout.
//
// Lifetime & completion (the documented contract): the WHOLE-instance lifetime
// is EXACTLY `delay + loopCount · (1/pulseFrequency)` seconds — the time needed
// for loopCount full cycles at the declared frequency. The instance completes on
// the update whose accumulated elapsed time reaches `lifetime - EPS` (EPS =
// 1e-9), i.e. after exactly round((delay + loopCount/pulseFrequency) / dt)
// fixed steps of dt = 1/60. Because an integer number of whole cycles elapse by
// construction, the terminal multiplier lands exactly on minScale (a cycle
// boundary). This generalizes fadeOut's `delay + duration` (task 6.1) to a
// repeating pulse whose cycle length is set by the frequency, not a separate
// duration knob.
//
// The documented "starts at startScale" contract holds EXACTLY during the hold
// (t ≤ delay pins the multiplier at startScale before any oscillation begins).
// At completion an integer number of cycles by construction lands the
// oscillator exactly back on its resting value, minScale. When startScale ==
// minScale (the common case) the whole ramp is continuous from fire to
// completion; when startScale lies outside [minScale, maxScale] (a "charge up"
// config, e.g. startScale = 1.2 with maxScale = 1.5, minScale = 1) the pinned
// start value steps onto the band's rest value the moment the pulse window
// opens — the expected visual for a charge swell that snaps into its pulsing
// band. NOTE: during the hold the multiplier is startScale itself (which may
// exceed maxScale); the "never exceeds maxScale" bound applies to the
// oscillating window only, where scale() ∈ [minScale, maxScale] exactly.
// Curve vocabulary: none — the pulse shape is fixed to a sine (deterministic;
// no randomness anywhere — rendering is a pure function of elapsed time and
// params). Unknown/absent numeric params fall back to the named defaults below.
//
// Config precondition: like attackArc/groundWave/shockwave/fadeOut, a VISIBLE
// pulse requires loopCount/pulseFrequency >= ~2·dt (at least ~2 frames at
// dt = 1/60). The engine prunes the instance during update() before
// drawEffects() runs once done, so any total lifetime <= dt completes on the
// FIRST update and is pruned before rendering — a sub-frame pulse is
// degenerate/nonsensical.
//
// params: { startScale?, maxScale?, minScale?, duration?, pulseFrequency?,
//           loopCount?, delay? }
//   startScale     — scale multiplier at fire time and during the hold (default
//                    1.0 = neutral, no visible change). Must be > 0;
//                    non-positive values fall back to the default. Applied
//                    ONLY during the delay hold; once the pulse window opens
//                    the multiplier oscillates within [minScale, maxScale]. If
//                    startScale lies outside the band (a "charge up" config,
//                    e.g. startScale = 1.2 with maxScale = 1.5, minScale = 1)
//                    the hold value steps onto the band's rest value when the
//                    window opens (degenerate but valid config).
//   maxScale       — upper bound of the pulse (default 1.5). Clamped to > 0.
//   minScale       — lower bound of the pulse (default 0.8). Clamped to > 0.
//                    If minScale >= maxScale the band collapses: the effective
//                    bounds are swapped internally so the ramp stays well-
//                    defined (a zero-width band degenerates to a constant
//                    equal to the collapsed value).
//   duration       — REDUNDANT: accepted for §18 API compatibility, ignored at
//                    runtime. The lifetime is delay + loopCount ·
//                    (1/pulseFrequency) regardless of this value.
//   pulseFrequency — full pulse cycles PER SECOND, in Hz (default 1). Must be
//                    > 0; non-positive values fall back to the default. One
//                    cycle lasts 1/pulseFrequency seconds; higher values make
//                    the sprite throb faster.
//   loopCount      — the NUMBER of full pulse cycles to perform before the
//                    effect completes (default 3). Positive fractional counts
//                    are integerized via Math.round so completion always lands
//                    on a whole number of cycles (a fractional count would
//                    leave the multiplier off its resting value at completion,
//                    breaking the documented "settles back" contract).
//                    NON-POSITIVE / absent values fall back to the named
//                    default (3) — the same convention as pulseFrequency — so a
//                    degenerate config still yields a bounded, self-terminating
//                    pulse at the documented default length rather than
//                    silently clamping to one cycle.
//   delay          — hold time in seconds BEFORE the pulse begins (default 0).
//                    During the delay the multiplier stays pinned at startScale.
//                    Negative values clamp to 0.
//
// Carrier geometry (standalone/demo path only): the reference box drawn by
// render() resolves the sprite box at DRAW time via carrier.worldBox()
// ({ x, y, w, h }) when available, falling back to carrier.origin()/size(),
// then to factory-time params.box { x, y, w, h } for carriers without
// geometry accessors (tests, theater demos). A null carrier falls back to
// params.box only; absent or non-positive w/h → render() is a no-op. The
// scale() query needs NO geometry — it is purely a function of the clock.
// The demo box is drawn CENTERED on the resolved box center with side lengths
// w · scale(t) and h · scale(t) — exactly the multiplier the renderer
// consumes — so the pulse visibly grows/shrinks around the sprite's anchor
// point and matches the scale() contract sample-for-sample.

const DEFAULT_START_SCALE = 1.0;   // neutral multiplier during the hold
const DEFAULT_MAX_SCALE = 1.5;     // upper bound of the pulse band
const DEFAULT_MIN_SCALE = 0.8;     // lower bound of the pulse band
const DEFAULT_PULSE_FREQUENCY = 1; // Hz — full cycles per second
const DEFAULT_LOOP_COUNT = 3;      // number of full cycles (lifetime = loops/frequency)
const DEFAULT_DELAY = 0;           // s — hold before the pulse begins
const DEMO_COLOR = '#ffffff';      // standalone demo reference-box fill
const EPS = 1e-9;                  // fixed-dt epsilon convention
const TWO_PI = Math.PI * 2;        // one full sine period

/**
 * @param {{startScale?:number, maxScale?:number, minScale?:number,
 *          duration?:number, pulseFrequency?:number, loopCount?:number,
 *          delay?:number}} params
 * @param {object} [carrier] entity with worldBox()/origin()+size(), or null
 * @returns {{scale:Function, update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number}}
 */
export function scalePulse(params = {}, carrier = null) {
  const startScale = params.startScale > 0 ? params.startScale : DEFAULT_START_SCALE;
  let maxScale = params.maxScale > 0 ? params.maxScale : DEFAULT_MAX_SCALE;
  let minScale = params.minScale > 0 ? params.minScale : DEFAULT_MIN_SCALE;
  if (minScale >= maxScale) { // collapse/swap keeps the band well-defined
    const hi = Math.max(minScale, maxScale);
    const lo = Math.min(minScale, maxScale);
    maxScale = hi;
    minScale = lo;
  }
  // `duration` is intentionally unused: the lifetime is derived from
  // loopCount and pulseFrequency (see header). It is accepted for §18 API
  // compatibility only.
  const frequency = params.pulseFrequency > 0 ? params.pulseFrequency : DEFAULT_PULSE_FREQUENCY;
  // Non-positive / absent loopCount falls back to the NAMED default (3), matching
  // the frequency fallback convention — a degenerate count must still produce a
  // bounded, self-terminating pulse at the documented default length, not
  // silently clamp to a single cycle. Positive fractional counts are
  // integerized (rounding keeps completion on an exact whole number of cycles).
  const rawLoops = params.loopCount ?? DEFAULT_LOOP_COUNT;
  const loopCount = rawLoops > 0 ? Math.max(1, Math.round(rawLoops)) : DEFAULT_LOOP_COUNT;
  const delay = Math.max(0, params.delay ?? DEFAULT_DELAY);
  const cycleLength = 1 / frequency;               // seconds per full pulse cycle
  const lifetime = delay + loopCount * cycleLength; // whole-instance lifetime == declared total
  const span = maxScale - minScale;                // band width (>= 0 after swap/collapse)

  return {
    space: 'world', // rides the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,

    /**
     * Current scale MULTIPLIER for the carrier's sprite at the live clock:
     * pinned at startScale during the delay, then oscillating sinusoidally
     * between minScale and maxScale at the declared pulse frequency (Hz),
     * settling back to exactly minScale (the band's rest value) at t = delay +
     * loopCount · (1/pulseFrequency). Pure function of elapsed time —
     * deterministic. The renderer multiplies the sprite's base draw scale by
     * this value.
     * @returns {number}
     */
    scale() {
      if (this.elapsed <= delay + EPS) return startScale;
      const t = Math.min(this.elapsed, delay + loopCount * cycleLength);
      const phase = TWO_PI * frequency * (t - delay);
      return minScale + span * (1 - Math.cos(phase)) / 2;
    },

    /**
     * Advance the clock. Completes exactly at `elapsed >= lifetime - EPS`
     * (total lifetime == delay + loopCount · (1/pulseFrequency), the
     * documented contract).
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      if (this.elapsed >= lifetime - EPS) this.done = true;
    },

    /**
     * Standalone/theater fallback draw: a reference box centered on the
     * resolved sprite center, scaled by EXACTLY scale() — the same value the
     * renderer consumes (no additional startScale factor). No-op once done or
     * when no geometry resolves. Mirrors the exact multiplier the renderer
     * would consume via scale(), so the demo shows the real pulse and can
     * never exceed the declared bounds.
     * @param {object} c2d CanvasRenderingContext2D
     */
    render(c2d) {
      if (this.done) return;
      const box = resolveBox(carrier, params.box);
      if (!box) return;
      const m = this.scale();
      if (m <= EPS) return;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const w = box.w * m;
      const h = box.h * m;
      c2d.save();
      c2d.fillStyle = DEMO_COLOR;
      c2d.fillRect(cx - w / 2, cy - h / 2, w, h);
      c2d.restore();
    },

    complete() { this.done = true; },
  };
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
