// Petal Panic — Coins (design §10 "Object", §14 "Coins").
//
// A Coin is a small physical pickup that falls under gravity scaled by its
// per-type weight, bounces off the floor / platforms, and settles after a few
// hops. The hero collects it on touch (HERO × COIN → 'collect' rule).
//
// Per-type weight drives both fall speed AND bounce feel: gold (heavier)
// plummets and stops bouncing sooner; bronze (lighter) arcs higher and lingers
// longer on the ground. This is a named design requirement (§14), so the
// physics is intentionally visible.
//
// Coins are pooled (see CoinPool below): sustained combat never allocates.
// The pool caps live coins at MAX_COINS; when a burst would exceed the cap the
// oldest live coin is recycled (auto-collected without credit) so the newest
// coins always get their chance to be picked up.

import { Entity } from './entity.js';
import { LAYER, GRAVITY, MAX_FALL_SPEED, COIN_TTL, TTL_SPEED } from './consts.js';

// --- Tunables ----------------------------------------------------------------
export const MAX_COINS = 30;                 // hard cap on live coins (§17 perf param)
const BOUNCE_RESTITUTION = 0.4;              // vy multiplier retained per bounce
const BOUNCE_FRICTION = 0.8;                 // vx decay per bounce (rolling friction)
const SETTLE_VY_THRESHOLD = 20;              // |vy| below this → stop bouncing
const ROLL_DECEL = 6;                        // px/s² horizontal decay while rolling on ground
const SPIN_RATE = 4;                         // radians/sec visual spin

/**
 * Coin type definitions (design §14). Values differ by score; weights differ
 * by fall/bounce behavior (bronze < silver < gold).
 */
export const COIN_TYPES = Object.freeze({
  bronze: { value: 10, weight: 0.8, color: '#cd7f32', size: 10 },
  silver: { value: 25, weight: 1.0, color: '#c0c0c0', size: 12 },
  gold:   { value: 50, weight: 1.3, color: '#ffd700', size: 14 },
});

/**
 * Probability table for a single coin's type. Used by rollCoinType() and
 * dropCoins(). Can be overridden per-entity via coinDrop.types weights.
 */
const DEFAULT_TYPE_WEIGHTS = { bronze: 0.7, silver: 0.25, gold: 0.05 };

/**
 * Roll a random coin type from weighted probabilities.
 * @param {object} [weights] optional override, e.g. { bronze: 1 } or { bronze: 0.8, silver: 0.2 }
 * @returns {'bronze'|'silver'|'gold'}
 */
export function rollCoinType(weights) {
  const w = weights ?? DEFAULT_TYPE_WEIGHTS;
  let r = Math.random();
  for (const [type, weight] of Object.entries(w)) {
    if (r < weight) return type;
    r -= weight;
  }
  // Fallback: return the first key (shouldn't happen if weights sum to ~1)
  return Object.keys(w)[0];
}

// ---------------------------------------------------------------------------
// Coin entity
// ---------------------------------------------------------------------------

export class Coin extends Entity {
  /**
   * @param {'bronze'|'silver'|'gold'} type coin type key (drives value/weight/color/size)
   * @param {number} x spawn x (top-left of box)
   * @param {number} y spawn y (top-left of box)
   */
  constructor(type, x = 0, y = 0) {
    const def = COIN_TYPES[type];
    super({
      x, y,
      w: def.size, h: def.size,
      layer: LAYER.COIN,
      debugColor: def.color,
      gravity: 1,
    });

    this.coinType = type;
    this.value = def.value;
    this.weight = def.weight;               // scales gravity (heavier = faster fall)
    this.bounceRestitution = BOUNCE_RESTITUTION;
    this.collected = false;                 // latched on collect (prevents double-credit)
    this.spinAngle = 0;                     // visual spin (radians)
    this.settled = false;                   // true once velocity has damped out
    // TTL: coins fade out after COIN_TTL seconds if not collected. setLife()
    // registers the 'life' timer on the unified engine (see Entity).
    this.setLife(COIN_TTL);
    this.ttlSpeed = 1; // reads global TTL_SPEED each frame via tickTtl override below
  }

  /**
   * Integrate one step. Gravity is scaled by this.weight so heavier coins
   * visibly fall faster than lighter ones (acceptance #1). Terminal velocity
   * clamps the fall; horizontal air drag keeps rolls from drifting forever.
   *
   * @param {number} dt seconds
   */
  update(dt) {
    if (this.collected) return;

    // TTL countdown — coin fades out after its lifetime expires.
    this.tickTtl(dt * TTL_SPEED);
    if (!this.alive) return;

    // Gravity scaled by per-type weight.
    this.vy += GRAVITY * this.weight * dt;
    if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;

    // Mild horizontal air drag so airborne coins don't drift across the level.
    this.vx *= AIR_DRAG_PER_STEP;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Visual spin (render reads this; doesn't affect physics).
    this.spinAngle += SPIN_RATE * dt;

    // Rolling friction on the ground: once settled, decay vx toward rest.
    if (this.settled && this.vy === 0) {
      const decel = ROLL_DECEL * dt;
      if (Math.abs(this.vx) <= decel) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * decel;
    }
  }

  /**
   * Bounce against a horizontal surface (floor or platform top). Called by the
   * caller (CoinPool.updateAll) after integration when the coin's bottom edge
   * has crossed `surfaceY` while moving downward.
   *
   * Restitution + friction make the bounce feel physical; below a tiny vy the
   * coin settles (stops bouncing) instead of micro-bouncing forever.
   *
   * @param {number} surfaceY y-coordinate of the surface top (e.g. floor top)
   */
  bounce(surfaceY) {
    const bottom = this.y + this.h;
    if (bottom >= surfaceY && this.vy > 0) {
      this.y = surfaceY - this.h;
      this.vy *= -this.bounceRestitution;
      this.vx *= BOUNCE_FRICTION;
      // Settle: if the rebound is tiny, rest on the surface.
      if (Math.abs(this.vy) < SETTLE_VY_THRESHOLD) {
        this.vy = 0;
        this.settled = true;
      }
    }
  }

  /**
   * Mark this coin as collected. Latches so the collision handler can't credit
   * twice if the pair still overlaps next frame.
   */
  collect() {
    if (this.collected) return;
    this.collected = true;
    this.alive = false;
  }

  /**
   * Draw the coin. Uses the per-type color + a simple elliptical squash driven
   * by spinAngle to fake a spinning disc. Falls back to a filled circle when
   * the canvas is too small for detail.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!this.alive || this.collected) return;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const r = this.w / 2;
    // Horizontal squash factor from spin (cos oscillates between -1..1).
    const squash = Math.max(0.15, Math.abs(Math.cos(this.spinAngle)));
    const def = COIN_TYPES[this.coinType];

    ctx.save();
    // Fade out during the last 25% of TTL so the player sees coins expiring.
    if (this.maxTtl > 0) {
      const frac = this.ttlFrac;
      if (frac < 0.25) ctx.globalAlpha = frac / 0.25;
    }
    ctx.translate(cx, cy);
    ctx.scale(squash, 1);
    // Body.
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // Rim highlight (only when wide enough to show).
    if (squash > 0.5) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// Air drag per fixed step (60 Hz). Equivalent to ~0.995^60 ≈ 0.74/s decay —
// gentle enough that bursts scatter but strong enough that coins don't drift
// across the whole level while airborne.
const AIR_DRAG_PER_STEP = 0.995;

// ---------------------------------------------------------------------------
// CoinPool — pooled spawner with mixed-type bursts
// ---------------------------------------------------------------------------

/**
 * Pooled coin system. dropCoins() spawns a burst from a unified config
 * (used by both enemies and game objects). When the pool is exhausted, the
 * OLDEST live coin is recycled (its slot is reused for the new coin) so bursts
 * never silently fail. Recycled coins are NOT credited to the hero — they just
 * vanish, which matches the "oldest get auto-collected or removed" rule.
 */
export class CoinPool {
  /**
   * @param {number} [size=MAX_COINS] pool capacity
   */
  constructor(size = MAX_COINS) {
    this.items = [];
    this.active = [];          // insertion order == age order (oldest first)
    this._spawnCounter = 0;    // monotonic; used to recycle the oldest on overflow
    for (let i = 0; i < size; i++) {
      const c = new Coin('bronze', 0, 0);
      c.alive = false;
      this.items.push(c);
    }
  }

  /**
   * Spawn a single coin of the given type at (cx, cy) with an optional
   * directed initial velocity. Returns the live Coin, or null if no slot was
   * available AND recycling was disabled (defensive; recycling is default-on).
   *
   * @param {'bronze'|'silver'|'gold'} type
   * @param {number} cx center x
   * @param {number} cy center y
   * @param {{vx?:number, vy?:number}} [vel] initial velocity override
   * @returns {Coin|null}
   */
  spawnOne(type, cx, cy, vel = {}) {
    const def = COIN_TYPES[type];
    const half = def.size / 2;
    let slot = this._acquireSlot();
    if (!slot) return null;
    // Re-initialize the slot as a fresh Coin of the requested type.
    Object.assign(slot, new Coin(type, cx - half, cy - half));
    slot.vx = vel.vx ?? (Math.random() - 0.5) * 120;
    slot.vy = vel.vy ?? (-150 - Math.random() * 100); // pop upward by default
    slot.alive = true;
    slot.collected = false;
    slot.settled = false;
    slot.spinAngle = Math.random() * Math.PI * 2;
    this.active.push(slot);
    return slot;
  }

  /**
   * Spawn a coin burst from a unified coinDrop config.
   * Config shape: { min, max, chance, types?: { bronze, silver, gold } }
   *   - min/max: range of coin count to spawn
   *   - chance: 0..1 probability the drop happens at all (1 = always)
   *   - types: optional weight override per coin type (defaults to 70/25/5)
   *
   * Used by BOTH enemies and game objects (barrels). One code path.
   *
   * @param {{min:number, max:number, chance:number, types?:object}} cfg
   * @param {number} cx center x
   * @param {number} cy center y
   * @returns {number} number spawned (0 if the chance roll failed)
   */
  dropCoins(cfg, cx, cy) {
    if (!cfg) return 0;
    if (Math.random() > cfg.chance) return 0;
    const n = cfg.min + Math.floor(Math.random() * (cfg.max - cfg.min + 1));
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      const type = rollCoinType(cfg.types);
      const c = this.spawnOne(type, cx, cy);
      if (c) spawned++;
    }
    return spawned;
  }

  /**
   * Advance all active coins; bounce them off the floor line and any platform
   * tops passed in; cull off-screen coins.
   *
   * @param {number} dt seconds
   * @param {number} floorTop y of the level floor surface
   * @param {number} [levelLength=Infinity] right bound for culling
   * @param {Array<{x:number,y:number,w:number,h:number}>} [platforms=[]]
   *        additional solid AABBs whose TOP face coins can bounce off (the
   *        caller passes the level's SOLIDS minus the floor itself).
   */
  updateAll(dt, floorTop = 500, levelLength = Infinity, platforms = []) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      c.update(dt);

      // Floor bounce.
      c.bounce(floorTop);

      // Platform-top bounces: only when falling onto the top face (not when
      // hitting a side/bottom — those are handled by the collision world if a
      // COIN×SOLID resolve rule is added later; for v1 we just check the top).
      for (const p of platforms) {
        const bottom = c.y + c.h;
        const prevBottom = bottom - c.vy * dt;
        // Was above the platform last frame and now crossing its top?
        if (prevBottom <= p.y + 2 && bottom >= p.y && c.vy > 0) {
          // Horizontal overlap required.
          if (c.x + c.w > p.x && c.x < p.x + p.w) {
            c.bounce(p.y);
            break; // one surface per frame is enough
          }
        }
      }

      // Cull off-screen (fell past the level, walked off the right edge) or TTL expired.
      if (!c.alive || c.x + c.w < 0 || c.x > levelLength || c.y > floorTop + 80) {
        c.alive = false;
        this.active.splice(i, 1);
      }
    }
  }

  /**
   * Remove a coin from the pool (after collection or off-screen cull).
   * @param {Coin} c
   */
  remove(c) {
    const idx = this.active.indexOf(c);
    if (idx !== -1) {
      c.alive = false;
      this.active.splice(idx, 1);
    }
  }

  /**
   * Acquire a free slot; if none, recycle the OLDEST live coin (index 0 of
   * this.active, since insertion order == age order). Recycled coins lose
   * their pending credit — the caller (collection handler) has already run,
   * so this only happens for uncollected overflow.
   * @returns {Coin|null} a slot to reinitialize, or null if the pool is empty
   */
  _acquireSlot() {
    // Fast path: find a dead slot.
    for (const item of this.items) {
      if (!item.alive) return item;
    }
    // Slow path: recycle the oldest live coin.
    if (this.active.length === 0) return null;
    const oldest = this.active[0];
    oldest.alive = false;
    oldest.collected = true; // mark collected so render skips it
    this.active.shift();
    return oldest;
  }

  get activeItems() { return this.active; }
  get count() { return this.active.length; }
}

// Shared global coin pool (single source of truth for the whole game).
export const coins = new CoinPool(MAX_COINS);
