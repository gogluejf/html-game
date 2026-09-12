// Petal Panic — Overgrown Elephant boss (design §9).
//
// The level's climax: a big ground-based boss that locks the camera to its
// arena and cycles through three telegraphed, dodgeable attack phases,
// escalating in speed/frequency as its HP drops.
//
//   idle        → brief pause between attacks (breathing room)
//   charge      → runs across the arena toward the hero (dodge by jumping/moving)
//   stomp       → telegraphed shake, then a ground shockwave (jump over it)
//   trunk_blast → ranged 3-shot fan of enemy projectiles (strafe / crouch)
//   death       → shrink/fade pipeline inherited from Enemy, then win state
//
// Weak point: the head/trunk region (top ~30% of the body). Hits landing there
// deal WEAK_POINT_MULT× damage; everything else is normal. This is checked in
// takeDamage() against the weakPointBox AABB.
//
// Camera lock + win-state transition are owned by the update system (it owns
// the camera + state machine); this class exposes the data it needs:
//   - BOSS_TRIGGER_RADIUS : distance at which the fight activates
//   - arenaX / arenaW     : the locked camera bounds
//   - onDeath()           : called once when the death anim completes
//
// Contact damage rides the shared HERO×BOSS 'contact' rule in update.js (the
// boss is an Enemy with layer LAYER.BOSS), so no special wiring is needed here
// beyond giving it a high stats.attack.

import { Enemy } from './enemy.js';
import { LAYER } from './consts.js';
import { projectilePool } from './projectile.js';
import { damage } from './damage.js';

export const ELEPHANT_DEF = {
  id: 'elephant',
  name: 'Overgrown Elephant',
  w: 80, h: 100,
  aggroRadius: Infinity, // always active once the fight triggers
  stats: {
    weight: 5, speed: 200, attack: 30, defense: 5, stamina: 500,
    melee: true, projectile: true, fly: false,
  },
  coinDrop: { range: [6, 10], chance: 1.0 }, // generous bounty on victory
};

// --- Phase timing (base durations, divided by escalation) -------------------
const IDLE_DUR = 1.0;          // seconds between attacks
const CHARGE_DUR = 1.5;        // run-across-arena length
const STOMP_DUR = 1.0;         // shake + shockwave
const TRUNK_DUR = 1.2;         // ranged fan

// --- Telegraph windows (fractions of the phase duration) --------------------
// Each attack has a visible "windup" before it becomes dangerous so the player
// can read it and react. These are the fractions of the phase timer where the
// effect is actually live.
const CHARGE_ACTIVE_FRAC = [0.0, 1.0];   // whole charge is contact-dangerous
const STOMP_SHAKE_FRAC   = [0.0, 0.45];  // shake telegraph (no damage yet)
const STOMP_WAVE_FRAC    = [0.45, 0.75]; // shockwave window (damage if grounded)
const TRUNK_FIRE_FRAC    = 0.3;          // moment the fan fires

// --- Trunk blast geometry ----------------------------------------------------
const TRUNK_FAN_ANGLES = [-0.35, 0, 0.35]; // radians around the facing axis
const TRUNK_SPEED = 420;                  // px/s for the boss shots
const TRUNK_DAMAGE = 12;                  // per-shot damage (defense-mitigated)

// --- Arena / trigger tuning --------------------------------------------------
export const BOSS_ARENA_WIDTH = 400;   // width of the locked camera arena
export const BOSS_TRIGGER_RADIUS = 300; // hero within this of the boss → activate

/**
 * @param {number} x spawn x (top-left of box)
 * @param {number} y spawn y
 */
export class Elephant extends Enemy {
  constructor(x, y) {
    super(ELEPHANT_DEF, x, y);
    this.isBoss = true;
    this.layer = LAYER.BOSS;
    this.debugColor = '#8e6bbf'; // distinct purple-brown for the boss body

    // --- Phase machine ------------------------------------------------------
    // idle | charge | stomp | trunk_blast | death. `phase` drives the AI; the
    // base aiState mirrors it ('dead' only on death) so the generic enemy
    // update/draw/death pipeline keeps working unchanged.
    this.phase = 'idle';
    this.phaseTimer = 0;
    this._blastFired = false;
    this._stomped = false;

    // --- Weak point (head/trunk — top ~30% of the body) ---------------------
    this.weakPointBox = { ox: 10, oy: 0, bw: 60, bh: 30 };

    // --- Escalation: multiplier that grows as HP drops (1.0 → up to 1.5) ----
    this.escalation = 1.0;

    // --- Arena bounds (camera lock target) ----------------------------------
    // Centered on the spawn x so the boss sits mid-arena at the start.
    this.arenaX = Math.round(x - BOSS_ARENA_WIDTH / 2 + this.w / 2);
    this.arenaW = BOSS_ARENA_WIDTH;

    // --- Fight activation ---------------------------------------------------
    // The boss stands still until the hero gets close (see shouldActivate()).
    this.active = false;

    // Stomp shake magnitude (px) for the screen-shake juice, exposed for render.
    this.shakeMag = 0;
  }

  /**
   * Should the fight be active right now? True once the hero is within
   * BOSS_TRIGGER_RADIUS of the boss (center-to-center). Once true it latches —
   * the boss never deactivates mid-fight.
   * @param {object} hero entity exposing x/y/w/h
   */
  shouldActivate(hero) {
    if (this.active || this.aiState === 'dead') return this.active;
    const dx = (hero.x + hero.w / 2) - (this.x + this.w / 2);
    const dy = (hero.y + hero.h / 2) - (this.y + this.h / 2);
    if (Math.sqrt(dx * dx + dy * dy) < BOSS_TRIGGER_RADIUS) {
      this.active = true;
      // Start the first attack after a short wind-up so the entrance reads.
      this.startPhase('charge');
      return true;
    }
    return false;
  }

  /**
   * Per-frame boss AI. No-op while the fight hasn't activated or the boss is
   * dying. Otherwise advances the phase machine and escalates as HP drops.
   * @param {number} dt seconds
   * @param {Hero} hero the player
   * @param {CollisionWorld} world unused
   */
  ai(dt, hero, _world) {
    if (this.aiState === 'dead') return;
    if (!this.active) return; // standing still until the hero approaches

    // Escalate: up to 1.5× faster/more frequent at 0% HP.
    const hpFrac = Math.max(0, this.hp / this.maxHp);
    this.escalation = 1.0 + (1.0 - hpFrac) * 0.5;

    switch (this.phase) {
      case 'idle':
        this.vx = 0;
        this.faceHero(hero);
        this.phaseTimer += dt;
        if (this.phaseTimer >= IDLE_DUR / this.escalation) {
          this.startPhase('charge');
        }
        break;

      case 'charge': {
        // Run across the arena toward the hero at full (escalated) speed.
        const dir = Math.sign((hero.x + hero.w / 2) - (this.x + this.w / 2)) || this.facing;
        this.vx = dir * this.stats.speed * this.escalation;
        this.facing = dir;
        this.syncMirror();
        this.phaseTimer += dt;
        if (this.phaseTimer >= CHARGE_DUR / this.escalation) {
          this.vx = 0;
          this.startPhase('stomp');
        }
        break;
      }

      case 'stomp': {
        this.vx = 0;
        this.faceHero(hero);
        this.phaseTimer += dt;
        const dur = STOMP_DUR / this.escalation;
        // Fire the shockwave exactly once during the wave window.
        const t = this.phaseTimer / dur;
        if (!this._stomped && t >= STOMP_WAVE_FRAC[0] && t <= STOMP_WAVE_FRAC[1]) {
          this._stomped = true;
          this.doStomp(hero);
        }
        if (this.phaseTimer >= dur) {
          this.startPhase('trunk_blast');
        }
        break;
      }

      case 'trunk_blast': {
        this.vx = 0;
        this.faceHero(hero);
        this.phaseTimer += dt;
        const dur = TRUNK_DUR / this.escalation;
        const t = this.phaseTimer / dur;
        if (!this._blastFired && t >= TRUNK_FIRE_FRAC) {
          this._blastFired = true;
          this.fireTrunkBlast();
        }
        if (this.phaseTimer >= dur) {
          this.startPhase('idle');
        }
        break;
      }
    }
  }

  /** Point the boss at the hero (only when not already dead). */
  faceHero(hero) {
    const dir = Math.sign((hero.x + hero.w / 2) - (this.x + this.w / 2));
    if (dir !== 0) { this.facing = dir; this.syncMirror(); }
  }

  /** Switch to a new phase, resetting its timers/latches. */
  startPhase(phase) {
    this.phase = phase;
    this.phaseTimer = 0;
    this._blastFired = false;
    this._stomped = false;
  }

  /**
   * Ground shockwave: damages the hero if they are NOT airborne (i.e. must jump
   * over it). Also kicks a screen shake. Respects the hero's i-frames and the
   * mid-death guard. Exposed as a method so tests can drive it directly.
   * @param {Hero} hero
   * @returns {boolean} true if the hero was hit
   */
  doStomp(hero) {
    // Screen-shake cue (render reads getShakeOffset via the update system; we
    // just record the magnitude so the caller can triggerShake()).
    this.shakeMag = 8;
    if (hero.dying) return false;
    if (hero.invincibleTimer > 0) return false; // i-frames absorb it
    if (hero.grounded) {
      const dealt = damage(this, hero, this.stats.attack, 'melee');
      if (dealt > 0) {
        hero.invincibleTimer = Math.max(hero.invincibleTimer, 0.3);
        return true;
      }
    }
    return false;
  }

  /**
   * Ranged attack: fire a 3-shot downward-ish fan of enemy projectiles
   * (PROJ_FOE layer) toward the hero. Uses the shared pool; soft-caps when the
   * pool is exhausted.
   */
  fireTrunkBlast() {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.weakPointBox.oy + this.weakPointBox.bh / 2; // from the trunk
    const baseAngle = this.facing >= 0 ? 0 : Math.PI; // horizontal toward hero
    for (const off of TRUNK_FAN_ANGLES) {
      const ang = baseAngle + off;
      const p = projectilePool.spawn(cx - 6, cy - 6, 0, false); // friendly=false
      if (!p) continue; // pool exhausted — skip this shot
      // Override the pooled velocity with our custom angle/speed/damage.
      p.vx = Math.cos(ang) * TRUNK_SPEED;
      p.vy = Math.sin(ang) * TRUNK_SPEED;
      p.damage = TRUNK_DAMAGE;
      p.life = 1.6;
    }
  }

  /**
   * World-space AABB of the weak point (head/trunk). Used by the debug
   * overlay and by takeDamage() to decide bonus damage.
   * @returns {{x:number,y:number,w:number,h:number}}
   */
  weakPointWorld() {
    const b = this.weakPointBox;
    return { x: this.x + b.ox, y: this.y + b.oy, w: b.bw, h: b.bh };
  }

  /**
   * Apply a hit with weak-point bonus. If the hit position falls inside the
   * weak point box, the raw amount is multiplied by WEAK_POINT_MULT before
   * routing through central damage().
   *
   * NOTE: the generic collision 'hit' handler routes thorns through
   * damage() directly (not takeDamage()), so the update system also checks
   * `isWeakPointHit()` for the boss. This method covers melee + any direct
   * callers and keeps the bonus logic testable in isolation.
   *
   * @param {number} amt raw attack value
   * @param {object} source attacker
   * @param {string} [method='melee']
   * @param {{x:number,y:number}|null} [hitPos] impact point (world coords)
   * @returns {number} real damage dealt
   */
  takeDamage(amt, source, method = 'melee', hitPos = null) {
    let finalAmt = amt;
    if (hitPos && this.isWeakPointHit(hitPos.x, hitPos.y)) {
      finalAmt = amt * WEAK_POINT_MULT;
    }
    return super.takeDamage(finalAmt, source, method);
  }

  /**
   * Is a world-coordinate point inside the weak point box?
   * @param {number} wx
   * @param {number} wy
   * @returns {boolean}
   */
  isWeakPointHit(wx, wy) {
    const b = this.weakPointWorld();
    return wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
  }

  /**
   * Death hook. Called by the update system exactly once when the death anim
   * completes (alive flips to false). Fires the win-state transition. Kept as a
   * thin hook here so the class stays free of a hard dependency on the state
   * module's singleton; the update system wires it to tryTransition(S.WIN).
   */
  onDeath() {
    this.active = false;
    this.vx = 0;
    this.vy = 0;
  }

  /**
   * Draw the elephant. Falls back to the base debug rect (no sprite yet) plus a
   * small trunk/head marker so the weak point is visible even in placeholder
   * form. Death shrink/fade is handled by Enemy.draw().
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    super.draw(ctx);

    if (!this.alive || this.aiState === 'dead') return;

    // Weak-point highlight (always faintly visible so the target reads).
    const wp = this.weakPointWorld();
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(wp.x, wp.y, wp.w, wp.h);
    ctx.restore();

    // Stomp telegraph: a pulsing ring under the feet during the shake window.
    if (this.phase === 'stomp') {
      const dur = STOMP_DUR / this.escalation;
      const t = this.phaseTimer / dur;
      if (t < STOMP_SHAKE_FRAC[1]) {
        const cx = this.x + this.w / 2;
        const cy = this.y + this.h;
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#f39c12';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 20 + t * 40, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

/** Weak-point damage multiplier (design §9: head/trunk takes bonus damage). */
export const WEAK_POINT_MULT = 1.5;

/**
 * Factory: build the boss at a given world position. The spawn y is derived so
 * the elephant's feet rest on the floor top (matches the level's GROUND_Y).
 * @param {number} x spawn x
 * @param {number} [floorTop=500] floor top y
 * @returns {Elephant}
 */
export function makeElephant(x, floorTop = 500) {
  const e = new Elephant(x, floorTop - ELEPHANT_DEF.h);
  return e;
}
