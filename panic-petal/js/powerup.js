// Petal Panic — Powerups (design §10 "Powerup").
//
// A Powerup is a non-solid pickup (layer PICKUP) that applies a one-shot effect
// to the hero when collected. Effects are declared in POWERUP_DEFS as pure
// apply(hero, context) functions so each documented effect stays testable in
// node without a DOM or a running game loop.
//
// Collection contract (driven by the update system's 'pickup' collision rule):
//   - collect() latches `collected` + kills the entity so it can't double-apply
//   - def.apply(hero, context) mutates hero state (ammo/energy/timers/lives...)
//   - combatStats.powerupsCollected[type] is bumped for telemetry (design §4)
//   - VFX (sparkle pop + floating label text) are spawned by the caller so this
//     module has no particle dependency and stays unit-testable.

import { Entity } from './entity.js';
import { LAYER } from './consts.js';

// --- Effect definitions ------------------------------------------------------
// Each entry: { label, color, duration?, apply(hero, context) }.
// `context` carries live game state the effect needs beyond the hero itself
// (e.g. the enemy list for 'clear'). All effects clamp sensibly.
export const POWERUP_DEFS = {
  ammo:          { label: '+100 Ammo',    color: '#3498db',
                   apply: (hero) => { hero.ammo += 100; } },
  invincibility: { label: 'Invincible!',  color: '#3498db', duration: 5,
                   apply: (hero) => { hero.invincibleTimer = Math.max(hero.invincibleTimer ?? 0, 5); } },
  special:       { label: '+50 Special',  color: '#3498db',
                   apply: (hero) => { hero.specialAmmo += 50; } },
  rapid:         { label: 'Rapid Fire!',  color: '#3498db', duration: 6,
                   apply: (hero) => { hero.rapidTimer = Math.max(hero.rapidTimer ?? 0, 6); } },
  shield:        { label: '+50 Shield',   color: '#3498db',
                   apply: (hero) => { hero.shield += 50; } },
  clear:         { label: 'PANIC CLEAR!', color: '#3498db',
                   apply: (hero, enemies) => {
                     for (const e of (enemies ?? [])) {
                       if (!e.alive) continue;
                       // Route through takeDamage when available (real Enemy
                       // instances run their death pipeline); plain placeholder
                       // targets fall back to central damage via hp drain.
                       if (typeof e.takeDamage === 'function') {
                         e.takeDamage(9999, hero, 'clear');
                       } else {
                         e.hp = (e.hp ?? 0) - 9999;
                         e.alive = false;
                       }
                     }
                   } },
  energy:        { label: '+30 Energy',   color: '#3498db',
                   apply: (hero) => { hero.energy = Math.min(hero.maxEnergy, (hero.energy ?? 0) + 30); } },
  oneUp:         { label: '1UP!',         color: '#3498db',
                   apply: (hero) => { hero.lives += 1; } },
};

/** All powerup type keys (level spawn budgets iterate these). */
export const POWERUP_TYPES = Object.keys(POWERUP_DEFS);

// ---------------------------------------------------------------------------
// Powerup entity
// ---------------------------------------------------------------------------

export class Powerup extends Entity {
  /**
   * @param {string} type one of POWERUP_TYPES
   * @param {number} x spawn x (top-left of box)
   * @param {number} y spawn y (top-left of box)
   */
  constructor(type, x, y) {
    const def = POWERUP_DEFS[type];
    if (!def) throw new Error(`Unknown powerup type: ${type}`);
    super({
      x, y,
      w: 28, h: 28,
      layer: LAYER.PICKUP,
      debugColor: def.color,
      gravity: 0,
    });

    this.powerType = type;
    this.def = def;
    this.collected = false;
    this.bobOffset = Math.random() * Math.PI * 2; // visual bob phase
  }

  /** Per-frame step: advance the gentle bob animation only. */
  update(dt) {
    if (this.collected) return;
    this.bobOffset += dt * 3;
  }

  /**
   * Apply this powerup's effect to the hero. Latches so repeated overlap
   * frames can't double-collect. Returns true if the effect was applied.
   *
   * @param {object} hero the collecting hero
   * @param {object} [context] live game state ({ enemies: [...] }) for effects
   *                           that need more than the hero (e.g. 'clear').
   * @returns {boolean} true when the effect fired this call
   */
  collect(hero, context) {
    if (this.collected) return false;
    this.collected = true;
    this.alive = false;

    // Apply the documented effect.
    this.def.apply(hero, context?.enemies ?? []);

    // Telemetry (design §4: powerupsCollected per type).
    if (hero.combatStats) {
      hero.combatStats.powerupsCollected ??= {};
      hero.combatStats.powerupsCollected[this.powerType] =
        (hero.combatStats.powerupsCollected[this.powerType] ?? 0) + 1;
    }

    // SFX: powerup
    return true;
  }

  /**
   * Draw the signboard body. Falls back to the standard Entity transform
   * pipeline (debug rect) until real sprites land; the bob lifts the drawn
   * body slightly so pickups read as floating objects.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!this.alive || this.collected) return;
    const bob = Math.sin(this.bobOffset) * 3;
    ctx.save();
    ctx.translate(0, bob);
    super.draw(ctx);
    ctx.restore();
  }
}

/** Create a powerup of `type` at (x, y). Convenience factory for level setup. */
export function makePowerup(type, x, y) {
  return new Powerup(type, x, y);
}
