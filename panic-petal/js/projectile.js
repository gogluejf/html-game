// Petal Panic — Projectiles + 8-way shooting (design §4, §10).
//
// The thorn is the standard Contra-style shot: it flies in a straight line
// (no gravity) along one of 8 directions and dies after a short lifetime or
// when it leaves the level. All projectiles are drawn from a fixed-size object
// pool so sustained fire never allocates (acceptance #4: no GC pressure).
//
// Friendly flag drives BOTH the collision layer (PROJ_ALLY vs PROJ_FOE) and the
// debug color. Friendly (hero) projectiles only ever hit ENEMY/BOSS per the
// COLLISION_RULES masks — they can NEVER touch the hero (acceptance #3).

import { Entity } from './entity.js';
import { LAYER } from './consts.js';

// --- Tunables ----------------------------------------------------------------
export const MAX_PROJECTILES = 64;        // hard cap on live projectiles (perf param, §17)
const PROJECTILE_LIFETIME = 2;            // seconds before a shot auto-culls
const PROJECTILE_SPEED = 600;             // px/s
const PROJECTILE_DAMAGE = 10;             // base damage per thorn hit

/**
 * 8-direction aim index → unit vector.
 *   0=right 1=up-right 2=up 3=up-left 4=left 5=down-left 6=down 7=down-right
 * Angle starts at "up" (-90°) and steps 45° clockwise, matching how a player
 * thinks about aiming (hold up to shoot up, up+right for up-right, etc.).
 */
const DIR_ANGLES = [
  0,               // right     (+x)
  -Math.PI / 4,    // up-right
  -Math.PI / 2,    // up        (-y)
  -3 * Math.PI / 4,// up-left
  Math.PI,         // left      (-x)
  3 * Math.PI / 4, // down-left
  Math.PI / 2,     // down      (+y)
  Math.PI / 4,     // down-right
];

/** Angle (radians) for an 8-way aim index. Exported so callers can offset spawns. */
export function dirAngle(dir) {
  return DIR_ANGLES[((dir % 8) + 8) % 8];
}

/**
 * Map a directional input state to an 8-way aim index.
 * No horizontal input → use `facing` (the last way the hero moved).
 * @param {{left?:boolean,right?:boolean,up?:boolean,down?:boolean}} input
 * @param {number} facing -1 | 1 (hero's current horizontal facing)
 * @returns {number} 0..7
 */
export function aimFromInput(input, facing) {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0); // screen y grows downward

  if (dx === 0 && dy === 0) {
    return facing >= 0 ? 0 : 4; // no aim → shoot in facing direction
  }
  // Resolve diagonals to the nearest octant.
  if (dx > 0 && dy < 0) return 1; // up-right
  if (dx < 0 && dy < 0) return 3; // up-left
  if (dx < 0 && dy > 0) return 5; // down-left
  if (dx > 0 && dy > 0) return 7; // down-right
  if (dy < 0) return 2;           // up
  if (dy > 0) return 6;           // down
  if (dx > 0) return 0;           // right
  return 4;                       // left
}

export class Projectile extends Entity {
  /**
   * @param {number} x spawn x (top-left of the 12x12 box)
   * @param {number} y spawn y
   * @param {number} dir 0..7 aim index (see DIR_ANGLES)
   * @param {boolean} [friendly=true] true = hero's shot, false = enemy/boss shot
   */
  constructor(x, y, dir, friendly = true) {
    super({
      x, y,
      w: 12, h: 12,
      layer: friendly ? LAYER.PROJ_ALLY : LAYER.PROJ_FOE,
      debugColor: friendly ? '#ff6ec7' : '#ff4444',
      gravity: 0, // projectiles fly straight
    });

    this.friendly = friendly;
    this.speed = PROJECTILE_SPEED;
    this.damage = PROJECTILE_DAMAGE;
    this.life = PROJECTILE_LIFETIME;
    this.dir = dir;

    const angle = dirAngle(dir);
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }
}

/**
 * Fixed-size object pool. Objects are pre-allocated once; spawn() reuses any
 * inactive slot by copying a fresh instance over it (Object.assign), so no new
 * objects are created during gameplay. When every slot is live, spawn() returns
 * null and the caller simply skips firing (soft cap).
 */
export class Pool {
  /**
   * @param {Function} ClassRef constructor taking (...args)
   * @param {number} size number of pre-allocated slots
   */
  constructor(ClassRef, size) {
    this.ClassRef = ClassRef;
    this.items = [];
    this.active = [];
    for (let i = 0; i < size; i++) {
      const item = new ClassRef(0, 0, 0);
      item.alive = false; // parked until spawned
      this.items.push(item);
    }
  }

  /**
   * Reuse an inactive slot with a freshly-built instance.
   * @returns {object|null} the live item, or null if the pool is exhausted.
   */
  spawn(...args) {
    for (const item of this.items) {
      if (!item.alive) {
        Object.assign(item, new this.ClassRef(...args));
        item.alive = true;
        this.active.push(item);
        return item;
      }
    }
    return null; // pool exhausted — skip this shot
  }

  /** Advance every active item; drop any that died this step. */
  updateAll(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i];
      item.update(dt);
      if (!item.alive) {
        this.active.splice(i, 1);
      }
    }
  }

  /** @returns {Array<object>} currently-live items (mutable internal array). */
  get activeItems() { return this.active; }

  /** Number of live projectiles. */
  get count() { return this.active.length; }
}

// Shared global pool: the single source of all live projectiles.
export const projectilePool = new Pool(Projectile, MAX_PROJECTILES);
