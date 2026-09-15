// Petal Panic — Objects (design §10 "Object"): destructible solids.
//
// An Object is a solid that blocks movement (layer SOLID) but also carries an
// HP pool. Unlike static platforms it can be damaged: melee swings, friendly
// projectiles, and bombs chip its HP; it does NOT break on touch or per-hit.
// When HP reaches 0 it is destroyed — a damaging barrel explodes (AoE within
// explodeRadius, hurting enemies AND the hero), while a coin barrel bursts
// into coins with no damage.
//
// The GameObj base is intentionally generic so later objects (checkpoints in
// task 4.3, other solids) can inherit from it. Barrels are the v1 concrete
// case. The explosion itself is a PURE function (explodeBarrel) that takes the
// world's live entities + the hero and applies central damage() to everything
// inside the radius — keeping the math unit-testable without a DOM.

import { Entity } from './entity.js';
import { LAYER } from './consts.js';
import { damage } from './damage.js';

// --- Tunables ----------------------------------------------------------------
export const BARREL_DAMAGE = 25;        // AoE damage dealt by a barrel explosion
const BOMB_ONE_SHOT_DMG = 999;          // a bomb always destroys a barrel outright

// --- Definitions -------------------------------------------------------------
/** Plain destructible solid — blocks movement, breaks into particles. No AoE, no coins. */
export const WOOD_BARREL_DEF = {
  id: 'woodBarrel',
  w: 32, h: 48,
  hp: 40,
  explosive: false,
  explodeRadius: 0,
};

/** Destructible solid that explodes on destruction (hurts everyone nearby). */
export const BARREL_DEF = {
  id: 'explosiveBarrel',
  w: 32, h: 48,
  hp: 60,
  explosive: true,
  explodeRadius: 120,
};

/** Same HP/destructible behavior, but bursts into coins instead of exploding. */
export const COIN_BARREL_DEF = {
  id: 'coinBarrel',
  w: 32, h: 48,
  hp: 60,
  explosive: false,   // no damaging explosion — just a coin burst
  explodeRadius: 0,
};

// ---------------------------------------------------------------------------
// GameObj — Object base class
// ---------------------------------------------------------------------------

export class GameObj extends Entity {
  /**
   * @param {object} def object definition: { id, w, h, hp, explosive, explodeRadius }
   * @param {number} [x] spawn x (top-left of box)
   * @param {number} [y] spawn y (top-left of box)
   */
  constructor(def, x = 0, y = 0) {
    super({
      x, y,
      w: def.w ?? 32,
      h: def.h ?? 48,
      layer: LAYER.SOLID,          // barrels block movement (destructible solids)
      debugColor: '#f39c12',
      gravity: 0,                  // objects sit still; they don't fall
    });

    this.type = def.id;
    this.def = def;
    this.hp = def.hp ?? 60;
    this.maxHp = def.hp ?? 60;
    this.explosive = def.explosive ?? true;
    this.explodeRadius = def.explodeRadius ?? 120;
    this.radius = this.explodeRadius; // base Entity radius — debug draws this
    this.hitFlash = 0;             // white-flash timer when struck (render reads it)
    this.destroyed = false;        // latched once HP hits 0 (prevents double-explode)
  }

  /** Per-frame step: only decay the hit-flash timer (clamped at 0). */
  update(dt) {
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
  }

  /**
   * Apply a single hit to this object. Drains HP directly (objects have no
   * defense stat sheet yet); sets the white flash. When HP reaches 0 the
   * object is destroyed (explosion / coin burst via destroy()).
   *
   * NOTE: we do NOT route through central damage() here because the target of
   * an object hit is the OBJECT itself (not a hero/enemy), and damage() would
   * set alive=false on the object which the caller manages. Keeping HP math
   * local keeps the "chip over several hits" behavior explicit and lets a bomb
   * one-shot via a large dmg value.
   *
   * @param {number} dmg raw damage amount
   * @param {object} [source] attacker (hero, ...) — informational for telemetry
   * @param {string} [method='projectile'] 'projectile' | 'melee' | 'bomb' | ...
   * @returns {number} damage actually applied (clamped to remaining HP)
   */
  hit(dmg, _source, _method = 'projectile') {
    if (!this.alive || this.destroyed) return 0;
    const applied = Math.min(this.hp, dmg);
    this.hp -= dmg;
    this.hitFlash = 0.1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroy();
    }
    return applied;
  }

  /**
   * Destroy the object. Latches `destroyed` so it fires exactly once even if
   * hit() is called again the same frame. A damaging barrel calls explode();
   * a coin barrel just drops out (the caller spawns the coin burst).
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.alive = false;
    if (this.explosive) {
      this.explode();
    }
  }

  /**
   * Fire the explosion hook. The actual AoE damage + VFX are driven by the
   * game loop calling explodeBarrel() (a pure function over the live entity
   * set) so the math stays testable. This hook exists so subclasses or future
   * objects can react locally if needed.
   */
  explode() {
    this.onExplode?.(this);
  }

  /**
   * Draw the object body. Falls back to the standard Entity transform pipeline
   * (debug rect) until real sprites land. Overlays a white flash when recently
   * struck so thorn/melee hits are visible.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!this.alive) return;
    super.draw(ctx);
    if (this.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.hitFlash * 10);
      const b = this.worldBox();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }
  }
}

// --- Factories ----------------------------------------------------------------

/** Create a damaging barrel at (x, y). */
export function makeBarrel(x, y) {
  return new GameObj(BARREL_DEF, x, y);
}

/** Create a plain wooden barrel (no explosion, no coins — just blocks + breaks). */
export function makeWoodBarrel(x, y) {
  return new GameObj(WOOD_BARREL_DEF, x, y);
}

/** Create a coin-bursting barrel at (x, y). */
export function makeCoinBarrel(x, y) {
  return new GameObj(COIN_BARREL_DEF, x, y);
}

// ---------------------------------------------------------------------------
// Checkpoint — restart position marker (design §10 "Object" / §13 level struct)
// ---------------------------------------------------------------------------
// A Checkpoint is NOT a solid: it doesn't block movement and has no HP pool.
// It only carries a CHECKPOINT layer bit so the HERO×CHECKPOINT collision rule
// fires when the hero walks into it. Touching it stores its position on the
// hero (hero.checkpoint = {x,y}) which the death/restart pipeline uses as the
// respawn point. Triggering latches per-checkpoint so re-walking over it does
// nothing; a fresh run gets fresh instances.

const CHECKPOINT_DEF = {
  id: 'checkpoint',
  w: 24, h: 48,
};

export class Checkpoint extends Entity {
  /**
   * @param {string} id checkpoint identifier (e.g. '1-1' … '1-4')
   * @param {number} x spawn x (top-left of box)
   * @param {number} y spawn y (top-left of box)
   */
  constructor(id, x, y) {
    super({
      x, y,
      w: CHECKPOINT_DEF.w,
      h: CHECKPOINT_DEF.h,
      layer: LAYER.CHECKPOINT,
      debugColor: '#ffd700',
      gravity: 0,
    });

    this.type = 'checkpoint';
    this.checkpointId = id;
    this.triggered = false;
    this.flashTimer = 0; // brief white flash after triggering (render reads it)
  }

  /** Per-frame step: decay the trigger flash timer. */
  update(dt) {
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
  }

  /**
   * Set the hero's restart position to this checkpoint. Latches so repeated
   * overlap frames can't re-trigger. Returns true when newly triggered.
   *
   * @param {object} hero the touching hero
   * @returns {boolean} true when the checkpoint fired this call
   */
  trigger(hero) {
    if (this.triggered) return false;
    this.triggered = true;
    hero.checkpoint = { x: this.x, y: this.y };
    this.flashTimer = 0.4;
    // SFX: checkpoint
    return true;
  }

  /**
   * Draw the flag body. Debug rect fallback until real sprites land; a white
   * flash overlay plays for FLASH duration right after triggering.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!this.alive) return;
    super.draw(ctx);
    if (this.flashTimer > 0) {
      const b = this.worldBox();
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.flashTimer * 2.5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
      ctx.restore();
    }
  }
}

/** Create a checkpoint with the given id at (x, y). */
export function makeCheckpoint(id, x, y) {
  return new Checkpoint(id, x, y);
}

// ---------------------------------------------------------------------------
// Explosion AoE — pure function (unit-testable, no DOM)
// ---------------------------------------------------------------------------

/**
 * Center point of an object's box.
 * @param {{x:number,y:number,w:number,h:number}} e
 * @returns {{cx:number, cy:number}}
 */
export function centerOf(e) {
  return { cx: e.x + e.w / 2, cy: e.y + e.h / 2 };
}

/**
 * True when the centers of `a` and `b` are within `radius` px of each other.
 * Center-to-center distance keeps the AoE circular and symmetric.
 * @param {{x:number,y:number,w:number,h:number}} a
 * @param {{x:number,y:number,w:number,h:number}} b
 * @param {number} radius
 */
export function withinRadius(a, b, radius) {
  const { cx: ax, cy: ay } = centerOf(a);
  const { cx: bx, cy: by } = centerOf(b);
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy) <= radius;
}

/**
 * Resolve a barrel explosion: apply AoE damage to every live entity whose
 * center lies within `obj.explodeRadius`. Enemies take it as 'explosion'
 * damage (routed through central damage()); the hero takes it too (self-damage
 * risk/reward). The exploding barrel itself is never hit.
 *
 * This is deliberately PURE with respect to the world: it mutates HP/energy
 * and returns a summary, leaving VFX + world removal to the caller. That makes
 * the acceptance criteria ("damages entities in radius including hero") trivial
 * to assert in node.
 *
 * @param {GameObj} obj the exploding barrel
 * @param {Array<object>} entities all live candidate targets (enemies, hero, ...)
 * @returns {{center:{cx,cy}, radius:number, hit:object[]}} explosion summary
 */
export function explodeBarrel(obj, entities) {
  const { cx, cy } = centerOf(obj);
  const radius = obj.explodeRadius;
  const hit = [];

  for (const e of entities) {
    if (!e || e === obj) continue;         // never self-hit the barrel
    if (e.alive === false) continue;       // skip already-dead
    if (!withinRadius(obj, e, radius)) continue;

    // Route damage so defense + telemetry apply uniformly, and — for targets
    // that own a death pipeline (real enemies) — let THEM handle the death
    // transition internally via takeDamage(). Heroes drain energy; placeholders
    // use raw damage(). The source never pokes at death directly.
    const dealt = typeof e.takeDamage === 'function'
      ? e.takeDamage(BARREL_DAMAGE, obj, 'explosion')
      : damage(obj, e, BARREL_DAMAGE, 'explosion');
    if (dealt > 0) {
      hit.push(e);
    }
  }

  return { center: { cx, cy }, radius, hit };
}
