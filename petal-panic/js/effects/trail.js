// Petal Panic — trail effect (effects.md §6, catalog #6). A fading visual
// ribbon/trail behind a moving entity for projectiles, missiles, dashes, and
// fast movement.
//
// STATE/DRAW effect: unlike one-shot bursts, this instance stays active over
// its whole lifetime. Each update() records the carrier's CURRENT position
// into a bounded buffer; each render() draws a tapered, per-segment fading
// ribbon along the recorded path. Because it reads the live carrier origin()
// every frame, it follows a moving entity — which is exactly what makes it
// work under continuous activation (the engine keeps one instance alive while
// the carrier satisfies the 'moving' condition and calls update() each frame).
// It also works as a discrete fire (spawned on a trigger) and standalone in
// the theater (null carrier → caller feeds positions via addPoint()).
//
// Lifetime vs. age fade (B1): `lifetime` is the PER-POINT survival window, not
// a hard whole-instance cutoff. Every recorded point carries the elapsed time
// at record (`t`). At render time a point's age = this.elapsed - t, and its
// alpha = opacity · clamp(1 - age/lifetime, 0, 1), so each segment fades out
// linearly over the lifetime and vanishes exactly when it is a full lifetime
// old. This makes the ribbon genuinely "fade over the declared lifetime" AND
// self-clean old points even if the instance stays alive. Width taper is kept
// POSITIONAL (head thick → tail thin) because that is about shape, not time.
//
// Continuous persistence vs. discrete termination (B2): a continuously-moving
// trail must persist while the carrier keeps moving rather than hard-stopping
// at `lifetime` (which would periodically wipe the ribbon). Mechanism: the
// instance completes at `elapsed >= lifetime` ONLY IF NO FRESH POINT was
// recorded WITHIN THE RECENCY WINDOW — i.e. the carrier has not actually moved
// recently. We track `lastPointT` (the elapsed time of the most recently
// recorded point) and check whether any point was recorded within the window
// since then.
//
// Why a recency window instead of "fresh THIS frame": trail records a point
// only when the carrier moves far enough past the recording gate, so a
// SLOW-but-moving carrier does NOT record a point every frame — its samples are
// spaced up to ~`density` px apart in distance, which at low speed can span
// several frames. Checking "fresh this frame" wrongly completed such a carrier
// on the exact lifetime-boundary frame that fell BETWEEN its point-samples.
// Looking back over the recency window fixes this: a genuinely-moving carrier
// keeps recording points within the window, so the "recently active" guard
// stays true and the instance NEVER force-completes on the elapsed clock; it
// simply keeps going, letting old points fade out via the age-based alpha and
// get evicted once fully faded.
//
// Recording trigger: update() adds a point whenever the carrier's origin is at
// least `minMove = max(density, MIN_SPEED·dt)` px from the last recorded point.
// A carrier moving at speed v ≥ MIN_SPEED therefore accumulates ≥ minMove px
// of travel every ⌈minMove / v⌉ frames and MUST record a new point within that
// many frames (the distance from the last point grows monotonically by v·dt per
// frame until it crosses the gate). The maximum expected gap between recordings
// for a still-moving carrier is thus ≤ density/MIN_SPEED seconds (at the slowest
// speed we treat as "moving", with default density 3 and MIN_SPEED 10 → 0.3 s,
// i.e. up to 18 frames at dt=1/60).
//
// Recency window = min(density / MIN_SPEED, lifetime): exactly that maximum
// expected inter-recording gap. A carrier whose per-frame motion exceeds
// MIN_SPEED·dt keeps recording within the window → persists past `lifetime`;
// a stopped carrier stops recording, its last point ages out of the window,
// and the instance terminates EXACTLY at `lifetime`. Capping at `lifetime`
// mirrors afterimage's B2 precondition for degenerate configs (window longer
// than the fade window would keep an instance alive even though all its points
// have already fully faded). Computed from the config constants so it holds
// for any fixed step size.
//
// It completes only when:
//   (a) the engine explicitly completes it (continuous condition stopped, or
//       resetEffects), OR
//   (b) `elapsed >= lifetime` with NO point recorded within the recency
//       window. Because the clock starts at fire and `lastPointT` is unset
//       before any point is recorded, a no-motion / no-carrier instance still
//       terminates EXACTLY at `lifetime`, preserving the discrete "done at
//       lifetime" contract; a carrier that stops moving also terminates once
//       the clock passes `lifetime` and its last point ages out of the window.
// This single rule satisfies BOTH the discrete fire (self-terminates at
// `lifetime` when quiet) AND continuous (persists while actually moving).
//
// params: { length?, width?, lifetime?, opacity?, density?, offset? }
//   length   — max ribbon REACH in px of ACCUMULATED PATH DISTANCE (default 40).
//              Oldest points are evicted until the total path length (sum of
//              segment lengths from oldest to newest) is <= `length`. This bounds
//              how far back the ribbon reaches regardless of step size.
//
// Gap / break rule (B6): the ribbon must never contain a SINGLE segment longer
// than `length`. If the distance from the last recorded point to a new point
// exceeds `length` (a teleport or a large jump/step), we do NOT draw a long
// connecting streak across the gap. Instead the ribbon BREAKS: every older
// point is dropped and the buffer restarts fresh from the new position, so no
// over-length segment is ever retained. Small steps still produce one
// continuous bounded ribbon (accumulated path <= `length`).
//   width    — ribbon thickness in px at the HEAD, tapering to ~1px at the tail
//              (default 4). Taper is linear along the recorded path (positional).
//   lifetime — per-point survival window in seconds (default 0.5). Governs the
//              age-fade window (B1) and the termination clock (B2); it is
//              NOT a hard whole-instance cutoff during continuous use.
//   opacity  — peak alpha 0..1, clamped (default 0.9). Applied to the freshest
//              segment; older segments scale down by their relative age.
//   density  — minimum spacing between recorded points, in px (default 3).
//              Higher density → more points per unit distance → a smoother but
//              denser ribbon. Points closer than `density` are dropped so the
//              buffer stores evenly-spaced samples rather than a burst of
//              near-duplicates when the carrier lingers.
//   offset   — perpendicular offset from the carrier centerline, in px
//              (default 0). Shifts the whole ribbon sideways (e.g. to hug one
//              edge of a wide sprite). Computed against the local travel
//              direction of each segment.
//
// Point model: each recorded point is { x, y, t } where t is elapsed seconds at
// record time. Segment i (between point i and i+1) is drawn with an alpha based
// on the AGE of its OLDER endpoint: alpha = opacity · clamp(1 - age_i/lifetime,
// 0, 1), where age_i = this.elapsed - points[i].t. So the head (newest segment,
// smallest age) is brightest and each segment fades out linearly, reaching zero
// exactly when its older endpoint is a full lifetime old. Width taper uses the
// segment's positional fraction (i / (n-2)) so the head is thickest and the tail
// thinnest. Deterministic — no randomness — which keeps draw order stable.

const DEFAULT_LENGTH = 40;    // px — max accumulated-path reach of the ribbon
const DEFAULT_WIDTH = 4;      // px — head thickness (tapers to ~1px at tail)
const DEFAULT_LIFETIME = 0.5; // s  — per-point survival window / termination clock
const DEFAULT_OPACITY = 0.9;  // peak alpha
const DEFAULT_DENSITY = 3;    // px — min spacing between recorded points
const DEFAULT_OFFSET = 0;     // px — perpendicular shift from centerline
const DEFAULT_SPEED = 200;    // px/s — synthetic carrier speed (standalone/theater)
const TRAIL_COLOR = '#ffffff';
const MIN_TAIL_WIDTH = 1;     // px — floor of the taper
const EPS = 1e-9;             // fixed-dt epsilon convention
// B2 recency window: how long ago a point may have been recorded while the
// carrier still counts as "recently active" (i.e. actually moving). A moving
// carrier records a point at least every `density` px of travel, so at the
// slowest speed we still treat as "moving" (MIN_SPEED px/s) the gap between
// consecutive recordings is <= density/MIN_SPEED seconds. The effective window
// is min(density / MIN_SPEED, lifetime), computed from the config constants so
// it holds for any fixed step size and stays bounded by the fade window.
const MIN_SPEED = 10;         // px/s — below this the carrier is not "moving"

/**
 * @param {{length?:number, width?:number, lifetime?:number, opacity?:number,
 *          density?:number, offset?:number, speed?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function, addPoint:Function,
 *            done:boolean, space:string, points:Array, elapsed:number}}
 */
export function trail(params = {}, carrier = null) {
  const length = Math.max(0, params.length ?? DEFAULT_LENGTH);
  const width = Math.max(0, params.width ?? DEFAULT_WIDTH);
  const lifetime = Math.max(EPS, params.lifetime ?? DEFAULT_LIFETIME);
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const density = Math.max(1e-6, params.density ?? DEFAULT_DENSITY);
  const offset = params.offset ?? DEFAULT_OFFSET;
  const speed = Math.max(0, params.speed ?? DEFAULT_SPEED); // px/s (standalone/theater)

  return {
    space: 'world', // trails ride the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,
    /** Recorded points, oldest first. Bounded by accumulated path length. */
    points: [],
    // Elapsed time of the most recently recorded point (B2 recency marker).
    // Set by addPoint() whenever a point is actually recorded; before any
    // point exists it stays -Infinity → NOT recently active, so a no-carrier /
    // no-motion instance still terminates exactly at `lifetime`.
    lastPointT: -Infinity,

    /**
     * Advance the clock and record the carrier's current position. Reads the
     * LIVE carrier origin() so the trail tracks a moving entity each frame.
     * With no carrier (standalone/theater) nothing is recorded here — the
     * caller feeds positions through addPoint(). Termination: at `elapsed >=
     * lifetime` the instance completes ONLY if NO point was recorded within
     * the recency window, so a live carrier that keeps MOVING keeps the ribbon
     * alive past `lifetime` (B2) while a stopped / no-carrier instance still
     * ends exactly at `lifetime`.
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      // Record the live carrier position (if present). A point is added when
      // the carrier has moved more than the `density` spacing gate OR more
      // than MIN_SPEED·dt since the last recorded point (velocity-aware), so a
      // slow-but-moving carrier still records every frame it moves while a
      // stationary one records nothing.
      if (carrier && typeof carrier.origin === 'function') {
        const o = carrier.origin();
        const last = this.points[this.points.length - 1];
        const minMove = Math.max(density, MIN_SPEED * dt);
        if (!last || Math.hypot(o.x - last.x, o.y - last.y) >= minMove - EPS) {
          this.addPoint(o.x, o.y);
        }
      }
      // Persistence vs. termination (B2): complete at the lifetime boundary
      // only when NO point was recorded within the recency window. "Fresh THIS
      // frame" is wrong because a slow-but-moving carrier records points only
      // every ~`density` px of travel, so its samples can be several frames
      // apart: on the exact lifetime-boundary frame that falls BETWEEN two
      // samples it would wrongly complete. Instead we look back over the
      // recency window = min(density / MIN_SPEED, lifetime) — the maximum
      // expected gap between recordings for a still-moving carrier (see
      // header). A moving carrier's lastPointT stays within the window →
      // persists past `lifetime`; a stopped / absent carrier stops recording,
      // its last point ages out of the window, and it terminates exactly at
      // `lifetime`.
      const recencyWindow = Math.min(density / MIN_SPEED, lifetime);
      const recentlyActive = Number.isFinite(this.lastPointT)
        && (this.elapsed - this.lastPointT) <= recencyWindow + EPS;
      if (!recentlyActive && this.elapsed >= lifetime - EPS) {
        this.done = true;
      }
    },

    /**
     * Public point-feeder (B5). Lets a caller drive the REAL recording/render
     * path without a carrier — used by the standalone theater demo. Honors the
     * same density gate + path-length eviction as carrier-driven recording.
     * @param {number} x
     * @param {number} y
     * @returns {boolean} true if a new point was actually recorded (false when
     *   dropped by the density gate or once done) — used for B2 persistence.
     */
    addPoint(x, y) {
      if (this.done) return false;
      const pts = this.points;
      const last = pts[pts.length - 1];
      // Density gate: drop near-duplicates so samples stay evenly spaced.
      if (last && Math.hypot(x - last.x, y - last.y) < density) return false;
      // Gap / break rule (B6): a single segment must never exceed `length`. If
      // the jump from the last recorded point to here is longer than `length`
      // (a teleport or large step), do NOT stretch a long streak across the
      // gap — break the ribbon and restart fresh from the new position. This
      // guarantees no over-length segment survives even when only one segment
      // would remain after path-length eviction.
      if (last && Math.hypot(x - last.x, y - last.y) > length + EPS) {
        pts.length = 0;
      }
      pts.push({ x, y, t: this.elapsed });
      // B2 recency marker: a point actually recorded marks the carrier as
      // recently active (it MOVED far enough to extend the ribbon). A stopped
      // carrier records nothing, so its lastPointT ages out of the window.
      this.lastPointT = this.elapsed;
      // Path-length bound (B4): evict oldest points until the accumulated path
      // length (oldest→newest) is <= `length`.
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      }
      while (total > length + EPS && pts.length > 2) {
        total -= Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        pts.shift();
      }
      return true;
    },

    /**
     * Draw the tapered, fading ribbon along the recorded path. No-op when
     * there are fewer than 2 points (nothing to connect) or once done.
     * @param {object} c2d CanvasRenderingContext2D
     */
    render(c2d) {
      if (this.done || this.points.length < 2 || width <= 0 || opacity <= EPS) return;
      c2d.save();
      c2d.lineCap = 'round';
      c2d.lineJoin = 'round';
      c2d.strokeStyle = TRAIL_COLOR;
      const n = this.points.length;
      // Guard the denominator so n===2 yields finite values instead of NaN
      // (B3): with 2 points the single segment sits at the head fraction.
      const denom = Math.max(1, n - 2);
      // Draw from the OLDEST segment to the newest so the bright head is
      // painted last (on top). Deterministic order — no randomness.
      for (let i = 0; i < n - 1; i++) {
        const a = this.points[i];
        const b = this.points[i + 1];
        // Skip degenerate (zero-length) segments.
        const dx = b.x - a.x, dy = b.y - a.y;
        const segLen = Math.hypot(dx, dy);
        if (segLen < 1e-6) continue;
        // Age-based fade (B1): the OLDER endpoint of each segment determines
        // its brightness. Its age relative to the lifetime gives a linear fade
        // that reaches zero exactly when that point is a full lifetime old.
        const age = this.elapsed - a.t;
        const alpha = opacity * Math.min(1, Math.max(0, 1 - age / lifetime));
        if (alpha <= EPS) continue;
        // Perpendicular offset from the segment's local travel direction.
        const nx = -dy / segLen, ny = dx / segLen;
        const ax = a.x + nx * offset, ay = a.y + ny * offset;
        const bx = b.x + nx * offset, by = b.y + ny * offset;
        // Positional taper: full width at the head, ~MIN_TAIL_WIDTH at the tail.
        const frac = i / denom; // 0 at tail … 1 at head
        const w = Math.max(MIN_TAIL_WIDTH, MIN_TAIL_WIDTH + (width - MIN_TAIL_WIDTH) * frac);
        c2d.globalAlpha = alpha;
        c2d.lineWidth = w;
        c2d.beginPath();
        c2d.moveTo(ax, ay);
        c2d.lineTo(bx, by);
        c2d.stroke();
      }
      c2d.restore();
    },

    complete() { this.done = true; },
  };
}
