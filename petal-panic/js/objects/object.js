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
import { spriteColorPulse } from '../effects/spriteColorPulse.js';
import { isHighGraphic } from '../core/renderMode.js';
import { LAYER } from '../consts.js';
import { flashTarget, assertDamageAmount } from '../combat/damage.js';
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
    // knockback omitted — inherits DEFAULT_EXPLOSION_KNOCKBACK (the primitive's default)
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
  coinDrop: { min: 4, max: 8, chance: 1.0, types: { bronze: 0.625, silver: 0.25, gold: 0.125 } },
  spriteAnim: 'coin',
};

/** Toxic barrel: on destruction erupts into a huge dust cloud (7×5 units,
 *  centered on the barrel) that ticks damage to everyone inside. No AoE
 *  blast — the cloud IS the damage. */
export const TOXIC_BARREL_DEF = {
  id: 'toxicBarrel',
  w: 32, h: 48,
  hp: 45,
  explosion: null,   // no instant blast — the dust zone is the payload
  coinDrop: null,
  spriteAnim: 'toxic',
};

/** Propane barrel: volatile. On destruction it detonates with the SAME AoE
 *  blast as the explosive barrel (radius 120, BARREL_DAMAGE, neutral, same
 *  knockback) AND pops a popcorn fan of molotov lobes (gravity arcs) that
 *  shatter into burning areas where they land. The blast is instant; the fire
 *  zones are the follow-up damage. */
export const PROPANE_BARREL_DEF = {
  id: 'propaneBarrel',
  w: 32, h: 48,
  hp: 50,
  // Identical blast to the explosive barrel — propane explodes for real.
  explosion: {
    radius: 120,
    damage: BARREL_DAMAGE,
    team: 'neutral',
    // knockback omitted — inherits DEFAULT_EXPLOSION_KNOCKBACK (the primitive's default)
  },
  coinDrop: null,
  spriteAnim: 'propane',
};

/** Super-coin barrel: tanky (hp 120). Every landed hit pops a few coins out
 *  (popcorn scatter); on destruction it fires a big final burst of many coins
 *  launched high into the sky, plus screen shake + white flash (explosion-feel
 *  but NO blast damage, NO explosion art — just the regular barrel particles).
 *  All coin velocities are more intense than a normal coin barrel. */
export const SUPERCOIN_BARREL_DEF = {
  id: 'superCoinBarrel',
  w: 32, h: 48,
  hp: 120,
  explosion: null,   // no AoE damage — pure reward
  // Final burst on destruction: many coins, high arc. `intense` scales the
  // pop speed; `upBias` pushes the arc higher into the sky.
  coinDrop: {
    min: 14, max: 22, chance: 1.0,
    types: { bronze: 0.35, silver: 0.4, gold: 0.25 },
    intense: 1.9,     // velocity multiplier vs. normal coin pop
    upBias: 1.5,      // extra upward component (launches into the sky)
  },
  // Per-hit popcorn: coins scale with damage dealt (2-4 per 10 dmg). A bomb
  // (40) pops ~4x a thorn (10); the killing blow pops for its full damage too.
  hitCoins: { min: 2, max: 4, perDamage: 10, intense: 1.7 },
  spriteAnim: 'supercoin',
};

// --- Barrel type registry (typed spawn) --------------------------------------
// Ordered list of all barrel types — the single source of truth for "which
// barrel types exist". The macro editor cycles these; the composer resolves
// placeholder `value` fields against them. Ids match BARREL_FACTORIES keys in
// world/build.js (NOT the def ids, which carry a Barrel suffix).
export const BARREL_TYPES = [
  { id: 'wood', label: 'Wood' },
  { id: 'explosive', label: 'Explosive' },
  { id: 'coin', label: 'Coin' },
  { id: 'supercoin', label: 'Super Coin' },
  { id: 'propane', label: 'Propane' },
  { id: 'toxic', label: 'Toxic' },
];

/** Lookup map: id → barrel meta. O(1) access. */
export const barrelById = Object.fromEntries(BARREL_TYPES.map((t) => [t.id, t]));

/** True when `id` is a known barrel type. */
export function isBarrelType(id) {
  return id != null && barrelById[id] != null;
}

// --- Sprite data (sprites.md runtime wiring, v1) ------------------------------
// Barrel art: three single-frame sheets share one frames_dir. The frame's natural size is
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
  const files = ['wooden_sheet.json', 'coin_sheet.json', 'explosion_sheet.json', 'supercoin_sheet.json', 'propane_sheet.json', 'toxic_sheet.json'];
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
      targetH: (def.h ?? 48) / 48,
      layer: LAYER.SOLID,          // barrels block movement (destructible solids)
      debugColor: '#f39c12',
      gravity: 0,                  // objects sit still; they don't fall
    });

    this.type = def.id;
    this.def = def;
    this.hp = def.hp ?? 60;
    this.maxHp = def.hp ?? 60;
    // Knockback susceptibility (knockback.js): resist divides the impulse, so
    // < 1 makes objects shove HARDER than enemies (default resist 1). Barrels
    // are light props — a sweep should launch them further than it shoves a
    // foe. Per-type override via def.knockbackResist (e.g. a heavy crate at 2).
    this.knockbackResist = def.knockbackResist ?? 0.8;
    // Generic explosion property (explosion.js). null = no blast. The engine
    // resolves it uniformly on destruction — no per-type special cases.
    this.explosion = def.explosion ?? null;
    this.coinDrop = def.coinDrop ?? null;
    this.hitFlash = 0;             // white-flash timer when struck (render reads it)
    this.destroyed = false;        // latched once HP hits 0 (prevents double-explode)

    // Sprite data (v1): one anim per barrel type, scaled from the collision box (§4).
    // `frames` is a LIVE accessor — it always reads the shared cache, so
    // entities constructed before initBarrelSprites() resolves still pick up
    // the images the moment they land. draw() falls back to the debug rect
    // until then.
    const spriteData = getBarrelSpriteData();
    if (def.spriteAnim && spriteData?.anims[def.spriteAnim]) {
      this.sprite = { anchor: 'bottom-center', anims: spriteData.anims };
      Object.defineProperty(this.sprite, 'frames', { get: () => barrelFrames });
      setAnimSafe(this, def.spriteAnim);
    }
  }

  /** Derived flag for backward compat: true when this object carries a blast. */
  get explosive() { return !!this.explosion; }

  /** Presentation only. stepDynamicSolid owns movement and collision together;
   * calling Entity.update here would integrate before its landing snapshot. */
  update(dt) {
    this.tickAnim(dt);
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
  takeDamage(dmg, _source, _method = 'projectile') {
    // PIN DOOR: a pinned barrel is dedicated to breaking at the end of the
    // supermove sequence — no damage path may break it early. Knockback still
    // applies; only the HP drain (and thus destroy()) is refused.
    if (this.pinned) return 0;
    assertDamageAmount(dmg, _source, this, _method);
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
    // Hit feedback is the effect engine's sprite-flash instance (fired from
    // flashTarget on hit) — no local white-rect overlay anymore.
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

/** Create a super-coin barrel at (x, y): tanky, pops coins on every hit and
 *  fires a big sky-high coin burst + shake/flash on destruction. */
export function makeSuperCoinBarrel(x, y) {
  return new GameObj(SUPERCOIN_BARREL_DEF, x, y);
}

/** Create a propane barrel at (x, y): on destruction pops a fan of molotov
 *  lobes that burn where they land. */
export function makePropaneBarrel(x, y) {
  return new GameObj(PROPANE_BARREL_DEF, x, y);
}

/** Create a toxic barrel at (x, y): on destruction erupts into a huge dust
 *  cloud centered on it. */
export function makeToxicBarrel(x, y) {
  return new GameObj(TOXIC_BARREL_DEF, x, y);
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

export const CHECKPOINT_TARGET_H = 2; // units (96px) — single source of truth

const CHECKPOINT_DEF = {
  id: 'checkpoint',
};

export class Checkpoint extends Entity {
  /**
   * @param {string} id checkpoint identifier (e.g. '1-1' … '1-4')
   * @param {number} x spawn x (top-left of box)
   * @param {number} y spawn y (top-left of box)
   */
  constructor(id, x, y, extra = {}) {
    super({
      x, y,
      targetH: CHECKPOINT_TARGET_H,
      layer: LAYER.CHECKPOINT,
      debugColor: '#ffd700',
      gravity: 0,
    });

    this.type = 'checkpoint';
    this.checkpointId = id;
    this.triggered = false;
    this.appearance = extra.appearance ?? 'entry';
    this._tint = null;    // spriteColorPulse instance (idle or captured)

    // Sprite data (v1): level vs boss flag art, scaled from the collision box (§4).
    // `frames` is a LIVE accessor (see barrel above) so late-loaded images are
    // picked up automatically.
    const spriteData = getCheckpointSpriteData();
    if (spriteData?.anims.level) {
      this.sprite = { anchor: 'bottom-center', anims: spriteData.anims };
      Object.defineProperty(this.sprite, 'frames', { get: () => checkpointFrames });
      setAnimSafe(this, 'level');
      // Entry flags start with the cloth raised (last frame of the ping-pong
      // order); exit flags start lowered and raise on trigger.
      if (this._player && this.appearance === 'entry') this._player.setProgress(1);
    }
    // Idle tint: infinite two-color pulse (darker gold → bright lemon).
    this._tint = spriteColorPulse({
      colorA: '#c9a227', colorB: '#fff176',
      duration: 1.3, cycles: -1, opacity: 0.7, easing: 'easeInOut',
    }, this);
  }

  /** Per-frame step: advance effects. */
  update(dt) {
    this.tickAnim(dt); // advance the flag cloth animation (6-frame ping-pong)
    if (this._tint && !this._tint.done) this._tint.update(dt);
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
    // Swap idle pulse for a solid yellow tint (colorA === colorB = no fade).
    this._tint = spriteColorPulse({
      colorA: '#fff176', colorB: '#fff176',
      duration: 1, cycles: -1, opacity: 0.7, easing: 'linear',
    }, this);
    // Exit flags raise the cloth when triggered; entry flags stay raised.
    if (this.appearance !== 'entry' && this._player) this._player.setProgress(1);
    // SFX: checkpoint
    return true;
  }

  /**
   * Draw the flag body + tint overlay.
   * - Before trigger: slow looping yellow pulse (attracts attention).
   * - After trigger: solid yellow tint stays permanently (activated state).
   * Both use the silhouette pipeline so the color follows the art.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!this.alive) return;
    super.draw(ctx);
    // Silhouette effects only in high-graphic mode (primitive/debug shows plain rect).
    if (!isHighGraphic()) return;
    if (this._tint && !this._tint.done) this._tint.render(ctx);
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
  const c = new Checkpoint(id, x, y, extra);
  c.isEntry = extra.isEntry ?? false;
  c.appearance = extra.appearance ?? 'entry';
  // Entry flags are ALWAYS activated (the hero starts there) — solid tint,
  // not the idle pulse.
  if (c.isEntry && c._tint) {
    c._tint = spriteColorPulse({
      colorA: '#fff176', colorB: '#fff176',
      duration: 1, cycles: -1, opacity: 0.7, easing: 'linear',
    }, c);
  }
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
