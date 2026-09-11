// Petal Panic — Jester enemy (design §7).
//
// Ground-based melee enemy with a whip attack. State machine:
//   idle   → hero within aggroRadius            → chase
//   chase  → hero beyond aggroRadius * 1.5      → idle
//   chase  → dist < WHIP_RANGE && cooldown ok   → attack (whip)
//   attack → whipTimer expires                  → chase (with whipCooldown set)
//
// The whip is a short forward hitbox that's only "live" during the middle of
// the whip animation; the update system checks it against the hero each step
// and routes through damage() on overlap (same pattern as the hero's melee).

import { Enemy } from './enemy.js';

export const JESTER_DEF = {
  id: 'jester',
  name: 'Jester',
  w: 36, h: 48,
  aggroRadius: 300,
  stats: {
    weight: 1, speed: 120, attack: 15, defense: 2, stamina: 40,
    mjump: 0,
    melee: true, projectile: false, fly: false,
  },
  coinDrop: { range: [1, 3], chance: 0.6 },
};

const WHIP_RANGE = 60;        // px — distance at which the jester starts a whip
const WHIP_DURATION = 0.4;    // seconds — total whip anim length
const WHIP_ACTIVE_FRAC = [0.25, 0.75]; // fraction of whip where the hitbox is live
const WHIP_COOLDOWN = 1.5;    // seconds between whips
const AGGRO_RELEASE_MULT = 1.5; // deaggro when hero exceeds aggroRadius * this

export class Jester extends Enemy {
  constructor(x, y) {
    super(JESTER_DEF, x, y);
    this.whipCooldown = 0;     // seconds until next whip may start
    this.whipActive = false;   // true while a whip is in progress
    this.whipTimer = 0;        // seconds remaining in current whip
    // Whip hitbox relative to body center; ox offset in facing direction.
    this.whipHitbox = { ox: 15, oy: -10, bw: 35, bh: 30 };
  }

  /**
   * Jester AI state machine. See header for transitions.
   * @param {number} dt seconds
   * @param {Hero} hero the player
   * @param {CollisionWorld} world unused by jester
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
        // Walk toward hero.
        this.vx = Math.sign(dx) * this.stats.speed;
        this.facing = Math.sign(dx) || this.facing;
        this.syncMirror();

        // Close enough to whip?
        if (dist < WHIP_RANGE && this.whipCooldown <= 0) {
          this.aiState = 'attack';
          this.whipActive = true;
          this.whipTimer = WHIP_DURATION;
          this.vx = 0;
        }
        break;
      }

      case 'attack':
        this.vx = 0;
        this.whipTimer -= dt;
        if (this.whipTimer <= 0) {
          this.whipActive = false;
          this.aiState = 'chase';
          this.whipCooldown = WHIP_COOLDOWN;
        }
        break;
    }

    // Whip cooldown ticks down regardless of state.
    if (this.whipCooldown > 0) this.whipCooldown -= dt;
  }

  /**
   * World-space AABB of the whip hitbox, or null when no damage should be
   * dealt this frame. Only the middle portion of the whip animation produces
   * a box — windup and recovery return null so the swing has a visible telegraph.
   *
   * @returns {{x:number,y:number,w:number,h:number}|null}
   */
  get whipHitboxWorld() {
    if (!this.whipActive) return null;
    const t = 1 - this.whipTimer / WHIP_DURATION; // 0..1 progress through whip
    if (t < WHIP_ACTIVE_FRAC[0] || t > WHIP_ACTIVE_FRAC[1]) return null;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const dir = this.facing;
    return {
      x: cx + dir * this.whipHitbox.ox - (dir < 0 ? this.whipHitbox.bw : 0),
      y: cy + this.whipHitbox.oy,
      w: this.whipHitbox.bw,
      h: this.whipHitbox.bh,
    };
  }

  /**
   * Draw the jester. Falls back to the base debug rect (no sprite yet); the
   * death shrink/fade is handled by Enemy.draw(). When a whip is active we
   * overlay a thin yellow arc so the attack is visible without sprites.
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    super.draw(ctx);

    // Whip visual: a small yellow line/arc extending from the body in the
    // facing direction while the whip is active. Debug-friendly placeholder
    // until real sprites land.
    if (this.whipActive && this.alive) {
      const hb = this.whipHitboxWorld;
      const cx = this.x + this.w / 2;
      const cy = this.y + this.h / 2;
      const dir = this.facing;
      ctx.save();
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      // Extend past the hitbox edge so the swing reads as an arc.
      const reach = this.whipHitbox.ox + this.whipHitbox.bw;
      ctx.lineTo(cx + dir * reach, cy - 6);
      ctx.stroke();
      ctx.restore();
      // Live hitbox outline (debug aid even without F3).
      if (hb) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#f1c40f';
        ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
        ctx.restore();
      }
    }
  }
}
