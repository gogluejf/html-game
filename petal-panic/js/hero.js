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
import { aimFromInput, DIR_RIGHT, DIR_LEFT, DIR_DOWN } from './projectile.js';

// Feel knobs (tune freely; these are not per-hero stats).
const GROUND_FRICTION = 0.85;   // vx multiplier per fixed step when no input on ground
const JUMP_CUT_VY = 0.45;       // vy scale when jump released early (variable height)
const SLIDE_DECEL = 480;        // px/s^2 — crouch skid: ~0.5s / ~65px from full run
const COYOTE_TIME = 0.08;       // grace window after leaving a ledge (s)
const JUMP_BUFFER = 0.12;       // pre-land jump input window (s)
// One-way platform drop-through (design §13): Down+Jump while standing on a
// one-way platform temporarily ignores that platform long enough to clear it,
// instead of consuming the press as an upward jump. Named constant — the value
// is tuned so gravity carries the hero fully below the platform thickness
// (~16px) before the window expires.
const DROP_THROUGH_TIME = 0.25; // seconds the one-way solid stays ignored
// Air control (design §8): when starting horizontal movement in the air from
// near-zero velocity, accelerate toward run speed over a short ramp instead of
// snapping to full speed in one frame. Ground stays arcade-immediate (§7).
const AIR_ACCEL = 1400;         // px/s^2 ramp for airborne horizontal intent
// Blocked-on-ground (design §8 solid-obstacle case): resolve() stamps a
// per-frame _blockedX flag when a solid actually cancelled horizontal motion.
// A grounded hero pinned against a wall can never accumulate vx, so its held
// direction must use the air ramp — snapping to full run speed would launch it
// at max velocity the instant it jumps out of the barrel. This is distinct from
// a grounded hero standing still at rest (vx≈0 but NOT blocked), which gets the
// arcade-immediate ground snap (§7). The velocity heuristic alone can't tell
// these apart; the collision flag is the reliable signal.

// Contextual knockback profiles (design §25): hero recoil is NOT one universal
// value — it depends on the impact source. Each profile carries its own
// strength (px/s), recovery (hit-stun seconds, §24/§26) and i-frame window
// (§27). Damage and knockback are INDEPENDENT properties: two attacks can deal
// equal damage with very different recoil, so callers pass the source key and
// never inline these numbers.
export const KNOCKBACK_PROFILES = {
  contact:     { strength: 260, recovery: 0.25, iFrames: 0.60 }, // enemy body
  bossContact: { strength: 340, recovery: 0.30, iFrames: 0.70 }, // boss body
  projectile:  { strength: 220, recovery: 0.25, iFrames: 0.30 }, // ordinary foe shot
  heavyProj:   { strength: 300, recovery: 0.30, iFrames: 0.40 }, // heavy foe shot
  explosion:   { strength: 380, recovery: 0.30, iFrames: 0.60 }, // barrel/bomb AoE
};

/** Fallback profile for unknown sources (keeps takeHit total; no magic numbers). */
const DEFAULT_KNOCKBACK_SOURCE = 'contact';

// --- Weapon selection (design §21) -------------------------------------------
// N toggles the selected weapon between Thorn and Special; J always fires the
// SELECTED weapon through one shared shoot path. Each weapon keeps its own
// ammo pool and cooldown timer. The selection persists until toggled again.
export const WEAPON_THORN = 'thorn';
export const WEAPON_SPECIAL = 'special';

/** Hero knockback resistance modifier (§25): scales every profile's strength. */
const HERO_KNOCKBACK_RESISTANCE = 1;

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
    // §21: each weapon has its own ammo pool. Fresh runs start with no special
    // ammo (§20: "No ammo: no projectile is created.") — the powerup system
    // grants special ammo during a run.
    this.specialAmmo = 0;
    // §21 Weapon Switching: N toggles the SELECTED weapon ('thorn' | 'special');
    // J always fires whatever is selected through one shared shoot path. The
    // selection persists until toggled again.
    this.selectedWeapon = WEAPON_THORN;
    this.coins = 0;
    this.lives = 3;
    // Invincibility + rapid-fire are now unified labeled timers (see timers.js),
    // exposed via the getters/setters below so legacy call sites
    // (boss.js, powerup.js, update.js) keep working unchanged. The debug
    // overlay shows them as 'intangible' and 'rapid' bars in the per-entity stack.
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

    // --- Shared melee input buffer (design §17-§18) --------------------------
    // Normal and special melee share ONE pending slot of capacity 1:
    // 'normal' | 'special' | null. A melee press during an in-progress attack
    // stores or REPLACES this value (latest valid input wins) — there is never
    // a multi-action queue. The buffered action executes only after the
    // current attack's recovery finishes NATURALLY; buffering never shortens
    // recovery (§18). Cancellation clears the slot (task 3.2).
    this.pendingMelee = null;

    // --- Special melee (design §15) ------------------------------------------
    // Down+Melee triggers a per-hero special swing with a self-supplied
    // trajectory (Balthazar advances, Scarlet retreats). Same phase rules as
    // normal melee (§16): windup+active are committed (own vx, no cancel),
    // recovery is cancellable by jump/movement. Frame timing reuses the same
    // MELEE_FRAME_DURATION clock as the normal swing — no new timing system.
    this.specialMeleeActive = false;   // true while a special swing is playing
    this.specialMeleePhase = null;     // 'windup' | 'active' | 'recovery' | null
    this.specialMeleeFrame = 0;        // float frame position within the swing
    this.specialMeleeDir = 1;          // resolved dir: facing * config.direction

    // Offset collision boxes (relative to origin). Standing = full w×h.
    // Crouch keeps feet planted: top drops by h*0.4, height becomes h*0.6.
    this.standBox = { ox: 0, oy: 0, bw: this.w, bh: this.h };
    this.crouchBox = { ox: 0, oy: this.h * 0.4, bw: this.w, bh: this.h * 0.6 };
    this.box = this.standBox;

    // --- Super move (design §22-§23) ------------------------------------------
    // Charges over time; when full the hero can dash forward. Triggered by the
    // super intent when the meter is full. The dash has TWO explicit phases
    // (§23): a committed BURST (first ~60% — high horizontal speed, no gravity,
    // jump CANNOT cancel) and a DECEL/recovery tail (last ~40% — gravity
    // resumes, horizontal speed decays, jump MAY cancel out of it).
    this.supermoveMeter = 0;         // 0..100
    this.SUPERMOVE_MAX = 100;
    this.SUPERMOVE_CHARGE_RATE = 20; // per second → 5s to full
    this.supermoveActive = false;    // true while the dash is playing
    this.supermovePhase = null;      // 'burst' | 'decel' | null (not dashing)
    this.supermoveTimer = 0;         // seconds remaining in the CURRENT phase
    this._supermoveElapsed = 0;      // total seconds since trigger (never resets mid-dash)
    this.SUPERMOVE_DUR = 0.6;        // total dash duration
    this.SUPERMOVE_BURST_FRAC = 0.6; // fraction of the dash that is the committed burst
    this.SUPERMOVE_SPEED = 900;      // px/s at dash start (decays linearly to 0)
    this.SUPERMOVE_RESIDUAL = 80;    // px/s small forward nudge kept when the dash ends
    this.supermoveHitbox = { ox: 20, oy: -this.h / 2, bw: 16, bh: this.h }; // thin, full body height, in front

    // Anim registry (real sprites later; placeholder frames attached by caller).
    this.anims = {};

    // Internal feel timers.
    this._coyote = 0;
    this._jumpBuffer = 0;
    this._prevJumpHeld = false;
    // Dedicated prev-jump tracker for melee recovery cancels (§16/§19).
    // _prevJumpHeld is updated inside update() BEFORE the melee phase machines
    // run, so a fresh-press check against it there would always read stale
    // state. This flag is only written at the very end of each melee tick —
    // giving both cancel checks (normal + special) a true edge signal.
    this._prevMeleeJumpHeld = false;

    // One-way platform drop-through (design §13). _dropTimer > 0 while the
    // hero is intentionally passing through a one-way platform: resolve() is
    // told to ignore one-way solids until it expires, so gravity carries the
    // hero fully below the platform before it becomes landable again. Solid
    // terrain (floor / barrels) is never affected — they carry no oneWay flag.
    this._dropTimer = 0;
  }

  /** True while the drop-through window is active (one-way solids ignored). */
  get droppingThrough() { return this._dropTimer > 0; }

  /**
   * Begin a one-way platform drop-through (design §13 "Drop Through"). Called
   * by the update system when Down+Jump fires while standing on a one-way
   * platform: the platform is ignored for DROP_THROUGH_TIME seconds and the
   * jump press is NOT consumed as an upward jump (jumpsUsed unchanged).
   */
  startDropThrough() {
    this._dropTimer = DROP_THROUGH_TIME;
  }

  // --- Legacy timer bridges -------------------------------------------------
  // rapidTimer is a unified labeled timer ('rapid').
  // Intangibility is now a proper state (this.intangible) driven by the
  // 'intangible' timer — no more 'inv' timer or invincibleTimer accessor.

  /** Remaining rapid-fire seconds (0 when not active). */
  get rapidTimer() { return this.timers.get('rapid'); }
  /** Set/refresh rapid-fire window. max()-style: passing a value extends only if longer. */
  set rapidTimer(v) {
    if (v == null || v <= 0) { this.timers.clear('rapid'); return; }
    this.timers.set('rapid', Math.max(this.timers.get('rapid'), v));
  }

  /** True while the hero is in hit-stun (recovery) — input is locked. */
  get hitStunned() { return this.timers.get('rec') > 0; }

  /**
   * Apply a hit reaction: contextual knockback impulse + hit-stun (recovery) +
   * i-frames. This is the single entry point for every damaging collision
   * (enemy contact, boss contact, enemy projectile, barrel/bomb explosion).
   *
   * Knockback comes from the per-source KNOCKBACK_PROFILES table (design §25):
   * callers pass a source KEY ('contact' | 'bossContact' | 'projectile' |
   * 'heavyProj' | 'explosion') plus the impact direction; no raw strength /
   * recovery / i-frame numbers are passed in. Damage and knockback stay
   * independent — damage() handles HP, this handles recoil only.
   *
   * If the hero is already intangible (i-frames up), the hit is ABSORBED — no
   * double-fling, no timer refresh. This matches how projectile hits already
   * behave and prevents melt while overlapping.
   *
   * @param {object} o
   * @param {string} [o.source] knockback profile key (default 'contact')
   * @param {number} o.dirX knockback x (normalized or raw velocity; normalized here)
   * @param {number} o.dirY knockback y
   * @returns {boolean} true if the hit landed, false if absorbed by i-frames
   */
  takeHit({ source = DEFAULT_KNOCKBACK_SOURCE, dirX = 0, dirY = 0 }) {
    if (this.dying) return false;
    if (this.intangible) return false; // intangible absorbs it
    const profile = KNOCKBACK_PROFILES[source] ?? KNOCKBACK_PROFILES[DEFAULT_KNOCKBACK_SOURCE];
    const len = Math.hypot(dirX, dirY) || 1;
    const kb = profile.strength * HERO_KNOCKBACK_RESISTANCE;
    this.vx += (dirX / len) * kb;
    this.vy += (dirY / len) * kb;
    // Hit-stun (§24/§26): input locked, physics keep running; knockback decays
    // under friction during the window and control resumes cleanly after.
    this.timers.set('rec', profile.recovery);
    // Intangible for the i-frame duration (§27): drives both the state flag and
    // the render blink (which reads the timer's remaining fraction).
    this.intangible = true;
    this.timers.set('intangible', Math.max(this.timers.get('intangible'), profile.iFrames));
    return true;
  }

  /**
   * Per-frame step.
   * @param {number} dt seconds (fixed 1/60)
   * @param {object} input { left, right, up, down, jump, shoot, special, melee }
   * @param {object} world unused for now (collision resolve happens in main loop)
   */
  update(dt, input, _world) {
    const speed = this.stats.speed;

    // --- Crouch / stand (runs BEFORE movement so the exit is atomic) --------
    // §11: state, movement restrictions, hitbox and animation must transition
    // together. The exit MUST be resolved before horizontal input is evaluated:
    // on the frame Down is released while a direction is held, the standing
    // hitbox + full locomotion must apply the SAME frame (no one-frame lag where
    // the old crouch lock still eats the input). Crouch only initiates while
    // grounded. §4 "Movement Locked": while lockMove is held, Down no longer
    // initiates crouch — it becomes a downward aim instead (see resolveAim).
    //
    // Capture the PRE-transition crouch state first: the entry block below can
    // flip this.crouching to true THIS frame, and the grace check in the
    // movement branch needs to know whether the hero was ALREADY crouched when
    // this frame began. Capturing after the entry block would make
    // wasCrouching === this.crouching always and kill the grace condition.
    const wasCrouching = this.crouching;
    // §24: during hit-stun, normal player input is temporarily locked — Down
    // must not initiate or cancel crouch while recovery is active.
    if (!this.hitStunned) {
      if (this.crouching && (!input.down || input.lockMove)) {
        this.exitCrouch();
      }
      if (input.down && !input.lockMove && this.grounded && !this.crouching) {
        this.crouching = true;
        this.box = this.crouchBox;
      }
    }

    // --- Horizontal intent --------------------------------------------------
    // Crouching locks horizontal control (SMB1): once crouched you cannot
    // accelerate or steer, only carry existing momentum and skid to a stop.
    //
    // One-frame grace: when you FIRST press down this frame (wasCrouching was
    // false), we still honor the held direction for THIS frame so the run
    // momentum carries into the skid instead of stopping dead on the press.
    // From the next frame on, crouching fully locks control and the decel
    // below bleeds the momentum off — that's the visible "slide then stop".
    // Hit-stun (recovery): while active, input is locked and the knockback
    // velocity plays out under friction instead of being overwritten by control.
    // This is what makes a hit "fling" you back before you regain control.
    const stunned = this.hitStunned;
    let moveDir = 0;
    if (!stunned && (!this.crouching || !wasCrouching)) {
      if (input.left) moveDir -= 1;
      if (input.right) moveDir += 1;
    }

    // Sliding = crouching with residual momentum still carrying forward.
    // Epsilon gate: the flag stays true for the entire skid until vx is
    // clamped to exactly 0 in the slide-decel branch below, so state/anim/
    // hitbox never desync from velocity (§11). The epsilon only guards float
    // dust; it must sit BELOW the per-frame decel step (SLIDE_DECEL * dt ≈ 8)
    // or the flag would flip one frame before rest.
    this.sliding = this.crouching && Math.abs(this.vx) > 0.5;

    if (this.supermoveActive) {
      // Super dash owns vx/vy — skip all normal movement control.
      // (updateSupermove below will set the dash velocity.)
    } else if (this.specialMeleeActive && this.specialMeleePhase !== 'recovery') {
      // Special melee windup/active (§15): the committed trajectory OWNS vx —
      // held input cannot steer or reverse it mid-attack. updateSpecialMelee
      // sets vx = dir * travelSpeed after this block, so we must not write it
      // here. Gravity still applies; jump-cancel is blocked (committed).
    } else if (stunned) {
      // No control during recovery: bleed the knockback off with friction so it
      // travels a short distance then settles, rather than stopping dead or
      // being instantly overridden by held input.
      this.vx *= GROUND_FRICTION;
      if (Math.abs(this.vx) < 1) this.vx = 0;
    } else if (input.lockMove && !stunned) {
      // Aiming in place stops locomotion, not gravity or damage knockback.
      // While hit-stunned we must NOT zero vx — that would erase the knockback
      // velocity; §6: Lock Movement disables player-driven locomotion only.
      this.vx = 0;
      this.sliding = false;
    } else if (moveDir !== 0) {
      this.facing = moveDir > 0 ? 1 : -1;
      this.syncMirror();
      const targetVx = moveDir * speed;
      // Blocked on the ground (design §8 solid-obstacle case): a solid actually
      // cancelled our horizontal motion last frame (resolve() stamped
      // _blockedX). Use the air ramp here too — snapping to full run speed would
      // launch the hero at max velocity the instant it jumps out of the barrel.
      // A grounded hero standing still at rest has _blockedX false and gets the
      // arcade-immediate snap (§7); the collision flag distinguishes the two.
      const blockedOnGround = this.grounded && !!this._blockedX;
      if (!blockedOnGround && this.grounded) {
        // Ground: arcade-immediate — full run speed on the same frame (§7).
        // Opposite-direction input cancels existing momentum immediately.
        this.vx = targetVx;
      } else {
        // Air (or blocked-on-ground): accelerate toward run speed over a short
        // ramp (§8). Never snap from ~0 to full speed in one frame; legitimate
        // jump momentum is preserved because we only approach, never overwrite,
        // vx.
        const step = AIR_ACCEL * dt;
        if (Math.abs(targetVx - this.vx) <= step) this.vx = targetVx;
        else this.vx += Math.sign(targetVx - this.vx) * step;
      }
    } else if (this.grounded) {
      // No horizontal input on the ground. Two distinct feels:
      //   • Crouching (SMB1 slide/skid): strong linear deceleration — you keep
      //     sliding a short distance before stopping, like ice. Because crouch
      //     locks control, this is the ONLY way momentum bleeds off while
      //     crouched, giving "run + press down" its skid-stop feel.
      //   • Standing: gentle exponential friction back to rest.
      if (this.crouching && Math.abs(this.vx) > 0) {
        const decel = SLIDE_DECEL * dt; // px/s removed this step
        if (Math.abs(this.vx) <= decel) {
          this.vx = 0;
          // §11: clear the slide flag in the SAME frame vx is clamped to rest —
          // state and velocity transition atomically, no lingering slide anim.
          this.sliding = false;
        } else {
          this.vx -= Math.sign(this.vx) * decel;
        }
      } else {
        this.vx *= GROUND_FRICTION;
        if (Math.abs(this.vx) < 1) this.vx = 0;
      }
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
    // One-way platform drop-through (design §13): Down + Jump while standing
    // on a one-way platform drops the hero THROUGH it instead of jumping.
    // The update system supplies input.onOneWay (grounded on a one-way solid);
    // here the press starts the ignore window and is consumed — it must NOT
    // arm the jump buffer or count as a jump (jumpsUsed stays unchanged).
    // Solid terrain never sets onOneWay, so normal jumps are unaffected.
    // §31: all systems keep running this frame — only the JUMP is suppressed;
    // gravity, timers, melee, supermove and anim below still execute.
    const dropping = jumpPressed && input.down && input.onOneWay && this.grounded;
    if (dropping) {
      this.startDropThrough();
      this._jumpBuffer = 0;
    }
    // Supermove jump cancellation (§23): the committed burst is NOT cancellable;
    // once the dash enters its recovery/deceleration phase a fresh Jump press
    // cancels out of the remaining recovery (handled by endSupermove below).
    if (this.supermoveActive && this.supermovePhase === 'decel' && jumpPressed) {
      this.endSupermove();
    } else if (!dropping && !this.supermoveActive && (canGroundJump || canAirJump) && this._jumpBuffer > 0 && !stunned && !(this.specialMeleeActive && this.specialMeleePhase !== 'recovery')) {
      // §12: crouching must never force a stand-first. Jumping from crouch
      // cancels it atomically (state + hitbox + slide flag) before launch.
      if (this.crouching) this.exitCrouch();
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
    // During a supermove dash the dash owns vy: the committed burst phase has
    // no gravity (airborne slide); the decel phase applies gravity inside
    // updateSupermove() so the hero drops back toward the ground.
    if (!this.supermoveActive || this.supermovePhase === 'decel') {
      this.vy += GRAVITY * dt;
      if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;
    }

    // --- Integrate ----------------------------------------------------------
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // NOTE: solid positional correction (resolve) is performed by the main
    // loop AFTER all entities integrate; it sets grounded via setGrounded().
    // Here we only track intent and integrate.

    // --- Timers -------------------------------------------------------------
    // Unified labeled timers (intangible, rapid, rec, ...) advance together.
    this.timers.tick(dt);
    if (this.intangible && this.timers.expired('intangible')) {
      this.intangible = false;
    }
    // Drop-through window (design §13): expires naturally so the one-way
    // platform becomes landable again once the hero has cleared it.
    if (this._dropTimer > 0) this._dropTimer = Math.max(0, this._dropTimer - dt);

    // --- Melee swing tick ---------------------------------------------------
    // Advance the swing frame clock and drive the attack animation so its
    // displayed frame stays in lockstep with the damage window. Input is
    // passed for the recovery cancel (§16/§19): a fresh jump press or run
    // input during recovery ends the swing early and clears pendingMelee.
    this.updateMelee(dt, input);

    // --- Special melee tick (design §15) ------------------------------------
    // Down+Melee swing: windup/active own vx (committed trajectory), recovery
    // decays + is jump-cancellable. Runs after updateMelee; both swings are
    // mutually exclusive (startSpecialMelee refuses while a normal swing is up).
    this.updateSpecialMelee(dt, input);

    // --- Super move charge + dash -------------------------------------------
    this.updateSupermove(dt, input);

    // --- Anim tick ----------------------------------------------------------
    if (this.anim) this.anim.tick(dt);
  }

  /**
   * Toggle the selected weapon between Thorn and Special (design §21).
   * Edge-triggered by the update system on an N press — this ONLY changes the
   * selection; it never fires anything. J always fires whatever is currently
   * selected through the single shared shoot path. Each weapon keeps its own
   * ammo pool and cooldown, so toggling mid-cooldown is harmless.
   */
  toggleWeapon() {
    this.selectedWeapon = this.selectedWeapon === WEAPON_THORN ? WEAPON_SPECIAL : WEAPON_THORN;
  }

  /**
   * Start a melee swing if one is not already in progress. Edge-triggered:
   * call once per J press (the update system does this). While a swing is
   * active — or during the cooldown tail — further calls are ignored, which
   * is what prevents spamming.
   */
  tryMelee() {
    // Mutual exclusion (§15/§16): the two swings never overlap. startSpecialMelee
    // refuses while a normal swing is up; this is the symmetric guard so a
    // plain Melee press can't start a normal swing under an active special one.
    if (this.meleeCooldown > 0 || this.meleeActive || this.specialMeleeActive) return;
    this.meleeFrame = 0;
    this.meleeActive = true;
    this.meleeCooldown = this.MELEE_TOTAL_FRAMES * this.MELEE_FRAME_DURATION;
    // Jump the attack anim to frame 0 so it plays from the windup.
    if (this.anims.attack) this.anims.attack.reset();
  }

  /**
   * Shared melee entry point (design §17): one pending slot for both normal
   * and special melee, capacity exactly one. While an attack is in progress
   * the request is stored in pendingMelee — or REPLACES whatever was stored
   * (latest valid input wins; mashing can never queue two attacks). With no
   * attack in progress the action starts immediately through the existing
   * phase machines (no parallel timing).
   * @param {'normal'|'special'} kind resolved from Down+Melee context
   */
  requestMelee(kind) {
    if (this.meleeActive || this.specialMeleeActive) {
      this.pendingMelee = kind; // store OR replace (§17 latest-wins)
      return;
    }
    this._startMeleeAttack(kind);
  }

  /** Start a melee swing of the given kind via the existing phase machines. */
  _startMeleeAttack(kind) {
    if (kind === 'special') this.startSpecialMelee();
    else this.tryMelee();
  }

  /**
   * Execute the buffered melee action (design §18). Called only when the
   * current attack's recovery has finished NATURALLY: the buffer never
   * advances the frame clock or shortens recovery — it simply fires the
   * pending action the instant the swing completes on its own schedule.
   * The slot is cleared before starting so the new attack cannot re-buffer
   * into itself. Returns true if an attack was started.
   */
  executePendingMelee() {
    const kind = this.pendingMelee;
    if (!kind) return false;
    this.pendingMelee = null;
    this._startMeleeAttack(kind);
    return true;
  }

  /**
   * Advance the swing's internal frame clock by dt. When the last frame has
   * elapsed the swing ends (active flag cleared, frame reset). The cooldown
   * itself is decremented by the caller alongside other timers.
   *
   * Per-frame order matters (design §19 — cancellation always beats buffering):
   *   1. advance the frame clock
   *   2. if in RECOVERY and a valid locomotion intent arrives (fresh jump press
   *      or run/movement input) → end the attack early, CLEAR the pending melee
   *      buffer (§19), and let normal locomotion proceed this same frame.
   *   3. else if the swing finished naturally AND a melee is buffered → fire it.
   * Windup + active are committed (§16): no cancel during those frames.
   * @param {number} dt seconds
   * @param {object} input intent (jump/left/right used for recovery cancel)
   */
  updateMelee(dt, input) {
    if (this.meleeCooldown > 0) this.meleeCooldown -= dt;
    if (!this.meleeActive) return;
    // Phase derived from the frame count BEFORE advancing (frame N owns its own
    // phase): windup [0, ACTIVE_FRAME), active [ACTIVE_FRAME, TOTAL-1),
    // recovery [TOTAL-1, TOTAL).
    const f = Math.floor(this.meleeFrame);
    const inRecovery = f >= this.MELEE_TOTAL_FRAMES - 1;
    if (inRecovery && this._meleeCancelRequested(input)) {
      // Recovery cancel (§16/§19): end the swing NOW, discard the buffered
      // action — cancellation always wins and clears the buffer. Locomotion
      // resumes immediately (the movement/jump blocks in update() already ran
      // with this frame's input, so control is regained the same frame).
      this.endNormalMelee();
      this.pendingMelee = null;
      this._prevMeleeJumpHeld = !!(input && input.jump);
      return;
    }
    this.meleeFrame += dt / this.MELEE_FRAME_DURATION;
    if (this.meleeFrame >= this.MELEE_TOTAL_FRAMES) {
      this.meleeActive = false;
      this.meleeFrame = 0;
      // Clamp to exactly 0: the decrement above can leave a tiny positive float
      // (~1e-16) when the last tick overshoots the boundary. tryMelee()'s guard
      // (`meleeCooldown > 0`) would then reject a buffered 'normal' attack that
      // executePendingMelee fires on this very tick.
      this.meleeCooldown = 0;
      // Natural completion (§18): a buffered melee fires NOW — after windup →
      // active → full natural recovery — without any re-press. Buffering did
      // not shorten the swing: this tick happened on the original schedule.
      this.executePendingMelee();
    } else if (this.anims.attack) {
      // Keep the visible attack frame aligned with the logical frame index.
      this.anims.attack.pickFrame(Math.floor(this.meleeFrame));
    }
    this._prevMeleeJumpHeld = !!(input && input.jump);
  }

  /**
   * Shared recovery-cancel predicate (design §16/§19): true when the player
   * issues a valid locomotion transition out of recovery — a FRESH jump press
   * (edge-triggered via _prevMeleeJumpHeld) or a directional run input.
   * Used identically by normal and special melee so both kinds obey the same
   * cancel rules with no per-type divergence.
   * @param {object} input intent
   * @returns {boolean}
   */
  _meleeCancelRequested(input) {
    if (!input) return false;
    const jumpPressed = !!input.jump && !this._prevMeleeJumpHeld;
    const moveInput = (input.left && !input.right) || (input.right && !input.left);
    return jumpPressed || moveInput;
  }

  /** End the normal swing (natural completion or recovery cancel, §16/§19). */
  endNormalMelee() {
    this.meleeActive = false;
    this.meleeFrame = 0;
    this.meleeCooldown = 0;
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
   * Start a special melee swing (design §15). Edge-triggered by the update
   * system on Down+Melee. The trajectory is self-supplied and COMMITTED once
   * started: windup+active own vx at travelSpeed in the resolved direction
   * (facing * config.direction — Balthazar advances, Scarlet retreats).
   * Facing/mirrorX are never flipped here, so Scarlet's sprite keeps its
   * original orientation through the cartwheel.
   */
  startSpecialMelee() {
    if (this.specialMeleeActive || this.meleeActive) return;
    const cfg = this.heroDef.specialMelee;
    this.specialMeleeActive = true;
    this.specialMeleePhase = 'windup';
    this.specialMeleeFrame = 0;
    // Resolved movement direction: toward facing for balthazar (+1), away for
    // scarlet (-1). Captured ONCE at trigger — it cannot be reversed mid-attack.
    this.specialMeleeDir = this.facing * cfg.direction;
    // Jump the attack anim to frame 0 so it plays from the windup.
    if (this.anims.attack) this.anims.attack.reset();
  }

  /** Total frames of the special swing (windup + active + recovery). */
  get specialMeleeTotalFrames() {
    const f = this.heroDef.specialMelee.frames;
    return f.windup + f.active + f.recovery;
  }

  /**
   * Advance the special swing's frame clock by dt and drive its phases
   * (design §15/§16). Reuses the normal melee's MELEE_FRAME_DURATION clock.
   *   windup/active — committed: owns vx at travelSpeed, no jump/run cancel.
   *   active        — hitbox exposed via specialMeleeHitboxWorld.
   *   recovery      — vx decays; a fresh jump press cancels out early.
   * @param {number} dt seconds
   * @param {object} input intent (jump edge used for recovery cancel)
   */
  updateSpecialMelee(dt, input) {
    if (!this.specialMeleeActive) return;
    const cfg = this.heroDef.specialMelee;
    const total = this.specialMeleeTotalFrames;

    // Advance the frame clock: dt/SPECIAL_MELEE_FRAME_DURATION frames per step.
    // The special swing's frame counts are defined at 60fps (heroDefs §15), so
    // its frame duration is exactly 1/60s — at the fixed 60fps step each
    // update() call advances by exactly one integer frame, no float drift.
    // The PRE-increment value is what this update() acts on (frame N owns its
    // own phase), so a swing started at frame 0 plays windup on its first tick
    // and crosses each boundary on the exact tick the previous phase's last
    // frame completes.
    const f = Math.floor(this.specialMeleeFrame);

    // Phase is DERIVED from the frame count, never set imperatively:
    //   [0, windup)                          → windup
    //   [windup, windup+active)              → active
    //   [windup+active, windup+active+recov) → recovery
    //   >= total                             → done
    let phase;
    if (f < cfg.frames.windup) phase = 'windup';
    else if (f < cfg.frames.windup + cfg.frames.active) phase = 'active';
    else if (f < total) phase = 'recovery';
    else {
      // Natural completion: clear the swing state entirely, then let a
      // buffered melee fire (§18 — only after full natural recovery).
      this.endSpecialMelee();
      this.executePendingMelee();
      this._prevMeleeJumpHeld = !!(input && input.jump);
      return;
    }
    this.specialMeleePhase = phase;

    // Recovery cancel (§16/§19 shared rule): a fresh jump press OR any
    // horizontal movement input ends the swing early; normal control resumes
    // immediately. Checked AFTER the phase is derived so a boundary-crossing
    // frame cancels out of recovery correctly. The jump edge uses
    // _prevMeleeJumpHeld — a dedicated tracker updated at the END of this
    // method — because the shared _prevJumpHeld is already set from THIS
    // frame's input by the time update() reaches here, which would make the
    // fresh-press check always false (stale signal). Cancellation ALWAYS wins:
    // the pending melee buffer is discarded along with the remaining recovery
    // (§19 "cancellation always wins and clears the buffer").
    if (phase === 'recovery' && this._meleeCancelRequested(input)) {
      this.endSpecialMelee();
      this.pendingMelee = null;
      this._prevMeleeJumpHeld = !!input.jump;
      return;
    }

    this.specialMeleeFrame += dt / Hero.SPECIAL_MELEE_FRAME_DURATION;

    if (phase === 'recovery') {
      // Committed velocity bleeds off under friction during recovery.
      this.vx *= GROUND_FRICTION;
      if (Math.abs(this.vx) < 1) this.vx = 0;
    } else {
      // Windup + active: committed — the trajectory OWNS vx regardless of
      // held input; it cannot be reversed mid-attack.
      this.vx = this.specialMeleeDir * cfg.travelSpeed;
    }

    if (this.anims.attack) {
      this.anims.attack.pickFrame(Math.min(f, this.MELEE_TOTAL_FRAMES - 1));
    }

    // Refresh the dedicated jump-edge tracker AFTER all consumers have run,
    // so next frame's fresh-press check compares against THIS frame's state.
    this._prevMeleeJumpHeld = !!(input && input.jump);
  }

  /** End the special swing (natural completion or recovery jump-cancel). */
  endSpecialMelee() {
    this.specialMeleeActive = false;
    this.specialMeleePhase = null;
    this.specialMeleeFrame = 0;
  }

  /**
   * World-space AABB of the special melee hitbox, or null when no damage
   * should be dealt this frame. Only the ACTIVE phase produces a box; the box
   * mirrors with FACING (not the travel direction), matching how the sprite
   * is oriented — Scarlet hits in front of her original facing even while
   * retreating.
   * @returns {{x:number,y:number,w:number,h:number}|null}
   */
  get specialMeleeHitboxWorld() {
    if (!this.specialMeleeActive || this.specialMeleePhase !== 'active') return null;
    const hb = this.heroDef.specialMelee.hitbox;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const dir = this.facing;
    return {
      x: cx + dir * hb.ox - (dir < 0 ? hb.bw : 0),
      y: cy + hb.oy,
      w: hb.bw,
      h: hb.bh,
    };
  }

  /**
   * Resolve the aim direction (8-way index) from gameplay context, NOT raw
   * keys (design §32). The single directional input source is
   * input.aimX/aimY (input.js guarantees one vector for move + aim; lockDir
   * freezes it there). Context rules (design §4):
   *   - Grounded + Down → crouch/slide: shooting stays HORIZONTAL toward the
   *     current facing. There is no grounded-crouch + straight-down state.
   *   - Airborne + Down → straight-down aim.
   *   - Movement Locked + Down → straight-down aim (locomotion is already
   *     zeroed by lockMove in update()).
   *   - No directional input → horizontal shot toward facing (neutral shot).
   * @param {object} input intent { left,right,up,down,lockMove,lockDir,aimX,aimY }
   * @returns {number} 0..7 8-way aim index
   */
  resolveAim(input) {
    const down = !!input.down;
    // Lock Direction freezes the resolved aim (design §5): the frozen aim
    // (input.aimX/aimY, set by input.js) is authoritative and wins over every
    // contextual Down rule — even airborne+Down keeps shooting the locked dir.
    if (input.lockDir) return aimFromInput(input, this.facing);
    // Movement lock + Down → straight-down aim (§4 "Movement Locked"). Checked
    // first: while locked, Down no longer initiates crouch.
    if (down && input.lockMove) return DIR_DOWN;
    // Grounded + Down (or already crouched) → horizontal toward facing.
    // There is NO grounded-crouch + straight-down state (§4). The crouch flag
    // alone must NOT win while airborne: a hero who slid/fell off a ledge with
    // Down still held is now in the air, so Down means downward aim (§4).
    if (this.grounded && (this.crouching || down)) return this.facing >= 0 ? DIR_RIGHT : DIR_LEFT;
    // Airborne + Down → straight down.
    if (down) return DIR_DOWN;
    return aimFromInput(input, this.facing);
  }

  /**
   * Vertical center of the ACTIVE collision box (standing or crouch).
   * Shots spawn from here so a crouched shot originates lower than a standing
   * one — derived from the box, not the standing height (design §4 / AC #2).
   * @returns {{x:number,y:number}} world-space body center
   */
  bodyCenter() {
    const b = this.box ?? this.standBox;
    return { x: this.x + b.ox + b.bw / 2, y: this.y + b.oy + b.bh / 2 };
  }

  /**
   * Single exit path for crouch/slide (design §11): state, movement
   * restrictions, hitbox and animation must all transition together — no
   * scattered flag clears. Locomotion restrictions lift automatically because
   * update() reads the flags; the standing hitbox is restored so a hero who
   * just stood up is never hit-tested with the short crouch box.
   */
  exitCrouch() {
    this.crouching = false;
    this.sliding = false;
    this.box = this.standBox;
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
    this.intangible = true;
    this.timers.set('intangible', Hero.RESPAWN_IFRAMES);
    this.exitCrouch();
    this.jumpsUsed = 0;          // 0=grounded, 1=first jump used, 2=double jump used
    this.MAX_JUMPS = 2;          // ground jump + 1 air jump
    this.meleeActive = false;
    this.meleeFrame = 0;
    this.meleeCooldown = 0;
    this.pendingMelee = null;
    this.specialMeleeActive = false;
    this.specialMeleePhase = null;
    this.specialMeleeFrame = 0;
    this.supermoveActive = false;
    this.supermovePhase = null;
    this.supermoveTimer = 0;
    this._supermoveElapsed = 0;
    // Respawn i-frames (§27): the shared 'intangible' timer drives BOTH the
    // flag and the blink — the flag must stay true while the timer is active.
    this.intangible = true;
  }

  /**
   * Super move: charge over time, trigger dash on super intent when full.
   * The dash plays out in two explicit phases (design §23):
   *   burst — committed: high horizontal speed, no gravity, jump CANNOT cancel.
   *   decel — recovery: gravity resumes, horizontal speed decays, jump MAY
   *           cancel out of the remaining recovery.
   * @param {number} dt seconds
   * @param {object} input { super: boolean }
   */
  updateSupermove(dt, input) {
    // Charge the meter (only when not already full and not mid-dash).
    if (!this.supermoveActive && this.supermoveMeter < this.SUPERMOVE_MAX) {
      this.supermoveMeter = Math.min(this.SUPERMOVE_MAX, this.supermoveMeter + this.SUPERMOVE_CHARGE_RATE * dt);
    }

    // Trigger: super pressed + meter full + not already dashing.
    if (input.super && this.supermoveMeter >= this.SUPERMOVE_MAX && !this.supermoveActive) {
      this.triggerSupermove();
    }

    // Dash playback: committed burst → decelerating recovery.
    if (this.supermoveActive) {
      const dir = this.facing;
      // §22 velocity profile: ONE continuous linear ramp from SUPERMOVE_SPEED at
      // dash start down to SUPERMOVE_RESIDUAL at dash end, driven by TOTAL elapsed
      // time since the trigger. The phase split (burst vs decel) only governs
      // gravity and jump-cancel eligibility — it must NOT create a velocity
      // discontinuity at the handoff (supermoveTimer resets between phases).
      this._supermoveElapsed += dt;
      const f = Math.min(1, this._supermoveElapsed / this.SUPERMOVE_DUR); // 0→1 across the whole dash
      this.vx = dir * (this.SUPERMOVE_SPEED + (this.SUPERMOVE_RESIDUAL - this.SUPERMOVE_SPEED) * f);
      if (this.supermovePhase === 'burst') {
        // Committed: no gravity (handled by the gate in update()).
        this.vy = 0;
        this.supermoveTimer -= dt;
        if (this.supermoveTimer <= 0) {
          // Hand off to the recovery phase; carry the boundary velocity.
          this.supermovePhase = 'decel';
          this.supermoveTimer = this.decelDur;
        }
      } else {
        // Recovery: gravity applied in update(). A fresh Jump press cancels here
        // (see the jump block in update()).
        this.supermoveTimer -= dt;
        if (this.supermoveTimer <= 0) this.endSupermove();
      }
    }
  }

  /** Start the super dash. Resets meter, sets active state, swaps anim. */
  triggerSupermove() {
    // §24: combat inputs are locked during hit-stun — no supermove activation.
    if (this.hitStunned) return;
    this.supermoveMeter = 0;
    this.supermoveActive = true;
    // Split the total duration into the committed burst and the recovery tail.
    this.burstDur = this.SUPERMOVE_DUR * this.SUPERMOVE_BURST_FRAC;
    this.decelDur = this.SUPERMOVE_DUR - this.burstDur;
    this.decelFrac = this.decelDur / this.SUPERMOVE_DUR; // speed scale at handoff
    this.supermovePhase = 'burst';
    this.supermoveTimer = this.burstDur;
    this._supermoveElapsed = 0; // total elapsed since trigger (drives the velocity ramp)
    // Intangible for at least the dash window via the SHARED 'intangible' timer
    // (§27 common semantics — same timer as i-frames/powerups, no separate
    // bookkeeping). max() so an existing longer grant (i-frames / powerup) is
    // never truncated; we remember the pre-dash value so endSupermove() can
    // restore it when a jump-cancel ends the dash early.
    this._preSupermoveIntangible = this.timers.get('intangible');
    this.intangible = true;
    this.timers.set('intangible', Math.max(this._preSupermoveIntangible, this.SUPERMOVE_DUR));
    // Swap to the supermove animation.
    if (this.anims.supermove) {
      this._prevAnim = this.anim;
      this.anim = this.anims.supermove;
      this.anim.reset();
    }
  }

  /**
   * End the dash early (jump-cancel during the decel phase) or naturally at the
   * end of the decel phase. Retains a small residual forward nudge so the hero
   * does not stop dead in mid-air (§22 "do not stop unnaturally"). Normal
   * control/gravity resume immediately after.
   */
  endSupermove() {
    this.supermoveActive = false;
    this.supermovePhase = null;
    this.supermoveTimer = 0;
    this.vx = this.facing * this.SUPERMOVE_RESIDUAL;
    // The supermove-granted immunity ends with the dash. Restore whatever
    // intangibility existed BEFORE the dash (i-frames/powerup, or none) so a
    // jump-cancel never leaves the hero invulnerable past the visible dash.
    // _preSupermoveIntangible was captured as the REMAINING seconds at trigger
    // time; subtract the total elapsed since the trigger to get what that
    // pre-dash grant SHOULD have left — this correctly zeroes out a short
    // pre-grant (e.g. 0.3s i-frames) that naturally expired during the dash.
    // If something ELSE extended the timer DURING the dash (a powerup pickup),
    // its remaining window is still in the live timer and must not be
    // truncated by restoring the shorter pre-dash value.
    const pre = this._preSupermoveIntangible ?? 0;
    const preRemaining = Math.max(0, pre - this._supermoveElapsed);
    // If something ELSE extended the timer beyond SUPERMOVE_DUR during the dash
    // (e.g. a powerup pickup), that excess belongs to the other source and must
    // survive. We only remove the supermove-granted portion.
    const current = this.timers.get('intangible');
    const otherExcess = Math.max(0, current - this.SUPERMOVE_DUR);
    const restored = Math.max(preRemaining, otherExcess);
    if (restored > 0) {
      this.timers.set('intangible', restored);
      this.intangible = true;
    } else {
      this.timers.clear('intangible');
      this.intangible = false;
    }
    this._preSupermoveIntangible = 0;
    // Restore previous animation.
    if (this._prevAnim) {
      this.anim = this._prevAnim;
      this._prevAnim = null;
    }
  }

  /**
   * World-space AABB of the super dash hitbox, or null when not dashing.
   * Small box in front of the hero, body-height. Deals damage to enemies
   * plowed through during the dash.
   * @returns {{x:number,y:number,w:number,h:number}|null}
   */
  get supermoveHitboxWorld() {
    if (!this.supermoveActive) return null;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const dir = this.facing;
    return {
      x: cx + dir * this.supermoveHitbox.ox - (dir < 0 ? this.supermoveHitbox.bw : 0),
      y: cy + this.supermoveHitbox.oy,
      w: this.supermoveHitbox.bw,
      h: this.supermoveHitbox.bh,
    };
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

// Special melee frame duration (design §15): the per-hero frame counts in
// heroDefs are defined at 60fps, so one special-melee frame is exactly 1/60s.
// This is deliberately NOT the normal swing's MELEE_FRAME_DURATION (0.08s) —
// mixing the two clocks made phase boundaries drift by a frame every tick.
Hero.SPECIAL_MELEE_FRAME_DURATION = 1 / 60;
