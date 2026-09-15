// Petal Panic — Violetta Marionetta enemy (design §7).
//
// Ground-based melee+projectile. State machine:
//   idle    → hero within aggroRadius          → pace
//   pace    → hero beyond aggroRadius * REL    → idle
//   pace    → dist < MELEE_RANGE && cd ok      → melee
//   melee   → meleeTimer expires               → pace (meleeCooldown set)
//
// While pacing, Violetta walks back and forth within a fixed range around her
// spawn x (PACING_SPEED). Independently of the state machine, she fires a
// projectile at the player every PROJECTILE_FREQ seconds when the player is in
// line of sight (same y ± LOS_TOLERANCE) and within range. The projectile is
// spawned from the shared pool as an unfriendly shot (PROJ_FOE); the update
// system routes its hit on the hero through damage(). Melee is a short forward
// jab (one hit per swing) for very close targets.

import { Enemy } from './enemy.js';
import { projectilePool } from './projectile.js';

export const VIOLETTA_DEF = {
  id: 'violetta_marionetta',
  name: 'Violetta Marionetta',
  w: 36, h: 50,
  aggroRadius: 340,
  stats: {
    weight: 1, speed: 90, attack: 14, defense: 2, stamina: 45,
    mjump: 0,
    melee: true, projectile: true, fly: false,
  },
  coinDrop: { range: [1, 3], chance: 0.6 },
};

const PACING_SPEED = 80;        // px/s — walk speed while pacing
const PACING_RANGE = 140;       // px — half-width of the pacing corridor
const MELEE_RANGE = 40;         // px — distance at which the melee jab triggers
const MELEE_DURATION = 0.3;     // seconds — total jab anim length
const MELEE_ACTIVE_FRAC = [0.3, 0.7]; // fraction where the jab hitbox is live
const MELEE_COOLDOWN = 1.0;     // seconds between jabs
const PROJECTILE_FREQ = 2;      // seconds between shots
const PROJECTILE_RANGE = 360;   // max horizontal reach for a shot
const LOS_TOLERANCE = 50;       // px — |dy| window for "in line of sight"
const AGGRO_RELEASE_MULT = 1.5; // deaggro when hero exceeds aggroRadius * this

export class Violetta extends Enemy {
  constructor(x, y) {
    super(VIOLETTA_DEF, x, y);
    this.spawnX = x;            // center of the pacing corridor
    this.paceDir = 1;          // -1 | 1 current walking direction
    this.projectileTimer = Math.random() * PROJECTILE_FREQ; // stagger first shot
    this.meleeActive = false;  // true while a jab is in progress
    this.meleeTimer = 0;       // seconds remaining in current jab
    this.meleeCooldown = 0;    // seconds until next jab may start
  }

  /**
   * Violetta AI state machine + pacer + shooter. See header for transitions.
   * @param {number} dt seconds
   * @param {Hero} hero the player
   * @param {CollisionWorld} world unused by violetta
   */
  ai(dt, hero, _world) {
    if (this.aiState === 'dead') return;

    const dx = (hero.x + hero.w / 2) - (this.x + this.w / 2);
    const dy = (hero.y + hero.h / 2) - (this.y + this.h / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);

    // --- State transitions ---------------------------------------------------
    if (this.aiState === 'idle' && dist < this.aggroRadius) {
      this.aiState = 'pace';
    }

    switch (this.aiState) {
      case 'idle':
        this.vx = 0;
        break;

      case 'pace': {
        if (dist > this.aggroRadius * AGGRO_RELEASE_MULT) {
          this.aiState = 'idle';
          this.vx = 0;
          break;
        }
        // Pace back and forth within the corridor around spawnX.
        const leftEdge = this.spawnX - PACING_RANGE;
        const rightEdge = this.spawnX + PACING_RANGE;
        if (this.x <= leftEdge) { this.paceDir = 1; }
        else if (this.x >= rightEdge) { this.paceDir = -1; }
        this.vx = this.paceDir * PACING_SPEED;
        this.facing = this.paceDir;
        this.syncMirror();

        // Very close → melee jab.
        if (dist < MELEE_RANGE && this.meleeCooldown <= 0) {
          this.aiState = 'melee';
          this.meleeActive = true;
          this.meleeTimer = MELEE_DURATION;
          this.vx = 0;
          this.facing = Math.sign(dx) || this.facing;
          this.syncMirror();
        }
        break;
      }

      case 'melee':
        this.vx = 0;
        this.meleeTimer -= dt;
        if (this.meleeTimer <= 0) {
          this.meleeActive = false;
          this.aiState = 'pace';
          this.meleeCooldown = MELEE_COOLDOWN;
        }
        break;
    }

    // Projectile timer ticks regardless of state (she can shoot while pacing).
    this.projectileTimer += dt;
    if (this.projectileTimer >= PROJECTILE_FREQ) {
      this.projectileTimer = 0;
      this.tryShoot(hero, dx, dy, dist);
    }

    // Melee cooldown ticks down regardless of state.
    if (this.meleeCooldown > 0) this.meleeCooldown -= dt;
  }

  /**
   * Fire a projectile at the hero when he's in line of sight and within range.
   * Uses the shared pool with an unfriendly shot aimed along the 8-way grid
   * toward the target. No-op when out of range or not in LOS.
   * @param {Hero} hero
   * @param {number} dx signed horizontal offset to hero
   * @param {number} dy signed vertical offset to hero
   * @param {number} dist center-to-center distance
   */
  tryShoot(hero, dx, dy, dist) {
    if (dist > PROJECTILE_RANGE) return;
    if (Math.abs(dy) > LOS_TOLERANCE) return; // not in line of sight

    // Pick the nearest 8-way aim index toward the hero.
    const dir = nearestDirIndex(dx, dy);
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const size = 12;
    const ox = Math.cos(dirAngleLocal(dir)) * 18;
    const oy = Math.sin(dirAngleLocal(dir)) * 18;
    projectilePool.spawn(cx - size / 2 + ox, cy - size / 2 + oy, dir, false);
  }

  /**
   * World-space AABB of the melee jab hitbox, or null when no damage should be
   * dealt this frame. Only the middle portion of the jab produces a box.
   * @returns {{x:number,y:number,w:number,h:number}|null}
   */
  get meleeHitboxWorld() {
    if (!this.meleeActive) return null;
    const t = 1 - this.meleeTimer / MELEE_DURATION; // 0..1 progress
    if (t < MELEE_ACTIVE_FRAC[0] || t > MELEE_ACTIVE_FRAC[1]) return null;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const dir = this.facing;
    const bw = 30, bh = 34, ox = 12;
    return {
      x: cx + dir * ox - (dir < 0 ? bw : 0),
      y: cy - bh / 2,
      w: bw,
      h: bh,
    };
  }

  /**
   * Draw violetta. Falls back to the base debug rect (no sprite yet); the
   * death shrink/fade is handled by Enemy.draw(). A thin purple arc marks the
   * jab while it's active.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    super.draw(ctx);

    if (this.meleeActive && this.alive) {
      const hb = this.meleeHitboxWorld;
      const cx = this.x + this.w / 2;
      const cy = this.y + this.h / 2;
      const dir = this.facing;
      ctx.save();
      ctx.strokeStyle = '#9b59b6';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dir * 42, cy - 4);
      ctx.stroke();
      ctx.restore();
      if (hb) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#9b59b6';
        ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
        ctx.restore();
      }
    }
  }
}

// --- Local 8-way aim helpers (kept here so the module stays self-contained) --
// Mirrors the DIR_ANGLES table in projectile.js without importing the full
// pool math twice; only the angle lookup + nearest-index are needed.
const DIR_ANGLES = [
  0, -Math.PI / 4, -Math.PI / 2, -3 * Math.PI / 4,
  Math.PI, 3 * Math.PI / 4, Math.PI / 2, Math.PI / 4,
];
function dirAngleLocal(dir) { return DIR_ANGLES[((dir % 8) + 8) % 8]; }

/** Nearest 8-way aim index for an (dx, dy) offset (screen y grows downward). */
function nearestDirIndex(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  if (dx > 0 && dy < 0) return 1; // up-right
  if (dx < 0 && dy < 0) return 3; // up-left
  if (dx < 0 && dy > 0) return 5; // down-left
  if (dx > 0 && dy > 0) return 7; // down-right
  if (dy < 0) return 2;           // up
  if (dy > 0) return 6;           // down
  if (dx > 0) return 0;           // right
  return 4;                       // left
}
