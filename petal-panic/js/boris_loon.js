// Petal Panic — Boris Loon enemy (design §7). Adult + baby variants.
//
// Flyer: gravity = 0 (ignores gravity entirely). State machine:
//   hover   → hero below within DIVE_RANGE && diveCooldown ok → dive
//   hover   → hero beyond aggroRadius * RELEASE               → idle
//   dive    → diveTimer expires                               → recover
//   recover → recoverTimer expires                            → hover (diveCooldown set)
//
// While hovering it drifts slowly toward the hero horizontally (HOVER_SPEED)
// and oscillates vertically in a sine wave: y = baseY + sin(time * freq) * amp.
// When the hero is below it, it dives (a downward vy impulse) and can fire a
// projectile straight down. The baby variant is smaller (×0.6), faster (×1.5),
// and lower HP (15); swarms of 2–3 are handled by the spawner, not the AI.

import { Enemy } from './enemy.js';
import { projectilePool } from './projectile.js';

const BASE_W = 44, BASE_H = 40;

export const BORIS_DEF = {
  id: 'boris_loon',
  name: 'Boris Loon',
  w: BASE_W, h: BASE_H,
  aggroRadius: 360,
  stats: {
    weight: 1, speed: 80, attack: 12, defense: 1, stamina: 25,
    mjump: 0,
    melee: false, projectile: true, fly: true,
  },
  coinDrop: { range: [1, 2], chance: 0.5 },
};

export const BORIS_BABY_DEF = {
  id: 'boris_loon_baby',
  name: 'Boris Loon Baby',
  w: Math.round(BASE_W * 0.6), h: Math.round(BASE_H * 0.6),
  aggroRadius: 320,
  stats: {
    weight: 1, speed: 120, attack: 8, defense: 0, stamina: 15,
    mjump: 0,
    melee: false, projectile: true, fly: true,
  },
  coinDrop: { range: [1, 1], chance: 0.5 },
};

// --- Shared flight tunables --------------------------------------------------
const SINE_AMPLITUDE = 30;      // px — vertical bob amplitude
const SINE_PERIOD = 2;          // seconds — one full bob cycle
const HOVER_SPEED_MULT = 1.0;   // horizontal drift = speed * this
const DIVE_RANGE = 160;         // px — hero must be within this to trigger a dive
const DIVE_IMPULSE = 320;       // px/s — downward vy on dive start
const DIVE_TIME = 0.8;          // seconds the dive lasts
const RECOVER_TIME = 0.9;       // seconds to climb back up after a dive
const DIVE_COOLDOWN = 2.0;      // seconds between dives
const SHOOT_CHANCE = 0.5;       // probability of firing when a dive starts
const AGGRO_RELEASE_MULT = 1.5; // deaggro when hero exceeds aggroRadius * this

const SINE_FREQ = (Math.PI * 2) / SINE_PERIOD; // radians per second

export class BorisLoon extends Enemy {
  /**
   * @param {object} def BORIS_DEF or BORIS_BABY_DEF
   * @param {number} x spawn x (top-left of box)
   * @param {number} y spawn y (top-left of box)
   */
  constructor(def, x, y) {
    super(def, x, y);
    this.gravity = 0;           // flyer — ignore gravity (base already sets 0 via fly)
    this.baseY = y;             // center of the sine-wave bob
    this.hoverTime = Math.random() * SINE_PERIOD; // phase offset (stagger flocks)
    this.diveTimer = 0;         // seconds remaining in current dive
    this.recoverTimer = 0;      // seconds remaining in post-dive recovery
    this.diveCooldown = 0;      // seconds until next dive may start
  }

  /**
   * Boris Loon AI state machine. See header for transitions.
   * @param {number} dt seconds
   * @param {Hero} hero the player
   * @param {CollisionWorld} world unused directly
   */
  ai(dt, hero, _world) {
    if (this.aiState === 'dead') return;

    const dx = (hero.x + hero.w / 2) - (this.x + this.w / 2);
    const dy = (hero.y + hero.h / 2) - (this.y + this.h / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);

    switch (this.aiState) {
      case 'idle':
        this.vx = 0;
        this.vy = 0;
        // Ease back to the resting altitude while out of aggro.
        this.y += (this.baseY - this.y) * Math.min(1, dt * 3);
        if (dist < this.aggroRadius) this.aiState = 'hover';
        break;

      case 'hover': {
        if (dist > this.aggroRadius * AGGRO_RELEASE_MULT) {
          this.aiState = 'idle';
          break;
        }
        // Drift slowly toward the hero horizontally.
        this.vx = Math.sign(dx) * this.stats.speed * HOVER_SPEED_MULT;
        this.facing = Math.sign(dx) || this.facing;
        this.syncMirror();

        // Sine-wave vertical bob around baseY.
        this.hoverTime += dt;
        this.y = this.baseY + Math.sin(this.hoverTime * SINE_FREQ) * SINE_AMPLITUDE;
        this.vy = 0;

        // Hero below us? Dive.
        if (dy > 0 && dist < DIVE_RANGE && this.diveCooldown <= 0) {
          this.aiState = 'dive';
          this.diveTimer = DIVE_TIME;
          this.vy = DIVE_IMPULSE; // downward impulse
          if (Math.random() < SHOOT_CHANCE) this.fireDown(hero);
        }
        break;
      }

      case 'dive':
        this.vx *= 0.95; // slight air drag during the dive
        this.diveTimer -= dt;
        if (this.diveTimer <= 0) {
          this.aiState = 'recover';
          this.recoverTimer = RECOVER_TIME;
        }
        break;

      case 'recover':
        this.vx = 0;
        // Climb back toward the resting altitude.
        this.vy = -DIVE_IMPULSE * 0.6;
        this.recoverTimer -= dt;
        if (this.recoverTimer <= 0) {
          this.aiState = 'hover';
          this.diveCooldown = DIVE_COOLDOWN;
          this.vy = 0;
        }
        break;
    }

    // Dive cooldown ticks down regardless of state.
    if (this.diveCooldown > 0) this.diveCooldown -= dt;
  }

  /**
   * Fire a single unfriendly projectile straight down at the hero. Uses the
   * shared pool; no-op when the pool is exhausted.
   * @param {Hero} hero
   */
  fireDown(_hero) {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h; // spawn just below the body
    const size = 12;
    // dir 6 = straight down.
    projectilePool.spawn(cx - size / 2, cy, 6, false);
  }

  /**
   * Draw Boris. Falls back to the base debug rect (no sprite yet); the death
   * shrink/fade is handled by Enemy.draw(). Dive telegraphing is provided by
   * the generic debug velocity vector — no bespoke per-enemy indicator here.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    super.draw(ctx);
  }
}

/** Create an adult Boris Loon at (x, y). */
export function makeBoris(x, y) {
  return new BorisLoon(BORIS_DEF, x, y);
}

/** Create a baby Boris Loon at (x, y). */
export function makeBorisBaby(x, y) {
  return new BorisLoon(BORIS_BABY_DEF, x, y);
}
