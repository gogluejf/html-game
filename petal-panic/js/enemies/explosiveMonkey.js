// Petal Panic — Explosive Monkey enemy (thrown-carrier payload).
//
// A dummy walking monkey: it lands from a throw, walks toward its target
// (ctx.hero by default), and DETONATES ON CONTACT with a valid victim. It has
// an optional TTL fuse (null = contact only) that detonates it in place after
// settling. The flight phase is NOT this class's concern — the `throwEnemy`
// macro carries it on the shared bomb (Ballistic Arc) primitive; once landed,
// this is a REAL Enemy entity: real layer, real AI stepping via update(),
// real collision registration.
//
// Detonation rules:
//   - exactly ONE blast per lifetime (latched before the synchronous payload
//     invoke, so re-entrant contacts can never double-detonate);
//   - payload is the existing explosion OR shockwave primitive (same team
//     semantics as mine.js: isValidTarget + resolveExplosion routing);
//   - after the blast the body enters the standard death pipeline (shrink/
//     fade) and dies — no second boom;
//   - cancellation (host/theater teardown) removes the entity cleanly and
//     suppresses any pending payload.

import { Enemy } from './enemy.js';
import { invoke } from '../combat/attack/engine.js';
import { makeContext } from '../combat/attack/context.js';
import { isValidTarget } from '../combat/explosion.js';

/** Minimal context for detonation when no attack ctx was wired (standalone use). */
function makeDetonateContext() {
  return makeContext(null, { world: { targets: [], hero: null } });
}

export const EXPLOSIVE_MONKEY_DEF = {
  id: 'explosive_monkey',
  name: 'Explosive Monkey',
  w: 28, h: 36,
  aggroRadius: Infinity, // always walks at its target — it IS the attack
  stats: {
    weight: 1, speed: 90, attack: 0, defense: 0, stamina: 40,
    mjump: 0,
    melee: false, projectile: false, fly: false,
  },
  coinDrop: { min: 0, max: 0, chance: 0.0, types: {} }, // suicide unit: no drops
};

/** AABB overlap of two boxes ({x,y,w,h}). */
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

export class ExplosiveMonkey extends Enemy {
  /**
   * @param {number} x spawn x (top-left)
   * @param {number} y spawn y
   * @param {object} [cfg] detonation config (set by makeEnemy / throwEnemy):
   *   ttl              seconds until auto-detonation after settling; null = contact only
   *   settleDelay      grace seconds before the TTL clock starts (landing beat)
   *   explodeOnContact detonate on first valid-body contact (default true)
   *   mineType         'explosion' | 'shockwave' payload subtype
   *   team             ally | foe | neutral (who the blast hurts)
   *   damage           payload damage
   *   radius           payload radius (px)
   *   target           explicit chase/detonate reference (entity); falls back to hero
   */
  constructor(x, y, cfg = {}) {
    super(EXPLOSIVE_MONKEY_DEF, x, y);
    this.cfg = {
      ttl: cfg.ttl ?? null,
      settleDelay: cfg.settleDelay ?? 0,
      explodeOnContact: cfg.explodeOnContact ?? true,
      mineType: cfg.mineType ?? 'explosion',
      team: cfg.team ?? 'foe',
      damage: cfg.damage ?? 40,
      radius: cfg.radius ?? 70,
      target: cfg.target ?? null,
    };
    this._detonated = false;   // latch: one blast per lifetime
    this._settled = false;     // ground contact reached (TTL clock may start)
    this._fuseLeft = null;
    this._payloadHandle = null;
  }

  /**
   * Wire detonation config after construction (makeEnemy passes only x/y).
   * Called by the throwEnemy macro on landing. Re-merges over defaults so a
   * partial config is legal.
   */
  applyThrowConfig(cfg = {}) {
    Object.assign(this.cfg, cfg);
  }

  /** Grounded? (feet within a hair of the floor — host resolve() snaps us there). */
  get grounded() {
    return Math.abs(this.vy) < 1;
  }

  /**
   * Simple walk-toward-target AI. No states beyond "walk": the monkey exists
   * to deliver itself into contact. Stunned (hitstun from the throw arc) or
   * dying monkeys take no action — base update() already skips ai() while
   * stunned/dead.
   */
  ai(dt, hero, world) {
    if (this.aiState === 'dead') return;
    const t = this.cfg.target ?? hero;
    if (!t || t.alive === false) { this.vx = 0; return; }
    const dx = (t.x + t.w / 2) - (this.x + this.w / 2);
    if (Math.abs(dx) > 2) {
      this.vx = Math.sign(dx) * this.stats.speed;
      this.facing = Math.sign(dx) || this.facing;
      this.syncMirror();
    } else {
      this.vx = 0; // arrived: stop at the victim (contact will detonate)
    }
  }

  /**
   * Per-frame step owned by the HOST (theater sandbox / gameplay loop):
   * advances the settle/TTL clock and checks body contact against candidate
   * targets. Called AFTER e.update() (which runs ai + physics integration).
   * Returns true when the monkey is fully gone (death anim finished).
   *
   * @param {number} dt seconds
   * @param {Array<object>} targets candidate entities for contact
   * @returns {boolean} true when dead-and-faded (caller may drop it)
   */
  hostStep(dt, targets = []) {
    if (!this.alive) return true;
    // --- Settle + TTL fuse ---------------------------------------------------
    if (!this._detonated && !this._settled && this.grounded) {
      this._settled = true;
      this._fuseLeft = this.cfg.ttl;
    }
    if (!this._detonated && this._settled && this.cfg.ttl != null && this._fuseLeft != null) {
      this._fuseLeft -= dt;
      if (this._fuseLeft <= 0) this.detonate(targets);
    }
    // --- Contact -------------------------------------------------------------
    if (!this._detonated && this.cfg.explodeOnContact) {
      const box = this.worldBox();
      for (const t of targets) {
        if (!this.validBlastTarget(t)) continue;
        const tb = t.worldBox?.() ?? t;
        if (overlaps(box, tb)) { this.detonate(targets); break; }
      }
    }
    return this.alive === false;
  }

  /** Team-semantics gate for contact detonation (same source as mine.js). */
  validBlastTarget(t) {
    return isValidTarget({ team: this.cfg.team, ctx: { hero: this._heroRef ?? null } }, t, this);
  }

  /**
   * Detonate exactly once: fire the configured payload (explosion/shockwave
   * primitive) centered on the body, then enter the death pipeline. The
   * _detonated latch is set BEFORE the synchronous payload invoke so a
   * re-entrant contact check can never double-fire.
   */
  detonate(targets) {
    if (this._detonated || this.aiState === 'dead') return;
    this._detonated = true;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const cands = [...new Set([...(targets ?? []), this.cfg.target, this._heroRef].filter(Boolean))]
      .filter((t) => t !== this && this.validBlastTarget(t));
    this._payloadHandle = invoke(this.cfg.mineType === 'shockwave' ? 'shockwave' : 'explosion', {
      x: cx, y: cy,
      radius: this.cfg.radius, damage: this.cfg.damage, team: this.cfg.team,
      self: this, targets: cands,
    }, this._attackCtx ?? makeDetonateContext());
    this.die();
  }

  draw(ctx) {
    super.draw(ctx);
    if (!this.alive || this._detonated) return;
    // Fuse indicator: a small blinking dot above the head while armed.
    const blink = Math.sin(performance?.now?.() / 80 ?? 0) > 0;
    if (blink) {
      ctx.save();
      ctx.fillStyle = '#ff5544';
      ctx.fillRect(this.x + this.w / 2 - 2, this.y - 6, 4, 4);
      ctx.restore();
    }
  }
}
