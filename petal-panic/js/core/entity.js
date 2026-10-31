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

import { GRAVITY, MAX_FALL_SPEED } from '../consts.js';
import { Timers } from './timers.js';
import { uniformScale } from './spriteData.js';
import { isHighGraphic } from './renderMode.js';

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

    // --- Sprite data (sprites.md runtime wiring, v1) -------------------------
    // entity.sprite = {
    //   anchor: 'bottom-center',          // physical anchor (§3); default bottom-center
    //   targetH: 1.0,                     // target height in Y-units (§4)
    //   tile: false,                      // repeat frame across width (M7)
    //   anims: { [name]: AnimData },      // from parseSheet(); dict keyed by state name
    //   frames: Map<file, HTMLImageElement>,  // filled by loadFrames() (may be empty)
    // }
    // When set, the ACTIVE anim is tracked in this._spriteAnim (name) and
    // this._spriteScale (uniform scalar, §4). The legacy this.anim path still
    // works for entities that never adopt sprite data.
    this.sprite = opts.sprite ?? null;
    this._spriteAnim = null;
    this._spriteScale = 1;

    // --- Collision ----------------------------------------------------------
    this.layer = opts.layer ?? 0;       // bitmask (see LAYER in consts.js)
    // Offset collision box relative to origin. Defaults to full w×h.
    // NEVER mirrored: the AABB is symmetric regardless of facing.
    this.box = opts.box ?? { ox: 0, oy: 0, bw: this.w, bh: this.h };

    // --- State ----------------------------------------------------------------
    this.alive = true;
    this.visible = true;   // false = engine skips its sprite AND its collision box
    this.intangible = false;  // true = enemy hitboxes pass through, no damage taken
    this.debugColor = opts.debugColor ?? '#fff';

    // --- Time-to-live (TTL) ---------------------------------------------------
    // Unified labeled timer set. An entity can carry MANY concurrent countdowns
    // (life, fuse, death, rec, inv, rapid, ...) — see timers.js. The legacy
    // scalar `maxTtl`/`ttl` are plain fields kept in sync with the 'life' timer
    // so existing coin/projectile code keeps working while we migrate. They are
    // PLAIN FIELDS (not accessors) because the object pools copy instances via
    // Object.assign, which cannot define getter-only properties.
    this.timers = new Timers();
    this._maxTtl = 0;
    this.maxTtl = 0;   // legacy alias (total life seconds); 0 = no expiry
    this.ttl = 0;      // legacy alias (remaining life seconds)
    this.ttlSpeed = opts.ttlSpeed ?? 1;
    if ((opts.maxTtl ?? 0) > 0) this.setLife(opts.maxTtl);

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
   * Set (or clear) this entity's life countdown. Registers the 'life' timer on
   * the unified engine and syncs the legacy maxTtl/ttl fields. Subclasses call
   * this AFTER super() when they know their lifetime (e.g. Coin sets COIN_TTL).
   * @param {number} seconds total life, or <=0 to disable expiry
   */
  setLife(seconds) {
    this._maxTtl = seconds > 0 ? seconds : 0;
    this.maxTtl = this._maxTtl;
    this.ttl = this._maxTtl;
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
    // Keep the legacy ttl field in sync for any reader still using it.
    this.ttl = this.timers.get(label);
    if (this.timers.expired(label)) {
      this.ttl = 0;
      this.alive = false;
    }
  }

  /** Fraction of life remaining (1 = fresh, 0 = expired). For progress bars. */
  get ttlFrac() {
    if (this._maxTtl <= 0) return 1;
    return this.timers.fraction(this._ttlLabel ?? 'life');
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
   * Set the active sprite animation (sprites.md runtime wiring, v1).
   *
   * Looks up this.sprite.anims[name], computes the UNIFORM scale that fits the
   * anim's collision box height (§4) onto
   * this entity's collision-box height, and stores it. The entity's world
   * position (physical anchor, default bottom-center) is NOT touched — only
   * the rendered art size changes, so switching anims never teleports the
   * entity (§3).
   *
   * @param {string} name key into this.sprite.anims
   */
  setAnim(name) {
    if (!this.sprite?.anims) return;
    const data = this.sprite.anims[name];
    if (!data) throw new Error(`setAnim: unknown anim "${name}"`);
    this._spriteAnim = name;
    // §4: target height in Y-units → px (48px/unit). Width follows uniformly.
    const UNIT = 48; // mirrors macros.js UNIT_PX_Y (avoids circular import)
    const targetUnits = this.sprite.targetH ?? (this.h / UNIT);
    this._spriteScale = uniformScale(data, targetUnits * UNIT);
    // Sheet box owns the SHAPE (universal contract): unless the entity has
    // another size owner (terrain tiles/floor opt out via boxFromSheet:false —
    // their solids come from the macro grid), the physics box derives from the
    // same §4 scalar: h lands exactly on targetH×48, w keeps the sheet's ratio.
    // Render and physics can never drift apart. Pre-load (no data yet) the
    // constructor w/h stays as fallback.
    if (data.collisionBox && this.sprite.boxFromSheet !== false) {
      const s = this._spriteScale;
      this.w = data.collisionBox.w * s;
      this.h = data.collisionBox.h * s;
    }
  }

  /** Active sprite AnimData (or null when no sprite anim is set/known). */
  get spriteAnimData() {
    return this.sprite?.anims?.[this._spriteAnim] ?? null;
  }

  /** Current frame index of the active sprite anim (v1: static first frame;
   *  the SpritePlayer milestone drives this for multi-frame anims). */
  get spriteFrameIndex() {
    const data = this.spriteAnimData;
    if (!data) return 0;
    // Terrain tiles (tileSprite.js) pin a specific frame via _tileFrame;
    // everything else uses v1 static first frame until SpritePlayer lands.
    if (this._tileFrame != null) return this._tileFrame % data.frames.length;
    return 0; // TODO(sprite-engine 3.1): SpritePlayer-driven traversal
  }

  /**
   * Draw the active sprite frame through the transform pipeline (§22 v1):
   * translate to physical anchor (bottom-center by default) → uniform scale →
   * mirrorX/Y → rotate. Frame size comes from the image's natural size ×
   * per-frame tuning; position from offset (anchor space) or the legacy
   * bottom-center placement, so feet stay on the floor across anim switches. Falls back to the legacy path (anim frames or debug rect)
   * when no sprite data is active or frames haven't loaded yet.
   * @param {CanvasRenderingContext2D} ctx
   */
  drawSprite(ctx) {
    const data = this.spriteAnimData;
    const frames = this.sprite?.frames;
    if (!data || !frames || frames.size === 0) {
      // One-time diagnostic: tells us WHY the sprite fell back to the rect.
      if (data && !this._spriteWarned) {
        this._spriteWarned = true;
        const frame = data.frames[0];
        console.warn(`[sprite] ${this.type ?? 'entity'} anim "${this._spriteAnim}" has no loaded frames`,
          { expectedFile: frame?.file, cacheSize: frames?.size });
      }
      return false;
    }
    const frame = data.frames[this.spriteFrameIndex % data.frames.length];
    const img = frames.get(frame.file);
    if (!img || !(img.complete && img.naturalWidth > 0)) return false;

    const s = this._spriteScale;
    // Anchor at bottom-center of the collision box (default physical anchor).
    const ax = this.x + this.w / 2;
    const ay = this.y + this.h;
    // Frame geometry comes from the IMAGE itself (each frame is its own PNG —
    // the crop happened at asset-creation time; there is no sheet to cut into)
    // plus per-frame TUNING from the sheet JSON. DELTA RULE: the editor
    // authors frame.offset relative to ITS origin (which depends on the layout
    // button used — bottom-left, center, …), so the game never trusts offset
    // as an absolute anchor-space position. Instead it uses the delta between
    // the frame center and the BOX'S BOTTOM-CENTER (the true anchor):
    //   spriteCenter = anchor + (offset − boxBottomCenter) × s
    // Move box+frame together in the editor → delta unchanged → render
    // unchanged. Nudge the picture relative to the box → render follows.
    // Editor view = game view, regardless of which layout button was used.
    // No tuning → legacy placement (centered, bottom on the anchor line).
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const fsx = frame.scale?.sx ?? 1;
    const fsy = frame.scale?.sy ?? 1;
    const w = nw * fsx;
    const h = nh * fsy;
    let dx, dy;
    if (frame.offset && data.collisionBox) {
      const cb = data.collisionBox;
      const bcx = cb.x + cb.w / 2;          // box bottom-center in sheet space
      const bcy = cb.y + cb.h;              // (y-up: bottom = top + height)
      dx = (frame.offset.x - bcx) * s - w / 2;
      dy = (frame.offset.y - bcy) * s - h / 2;
    } else {
      dx = -w / 2;
      dy = -h;
    }

    ctx.save();
    ctx.translate(ax, ay);
    if (this.mirrorX) ctx.scale(-1, 1);
    if (this.mirrorY) ctx.scale(1, -1);
    ctx.rotate(this.rotation);
    ctx.scale(s, s);
    if (this.sprite.tile) {
      // Tile repeat: draw the frame repeatedly across the entity width so one
      // wide entity (e.g. a full-zone floor) fills its whole span with the
      // same uniform scale — no stretching, no per-tile math. The frame's
      // natural (scaled) width is the repeat period; start one period left of
      // the left edge so coverage always begins at x = -w/2.
      const fw = w;
      const left = -this.w / 2 / s; // entity left edge in scaled local units
      const right = this.w / 2 / s; // entity right edge (local units)
      const first = Math.floor(left / fw);
      for (let i = first; i * fw < right; i++) {
        ctx.drawImage(img, 0, 0, nw, nh, dx + i * fw, dy, w, h);
      }
    } else {
      ctx.drawImage(img, 0, 0, nw, nh, dx, dy, w, h);
    }
    ctx.restore();
    return true;
  }

  /**
   * Current sheet-sprite frame + transform state (effects contract). Lets an
   * effect (spriteFlash) re-draw the ACTUAL frame through this entity's own
   * pipeline instead of a rect over worldBox(). Returns null when no sheet
   * frame is loaded (primitive fallback active) — effects fall back to box
   * mode. All geometry in ANCHOR SPACE matching drawSprite(): the frame's
   * natural size (× per-frame tuning scale) is placed by the DELTA RULE —
   * (offset − box bottom-center) × s from the anchor (or legacy centered/
   * bottom-on-anchor when untuned) — scaled by `scale`, mirrored/rotated per
   * the entity state.
   * @returns {?{img:object, w:number, h:number, dx:number, dy:number,
   *             scale:number, anchorX:number, anchorY:number, mirrorX:boolean,
   *             mirrorY:boolean, rotation:number, tile:boolean, widthUnits:number}}
   */
  spriteFrame() {
    const data = this.spriteAnimData;
    const frames = this.sprite?.frames;
    if (!data || !frames || frames.size === 0) return null;
    const frame = data.frames[this.spriteFrameIndex % data.frames.length];
    const img = frames.get(frame.file);
    if (!img || !(img.complete && img.naturalWidth > 0)) return null;
    const fsx = frame.scale?.sx ?? 1;
    const fsy = frame.scale?.sy ?? 1;
    const w = img.naturalWidth * fsx;
    const h = img.naturalHeight * fsy;
    let dx, dy;
    if (frame.offset && data.collisionBox) {
      // Delta rule (same as drawSprite): offset is editor-origin-relative,
      // so place the frame by its delta from the box bottom-center.
      const cb = data.collisionBox;
      dx = (frame.offset.x - (cb.x + cb.w / 2)) * this._spriteScale - w / 2;
      dy = (frame.offset.y - (cb.y + cb.h)) * this._spriteScale - h / 2;
    } else {
      dx = -w / 2;
      dy = -h;
    }
    return {
      img,
      w, h, dx, dy,
      scale: this._spriteScale,
      anchorX: this.x + this.w / 2,
      anchorY: this.y + this.h,
      mirrorX: !!this.mirrorX,
      mirrorY: !!this.mirrorY,
      rotation: this.rotation ?? 0,
      tile: !!this.sprite.tile,
      widthUnits: this.w,
    };
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
    if (this.visible === false) return; // engine contract: invisible = not drawn
    // High-graphic: try sheet sprite first (§22 pipeline). Falls through to
    // primitive if no sprite data is loaded.
    if (isHighGraphic() && this.drawSprite(ctx)) return;
    // Primitive path (always available): basic shapes, per-entity details.
    this.drawPrimitive(ctx);
  }

  /**
   * Draw the entity's primitive (non-sprite) representation.
   * Default: a filled rect in debugColor at the entity's position.
   * Subclasses override to add details (fuse dots, whip arcs, spin squash, etc.)
   * and call super.drawPrimitive(ctx) for the base body.
   */
  drawPrimitive(ctx) {
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    if (this.mirrorX) ctx.scale(-1, 1);
    if (this.mirrorY) ctx.scale(1, -1);
    ctx.rotate(this.rotation);
    ctx.scale(this.scale, this.scale);
    ctx.fillStyle = this.debugColor;
    ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }

  /**
   * Reflect velocity off a solid AABB — the shared physics primitive behind
   * the 'reflect' solidBehavior (projectiles). Minimum-penetration axis is
   * flipped with a small energy loss and the entity is nudged out of the
   * surface so it doesn't re-collide next frame. BEHAVIOR POLICY (who bounces
   * vs absorbs vs passes) is DATA on the entity (`solidBehavior`), consumed by
   * the collision handler — this method is pure geometry.
   * @param {{x:number,y:number,w:number,h:number}} box world-space solid AABB
   */
  reflectVelocity(box) {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const bx = box.x + box.w / 2, by = box.y + box.h / 2;
    const ox = (this.w / 2 + box.w / 2) - Math.abs(cx - bx);
    const oy = (this.h / 2 + box.h / 2) - Math.abs(cy - by);
    if (ox <= 0 || oy <= 0) return;
    // Constant-apex carriers (bounceHeight set) reflect with NO energy loss —
    // they ping-pong at exact speed until ttl. Legacy entities keep 0.8.
    const rest = this.bounceHeight != null ? 1.0 : 0.8;
    if (ox < oy) {
      this.vx = -this.vx * rest;
      this.x += (cx < bx ? -ox : ox);
    } else {
      this.vy = -this.vy * rest;
      this.y += (cy < by ? -oy : oy);
    }
  }
}
