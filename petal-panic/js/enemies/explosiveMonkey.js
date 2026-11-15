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
//   - exactly ONE blast per lifetime (latched before the engine fires, so
//     re-entrant contacts can never double-detonate);
//   - payload is the existing explosion OR shockwave primitive — declared as
//     a standard `explosion` def and fired by the GENERIC enemyUpdate.js path
//     (same door as barrels and the Jack-O'-Lantern; no per-type invoke);
//   - after the blast the body enters the standard death pipeline (shrink/
//     fade) and dies — no second boom;
//   - cancellation (host/theater teardown) removes the entity cleanly and
//     suppresses any pending payload.

import { Enemy } from './enemy.js';
import { UNIT_PX_X } from '../world/macros.js';

export const EXPLOSIVE_MONKEY_DEF = {
  id: 'explosive_monkey',
  name: 'Explosive Monkey',
  w: 28, h: 36,
  aggroRadius: Infinity, // always walks at its target — it IS the attack
  stats: {
    weight: 1, speed: 90 / UNIT_PX_X,  // X-units/s (exactly 90 px/s at the current grid)
    attack: 0, defense: 0, stamina: 40,
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
   *   ttl              seconds until auto-detonation from spawn; null = contact only
   *   settleDelay      legacy option; does not delay the spawn-based fuse
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
      team: cfg.team ?? 'neutral',
      damage: cfg.damage ?? 40,
      radius: cfg.radius ?? 70,
      target: cfg.target ?? null,
    };
    // Generic explosion property (enemyUpdate.js): the engine fires the blast
    // uniformly when we latch `exploded` — same door as barrels and the
    // Jack-O'-Lantern. No per-type invoke here.
    this.explosion = this._buildExplosion();
    this.exploded = false;   // latched so the AoE fires exactly once
    this._detonated = false; // trigger latch: one detonation decision per lifetime
    this._settled = false;     // ground contact reached (TTL clock may start)
    this._settleTimer = 0;     // grace period before fuse arms
    this._fuseLeft = this.cfg.ttl;
    // Snappy death: a suicide unit shouldn't linger with a long shrink/fade.
    this.deathDuration = 0.25;
  }

  /** Build the standard explosion def from cfg (knockback omitted → the
   * primitive's DEFAULT_EXPLOSION_KNOCKBACK applies). */
  _buildExplosion() {
    return {
      payloadType: this.cfg.mineType,
      radius: this.cfg.radius,
      damage: this.cfg.damage,
      team: this.cfg.team,
    };
  }

  /**
   * Wire detonation config after construction (makeEnemy passes only x/y).
   * Called by the throwEnemy macro on landing. Re-merges over defaults so a
   * partial config is legal.
   */
  applyThrowConfig(cfg = {}) {
    Object.assign(this.cfg, cfg);
    this.explosion = this._buildExplosion(); // re-derive the payload def
    this._fuseLeft = this.cfg.ttl; // configured at materialization, before the first tick
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
    // Remember the live hero reference for the contact-detonation check in
    // hostStep: ambient monkeys (level population) are built with no explicit
    // cfg.target and no _heroRef — the AI's hero param is their only link to
    // "who I am walking toward". Without this latch they could never detonate.
    if (hero && hero.alive !== false) this._heroRef = hero;
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
    // Spawn starts the fuse; throwEnemy owns the single tick per frame.
    if (!this._detonated && this._fuseLeft != null) {
      this._fuseLeft -= dt;
      if (this._fuseLeft <= 1e-9) this.detonate();
    }
    // --- Contact -------------------------------------------------------------
    // Detonate ONLY on the chase target (the hero). The monkey is a FOE that
    // exists to deliver itself into the player — bumping into other enemies
    // or barrels along the way must NOT waste it. (The blast payload remains
    // neutral AoE once fired; only the TRIGGER is target-specific.)
    if (!this._detonated && this.cfg.explodeOnContact) {
      const victim = this.cfg.target ?? this._heroRef ?? null;
      if (victim && victim.alive !== false && victim !== this) {
        const box = this.worldBox();
        const tb = victim.worldBox?.() ?? victim;
        if (overlaps(box, tb)) this.detonate();
      }
    }
    return this.alive === false;
  }

  /**
   * Detonate exactly once: latch `exploded` (the generic enemyUpdate.js path
   * fires the configured payload through the SAME explosion/shockwave
   * primitive a barrel uses) and enter the death pipeline. The _detonated
   * latch is set BEFORE latching so a re-entrant contact check can never
   * double-fire.
   */
  detonate() {
    if (this._detonated || this.aiState === 'dead') return;
    this._detonated = true;
    this.exploded = true;      // engine fires the blast next update pass and
                               // latches the position there (enemyUpdate.js)
    // The body is gone the instant the blast starts; the short death duration
    // only keeps the entity in the normal removal pipeline for one beat.
    this._goneAtBlast = true;
    this.die();
  }

  draw(ctx) {
    if (this._goneAtBlast) return;
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
