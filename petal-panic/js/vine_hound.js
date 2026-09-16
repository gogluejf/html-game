// Petal Panic — Vine Hound enemy (design §7).
//
// Ground-based melee chaser, faster than the jester. State machine:
//   idle    → hero within aggroRadius                 → chase
//   chase   → hero beyond aggroRadius * RELEASE       → idle
//   chase   → dist < LUNGE_RANGE && lungeCooldown ok  → lunge
//   lunge   → lungeTimer expires                     → recover
//   recover → recoverTimer expires                   → chase (lungeCooldown set)
//
// The lunge is a short forward dash: for LUNGE_ACTIVE_FRAC of its duration the
// hound's body moves at LUNGE_SPEED and deals contact damage to the hero (one
// hit per lunge). No projectile. The lunge hitbox is just the enlarged body box
// during the active window; the update system checks it against the hero and
// routes through damage() on overlap (same pattern as the jester's whip).

import { Enemy } from './enemy.js';

export const VINE_HOUND_DEF = {
  id: 'vine_hound',
  name: 'Vine Hound',
  w: 40, h: 44,
  aggroRadius: 320,
  stats: {
    weight: 1, speed: 180, attack: 18, defense: 1, stamina: 35,
    mjump: 0,
    melee: true, projectile: false, fly: false,
  },
  coinDrop: { min: 1, max: 3, chance: 1.0, types: { bronze: 1 } },
};

const LUNGE_RANGE = 50;          // px — distance at which the hound lunges
const LUNGE_DURATION = 0.35;     // seconds — total lunge anim length
const LUNGE_ACTIVE_FRAC = [0.1, 0.7]; // fraction of lunge where the dash is live
const LUNGE_SPEED = 420;         // px/s — forward dash speed while lunging
const RECOVER_TIME = 0.3;        // seconds of wind-down after a lunge
const LUNGE_COOLDOWN = 1.2;      // seconds between lunges
const AGGRO_RELEASE_MULT = 1.5;  // deaggro when hero exceeds aggroRadius * this

export class VineHound extends Enemy {
  constructor(x, y) {
    super(VINE_HOUND_DEF, x, y);
    this.lungeCooldown = 0;     // seconds until next lunge may start
    this.lungeActive = false;   // true while a lunge is in progress
    this.lungeTimer = 0;        // seconds remaining in current lunge/recover
    this.recoverTimer = 0;      // seconds remaining in the post-lunge wind-down
  }

  /**
   * Vine Hound AI state machine. See header for transitions.
   * @param {number} dt seconds
   * @param {Hero} hero the player
   * @param {CollisionWorld} world unused by the hound
   */
  ai(dt, hero, _world) {
    if (this.aiState === 'dead') return;

    const dx = (hero.x + hero.w / 2) - (this.x + this.w / 2);
    const dy = (hero.y + hero.h / 2) - (this.y + this.h / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);

    // --- State transitions ---------------------------------------------------
    if (this.aiState === 'idle' && dist < this.aggroRadius) {
      this.aiState = 'chase';
    }

    switch (this.aiState) {
      case 'idle':
        this.vx = 0;
        break;

      case 'chase': {
        if (dist > this.aggroRadius * AGGRO_RELEASE_MULT) {
          this.aiState = 'idle';
          this.vx = 0;
          break;
        }
        // Run toward the hero (faster than the jester).
        this.vx = Math.sign(dx) * this.stats.speed;
        this.facing = Math.sign(dx) || this.facing;
        this.syncMirror();

        // Close enough to lunge?
        if (dist < LUNGE_RANGE && this.lungeCooldown <= 0) {
          this.aiState = 'lunge';
          this.lungeActive = true;
          this.lungeTimer = LUNGE_DURATION;
          this.vx = Math.sign(dx) * LUNGE_SPEED; // burst forward
        }
        break;
      }

      case 'lunge':
        this.lungeTimer -= dt;
        if (this.lungeTimer <= 0) {
          this.lungeActive = false;
          this.aiState = 'recover';
          this.recoverTimer = RECOVER_TIME;
          this.vx = 0;
        }
        break;

      case 'recover':
        this.vx = 0;
        this.recoverTimer -= dt;
        if (this.recoverTimer <= 0) {
          this.aiState = 'chase';
          this.lungeCooldown = LUNGE_COOLDOWN;
        }
        break;
    }

    // Lunge cooldown ticks down regardless of state.
    if (this.lungeCooldown > 0) this.lungeCooldown -= dt;
  }

  /**
   * World-space AABB of the lunge hitbox, or null when no damage should be
   * dealt this frame. Only the middle portion of the lunge produces a box —
   * the windup and recovery return null so the dash has a visible telegraph.
   * The box is the hound's own body (slightly inflated) since a lunge is a
   * body-contact attack rather than an extended reach.
   *
   * @returns {{x:number,y:number,w:number,h:number}|null}
   */
  get lungeHitboxWorld() {
    if (!this.lungeActive) return null;
    const t = 1 - this.lungeTimer / LUNGE_DURATION; // 0..1 progress through lunge
    if (t < LUNGE_ACTIVE_FRAC[0] || t > LUNGE_ACTIVE_FRAC[1]) return null;
    const b = this.worldBox();
    return { x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 };
  }

  /**
   * Draw the hound. Falls back to the base debug rect (no sprite yet); the
   * death shrink/fade is handled by Enemy.draw(). During a lunge we overlay a
   * faint green outline so the dash reads without sprites.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    super.draw(ctx);

    if (this.lungeActive && this.alive) {
      const hb = this.lungeHitboxWorld;
      if (hb) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
        ctx.restore();
      }
    }
  }
}
