// Petal Panic — attack arc / slash (effects.md §21, catalog #21). A fast
// visual arc representing the path of a melee attack for claws, blades,
// ribbons, cymbals, and sweeping attacks. Presentation only: the arc itself
// does NOT hit the player or execute anything (per the core rule in
// effects.md); an Attack Pattern pairs it with the actual collision volume.
//
// Config precondition: a VISIBLE sweep requires duration >= ~2·dt (at least
// ~2 frames at dt = 1/60). The engine prunes the instance during update()
// before drawEffects() runs once done, so any duration <= dt completes on
// the FIRST update and is pruned before rendering — the declared full arc
// angle is never visibly drawn (a sub-frame sweep is degenerate/nonsensical:
// a sweep can't be seen in <1 frame). Same convention as groundWave/shockwave
// config-precondition notes.
//
// STATE/DRAW effect: this instance stays active over its whole lifetime and
// owns its own timer. Each update() advances the clock; each render() draws
// one stroked arc segment centered on the resolved origin whose sweep is
// derived PURELY from elapsed time:
//   - leading edge angle = base + sweepDir · arcAngle · min(t/sweepDuration, 1)
//     where sweepDuration = duration − dt (dt = 1/60, the fixed project step).
//   - trailing edge angle = clamp(leading − sweepDir·wakeSpan, base, leading)
//     where wakeSpan = ARC_TRAIL_FRACTION·arcAngle. (For a clockwise sweep
//     the wake extends in +angle direction from the lead; for counter-
//     clockwise it extends in −angle direction — always toward the base.)
// so at t=0 the arc is a zero-length point AT the declared base orientation
// (the wake only appears AFTER the leading edge has swept past the start —
// no backward extension before the declared orientation), the visible span
// grows from the base forward until the lead is more than wakeSpan past the
// base, after which the trail lags the lead by exactly wakeSpan. The full
// visible span never exceeds [base, base + sweepDir·arcAngle] and is always
// ≤ arcAngle. The alpha fades LINEARLY from `opacity` at t=0 to 0 at
// t=duration (alpha = opacity · (1 − t/duration), clamped ≥ 0), so the flash
// "fast" quality comes from both the quick sweep and the fade-out tail in
// the same short window. Everything is a pure function of elapsed time — no
// randomness — so the geometry is fully deterministic and identical every
// run.
//
// Lifetime: `duration` is the WHOLE-instance lifetime and equals the total
// lifetime exactly — the instance completes when `elapsed >= duration - EPS`
// (fixed-dt epsilon convention). This is a discrete fire: it is spawned on a
// trigger (typically 'attackActive', per the effects.md trigger table) or
// fired manually / standalone in the theater (null carrier → params alone
// drive it). No continuous-persistence rule applies (B2-style recency is not
// needed: the slash has a fixed finite life window, not a fade-out tail).
//
// Origin & orientation: if the carrier exposes origin(), its position wins
// over params.x/y (same block pattern as trail/afterimage/groundWave/
// shockwave/telegraphCircle/groundMarker/targetReticle); params.x/y are the
// standalone/theater fallback used when the effect is fired with a null
// carrier. Orientation: the base angle the arc sweeps FROM is taken from the
// carrier's facing() when available (angle = atan2(facing.y, facing.x)),
// else from params.orientation (radians, default 0 = +x), else +x. With
// `followEntity` true BOTH the origin and the facing are RE-RESOLVED from the
// live carrier every update() (and again at draw time), so a moving/rotating
// hero drags and re-aims the slash through its whole swing — e.g. a cymbal
// sweep that tracks the boss's repositioning during the animation. With
// `followEntity` false (default) BOTH the origin and the base angle are
// captured ONCE at fire time and held frozen for the rest of the lifetime —
// the classic single-slash variant (one committed swing direction even if
// the carrier keeps rotating after the attack starts). Freezing the facing
// too is what keeps the sweep parked on the committed swing: a carrier that
// rotates after fire must NOT drag the arc around the captured origin.
//
// params: { arcAngle?, radius?, thickness?, duration?, orientation?,
//           opacity?, followEntity?, sweepDirection?, color?, x?, y? }
//   arcAngle     — total angular extent of the slash in radians (default
//                  Math.PI/2 ≈ 90°). Non-negative; negative values clamp to 0
//                  (degenerate: nothing visible, timer still runs). Values
//                  above 2π wrap harmlessly (the canvas arc handles them).
//   radius       — arc radius in px (default 40). Non-negative; negative
//                  values clamp to 0 (degenerate: nothing visible, timer
//                  still runs).
//   thickness    — stroke width of the arc in px (default 6). Non-negative;
//                  negative values clamp to 0. Thickness 0 draws nothing
//                  (degenerate case) but the instance still runs its timer
//                  and completes at `duration`.
//   duration     — whole-instance lifetime in seconds (default 0.15). The
//                  alpha fades out over the whole window; the SWEEP window is
//                  duration − dt (see Endpoint frame below): the leading
//                  edge travels the full `arcAngle` across that window so
//                  the last VISIBLE frame lands exactly at the full declared
//                  angle. Must be > 0; non-positive values fall back to the
//                  default.
//   orientation  — base angle (radians) the arc sweeps FROM, used ONLY when
//                  the carrier does not expose facing() (default 0 = +x).
//                  When the carrier exposes facing(), its direction wins
//                  (see Origin & orientation above). Any real number works
//                  verbatim (angles are normalized at draw time by the
//                  canvas arc call).
//   opacity      — peak alpha 0..1, clamped (default 0.9). The arc's alpha
//                  fades LINEARLY from `opacity` at t=0 to 0 at t=duration
//                  (alpha = opacity · (1 − t/duration), clamped ≥ 0).
//   followEntity — whether the slash tracks a MOVING carrier (default false).
//                  true: the origin AND facing are re-resolved from the live
//                  carrier every update() and at draw time, so the slash
//                  follows the carrier through its lifetime. false: both the
//                  origin and the base angle are captured once at fire time
//                  and held frozen. Only meaningful when a carrier exposing
//                  origin() exists; with a null carrier the origin is always
//                  the params.x/y fallback and the base angle is always
//                  params.orientation.
//   sweepDirection — sweep sign: 1 = counter-clockwise (canvas positive
//                  angle direction), -1 = clockwise (default 1). Any
//                  non-zero number is normalized to its sign; zero falls
//                  back to the default (a slash must sweep somewhere).
//   color        — strokeStyle for the arc (default '#ffffff', a bright
//                  white tint that reads as a fast blade/claw flash against
//                  dark backgrounds). Callers may pass any CSS color. Alpha
//                  behavior is unaffected (per-frame globalAlpha).
//   x, y         — standalone origin (fallback when no carrier origin()
//                  exists): the point the arc is centered on (default
//                  { x: 0, y: 0 }).
//
// Geometry: at elapsed t the arc sits at the resolved origin with
//   progress(t) = min(1, max(0, t / (duration − dt)))
//   lead(t)     = base + sweepDir · arcAngle · progress(t)
//   trail(t)    = clamp(lead(t) − sweepDir·wakeSpan, between base and lead(t))
// drawn as a single stroked arc of radius `radius` from trail(t) to lead(t)
// (counterclockwise flag = sweepDir < 0, so the shorter path is always
// traced), lineWidth = `thickness`, globalAlpha = opacity · (1 − t/duration).
// Drawn inside a save/restore bracket (recording-canvas friendly). Degenerate
// cases (arcAngle ≤ 0, radius ≤ 0, thickness ≤ 0, or opacity ≤ 0) draw
// nothing but the instance still runs its timer and completes at `duration`.
//
// Clamped wake: the trailing edge NEVER crosses the base orientation. Early
// in the swing (lead within wakeSpan of base) the trail sits AT the base and
// the visible span grows forward from the declared start; once the lead is
// more than wakeSpan past the base, the trail lags the lead by exactly
// wakeSpan. The visible span therefore stays inside
// [base, base + sweepDir·arcAngle] and is always ≤ arcAngle — the arc never
// extends behind the declared start orientation.
//
// Endpoint frame: the engine prunes the instance during updateEffects()
// before drawEffects() runs once done, so the completion frame (at
// t = duration) is never drawn. To make the FULL declared angle visible on
// the last drawn frame, the sweep is driven against (duration − dt) instead
// of duration: progress hits 1.0 one frame BEFORE done, so the final visible
// frame (at t = duration − dt) renders the leading edge EXACTLY at
// base + sweepDir·arcAngle. The lifetime/done semantics are unchanged — the
// instance still completes at `elapsed >= duration − EPS`; only the sweep
// mapping changes.

const DEFAULT_ARC_ANGLE = Math.PI / 2; // rad — total angular extent (~90°)
const DEFAULT_RADIUS = 40;             // px — arc radius
const DEFAULT_THICKNESS = 6;           // px — arc stroke width
const DEFAULT_DURATION = 0.15;         // s  — whole-instance lifetime (== total lifetime)
const DEFAULT_ORIENTATION = 0;         // rad — base angle (+x) when no carrier facing()
const DEFAULT_OPACITY = 0.9;           // peak alpha
const DEFAULT_FOLLOW_ENTITY = false;   // hold origin + facing fixed unless told to track
const DEFAULT_SWEEP_DIRECTION = 1;     // +1 = counter-clockwise (canvas positive)
const DEFAULT_COLOR = '#ffffff';       // bright white — reads as a fast blade/claw flash
const ARC_TRAIL_FRACTION = 0.35;       // fraction of arcAngle kept as trailing wake
const FIXED_DT = 1 / 60;               // s — fixed project step (sweep window = duration − dt)
const EPS = 1e-9;                      // fixed-dt epsilon convention

/**
 * @param {{arcAngle?:number, radius?:number, thickness?:number,
 *          duration?:number, orientation?:number, opacity?:number,
 *          followEntity?:boolean, sweepDirection?:number, color?:string,
 *          x?:number, y?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number,
 *            origin:{x:number,y:number}, baseAngle:number}}
 */
export function attackArc(params = {}, carrier = null) {
  const arcAngle = Math.max(0, params.arcAngle ?? DEFAULT_ARC_ANGLE);
  const radius = Math.max(0, params.radius ?? DEFAULT_RADIUS);
  const thickness = Math.max(0, params.thickness ?? DEFAULT_THICKNESS);
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const followEntity = !!params.followEntity;
  const rawSweep = params.sweepDirection ?? DEFAULT_SWEEP_DIRECTION;
  const sweepDir = rawSweep === 0 ? DEFAULT_SWEEP_DIRECTION : Math.sign(rawSweep);
  const color = params.color ?? DEFAULT_COLOR;
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };
  const fallbackOrientation = Number.isFinite(params.orientation)
    ? params.orientation : DEFAULT_ORIENTATION;
  // Sweep window: the leading edge reaches the full arcAngle one frame
  // before the instance is pruned (see Endpoint frame in the header), so
  // progress is measured against duration − dt rather than duration.
  // Guard: if duration <= dt (sub-frame, degenerate config), duration − dt
  // <= 0; clamping to EPS makes progress hit 1.0 immediately (full arc) so
  // no negative/NaN math occurs. The instance still completes on the first
  // update and is pruned before any draw (see Config precondition note).
  const sweepDuration = Math.max(duration - FIXED_DT, EPS);
  // In fixed mode the base angle is FROZEN at fire time so a carrier that
  // rotates after fire cannot drag the sweep around the captured origin
  // (fixed mode must hold its committed swing direction). Follow mode
  // re-resolves the live facing every frame instead.
  const frozenBaseAngle = baseAngleOf(carrier, fallbackOrientation);

  const api = {
    space: 'world', // the arc rides the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,
    /** Resolved origin (carrier origin() wins over params.x/y at fire time). */
    origin: resolveOrigin(carrier, fallback),
    /** Base angle (rad) the arc sweeps FROM (frozen in fixed mode). */
    baseAngle: frozenBaseAngle,

    /**
     * Advance the clock. The sweep is derived from elapsed time (not
     * integrated per step), so fixed-dt accumulation drift never leaks into
     * the geometry. With followEntity the origin AND base angle are
     * re-resolved from the live carrier each frame; otherwise the fire-time
     * values are held. Completes exactly at `elapsed >= duration - EPS`.
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      if (followEntity) {
        this.origin = resolveOrigin(carrier, fallback);
        this.baseAngle = baseAngleOf(carrier, fallbackOrientation);
      }
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    /**
     * Draw the slash: one stroked arc of the declared radius at the origin,
     * swept from the clamped trailing edge to the current leading edge, with
     * a linearly-fading alpha. No-op once done, or when the degenerate
     * geometry (arcAngle/radius/thickness ≤ 0 or opacity ≤ 0) leaves nothing
     * to draw.
     *
     * Endpoint frame note: the engine prunes the instance during
     * updateEffects() before drawEffects() runs, so the completion frame is
     * never drawn. The sweep is driven against (duration − dt) so the last
     * VISIBLE frame (at t = duration − dt) lands the leading edge EXACTLY at
     * base + sweepDir·arcAngle — the full declared angle is always visible.
     * @param {object} c2d CanvasRenderingContext2D
     * @param {object} [renderCtx] unused (world-space effect)
     */
    render(c2d, renderCtx = {}) {
      if (this.done || arcAngle <= EPS || radius <= EPS ||
          thickness <= EPS || opacity <= EPS) return;
      // Re-resolve at draw time too, so a carrier that moved/rotated since the
      // last update() (or a first draw before any update) is tracked
      // accurately.
      const o = followEntity ? resolveOrigin(carrier, fallback) : this.origin;
      const base = followEntity ? baseAngleOf(carrier, fallbackOrientation) : this.baseAngle;
      const progress = Math.min(1, Math.max(0, this.elapsed / sweepDuration));
      const lead = base + sweepDir * arcAngle * progress;
      // Clamped wake: the trail lags the lead by wakeSpan (extending AWAY
      // from the base, i.e. in −sweepDir) but never crosses the base
      // orientation (no pre-start extension).
      const wakeSpan = ARC_TRAIL_FRACTION * arcAngle;
      const trail = sweepDir > 0
        ? Math.max(base, lead - wakeSpan)   // CCW: trail behind lead toward base
        : Math.min(base, lead + wakeSpan);  // CW:  trail ahead of lead toward base
      const alpha = opacity * Math.min(1, Math.max(0, 1 - this.elapsed / duration));
      if (alpha <= EPS) return;
      c2d.save();
      c2d.globalAlpha = alpha;
      c2d.strokeStyle = color;
      c2d.lineWidth = thickness;
      c2d.beginPath();
      // counterclockwise flag makes the canvas trace the SHORTER path between
      // the two edges in the sweep direction (trail → lead along sweepDir).
      c2d.arc(o.x, o.y, radius, trail, lead, sweepDir < 0);
      c2d.stroke();
      c2d.restore();
    },

    complete() { this.done = true; },
  };

  return api;
}

/**
 * Resolve the arc's center point. Carrier origin() wins (live entity /
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

/**
 * Base angle (radians) the arc sweeps FROM: the carrier's facing() direction
 * (atan2) when it exposes a usable one, else the caller-supplied
 * `orientation` param.
 * @returns {number}
 */
function baseAngleOf(carrier, fallbackOrientation) {
  if (carrier && typeof carrier.facing === 'function') {
    const f = carrier.facing();
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
      const len = Math.hypot(f.x, f.y);
      if (len > EPS) return Math.atan2(f.y, f.x);
    }
  }
  return fallbackOrientation;
}
