// Petal Panic — Entity base class (design §3, "Sprite Foundation Struct").
//
// The Entity is the SINGLE SOURCE OF TRUTH for an object's position and look:
//   - where it is      → x, y (+ vx, vy, gravity)
//   - how it looks     → facing, mirrorX/Y, rotation, scale, anim
//   - what it collides → layer bitmask + box (offset AABB)
//
// Every hero, enemy, projectile, coin, powerup, and object inherits from this.
// Subclasses override update() / draw() as needed; the defaults here give a
// working falling-box entity out of the box.

import { GRAVITY, MAX_FALL_SPEED } from './consts.js';
import { Timers } from './timers.js';

export class Entity {
  /**
   * @param {object} opts all fields optional; see design §3 for semantics.
   */
  constructor(opts = {}) {
    // --- Position & size ---------------------------------------------------
    // x,y = top-left of the collision box (NOT necessarily the image size).
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.w = opts.w ?? 0;
    this.h = opts.h ?? 0;

    // --- Velocity -----------------------------------------------------------
    this.vx = opts.vx ?? 0;
    this.vy = opts.vy ?? 0;
    this.gravity = opts.gravity ?? 1;   // per-entity factor; 0 for flyers

    // --- Transform / facing -------------------------------------------------
    this.facing = opts.facing ?? 1;     // -1 | 1 (horizontal aim dir)
    this.mirrorX = opts.mirrorX ?? false;
    this.mirrorY = opts.mirrorY ?? false;
    this.rotation = opts.rotation ?? 0; // radians (render transform)
    this.scale = opts.scale ?? 1;

    // --- Base sprite angle ----------------------------------------------------
    // Optional offset for art that does NOT point right by default. Most sprites
    // face right (0 rad); set once per entity type if the raw art points up/down.
    this.baseSpriteAngle = opts.baseSpriteAngle ?? 0;

    // --- Physics ------------------------------------------------------------
    this.weight = opts.weight ?? 1;     // knockback / push strength

    // --- Animation ----------------------------------------------------------
    // AnimationController ref (design §11). null = no sprite animation yet;
    // draw() falls back to a debug rect.
    this.anim = opts.anim ?? null;

    // --- Collision ----------------------------------------------------------
    this.layer = opts.layer ?? 0;       // bitmask (see LAYER in consts.js)
    // Offset collision box relative to origin. Defaults to full w×h.
    // NEVER mirrored: the AABB is symmetric regardless of facing.
    this.box = opts.box ?? { ox: 0, oy: 0, bw: this.w, bh: this.h };

    // --- State ----------------------------------------------------------------
    this.alive = true;
    this.debugColor = opts.debugColor ?? '#fff';

    // --- Time-to-live (TTL) ---------------------------------------------------
    // Unified labeled timer set. An entity can carry MANY concurrent countdowns
    // (life, fuse, death, rec, inv, rapid, ...) — see timers.js. The legacy
    // scalar `ttl`/`maxTtl`/`ttlFrac` are kept as accessors over a default
    // 'life' timer so existing coin/projectile code keeps working while we
    // migrate incrementally. New code should use this.timers directly.
    //
    // IMPORTANT: maxTtl is a SETTER that (re)registers the 'life' timer, because
    // subclasses assign this.maxTtl AFTER super() runs (e.g. Coin sets COIN_TTL
    // in its own constructor body). A plain field would be set too late for the
    // one-shot seeding below and the life timer would never exist.
    this.timers = new Timers();
    this._maxTtl = 0;
    this.ttlSpeed = opts.ttlSpeed ?? 1;
    if ((opts.maxTtl ?? 0) > 0) this.maxTtl = opts.maxTtl; // route through setter

    // --- Effect radius --------------------------------------------------------
    // Generic "zone of effect" radius in logical px. Used by:
    //   - enemies: aggro/detection radius
    //   - barrels: explosion AoE radius
    //   - projectiles/bombs: blast radius
    //   - powerups: pickup radius (future)
    // Debug overlay draws a dashed circle for any entity with radius > 0.
    // Subclasses may alias this (e.g. Enemy.aggroRadius → this.radius).
    this.radius = opts.radius ?? 0;
  }

  /**
   * Legacy maxTtl accessor. Setting it (re)registers the 'life' timer so the
   * unified engine tracks it — this is why subclasses can assign this.maxTtl
   * after super() and still get a working countdown.
   */
  get maxTtl() { return this._maxTtl; }
  set maxTtl(v) {
    this._maxTtl = v ?? 0;
    if (this._maxTtl > 0) this.timers.set('life', this._maxTtl);
    else this.timers.clear('life');
  }

  /**
   * Advance the TTL clock. Call from update() or let the engine do it.
   * Delegates to the unified timer set: ticks every labeled timer, then flips
   * alive=false when this entity's life timer expires. The life timer's label
   * defaults to 'life' but subclasses (e.g. Special bombs) may use another
   * label ('fuse') via this._ttlLabel so the debug stack reads descriptively.
   * Subclasses that scale time pass a pre-scaled dt (e.g. coin passes dt*TTL_SPEED).
   * @param {number} dt seconds
   */
  tickTtl(dt) {
    if (!this.alive || this._maxTtl <= 0) return;
    const label = this._ttlLabel ?? 'life';
    this.timers.tick(dt * this.ttlSpeed);
    if (this.timers.expired(label)) this.alive = false;
  }

  /** Fraction of life remaining (1 = fresh, 0 = expired). For progress bars. */
  get ttlFrac() {
    if (this._maxTtl <= 0) return 1;
    return this.timers.fraction(this._ttlLabel ?? 'life');
  }

  /** Remaining life seconds (legacy alias over the life/fuse timer). */
  get ttl() { return this._maxTtl > 0 ? this.timers.get(this._ttlLabel ?? 'life') : 0; }

  /**
   * World-space AABB derived from the offset box.
   * Always symmetric — independent of mirror/rotation/scale.
   * @returns {{x:number, y:number, w:number, h:number}}
   */
  worldBox() {
    return {
      x: this.x + this.box.ox,
      y: this.y + this.box.oy,
      w: this.box.bw,
      h: this.box.bh,
    };
  }

  /**
   * Visual direction the sprite is pointing, in world radians.
   * Combines mirrorX + rotation into one true angle. Assumes the untransformed
   * art points RIGHT (0 rad). mirrorY does NOT affect horizontal orientation
   * (it's a vertical flip), so it's excluded here. Pure read — no mutation.
   * @returns {number} angle in radians
   */
  spriteOrientation() {
    let a = this.rotation;
    if (this.mirrorX) a = Math.PI - a; // mirrorX flips the facing direction
    return this.baseSpriteAngle + a;
  }

  /**
   * Direction of movement in world radians, or null when (nearly) stationary.
   * @param {number} threshold speed below which the entity counts as still
   * @returns {number|null} angle in radians, or null
   */
  velocityAngle(threshold = 1) {
    const speed = Math.hypot(this.vx, this.vy);
    if (speed < threshold) return null;
    return Math.atan2(this.vy, this.vx);
  }

  /** Speed magnitude (px/s). */
  velocitySpeed() {
    return Math.hypot(this.vx, this.vy);
  }

  /**
   * Derive mirrorX from facing. Call whenever `facing` changes so the
   * render flip stays in sync with the logical direction.
   */
  syncMirror() {
    this.mirrorX = (this.facing === -1);
  }

  /**
   * Basic integration step: apply gravity, clamp fall speed, move by velocity.
   * dt is in seconds (fixed 1/60 in the main loop).
   * Subclasses should call super.update(dt) then add their own logic.
   */
  update(dt) {
    if (this.gravity !== 0) {
      this.vy += GRAVITY * this.gravity * dt;
      // Terminal velocity clamp (fall only; upward speeds are unclamped).
      if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /**
   * Draw placeholder. Subclasses override; this default renders either the
   * current animation frame or a debug-colored rect at the entity center.
   * All transform state (mirror/rotate/scale) is applied here so the entity
   * remains the single source of truth for its on-screen look.
   */
  draw(ctx) {
    ctx.save();
    // Pivot at the entity's visual center.
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    if (this.mirrorX) ctx.scale(-1, 1);
    if (this.mirrorY) ctx.scale(1, -1);
    ctx.rotate(this.rotation);
    ctx.scale(this.scale, this.scale);

    if (this.anim && this.anim.frames.length > 0) {
      this.anim.draw(ctx, this);
    } else {
      ctx.fillStyle = this.debugColor;
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    }
    ctx.restore();
  }
}
