// Petal Panic — Hero (design §4-5). The core playable character.
//
// Wraps a hero definition (see heroDefs.js) and drives run/jump/crouch/slide,
// gravity, ground friction, facing + mirrorX, and crouch-box shrink.
//
// Collision model note: the hero's collision box is an OFFSET AABB (this.box)
// relative to its origin. Crouching swaps in a shorter box (crouchBox) whose
// top edge drops by h*0.4 while keeping the feet planted — this validates the
// offset-box model end-to-end (the debug overlay shows the box get shorter).

import { Entity } from './entity.js';
import { GRAVITY, MAX_FALL_SPEED, LAYER } from './consts.js';

// Feel knobs (tune freely; these are not per-hero stats).
const GROUND_FRICTION = 0.85;   // vx multiplier per fixed step when no input on ground
const JUMP_CUT_VY = 0.45;       // vy scale when jump released early (variable height)
const SLIDE_DECEL = 480;        // px/s^2 — crouch skid: ~0.5s / ~65px from full run
const COYOTE_TIME = 0.08;       // grace window after leaving a ledge (s)
const JUMP_BUFFER = 0.12;       // pre-land jump input window (s)

export class Hero extends Entity {
  /**
   * @param {object} heroDef one of HEROES from heroDefs.js
   * @param {number} [x] spawn x (top-left of standing box)
   * @param {number} [y] spawn y (top-left of standing box)
   */
  constructor(heroDef, x = 0, y = 0) {
    super({
      x, y,
      w: heroDef.w ?? 32,
      h: heroDef.h ?? 48,
      gravity: 1,
      layer: LAYER.HERO,
      facing: 1,
      debugColor: '#2ecc71',
    });

    this.heroDef = heroDef;
    this.stats = { ...heroDef.stats };

    // Resources / combat state.
    this.energy = heroDef.stats.stamina;
    this.maxEnergy = heroDef.stats.stamina;
    this.shield = 0;
    this.ammo = 200;
    this.specialAmmo = 0;
    this.coins = 0;
    this.lives = 3;
    this.invincibleTimer = 0;
    this.rapidTimer = 0;
    this.checkpoint = { x, y };

    // --- Death / respawn / continue (Task 5.2) -------------------------------
    // dying: hero has hit 0 energy and is playing the skull-fade death sequence.
    // deathTimer: seconds elapsed since death started (drives skull motion/fade).
    // DEATH_DURATION: total length of the skull animation before respawn/gameover.
    // continuesUsed / maxContinues + CONTINUE_COST drive the gameover Continue
    // option (design §1: 3 continues per run, each costs CONTINUE_COST coins).
    this.dying = false;
    this.deathTimer = 0;
    this.DEATH_DURATION = 1.5;
    this.continuesUsed = 0;
    this.maxContinues = 3;

    // Movement state.
    this.grounded = false;
    this.crouching = false;
    this.sliding = false;
    this.jumpsUsed = 0;          // 0=grounded, 1=first jump used, 2=double jump used
    this.MAX_JUMPS = 2;          // ground jump + 1 air jump

    // --- Melee swing (design §4) --------------------------------------------
    // A swing is a short, non-looping animation with exactly ONE active frame —
    // the "peak" of the arc. Damage is only dealt while that frame is showing
    // (see meleeHitboxWorld). The cooldown spans the whole swing so you can't
    // spam: tryMelee() is ignored until the current swing has fully finished.
    this.meleeCooldown = 0;          // seconds until the next swing may start
    this.meleeActive = false;        // true while a swing is in progress
    this.meleeFrame = 0;             // float frame position within the swing
    this.MELEE_TOTAL_FRAMES = 5;     // windup(0-2) + active(3) + recovery(4)
    this.MELEE_ACTIVE_FRAME = 3;     // 0-indexed peak frame (the hitbox window)
    this.MELEE_FRAME_DURATION = 0.08;// seconds per frame → 0.4s total swing
    // Hitbox relative to hero center; ox is offset in the facing direction and
    // flipped when facing left (see meleeHitboxWorld).
    this.meleeHitbox = { ox: 20, oy: -10, bw: 40, bh: 40 };

    // Offset collision boxes (relative to origin). Standing = full w×h.
    // Crouch keeps feet planted: top drops by h*0.4, height becomes h*0.6.
    this.standBox = { ox: 0, oy: 0, bw: this.w, bh: this.h };
    this.crouchBox = { ox: 0, oy: this.h * 0.4, bw: this.w, bh: this.h * 0.6 };
    this.box = this.standBox;

    // Anim registry (real sprites later; placeholder frames attached by caller).
    this.anims = {};

    // Internal feel timers.
    this._coyote = 0;
    this._jumpBuffer = 0;
    this._prevJumpHeld = false;
  }

  /**
   * Per-frame step.
   * @param {number} dt seconds (fixed 1/60)
   * @param {object} input { left, right, up, down, jump, shoot, special, melee }
   * @param {object} world unused for now (collision resolve happens in main loop)
   */
  update(dt, input, _world) {
    const speed = this.stats.speed;

    // --- Horizontal intent --------------------------------------------------
    // Crouching locks horizontal control (SMB1): once crouched you cannot
    // accelerate or steer, only carry existing momentum and skid to a stop.
    //
    // One-frame grace: when you FIRST press down this frame (wasCrouching was
    // false), we still honor the held direction for THIS frame so the run
    // momentum carries into the skid instead of stopping dead on the press.
    // From the next frame on, crouching fully locks control and the decel
    // below bleeds the momentum off — that's the visible "slide then stop".
    const wasCrouching = this.crouching;
    let moveDir = 0;
    if (!this.crouching || !wasCrouching) {
      if (input.left) moveDir -= 1;
      if (input.right) moveDir += 1;
    }

    // Sliding = crouching with residual momentum still carrying forward.
    this.sliding = this.crouching && Math.abs(this.vx) > 20;

    if (moveDir !== 0) {
      this.facing = moveDir > 0 ? 1 : -1;
      this.syncMirror();
      this.vx = moveDir * speed;
    } else if (this.grounded) {
      // No horizontal input on the ground. Two distinct feels:
      //   • Crouching (SMB1 slide/skid): strong linear deceleration — you keep
      //     sliding a short distance before stopping, like ice. Because crouch
      //     locks control, this is the ONLY way momentum bleeds off while
      //     crouched, giving "run + press down" its skid-stop feel.
      //   • Standing: gentle exponential friction back to rest.
      if (this.crouching && Math.abs(this.vx) > 0) {
        const decel = SLIDE_DECEL * dt; // px/s removed this step
        if (Math.abs(this.vx) <= decel) this.vx = 0;
        else this.vx -= Math.sign(this.vx) * decel;
      } else {
        this.vx *= GROUND_FRICTION;
        if (Math.abs(this.vx) < 1) this.vx = 0;
      }
    }

    // --- Crouch / stand (runs AFTER movement so the first press keeps momentum)
    // Crouch only initiates while grounded. Release down → stand back up.
    if (this.crouching && !input.down) {
      this.crouching = false;
      this.sliding = false;
      this.box = this.standBox;
    }
    if (input.down && this.grounded && !this.crouching) {
      this.crouching = true;
      this.box = this.crouchBox;
    }

    // --- Jump (with coyote time + input buffer for good feel) ---------------
    // Buffer: remember a recent jump press so a slightly-early tap still fires
    // once we land. Coyote: allow a jump just after walking off a ledge.
    const jumpPressed = input.jump && !this._prevJumpHeld; // edge-triggered press
    if (jumpPressed) this._jumpBuffer = JUMP_BUFFER;
    if (this._jumpBuffer > 0) this._jumpBuffer -= dt;
    if (this._coyote > 0) this._coyote -= dt;

    // Keep the double-jump counter honest: while on the ground you always have
    // both jumps available. Resetting here (not only on the landing transition)
    // means the counter can never get "stuck" and block a ground jump.
    if (this.grounded) this.jumpsUsed = 0;

    const canGroundJump = (this.grounded || this._coyote > 0) && this.jumpsUsed === 0;
    // Air (double) jump needs a FRESH press — holding the first jump must not
    // also trigger the second. That's why we gate on jumpPressed, not the
    // buffered value (the buffer is meant to carry a press across landing).
    const canAirJump = !this.grounded && this.jumpsUsed === 1;
    if ((canGroundJump || canAirJump) && this._jumpBuffer > 0 && !this.crouching) {
      const isDouble = canAirJump;
      this.vy = -this.stats.jump * (isDouble ? 0.85 : 1); // double jump slightly weaker
      this.grounded = false;
      this._coyote = 0;
      this._jumpBuffer = 0;
      this.jumpsUsed += 1;
    } else if (!input.jump && this._prevJumpHeld && this.vy < 0) {
      // Variable jump height: releasing the jump mid-ascent caps upward velocity.
      this.vy *= JUMP_CUT_VY;
    }
    this._prevJumpHeld = input.jump;

    // --- Gravity ------------------------------------------------------------
    this.vy += GRAVITY * dt;
    if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;

    // --- Integrate ----------------------------------------------------------
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // NOTE: solid positional correction (resolve) is performed by the main
    // loop AFTER all entities integrate; it sets grounded via setGrounded().
    // Here we only track intent and integrate.

    // --- Timers -------------------------------------------------------------
    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
    if (this.rapidTimer > 0) this.rapidTimer -= dt;

    // --- Melee swing tick ---------------------------------------------------
    // Advance the swing frame clock and drive the attack animation so its
    // displayed frame stays in lockstep with the damage window.
    this.updateMelee(dt);

    // --- Anim tick ----------------------------------------------------------
    if (this.anim) this.anim.tick(dt);
  }

  /**
   * Start a melee swing if one is not already in progress. Edge-triggered:
   * call once per J press (the update system does this). While a swing is
   * active — or during the cooldown tail — further calls are ignored, which
   * is what prevents spamming.
   */
  tryMelee() {
    if (this.meleeCooldown > 0 || this.meleeActive) return;
    this.meleeFrame = 0;
    this.meleeActive = true;
    this.meleeCooldown = this.MELEE_TOTAL_FRAMES * this.MELEE_FRAME_DURATION;
    // Jump the attack anim to frame 0 so it plays from the windup.
    if (this.anims.attack) this.anims.attack.reset();
  }

  /**
   * Advance the swing's internal frame clock by dt. When the last frame has
   * elapsed the swing ends (active flag cleared, frame reset). The cooldown
   * itself is decremented by the caller alongside other timers.
   * @param {number} dt seconds
   */
  updateMelee(dt) {
    if (this.meleeCooldown > 0) this.meleeCooldown -= dt;
    if (!this.meleeActive) return;
    this.meleeFrame += dt / this.MELEE_FRAME_DURATION;
    if (this.meleeFrame >= this.MELEE_TOTAL_FRAMES) {
      this.meleeActive = false;
      this.meleeFrame = 0;
    } else if (this.anims.attack) {
      // Keep the visible attack frame aligned with the logical frame index.
      this.anims.attack.pickFrame(Math.floor(this.meleeFrame));
    }
  }

  /**
   * World-space AABB of the melee hitbox, or null when no damage should be
   * dealt this frame. Only the single ACTIVE frame produces a box — windup
   * (frames 0-2) and recovery (frame 4) return null, so damage lands exactly
   * on the peak of the arc.
   * @returns {{x:number,y:number,w:number,h:number}|null}
   */
  get meleeHitboxWorld() {
    if (!this.meleeActive) return null;
    if (Math.floor(this.meleeFrame) !== this.MELEE_ACTIVE_FRAME) return null;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const dir = this.facing;
    return {
      x: cx + dir * this.meleeHitbox.ox - (dir < 0 ? this.meleeHitbox.bw : 0),
      y: cy + this.meleeHitbox.oy,
      w: this.meleeHitbox.bw,
      h: this.meleeHitbox.bh,
    };
  }

  /**
   * Called by the main loop after resolve() so the hero knows whether it is
   * resting on a surface. Also maintains the coyote timer: entering the air
   * from a grounded state starts the grace window.
   * @param {boolean} grounded
   */
  setGrounded(grounded) {
    if (grounded && !this.grounded) {
      // Just landed: reset jump count for double-jump.
      this.jumpsUsed = 0;
    }
    if (!grounded && this.grounded) {
      // Walked off a ledge: start coyote grace window.
      this._coyote = COYOTE_TIME;
    }
    this.grounded = grounded;
  }

  /**
   * Begin the death sequence (Task 5.2). Called by the update system once
   * energy reaches 0 and no death is already in progress. The hero becomes
   * invisible for DEATH_DURATION seconds while a skull emoji floats up in a
   * sine wave and fades; on completion the caller respawns or transitions to
   * game over. No-op if already dying (guards against re-triggering mid-fade).
   */
  die() {
    if (this.dying) return;
    this.dying = true;
    this.deathTimer = 0;
    this.energy = 0;
    // Freeze momentum so the corpse doesn't drift during the fade.
    this.vx = 0;
    this.vy = 0;
  }

  /**
   * Respawn at the last checkpoint with full energy and brief i-frames (Task
   * 5.2). Clears the death flag, restores energy/ammo-independent resources,
   * and grants RESPAWN_IFRAMES of invincibility so the player isn't instantly
   * killed again at the spawn point.
   */
  respawn() {
    const cp = this.checkpoint ?? { x: 0, y: 0 };
    this.x = cp.x;
    this.y = cp.y;
    this.vx = 0;
    this.vy = 0;
    this.energy = this.maxEnergy;
    this.alive = true;
    this.dying = false;
    this.deathTimer = 0;
    this.invincibleTimer = Math.max(this.invincibleTimer, Hero.RESPAWN_IFRAMES);
    this.crouching = false;
    this.sliding = false;
    this.jumpsUsed = 0;          // 0=grounded, 1=first jump used, 2=double jump used
    this.MAX_JUMPS = 2;          // ground jump + 1 air jump
    this.box = this.standBox;
    this.meleeActive = false;
    this.meleeFrame = 0;
    this.meleeCooldown = 0;
  }

  /**
   * Draw the hero. When crouching, scale the sprite to match the crouch box
   * height so the visual matches the collision box (no "two boxes" artifact).
   */
  draw(ctx) {
    ctx.save();
    // When crouching, pivot at the FEET (bottom-center) so the sprite shrinks
    // downward-to-upward, matching the crouchBox which keeps feet planted.
    const cx = this.x + this.w / 2;
    const cy = this.crouching ? this.y + this.h : this.y + this.h / 2;
    ctx.translate(cx, cy);
    if (this.mirrorX) ctx.scale(-1, 1);
    if (this.mirrorY) ctx.scale(1, -1);
    ctx.rotate(this.rotation);
    const scaleY = this.crouching ? 0.6 : 1;
    ctx.scale(this.scale, this.scale * scaleY);
    // Offset so the sprite draws relative to the pivot.
    const offsetY = this.crouching ? -this.h : -this.h / 2;

    if (this.anim && this.anim.frames.length > 0) {
      this.anim.draw(ctx, this);
    } else {
      ctx.fillStyle = this.debugColor;
      ctx.fillRect(-this.w / 2, offsetY, this.w, this.h * scaleY);
    }
    ctx.restore();
  }
}

// Seconds of invincibility granted on respawn (design §1 / Task 5.2). Static so
// tests can read it without instantiating a hero.
Hero.RESPAWN_IFRAMES = 1.0;
