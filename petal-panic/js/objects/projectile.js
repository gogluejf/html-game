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
import { rockDrawer, bombDrawer, explosiveDrawer, homingDrawer, sawDrawer, spreadDrawer, molotovDrawer, fireballDrawer } from '../combat/attack/drawers/index.js';

/** Primitive-mode look per weapon identity (visual-identity contract): one
 *  drawer file per special under combat/attack/drawers/. No inline branches. */
const SPECIAL_FALLBACK_DRAWERS = Object.freeze({
  bomb: bombDrawer,
  explosive: explosiveDrawer,
  homing: homingDrawer,
  saw: sawDrawer,
  spread: spreadDrawer,
  molotov: molotovDrawer,
  fireball: fireballDrawer,
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

// --- Sprite data (single pipeline for ALL flying-entity sheets) --------------
// One SPRITE_TARGETS map drives every projectile/special sheet: type →
// { dir, file, anim }. `dir` defaults to the type name; `file` to
// `<anim>_sheet.json`. The SHEET IS THE SOURCE OF TRUTH: the editor-authored
// collision box is the scaling reference (§4) and the entity box derives from
// it — width = collisionBox.w × scale, no baseW, no synthetic fallback. A
// sheet without an authored box is an asset bug: setAnim() → uniformScale()
// throws loudly. Per-weapon size lives in the REGISTRY (specialWeapons.js).
const SPRITE_TARGETS = Object.freeze({
  thorn:       { anim: 'shoot' },
  rock_medium: { file: 'medium_shoot_sheet.json', anim: 'shoot' },
  rock_small:  { file: 'small_shoot_sheet.json', anim: 'shoot' },
  bomb:        { anim: 'shoot' },
  bomb_explode:{ dir: 'bomb', file: 'explode_sheet.json', anim: 'explode' },
  saw:         { anim: 'shoot' },
  spread:      { anim: 'shoot' },
  homing:      { anim: 'fly' },
  explosive:   { anim: 'fly' },
  fireball:    { anim: 'shoot' },
  molotov:     { anim: 'throw' },
});
const spriteData = new Map();   // type → parsed sheet (anims patched)
const spriteFrames = new Map(); // type → frame image map
/** @returns {object|null} parsed sheet for a type (null pre-boot / unknown). */
export function getProjectileSpriteData(type = 'thorn') { return spriteData.get(type) ?? null; }
/** @returns {Map} frame image map for a type (empty pre-boot). */
export function getProjectileFrames(type = 'thorn') { return spriteFrames.get(type) ?? new Map(); }
/** Back-compat alias — specials share the same map now. */
export function getSpecialSpriteData(type) { return spriteData.get(type) ?? null; }
/** Single boot-time loader: loads EVERY sheet in SPRITE_TARGETS. Idempotent. */
export function initProjectileSprites() {
  if (typeof fetch === 'undefined') return Promise.resolve();
  const jobs = [];
  for (const [type, cfg] of Object.entries(SPRITE_TARGETS)) {
    if (spriteData.has(type)) continue;
    const dir = cfg.dir ?? type;
    const file = cfg.file ?? `${cfg.anim}_sheet.json`;
    const base = new URL(`../../assets/projectiles/${dir}/`, import.meta.url).href;
    const load = base.startsWith('file:')
      ? readFileJson(new URL(file, base))
      : fetch(base + file).then((r) => r.json());
    jobs.push(load
      .then((sheet) => {
        const data = parseSheet(sheet);
        // SHEET IS THE SOURCE OF TRUTH: authored collision box + pivot as-is.
        data.anims[cfg.anim]._frames = null; // filled by loadFrames below
        spriteData.set(type, data);
        return loadFrames(data, base);
      })
      .then((imgs) => {
        if (imgs && imgs.size > 0) {
          spriteFrames.set(type, imgs);
          spriteData.get(type).anims[cfg.anim]._frames = imgs;
        }
      })
      .catch((e) => console.warn(`[sprite] ${type} sheet failed to load`, e)));
  }
  return Promise.all(jobs);
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
   * @param {string|null} [type=null] special-weapon id ('saw'|'bomb'|…). null =
   *   plain thorn (the standard straight-line Contra-style shot).
   */
  constructor(x, y, dir, friendly = true, type = null) {
    super();
    this.initialize(x, y, dir, friendly, type);
  }

  initialize(x, y, dir, friendly = true, type = null) {
    // Per-type registry lookup: type != null → meta drives size/layer/tuning;
    // type == null → the plain thorn defaults (exactly as before this fold).
    const meta = type != null ? specialById[type] : null;
    if (type != null && !meta) throw new Error(`Unknown special weapon: ${type}`);
    const isThorn = type == null;
    super.initialize({
      x, y,
      targetH: isThorn ? PROJECTILE_TARGET_H : (meta.size ?? 1 / 3),
      layer: friendly ? LAYER.PROJ_ALLY : LAYER.PROJ_FOE,
      debugColor: isThorn ? (friendly ? '#ff6ec7' : '#ff4444') : (meta.color ?? '#888'),
      gravity: isThorn ? 0 : ((meta.gravity ?? 0) > 0 ? 1 : 0),
    });

    invalidateImpactMotion(this);
    this.type = type;
    this._primitiveRotation = 0;
    this._primitiveSpin = type === 'molotov' ? 4 : 0;
    // Aim index for dirAngle() consumers (contextualAim, debug). Preserved from
    // the pre-fold Projectile contract.
    this.dir = dir;
    // Pose state resets per life (pooled slots keep fields across reuse):
    // default to the horizontal-flight pose.
    this._poseTransposed = false;
    this.friendly = friendly;
    this.speed = isThorn ? PROJECTILE_SPEED : (meta.speed ?? 0);
    this.damage = isThorn ? PROJECTILE_DAMAGE : (meta.damage ?? 0);
    this.life = isThorn ? PROJECTILE_LIFETIME : (meta.lifetime ?? 0);
    // Ballistic motion (data, not class): 0 = straight flight (thorn default).
    // Callers mutate these fields POST-SPAWN (established pattern — ballistic.js
    // sets ent.gravityValue / ent.solidBehavior after pool spawn); initialize()
    // only establishes safe defaults for pooled slots.
    this.gravityValue = isThorn ? 0 : (meta.gravity ?? 0);
    this.explode = isThorn ? false : !!meta.explode;
    // One TTL bar per entity: the plain 'life' timer (bombs relabel nothing —
    // detonation keys off ttlExpired, not the timer name).
    this.setLife(this.life);
    this.radius = this.explode ? meta.radius : 0;
    this.exploded = false;
    // Solid-collision behavior (data, not class): thorns phase through terrain;
    // specials take their WEAPON's policy (bombs reflect, saws/spread absorb).
    this.solidBehavior = isThorn ? 'phase' : (meta.solidBehavior ?? 'stop');

    const angle = dirAngle(dir);
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;
    // Orientation: nose along velocity (rotation-only, no mirror) for every
    // type EXCEPT the bomb, which flies fuse-forward: mirrorX flips for
    // leftward throws so the art faces its travel direction; rotation follows
    // the velocity tangent.
    if (type === 'bomb') {
      this.mirrorX = this.vx < -1e-9;
      this.rotation = Math.atan2(this.vy, this.mirrorX ? -this.vx : this.vx);
    } else {
      this.orientSprite(this.vx, this.vy);
    }

    // Sprite (SOTA): per-type sheet via the standard pipeline. `frames` is a
    // LIVE accessor so boot-time image loading is picked up without rebuilds.
    // Node / pre-boot: sprite data null → primitive rect fallback (unchanged).
    // Typeless default: thorn sheet + thorn outline (byte-identical to a plain
    // thorn) — including arcing typeless carriers. Only the rock macro's
    // carriers (rock: true) get the rock look POST-SPAWN via applyRockLook():
    // gravity/rock arrive after initialize(), so no look selection here.
    const spriteType = type ?? 'thorn';
    const animName = SPRITE_TARGETS[spriteType]?.anim ?? 'shoot';
    // Outline: every shot (thorn, typeless, and special weapons) gets the
    // white contour.
    const wantOutline = type !== 'molotov' && (isThorn || type != null);
    const data = spriteData.get(spriteType);
    if (data?.anims[animName]) {
      this.sprite = { anchor: 'center', anims: data.anims };
      Object.defineProperty(this.sprite, 'frames', { get: () => spriteFrames.get(spriteType) });
      try {
        this.setAnim(animName);
        // Re-aim AFTER setAnim: the sheet's authored start-frame offset can
        // shift the pivot-derived angle, and pooled slots may carry stale
        // orientation from their previous life. orientSprite() is idempotent
        // (pure function of vx/vy), so re-applying it here guarantees the
        // nose points along travel regardless of spawn path. Bombs keep their
        // own fuse-forward orientation (mirrorX + settle ease-back).
        if (type !== 'bomb') this.orientSprite(this.vx, this.vy);
        // White outline — keeps fast small shots readable. Thickness is
        // data-driven (task 2.1): the sheet JSON's `outline` field (rock = 0
        // → none); default 2 = the historical contour.
        if (wantOutline) {
          const thickness = data.outline ?? 2;
          if (thickness > 0) {
            this._outline = spriteOutline({ color: '#ffffff', thickness, opacity: 1.0 }, this);
          }
        }
      } catch { /* legacy rect path stays active */ }
    }

    // Drawer: optional render override. Contract: (ctx, entity) => void.
    // null = use default draw (sheet sprite or per-type fallback drawer). Set
    // per-shot by the attack engine or weapon code to customize visuals
    // without subclassing.
    this.drawer = null;
  }

  /**
   * Task 1.5 (revised) — the ROCK look for a typeless arcing carrier,
   * OPT-IN via the `rock: true` primitive param (the rock macro passes it).
   * Rock_medium sheet (high-res) / rockDrawer (low-res), and NO outline —
   * the rock reads on its own (the sheet declares outline: 0). The DEFAULT
   * typeless arcing carrier keeps the thorn look.
   *
   * Called post-spawn by the arcing recipe (primitives/projectile.js) when
   * the caller passed rock: true — gravity/rock arrive after initialize(),
   * which gives every typeless slot the thorn default. Re-asserts the carrier box after setAnim (which hands
   * width ownership to the sheet) — the physics box must not change, only
   * the look. Pre-boot (rock sheet not loaded yet) the thorn sprite stays
   * as a placeholder: primitive mode draws rockDrawer; high-res draws the
   * thorn placeholder until the rock sheet lands (and, if the rock fetch
   * failed permanently, stays thorn-shaped) — no outline in any case.
   */
  applyRockLook() {
    this._rockLook = true;
    const data = spriteData.get('rock_medium');
    const animName = SPRITE_TARGETS.rock_medium.anim;
    // Outline is data-driven (task 2.1): the rock sheet's `outline` field is
    // the single source of truth (declares 0 → none; default 2 matches the
    // thorn contour). Pre-boot (data absent) → no outline — the placeholder
    // art never draws one either.
    this._outline = null;
    if (!data?.anims[animName]) return; // pre-boot → rockDrawer in draw()
    const thickness = data.outline ?? 2;
    if (thickness > 0) {
      this._outline = spriteOutline({ color: '#ffffff', thickness, opacity: 1.0 }, this);
    }
    const w = this.w, h = this.h; // carrier physics box (square, 18px)
    this.sprite = { anchor: 'center', anims: data.anims };
    Object.defineProperty(this.sprite, 'frames', { get: () => spriteFrames.get('rock_medium') });
    try {
      this.setAnim(animName);
      this.w = w; // re-pin: setAnim made width sheet-owned (look only)
      this.h = h;
      // Re-aim AFTER setAnim: pivot shift + pooled slots may carry stale
      // orientation (same contract as initialize).
      this.orientSprite(this.vx, this.vy);
    } catch { /* legacy rect path stays active */ }
  }

  /**
   * Draw this projectile. Delegates to `this.drawer` if set; otherwise falls
   * back to the high-graphic sheet sprite (+ white outline) in high-res mode,
   * then to a per-type primitive drawer (visual-identity contract: one drawer
   * file per weapon under combat/attack/drawers/). The thorn keeps its
   * original rect/outline path via super.draw().
   */
  draw(ctx) {
    if (this.visible === false) return;
    if (!this.alive || this._attackVisualOwned) return;
    // Drawer override: standalone (ctx, entity) => void.
    if (typeof this.drawer === 'function') {
      this.drawer(ctx, this);
      return;
    }
    // Typeless: straight shots keep the thorn path — Entity default (sheet
    // sprite or debug rect) plus the white outline on top in high-graphic
    // mode. Task 1.5: arcing typeless shots (applyRockLook) are rocks —
    // rock_medium sheet in high-res, rockDrawer in primitive mode / pre-boot,
    // and never an outline.
    if (this.type == null) {
      if (this._rockLook) {
        if (isHighGraphic() && this.drawSprite(ctx)) return;
        rockDrawer(ctx, this);
        return;
      }
      super.draw(ctx);
      if (isHighGraphic() && this._outline && !this._outline.done) this._outline.render(ctx);
      return;
    }
    // Special types: real sheet art ONLY in high-graphic mode — primitive mode
    // must keep the procedural shapes (same contract as thorn's rect fallback).
    // Pre-boot (frames not loaded) also falls through to the procedural drawer.
    if (isHighGraphic() && this.drawSprite(ctx)) {
      if (this._outline && !this._outline.done) this._outline.render(ctx);
      return;
    }
    // Primitive look: ONE drawer per weapon identity. No inline branches —
    // every special owns its file under combat/attack/drawers/. Typeless
    // pooled slot → generic rock.
    const drawer = SPECIAL_FALLBACK_DRAWERS[this.type] ?? rockDrawer;
    if (this.type === 'molotov') {
      const rotation = this.rotation;
      try {
        this.rotation = this._primitiveRotation;
        drawer(ctx, this);
      } finally { this.rotation = rotation; }
    } else drawer(ctx, this);
  }

  // The bottle frames already contain the rotation. Suppress flight alignment
  // only for this sheet render; custom drawers and other sheet types keep it.
  drawSprite(ctx) {
    if (this.type !== 'molotov' || this._spriteAnim !== 'throw') return super.drawSprite(ctx);
    const rotation = this.rotation;
    try {
      this.rotation = 0;
      return super.drawSprite(ctx);
    } finally { this.rotation = rotation; }
  }

  reflectVelocity(box) {
    super.reflectVelocity(box);
    invalidateImpactMotion(this);
  }

  update(dt) {
    if (this._primitiveSpin && !this._bombSettled) this._primitiveRotation += this._primitiveSpin * dt;
    this._impactPrevX = this.x;
    this._impactPrevY = this.y;
    this._impactPoint = null;
    this._bombPrevBottom = this.y + this.h;
    // Gravity for ballistic shots (same integration Special used to own):
    // vy += g·dt before position, gated by the settled flag so a resting
    // bomb stays put. No-op while gravityValue is 0 (straight thorn flight).
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
    // Rocks opt OUT of the tangent snap: they TUMBLE instead — a slow
    // per-rock spin (random sign/magnitude, set at spawn) integrated on top
    // of the throw direction. The spin dies with the motion (speed gate).
    if (this._rockTumble) {
      const speed = Math.hypot(this.vx, this.vy);
      if (speed > 1 && !this._bombSettled) this.rotation += this._rockSpin * dt;
    } else if (this.type !== 'bomb') this.orientSprite(this.vx, this.vy);

    // Bomb orientation (sheet art): while flying, the fuse trails the motion —
    // rotation follows the velocity tangent and mirrorX tracks horizontal
    // direction. Once settled (resting on a surface), ease back to upright so
    // the fuse sits on top instead of frozen at the landing angle.
    if (this.type === 'bomb' && this.sprite) {
      // TEMP: settle ease-back disabled — bomb stays frozen at landing angle.
      // Orientation freezes at immobilization (see stepBombTerrain,
      // _bombOrientFrozen): no more re-aim snaps on the settle frame.
      if (!this._bombOrientFrozen) {
        const speed = Math.hypot(this.vx, this.vy);
        // Hop-apex gate (mirrors the physics settle threshold): while the
        // current hop would rise >= 3px, re-aim along the velocity tangent.
        // Below that (micro-bounces / over-head apex), holding the last angle
        // kills the tail-up/tail-down flicker; immobilization then locks it.
        const reaim = this.gravityValue > 0
          ? (speed * speed) / (2 * this.gravityValue) >= 3
          : speed > 1;
        if ((speed > 1 || !this._bombSettled) && reaim) {
          if (speed > 1) {
            this.mirrorX = this.vx < -1e-9;
            this.rotation = Math.atan2(this.vy, this.mirrorX ? -this.vx : this.vx);
          }
        }
      }
    }

    // Tumble anim playback: a rock AT REST holds its frame (no twirl on the
    // looping tumble sheet) — the speed gate is the same one that freezes the
    // canvas spin above, so look and physics agree on "stopped".
    if (!(this._rockTumble && (Math.hypot(this.vx, this.vy) <= 1 || this._bombSettled))) this.tickAnim(dt);
    // TTL countdown via the shared timer set: the plain 'life' timer.
    // ttlExpired lets hosts (gameplay/theater) distinguish a fuse/
    // lifetime expiry from a contact kill. Gated by _bombFuseDisabled so a
    // thrown carrier with no flight fuse never self-detonates.
    const wasAlive = this.alive;
    if (!this._bombFuseDisabled) this.tickTtl(dt);
    if (wasAlive && !this.alive) this.ttlExpired = true;
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
      // Reuse only DEAD slots — and never a live engine-owned carrier whose
      // attack handle is still active (ballistic/projectile). Wiping a live
      // carrier mid-flight would reset it to parked position under a live
      // handle (frozen missile bug). Plain thorns (no _attackId) are simply
      // alive → never reused while flying.
      if (!item.alive &&
          !((item._attackId === 'projectile') &&
          !item._attackDone &&
          item._attackHandle && !item._attackHandle._cancelled && !item._attackHandle._completed)) {
        // A collision can kill a slot AFTER updateAll's cleanup. Reusing it
        // must not append the same object a second time (double physics).
        // Remove extension fields from the previous attack generation.
        for (const key of Object.keys(item)) delete item[key];
        // Reinitialize the slot in place: copying a temporary instance leaves
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

