// Petal Panic — shockwave (effects.md §5, catalog #5). A circular ring that
// originates from a point and expands rapidly outward for explosions, boss
// impacts, stomps, and power releases; commonly paired with an area collision
// volume by an Attack Pattern (the ring itself does NOT hit the player —
// presentation only, per the core rule in effects.md).
// Config precondition: the documented behavior "expands to maxRadius at
// expansionSpeed then fades" assumes duration >= (maxRadius − startRadius)/
// expansionSpeed. If duration is shorter than the travel time, the ring stops
// expanding at its current radius when the instance completes (no teleport, no
// forced arrival) — same convention as groundWave ().
// STATE/DRAW effect: this instance stays active over its whole lifetime and
// owns its own timer. Each update() advances the clock; each render() draws
// one stroked circle centered on the origin whose radius is derived PURELY
// from elapsed time (startRadius + expansionSpeed·elapsed, clamped to
// maxRadius) and whose alpha fades linearly from `opacity` to 0 across the
// whole lifetime. The geometry is fully deterministic — no randomness — so
// the ring reaches exactly `maxRadius` at the declared arrival time
// ((maxRadius − startRadius)/expansionSpeed) and holds there until completion.
// Lifetime: `duration` is the WHOLE-instance lifetime and equals the total
// lifetime exactly — the instance completes when `elapsed >= duration - EPS`
// (fixed-dt epsilon convention). This is a discrete fire: it is spawned on a
// trigger (typically 'explosion' or 'attackActive', paired with the area
// collision volume) or fired manually / standalone in the theater (null
// carrier → params alone drive it). No continuous-persistence rule applies
// (B2-style recency is not needed: the ring has a fixed finite life window,
// not a fade-out tail).
// Origin: if the carrier exposes origin(), its position wins over params.x/y
// (same block pattern as trail/afterimage/groundWave); params.x/y are the
// standalone/theater fallback used when the effect is fired with a null
// carrier.
// params: { startRadius?, maxRadius?, expansionSpeed?, thickness?, opacity?,
//           duration?, color?, x?, y? }
//   startRadius    — initial ring radius in px (default 4). Non-negative;
//                    negative values clamp to 0.
//   maxRadius      — final ring radius in px (default 60). Non-negative;
//                    negative values clamp to 0. The radius is clamped to
//                    `maxRadius` at all times: if maxRadius < startRadius the
//                    ring never grows (it renders at maxRadius and simply
//                    fades out over `duration`).
//   expansionSpeed — ring growth rate in px/s (default 300). Must be > 0;
//                    non-positive values fall back to the default.
//   thickness      — stroke width of the ring in px (default 6). Non-negative;
//                    negative values clamp to 0. Thickness 0 draws nothing
//                    (degenerate case) but the instance still runs its timer
//                    and completes at `duration`.
//   opacity        — peak alpha 0..1, clamped (default 0.9). The ring's alpha
//                    fades LINEARLY from `opacity` at t=0 to 0 at t=duration
//                    (alpha = opacity · (1 − elapsed/duration), clamped ≥ 0),
//                    so the ring "then fades" over its remaining life after
//                    reaching maxRadius.
//   duration       — whole-instance lifetime in seconds (default 0.4). Also
//                    the fade window. Callers may set duration longer than the
//                    travel time (maxRadius − startRadius)/expansionSpeed —
//                    the ring then HOLDS at maxRadius (clamped) while fading
//                    out until completion. If duration < travel time, the
//                    instance completes before the ring reaches `maxRadius`;
//                    the ring stops at its current radius (no teleport, no
//                    forced arrival). Must be > 0; non-positive values fall
//                    back to the default.
//   color          — strokeStyle for the ring (default '#ffe9a8', a warm
//                    bright tint that reads as a blast front against dark
//                    backgrounds). Callers may pass any CSS color. Alpha/fade
//                    behavior is unaffected (per-frame globalAlpha).
//   x, y           — standalone origin (fallback when no carrier origin()
//                    exists): the point the ring expands from (default
//                    { x: 0, y: 0 }).
// Geometry: at elapsed t the ring sits at
//   r(t) = min(startRadius + expansionSpeed·t, maxRadius)
// drawn as a single stroked circle centered at the resolved origin with
// lineWidth = `thickness` and globalAlpha = opacity · (1 − t/duration).
// Drawn inside a save/restore bracket (recording-canvas friendly). Degenerate
// cases (thickness ≤ 0 or opacity ≤ 0) draw nothing but the instance still
// runs its timer and completes at `duration`.
// Duration vs travel time: if `duration < (maxRadius − startRadius)/
// expansionSpeed`, the instance completes BEFORE the ring reaches `maxRadius`
// — the ring simply stops at whatever radius it has reached at that moment
// (it does NOT teleport to the declared maxRadius). This models a short-lived
// shockwave that hasn't finished expanding; the speed is unchanged and no
// forced-arrival occurs.
// Endpoint frame: when arrival coincides with completion (the common case
// where (maxRadius − startRadius)/expansionSpeed == duration), the engine
// prunes the instance during updateEffects() before drawEffects() runs, so
// the final frame at the exact endpoint is not drawn. The ring's last visible
// frame shows it one step short of maxRadius (at t = duration − dt). This is
// intentional: the ring fades out exactly as it completes.

const DEFAULT_START_RADIUS = 4;    // px — initial ring radius
const DEFAULT_MAX_RADIUS = 60;     // px — final ring radius
const DEFAULT_EXPANSION_SPEED = 300; // px/s — ring growth rate
const DEFAULT_THICKNESS = 6;       // px — ring stroke width
const DEFAULT_OPACITY = 0.9;       // peak alpha
const DEFAULT_DURATION = 0.4;      // s  — whole-instance lifetime (== total lifetime)
const DEFAULT_COLOR = '#ffe9a8';   // warm bright tint — reads as a blast front
const EPS = 1e-9;                  // fixed-dt epsilon convention

/**
 * @param {{startRadius?:number, maxRadius?:number, expansionSpeed?:number,
 *          thickness?:number, opacity?:number, duration?:number, color?:string,
 *          x?:number, y?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number, radius:number,
 *            origin:{x:number,y:number}}}
 */
export function shockwave(params = {}, carrier = null) {
  const startRadius = Math.max(0, params.startRadius ?? DEFAULT_START_RADIUS);
  const maxRadius = Math.max(0, params.maxRadius ?? DEFAULT_MAX_RADIUS);
  const expansionSpeed = params.expansionSpeed > 0 ? params.expansionSpeed : DEFAULT_EXPANSION_SPEED;
  const thickness = Math.max(0, params.thickness ?? DEFAULT_THICKNESS);
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const color = params.color ?? DEFAULT_COLOR;
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };

  const api = {
    space: 'world', // the ring rides the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,
    /** Current ring radius (recomputed each update; clamped to maxRadius). */
    radius: startRadius,
    /** Resolved origin (carrier origin() wins over params.x/y). */
    origin: resolveOrigin(carrier, fallback),

    /**
     * Advance the clock. The ring radius is derived from elapsed time (not
     * integrated per step), so fixed-dt accumulation drift never leaks into
     * the geometry. Completes exactly at `elapsed >= duration - EPS`.
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      this.radius = Math.min(startRadius + expansionSpeed * this.elapsed, maxRadius);
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    /**
     * Draw the ring: one stroked circle of the current radius at the origin,
     * with a linearly-fading alpha. No-op once done, or when the degenerate
     * geometry (thickness ≤ 0 or opacity ≤ 0) leaves nothing to draw.
     *
     * Endpoint frame note: when arrival coincides with completion (the common
     * case where (maxRadius − startRadius)/expansionSpeed == duration), the
     * engine prunes the instance during updateEffects() before drawEffects()
     * runs, so the final frame at the endpoint is intentionally NOT drawn —
     * the ring fades out exactly as it completes. This is by design: the
     * ring's visual lifetime ends with its logical lifetime, and the last
     * VISIBLE frame shows the ring one step short of maxRadius (at
     * t = duration − dt).
     * @param {object} c2d CanvasRenderingContext2D
     * @param {object} [renderCtx] unused (world-space effect)
     */
    render(c2d, renderCtx = {}) {
      if (this.done || thickness <= EPS || opacity <= EPS) return;
      const alpha = opacity * Math.min(1, Math.max(0, 1 - this.elapsed / duration));
      if (alpha <= EPS) return;
      c2d.save();
      c2d.globalAlpha = alpha;
      c2d.strokeStyle = color;
      c2d.lineWidth = thickness;
      c2d.beginPath();
      c2d.arc(this.origin.x, this.origin.y, this.radius, 0, Math.PI * 2);
      c2d.stroke();
      c2d.restore();
    },

    complete() { this.done = true; },
  };

  return api;
}

/**
 * Resolve the ring's center point. Carrier origin() wins (live entity /
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
