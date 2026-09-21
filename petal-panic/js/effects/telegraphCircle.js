// Petal Panic — telegraph circle (effects.md §8, catalog #8). A warning
// circle displayed BEFORE an attack occurs. The sequence is a fixed internal
// rhythm derived from `duration`:
//
//   Phase 1 — SHRINK (ease-in): the circle starts at `radius` and contracts
//     toward `minRadius` with a cubic ease-in (slow start → fast end).
//     Occupies the first 70% of duration.
//
//   Phase 2 — GAP: nothing is drawn. A brief silence that reads as "the
//     moment before impact". Occupies the next 8% of duration.
//
//   Phase 3 — DOT BLINK ×3: a filled dot at `minRadius` flashes on/off/on/
//     off/on/off three times rapidly. The final signal that the attack is
//     about to trigger. Occupies the last 22% of duration.
//
// The total time is controlled by ONE param (`duration`). Setting a longer
// duration makes the whole sequence proportionally slower (slower build-up,
// longer pause, slower blinks). No separate params for gap length or blink
// speed — the proportions are baked in so every telegraph reads consistently.
//
// STATE/DRAW effect: this instance stays active over its whole lifetime and
// owns its own timer. Each update() advances the clock; each render() draws
// based on which phase the elapsed time falls into. The geometry is fully
// deterministic (no randomness) — phase boundaries, radius, and alpha are
// pure functions of elapsed time.
//
// Lifetime: `duration` is the WHOLE-instance lifetime — the instance
// completes when `elapsed >= duration - EPS` (fixed-dt epsilon convention).
// This is a discrete fire: spawned on a trigger (typically 'stateChange'
// when an attack windup begins) or fired manually / standalone in the theater.
//
// Origin: if the carrier exposes origin(), its position wins over params.x/y;
// params.x/y are the standalone/theater fallback. With `followTarget` true
// the origin is RE-RESOLVED from the live carrier every update() and at draw
// time; with `followTarget` false (default) the origin is captured once at
// fire time and held fixed.
//
// params: { radius?, minRadius?, pulseRate?, thickness?, opacity?,
//           duration?, followTarget?, color?, x?, y? }
//   radius       — initial (full) warning-circle radius in px (default 48).
//                  Non-negative; negative values clamp to 0.
//   minRadius    — final dot radius in px (default 12). Used both as the
//                  shrink target AND the dot size during the blink phase.
//                  Non-negative; negative values clamp to 0.
//   pulseRate    — warning pulse frequency in Hz during the SHRINK phase
//                  (default 4). The alpha oscillates as
//                  opacity · (0.5 + 0.5·cos(2π·pulseRate·t)); at 4 Hz the
//                  circle blinks ~4 times per second. pulseRate 0 disables
//                  the pulse (constant peak opacity during shrink).
//   thickness    — stroke width of the circle outline in px (default 5).
//                  Used during the SHRINK phase. The DOT BLINK phase uses a
//                  filled circle (no stroke), so thickness does not affect
//                  it. Non-negative; negative values clamp to 0.
//   opacity      — peak alpha 0..1, clamped (default 0.85). Applied to both
//                  the pulsing shrink circle and the dot blinks.
//   duration     — whole-instance lifetime in seconds (default 0.4). The
//                  total countdown window. Internally split:
//                    shrink: 0% → 70%
//                    gap:    70% → 78%
//                    blink:  78% → 100%  (3 on/off cycles)
//                  Must be > 0; non-positive values fall back to the default.
//   followTarget — whether the circle tracks a MOVING carrier (default false).
//   color        — stroke/fill color (default '#ff5a5a', red warning tint).
//   x, y         — standalone origin fallback (default { x: 0, y: 0 }).
//
// Geometry by phase:
//   SHRINK:  p = clamp(t / shrinkEnd, 0, 1); r = radius − (radius−minR)·p³
//            alpha = opacity · (0.5 + 0.5·cos(2π·pulseRate·t))
//   GAP:     nothing drawn
//   BLINK:   filled circle at minRadius; alpha = opacity when ON, 0 when OFF.
//            3 full on/off cycles across the blink window. Each cycle is
//            blinkWindow/6 long for ON and blinkWindow/6 for OFF.
//
// Degenerate cases (thickness ≤ 0 or opacity ≤ 0) draw nothing but the
// instance still runs its timer and completes at `duration`.

const DEFAULT_RADIUS = 48;       // px — initial (full) warning-circle radius
const DEFAULT_MIN_RADIUS = 12;   // px — final dot radius
const DEFAULT_PULSE_RATE = 4;    // Hz — warning pulse frequency (shrink phase)
const DEFAULT_THICKNESS = 5;     // px — circle stroke width (shrink phase)
const DEFAULT_OPACITY = 0.85;    // peak alpha
const DEFAULT_DURATION = 0.4;    // s  — whole-instance lifetime
const DEFAULT_FOLLOW_TARGET = false;
const DEFAULT_COLOR = '#ff5a5a'; // red warning tint
const EPS = 1e-9;                // fixed-dt epsilon convention

// Phase proportions (fractions of duration):
const SHRINK_FRAC = 0.60;  // 0% → 60%: ease-in shrink to ZERO
const GAP_FRAC = 0.20;     // 60% → 80%: "be ready" silence
// Blink: 80% → 100% (remaining 20%)
const BLINK_CYCLES = 3;    // 3 on/off cycles

/**
 * @param {{radius?:number, minRadius?:number, pulseRate?:number,
 *          thickness?:number, opacity?:number, duration?:number,
 *          followTarget?:boolean, color?:string, x?:number, y?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number, radius:number,
 *            origin:{x:number,y:number}}}
 */
export function telegraphCircle(params = {}, carrier = null) {
  const radius = Math.max(0, params.radius ?? DEFAULT_RADIUS);
  const minRadius = Math.max(0, params.minRadius ?? DEFAULT_MIN_RADIUS);
  const pulseRate = params.pulseRate >= 0 ? params.pulseRate : DEFAULT_PULSE_RATE;
  const thickness = Math.max(0, params.thickness ?? DEFAULT_THICKNESS);
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const followTarget = !!params.followTarget;
  const color = params.color ?? DEFAULT_COLOR;
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };

  // Pre-compute phase boundaries in seconds:
  const shrinkEnd = duration * SHRINK_FRAC;
  const gapEnd = duration * (SHRINK_FRAC + GAP_FRAC);
  // blinkEnd == duration
  // Each blink half-cycle (ON or OFF) duration:
  const blinkHalfCycle = (duration - gapEnd) / (BLINK_CYCLES * 2);

  const api = {
    space: 'world',
    done: false,
    elapsed: 0,
    /** Current circle radius (meaningful during shrink; = minRadius after). */
    radius,
    /** Resolved origin. */
    origin: resolveOrigin(carrier, fallback),

    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      // Update the radius field (used by external code / tests):
      if (this.elapsed < shrinkEnd) {
        const p = this.elapsed / shrinkEnd;
        const eased = p * p * p;
        this.radius = radius * (1 - eased); // shrinks to ZERO
      } else {
        this.radius = 0;
      }
      if (followTarget) this.origin = resolveOrigin(carrier, fallback);
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    render(c2d, renderCtx = {}) {
      if (this.done || opacity <= EPS) return;
      const o = followTarget ? resolveOrigin(carrier, fallback) : this.origin;
      const t = this.elapsed;

      if (t < shrinkEnd) {
        // ─── PHASE 1: SHRINK (ease-in stroked circle with pulse) ───
        if (thickness <= EPS) return;
        const alpha = opacity * (0.5 + 0.5 * Math.cos(2 * Math.PI * pulseRate * t));
        if (alpha <= EPS) return;
        c2d.save();
        c2d.globalAlpha = alpha;
        c2d.strokeStyle = color;
        c2d.lineWidth = thickness;
        c2d.beginPath();
        c2d.arc(o.x, o.y, this.radius, 0, Math.PI * 2);
        c2d.stroke();
        c2d.restore();

      } else if (t < gapEnd) {
        // ─── PHASE 2: GAP (nothing drawn) ───
        // Intentionally empty.

      } else {
        // ─── PHASE 3: DOT BLINK ×3 (filled dot at minRadius) ───
        const blinkT = t - gapEnd; // time within the blink window
        const cyclePos = blinkT % (blinkHalfCycle * 2);
        const isOn = cyclePos < blinkHalfCycle;
        if (!isOn) return;
        c2d.save();
        c2d.globalAlpha = opacity;
        c2d.fillStyle = color;
        c2d.beginPath();
        c2d.arc(o.x, o.y, minRadius, 0, Math.PI * 2);
        c2d.fill();
        c2d.restore();
      }
    },

    complete() { this.done = true; },
  };

  return api;
}

/**
 * Resolve the circle's center point. Carrier origin() wins; params.x/y are
 * the standalone/theater fallback.
 * @returns {{x:number, y:number}}
 */
function resolveOrigin(carrier, fallback) {
  if (carrier && typeof carrier.origin === 'function') {
    const o = carrier.origin();
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x, y: o.y };
  }
  return { x: fallback.x, y: fallback.y };
}
