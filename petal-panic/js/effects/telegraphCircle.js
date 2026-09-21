// Petal Panic — telegraph circle (effects.md §8, catalog #8). A warning
// circle displayed BEFORE an attack occurs: it may shrink toward its center
// as the countdown completes, giving the player a readable danger zone for
// boss attacks, stomps, explosions, area attacks, and delayed hazards. When
// the countdown completes, the Attack Pattern can trigger the actual attack
// (the circle itself does NOT execute anything — presentation only, per the
// core rule in effects.md).
//
// STATE/DRAW effect: this instance stays active over its whole lifetime and
// owns its own timer. Each update() advances the clock; each render() draws
// one stroked circle centered on the resolved origin whose radius is derived
// PURELY from elapsed time (radius − shrinkRate·elapsed, clamped to
// minRadius) and whose alpha pulses deterministically at `pulseRate` Hz
// (alpha = opacity · (0.5 + 0.5·cos(2π·pulseRate·t)), so t=0 starts at FULL
// peak opacity and the pulse is a pure function of elapsed time — no
// randomness, no per-frame state). The geometry is fully deterministic, so
// the ring reaches exactly `minRadius` at the declared arrival time
// ((radius − minRadius)/shrinkRate) and holds there until completion.
//
// Lifetime: `duration` is the WHOLE-instance lifetime and equals the total
// lifetime exactly — the instance completes when `elapsed >= duration - EPS`
// (fixed-dt epsilon convention). This is a discrete fire: it is spawned on a
// trigger (typically 'stateChange' when an attack windup begins, per the
// effects.md trigger table) or fired manually / standalone in the theater
// (null carrier → params alone drive it). No continuous-persistence rule
// applies (B2-style recency is not needed: the circle has a fixed finite
// warning window, not a fade-out tail).
//
// Origin: if the carrier exposes origin(), its position wins over params.x/y
// (same block pattern as trail/afterimage/groundWave/shockwave); params.x/y
// are the standalone/theater fallback used when the effect is fired with a
// null carrier. With `followTarget` true the origin is RE-RESOLVED from the
// live carrier every update() (and again at draw time), so a moving carrier
// drags the warning circle along with it — e.g. a stomp telegraph that
// follows the boss while it repositions during the windup. With
// `followTarget` false (default) the origin is captured ONCE at fire time
// and held fixed for the rest of the lifetime even if the carrier keeps
// moving — the classic "fixed position" variant from effects.md §8.
//
// params: { radius?, minRadius?, shrinkRate?, pulseRate?, thickness?,
//           opacity?, duration?, followTarget?, color?, x?, y? }
//   radius       — initial (full) warning-circle radius in px (default 48).
//                  Non-negative; negative values clamp to 0.
//   minRadius    — final (shrunk) circle radius in px (default 12).
//                  Non-negative; negative values clamp to 0. The radius is
//                  clamped to `minRadius` at all times: if minRadius > radius
//                  the circle never shrinks (it renders at `radius` and
//                  simply pulses out over `duration`).
//   shrinkRate   — inward shrink rate in px/s (default 96). Must be > 0;
//                  non-positive values fall back to the default. At the
//                  defaults the shrink travel time is (48−12)/96 = 0.375s,
//                  which fits inside the default 0.4s duration, so the
//                  default config shrinks to minRadius just before the
//                  countdown ends (a tight, readable windup).
//   pulseRate    — warning pulse frequency in Hz (default 4). The alpha
//                  oscillates as opacity · (0.5 + 0.5·cos(2π·pulseRate·t));
//                  at 4 Hz the circle blinks ~4 times per second, starting at
//                  full peak at t=0. Any value >= 0 works verbatim; negative
//                  values fall back to the default. pulseRate 0 disables the
//                  pulse (constant peak opacity).
//   thickness    — stroke width of the circle in px (default 5). Non-negative;
//                  negative values clamp to 0. Thickness 0 draws nothing
//                  (degenerate case) but the instance still runs its timer
//                  and completes at `duration`.
//   opacity      — peak alpha 0..1, clamped (default 0.85). The pulsing alpha
//                  oscillates between 0.5·opacity and opacity around this
//                  peak; it is NOT faded to zero across the lifetime (the
//                  warning must stay legible right up to the moment the
//                  attack fires).
//   duration     — whole-instance lifetime in seconds (default 0.4). The
//                  countdown window the player gets to react. Callers may set
//                  duration longer than the shrink travel time (radius −
//                  minRadius)/shrinkRate — the circle then HOLDS at minRadius
//                  (clamped) while pulsing until completion. If duration <
//                  travel time, the instance completes before the circle
//                  reaches `minRadius`; the circle stops at its current
//                  radius (no teleport, no forced arrival). Must be > 0;
//                  non-positive values fall back to the default.
//   followTarget — whether the circle tracks a MOVING carrier (default false).
//                  true: the origin is re-resolved from the live carrier
//                  origin() every update() and at draw time, so the circle
//                  follows the carrier through its lifetime. false: the
//                  origin is captured once at fire time and held fixed. Only
//                  meaningful when a carrier exposing origin() exists; with a
//                  null carrier the origin is always the params.x/y fallback.
//   color        — strokeStyle for the circle (default '#ff5a5a', a red
//                  warning tint that reads as danger against dark
//                  backgrounds). Callers may pass any CSS color. Alpha/pulse
//                  behavior is unaffected (per-frame globalAlpha).
//   x, y         — standalone origin (fallback when no carrier origin()
//                  exists): the point the warning circle is centered on
//                  (default { x: 0, y: 0 }).
//
// Geometry: at elapsed t the circle sits at
//   r(t) = max(radius − shrinkRate·t, minRadius)
// drawn as a single stroked circle centered at the resolved origin with
// lineWidth = `thickness` and globalAlpha = opacity · (0.5 + 0.5·cos(2π·
// pulseRate·t)). Drawn inside a save/restore bracket (recording-canvas
// friendly). Degenerate cases (thickness ≤ 0 or opacity ≤ 0) draw nothing
// but the instance still runs its timer and completes at `duration`.
//
// Duration vs travel time: if `duration < (radius − minRadius)/shrinkRate`,
// the instance completes BEFORE the circle reaches `minRadius` — the circle
// simply stops at whatever radius it has reached at that moment (it does NOT
// teleport to the declared minRadius). This models a short windup that cuts
// off before the full shrink; the speed is unchanged and no forced-arrival
// occurs.
//
// Endpoint frame: when the shrink arrival coincides with completion (the
// common case where (radius − minRadius)/shrinkRate == duration), the engine
// prunes the instance during updateEffects() before drawEffects() runs, so
// the final frame at the exact endpoint is not drawn. The circle's last
// visible frame shows it one step short of minRadius (at t = duration − dt).
// This is intentional: the warning ends exactly when the countdown ends.

const DEFAULT_RADIUS = 48;       // px — initial (full) warning-circle radius
const DEFAULT_MIN_RADIUS = 12;   // px — final (shrunk) circle radius
const DEFAULT_SHRINK_RATE = 96;  // px/s — inward shrink rate
const DEFAULT_PULSE_RATE = 4;    // Hz — warning pulse frequency
const DEFAULT_THICKNESS = 5;     // px — circle stroke width
const DEFAULT_OPACITY = 0.85;    // peak alpha
const DEFAULT_DURATION = 0.4;    // s  — whole-instance lifetime (== total lifetime)
const DEFAULT_FOLLOW_TARGET = false; // hold origin fixed unless told to track
const DEFAULT_COLOR = '#ff5a5a'; // red warning tint — reads as danger
const EPS = 1e-9;                // fixed-dt epsilon convention

/**
 * @param {{radius?:number, minRadius?:number, shrinkRate?:number,
 *          pulseRate?:number, thickness?:number, opacity?:number,
 *          duration?:number, followTarget?:boolean, color?:string,
 *          x?:number, y?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number, radius:number,
 *            origin:{x:number,y:number}}}
 */
export function telegraphCircle(params = {}, carrier = null) {
  const radius = Math.max(0, params.radius ?? DEFAULT_RADIUS);
  const minRadius = Math.max(0, params.minRadius ?? DEFAULT_MIN_RADIUS);
  const shrinkRate = params.shrinkRate > 0 ? params.shrinkRate : DEFAULT_SHRINK_RATE;
  const pulseRate = params.pulseRate >= 0 ? params.pulseRate : DEFAULT_PULSE_RATE;
  const thickness = Math.max(0, params.thickness ?? DEFAULT_THICKNESS);
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const followTarget = !!params.followTarget;
  const color = params.color ?? DEFAULT_COLOR;
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };

  const api = {
    space: 'world', // the circle rides the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,
    /** Current circle radius (recomputed each update; clamped to minRadius). */
    radius,
    /** Resolved origin (carrier origin() wins over params.x/y at fire time). */
    origin: resolveOrigin(carrier, fallback),

    /**
     * Advance the clock. The circle radius is derived from elapsed time (not
     * integrated per step), so fixed-dt accumulation drift never leaks into
     * the geometry. With followTarget the origin is re-resolved from the live
     * carrier each frame; otherwise the fire-time origin is held. Completes
     * exactly at `elapsed >= duration - EPS`.
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      this.radius = Math.max(radius - shrinkRate * this.elapsed, minRadius);
      if (followTarget) this.origin = resolveOrigin(carrier, fallback);
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    /**
     * Draw the warning circle: one stroked circle of the current radius at
     * the origin, with a deterministic pulsing alpha. No-op once done, or
     * when the degenerate geometry (thickness ≤ 0 or opacity ≤ 0) leaves
     * nothing to draw.
     *
     * Endpoint frame note: when the shrink arrival coincides with completion
     * (the common case where (radius − minRadius)/shrinkRate == duration),
     * the engine prunes the instance during updateEffects() before
     * drawEffects() runs, so the final frame at the endpoint is intentionally
     * NOT drawn — the warning ends exactly when the countdown ends. This is
     * by design: the circle's visual lifetime ends with its logical lifetime,
     * and the last VISIBLE frame shows the circle one step short of minRadius
     * (at t = duration − dt).
     * @param {object} c2d CanvasRenderingContext2D
     * @param {object} [renderCtx] unused (world-space effect)
     */
    render(c2d, renderCtx = {}) {
      if (this.done || thickness <= EPS || opacity <= EPS) return;
      // Re-resolve at draw time too, so a carrier that moved since the last
      // update() (or a first draw before any update) is tracked accurately.
      const o = followTarget ? resolveOrigin(carrier, fallback) : this.origin;
      const alpha = opacity * (0.5 + 0.5 * Math.cos(2 * Math.PI * pulseRate * this.elapsed));
      if (alpha <= EPS) return;
      c2d.save();
      c2d.globalAlpha = alpha;
      c2d.strokeStyle = color;
      c2d.lineWidth = thickness;
      c2d.beginPath();
      c2d.arc(o.x, o.y, this.radius, 0, Math.PI * 2);
      c2d.stroke();
      c2d.restore();
    },

    complete() { this.done = true; },
  };

  return api;
}

/**
 * Resolve the circle's center point. Carrier origin() wins (live entity /
 * marker / box carrier); params.x/y are the standalone/theater fallback for
 * null-carrier fires.
 * @returns {{x:number, y:number}}
 */
function resolveOrigin(carrier, fallback) {
  if (carrier && typeof carrier.origin === 'function') {
    const o = carrier.origin();
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x, y: o.y };
  }
  return { x: fallback.x, y: fallback.y };
}
