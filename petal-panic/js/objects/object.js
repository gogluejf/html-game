// Petal Panic — Objects (design §10 "Object"): destructible solids.
// An Object is a solid that blocks movement (layer SOLID) but also carries an
// HP pool. Unlike static platforms it can be damaged: melee swings, friendly
// projectiles, and bombs chip its HP; it does NOT break on touch or per-hit.
// When HP reaches 0 it is destroyed — a damaging barrel explodes (AoE within
// its explosion.radius, hurting enemies AND the hero), while a coin barrel bursts
// into coins with no damage.
// The GameObj base is intentionally generic so later objects (checkpoints in
// , other solids) can inherit from it. Barrels are the v1 concrete
// case. The explosion itself is a PURE function (resolveExplosion in
// explosion.js) that takes the world's live entities + the hero and applies
// central damage() to everything inside the radius — keeping the math
// unit-testable without a DOM.

import { Entity } from '../core/entity.js';
import { LAYER } from '../consts.js';
import { BARREL_EXPLOSION_KNOCKBACK } from '../combat/explosion.js';
import { flashTarget } from '../combat/damage.js';
import { parseSheet } from '../core/spriteData.js';
import { loadFrames } from '../core/frameLoader.js';

// --- Tunables ----------------------------------------------------------------
export const BARREL_DAMAGE = 25;        // AoE damage dealt by a barrel explosion
const BOMB_ONE_SHOT_DMG = 999;          // a bomb always destroys a barrel outright

// --- Definitions -------------------------------------------------------------
/** Plain destructible solid — blocks movement, breaks into particles. No AoE, no coins. */
export const WOOD_BARREL_DEF = {
  id: 'woodBarrel',
  w: 32, h: 48,
  hp: 40,
  explosion: null,   // no blast — just breaks into wood chips
  coinDrop: null,
  spriteAnim: 'wooden',
};

/** Destructible solid that explodes on destruction (hurts everyone nearby). */
export const BARREL_DEF = {
  id: 'explosiveBarrel',
  w: 32, h: 48,
  hp: 60,
  explosion: {
    radius: 120,
    damage: BARREL_DAMAGE,
    team: 'neutral',
    knockback: BARREL_EXPLOSION_KNOCKBACK,
  },
  coinDrop: null,
  spriteAnim: 'explosion',
};

/** Same HP/destructible behavior, but bursts into coins instead of exploding. */
export const COIN_BARREL_DEF = {
  id: 'coinBarrel',
  w: 32, h: 48,
  hp: 60,
  explosion: null,   // no damaging explosion — just a coin burst
  coinDrop: { min: 4, max: 6, chance: 1.0, types: { bronze: 0.7, silver: 0.25, gold: 0.05 } },
  spriteAnim: 'coin',
};

// --- Sprite data (sprites.md runtime wiring, v1) ------------------------------
// Barrel art: three single-frame sheets share one frames_dir. The frame bbox is
// the scaling reference (§4 v1) — setAnim() fits it onto the 48px box height.
//
// Loading strategy: async boot (initBarrelSprites / initCheckpointSprites).
// Why NOT static JSON imports: Chromium <189 rejects `import ... with { type:
// 'json' }` as a SYNTAX ERROR (verified on 156 — kills the whole module graph),
// and plain JSON imports fail in Node 24 (ERR_IMPORT_ATTRIBUTE_MISSING).
// Browser: fetch(). Node: fs fallback (tests + headless probes).
let barrelSpriteData = null;
let barrelFrames = new Map(); // shared frame cache, filled by initBarrelSprites()
export function getBarrelSpriteData() { return barrelSpriteData; }
export function initBarrelSprites() {
  if (barrelSpriteData || typeof fetch === 'undefined') return Promise.resolve();
  const base = new URL('../../assets/objects/barrel/', import.meta.url).href;
  const files = ['wooden_sheet.json', 'coin_sheet.json', 'explosion_sheet.json'];
  const load = base.startsWith('file:')
    ? Promise.all(files.map((f) => readFileJson(new URL(f, base))))
    : Promise.all(files.map((f) => fetch(base + f).then((r) => r.json())));
  return load
    .then((sheets) => {
      barrelSpriteData = parseSheet(sheets);
      return loadFrames(barrelSpriteData, base);
    })
    .then((imgs) => { if (imgs && imgs.size > 0) barrelFrames = imgs; })
    .catch((e) => console.warn('[sprite] barrel sheets failed to load', e));
}

let checkpointSpriteData = null;
let checkpointFrames = new Map(); // shared frame cache, filled by initCheckpointSprites()
export function getCheckpointSpriteData() { return checkpointSpriteData; }
export function initCheckpointSprites() {
  if (checkpointSpriteData || typeof fetch === 'undefined') return Promise.resolve();
  const base = new URL('../../assets/objects/checkpoint/', import.meta.url).href;
  const files = ['level_sheet.json', 'boss_sheet.json'];
  const load = base.startsWith('file:')
    ? Promise.all(files.map((f) => readFileJson(new URL(f, base))))
    : Promise.all(files.map((f) => fetch(base + f).then((r) => r.json())));
  return load
    .then((sheets) => {
      checkpointSpriteData = parseSheet(sheets);
      return loadFrames(checkpointSpriteData, base);
    })
    .then((imgs) => { if (imgs && imgs.size > 0) checkpointFrames = imgs; })
    .catch((e) => console.warn('[sprite] checkpoint sheets failed to load', e));
}

/** Node-only JSON reader for file: URLs (browser uses fetch instead). */
async function readFileJson(url) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  return JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
}

// ---------------------------------------------------------------------------
// GameObj — Object base class
// ---------------------------------------------------------------------------

export class GameObj extends Entity {
  /**
   * @param {object} def object definition: { id, w, h, hp, explosion }
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
    // Generic explosion property (explosion.js). null = no blast. The engine
    // resolves it uniformly on destruction — no per-type special cases.
    this.explosion = def.explosion ?? null;
    this.coinDrop = def.coinDrop ?? null;
    this.hitFlash = 0;             // white-flash timer when struck (render reads it)
    this.destroyed = false;        // latched once HP hits 0 (prevents double-explode)

    // Sprite data (v1): one anim per barrel type, bbox-scaled to the box.
    // `frames` is a LIVE accessor — it always reads the shared cache, so
    // entities constructed before initBarrelSprites() resolves still pick up
    // the images the moment they land. draw() falls back to the debug rect
    // until then.
    const spriteData = getBarrelSpriteData();
    if (def.spriteAnim && spriteData?.anims[def.spriteAnim]) {
      this.sprite = { anchor: 'bottom-center', targetH: 1.0, anims: spriteData.anims };
      Object.defineProperty(this.sprite, 'frames', { get: () => barrelFrames });
      setAnimSafe(this, def.spriteAnim);
    }
  }

  /** Derived flag for backward compat: true when this object carries a blast. */
  get explosive() { return !!this.explosion; }

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
    if (applied > 0) flashTarget(this);
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
   * game loop calling resolveExplosion() (explosion.js) with a neutral team
   * over the live entity set so the math stays testable. This hook exists so
   * subclasses or future objects can react locally if needed.
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

    // Sprite data (v1): level vs boss flag art, bbox-scaled to the box.
    // `frames` is a LIVE accessor (see barrel above) so late-loaded images are
    // picked up automatically.
    const spriteData = getCheckpointSpriteData();
    if (spriteData?.anims.level) {
      this.sprite = { anchor: 'bottom-center', targetH: 1.0, anims: spriteData.anims };
      Object.defineProperty(this.sprite, 'frames', { get: () => checkpointFrames });
      setAnimSafe(this, 'level');
    }
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
    // REVISION-zones-as-data §4: respawn position is zone data (feet on the
    // floor), not the flag's sprite box. Fallback keeps legacy flags working.
    hero.checkpoint = this.spawnPos ?? { x: this.x, y: this.y };
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

/**
 * Create a checkpoint with the given id at (x, y).
 * @param {string} id checkpoint identifier (e.g. '1-1', '1-4-exit', '1-boss')
 * @param {number} x spawn x (top-left of box)
 * @param {number} y spawn y (top-left of box)
 * @param {object} [extra] optional descriptor fields carried on the flag:
 *   { isEntry?: boolean, appearance?: string }. `isEntry` marks the area's
 *   ENTRY flag (the starting checkpoint — it must not re-clear the area the
 *   hero just entered, checkpoints.md §1); `appearance` is the flag's visual
 *   kind ('entry' | 'exit' | 'boss-checkpoint').
 */
export function makeCheckpoint(id, x, y, extra = {}) {
  const c = new Checkpoint(id, x, y);
  c.isEntry = extra.isEntry ?? false;
  c.appearance = extra.appearance ?? 'entry';
  // Boss-zone flags use the boss flag art (2-anim dict: level/boss).
  if (c.sprite && c.appearance === 'boss-checkpoint') setAnimSafe(c, 'boss');
  // Restart position stored on hero.checkpoint when this flag triggers:
  // feet-on-floor (y = floor top), so respawn() places the hero standing.
  // Entry flags never trigger (naive sprites) — their spawnPos is unused.
  c.spawnPos = extra.spawnPos ?? null;
  return c;
}

/** setAnim wrapper that degrades silently when sprite data is missing
 *  (node tests / parse failure) so entity construction never hard-crashes. */
function setAnimSafe(entity, name) {
  try {
    entity.setAnim(name);
  } catch {
    /* no sprite data — legacy rect path stays active */
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers (unit-testable, no DOM) — retained for the archived
// bck/object.test.js references. The live blast path routes through the generic
// resolveExplosion() in explosion.js; these are pure center/distance utilities.
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
