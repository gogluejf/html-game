// Petal Panic — Jack-O-Lantern enemy (design §7).
//
// Rolling bomb. State machine:
//   roll    → dist < DETONATE_RANGE || fuseTimer >= FUSE_TIME → launch
//   launch  → launchTimer expires                              → explode
//   explode → explodeTimer expires                             → dead
//
// While rolling it moves toward the hero at ROLL_SPEED and spins (rotation is
// advanced in ai() so the "rolling" reads even without sprites). It is fully
// destructible by shot/melee before detonation (HP = stamina, drained via the
// base takeDamage()). On detonation it deals AoE damage to the hero within
// JACKO_EXPLODE_RADIUS — resolved by the generic explosion system (explosion.js)
// with a FOE alignment so its own kind is spared. The update system drives that
// resolver; this class only latches the blast and fires onExplode().

import { Enemy } from './enemy.js';
import { LAYER } from './consts.js';

export const JACKO_DEF = {
  id: 'jackolantern',
  name: 'Jack-O-Lantern',
  w: 40, h: 40,
  aggroRadius: 400,             // rolls once the hero gets this close
  stats: {
    weight: 1, speed: 150, attack: 22, defense: 0, stamina: 30,
    mjump: 0,
    melee: false, projectile: false, fly: false,
  },
  coinDrop: { min: 1, max: 2, chance: 1.0, types: { bronze: 1 } },
};

const ROLL_SPEED = 150;         // px/s while rolling toward the hero
const DETONATE_RANGE = 80;      // px — proximity that triggers detonation
const FUSE_TIME = 3;            // seconds — auto-detonate after this long
const LAUNCH_TIME = 0.4;        // seconds of "launch" telegraph before exploding
const EXPLODE_TIME = 0.3;       // seconds the explosion flash lasts
export const JACKO_EXPLODE_RADIUS = 80; // px — AoE radius (smaller than a barrel's 120)
const SPIN_SPEED = 6;           // rad/s — visual spin while rolling
const AGGRO_RELEASE_MULT = 1.5; // deaggro when hero exceeds aggroRadius * this

export class JackOLantern extends Enemy {
  constructor(x, y) {
    super(JACKO_DEF, x, y);
    this.fuseTimer = 0;         // seconds since roll started (auto-detonate)
    this.launchTimer = 0;       // seconds remaining in the launch telegraph
    this.explodeTimer = 0;      // seconds remaining in the explosion flash
    this.exploded = false;      // latched so the AoE fires exactly once
  }

  /**
   * Jack-O-Lantern AI state machine. See header for transitions.
   * @param {number} dt seconds
   * @param {Hero} hero the player
   * @param {CollisionWorld} world unused directly; the caller runs the AoE
   */
  ai(dt, hero, _world) {
    if (this.aiState === 'dead') return;

    const dx = (hero.x + hero.w / 2) - (this.x + this.w / 2);
    const dy = (hero.y + hero.h / 2) - (this.y + this.h / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);

    switch (this.aiState) {
      case 'idle':
        this.vx = 0;
        if (dist < this.aggroRadius) {
          this.aiState = 'roll';
          this.fuseTimer = 0;
        }
        break;

      case 'roll': {
        if (dist > this.aggroRadius * AGGRO_RELEASE_MULT) {
          // Hero escaped: reset the fuse but keep rolling only while engaged.
          this.aiState = 'idle';
          this.vx = 0;
          break;
        }
        // Roll toward the hero and spin.
        this.vx = Math.sign(dx) * ROLL_SPEED;
        this.facing = Math.sign(dx) || this.facing;
        this.syncMirror();
        this.rotation += SPIN_SPEED * dt;

        this.fuseTimer += dt;
        if (dist < DETONATE_RANGE || this.fuseTimer >= FUSE_TIME) {
          this.aiState = 'launch';
          this.launchTimer = LAUNCH_TIME;
          this.vx = 0;
        }
        break;
      }

      case 'launch':
        this.vx = 0;
        this.rotation += SPIN_SPEED * 2 * dt; // spin faster as it "winds up"
        this.launchTimer -= dt;
        if (this.launchTimer <= 0) {
          this.aiState = 'explode';
          this.explodeTimer = EXPLODE_TIME;
          this.explode();
        }
        break;

      case 'explode':
        this.vx = 0;
        this.explodeTimer -= dt;
        if (this.explodeTimer <= 0) {
          this.die(); // consume itself after the flash
        }
        break;
    }
  }

  /**
   * Fire the explosion hook. The actual AoE damage is driven by the game loop
   * calling resolveExplosion() (explosion.js) with a FOE alignment, mirroring how
   * a barrel detonates through the same shared resolver. This latch guarantees the
   * blast happens exactly once even if ai() runs again on the same frame.
   */
  explode() {
    if (this.exploded) return;
    this.exploded = true;
    this.onExplode?.(this);
  }

  /**
   * Draw the lantern. Falls back to the base debug rect (no sprite yet); the
   * death shrink/fade is handled by Enemy.draw(). During launch/explode we
   * overlay an expanding orange ring so the telegraph + blast are visible.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    super.draw(ctx);

    if (!this.alive) return;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;

    if (this.aiState === 'launch' || this.aiState === 'explode') {
      // Launch: a pulsing warning ring growing toward the full radius.
      // Explode: a bright flash ring at full radius fading out.
      let r, alpha, color;
      if (this.aiState === 'launch') {
        const t = 1 - this.launchTimer / LAUNCH_TIME; // 0..1
        r = JACKO_EXPLODE_RADIUS * t;
        alpha = 0.3 + 0.4 * t;
        color = '#f39c12';
      } else {
        const t = 1 - this.explodeTimer / EXPLODE_TIME; // 0..1
        r = JACKO_EXPLODE_RADIUS;
        alpha = Math.max(0, 1 - t);
        color = '#e74c3c';
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// --- Explosion AoE -----------------------------------------------------------
// The Jack-O-Lantern's blast is resolved by the generic explosion system
// (explosion.js resolveExplosion) with a FOE alignment + JACKO_EXPLOSION_KNOCKBACK,
// driven by the game loop in update.js. There is no per-source detonation routine here
// — the lantern only latches exploded once and fires onExplode(); the actual AoE math
// lives in the single shared resolver (see docs/architecture/explosion.md §5).
