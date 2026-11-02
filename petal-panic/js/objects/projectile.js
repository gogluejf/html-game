// Petal Panic — Projectiles + 8-way shooting (design §4, §10).
//
// The thorn is the standard Contra-style shot: it flies in a straight line
// (no gravity) along one of 8 directions and dies after a short lifetime or
// when it leaves the level. All projectiles are drawn from a fixed-size object
// pool so sustained fire never allocates (acceptance #4: no GC pressure).
//
// Friendly flag drives BOTH the collision layer (PROJ_ALLY vs PROJ_FOE) and the
// debug color. Friendly (hero) projectiles only ever hit ENEMY/BOSS per the
// COLLISION_RULES masks — they can NEVER touch the hero (acceptance #3).

import { invalidateImpactMotion } from '../combat/entryImpact.js';
import { Entity } from '../core/entity.js';
import { LAYER, UNIT_PX_Y } from '../consts.js';
import { parseSheet } from '../core/spriteData.js';
import { loadFrames } from '../core/frameLoader.js';
import { spriteOutline } from '../effects/spriteOutline.js';
import { isHighGraphic } from '../core/renderMode.js';
import { specialById, isSpecialType } from './specialWeapons.js';
import { rockDrawer, bombDrawer, explosiveDrawer, homingDrawer, sawDrawer, spreadDrawer } from '../combat/attack/drawers/index.js';

/** Primitive-mode look per weapon identity (visual-identity contract): one
 *  drawer file per special under combat/attack/drawers/. No inline branches. */
const SPECIAL_FALLBACK_DRAWERS = Object.freeze({
  bomb: bombDrawer,
  explosive: explosiveDrawer,
  homing: homingDrawer,
  saw: sawDrawer,
  spread: spreadDrawer,
});

// --- Tunables ----------------------------------------------------------------
export const MAX_PROJECTILES = 64;        // hard cap on live projectiles (perf param, §17)
const PROJECTILE_LIFETIME = 2;            // seconds before a shot auto-culls
const PROJECTILE_SPEED = 600;             // px/s
const PROJECTILE_DAMAGE = 10;             // base damage per thorn hit
/** Thorn collision height in units. Width derives solely from the authored
 *  sheet collision aspect ratio; never force a square. */
export const PROJECTILE_TARGET_H = 0.22;
/** The thorn art's nose points RIGHT — the standard facing-right
 *  convention, so aiming the nose along velocity v needs NO offset:
 *  rotation = atan2(vy, vx). Orientation is rotation-only for projectiles
 *  (no mirror); the render pipeline applies ctx.rotate(rotation) in a frame
 *  whose untransformed "0" is facing-right (baseSpriteAngle = 0). */
export const PROJECTILE_BASE_ROTATION = 0;

/** Rotation that aims the art's nose along (vx, vy). Single source of truth
 *  for projectile orientation — constructor AND spawn-time velocity overrides
 *  both route through here. */
export function aimRotation(vx, vy) {
  return Math.atan2(vy, vx) - PROJECTILE_BASE_ROTATION;
}

// --- Sprite data (thorn sheet — SOTA wiring, sprite-player-projectile plan T5) --
let projectileSpriteData = null;
let projectileFrames = new Map(); // shared frame cache, filled at boot
export function getProjectileSpriteData() { return projectileSpriteData; }

// Special-weapon sheets (Step A): per-type shoot/fly anim + bomb's explode
// anim. The SHEET IS THE SOURCE OF TRUTH: the editor-authored collision box
// is the scaling reference (§4) and the entity box derives from it — width =
// collisionBox.w × scale, no baseW, no synthetic fallback. A sheet without an
// authored box is an asset bug: setAnim() → uniformScale() throws loudly.
// Per-weapon size + anim live in the REGISTRY (specialWeapons.js): size is
// declared there in Y-units (single source of truth); this table only maps
// type → sheet dir/anim for the loader.
const SPECIAL_SPRITE_TARGETS = Object.freeze({
  saw: { anim: 'shoot' },
  spread: { anim: 'shoot' },
  bomb: { anim: 'shoot' },
  homing: { anim: 'fly' },
  explosive: { anim: 'fly' },
});
const specialSpriteData = new Map();   // type → parsed sheet (anims patched)
const specialSpriteFrames = new Map(); // type → frame image map
export function getSpecialSpriteData(type) { return specialSpriteData.get(type) ?? null; }
export function initSpecialSprites() {
  if (typeof fetch === 'undefined') return Promise.resolve();
  const jobs = [];
  for (const [type, cfg] of Object.entries(SPECIAL_SPRITE_TARGETS)) {
    if (specialSpriteData.has(type)) continue;
    const base = new URL(`../../assets/projectiles/${type}/`, import.meta.url).href;
    const load = base.startsWith('file:')
      ? readFileJson(new URL(`${cfg.anim}_sheet.json`, base))
      : fetch(base + `${cfg.anim}_sheet.json`).then((r) => r.json());
    jobs.push(load
      .then((sheet) => {
        const data = parseSheet(sheet);
        // SHEET IS THE SOURCE OF TRUTH: the editor-authored collision box +
        // pivot are used as-is. No synthetic fallback — a sheet without an
        // authored box is an asset bug and must fail loudly (scaleReference).
        data.anims[cfg.anim]._frames = null; // filled by loadFrames below
        specialSpriteData.set(type, data);
        return loadFrames(data, base);
      })
      .then((imgs) => {
        if (imgs && imgs.size > 0) {
          specialSpriteFrames.set(type, imgs);
          specialSpriteData.get(type).anims[cfg.anim]._frames = imgs;
        }
      })
      .catch((e) => console.warn(`[sprite] ${type} sheet failed to load`, e)));
  }
  // Bomb detonation art: plays over the impact point on explosion (visual only).
  const bbase = new URL('../../assets/projectiles/bomb/', import.meta.url).href;
  const bload = bbase.startsWith('file:')
    ? readFileJson(new URL('explode_sheet.json', bbase))
    : fetch(bbase + 'explode_sheet.json').then((r) => r.json());
  jobs.push(bload
    .then((sheet) => {
      const data = parseSheet(sheet);
      // Sheet is the source of truth (see above): authored box/pivot as-is.
      data.anims.explode._frames = null;
      specialSpriteData.set('bomb_explode', data);
      return loadFrames(data, bbase);
    })
    .then((imgs) => {
      if (imgs && imgs.size > 0) {
        specialSpriteFrames.set('bomb_explode', imgs);
        specialSpriteData.get('bomb_explode').anims.explode._frames = imgs;
      }
    })
    .catch((e) => console.warn('[sprite] bomb explode sheet failed to load', e)));
  return Promise.all(jobs);
}
export function initProjectileSprites() {
  if (projectileSpriteData || typeof fetch === 'undefined') return Promise.resolve();
  const base = new URL('../../assets/projectiles/thorn/', import.meta.url).href;
  const load = base.startsWith('file:')
    ? readFileJson(new URL('shoot_sheet.json', base))
    : fetch(base + 'shoot_sheet.json').then((r) => r.json());
  return load
    .then((sheet) => {
      projectileSpriteData = parseSheet(sheet);
      return loadFrames(projectileSpriteData, base);
    })
    .then((imgs) => { if (imgs && imgs.size > 0) projectileFrames = imgs; })
    .catch((e) => console.warn('[sprite] thorn sheet failed to load', e));
}
async function readFileJson(url) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  return JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
}

import { dirAngle } from '../core/vec.js';
export { dirAngle };

/**
 * Map a directional input state to an 8-way aim index.
 * No horizontal input → use `facing` (the last way the hero moved).
 * @param {{left?:boolean,right?:boolean,up?:boolean,down?:boolean}} input
 * @param {number} facing -1 | 1 (hero's current horizontal facing)
 * @returns {number} 0..7
 */
export function aimFromInput(input, facing) {
  // Explicit aim is authoritative; never reconstruct it from movement after locks.
  const hasAim = Number.isFinite(input.aimX) && Number.isFinite(input.aimY);
  const dx = hasAim ? input.aimX : (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = hasAim ? input.aimY : (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (Math.hypot(dx, dy) < 1e-6) return facing >= 0 ? DIR_RIGHT : DIR_LEFT;
  return ((Math.round(-Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
}

// 8-way aim indices (DIR_ANGLES order). Exported so the contextual rules in
// hero.resolveAim and the lock-capture rule in input.js share one table.
export const DIR_RIGHT = 0, DIR_LEFT = 4, DIR_DOWN = 6;

export class Projectile extends Entity {
  /**
   * @param {number} x spawn x (top-left of the box)
   * @param {number} y spawn y
   * @param {number} dir 0..7 aim index (see DIR_ANGLES)
   * @param {boolean} [friendly=true] true = hero's shot, false = enemy/boss shot
   */
  constructor(x, y, dir, friendly = true) {
    super();
    this.initialize(x, y, dir, friendly);
  }

  initialize(x, y, dir, friendly = true) {
    super.initialize({
      x, y,
      targetH: PROJECTILE_TARGET_H, // pure size model — width is sheet-owned (§4)
      layer: friendly ? LAYER.PROJ_ALLY : LAYER.PROJ_FOE,
      debugColor: friendly ? '#ff6ec7' : '#ff4444',
      gravity: 0, // projectiles fly straight
    });

    invalidateImpactMotion(this);
    this.friendly = friendly;
    this.speed = PROJECTILE_SPEED;
    this.damage = PROJECTILE_DAMAGE;
    this.life = PROJECTILE_LIFETIME;
    this.dir = dir;
    // Solid-collision behavior (data, not class): 'phase' — thorns fly through
    // terrain; only barrels (GameObj) stop them.
    this.solidBehavior = 'phase';

    const angle = dirAngle(dir);
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;
    // Orientation: nose along velocity (rotation-only, no mirror).
    this.orientSprite(this.vx, this.vy);

    // Sprite (SOTA): thorn sheet via the standard pipeline. `frames` is a LIVE
    // accessor so boot-time image loading is picked up without rebuilds.
    // Node / pre-boot: sprite data null → primitive rect fallback (unchanged).
    if (projectileSpriteData?.anims.shoot) {
      this.sprite = { anchor: 'center', anims: projectileSpriteData.anims };
      Object.defineProperty(this.sprite, 'frames', { get: () => projectileFrames });
      try { this.setAnim('shoot'); } catch { /* legacy rect path stays active */ }
    }
    // Persistent 6px white outline (same effect as the checkpoint flag —
    // follows silhouette + rotation; box fallback when no sheet frame loaded).
    this._outline = spriteOutline({ color: '#ffffff', thickness: 4, opacity: 1.0 }, this);

    // Drawer: optional render override. Contract: (ctx, entity) => void.
    // null = use default draw (sheet sprite or debug rect). Set per-shot by
    // the attack engine or weapon code to customize visuals without subclassing.
    this.drawer = null;
  }

  /**
   * Draw this projectile. Delegates to `this.drawer` if set; otherwise falls
   * back to the Entity debug rect. The drawer receives (ctx, this) so it has
   * full access to position, size, rotation, etc.
   */
  draw(ctx) {
    if (this.visible === false) return;
    if (typeof this.drawer === 'function') {
      this.drawer(ctx, this);
      return;
    }
    super.draw(ctx);
    // White outline on top of the sprite (high-graphic only, like checkpoint).
    if (isHighGraphic() && this._outline && !this._outline.done) this._outline.render(ctx);
  }

  reflectVelocity(box) {
    super.reflectVelocity(box);
    invalidateImpactMotion(this);
  }

  update(dt) {
    this._impactPrevX = this.x;
    this._impactPrevY = this.y;
    this._impactPoint = null;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.orientSprite(this.vx, this.vy);
    this.tickAnim(dt);
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

}

/**
 * Fixed-size object pool. Objects are pre-allocated once; spawn() reuses any
 * inactive slot by initializing it in place, so no new
 * objects are created during gameplay. When every slot is live, spawn() returns
 * null and the caller simply skips firing (soft cap).
 */
export class Pool {
  /**
   * @param {Function} ClassRef constructor taking (...args)
   * @param {number} size number of pre-allocated slots
   */
  constructor(ClassRef, size) {
    this.ClassRef = ClassRef;
    this.items = [];
    this.active = [];
    for (let i = 0; i < size; i++) {
      const item = new ClassRef(0, 0, 0);
      item.alive = false; // parked until spawned
      this.items.push(item);
    }
  }

  /**
   * Reuse an inactive slot in place, preserving effect/carrier identity.
   * @returns {object|null} the live item, or null if the pool is exhausted.
   */
  spawn(...args) {
    for (const item of this.items) {
      if (!item.alive && !(item._attackId === 'ballistic' && !item._attackDone &&
          item._attackHandle && !item._attackHandle._cancelled && !item._attackHandle._completed)) {
        // A collision can kill a slot AFTER updateAll's cleanup. Reusing it
        // must not append the same object a second time (double physics).
        // Remove extension fields from the previous attack generation.
        for (const key of Object.keys(item)) delete item[key];
        // Reinitialize the LIVE slot: copying a temporary instance leaves
        // effect closures bound to that unmoving temporary carrier.
        item.initialize(...args);
        item.alive = true;
        if (!this.active.includes(item)) this.active.push(item);
        return item;
      }
    }
    return null; // pool exhausted — skip this shot
  }

  /** Advance every active item; drop any that died this step. */
  updateAll(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i];
      item.update(dt);
      if (!item.alive) {
        this.active.splice(i, 1);
      }
    }
  }

  /** @returns {Array<object>} currently-live items (mutable internal array). */
  get activeItems() { return this.active; }

  /** Number of live projectiles. */
  get count() { return this.active.length; }
}

// Shared global pool: the single source of all live projectiles.
export const projectilePool = new Pool(Projectile, MAX_PROJECTILES);

// --- Special projectiles (design §4, §10) ------------------------------------
// Hero-specific weapons: bigger box, more damage, longer cooldown.
// Weapon identity lives in the SPECIAL_WEAPONS registry (specialWeapons.js):
// both heroes can hold any weapon, so every property — including the FIRE
// COOLDOWN — belongs to the weapon definition. fireCooldown is the hero-side
// gate between shots of THIS weapon (seconds).

/** Per-weapon tuning — re-exported for backward compat with existing imports. */
export const SPECIAL_WEAPON_DEFS = Object.fromEntries(
  Object.values(specialById).map(w => [w.id, {
    speed: w.speed, damage: w.damage, lifetime: w.lifetime, size: w.size,
    fireCooldown: w.fireCooldown,
    ...(w.gravity ? { gravity: w.gravity } : {}),
    ...(w.explode ? { fuse: w.lifetime, explodeRadius: w.radius } : {}),
  }]),
);

export class Special extends Entity {
  /**
   * @param {number} x spawn x
   * @param {number} y spawn y
   * @param {number} dir 0..7 aim index
   * @param {string} type special weapon id (see SPECIAL_WEAPONS registry)
   */
  constructor(x, y, dir, type) {
    super();
    this.initialize(x, y, dir, type);
  }

  initialize(x, y, dir, type) {
    // Parked pool slots are built with no type; they stay inert until spawn()
    // copies a fully-built instance over them via Object.assign.
    const meta = type != null ? specialById[type] : null;
    if (type != null && !meta) throw new Error(`Unknown special weapon: ${type}`);
    super.initialize({
      x, y,
      // SHEET-OWNED size (sprites.md contract): no baseW. Height = targetH × 48
      // from the REGISTRY's unit size (single source of truth — specialWeapons.js);
      // width follows the active anim's collision box via setAnim(). Pre-boot
      // fallback is the natural square (targetH × 48) until the sheet loads.
      targetH: meta?.size ?? 1 / 3,
      layer: LAYER.PROJ_ALLY,
      debugColor: meta?.color ?? '#888',
      gravity: (meta?.gravity ?? 0) > 0 ? 1 : 0,
    });

    this.type = type;
    // Pose state resets per life (pooled slots keep fields across reuse):
    // default to the horizontal-flight pose.
    this._poseTransposed = false;
    invalidateImpactMotion(this);
    this.friendly = true;
    // Solid-collision behavior per WEAPON (special-weapons.md): bombs BOUNCE
    // off terrain (reflect + keep flying, fuse still runs); saws/spread ABSORB
    // (the short-range blade dies on impact). Policy is consumed by the collision
    // handler via this flag — the physics primitive is reflectVelocity().
    this.solidBehavior = meta?.solidBehavior ?? 'stop';
    this.speed = meta?.speed ?? 0;
    this.damage = meta?.damage ?? 0;
    this.life = meta?.lifetime ?? 0;
    this.gravityValue = meta?.gravity ?? 0; // actual px/s² for ballistic weapons
    // Register the countdown under a descriptive label so the debug stack reads
    // 'fuse' for AoE weapons and 'life' for range-limited ones. Both are driven
    // by the same tickTtl()/ttlExpired expiry path.
    this._ttlLabel = meta?.explode ? 'fuse' : 'life';
    this.setLife(this.life);
    if (meta?.explode) {
      // Relabel the life timer as 'fuse' for display; tickTtl() honors _ttlLabel.
      this.timers.clear('life');
      this.timers.set('fuse', this.life);
    }
    this.radius = meta?.explode ? meta.radius : 0;
    this.exploded = false;

    const angle = dirAngle(dir);
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;
    // Orient the art nose along velocity (same contract as Projectile).
    // Bombs fly fuse-forward: mirrorX flips for leftward throws so the art
    // faces its travel direction; rotation follows the velocity tangent.
    if (type === 'bomb') {
      this.mirrorX = this.vx < -1e-9;
      this.rotation = Math.atan2(this.vy, this.mirrorX ? -this.vx : this.vx);
    } else {
      this.orientSprite(this.vx, this.vy);
    }

    // Sprite (Step A): per-type sheet via the standard pipeline. `frames` is a
    // LIVE accessor so boot-time image loading is picked up without rebuilds.
    // Node / pre-boot: sprite data null → procedural fallback in draw().
    if (type != null) {
      const data = specialSpriteData.get(type);
      const cfg = SPECIAL_SPRITE_TARGETS[type];
      if (data?.anims[cfg.anim]) {
        this.sprite = { anchor: 'center', anims: data.anims };
        Object.defineProperty(this.sprite, 'frames', { get: () => specialSpriteFrames.get(type) });
        try {
          this.setAnim(cfg.anim);
          // Re-aim AFTER setAnim: the sheet's authored start-frame offset can
          // shift the pivot-derived angle, and pooled slots may carry stale
          // orientation from their previous life. orientSprite() is idempotent
          // (pure function of vx/vy), so re-applying it here guarantees the
          // nose points along travel regardless of spawn path.
          this.orientSprite(this.vx, this.vy);
          // White outline like the thorn — keeps fast small shots readable.
          this._outline = spriteOutline({ color: '#ffffff', thickness: 2, opacity: 1.0 }, this);
        } catch { /* procedural path stays active */ }
      }
    }

    // Drawer: optional render override. Contract: (ctx, entity) => void.
    // null = use default Special.draw (type-branched). Set per-shot to
    // customize visuals without subclassing.
    this.drawer = null;
  }

  reflectVelocity(box) {
    super.reflectVelocity(box);
    invalidateImpactMotion(this);
  }

  update(dt) {
    this._impactPrevX = this.x;
    this._impactPrevY = this.y;
    this._impactPoint = null;
    this._bombPrevBottom = this.y + this.h;
    // Gravity for ballistic weapons (bombs).
    if (this.gravityValue > 0 && !this._bombSettled) {
      this.vy += this.gravityValue * dt;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Re-aim the art nose along velocity every frame. Engine-owned carriers
    // (homing missiles steered by their macro, explosive shots) have vx/vy
    // mutated OUTSIDE this class — without this, the sheet art would stay
    // frozen at the launch angle while the body curves. Bombs handle their
    // own fuse-forward orientation below (mirrorX + settle ease-back).
    if (this.type !== 'bomb') this.orientSprite(this.vx, this.vy);

    // Bomb orientation (sheet art): while flying, the fuse trails the motion —
    // rotation follows the velocity tangent and mirrorX tracks horizontal
    // direction. Once settled (resting on a surface), ease back to upright so
    // the fuse sits on top instead of frozen at the landing angle.
    if (this.type === 'bomb' && this.sprite) {
      const speed = Math.hypot(this.vx, this.vy);
      if (speed > 1 || !this._bombSettled) {
        if (speed > 1) {
          this.mirrorX = this.vx < -1e-9;
          this.rotation = Math.atan2(this.vy, this.mirrorX ? -this.vx : this.vx);
        }
      }
      if (this._bombSettled && speed <= 1) {
        const target = 0; // upright: fuse up
        const diff = target - this.rotation;
        // Shortest-arc ease (~120ms at 60fps).
        const step = Math.sign(diff) * Math.min(Math.abs(diff), 12 * dt);
        this.rotation += step;
        if (Math.abs(this.rotation) < 0.01) this.rotation = 0;
      }
    }

    this.tickAnim(dt);

    // TTL countdown.
    const wasAlive = this.alive;
    if (!this._bombFuseDisabled) this.tickTtl(dt);
    // If we just died from TTL, flag it so the update loop can call explodeSpecial().
    if (wasAlive && !this.alive) {
      this.ttlExpired = true;
    }
  }

  draw(ctx) {
    if (!this.alive || this._attackVisualOwned) return;
    // Drawer override: standalone (ctx, entity) => void.
    if (typeof this.drawer === 'function') {
      this.drawer(ctx, this);
      return;
    }
    // Sheet sprite (Step A): real art ONLY in high-graphic mode — primitive
    // mode must keep the procedural shapes (same contract as thorn's rect
    // fallback). Pre-boot (frames not loaded) also falls through to procedural.
    if (isHighGraphic() && this.drawSprite(ctx)) {
      // White outline on top of the sprite (high-graphic only, like thorn).
      if (this._outline && !this._outline.done) this._outline.render(ctx);
      return;
    }
    // Primitive look: ONE drawer per weapon identity (visual-identity
    // contract). No inline branches — every special owns its file under
    // combat/attack/drawers/. Typeless pooled slot → generic rock.
    const drawer = SPECIAL_FALLBACK_DRAWERS[this.type] ?? rockDrawer;
    drawer(ctx, this);
  }
}

// Pool for specials (smaller than thorn pool — lower fire rate).
export const MAX_SPECIALS = 16;
export const specialPool = new Pool(Special, MAX_SPECIALS);
