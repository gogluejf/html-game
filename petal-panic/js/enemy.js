// Petal Panic — Enemy base class (design §6-7).
//
// Every enemy type inherits from this and overrides ai() with its own small
// state machine (idle / walk / chase / attack / dead). The base class owns:
//   - stats + hp pool (drained via central damage())
//   - coinDrop config (rolled on death)
//   - hitFlash timer (white flash when struck)
//   - death pipeline: aiState='dead' → shrink/fade over deathDuration → alive=false
//
// Subclasses (Jester in task 3.3, others in 5.1+) add their own AI fields and
// override ai(). They should NOT override update() unless they need to run
// custom physics; the base update() handles gravity/integration uniformly.
//
// Death contract:
//   - takeDamage() routes through damage(); if hp hits 0 it calls die() which
//     sets aiState='dead'. The entity stays "alive" (still drawn, still in the
//     collision world for one frame) until the death anim completes — at that
//     point alive flips to false and the caller (update system) is responsible
//     for spawning sparkles + coins and removing from the world. This keeps
//     the Enemy class free of particle/pool dependencies so other enemies can
//     inherit cleanly.

import { Entity } from './entity.js';
import { LAYER, GRAVITY, MAX_FALL_SPEED } from './consts.js';
import { damage } from './damage.js';

export class Enemy extends Entity {
  /**
   * @param {object} def enemy definition (see design §6): id, name, w, h,
   *                     aggroRadius, stats{weight,speed,attack,defense,stamina,
   *                     melee,projectile,fly}, coinDrop{range,chance}.
   * @param {number} [x] spawn x (top-left of box)
   * @param {number} [y] spawn y
   */
  constructor(def, x = 0, y = 0) {
    super({
      x, y,
      w: def.w ?? 32,
      h: def.h ?? 48,
      layer: LAYER.ENEMY,
      debugColor: '#e74c3c',
      gravity: def.stats?.fly ? 0 : 1,
    });

    this.type = def.id;
    this.name = def.name ?? def.id;
    this.def = def;
    this.stats = { ...def.stats };
    this.hp = def.stats.stamina;
    this.maxHp = def.stats.stamina;
    this.coinDrop = def.coinDrop ?? { range: [1, 3], chance: 0.5 };

    // --- AI state -----------------------------------------------------------
    // idle | walk | chase | attack | dead. Subclasses drive transitions.
    this.aiState = 'idle';
    this.aggroRadius = def.aggroRadius ?? 300;
    this.radius = this.aggroRadius; // base Entity radius — debug draws this

    // White-flash timer (seconds) set by takeDamage(); render reads this.
    this.hitFlash = 0;

    // --- Death pipeline -----------------------------------------------------
    // Driven by a labeled 'death' timer on the unified engine (counts down).
    // deathTimer/fading are derived from it so render + debug stay in sync and
    // the death countdown shows as a 'death' bar in the per-entity stack.
    this.deathDuration = 0.75; // seconds total for shrink+fade (room to hold last frame)
    this.fading = false;      // true after half duration (render fades out)
  }

  /** Elapsed death time (derived from the 'death' timer), 0 when not dying. */
  get deathTimer() {
    if (this.aiState !== 'dead') return 0;
    return Math.max(0, this.deathDuration - this.timers.get('death'));
  }

  /**
   * Per-frame step. Order: hit-flash decay → death pipeline → AI → integrate.
   * When dead we skip AI and integration entirely (the corpse doesn't move);
   * we only advance the death clock.
   *
   * @param {number} dt seconds (fixed 1/60)
   * @param {Hero} hero the player (AI target)
   * @param {CollisionWorld} world unused by base; subclasses may use it
   */
  update(dt, hero, world) {
    if (!this.alive) return;

    if (this.hitFlash > 0) this.hitFlash -= dt;

    // --- Death pipeline ------------------------------------------------------
    if (this.aiState === 'dead') {
      this.timers.tick(dt);
      if (!this.fading && this.deathTimer > this.deathDuration * 0.5) {
        this.fading = true;
      }
      if (this.timers.expired('death')) {
        this.alive = false; // fully gone — caller spawns effects + removes
      }
      return;
    }

    // --- AI (subclasses override) -------------------------------------------
    this.ai(dt, hero, world);

    // --- Gravity + integrate -------------------------------------------------
    if (this.gravity > 0) {
      this.vy += GRAVITY * this.gravity * dt;
      if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /**
   * Base AI: do nothing. Subclasses override with their own state machine.
   * @param {number} dt seconds
   * @param {Hero} hero the player
   * @param {CollisionWorld} world
   */
  ai(dt, hero, world) { /* no-op */ }

  /**
   * Apply a single hit to this enemy via central damage(). Sets the white
   * flash and triggers die() when hp drops to <= 0.
   *
   * NOTE: damage() sets target.alive=false when hp<=0, but the Enemy death
   * pipeline needs alive=true during the shrink/fade anim. We restore it here
   * and let the update() timer flip it to false when the anim completes.
   *
   * @param {number} amt raw attack value before defense
   * @param {object} source attacker (hero, explosion, ...) — used for telemetry
   * @param {string} [method='melee'] 'projectile' | 'melee' | 'contact' | ...
   * @returns {number} real damage dealt (>=1 if alive), else 0
   */
  takeDamage(amt, source, method = 'melee') {
    const real = damage(source, this, amt, method);
    if (real > 0) {
      this.hitFlash = 0.1;
      if (this.hp <= 0) {
        this.die();
        // Restore alive=true so the death anim plays; update() will set it
        // to false when deathTimer >= deathDuration.
        this.alive = true;
      }
    }
    return real;
  }

  /**
   * Enter the death pipeline. Velocity is zeroed so the corpse doesn't drift;
   * the base update() then advances deathTimer until alive flips to false.
   * Subclasses may override to add knockback or a specific death animation,
   * but MUST call super.die() so the timing bookkeeping stays consistent.
   */
  die() {
    if (this.aiState === 'dead') return; // already dying
    this.aiState = 'dead';
    this.timers.set('death', this.deathDuration); // start the death countdown
    this.fading = false;
    this.vx = 0;
    this.vy = 0;
  }

  /**
   * Draw the enemy body. Uses the standard Entity transform pipeline (mirror,
   * rotate, scale) and falls back to a debug-colored rect when no anim is
   * attached. During the death pipeline the body shrinks toward center and
   * fades out over the second half of deathDuration.
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!this.alive) return;

    // Death shrink + fade: scale down over the first half, fade over the last.
    let scale = this.scale;
    let alpha = 1;
    if (this.aiState === 'dead') {
      // Death plays in two phases within deathDuration:
      //   Phase 1 (first ANIM_FRAC): shrink + fade out over the anim.
      //   Phase 2 (remainder): HOLD the final frame (alpha frozen) so a real
      //   death sprite can rest on its last pose before despawn. This gives the
      //   "cool last-frame linger" without the corpse vanishing early.
      const ANIM_FRAC = 0.6; // fraction of the window spent shrinking/fading
      const t = Math.min(1, this.deathTimer / (this.deathDuration * ANIM_FRAC));
      scale *= 1 - t * 0.5; // shrink to 50% by end of phase 1
      if (this.fading) {
        const ft = Math.min(1, (this.deathTimer - this.deathDuration * 0.5) / (this.deathDuration * ANIM_FRAC * 0.5));
        alpha = Math.max(0.15, 1 - ft); // fade to 15% (not fully gone) and hold
      }
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    if (this.mirrorX) ctx.scale(-1, 1);
    if (this.mirrorY) ctx.scale(1, -1);
    ctx.rotate(this.rotation);
    ctx.scale(scale, scale);

    if (this.anim && this.anim.frames.length > 0) {
      this.anim.draw(ctx, this);
    } else {
      ctx.fillStyle = this.debugColor;
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    }
    ctx.restore();

    // Hit flash overlay (drawn un-scaled so it matches the collision box).
    if (this.hitFlash > 0 && this.aiState !== 'dead') {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.hitFlash * 10);
      const b = this.worldBox();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }
  }
}
