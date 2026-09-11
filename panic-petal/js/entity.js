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
  }

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
