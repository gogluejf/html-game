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

import { invalidateImpactMotion } from '../combat/entryImpact.js';
import { Entity } from '../core/entity.js';
import { LAYER } from '../consts.js';
import { specialById, isSpecialType } from './specialWeapons.js';

// --- Tunables ----------------------------------------------------------------
export const MAX_PROJECTILES = 64;        // hard cap on live projectiles (perf param, §17)
const PROJECTILE_LIFETIME = 2;            // seconds before a shot auto-culls
const PROJECTILE_SPEED = 600;             // px/s
const PROJECTILE_DAMAGE = 10;             // base damage per thorn hit

import { dirAngle } from '../core/vec.js';
export { dirAngle };

/**
 * Map a directional input state to an 8-way aim index.
 * No horizontal input → use `facing` (the last way the hero moved).
 * @param {{left?:boolean,right?:boolean,up?:boolean,down?:boolean}} input
 * @param {number} facing -1 | 1 (hero's current horizontal facing)
 * @returns {number} 0..7
 */
export function aimFromInput(input, facing) {
  // Explicit aim is authoritative; never reconstruct it from movement after locks.
  const hasAim = Number.isFinite(input.aimX) && Number.isFinite(input.aimY);
  const dx = hasAim ? input.aimX : (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = hasAim ? input.aimY : (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (Math.hypot(dx, dy) < 1e-6) return facing >= 0 ? DIR_RIGHT : DIR_LEFT;
  return ((Math.round(-Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
}

// 8-way aim indices (DIR_ANGLES order). Exported so the contextual rules in
// hero.resolveAim and the lock-capture rule in input.js share one table.
export const DIR_RIGHT = 0, DIR_LEFT = 4, DIR_DOWN = 6;

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

    invalidateImpactMotion(this);
    this.friendly = friendly;
    this.speed = PROJECTILE_SPEED;
    this.damage = PROJECTILE_DAMAGE;
    this.life = PROJECTILE_LIFETIME;
    this.dir = dir;
    // Solid-collision behavior (data, not class): 'phase' — thorns fly through
    // terrain; only barrels (GameObj) stop them.
    this.solidBehavior = 'phase';

    const angle = dirAngle(dir);
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;

    // Drawer: optional render override. Contract: (ctx, entity) => void.
    // null = use default draw (debug rect). Set per-shot by the attack engine
    // or weapon code to customize visuals without subclassing.
    this.drawer = null;
  }

  /**
   * Draw this projectile. Delegates to `this.drawer` if set; otherwise falls
   * back to the Entity debug rect. The drawer receives (ctx, this) so it has
   * full access to position, size, rotation, etc.
   */
  draw(ctx) {
    if (this.visible === false) return;
    if (typeof this.drawer === 'function') {
      this.drawer(ctx, this);
      return;
    }
    super.draw(ctx);
  }

  reflectVelocity(box) {
    super.reflectVelocity(box);
    invalidateImpactMotion(this);
  }

  update(dt) {
    this._impactPrevX = this.x;
    this._impactPrevY = this.y;
    this._impactPoint = null;
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
      if (!item.alive && !(item._attackId === 'bomb' && !item._attackDone &&
          item._attackHandle && !item._attackHandle._cancelled && !item._attackHandle._completed)) {
        // A collision can kill a slot AFTER updateAll's cleanup. Reusing it
        // must not append the same object a second time (double physics).
        // Remove extension fields from the previous attack generation.
        for (const key of Object.keys(item)) delete item[key];
        Object.assign(item, new this.ClassRef(...args));
        item.alive = true;
        if (!this.active.includes(item)) this.active.push(item);
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
// Hero-specific weapons: bigger box, more damage, longer cooldown.
// Weapon identity lives in the SPECIAL_WEAPONS registry (specialWeapons.js):
// both heroes can hold any weapon, so every property — including the FIRE
// COOLDOWN — belongs to the weapon definition. fireCooldown is the hero-side
// gate between shots of THIS weapon (seconds).

/** Per-weapon tuning — re-exported for backward compat with existing imports. */
export const SPECIAL_WEAPON_DEFS = Object.fromEntries(
  Object.values(specialById).map(w => [w.id, {
    speed: w.speed, damage: w.damage, lifetime: w.lifetime, size: w.size,
    fireCooldown: w.fireCooldown,
    ...(w.gravity ? { gravity: w.gravity } : {}),
    ...(w.explode ? { fuse: w.lifetime, explodeRadius: w.radius } : {}),
  }]),
);

export class Special extends Entity {
  /**
   * @param {number} x spawn x
   * @param {number} y spawn y
   * @param {number} dir 0..7 aim index
   * @param {string} type special weapon id (see SPECIAL_WEAPONS registry)
   */
  constructor(x, y, dir, type) {
    // Parked pool slots are built with no type; they stay inert until spawn()
    // copies a fully-built instance over them via Object.assign.
    const meta = type != null ? specialById[type] : null;
    if (type != null && !meta) throw new Error(`Unknown special weapon: ${type}`);
    super({
      x, y,
      w: meta?.size ?? 16, h: meta?.size ?? 16,
      layer: LAYER.PROJ_ALLY,
      debugColor: meta?.color ?? '#888',
      gravity: (meta?.gravity ?? 0) > 0 ? 1 : 0,
    });

    this.type = type;
    invalidateImpactMotion(this);
    this.friendly = true;
    // Solid-collision behavior per WEAPON (special-weapons.md): bombs BOUNCE
    // off terrain (reflect + keep flying, fuse still runs); saws/spread ABSORB
    // (the short-range blade dies on impact). Policy is consumed by the collision
    // handler via this flag — the physics primitive is reflectVelocity().
    this.solidBehavior = meta?.solidBehavior ?? 'stop';
    this.speed = meta?.speed ?? 0;
    this.damage = meta?.damage ?? 0;
    this.life = meta?.lifetime ?? 0;
    this.gravityValue = meta?.gravity ?? 0; // actual px/s² for ballistic weapons
    // Register the countdown under a descriptive label so the debug stack reads
    // 'fuse' for AoE weapons and 'life' for range-limited ones. Both are driven
    // by the same tickTtl()/ttlExpired expiry path.
    this._ttlLabel = meta?.explode ? 'fuse' : 'life';
    this.setLife(this.life);
    if (meta?.explode) {
      // Relabel the life timer as 'fuse' for display; tickTtl() honors _ttlLabel.
      this.timers.clear('life');
      this.timers.set('fuse', this.life);
    }
    this.radius = meta?.explode ? meta.radius : 0;
    this.exploded = false;

    const angle = dirAngle(dir);
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;

    // Drawer: optional render override. Contract: (ctx, entity) => void.
    // null = use default Special.draw (type-branched). Set per-shot to
    // customize visuals without subclassing.
    this.drawer = null;
  }

  reflectVelocity(box) {
    super.reflectVelocity(box);
    invalidateImpactMotion(this);
  }

  update(dt) {
    this._impactPrevX = this.x;
    this._impactPrevY = this.y;
    this._impactPoint = null;
    this._bombPrevBottom = this.y + this.h;
    // Gravity for ballistic weapons (bombs).
    if (this.gravityValue > 0 && !this._bombSettled) {
      this.vy += this.gravityValue * dt;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // TTL countdown.
    const wasAlive = this.alive;
    if (!this._bombFuseDisabled) this.tickTtl(dt);
    // If we just died from TTL, flag it so the update loop can call explodeSpecial().
    if (wasAlive && !this.alive) {
      this.ttlExpired = true;
    }
  }

  draw(ctx) {
    if (!this.alive || this._attackVisualOwned) return;
    // Drawer override: standalone (ctx, entity) => void.
    if (typeof this.drawer === 'function') {
      this.drawer(ctx, this);
      return;
    }
    const meta = specialById[this.type];
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    ctx.save();
    if (meta.explode) {
      // Bomb (orange circle with fuse spark).
      ctx.fillStyle = meta.color;
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
    } else {
      // Spinning saw blade / spread pellet (colored disc + teeth).
      ctx.translate(cx, cy);
      ctx.rotate(performance.now() * 0.01);
      ctx.fillStyle = meta.color;
      ctx.beginPath();
      ctx.arc(0, 0, this.w / 2, 0, Math.PI * 2);
      ctx.fill();
      // Teeth.
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.fillRect(Math.cos(a) * this.w * 0.4 - 2, Math.sin(a) * this.w * 0.4 - 2, 4, 4);
      }
    }
    ctx.restore();
  }
}

// Pool for specials (smaller than thorn pool — lower fire rate).
export const MAX_SPECIALS = 16;
export const specialPool = new Pool(Special, MAX_SPECIALS);
