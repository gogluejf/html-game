// Petal Panic — afterimage / ghost frames (effects.md §7, catalog #7).
// Temporary translucent copies of a moving sprite left behind its current
// position for dashes, supermoves, rapid boss movement, and exaggerated speed.
//
// STATE/DRAW effect: this instance stays active over its whole lifetime and
// owns its own timer. Each update() advances the clock and — when the spawn
// interval has elapsed — snapshots the carrier's CURRENT origin into a bounded
// ring buffer of at most `count` ghosts; each render() draws every surviving
// ghost as a fading rectangle at its recorded position. Because it reads the
// live carrier origin() at snapshot time, the ghosts trail a moving entity —
// exactly what makes it work under continuous activation (the engine keeps one
// instance alive while the carrier satisfies the 'fastMoving' condition and
// calls update() each frame). It also works as a discrete fire (spawned on a
// trigger) and standalone in the theater (null carrier → caller feeds
// positions via addGhost()).
//
// Lifetime vs. age fade (B1): `lifetime` is the PER-GHOST survival window, not
// a hard whole-instance cutoff. Every ghost carries the elapsed time at
// snapshot (`t`). At render time a ghost's age = this.elapsed - t, and its
// alpha = opacity · clamp(1 - age/lifetime, 0, 1), so each ghost fades out
// linearly over the lifetime and vanishes exactly when it is a full lifetime
// old. Ghosts are evicted from the buffer once fully faded, so a long-lived
// instance never accumulates stale entries.
//
// Continuous persistence vs. discrete termination (B2): a continuously-moving
// afterimage must persist while the carrier keeps moving rather than
// hard-stopping at `lifetime` (which would periodically wipe the ghosts).
// Mechanism (same rule as trail, task 5.1): the instance completes at
// `elapsed >= lifetime` ONLY IF the carrier is NOT RECENTLY ACTIVE — i.e. no
// ghost was recorded within the last recency window. The window equals the
// spawn interval (or one frame in per-frame mode), CAPPED at `lifetime`. This
// matters because the spawn cadence can be coarser than one frame (default
// 1/30 ≈ 2 frames at dt=1/60): checking "fresh THIS frame" would wrongly
// complete the instance on the exact lifetime-boundary frame that falls BETWEEN
// rolls, even though the carrier is actively leaving new ghosts every rollPeriod.
// Looking back over the full spawn interval fixes this: a moving carrier re-rolls
// every spawnInterval, so its last ghost is always < spawnInterval old → the
// "recently active" guard stays true and the instance NEVER force-completes on
// the elapsed clock; it simply keeps going, letting old ghosts fade out via the
// age-based alpha and get evicted once fully faded. A STOPPED / absent carrier
// stops rolling entirely, so its last ghost ages out of the window within one
// roll period and the instance terminates EXACTLY at `lifetime`. It completes
// only when:
//   (a) the engine explicitly completes it (continuous condition stopped, or
//       resetEffects), OR
//   (b) `elapsed >= lifetime` with NO ghost recorded within the recency
//       window. Because the clock starts at fire and the recency marker is
//       unset before any ghost is recorded, a no-motion / no-carrier instance
//       still terminates EXACTLY at `lifetime`, preserving the discrete "done
//       at lifetime" contract; a carrier that stops moving also terminates
//       once the clock passes `lifetime` and its last ghost ages out of the
//       window.
// PRECONDITION for continuous persistence: `spawnInterval <= lifetime`. When
// the interval exceeds the lifetime, each ghost fully fades before the next
// snapshot (at most ~1 ghost is ever visible — a degenerate config with no real
// trail), so the cap means such an instance is not treated as "actively leaving
// new ghosts" relative to the fade window and terminates at `lifetime` even if
// the carrier moves. Sensible afterimages use `spawnInterval <= lifetime`.
// This single rule satisfies BOTH the discrete fire (self-terminates at
// `lifetime` when quiet) AND continuous (persists while moving, given the
// precondition above).
//
// params: { count?, spawnInterval?, lifetime?, opacity?, fadeRate?, offset?, color? }
//   count         — max number of ghost frames held at once (default 4). Older
//                  ghosts beyond `count` are dropped immediately (ring-buffer
//                  eviction), independent of their age.
//   spawnInterval — seconds between ghost snapshots (default 1/30 ≈ 2 frames).
//                  0 = per-frame mode: a fresh snapshot on EVERY update(). Any
//                  positive value works verbatim (no clamping); the first
//                  snapshot happens on the SECOND update() after fire (so it
//                  captures the carrier's post-first-move position), and the
//                  previous position is HELD between rolls (the lastRoll clock
//                  pattern shared with cameraShake's frequency param). With no
//                  live carrier update() still self-ticks on this cadence,
//                  dropping a ghost at its held last-known position each roll —
//                  but that self-tick does NOT count as the carrier being
//                  active for B2 (a held position is not new motion), so a
//                  no-carrier instance stays quiet and terminates exactly at
//                  `lifetime`. For continuous persistence keep this <= lifetime
//                  (see the B2 precondition in the header).
//   lifetime      — per-ghost survival window in seconds (default 0.3).
//                  Governs the age-fade window (B1) and the termination clock
//                  (B2); it is NOT a hard whole-instance cutoff during
//                  continuous use.
//   opacity       — peak alpha 0..1, clamped (default 0.5). Applied to the
//                  freshest ghost; older ghosts scale down by their relative
//                  age.
//   fadeRate      — fade exponent: alpha = opacity · clamp(1 - age/lifetime,
//                  0, 1)^fadeRate (default 1 = linear fade). Higher values
//                  keep ghosts bright longer then drop them faster; lower
//                  values dim them sooner.
//   offset        — perpendicular offset from the carrier centerline, in px
//                  (default 0). Shifts every ghost sideways relative to the
//                  carrier's facing direction (e.g. to hug one edge of a wide
//                  sprite). Computed against carrier.facing() when available,
//                  else +x.
//   color         — fillStyle for the ghost rectangles (default '#cfe8ff', a
//                  soft light tint so translucent copies read as tinted COPIES
//                  of the sprite rather than blank white boxes; §7 "translucent
//                  copies of a moving sprite"). Callers may pass any CSS color.
//                  Alpha/fade behavior is unaffected (per-ghost globalAlpha).
//
// Geometry: a ghost is drawn as a filled rectangle centered on its recorded
// position, sized by the carrier's size() ({ w, h }) read at DRAW time when
// available, falling back to factory-time params.box { x, y, w, h } for
// carriers without geometry accessors (tests, theater demos with a null
// carrier). No default box: absent or non-positive w/h → render() is a no-op
// (same policy as spriteFlash). Deterministic — no randomness — which keeps
// draw order stable (oldest ghost first, freshest last on top).

const DEFAULT_COUNT = 4;          // max ghost frames held
const DEFAULT_SPAWN_INTERVAL = 1 / 30; // s — ~2 frames between snapshots
const DEFAULT_LIFETIME = 0.3;     // s  — per-ghost survival window / termination clock
const DEFAULT_OPACITY = 0.5;      // peak alpha
const DEFAULT_FADE_RATE = 1;      // fade exponent (1 = linear)
const DEFAULT_OFFSET = 0;         // px — perpendicular shift from centerline
const DEFAULT_COLOR = '#cfe8ff';  // soft light tint — translucent copies of the sprite (§7)
const EPS = 1e-9;                 // fixed-dt epsilon convention
// B2 recency window: how long ago a ghost may have been recorded while the
// carrier still counts as "recently active". It equals the SPAWN INTERVAL (or
// one frame in per-frame mode), NOT a fixed one frame. Rationale: a moving
// carrier re-rolls exactly every `rollPeriod`, so the gap since its last ghost
// is always < rollPeriod; using rollPeriod as the window means a moving carrier
// is ALWAYS recently active (persists past `lifetime`) at ANY interval, while a
// STOPPED / no-carrier carrier stops rolling entirely, so its last ghost ages
// out of the window within one roll period and the instance terminates exactly
// at `lifetime`. A fixed one-frame window was wrong: at intervals coarser than
// ~2 frames the lifetime boundary could fall more than one frame after the last
// roll, wrongly terminating a still-moving carrier. Computed from rollPeriod in
// update() (per-frame mode → one frame) so it holds for any fixed step size.
const DEFAULT_LAST_POS = { x: 0, y: 0 }; // held position when no live carrier

/**
 * @param {{count?:number, spawnInterval?:number, lifetime?:number,
 *          opacity?:number, fadeRate?:number, offset?:number, color?:string,
 *          box?:{x:number,y:number,w:number,h:number}}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, complete:Function, addGhost:Function,
 *            done:boolean, space:string, ghosts:Array, elapsed:number}}
 */
export function afterimage(params = {}, carrier = null) {
  const count = Math.max(0, Math.round(params.count ?? DEFAULT_COUNT));
  const spawnInterval = Math.max(0, params.spawnInterval ?? DEFAULT_SPAWN_INTERVAL);
  const lifetime = Math.max(EPS, params.lifetime ?? DEFAULT_LIFETIME);
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const fadeRate = Math.max(0, params.fadeRate ?? DEFAULT_FADE_RATE);
  const offset = params.offset ?? DEFAULT_OFFSET;
  const color = params.color ?? DEFAULT_COLOR;
  const rollPeriod = spawnInterval; // 0 → per-frame mode (roll every update)

  /**
   * Record a ghost at (x, y). Shared by the carrier-driven roll in update()
   * and the public addGhost() feeder. When `countsAsActive` is true (a live
   * carrier roll or an explicit feed) the B2 recency marker (lastGhostT) is
   * refreshed, marking the carrier as recently active; when false (a no-
   * carrier self-tick at the held position) the ghost is still recorded for
   * rendering/cadence but does NOT count as new motion, so a no-carrier
   * instance stays quiet and terminates exactly at `lifetime`.
   * @param {number} x
   * @param {number} y
   * @param {boolean} countsAsActive
   * @returns {boolean} true if a new ghost was actually recorded (false once
   *   done).
   */
  function recordGhost(x, y, countsAsActive) {
    const body = api;
    if (body.done) return false;
    // Refresh the held position so a no-carrier instance re-rolls at the most
    // recent fed/recorded point.
    body.lastPos.x = x;
    body.lastPos.y = y;
    const g = body.ghosts;
    g.push({ x, y, t: body.elapsed });
    // B2 recency marker: only genuine activity (carrier roll / explicit feed)
    // refreshes it — a self-tick at a held position does not.
    if (countsAsActive) body.lastGhostT = body.elapsed;
    // Ring-buffer bound: drop the oldest ghost beyond `count`.
    while (g.length > count) g.shift();
    // Age eviction: drop fully-faded ghosts (age >= lifetime).
    while (g.length > 0 && body.elapsed - g[0].t >= lifetime - EPS) g.shift();
    return true;
  }

  const api = {
    space: 'world', // ghosts ride the world-space camera pass (two-pass model)
    done: false,
    elapsed: 0,
    /** Recorded ghosts, oldest first. Bounded by `count`. */
    ghosts: [],
    // Held position for no-carrier (standalone/theater) rolls; a live carrier
    // overrides this with its origin() on every roll.
    lastPos: { x: DEFAULT_LAST_POS.x, y: DEFAULT_LAST_POS.y },
    // Start unrolled so the FIRST update() always snapshots; afterwards a roll
    // happens once `rollPeriod` has elapsed since the previous roll (hold-
    // between-rolls). Per-frame mode (rollPeriod 0) re-rolls every update().
    lastRoll: -Infinity,
    // Elapsed time of the most recent ghost actually recorded (set by
    // addGhost). Drives the B2 "recently active" check. Before any ghost is
    // recorded it stays -Infinity → NOT recently active, so a no-carrier /
    // no-motion instance still terminates exactly at `lifetime`.
    lastGhostT: -Infinity,

    /**
     * Advance the clock and snapshot the position when the spawn interval has
     * elapsed. With a live carrier this reads its CURRENT origin() so ghosts
     * track a moving entity each frame; with no carrier it snapshots the held
     * last-known position (self-ticking standalone/theater path). Termination:
     * at `elapsed >= lifetime` the instance completes ONLY if the carrier is
     * NOT recently active — i.e. no ghost was recorded within the recency
     * window (the spawn interval, capped at `lifetime`; one frame in per-frame
     * mode) — so a live carrier keeps the ghosts alive while it
     * moves (B2) even when the lifetime boundary falls BETWEEN rolls, while a
     * stopped / no-carrier instance still ends exactly at `lifetime`.
     */
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      // Snapshot when the interval has elapsed. Per-frame mode (rollPeriod 0)
      // re-rolls every update(); interval mode holds between rolls. The first
      // roll happens on the FIRST update() (lastRoll starts unrolled). A live
      // carrier's origin() wins and — via recordGhost — refreshes the held
      // lastPos AND the B2 recency marker (lastGhostT), so each later roll
      // captures the most recent position; with no carrier the held lastPos is
      // recorded (self-tick) so standalone/theater instances still tick on
      // cadence, BUT that self-tick does NOT count as the carrier being active
      // for B2 (a held position is not new motion), so it leaves lastGhostT
      // untouched and a no-carrier instance still terminates exactly at
      // `lifetime`.
      if (this.elapsed - this.lastRoll >= rollPeriod - EPS) {
        this.lastRoll = this.elapsed;
        const hasCarrier = !!(carrier && typeof carrier.origin === 'function');
        const o = hasCarrier ? carrier.origin() : this.lastPos;
        recordGhost(o.x, o.y, hasCarrier);
      }
      // Persistence vs. termination (B2): complete at the lifetime boundary
      // only when the carrier is NOT actively leaving new ghosts RECENTLY.
      // "Fresh THIS frame" is wrong because the spawn cadence can be coarser
      // than one frame: on the exact lifetime-boundary frame that falls BETWEEN
      // rolls a moving carrier would wrongly complete. Instead we look back over
      // the recency window. The window equals the SPAWN INTERVAL — a moving
      // carrier re-rolls every rollPeriod, so its last ghost is always <
      // rollPeriod old and stays recently active (persists past `lifetime` at
      // ANY interval) — but it is CAPPED at `lifetime`: a carrier whose ghosts
      // fade out before it next re-rolls is not meaningfully "leaving new
      // ghosts" relative to the fade window, so it must still terminate.
      // Per-frame mode (rollPeriod 0) uses a one-frame window: it records every
      // update, so the gap is always ≤ one frame → always active while update()
      // runs. A stopped / absent carrier stops refreshing the marker, so its
      // last ghost ages out of the window and it terminates exactly at
      // `lifetime`.
      const recencyWindow = Math.min(rollPeriod > 0 ? rollPeriod : dt, lifetime);
      const recentlyActive = Number.isFinite(this.lastGhostT)
        && (this.elapsed - this.lastGhostT) <= recencyWindow + EPS;
      if (!recentlyActive && this.elapsed >= lifetime - EPS) {
        this.done = true;
      }
    },

    /**
     * Public ghost-feeder. Lets a caller drive the REAL recording/render path
     * without a carrier — used by the standalone theater demo. Honors the same
     * count bound + age eviction as carrier-driven recording. An explicit feed
     * counts as the carrier being active for B2 (it refreshes lastGhostT), so
     * a fed instance persists while feeding and self-terminates once feeding
     * stops and the clock passes `lifetime`.
     * @param {number} x
     * @param {number} y
     * @returns {boolean} true if a new ghost was actually recorded (false once
     *   done) — used for B2 persistence.
     */
    addGhost(x, y) {
      return recordGhost(x, y, true);
    },

    /**
     * Draw every surviving ghost as a fading filled rectangle at its recorded
     * position. No-op once done, when there are no ghosts, or when no
     * resolvable geometry exists.
     * @param {object} c2d CanvasRenderingContext2D
     * @param {object} [renderCtx] unused (world-space effect)
     */
    render(c2d, renderCtx = {}) {
      if (this.done || this.ghosts.length === 0 || opacity <= EPS) return;
      const box = resolveBox(carrier, params.box);
      if (!box) return;
      const face = (carrier && typeof carrier.facing === 'function') ? carrier.facing() : { x: 1, y: 0 };
      // Perpendicular to the facing direction (+90° rotation).
      const nx = -face.y, ny = face.x;
      c2d.save();
      c2d.fillStyle = color;
      // Draw oldest → newest so the freshest ghost paints last (on top).
      // Deterministic order — no randomness.
      for (const ghost of this.ghosts) {
        const age = this.elapsed - ghost.t;
        const frac = Math.min(1, Math.max(0, 1 - age / lifetime));
        const alpha = opacity * Math.pow(frac, fadeRate);
        if (alpha <= EPS) continue;
        const gx = ghost.x + nx * offset;
        const gy = ghost.y + ny * offset;
        c2d.globalAlpha = alpha;
        c2d.fillRect(gx - box.w / 2, gy - box.h / 2, box.w, box.h);
      }
      c2d.restore();
    },

    complete() { this.done = true; },
  };

  return api;
}

/**
 * Resolve the ghost rectangle size at draw time. Preference order:
 * carrier.size() → factory-time params.box. Read at draw time (not fire time)
 * so the ghosts track a resizing sprite.
 * @returns {{w:number, h:number}|null}
 */
function resolveBox(carrier, fallbackBox) {
  if (carrier && typeof carrier.size === 'function') {
    const s = carrier.size();
    if (s && s.w > 0 && s.h > 0) return { w: s.w, h: s.h };
  }
  if (fallbackBox && fallbackBox.w > 0 && fallbackBox.h > 0) return fallbackBox;
  return null;
}
