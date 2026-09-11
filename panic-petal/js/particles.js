// Petal Panic — Particles + coins (design §12, §14).
//
// Lightweight pooled particle system for one-shot effects:
//   - sparkle bursts on enemy death (small colored squares that fly out and fade)
//   - coin drops from dead enemies (yellow circles that fall with gravity and
//     bounce off the floor; collected by the hero via the COIN layer rule)
//
// Both are pooled so sustained combat never allocates. The pools are separate
// because sparkles are pure visual (no collision) while coins participate in
// the collision world (HERO × COIN → collect).

import { Entity } from './entity.js';
import { LAYER, GRAVITY, MAX_FALL_SPEED } from './consts.js';

// --- Tunables ----------------------------------------------------------------
export const MAX_PARTICLES = 50;       // hard cap on live sparkles (§17 perf param)
const SPARKLE_LIFETIME = 0.5;          // seconds a sparkle lives
const SPARKLE_SIZE = 4;                // px per sparkle square
const SPARKLE_SPEED_RANGE = [80, 240]; // px/s random initial speed
const SPARKLE_COLORS = ['#f1c40f', '#e67e22', '#ff6ec7', '#ffffff'];

const MAX_COINS = 32;                  // hard cap on live coins
const COIN_SIZE = 12;                  // px
const COIN_BOUNCE = 0.4;               // vy multiplier on floor hit
const COIN_ROLL_FRICTION = 0.9;        // vx decay when rolling on the floor
const COIN_VALUE = 1;                  // score per coin (v1: all bronze)

// ---------------------------------------------------------------------------
// Sparkle particles (pure visual, no collision)
// ---------------------------------------------------------------------------

class Sparkle extends Entity {
  constructor(x, y, color) {
    super({ x, y, w: SPARKLE_SIZE, h: SPARKLE_SIZE, gravity: 0, layer: LAYER.NONE });
    this.color = color;
    this.life = SPARKLE_LIFETIME;
    this.maxLife = SPARKLE_LIFETIME;
    // Random outward velocity.
    const angle = Math.random() * Math.PI * 2;
    const speed = SPARKLE_SPEED_RANGE[0] + Math.random() * (SPARKLE_SPEED_RANGE[1] - SPARKLE_SPEED_RANGE[0]);
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    // Slight upward drift then settle (gives the burst a "pop" feel).
    this.vy += 200 * dt; // mild gravity for arc
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  draw(ctx) {
    if (!this.alive) return;
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.restore();
  }
}

/**
 * Pooled sparkle emitter. spawnBurst() fires N sparkles from a point; they
 * fly outward and fade over SPARKLE_LIFETIME. No allocation after init.
 */
export class ParticleSystem {
  constructor(size = MAX_PARTICLES) {
    this.items = [];
    this.active = [];
    for (let i = 0; i < size; i++) {
      const s = new Sparkle(0, 0, '#fff');
      s.alive = false;
      this.items.push(s);
    }
  }

  /**
   * Emit a burst of `count` sparkles centered at (cx, cy).
   * @param {number} cx center x
   * @param {number} cy center y
   * @param {number} [count=6] how many sparkles (clamped to available slots)
   * @returns {number} number actually spawned
   */
  spawnBurst(cx, cy, count = 6) {
    let spawned = 0;
    for (const item of this.items) {
      if (spawned >= count) break;
      if (item.alive) continue;
      const color = SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
      Object.assign(item, new Sparkle(cx - SPARKLE_SIZE / 2, cy - SPARKLE_SIZE / 2, color));
      item.alive = true;
      this.active.push(item);
      spawned++;
    }
    return spawned;
  }

  /**
   * Emit a SINGLE sparkle with an explicit color, speed and angle — used by
   * directional effects like barrel explosions where the caller controls the
   * vector rather than leaving it random. Falls back to a parked slot; returns
   * null when the pool is exhausted (soft cap, no allocation).
   *
   * @param {number} cx center x
   * @param {number} cy center y
   * @param {string} color fill color
   * @param {number} speed initial outward speed (px/s)
   * @param {number} angle launch direction (radians)
   * @returns {object|null} the live sparkle, or null if the pool is full
   */
  spawnOne(cx, cy, color, speed, angle) {
    for (const item of this.items) {
      if (item.alive) continue;
      Object.assign(item, new Sparkle(cx - SPARKLE_SIZE / 2, cy - SPARKLE_SIZE / 2, color));
      // Override the random velocity with the caller's directed vector.
      item.vx = Math.cos(angle) * speed;
      item.vy = Math.sin(angle) * speed;
      item.color = color;
      item.alive = true;
      this.active.push(item);
      return item;
    }
    return null; // pool exhausted
  }

  /** Advance all active sparkles; cull expired ones. */
  updateAll(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.update(dt);
      if (!s.alive) this.active.splice(i, 1);
    }
  }

  get activeItems() { return this.active; }
  get count() { return this.active.length; }
}

// Shared global particle system.
export const particles = new ParticleSystem(MAX_PARTICLES);

// ---------------------------------------------------------------------------
// Coins (physics + bounce, design §10/§14)
// ---------------------------------------------------------------------------

class Coin extends Entity {
  constructor(x, y) {
    super({
      x, y,
      w: COIN_SIZE, h: COIN_SIZE,
      layer: LAYER.COIN,
      debugColor: '#f1c40f',
      gravity: 1,
    });
    this.value = COIN_VALUE;
    // Small random horizontal kick so coins scatter.
    this.vx = (Math.random() - 0.5) * 120;
    this.vy = -150 - Math.random() * 100; // pop upward first
  }

  /**
   * Integrate with gravity; bounce off the floor plane (simple ground check
   * against the level's floor top — passed in by the caller since coins don't
   * know about SOLIDS directly; the collision world handles platform bounces
   * via the ENEMY×SOLID-style resolve if we add a COIN×SOLID rule later).
   * For v1 we just clamp to the floor line.
   *
   * @param {number} dt seconds
   * @param {number} floorTop y-coordinate of the level floor surface
   */
  update(dt, floorTop = 500) {
    this.vy += GRAVITY * this.gravity * dt;
    if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Floor bounce.
    const bottom = this.y + this.h;
    if (bottom >= floorTop && this.vy > 0) {
      this.y = floorTop - this.h;
      this.vy *= -COIN_BOUNCE;
      this.vx *= COIN_ROLL_FRICTION;
      // Settle: if bounce is tiny, rest on the floor.
      if (Math.abs(this.vy) < 20) {
        this.vy = 0;
        this.vx *= 0.8;
      }
    }
  }

  draw(ctx) {
    if (!this.alive) return;
    ctx.save();
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.arc(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, 0, Math.PI * 2);
    ctx.fill();
    // Inner highlight for a coin look.
    ctx.fillStyle = '#f9e79f';
    ctx.beginPath();
    ctx.arc(this.x + this.w / 2 - 1, this.y + this.h / 2 - 1, this.w / 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Pooled coin spawner. dropCoins() rolls the enemy's coinDrop config and
 * spawns 0..N coins at the enemy's center.
 */
export class CoinPool {
  constructor(size = MAX_COINS) {
    this.items = [];
    this.active = [];
    for (let i = 0; i < size; i++) {
      const c = new Coin(0, 0);
      c.alive = false;
      this.items.push(c);
    }
  }

  /**
   * Roll an enemy's coinDrop config and spawn coins at (cx, cy).
   * @param {{range:[number,number], chance:number}} coinDrop
   * @param {number} cx center x (enemy body center)
   * @param {number} cy center y
   * @returns {number} number of coins spawned (0 if roll failed or pool empty)
   */
  dropCoins(coinDrop, cx, cy) {
    if (Math.random() > coinDrop.chance) return 0;
    const [min, max] = coinDrop.range;
    const n = min + Math.floor(Math.random() * (max - min + 1));
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      let slot = null;
      for (const item of this.items) {
        if (!item.alive) { slot = item; break; }
      }
      if (!slot) break; // pool exhausted
      Object.assign(slot, new Coin(cx - COIN_SIZE / 2, cy - COIN_SIZE / 2));
      slot.alive = true;
      this.active.push(slot);
      spawned++;
    }
    return spawned;
  }

  /**
   * Advance all active coins; cull any that fell off-screen.
   * @param {number} dt seconds
   * @param {number} floorTop level floor y
   * @param {number} [levelLength=Infinity] right bound for culling
   */
  updateAll(dt, floorTop = 500, levelLength = Infinity) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      c.update(dt, floorTop);
      // Cull off-screen.
      if (c.x + c.w < 0 || c.x > levelLength || c.y > 600) {
        c.alive = false;
        this.active.splice(i, 1);
      }
    }
  }

  get activeItems() { return this.active; }
  get count() { return this.active.length; }
}

// Shared global coin pool.
export const coins = new CoinPool(MAX_COINS);
