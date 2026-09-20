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
   *                     melee,projectile,fly}, coinDrop{min,max,chance,types}.
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
    this.isBoss = def.isBoss ?? false;
    this.stats = { ...def.stats };
    this.hp = def.stats.stamina;
    this.maxHp = def.stats.stamina;
    this.coinDrop = def.coinDrop ?? { min: 1, max: 3, chance: 0.5 };

    // --- Explosion (generic entity property) ---------------------------------
    // Any entity can declare an `explosion` in its def; the engine resolves it
    // uniformly on death/termination via resolveExplosion() (explosion.js). No
    // per-type special cases — barrels and Jack-O-Lanterns both carry this same
    // shape and detonate through the one shared resolver. null = no blast.
    this.explosion = def.explosion ?? null;

    // --- AI state -----------------------------------------------------------
    // idle | walk | chase | attack | dead. Subclasses drive transitions.
    this.aiState = 'idle';
    this.aggroRadius = def.aggroRadius ?? 300;
    this.radius = this.aggroRadius; // base Entity radius — debug draws this

    // White-flash timer (seconds) set by takeDamage(); render reads this.
    this.hitFlash = 0;

    // Hit-stun window (seconds remaining). Set by knockback (knockback.js
    // writes victim.hitstunTimer); while > 0 the enemy's ai() is skipped but
    // physics keep integrating so the shove plays out visibly (§6 stun).
    // Plain field (not a unified timer): it's written from outside via
    // applyKnockback and counts down here, mirroring hitFlash.
    this.hitstunTimer = 0;

    // --- Body-contact knockback (§9) ------------------------------------------
    // Carried on the entity so the contact handler in update.js can call
    // applyKnockback() without any layer-based branching. Regular enemies get
    // a lighter base; bosses declare a larger base so they read harder through
    // mass AND speed (the motion term picks up their velocity automatically).
    this.bodyKnockback = def.bodyKnockback ?? (this.isBoss
      ? { base: 340, scaleBySpeed: 1.0, hitstun: 0.30, iFrames: 0.70 }
      : { base: 260, scaleBySpeed: 1.0, hitstun: 0.25, iFrames: 0.60 });

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

  /** True while the hit-stun window is active (ai() is frozen). */
  get stunned() { return this.hitstunTimer > 0; }

  /**
   * Per-frame step. Order: hit-flash decay → death pipeline → AI → integrate.
   * When dead we skip AI but still integrate physics so a body that was just
   * knocked back slides/arcs off before fading (the corpse doesn't take action);
   * we also advance the death clock. While hit-stunned we skip ai() but still
   * integrate physics so the knockback shove plays out visibly (§6).
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
      // Still integrate physics so a dying body that was just knocked back
      // slides/arcs off before fading, instead of teleporting to its death spot.
      // ai() is intentionally skipped (the corpse takes no action).
      if (this.gravity > 0) {
        this.vy += GRAVITY * this.gravity * dt;
        if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      return;
    }

    // --- Hit-stun window -----------------------------------------------------
    // A stunned enemy cannot act: its ai() is skipped for the whole window,
    // freezing whatever action it was mid-way through (a whipping Jester stops).
    // Physics below still run, so the knockback velocity integrates and the
    // shove is visible. No state save/restore needed — aiState is untouched,
    // so when the timer expires the enemy resumes exactly where it left off.
    if (this.stunned) {
      this.hitstunTimer -= dt;
      if (this.hitstunTimer < 0) this.hitstunTimer = 0;
    } else {
      // --- AI (subclasses override) ------------------------------------------
      this.ai(dt, hero, world);
    }

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
   * Enter the death pipeline. Velocity is zeroed so a corpse that was NOT just
   * hit doesn't drift; the base update() then advances deathTimer while still
   * integrating physics, so an enemy killed by a knockback on the same frame
   * keeps sliding/arcing off before it fades. Subclasses may override to add
   * knockback or a specific death animation, but MUST call super.die() so the
   * timing bookkeeping stays consistent.
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
