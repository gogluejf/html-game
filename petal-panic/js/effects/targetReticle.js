// Petal Panic — target reticle (effects.md §10, catalog #10). A targeting
// reticle displayed at an arbitrary XY position or attached to a moving
// entity for homing missiles, lock-on attacks, sniper-style targeting, and
// tracking attacks. Unlike the fixed ground marker (§9), this effect CAN
// follow a moving hero, enemy, projectile, or other entity — that following
// behavior is its defining contract. Presentation only: the reticle itself
// does NOT hit the player or execute anything (per the core rule in
// effects.md); it merely marks where something is aimed at.
//
// STATE/DRAW effect: this instance stays active over its whole lifetime and
// owns its own timer. Each update() advances the clock; each render() draws
// the reticle centered on the resolved origin as two concentric stroked
// rings plus four rotating bracket ticks, all sized deterministically from
// elapsed time:
//   - outer ring radius = `size` · pulse(t)  (the "pulsing" part)
//   - inner ring radius = `size` · INNER_RING_FRACTION · pulse(t)
//   - bracket ticks sit just outside the outer ring, length TICK_LENGTH
// where pulse(t) = 1 + PULSE_AMPLITUDE·sin(2π·pulseRate·t) oscillates between
// 1 − PULSE_AMPLITUDE and 1 + PULSE_AMPLITUDE around the declared size.
// The ticks ROTATE at `rotationSpeed` rad/s over the lifetime (angle =
// rotationSpeed·elapsed — there is no initial-rotation param; a targeting
// reticle always starts with a tick pointing up and spins from there).
// The outer-ring radius and tick angle are computed once per frame in
// update() and stored on `this.radius` / `this.angle`; render() reads the
// stored values — the core formulas live in exactly one place. At
// construction both equal their t=0 values, so a render before any update
// still draws the correct first frame.
// The alpha is constant at `opacity` (a lock-on indicator must stay legible
// the whole window — no fade-out tail), so t=0 starts at exactly `opacity`.
// Everything is a pure function of elapsed time — no randomness, no
// per-frame state — so the geometry is fully deterministic and identical
// every run.
//
// Lifetime: `duration` is the WHOLE-instance lifetime and equals the total
// lifetime exactly — the instance completes when `elapsed >= duration - EPS`
// (fixed-dt epsilon convention). This is a discrete fire: it is spawned on a
// trigger (typically 'spawn' when the lock-on is acquired, or 'stateChange'
// when the tracked target changes, per the effects.md trigger table) or fired
// manually / standalone in the theater (null carrier → params alone drive
// it). No continuous-persistence rule applies (B2-style recency is not
// needed: the reticle has a fixed finite lock-on window, not a fade-out tail).
//
// Origin: if the carrier exposes origin(), its position wins over params.x/y
// (same block pattern as trail/afterimage/groundWave/shockwave/
// telegraphCircle/groundMarker); params.x/y are the standalone/theater
// fallback used when the effect is fired with a null carrier. With
// `followMode` true the origin AND facing are RE-RESOLVED from the live
// carrier every update() (and again at draw time), so a moving/rotating
// target drags and re-aims the reticle along with it — e.g. a homing
// missile's lock-on reticle riding a strafing enemy through its whole
// flight. With `followMode` false (default) BOTH the origin and the facing
// direction are captured ONCE at fire time and held frozen for the rest of
// the lifetime even if the carrier keeps moving or rotating — the "arbitrary
// XY position" variant from effects.md §10 (a reticle stamped on a spot,
// e.g. a sniper aim point that does not move). Freezing the facing too is
// what keeps a nonzero `offset` parked at the same spot: in fixed mode the
// offset direction must NOT be re-derived from the carrier's live facing()
// each frame, or a carrier that rotates after fire would make the reticle
// drift around the captured origin.
//
// params: { size?, rotationSpeed?, pulseRate?, offset?, opacity?, duration?,
//           followMode?, color?, x?, y? }
//   size         — base (mid-pulse) reticle radius in px (default 28). The
//                  drawn outer ring oscillates between size·(1−PULSE_
//                  AMPLITUDE) and size·(1+PULSE_AMPLITUDE) (i.e. 21–35 px at
//                  the defaults). Non-negative; negative values clamp to 0
//                  (degenerate: nothing visible, timer still runs).
//   rotationSpeed— angular velocity of the bracket ticks in rad/s
//                  (default Math.PI ≈ 1 rev/s). The ticks start pointing
//                  up/down/left/right (angle 0 at t=0) and spin
//                  deterministically at this rate (angle = rotationSpeed·
//                  elapsed). Any real number works verbatim, including 0
//                  (stationary ticks) and negative values (reverse spin).
//   pulseRate    — pulse frequency in Hz (default 3). The reticle blinks ~3
//                  times per second; sin starts at 0 with positive slope, so
//                  the first beat grows outward from the base size. Any
//                  value >= 0 works verbatim; negative values fall back to
//                  the default. pulseRate 0 disables the pulse (constant
//                  size == `size`).
//   offset       — radial offset from the target center, in px (default 0).
//                  Shifts the reticle outward along the direction FROM the
//                  resolved origin TOWARD the carrier's facing() when
//                  available, else +x — e.g. to park a lock-on reticle just
//                  off-center on a large boss sprite instead of dead-center.
//                  In follow mode the offset is applied at resolution time
//                  (both update and render) against the LIVE facing, so a
//                  re-resolving (following) reticle keeps its offset relative
//                  to wherever the target currently is AND faces. In fixed
//                  mode the facing used for the offset is the fire-time
//                  (frozen) facing, so the offset position does not drift as
//                  the carrier rotates.
//   opacity      — constant alpha 0..1, clamped (default 0.9). The reticle
//                  holds this alpha for its whole life (no fade): the lock-on
//                  must stay legible right up until the attack fires.
//   duration     — whole-instance lifetime in seconds (default 1.0). The
//                  lock-on window the reticle stays visible. Must be > 0;
//                  non-positive values fall back to the default.
//   followMode   — whether the reticle tracks a MOVING carrier (default
//                  false). true: the origin AND facing are re-resolved from
//                  the live carrier every update() and at draw time, so the
//                  reticle follows the target through its lifetime. false:
//                  both the origin and the facing direction are captured once
//                  at fire time and held frozen. Only meaningful when a
//                  carrier exposing origin() exists; with a null carrier the
//                  origin is always the params.x/y fallback.
//   color        — strokeStyle for all reticle strokes (default '#6ad7ff',
//                  a cyan targeting tint that reads as "locked on" against
//                  dark backgrounds). Callers may pass any CSS color. Alpha
//                  behavior is unaffected (per-frame globalAlpha).
//   x, y         — standalone origin (fallback when no carrier origin()
//                  exists): the point the reticle is centered on
//                  (default { x: 0, y: 0 }).
//
// Geometry: at elapsed t the reticle sits at resolveOrigin() + offset·dir
// with
//   rOuter(t) = size · (1 + PULSE_AMPLITUDE·sin(2π·pulseRate·t))
//   rInner(t) = rOuter(t) · INNER_RING_FRACTION
//   angle(t)  = rotationSpeed · t
// The rOuter(t) and angle(t) formulas are evaluated in update() and cached
// on `this.radius` / `this.angle`; render() reads those stored values (no
// recompute). Drawn inside a save/restore bracket (recording-canvas
// friendly): one outer stroked circle (lineWidth RETICLE_STROKE_WIDTH), one
// inner stroked circle (lineWidth RETICLE_STROKE_WIDTH / 2), then four
// radial bracket lines of length TICK_LENGTH at angles angle + k·π/2
// (k = 0..3), starting at rOuter + TICK_GAP and ending at rOuter + TICK_GAP
// + TICK_LENGTH. Degenerate cases (size ≤ 0 or opacity ≤ 0) draw nothing but
// the instance still runs its timer and completes at `duration`.
//
// Endpoint frame: the engine prunes the instance during updateEffects()
// before drawEffects() runs once done, so the final frame at the exact
// endpoint is not drawn. The reticle's last visible frame shows it one step
// short of completion (at t = duration − dt). This is intentional: the
// lock-on ends exactly when the attack window ends.

const DEFAULT_SIZE = 28;             // px — base (mid-pulse) reticle radius
const DEFAULT_ROTATION_SPEED = Math.PI; // rad/s — default tick spin (~1 rev/s)
const DEFAULT_PULSE_RATE = 3;        // Hz — pulse frequency
const DEFAULT_OFFSET = 0;            // px — radial offset from target center
const DEFAULT_OPACITY = 0.9;         // constant alpha (no fade)
const DEFAULT_DURATION = 1.0;        // s  — whole-instance lifetime (== total lifetime)
const DEFAULT_FOLLOW_MODE = false;   // hold origin fixed unless told to track
const DEFAULT_COLOR = '#6ad7ff';     // cyan targeting tint — reads as "locked on"
const PULSE_AMPLITUDE = 0.25;        // ±25% radius swing around the base size
const INNER_RING_FRACTION = 0.5;     // inner ring radius as a fraction of outer
const RETICLE_STROKE_WIDTH = 4;      // px — outer ring stroke width
const TICK_LENGTH = 10;              // px — radial bracket tick length
const TICK_GAP = 4;                  // px — gap between outer ring and tick start
const EPS = 1e-9;                    // fixed-dt epsilon convention

/**
 * @param {{size?:number, rotationSpeed?:number, pulseRate?:number,
 *          offset?:number, opacity?:number, duration?:number,
 *          followMode?:boolean, color?:string, x?:number, y?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number, radius:number,
 *            angle:number, origin:{x:number,y:number}}}
 */
export function targetReticle(params = {}, carrier = null) {
  const size = Math.max(0, params.size ?? DEFAULT_SIZE);
  const rotationSpeed = Number.isFinite(params.rotationSpeed) ? params.rotationSpeed : DEFAULT_ROTATION_SPEED;
  const pulseRate = params.pulseRate >= 0 ? params.pulseRate : DEFAULT_PULSE_RATE;
  const offset = params.offset ?? DEFAULT_OFFSET;
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const followMode = !!params.followMode;
  const color = params.color ?? DEFAULT_COLOR;
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };
  // In fixed mode the offset direction is FROZEN at fire time so a carrier
  // that rotates after fire cannot drag the reticle around the captured
  // origin (fixed mode must hold its position). Follow mode re-resolves the
  // live facing every frame instead.
  const frozenFacing = facingDir(carrier);

  const api = {
    space: 'world', // the reticle rides the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,
    /** Current outer-ring radius (recomputed each update; mid-pulse base). */
    radius: size,
    /** Current tick angle in radians (recomputed each update; 0 at t=0). */
    angle: 0,
    /** Resolved origin (carrier origin() wins over params.x/y at fire time). */
    origin: resolveOrigin(carrier, fallback),

    /**
     * Advance the clock. The reticle radius and tick angle are derived from
     * elapsed time (not integrated per step), so fixed-dt accumulation drift
     * never leaks into the geometry. With followMode the origin is re-
     * resolved from the live carrier each frame; otherwise the fire-time
     * origin is held. Completes exactly at `elapsed >= duration - EPS`.
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      this.radius = size * (1 + PULSE_AMPLITUDE * Math.sin(2 * Math.PI * pulseRate * this.elapsed));
      this.angle = rotationSpeed * this.elapsed;
      if (followMode) this.origin = resolveOrigin(carrier, fallback);
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    /**
     * Draw the reticle: outer + inner stroked rings and four rotating
     * bracket ticks at the origin (+ radial offset), at constant alpha.
     * No-op once done, or when the degenerate geometry (size ≤ 0 or
     * opacity ≤ 0) leaves nothing to draw.
     *
     * Endpoint frame note: the engine prunes the instance during
     * updateEffects() before drawEffects() runs, so the final frame at the
     * endpoint is intentionally NOT drawn — the lock-on ends exactly when
     * the attack window ends. This is by design: the reticle's visual
     * lifetime ends with its logical lifetime, and the last VISIBLE frame
     * shows the reticle one step short of completion (at t = duration − dt).
     * @param {object} c2d CanvasRenderingContext2D
     * @param {object} [renderCtx] unused (world-space effect)
     */
    render(c2d, renderCtx = {}) {
      if (this.done || size <= EPS || opacity <= EPS) return;
      // Re-resolve at draw time too, so a carrier that moved since the last
      // update() (or a first draw before any update) is tracked accurately.
      const o = followMode ? resolveOrigin(carrier, fallback) : this.origin;
      const dir = followMode ? facingDir(carrier) : frozenFacing;
      const cx = o.x + dir.x * offset;
      const cy = o.y + dir.y * offset;
      const rOuter = Math.max(0, this.radius);
      const rInner = rOuter * INNER_RING_FRACTION;
      c2d.save();
      c2d.globalAlpha = opacity;
      c2d.strokeStyle = color;
      // Outer ring.
      c2d.lineWidth = RETICLE_STROKE_WIDTH;
      c2d.beginPath();
      c2d.arc(cx, cy, rOuter, 0, Math.PI * 2);
      c2d.stroke();
      // Inner ring.
      c2d.lineWidth = RETICLE_STROKE_WIDTH / 2;
      c2d.beginPath();
      c2d.arc(cx, cy, rInner, 0, Math.PI * 2);
      c2d.stroke();
      // Four cardinal bracket ticks, rotating at angle(t).
      c2d.lineWidth = RETICLE_STROKE_WIDTH / 2;
      for (let k = 0; k < 4; k++) {
        const a = this.angle + (k * Math.PI) / 2;
        const cos = Math.cos(a), sin = Math.sin(a);
        c2d.beginPath();
        c2d.moveTo(cx + cos * (rOuter + TICK_GAP), cy + sin * (rOuter + TICK_GAP));
        c2d.lineTo(cx + cos * (rOuter + TICK_GAP + TICK_LENGTH), cy + sin * (rOuter + TICK_GAP + TICK_LENGTH));
        c2d.stroke();
      }
      c2d.restore();
    },

    complete() { this.done = true; },
  };

  return api;
}

/**
 * Resolve the reticle's center point. Carrier origin() wins (live entity /
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
 * Unit direction the radial `offset` is applied along: the carrier's
 * facing() when it exposes one, else +x. Normalized defensively so a
 * non-unit facing vector still yields a unit offset direction.
 * @returns {{x:number, y:number}}
 */
function facingDir(carrier) {
  if (carrier && typeof carrier.facing === 'function') {
    const f = carrier.facing();
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
      const len = Math.hypot(f.x, f.y);
      if (len > EPS) return { x: f.x / len, y: f.y / len };
    }
  }
  return { x: 1, y: 0 };
}
