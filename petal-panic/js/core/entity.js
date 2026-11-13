// Petal Panic — Entity base class (design §3, "Sprite Foundation Struct").
//
// The Entity is the SINGLE SOURCE OF TRUTH for an object's position and look:
//   - where it is      → x, y (+ vx, vy, gravity)
//   - how big it is    → targetH (units) + optional baseW (px)
//   - how it looks     → facing, mirrorX/Y, rotation, scale, anim
//   - what it collides → layer bitmask
//
// SIZE MODEL (single source of truth):
//   Every entity has a `targetH` (height in Y-units, 1 unit = 48px).
//   Width is determined by ONE of two owners:
//     • SHEET-OWNED (default): no `baseW` passed. When a sprite anim is set
//       via setAnim(), width = sheetCollisionBox.w × scale. Before setAnim()
//       the width defaults to targetH × 48 (square).
//     • CONSTRUCTOR-OWNED: `baseW` passed. Width is fixed at baseW regardless
//       of sprite data. Used by terrain tiles, floor, projectiles, coins,
//       hazards — anything whose logical size comes from the macro grid or
//       a fixed design spec, not from a sheet's aspect ratio.
//
//   `w` and `h` are GETTERS that resolve from the above. They are never
//   stored independently — no duplication, no stale cache. worldBox() reads
//   the same getters so physics, debug rects, and sprite rendering can never
//   drift apart.
//
// Every hero, enemy, projectile, coin, powerup, and object inherits from this.
// Subclasses override update() / draw() as needed; the defaults here give a
// working falling-box entity out of the box.

import { GRAVITY, MAX_FALL_SPEED } from '../consts.js';
import { Timers } from './timers.js';
import { uniformScale, placeSheetFrame } from './spriteData.js';
import { SpritePlayer } from './spritePlayer.js';
import { isHighGraphic } from './renderMode.js';

const UNIT_PX = 48; // mirrors macros.js UNIT_PX_Y (avoids circular import)

export class Entity {
  /**
   * @param {object} opts
   * @param {number} [opts.x]          top-left x (world px)
   * @param {number} [opts.y]          top-left y (world px)
   * @param {number} [opts.targetH]    height in Y-units (1 = 48px). Default 1.
   * @param {number} [opts.baseW]      fixed width in px (constructor-owned size).
   *                                   Omit for sheet-owned width.
   * @param {number} [opts.w]          DEPRECATED: use targetH + baseW.
   *                                   If present, baseW=w and targetH=h/48.
   * @param {number} [opts.h]          DEPRECATED: use targetH.
   *                                   If present, targetH=h/48.
   */
  constructor(opts = {}) {
    Entity.prototype.initialize.call(this, opts);
  }

  /** Initialize base state on this identity; pooled subclasses call this on reuse. */
  initialize(opts = {}) {
    // --- Position -----------------------------------------------------------
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    // Previous physics-step position (render interpolation). Captured by
    // capturePrev() at the top of each fixed step; render() lerps
    // prev→current by the loop's leftover alpha so motion is continuous at
    // any refresh rate (60Hz logic on a 75/144Hz display). Teleports detect
    // themselves via distance and snap instead of smearing.
    this.px = this.x;
    this.py = this.y;

    // --- Size (single source of truth) --------------------------------------
    // targetH: height in Y-units. Drives both the getter `h` and setAnim() scale.
    // baseW:   fixed width in px, OR null for sheet-owned width.
    // Legacy w/h in opts are translated: w→baseW, h→targetH.
    if (opts.targetH != null) {
      this._targetH = opts.targetH;
    } else if (opts.h != null) {
      this._targetH = opts.h / UNIT_PX;
    } else {
      this._targetH = 1;
    }
    this._baseW = opts.baseW ?? (opts.w != null ? opts.w : null);

    // Pose height scale (default 1). ANIM-OWNED: setAnim() is the single
    // writer, applying the active sheet's hScale field (crouch/jump sheets
    // declare 0.5; standing/attack/supermove sheets omit it = 1.0).
    this._targetHScale = 1;

    // Size-owner guard (sprites.md contract): a sprite-based entity must be
    // SHEET-OWNED — its width comes from the active anim's collision box via
    // targetH. Passing baseW while a sprite is attached at CONSTRUCTION
    // silently freezes the hitbox at a constructor square while the art
    // scales to the sheet: the exact "square box under a rectangular rocket"
    // conflict. Refuse loudly. (Late attachment — e.sprite set after
    // construction, then setAnim() — is legal: setAnim() hands over ownership
    // by clearing _baseW.)
    if (this._baseW != null && opts.sprite) {
      throw new Error(
        'Entity: baseW + sprite are mutually exclusive — sprite-based entities ' +
        'are sheet-owned (width = active anim collisionBox × scale). Drop baseW.'
      );
    }

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
    this.baseSpriteAngle = opts.baseSpriteAngle ?? 0;

    // --- Physics ------------------------------------------------------------
    this.weight = opts.weight ?? 1;     // knockback / push strength

    // --- Animation ----------------------------------------------------------
    this.anim = opts.anim ?? null;

    // --- Sprite data (sprites.md runtime wiring, v1) -------------------------
    this.sprite = opts.sprite ?? null;
    this._spriteAnim = null;
    this._player = null;
    this._spriteScale = 1;

    // --- Collision ----------------------------------------------------------
    this.layer = opts.layer ?? 0;       // bitmask (see LAYER in consts.js)
    // Optional offset for sub-region collision (rare). Size always from getters.
    this._boxOx = opts.box?.ox ?? 0;
    this._boxOy = opts.box?.oy ?? 0;

    // --- State ----------------------------------------------------------------
    this.alive = true;
    this.visible = true;

    // --- Immunity states (docs/engine/immunity.md) ---------------------------
    // Three independent, entity-level states. ANY entity can hold any of them;
    // damage, collision and contact rules all read these same flags so they
    // can never disagree.
    //   invincible  — takes no damage; still a normal body in the world.
    //   starPower   — invincible PLUS contact kills (implies invincible).
    //   intangible  — out of the collision system entirely (ghost physics).
    // Lifecycle is owned by the set*/clear* methods below — trigger sites
    // never touch the flags or timers directly.
    this.invincible = false;
    this.starPower = false;
    this.intangible = false;
    // Source tag for the ACTIVE invincibility grant ('hit' | 'powerup' |
    // 'supermove' | ...). The render layer derives the visual from it;
    // scoped clears use it to remove only their own grant.
    this.invulnSource = null;
    this.debugColor = opts.debugColor ?? '#fff';

    // --- Time-to-live (TTL) ---------------------------------------------------
    this.timers = new Timers();
    this._maxTtl = 0;
    this.maxTtl = 0;
    this.ttl = 0;
    this.ttlSpeed = opts.ttlSpeed ?? 1;
    if ((opts.maxTtl ?? 0) > 0) this.setLife(opts.maxTtl);

    // --- Effect radius --------------------------------------------------------
    this.radius = opts.radius ?? 0;
  }

  // --- Size getters (single derivation, no stored duplication) ---------------

  /** Height in world px for the ACTIVE pose. Non-transposed: targetH × 48 ×
   *  _targetHScale (crouch system sets it to CROUCH_HEIGHT_SCALE). Transposed
   *  (vertical-flight pose): the sheet box's width dim becomes the vertical
   *  extent so the AABB matches the rotated art. */
  get h() {
    const cb = this.spriteAnimData?.collisionBox;
    if (this._baseW == null && cb && this._spriteScale && this._poseTransposed) {
      return cb.w * this._spriteScale;
    }
    return this._targetH * UNIT_PX * this._targetHScale;
  }
  set h(px) { this._targetH = px / UNIT_PX; }

  /**
   * Width in world px.
   * - Constructor-owned (baseW set): returns baseW.
   * - Sheet-owned (no baseW): if a sprite anim with collisionBox is active,
   *   width = collisionBox.w × scale (aspect ratio from the sheet).
   *   _poseTransposed (vertical-flight pose): the sheet box's LONG axis points
   *   along the flight direction — w/h swap so the AABB matches the rotated
   *   art (sprite and box describe the same oriented object).
   *   Otherwise falls back to targetH × 48 (square).
   */
  get w() {
    if (this._baseW != null) return this._baseW;
    const cb = this.spriteAnimData?.collisionBox;
    if (cb && this._spriteScale) {
      return (this._poseTransposed ? cb.h : cb.w) * this._spriteScale;
    }
    return this._targetH * UNIT_PX;
  }
  set w(px) { this._baseW = px; }

  /**
   * World-space AABB. Reads the live getters — always in sync with the
   * current size owner (sheet or constructor).
   * @returns {{x:number, y:number, w:number, h:number}}
   */
  worldBox() {
    return {
      x: this.x + this._boxOx,
      y: this.y + this._boxOy,
      w: this.w,
      h: this.h,
    };
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
   * defaults to 'life'; subclasses may set this._ttlLabel to another label
   * for display purposes.
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

  /** Orient right-facing artwork toward a world vector. Canvas applies
   * mirror before rotation, so solve the angle in mirrored local space. */
  orientSprite(vx, vy) {
    if (Math.hypot(vx, vy) < 1e-9) return;
    this.mirrorX = vx < -1e-9;
    this.mirrorY = false;
    this.rotation = Math.atan2(vy, this.mirrorX ? -vx : vx);
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
    // Size-owner handover (sprites.md contract): the moment a sheet anim is
    // active, width is SHEET-OWNED — any constructor baseW is stale and must
    // not keep pinning the hitbox to a square while the art follows the sheet.
    // EXCEPTION: boxFromSheet === false (tile floors / macro-grid entities)
    // are constructor-owned BY DESIGN — the macro grid owns their width and
    // the sheet only provides scale + repeat art.
    if (this.sprite.boxFromSheet !== false) this._baseW = null;
    this._spriteAnim = name;
    // POSE HEIGHT IS ANIM-OWNED (declarative): the sheet's hScale field is the
    // single source of truth for body height in this pose. crouch/jump sheets
    // declare 0.5 (tucked); standing/attack/supermove sheets omit it (1.0).
    // setAnim() is the ONLY writer of _targetHScale — box and art are derived
    // from the same number below, so they can never drift apart. Feet stay
    // planted via the y adjust when the height changes.
    const prevH = this.h;
    this._targetHScale = data.hScale ?? 1;
    const newH = this.h;
    if (newH !== prevH) this.y += prevH - newH;
    // §4: target height in Y-units → px (POSED height — already reflects the
    // active anim's hScale). Scale fits the sheet's collision box height onto
    // that, so art and box share one derivation. Width is derived by the
    // getter: baseW set → fixed width; no baseW → sheet aspect × scale.
    const targetUnits = this._targetH * this._targetHScale;
    this._spriteScale = uniformScale(data, targetUnits * UNIT_PX);
    // Playback (T3.2): build a SpritePlayer ONLY for anims that declare a
    // playback mode. mode 'none' = frame POOL (terrain tiles etc.) — frames
    // are picked externally via _tileFrame, never played on a clock.
    // startFrame: "random" resolves to a random traversal slot HERE (per
    // setAnim call), so pooled entities re-roll their phase on every
    // respawn/initialize; int = fixed slot; absent/0 = authored start.
    let startSlot = 0;
    if (data.startFrame === 'random') {
      startSlot = Math.floor(Math.random() * data.frames.length);
    } else if (Number.isInteger(data.startFrame)) {
      startSlot = data.startFrame % data.frames.length;
    }
    this._player = data.mode && data.mode !== 'none' ? new SpritePlayer(data, startSlot) : null;
  }

  /** Active sprite AnimData (or null when no sprite anim is set/known). */
  get spriteAnimData() {
    return this.sprite?.anims?.[this._spriteAnim] ?? null;
  }

  /** Current frame index of the active sprite anim. Resolution order:
   *  1. _tileFrame != null → pattern/pool-owned (terrain tiler picks frames)
   *  2. _player           → time-driven traversal (SpritePlayer, T3.1)
   *  3. 0                 → static single-frame / no playback declared */
  get spriteFrameIndex() {
    const data = this.spriteAnimData;
    if (!data) return 0;
    if (this._tileFrame != null) return this._tileFrame % data.frames.length;
    if (this._player) return this._player.frameIndex % data.frames.length;
    return 0;
  }

  /** True once the active 'once' anim has finished its terminal frame.
   *  Gameplay reacts to this (death anims, attack recovery, …). */
  get animDone() {
    return this._player?.isDone ?? false;
  }

  /** Advance the active sprite playback by dt (no-op without a player).
   *  Called from Entity.update so every entity ticks uniformly; subclasses
   *  that override update() must call super.update(dt) to keep it running. */
  tickAnim(dt) {
    if (this._player && !this._player.isDone) this._player.tick(dt);
  }

  /** Relative-timing anims: gameplay maps [0,1] progress onto traversal (§7). */
  setProgress(p) {
    if (this._player) this._player.setProgress(p);
  }

  /** Rewind active playback (pool respawn path — no reallocation). */
  resetAnim() {
    this._spriteAnim = null;
    this._player = null;
    // Restore full height (default scale) — feet stay planted.
    const prevH = this.h;
    this._targetHScale = 1;
    const newH = this.h;
    if (newH !== prevH) this.y += prevH - newH;
    if (this._player) this._player.reset();
    // Clear the stale scale: _spriteAnim is now null so spriteFrame() would
    // skip it anyway, but a half-live state (anim set, scale from a dead
    // sheet) must never reach drawSprite() — cb would be null and the frame
    // math would throw. setAnim() recomputes it on the next attach.
    this._spriteScale = null;
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
    const f = this.spriteFrame();
    if (!f) return false;
    const { img, w, h, dx, dy, scale: s, anchorX: ax, anchorY: ay } = f;
    const nw = img.naturalWidth, nh = img.naturalHeight;

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
      const left = (this.x - ax) / s; // entity left edge relative to sheet pivot
      const right = (this.x + this.w - ax) / s; // entity right edge
      const first = Math.floor((left - dx) / fw);
      for (let i = first; dx + i * fw < right; i++) {
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
   * (offset − collision top-left) from entity top-left (or legacy centered/
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
    // Single source of truth for the delta rule (offset − pivot, uniform
    // scale, untuned fallback): placeSheetFrame(). The helper derives the
    // scale from a TARGET box height in px; passing this._spriteScale × cb.h
    // reproduces this._spriteScale exactly (setAnim fit cb.h onto that).
    // Anchor is the box center (BOX-CENTER ANCHOR CONTRACT) — mirror/rotate
    // happen around it, so the box↔art relationship never changes shape per
    // aim direction.
    const placed = placeSheetFrame(data, frame, img, this._spriteScale * data.collisionBox.h);
    if (!placed) return null;
    const { w, h, dx, dy, scale: s } = placed;
    const anchorX = this.x + this.w / 2;
    const anchorY = this.y + this.h / 2;
    return {
      img, w, h, dx, dy, scale: s, anchorX, anchorY,
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
    this.tickAnim(dt); // sprite playback advances with every entity step
  }

  // --- Render interpolation (fixed-timestep → any refresh rate) -------------
  // The loop runs physics at FIXED_DT but paints at the display rate. Between
  // two physics steps the render pass draws prev→current blended by alpha
  // (leftover time / FIXED_DT). capturePrev() snapshots the position at the
  // START of each step so that step's motion spans [prev, current].
  // Teleports (respawn, zone change, snap-to-surface) exceed TELEPORT_PX and
  // snap instead of lerping — a smeared ghost across the screen is worse than
  // a one-frame jump.

  static TELEPORT_PX = 256;

  // ===========================================================================
  // Immunity states (docs/engine/immunity.md)
  //
  // Three entity-level states, each with ONE owner of its lifecycle:
  //   setInvincible(source, duration?) / clearInvincible(source)
  //   setStarPower(duration)            / (ends with its own timer)
  //   setIntangible(duration)           / clearIntangible()
  // Trigger sites call these — never the flags or timers directly.
  // Duration = undefined → event-based: the state stays until explicitly
  // cleared (e.g. supermove lives from trigger to endSupermove).
  // Scoped clears remove ONLY their own grant, so overlapping states
  // (star picked up mid-supermove) survive each other's endings.
  // ===========================================================================

  /**
   * Grant damage immunity. Duration-based (ms→s number) or open-ended
   * (duration omitted → cleared via clearInvincible(source)). A new grant
   * never shortens a live longer one; a different source replaces the tag
   * only if it owns the (longer-or-equal) window.
   */
  setInvincible(source, duration) {
    const current = this.timers.get('invincible') ?? 0;
    if (duration == null) {
      // Event-based: no countdown — just claim the flag + tag. A live
      // timer-backed grant from another source is left untouched.
      this.invincible = true;
      if (current <= 0 || this.invulnSource === source) this.invulnSource = source;
      return;
    }
    if (duration >= current) {
      this.timers.set('invincible', duration);
      this.invulnSource = source;
    }
    this.invincible = true;
  }

  /**
   * Remove the invincibility grant owned by `source`. If another source's
   * grant is still live in the shared timer, it survives untouched.
   */
  clearInvincible(source) {
    if (this.invulnSource !== source) return; // not our grant — leave it
    this.invincible = false;
    this.invulnSource = null;
    this.timers.clear('invincible');
    // Star power rides on the same window — drop it with the grant.
    this.starPower = false;
  }

  /** Mario-star: invincible PLUS contact-kills for `duration` seconds. */
  setStarPower(duration) {
    this.starPower = true;
    this.setInvincible('powerup', duration);
  }

  /** Ghost physics: out of the collision system for `duration` seconds. */
  setIntangible(duration) {
    this.intangible = true;
    this.timers.set('intangible', duration);
  }

  /** Snap back into the collision world (barrel detonation path). */
  clearIntangible() {
    this.intangible = false;
    this.timers.clear('intangible');
  }

  /**
   * Per-frame state maintenance — call after timers.tick(). Self-expires
   * duration-based grants on the exact frame they hit zero.
   */
  syncImmunityStates() {
    if (this.invincible && this.timers.expired('invincible')) {
      this.clearInvincible(this.invulnSource);
    }
    if (this.intangible && this.timers.expired('intangible')) {
      this.clearIntangible();
    }
  }

  /** Snapshot x/y as the new "previous" position. Called once per entity at
   * the top of each fixed physics step (before integration). */
  capturePrev() {
    this.px = this.x;
    this.py = this.y;
  }

  /** Interpolated render position for alpha ∈ [0,1] (0 = at prev, 1 = at
   * current). Returns {x,y}; snaps to current when the step was a teleport. */
  renderPos(alpha) {
    const dx = this.x - this.px;
    const dy = this.y - this.py;
    if (dx * dx + dy * dy > Entity.TELEPORT_PX * Entity.TELEPORT_PX) {
      return { x: this.x, y: this.y };
    }
    return { x: this.px + dx * alpha, y: this.py + dy * alpha };
  }

  /** Mark the current position as a discrete correction (landing snap,
   * wall-push, zone change): collapse prev onto current so render
   * interpolation SNAPS instead of lerping through the discontinuity.
   * Without this, a landing frame — where collision snaps the feet to the
   * surface and/or the pose height changes — would paint the entity partway
   * DOWN into the ground for the rest of the step (the lerp can't tell a
   * snap from smooth motion when the jump is below TELEPORT_PX). */
  snapRenderInterp() {
    this.px = this.x;
    this.py = this.y;
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
   * the 'reflect' solidBehavior (projectiles, coins). Minimum-penetration axis
   * is flipped with a small energy loss and the entity is nudged out of the
   * surface so it doesn't re-collide next frame.
   *
   * DIRECTION-AWARE: the velocity component only flips when actually moving
   * INTO the face being resolved. A body resting against a surface (moving
   * away or parallel) gets pushed out but keeps its velocity untouched —
   * unconditional flipping would re-energize resting bodies every frame
   * (the coin "ice slide" bug). BEHAVIOR POLICY (who bounces vs absorbs vs
   * passes) is DATA on the entity (`solidBehavior`), consumed by the
   * collision handler — this method is pure geometry.
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
      // Horizontal face: coin center left of box center → hit the LEFT face.
      const intoFace = cx < bx ? this.vx > 0 : this.vx < 0;
      if (intoFace) this.vx = -this.vx * rest;
      this.x += (cx < bx ? -ox : ox);
    } else {
      // Vertical face: coin center above box center → hit the TOP face.
      const intoFace = cy < by ? this.vy > 0 : this.vy < 0;
      if (intoFace) this.vy = -this.vy * rest;
      this.y += (cy < by ? -oy : oy);
    }
  }
}
