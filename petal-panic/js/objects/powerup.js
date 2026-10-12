// Petal Panic — Powerups (design §10 "Powerup").
//
// A Powerup is a non-solid pickup (layer PICKUP) that applies a one-shot effect
// to the hero when collected. Effects are declared in POWERUP_DEFS as pure
// apply(hero, context) functions so each documented effect stays testable in
// node without a DOM or a running game loop.
//
// Collection contract (driven by the update system's 'pickup' collision rule):
//   - collect() latches `collected` + kills the entity so it can't double-apply
//   - def.apply(hero, context) mutates hero state (slots/energy/timers/lives...)
//   - traceStats.powerupsCollected[type] is bumped for telemetry (design §4)
//   - VFX (sparkle pop + floating label text) are spawned by the caller so this
//     module has no particle dependency and stays unit-testable.

import { Entity } from '../core/entity.js';
import { Anim, makeTestFrame } from '../core/anim.js';
import { LAYER } from '../consts.js';
import { record } from '../stats.js';

// --- Effect definitions ------------------------------------------------------
// Each entry: { label, color, duration?, apply(hero, context) }.
// `context` carries live game state the effect needs beyond the hero itself
// (e.g. the enemy list for 'clear'). All effects clamp sensibly.
export const POWERUP_DEFS = {
  invincibility: { label: 'Invincible!',  color: '#3498db', duration: 5,
                   apply: (hero) => {
                     hero.intangible = true;
                     hero.timers.set('intangible', Math.max(hero.timers.get('intangible'), 5));
                   } },
  // Special drop (special-weapons.md): grants a RANDOM special weapon — bomb or
  // petal saw — identical for both heroes. The hero's slot model owns placement
  // + auto-select; this def only picks the type.
  specialDrop:   { label: 'Special!',     color: '#9b59b6',
                   apply: (hero, _ctx, p) => {
                     // Use the instance's pre-rolled weapon (p.specialRoll) so
                     // the placeholder icon matches what actually lands in the slot.
                     hero.acquireSpecial(p?.specialRoll ?? (Math.random() < 0.5 ? 'bomb' : 'saw'));
                   } },
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

// --- Placeholder visuals (TEMP — until real powerup sprites are wired) -------
// Each type gets a distinct color + a big glyph so drops are identifiable at a
// glance during testing. specialDrop rolls bomb/saw per instance (matching the
// effect), so you can SEE which special is about to drop.
const PLACEHOLDER_STYLE = {
  invincibility: { color: '#f1c40f', glyph: '★' },
  specialDrop:   { color: '#9b59b6', glyph: null }, // resolved per instance
  rapid:         { color: '#e67e22', glyph: '»' },
  shield:        { color: '#3498db', glyph: '⛨' },
  clear:         { color: '#e74c3c', glyph: '✸' },
  energy:        { color: '#2ecc71', glyph: '♥' },
  oneUp:         { color: '#e74c3c', glyph: '1UP' },
};
const SPECIAL_GLYPHS = { bomb: '💣', saw: '⚙' };

/** Build a single-frame placeholder canvas: colored body + centered glyph. */
function placeholderFrame(w, h, color, glyph) {
  const c = makeTestFrame(w, h, color);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.font = `bold ${Math.floor(h * 0.55)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, w / 2, h / 2 + 1);
  return [c];
}

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

    // Placeholder sprite (TEMP): distinct per type; specialDrop shows the
    // actual rolled weapon so the drop is visually unambiguous.
    const st = PLACEHOLDER_STYLE[type] ?? { color: def.color, glyph: '?' };
    let glyph = st.glyph;
    if (type === 'specialDrop') {
      this.specialRoll = Math.random() < 0.5 ? 'bomb' : 'saw';
      glyph = SPECIAL_GLYPHS[this.specialRoll];
    }
    this.debugColor = st.color;
    this.anim = new Anim(placeholderFrame(this.w, this.h, st.color, glyph), {
      speed: 100, loop: true,
    });
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
    this.def.apply(hero, context?.enemies ?? [], this);

    // Telemetry (design §4: powerupsCollected per type) — into the trace.
    if (hero.traceStats) {
      record(hero, { kind: 'powerup', type: this.powerType });
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
