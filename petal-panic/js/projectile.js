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

// --- Special projectiles (design §4, §10) ------------------------------------
// Hero-specific weapon: bigger box, more damage, longer cooldown.
//   - Scarlet "saw": fast, no gravity, short range, high DPS
//   - Balthazar "bomb": has gravity, TTL fuse, explodes with AoE on expiry

const SAW_SPEED = 800;
const SAW_DAMAGE = 25;
const SAW_LIFETIME = 0.6;       // short range
const SAW_SIZE = 20;

const BOMB_SPEED = 550;
const BOMB_DAMAGE = 40;         // contact damage
const BOMB_FUSE = 1.5;          // seconds before explosion
const BOMB_EXPLODE_RADIUS = 100;
const BOMB_SIZE = 18;
const BOMB_GRAVITY = 800;       // px/s² (heavier than coins)

export class Special extends Entity {
  /**
   * @param {number} x spawn x
   * @param {number} y spawn y
   * @param {number} dir 0..7 aim index
   * @param {'saw'|'bomb'} type hero's special type
   */
  constructor(x, y, dir, type) {
    const isSaw = type === 'saw';
    super({
      x, y,
      w: isSaw ? SAW_SIZE : BOMB_SIZE,
      h: isSaw ? SAW_SIZE : BOMB_SIZE,
      layer: LAYER.PROJ_ALLY,
      debugColor: isSaw ? '#ff6ec7' : '#f39c12',
      gravity: isSaw ? 0 : 1,
    });

    this.type = type;
    this.friendly = true;
    this.speed = isSaw ? SAW_SPEED : BOMB_SPEED;
    this.damage = isSaw ? SAW_DAMAGE : BOMB_DAMAGE;
    this.life = isSaw ? SAW_LIFETIME : BOMB_FUSE;
    // Register the countdown under a descriptive label so the debug stack reads
    // 'fuse' for bombs (AoE detonation) and 'life' for saws (range limit). Both
    // are driven by the same tickTtl()/ttlExpired expiry path.
    this._ttlLabel = isSaw ? 'life' : 'fuse';
    this.setLife(this.life);
    if (!isSaw) {
      // Relabel the life timer as 'fuse' for display; tickTtl() honors _ttlLabel.
      this.timers.clear('life');
      this.timers.set('fuse', this.life);
    }
    this.radius = isSaw ? 0 : BOMB_EXPLODE_RADIUS; // bomb has AoE radius
    this.exploded = false;

    const angle = dirAngle(dir);
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;
  }

  update(dt) {
    // Gravity for bombs.
    if (this.gravity !== 0) {
      this.vy += BOMB_GRAVITY * dt;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // TTL countdown.
    const wasAlive = this.alive;
    this.tickTtl(dt);
    // If we just died from TTL, flag it so the update loop can call explodeSpecial().
    if (wasAlive && !this.alive) {
      this.ttlExpired = true;
    }
  }

  draw(ctx) {
    if (!this.alive) return;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    ctx.save();
    if (this.type === 'saw') {
      // Spinning saw blade (pink/magenta).
      ctx.translate(cx, cy);
      ctx.rotate(performance.now() * 0.01);
      ctx.fillStyle = '#ff6ec7';
      ctx.beginPath();
      ctx.arc(0, 0, this.w / 2, 0, Math.PI * 2);
      ctx.fill();
      // Teeth.
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.fillRect(Math.cos(a) * this.w * 0.4 - 2, Math.sin(a) * this.w * 0.4 - 2, 4, 4);
      }
    } else {
      // Bomb (orange circle with fuse spark).
      ctx.fillStyle = '#f39c12';
      ctx.beginPath();
      ctx.arc(cx, cy, this.w / 2, 0, Math.PI * 2);
      ctx.fill();
      // Fuse spark (blinks faster as TTL decreases).
      const blinkRate = this.ttlFrac < 0.3 ? 0.05 : 0.15;
      if (Math.floor(performance.now() * blinkRate) % 2 === 0) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx, cy - this.h / 2 - 3, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

// Pool for specials (smaller than thorn pool — lower fire rate).
export const MAX_SPECIALS = 16;
export const specialPool = new Pool(Special, MAX_SPECIALS);
