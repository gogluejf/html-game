// Petal Panic — telegraph circle (effects.md §8, catalog #8). A warning
// circle displayed BEFORE an attack occurs. The sequence is a fixed internal
// rhythm derived from `duration`:
//
//   Phase 1 — BUILD: the circle animates its radius with an eased curve.
//     - shrink mode (default): starts at `radius`, contracts to zero
//       (cubic ease-in: slow start → fast vacuum suck)
//     - expand mode (`expand: true`): starts at `minRadius`, grows to `radius`
//       (cubic ease-out: fast pop → slow settle)
//     Occupies the first 60% of duration.
//
//   Phase 2 — GAP: nothing is drawn. A silence that reads as "the moment
//     before impact". Occupies the next 20% of duration.
//
//   Phase 3 — DOT BLINK ×3: a filled dot at `minRadius` flashes on/off/on/
//     off/on/off three times rapidly. The final signal that the attack is
//     about to trigger. Occupies the last 20% of duration.
//
// The total time is controlled by ONE param (`duration`). Setting a longer
// duration makes the whole sequence proportionally slower. No separate params
// for gap length or blink speed — the proportions are baked in so every
// telegraph reads consistently.
//
// Use cases:
//   shrink (default) — precision impact: "something lands EXACTLY here"
//   expand           — AoE warning: "GET OUT of this growing zone"
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
// params: { radius?, minRadius?, expand?, pulseRate?, thickness?, opacity?,
//           duration?, followTarget?, color?, x?, y? }
//   radius       — the LARGE radius in px (default 48). In shrink mode this
//                  is the starting size; in expand mode it's the ending size.
//   minRadius    — the SMALL radius in px (default 12). In shrink mode this
//                  is the dot size during the blink phase; in expand mode it's
//                  the starting size AND the dot size during blink.
//   expand       — direction flag (default false). false = shrink (precision
//                  impact), true = expand (AoE warning zone).
//   pulseRate    — warning pulse frequency in Hz during the BUILD phase
//                  (default 4). pulseRate 0 disables the pulse.
//   thickness    — stroke width of the circle outline in px (default 5).
//                  Used during the BUILD phase. The DOT BLINK uses fill.
//   opacity      — peak alpha 0..1, clamped (default 0.85).
//   duration     — whole-instance lifetime in seconds (default 0.4).
//                    build:  0% → 60%
//                    gap:    60% → 80%
//                    blink:  80% → 100%  (3 on/off cycles)
//   followTarget — whether the circle tracks a MOVING carrier (default false).
//   color        — stroke/fill color (default '#ff5a5a', red warning tint).
//   x, y         — standalone origin fallback (default { x: 0, y: 0 }).
//
// Geometry by phase:
//   BUILD (shrink):  p = clamp(t / buildEnd, 0, 1); r = radius · (1 − p³)
//   BUILD (expand):  p = clamp(t / buildEnd, 0, 1); r = minR + (radius−minR)·p³
//                    [both ease-in: slow start → fast end]
//   GAP:             nothing drawn
//   BLINK:           filled circle at minRadius; alpha = opacity when ON, 0 OFF.
//                    3 full on/off cycles across the blink window.
//
// Degenerate cases (thickness ≤ 0 or opacity ≤ 0) draw nothing but the
// instance still runs its timer and completes at `duration`.

const DEFAULT_RADIUS = 48;       // px — large radius
const DEFAULT_MIN_RADIUS = 12;   // px — small radius / dot size
const DEFAULT_EXPAND = false;    // false = shrink, true = expand
const DEFAULT_PULSE_RATE = 4;    // Hz — warning pulse frequency (build phase)
const DEFAULT_THICKNESS = 5;     // px — circle stroke width (build phase)
const DEFAULT_OPACITY = 0.85;    // peak alpha
const DEFAULT_DURATION = 0.4;    // s  — whole-instance lifetime
const DEFAULT_FOLLOW_TARGET = false;
const DEFAULT_COLOR = '#ff5a5a'; // red warning tint
const EPS = 1e-9;                // fixed-dt epsilon convention

// Phase proportions (fractions of duration):
const BUILD_FRAC = 0.60;   // 0% → 60%: eased build (shrink or expand)
const GAP_FRAC = 0.20;     // 60% → 80%: "be ready" silence
// Blink: 80% → 100% (remaining 20%)
const BLINK_CYCLES = 3;    // 3 on/off cycles

/**
 * @param {{radius?:number, minRadius?:number, expand?:boolean, pulseRate?:number,
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
  const expand = !!params.expand;
  const pulseRate = params.pulseRate >= 0 ? params.pulseRate : DEFAULT_PULSE_RATE;
  const thickness = Math.max(0, params.thickness ?? DEFAULT_THICKNESS);
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const followTarget = !!params.followTarget;
  const color = params.color ?? DEFAULT_COLOR;
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };

  // Pre-compute phase boundaries in seconds:
  const buildEnd = duration * BUILD_FRAC;
  const gapEnd = duration * (BUILD_FRAC + GAP_FRAC);
  // Each blink half-cycle (ON or OFF) duration:
  const blinkHalfCycle = (duration - gapEnd) / (BLINK_CYCLES * 2);

  // Starting radius depends on direction:
  const startRadius = expand ? minRadius : radius;

  const api = {
    space: 'world',
    done: false,
    elapsed: 0,
    /** Current circle radius. */
    radius: startRadius,
    /** Resolved origin. */
    origin: resolveOrigin(carrier, fallback),

    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      if (this.elapsed < buildEnd) {
        const p = this.elapsed / buildEnd;
        const eased = p * p * p; // ease-in: slow start → fast end (both directions)
        if (expand) {
          // r goes minRadius → radius, accelerating toward the end
          this.radius = minRadius + (radius - minRadius) * eased;
        } else {
          // r goes radius → 0, accelerating toward the end
          this.radius = radius * (1 - eased);
        }
      } else {
        this.radius = expand ? radius : 0;
      }
      if (followTarget) this.origin = resolveOrigin(carrier, fallback);
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    render(c2d, renderCtx = {}) {
      if (this.done || opacity <= EPS) return;
      const o = followTarget ? resolveOrigin(carrier, fallback) : this.origin;
      const t = this.elapsed;

      if (t < buildEnd) {
        // ─── PHASE 1: BUILD (eased stroked circle with pulse) ───
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

      } else {
        // ─── PHASE 3: DOT BLINK ×3 (filled dot at minRadius) ───
        const blinkT = t - gapEnd;
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
