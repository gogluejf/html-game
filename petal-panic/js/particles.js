// Petal Panic — Particles (design §12).
//
// Lightweight pooled particle system for one-shot visual effects:
//   - sparkle bursts on enemy death / barrel pop (small colored squares that
//     fly out and fade)
//
// Coins live in js/coin.js (Task 4.2) because they have per-type weight,
// bounce physics, and a collection pipeline — all of which are non-trivial
// enough to warrant their own module. This file re-exports the shared coin
// pool so existing callers (`import { coins } from './particles.js'`) keep
// working unchanged.

import { LAYER } from './consts.js';
import { Entity } from './entity.js';
import { coins, CoinPool } from './coin.js'; // re-exported below for backward compat

// --- Tunables ----------------------------------------------------------------
export const MAX_PARTICLES = 50;       // hard cap on live sparkles (§17 perf param)
const SPARKLE_LIFETIME = 0.5;          // seconds a sparkle lives
const SPARKLE_SIZE = 4;                // px per sparkle square
const SPARKLE_SPEED_RANGE = [80, 240]; // px/s random initial speed
const SPARKLE_COLORS = ['#f1c40f', '#e67e22', '#ff6ec7', '#ffffff'];

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
    // Epsilon cull: fixed-step FP residue (e.g. 0.2 - 12*(1/60) ≈ 4.86e-17)
    // would otherwise let pool items survive exactly one extra frame at the
    // exact-lifetime boundary. Makes the done-frame exact for all pool items
    // (plain sparkles included — same residue class).
    if (this.life <= 1e-9) { this.alive = false; return; }
    // Slight upward drift then settle (gives the burst a "pop" feel).
    // Per-fragment gravity override (debris.js sets debrisGravity); the
    // default keeps the legacy 200 px/s² sparkle arc.
    this.vy += (this.debrisGravity ?? 200) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Per-fragment spin (debris.js sets debrisRotation); plain sparkles have
    // no rot and draw unrotated exactly as before.
    if (this.rot != null) this.rot += (this.debrisRotation ?? 0) * dt;
  }

  draw(ctx) {
    if (!this.alive) return;
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    if (this.rot != null) {
      // Rotating fragment: square shrinks linearly toward the end of life so
      // it reads as tumbling debris rather than a constant-size sprite.
      const s = this.w * alpha;
      ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
      ctx.rotate(this.rot);
      ctx.fillRect(-s / 2, -s / 2, s, s);
    } else {
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }
    ctx.restore();
  }}

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
      // Recycled slots may retain debris overrides from a previous life
      // (Object.assign never deletes keys); clear them so plain sparkles
      // always take the legacy unrotated path.
      delete item.rot;
      delete item.debrisGravity;
      delete item.debrisRotation;
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
   * @param {string} color fill color
   * @param {number} speed initial outward speed (px/s)
   * @param {number} angle launch direction (radians)
   * @returns {object|null} the live sparkle, or null if the pool is full
   */
  spawnOne(cx, cy, color, speed, angle) {
    for (const item of this.items) {
      if (item.alive) continue;
      Object.assign(item, new Sparkle(cx - SPARKLE_SIZE / 2, cy - SPARKLE_SIZE / 2, color));
      // Reset debris overrides so a recycled slot behaves as a plain sparkle
      // unless the caller sets them (debris.js is the only current setter).
      delete item.rot;
      delete item.debrisGravity;
      delete item.debrisRotation;
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

// Re-export the coin pool + CoinPool class from their home module so existing
// imports (`import { coins, CoinPool } from './particles.js'`) keep working.
export { coins, CoinPool };
