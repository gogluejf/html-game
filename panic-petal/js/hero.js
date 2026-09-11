// Petal Panic — Hero (design §4-5). The core playable character.
//
// Wraps a hero definition (see heroDefs.js) and drives run/jump/crouch/slide,
// gravity, ground friction, facing + mirrorX, and crouch-box shrink.
//
// Collision model note: the hero's collision box is an OFFSET AABB (this.box)
// relative to its origin. Crouching swaps in a shorter box (crouchBox) whose
// top edge drops by h*0.4 while keeping the feet planted — this validates the
// offset-box model end-to-end (the F3 debug overlay shows the box get shorter).

import { Entity } from './entity.js';
import { GRAVITY, MAX_FALL_SPEED, LAYER } from './consts.js';

// Feel knobs (tune freely; these are not per-hero stats).
const GROUND_FRICTION = 0.85;   // vx multiplier per fixed step when no input on ground
const SLIDE_SPEED_MULT = 1.5;   // slide = fast low movement while crouching + moving
const JUMP_CUT_VY = 0.45;       // vy scale when jump released early (variable height)
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

    // Movement state.
    this.grounded = false;
    this.crouching = false;
    this.sliding = false;

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

    // --- Crouch / stand -----------------------------------------------------
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

    // --- Horizontal intent --------------------------------------------------
    let moveDir = 0;
    if (input.left) moveDir -= 1;
    if (input.right) moveDir += 1;

    // Sliding = crouching AND actively moving horizontally.
    this.sliding = this.crouching && moveDir !== 0;

    if (moveDir !== 0) {
      this.facing = moveDir > 0 ? 1 : -1;
      this.syncMirror();
      const actualSpeed = this.sliding ? speed * SLIDE_SPEED_MULT : speed;
      this.vx = moveDir * actualSpeed;
    } else if (this.grounded) {
      // Ground friction: decay momentum toward rest.
      this.vx *= GROUND_FRICTION;
      if (Math.abs(this.vx) < 1) this.vx = 0;
    }

    // --- Jump (with coyote time + input buffer for good feel) ---------------
    // Buffer: remember a recent jump press so a slightly-early tap still fires
    // once we land. Coyote: allow a jump just after walking off a ledge.
    if (input.jump && !this._prevJumpHeld) this._jumpBuffer = JUMP_BUFFER;
    if (this._jumpBuffer > 0) this._jumpBuffer -= dt;
    if (this._coyote > 0) this._coyote -= dt;

    const canJump = this.grounded || this._coyote > 0;
    if (canJump && this._jumpBuffer > 0 && !this.crouching) {
      this.vy = -this.stats.jump;
      this.grounded = false;
      this._coyote = 0;
      this._jumpBuffer = 0;
      // Skip the jump-cut this frame so the full impulse registers.
    } else if (!input.jump && this._prevJumpHeld && this.vy < 0) {
      // Variable jump height: releasing the jump mid-ascent caps upward velocity
      // once (edge-triggered). Holding jump keeps the full arc.
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

    // --- Anim tick ----------------------------------------------------------
    if (this.anim) this.anim.tick(dt);
  }

  /**
   * Called by the main loop after resolve() so the hero knows whether it is
   * resting on a surface. Also maintains the coyote timer: entering the air
   * from a grounded state starts the grace window.
   * @param {boolean} grounded
   */
  setGrounded(grounded) {
    if (grounded && !this.grounded) {
      // Just landed: clear any buffered jump that was consumed mid-air? No —
      // a buffered jump should fire on landing (that's the point of buffering).
    }
    if (!grounded && this.grounded) {
      // Walked off a ledge: start coyote grace window.
      this._coyote = COYOTE_TIME;
    }
    this.grounded = grounded;
  }
}
