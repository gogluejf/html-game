// Petal Panic — aura / glow effect (effects.md §22, catalog #22). A soft
// radial glow drawn AROUND OR BEHIND a sprite for invincibility, power-ups,
// boss states, charged attacks, special abilities, and supernatural effects.
// Presentation only: the glow itself does NOT hit the player or execute
// anything (per the core rule in effects.md); an Attack Pattern pairs it with
// the actual collision volume when one is needed.
//
// STATE/DRAW effect: this instance stays active over its whole lifetime and
// owns its own timer. Each update() advances the clock; each render() draws
// one filled circle centered on the resolved origin + offset, painted with a
// canvas RADIAL GRADIENT that fades from the declared `color` at the center to
// fully transparent at the edge — the "soft" part of the soft radial glow.
// The gradient stops are pure functions of elapsed time and params (no
// randomness), so the rendering is fully deterministic and identical every
// run.
//
// Pulse model: the alpha oscillates deterministically at `pulseRate` Hz as
//   alpha(t) = opacity · intensity · (0.5 + 0.5·cos(2π·pulseRate·t))
// so t=0 starts at FULL peak (opacity · intensity) and the pulse is a pure
// function of elapsed time — no per-frame state, no Math.random. The radius
// ALSO breathes with the same cosine (radius · (1 + PULSE_AMPLITUDE/2 ·
// cos(2π·pulseRate·t))), swinging symmetrically between
// radius·(1 − PULSE_AMPLITUDE/2) and radius·(1 + PULSE_AMPLITUDE/2) around
// the declared radius (i.e. 21–35 px at the defaults), so the glow visibly
// throbs like a charged-attack halo. At pulseRate 0 the pulse is DISABLED:
// the alpha holds at its base value (opacity · intensity) and the radius
// holds at `radius` — a steady aura (the documented contract).
//
// Intensity vs opacity: `intensity` scales how FAR the pulse travels toward
// full brightness (default 1.0 = full swing between 0.5·opacity and opacity);
// `opacity` is the PEAK alpha the pulse reaches (clamped 0..1). Together they
// let configs dial both the brightness ceiling and the pulse depth
// independently (e.g. a dim steady charge: opacity 0.4, intensity 0.3 →
// alpha swings 0.14–0.4).
//
// Lifetime: `duration` is the WHOLE-instance lifetime and equals the total
// lifetime exactly — the instance completes when `elapsed >= duration - EPS`
// (fixed-dt epsilon convention). This is a discrete fire: it is spawned on a
// trigger (typically 'stateChange' when a boss enters a charged phase or the
// hero becomes invincible, or 'spawn' for a power-up pickup, per the
// effects.md trigger table) or fired manually / standalone in the theater
// (null carrier → params alone drive it). No fade-out tail: the glow holds
// its pulsing alpha right up to completion (an invincibility aura must stay
// legible for the whole window), then the engine prunes it.
//
// Origin & offset: if the carrier exposes origin(), its position wins over
// params.x/y (same block pattern as trail/afterimage/groundWave/shockwave/
// telegraphCircle/groundMarker/targetReticle/attackArc); params.x/y are the
// standalone/theater fallback used when the effect is fired with a null
// carrier. The glow center is the resolved origin SHIFTED by `offset`
// ({ x, y } px, default { 0, 0 }) — a non-zero offset lets a config place the
// glow off-center relative to the sprite (e.g. behind a moving projectile's
// tip) while still tracking the carrier. Carrier origin is tracked live each
// update (the glow follows a moving carrier); params.x/y is the standalone
// fallback for null-carrier fires. The fire-time resolved origin is kept as
// the initial value so a standalone/theater fire (null carrier) has nothing
// to track and holds its params.x/y origin for the whole lifetime.
//
// params: { radius?, opacity?, pulseRate?, intensity?, color?, duration?,
//           offset?, x?, y? }
//   radius       — glow radius in px (default 28): the distance from the
//                  center where the gradient reaches full transparency. The
//                  breathing pulse swings the drawn radius symmetrically
//                  between radius·(1 − PULSE_AMPLITUDE/2) and radius·(1 +
//                  PULSE_AMPLITUDE/2) (i.e. 21–35 px at the defaults).
//                  Non-negative; negative values clamp to 0 (degenerate:
//                  nothing visible, timer still runs).
//   opacity      — PEAK alpha 0..1, clamped (default 0.7): the brightest the
//                  glow gets at the center. The pulsing alpha oscillates
//                  between 0.5·opacity·intensity and opacity·intensity
//                  around this peak (see Pulse model above).
//   pulseRate    — pulse frequency in Hz (default 2): the glow throbs ~2
//                  times per second, starting at full peak at t=0. Any value
//                  >= 0 works verbatim; negative values fall back to the
//                  default. pulseRate 0 disables the pulse (constant peak
//                  alpha and constant radius — a steady aura).
//   intensity    — how far the pulse travels toward full brightness
//                  (default 1.0). Clamped to [0, 2]: 0 collapses the alpha
//                  to 0 throughout (invisible but the timer still runs —
//                  valid degenerate config), 1.0 gives the documented full
//                  swing, > 1 overshoots past the peak (a flaring,
//                  exaggerated glow whose alpha may exceed `opacity`).
//   color        — CSS color for the glow center (default '#9fd8ff', a cool
//                  blue-white tint that reads as energy/supernatural against
//                  dark backgrounds). Callers may pass any CSS color; the
//                  gradient interpolates from this color (at the pulsing
//                  alpha) at the center to the SAME color at alpha 0 at the
//                  edge. Alpha behavior is unaffected (gradient stops carry
//                  their own alphas).
//   duration     — whole-instance lifetime in seconds (default 1.0): the
//                  window the aura stays visible. Must be > 0; non-positive
//                  values fall back to the default. Total lifetime ==
//                  duration EXACTLY (the documented contract).
//   offset       — { x, y } px shift applied to the resolved origin
//                  (default { x: 0, y: 0 }): places the glow center off the
//                  carrier's origin (e.g. behind a projectile's tip). Both
//                  components default to 0 when absent/non-finite.
//   x, y         — standalone origin (fallback when no carrier origin()
//                  exists): the point the glow is centered on before the
//                  offset is applied (default { x: 0, y: 0 }).
//
// Geometry: at elapsed t the glow sits at
//   center(t) = origin(t) + offset     (origin re-resolved live each update)
//   r(t)      = radius · (1 + PULSE_AMPLITUDE/2·cos(2π·pulseRate·t))  [pulseRate > 0]
//               = radius                                       [pulseRate == 0]
//   alpha(t)  = opacity · intensity · (0.5 + 0.5·cos(2π·pulseRate·t))
// drawn as ONE filled circle of radius r(t) centered at center(t), with
// fillStyle = createRadialGradient(center, 0, center, r(t)) whose stops are
//   stop 0.0 : color at alpha(t)          (bright core)
//   stop 1.0 : color at alpha 0           (fully transparent edge)
// Drawn inside a save/restore bracket (recording-canvas friendly). Degenerate
// cases (radius ≤ 0 or effective alpha ≤ 0) draw nothing but the instance
// still runs its timer and completes at `duration`.
//
// Endpoint frame: the engine prunes the instance during updateEffects()
// before drawEffects() runs once done, so the final frame at the exact
// endpoint is not drawn. The glow's last visible frame shows it one step
// short of completion (at t = duration − dt). This is intentional: the aura
// ends exactly when its logical window ends.
//
// Renderer note: unlike the M6 sprite-state multiplier effects (fadeOut /
// scalePulse / squashStretch), this effect PAINTS its own geometry — it needs
// no renderer-side consumption hook. It rides the world-space camera pass
// (space: 'world') and is drawn by drawEffects() like any other draw effect.

const DEFAULT_RADIUS = 28;         // px — glow radius (gradient reaches alpha 0 here)
const DEFAULT_OPACITY = 0.7;       // peak alpha (brightness ceiling)
const DEFAULT_PULSE_RATE = 2;      // Hz — pulse frequency
const DEFAULT_INTENSITY = 1.0;     // full pulse swing toward the peak
const MIN_INTENSITY = 0.0;         // 0 → invisible throughout (degenerate but valid)
const MAX_INTENSITY = 2.0;         // 2 → overshoots twice as far past the peak
const DEFAULT_DURATION = 1.0;      // s  — whole-instance lifetime (== total lifetime)
const DEFAULT_COLOR = '#9fd8ff';   // cool blue-white energy tint
const PULSE_AMPLITUDE = 0.5;       // ±25% symmetric radius swing around the base radius
const TWO_PI = Math.PI * 2;        // one full sine period
const EPS = 1e-9;                  // fixed-dt epsilon convention

/**
 * @param {{radius?:number, opacity?:number, pulseRate?:number,
 *          intensity?:number, color?:string, duration?:number,
 *          offset?:{x:number,y:number}, x?:number, y?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function,
 *            done:boolean, space:string, elapsed:number, radius:number,
 *            origin:{x:number,y:number}}}
 */
export function auraGlow(params = {}, carrier = null) {
  const radius = Math.max(0, params.radius ?? DEFAULT_RADIUS);
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const pulseRate = params.pulseRate >= 0 ? params.pulseRate : DEFAULT_PULSE_RATE;
  const intensity = Math.min(MAX_INTENSITY, Math.max(MIN_INTENSITY, params.intensity ?? DEFAULT_INTENSITY));
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const color = params.color ?? DEFAULT_COLOR;
  const offset = {
    x: Number.isFinite(params.offset?.x) ? params.offset.x : 0,
    y: Number.isFinite(params.offset?.y) ? params.offset.y : 0,
  };
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };

  const api = {
    space: 'world', // the glow rides the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,
    /** Current (pulsing) glow radius (recomputed each update). */
    radius,
    /** Resolved origin (carrier origin() wins over params.x/y; re-resolved
     *  live each update so the glow follows a moving carrier). */
    origin: resolveOrigin(carrier, fallback),
    /** Center offset applied on top of the origin (params.offset). */
    offset,

    /**
     * Advance the clock. The glow radius is derived from elapsed time (not
     * integrated per step), so fixed-dt accumulation drift never leaks into
     * the geometry. With a live carrier the origin is re-resolved each frame
     * so the glow follows a moving carrier; with no carrier the fire-time
     * params.x/y origin is held (nothing to track). Completes exactly at
     * `elapsed >= duration - EPS`.
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      // Track the live carrier origin (if present) so the glow follows a
      // moving carrier — same block pattern as trail/afterimage.
      if (carrier && typeof carrier.origin === 'function') {
        const o = carrier.origin();
        if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) {
          this.origin = { x: o.x, y: o.y };
        }
      }
      const cos = Math.cos(TWO_PI * pulseRate * this.elapsed);
      // At pulseRate 0 the cosine is constant 1 → the radius holds at its
      // base value (documented contract: "pulseRate 0 disables the pulse").
      // The same guard applies in render() for the alpha.
      const rScale = pulseRate > EPS ? (1 + (PULSE_AMPLITUDE / 2) * cos) : 1;
      this.radius = radius * rScale;
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    /**
     * Draw the glow: one filled circle of the current radius at the origin +
     * offset, painted with a radial gradient from the pulsing-alpha color at
     * the center to transparent at the edge. No-op once done, or when the
     * degenerate geometry (radius ≤ 0 or effective alpha ≤ 0) leaves nothing
     * to draw.
     *
     * Endpoint frame note: the engine prunes the instance during
     * updateEffects() before drawEffects() runs, so the final frame at the
     * endpoint is intentionally NOT drawn — the aura ends exactly when its
     * logical window ends.
     * @param {object} c2d CanvasRenderingContext2D
     * @param {object} [renderCtx] unused (world-space effect)
     */
    render(c2d, renderCtx = {}) {
      if (this.done || radius <= EPS) return;
      const cos = Math.cos(TWO_PI * pulseRate * this.elapsed);
      // At pulseRate 0 the pulse is disabled: alpha holds at its base value
      // (opacity · intensity) and the radius holds at `radius` — a steady
      // aura. The same guard applies in update() for the radius.
      const wave = pulseRate > EPS ? (0.5 + 0.5 * cos) : 1;
      const alpha = opacity * intensity * wave;
      if (alpha <= EPS) return;
      const cx = this.origin.x + offset.x;
      const cy = this.origin.y + offset.y;
      const r = Math.max(this.radius, EPS);
      const grad = c2d.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, colorWithAlpha(color, alpha));
      grad.addColorStop(1, colorWithAlpha(color, 0));
      c2d.save();
      c2d.fillStyle = grad;
      c2d.beginPath();
      c2d.arc(cx, cy, r, 0, TWO_PI);
      c2d.fill();
      c2d.restore();
    },

    complete() { this.done = true; },
  };

  return api;
}

/**
 * Resolve the glow's base center point at fire time. Carrier origin() wins
 * (live entity / marker / box carrier); params.x/y are the standalone/theater
 * fallback for null-carrier fires. This value is the INITIAL origin only —
 * with a live carrier, update() re-resolves it each frame so the glow follows
 * the moving carrier; with no carrier it is held fixed for the lifetime.
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
 * Produce an rgba() string for a CSS color at the given alpha. Supports hex
 * (#rgb / #rrggbb) and rgb()/rgba() inputs; unknown formats fall back to the
 * raw color with globalAlpha-style behavior unavailable, so we emit an
 * rgba() with the parsed channels (or black if unparseable). Deterministic —
 * no randomness.
 * @param {string} color CSS color
 * @param {number} alpha 0..1
 * @returns {string}
 */
function colorWithAlpha(color, alpha) {
  const a = Math.min(1, Math.max(0, alpha));
  let r = 0, g = 0, b = 0;
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) h = [...h].map(c => c + c).join('');
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    } else {
      const m = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
      if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
    }
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
