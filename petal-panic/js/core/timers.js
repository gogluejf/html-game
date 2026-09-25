// Petal Panic — unified labeled TTL engine (design §3 extension).
//
// Replaces the scattered ad-hoc timers (ttl, invincibleTimer, rapidTimer,
// fuseTimer, deathTimer, ...) with ONE per-entity set of NAMED timers that can
// all run at once. Each timer has a total duration + remaining time and is
// advanced together by a single tick(dt) call.
//
// Why: an object legitimately carries many concurrent countdowns (a hero can be
// recovering from a hit AND invincible AND rapid-firing at the same time; a bomb
// has a fuse while also having a life). A single scalar `ttl` can't express that.
// The debug overlay renders every active timer as a tiny labeled bar, stacked,
// so the developer sees exactly what's counting down on each entity.
//
// This module is pure (no DOM/canvas) so it stays unit-testable in node.

/** Short label → color map for the debug bars. Unknown labels fall back to gray. */
export const TIMER_COLORS = {
  life:       '#95a5a6', // generic expiry (coin/projectile)
  fuse:       '#e67e22', // bomb / barrel detonation countdown
  death:      '#e74c3c', // enemy death shrink/fade before despawn
  rec:        '#f1c40f', // hero hit-stun / recovery (control locked)
  intangible: '#00e5ff', // hero intangible (no damage taken) — BLUE
  rapid:      '#9b59b6', // rapid-fire powerup window
  special:    '#1abc9c', // special-attack cooldown (saw/bomb)
};

/** Fallback color for any label not in TIMER_COLORS. */
export const TIMER_COLOR_DEFAULT = '#7f8c8d';

/**
 * A set of named, concurrently-running countdown timers on one entity.
 *
 * Usage:
 *   this.timers = new Timers();
 *   this.timers.set('intangible', 0.6); // start/refresh a timer
 *   this.timers.tick(dt);             // advance all (call once per frame)
 *   if (this.timers.get('intangible') > 0) // still active?
 *   const f = this.timers.fraction('fuse'); // 0..1 for bars
 *   if (this.timers.expired('fuse'))  // true on the exact frame it hits 0
 */
export class Timers {
  constructor() {
    /** @type {Map<string, {total:number, remaining:number}>} */
    this.map = new Map();
  }

  /**
   * Start or refresh a named timer. Setting a value >= 0 (re)starts it; setting
   * <= 0 clears it. Returns this for chaining.
   * @param {string} name timer label
   * @param {number} seconds total duration
   */
  set(name, seconds) {
    if (seconds == null || seconds <= 0) {
      this.map.delete(name);
      return this;
    }
    this.map.set(name, { total: seconds, remaining: seconds });
    return this;
  }

  /**
   * Advance every active timer by dt seconds. Expired timers are removed and
   * recorded so expired() can edge-trigger on the frame they cross zero.
   * @param {number} dt seconds
   */
  tick(dt) {
    if (dt <= 0) return;
    this._justExpired = new Set();
    for (const [name, t] of this.map) {
      t.remaining -= dt;
      if (t.remaining <= 0) {
        this.map.delete(name);
        this._justExpired.add(name);
      }
    }
  }

  /**
   * Remaining seconds for a timer, or 0 if absent/expired.
   * @param {string} name
   * @returns {number}
   */
  get(name) {
    const t = this.map.get(name);
    return t ? Math.max(0, t.remaining) : 0;
  }

  /** True when the timer is currently active (remaining > 0). */
  has(name) {
    return this.map.has(name);
  }

  /**
   * Fraction of life remaining (1 = just started, 0 = expired/absent).
   * For progress bars. Absent timers read as 1 (nothing to show, no bar).
   * @param {string} name
   * @returns {number}
   */
  fraction(name) {
    const t = this.map.get(name);
    if (!t || t.total <= 0) return 1;
    return Math.max(0, Math.min(1, t.remaining / t.total));
  }

  /**
   * Edge-triggered expiry check: returns true ONCE on the frame the timer
   * crosses zero, then false afterward (the timer is removed on tick). Call
   * AFTER tick(dt) in the same frame. Useful for "explode now" logic.
   * @param {string} name
   * @returns {boolean}
   */
  expired(name) {
    return this._justExpired ? this._justExpired.has(name) : false;
  }

  /**
   * List of currently-active timers for the debug overlay, ordered by name for
   * stable stacking. Each entry: { name, frac, remaining }.
   * @returns {{name:string, frac:number, remaining:number}[]}
   */
  active() {
    const out = [];
    for (const [name, t] of this.map) {
      out.push({ name, frac: Math.max(0, Math.min(1, t.remaining / t.total)), remaining: t.remaining });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  /** Remove a specific timer. */
  clear(name) {
    this.map.delete(name);
  }

  /** Remove all timers. */
  clearAll() {
    this.map.clear();
  }

  /** Number of active timers. */
  get count() {
    return this.map.size;
  }
}
