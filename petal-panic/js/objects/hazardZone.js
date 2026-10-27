// Petal Panic — Hazard Zone (persistent damaging area).
// A world entity that represents a rectangular zone dealing ticking damage
// to anything inside it for a duration. Created by attack primitives
// (fireArea, spike, dustZone) and lives independently in the world.
//
// Visual: each zone type provides its own draw(). The base draws a simple
// colored rectangle (debug-friendly). Subtypes override with particles/sprites.

import { Entity } from '../core/entity.js';
import { LAYER } from '../consts.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../combat/hitbox.js';

/**
 * @param {{
 *   x?: number, y?: number, w?: number, h?: number,
 *   duration?: number, tickRate?: number, damage?: number,
 *   team?: string, color?: string, label?: string,
 * }} opts
 */
export class HazardZone extends Entity {
  constructor(opts = {}) {
    super({
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      w: opts.w ?? 96,
      h: opts.h ?? 48,
      layer: LAYER.NONE, // zones don't block movement
      gravity: 0,
    });

    this.duration = opts.duration ?? 3;
    this.tickRate = opts.tickRate ?? 5;
    this.damage = opts.damage ?? 8;
    this.team = opts.team ?? 'ally';
    this.color = opts.color ?? 'rgba(255,120,30,0.3)';
    this.label = opts.label ?? 'hazard';

    this.t = 0;
    this.tickAcc = 0;
    this.alive = true;

    // Drawer: optional render override. Contract: (ctx, zone) => void.
    // null = use default HazardZone.draw (colored rect).
    this.drawer = null;

    this._hb = makeHitbox({
      owner: null, // set by caller (the attacker who created the zone)
      team: this.team,
      box: { x: this.x, y: this.y, w: this.w, h: this.h },
      damage: this.damage,
      method: this.label,
    });
    resetHitbox(this._hb);
  }

  /** Set the owner (attacker) for hitbox routing. Call after construction. */
  setOwner(owner) {
    this._hb.owner = owner;
  }

  /**
   * Advance the zone clock, tick damage.
   * @param {number} dt
   * @param {Array<object>} targets live entities to check against
   * @returns {Array<{target:object, dealt:number}>} hits this frame
   */
  update(dt, targets = []) {
    if (!this.alive) return [];
    this.t += dt;
    this.tickAcc += dt;

    const hits = [];
    const interval = 1 / Math.max(1, this.tickRate);
    while (this.tickAcc >= interval) {
      this.tickAcc -= interval;
      this._hb.box = { x: this.x, y: this.y, w: this.w, h: this.h };
      this._hb.damage = this.damage;
      resetHitbox(this._hb);
      processHitboxes([this._hb], targets, (_hb, t, dealt) => {
        hits.push({ target: t, dealt });
      });
    }

    if (this.t >= this.duration) {
      this.alive = false;
      this._hb.active = false;
    }
    return hits;
  }

  /** Draw the zone. Delegates to drawer if set; else debug rect. */
  draw(ctx) {
    if (!this.alive) return;
    if (typeof this.drawer === 'function') {
      this.drawer(ctx, this);
      return;
    }
    // Fade out during the last 20% of lifetime.
    const frac = 1 - this.t / this.duration;
    const alpha = frac < 0.2 ? frac / 0.2 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.strokeRect(this.x, this.y, this.w, this.h);
    ctx.restore();
  }
}
