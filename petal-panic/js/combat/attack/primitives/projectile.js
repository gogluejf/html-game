// Attack Engine — Projectile primitive (Task 1.2; Task 1.4 absorbed the
// former 'ballistic' primitive — ONE primitive owns every flying entity).
//
// Two recipes, one spawn entry — the `arc` param picks the recipe:
//   • arc absent (null/undefined) → STRAIGHT recipe: the original straight
//     line path, byte-identical (natural/sheet box, 'hit'/'expire' events).
//   • arc != null (a number, 0 included) → ARCIING recipe: the former
//     spawnBomb path — gravityValue = arc, 18px typeless carrier box,
//     specialType sheet routing, fuse-labeled TTL, bounce →
//     solidBehavior 'reflect'/'stop', terminal 'detonate' event.
//
// Entity tagging (BOTH recipes): _attackId = 'projectile' (engine/pool
// bookkeeping key); _arcRecipe = true exactly when the arcing recipe ran
// (= exactly when the pre-Task-1.4 code tagged `_attackId === 'ballistic'`).
// Engine sites that used to branch on the 'ballistic' tag branch on the flag.
//
// This primitive NEVER implements wall physics, damage math, or pooling itself:
//   - solidBehavior ('phase'|'stop'|'reflect') is mapped onto the entity flag
//     that collisionHandlers.js already consumes. Data, not code.
//   - damage routing stays in damage()/takeDamage() via the existing handlers.
//
// What this file OWNS: param → pool-spawn translation (both recipes), origin
// resolution (marker or explicit point), per-frame terrain stepping for arcing
// carriers (stepBombTerrain), and lifecycle bridging (straight: hit/expire;
// arcing: detonate at the death point).

import { invalidateImpactMotion } from '../../entryImpact.js';
import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { resolveMarker } from '../context.js';
import { AttackHandle } from '../engine.js';
import { dirAngle } from '../../../core/vec.js';
import { fireDeclared } from '../../../effects/index.js';
import { LAYER } from '../../../consts.js';
import { specialById } from '../../../objects/specialWeapons.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read lazily at construction so synchronous fires inside
// impl() see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

/** Default params (canonical values; callers override per shot). */
const DEFAULTS = Object.freeze({
  speed: 600,            // px/s
  direction: 0,          // radians (NOT an 8-way index)
  ttl: 2,                // seconds before auto-cull
  damage: 10,
  origin: null,          // marker label (string) | {x,y} | null → attacker center
  solidBehavior: 'phase', // phase | stop | reflect (existing entity-flag contract)
  team: 'ally',          // ally | foe — who this shot hurts (engine-wide side
                         // vocabulary, same as hitbox/explosion). Maps to the
                         // legacy friendly flag / PROJ_ALLY|PROJ_FOE layer.
  size: null,            // box size px — null = keep the entity's natural box
                         // (sheet-derived collision box set by initialize())
  width: null,           // explicit box width px (overrides size); null = size
  height: null,          // explicit box height px (overrides size); null = size
  specialType: null,     // special-weapon id ('saw'|'spread'|'bomb'|'homing'|'explosive') → routes to
                         // the unified pool with that type; null = Projectile/thorn path
  drawer: null,          // (ctx, entity) => void — custom render override
  // --- Arcing recipe (arc != null) ------------------------------------------
  arc: null,             // recipe discriminator + gravity px/s² — null/absent =
                         // straight recipe; any number (0 included) = arcing
  bounce: true,          // arcing: → solidBehavior 'reflect' (false → 'stop')
  bounceHeight: null,    // arcing: px apex for constant-apex rebound mode (null = legacy decay)
  retainOnContact: false, // arcing: emit contact without damage/consumption (composed payloads)
  retainOnSettle: false,  // arcing: keep the carrier alive and expose settled state
  radius: null,          // reference size for host-side effects (macro-owned)
});

/**
 * Resolve the spawn point for a shot.
 * Order: explicit {x,y} param → named marker on the attacker → attacker center.
 * The resolved point is the CENTER of the projectile box.
 * @returns {{x:number,y:number}} center of the projectile box
 */
function spawnCenter(ctx, origin) {
  const a = ctx.attacker;
  if (origin && typeof origin === 'object' && 'x' in origin) {
    return { x: origin.x, y: origin.y };
  }
  if (typeof origin === 'string') {
    const m = resolveMarker(ctx, origin);
    if (m) return { x: m.x, y: m.y };
  }
  // Fallback: attacker center.
  return { x: (a?.x ?? 0) + (a?.w ?? 0) / 2, y: (a?.y ?? 0) + (a?.h ?? 0) / 2 };
}

/**
 * ARCIING recipe (formerly spawnBomb in the deleted 'ballistic' primitive).
 * Gravity arc, bounce or stop on impact, fuse-labeled TTL, 'detonate' on
 * death. Runs exactly when the caller passed an explicit `arc` (any number,
 * 0 included).
 * @returns {object|null} the Projectile entity, or null if the pool is exhausted
 */
function spawnArcing(p, ctx, h) {
  const center = spawnCenter(ctx, p.origin);
  const size = 18; // generic ballistic carrier box
  // TYPELESS carrier by default: no weapon identity → no sheet art. The
  // arcing recipe is a dumb physics body (rocks, mines, thrown enemies);
  // its look comes from the entity's own draw() — Projectile's neutral rock
  // body for typeless slots, the real sheet when a weapon type opts in
  // (throw-bomb passes 'bomb'). Weapon-specific carriers never get a forced
  // drawer (visual-identity contract: one look-owner per entity type).
  const type = p.specialType ?? p.weaponType ?? null;
  const ent = ctx.pools.projectilePool?.spawn(center.x - size / 2, center.y - size / 2, 0, true, type);
  if (!ent) return null;
  // Typeless Projectile defaults its box to the natural square (targetH × 48) —
  // restore the 18px carrier box so spawn centering and collision match the
  // bomb-sized physics body. A weapon-typed carrier is SHEET-OWNED: its box
  // follows the active anim's collision box via setAnim() (§4 pipeline).
  if (!type) {
    ent.w = size;
    ent.h = size;
  }
  ent.vx = Math.cos(p.direction) * p.speed;
  ent.vy = Math.sin(p.direction) * p.speed;
  // Orient the art nose along velocity (same contract as Projectile). A
  // typeless carrier has no sheet art, but drawers (rock) read e.rotation —
  // keep it live so tumbling reads correctly in both theater and gameplay.
  // Weapon-typed carriers with sheet art (homing) also want the nose along
  // travel; bombs handle their own mirrorX orientation downstream.
  if (type !== 'bomb') ent.orientSprite(ent.vx, ent.vy);
  ent.gravityValue = p.arc;
  ent.damage = p.damage;
  ent.friendly = p.team !== 'foe';
  ent.layer = ent.friendly ? LAYER.PROJ_ALLY : LAYER.PROJ_FOE;
  // Fuse: the bomb's TTL label is 'fuse' (Projectile relabels it), so setLife()
  // — which writes the 'life' timer — would be ignored by tickTtl(). Write
  // the labeled timer directly so the declared ttl actually governs expiry.
  const label = ent._ttlLabel ?? 'life';
  ent.setLife(p.ttl ?? 0);
  ent.timers.set(label, p.ttl ?? 0);
  ent._bombFuseDisabled = p.ttl === null;
  ent._bombRetainOnContact = p.retainOnContact;
  ent._bombRetainOnSettle = p.retainOnSettle;
  ent._bombSettled = false;
  ent.solidBehavior = p.bounce ? 'reflect' : 'stop';
  // Explicit collision box (non-square carriers). AABB collision, reflection
  // and drawers all read e.w/e.h, so setting these after spawn is enough.
  if (p.width != null) ent.w = p.width;
  if (p.height != null) ent.h = p.height;
  // Constant-apex rebound mode (circus-ball style infinite bounces). Stored on
  // the entity so stepBombTerrain() can recompute each rebound from a fixed
  // height instead of decaying impact velocity.
  ent.bounceHeight = p.bounceHeight ?? null;
  // Drawer: EXPLICIT param only (visual-identity contract — primitives are
  // look-blind, one look-owner per entity type). A weapon-typed carrier
  // draws its own sheet/procedural art via Projectile.draw(); a typeless
  // carrier falls back to Projectile's neutral rock body. Never a forced
  // default drawer here.
  if (p.drawer) ent.drawer = p.drawer;
  ent._attackId = 'projectile';
  ent._arcRecipe = true; // arcing-recipe discriminator — set BEFORE world add
  ent._attackDone = false;
  ent._attackHit = false;
  ent._bombSurfaceY = null;
  ctx.collisionWorld?.add(ent);
  // Host bridge: the world update loop (systems/update.js) and the macro
  // hosts (bombAttackHost/carrierMacro) step engine-spawned carriers via
  // stepBomb() — they find them through this handle reference (the theater
  // host does the same).
  if (h) ent._attackHandle = h;
  return ent;
}

/**
 * Spawn one projectile into the right pool and bridge its lifecycle to the
 * handle. Returns the spawned entity (or null if the pool is exhausted).
 *
 * RECIPE SELECTION: `arc != null` (any number, 0 included) → arcing recipe
 * (the former 'ballistic' spawn path); absent arc → straight recipe
 * (byte-identical to the pre-Task-1.4 projectile path).
 *
 * @param {object} p merged params
 * @param {object} ctx AttackContext (must carry `pools` and optionally
 *                     `collisionWorld`)
 * @param {import('../engine.js').AttackHandle} h handle to emit on
 */
export function spawnProjectile(p, ctx, h) {
  if (p.arc != null) return spawnArcing(p, ctx, h);

  const center = spawnCenter(ctx, p.origin);
  const angle = typeof p.direction === 'number' ? p.direction : dirAngle(p.direction);
  const cos = Math.cos(angle), sin = Math.sin(angle);

  // Special-weapon routing (Step B): specialType spawns a typed Projectile
  // from the unified pool — the class owns look (sheet/procedural dual-mode)
  // and its sheet-owned box. Data-only: velocity/damage/ttl below apply to
  // both paths.
  if (p.specialType != null) {
    const meta = specialById[p.specialType];
    if (!meta) throw new Error(`projectile: unknown specialType '${p.specialType}'`);
    const ent = ctx.pools.projectilePool?.spawn(center.x, center.y, 0, true, p.specialType);
    if (!ent) return null; // pool exhausted — caller skips this shot (soft cap)
    ent.vx = cos * p.speed;
    ent.vy = sin * p.speed;
    ent.orientSprite(ent.vx, ent.vy);
    // VERTICAL-FLIGHT POSE: for exactly-vertical aims the sheet box's long
    // axis must point along flight — transpose the AABB dims so the box and
    // the rotated art describe the same oriented object (no more "sprite 90°,
    // box still horizontal"). Diagonals keep the horizontal pose.
    const verticalPose = Math.abs(sin) > 0.99 && Math.abs(cos) < 0.01;
    ent._poseTransposed = verticalPose;
    ent.damage = p.damage;
    ent.setLife(p.ttl);
    ent.friendly = p.team !== 'foe';
    ent.layer = ent.friendly ? LAYER.PROJ_ALLY : LAYER.PROJ_FOE;
    ent.solidBehavior = p.solidBehavior ?? meta.solidBehavior;
    if (p.drawer) ent.drawer = p.drawer;
    ent._attackId = 'projectile';
    ent._arcRecipe = false; // straight recipe
    ent._attackHit = false;
    ent._attackDone = false;
    // Center the BOX on the resolved origin point (setAnim already ran inside
    // initialize when the sheet is loaded). The collision box is the physics
    // truth — it is what must sit on the aim point. The ART adapts to the box:
    // drawSprite() mirrors/rotates around the box center (see spriteFrame()),
    // so the box↔art relationship is identical in all 8 aim directions.
    ent.x = center.x - ent.w / 2;
    ent.y = center.y - ent.h / 2;
    ctx.collisionWorld?.add(ent);
    return ent;
  }

  // Straight-line path: plain Projectile (typeless thorn default). Arcing
  // bodies take the arc recipe above (arc != null).
  const ent = ctx.pools.projectilePool?.spawn(center.x, center.y, 0, p.team !== 'foe');
  if (ent) {
    ent.vx = cos * p.speed;
    ent.vy = sin * p.speed;
    // Re-aim the sprite nose to the exact (possibly non-8-way) angle.
    ent.orientSprite(ent.vx, ent.vy);
    ent.damage = p.damage;
    // setLife() writes the 'life' timer — Projectile's _ttlLabel is 'life', so
    // tickTtl() honors it (legacy `this.life` field stays in sync too).
    ent.setLife(p.ttl);
  }

  if (!ent) return null; // pool exhausted — caller skips this shot (soft cap)

  // --- Box resolution -------------------------------------------------------
  // Explicit box dimensions (non-square shots). Everything downstream — AABB
  // collision, reflectVelocity, drawers reading e.w/e.h — works off these.
  // When NO explicit size is given (size/width/height all null), keep the
  // entity's NATURAL box: for pooled projectiles that's the sheet-derived
  // collision box set by initialize() (e.g. the thorn's 37.6×15.4 art box),
  // NOT a forced square. Callers that want an exact box still pass size/width/
  // height explicitly and get exactly that.
  const s = p.size ?? 12;
  if (p.width != null || p.height != null) {
    ent.w = p.width ?? s;
    ent.h = p.height ?? s;
  } else if (p.size != null) {
    ent.w = s;
    ent.h = s;
  }

  // Data-only transport: the existing collision handler reads this flag.
  // Always set explicitly — pool slots are recycled via Object.assign from a
  // fresh instance, but a caller that omits solidBehavior must still get the
  // documented default ('phase') rather than inheriting a stale slot value.
  ent.solidBehavior = p.solidBehavior ?? 'phase';
  // Custom render override (drawer contract: (ctx, entity) => void).
  if (p.drawer) ent.drawer = p.drawer;
  // Tag so the theater/debug can find primitives' shots among pool items.
  ent._attackId = 'projectile';
  ent._arcRecipe = false; // straight recipe

  // Register in the collision world if one was provided (gameplay + theater).
  ctx.collisionWorld?.add(ent);

  // --- Lifecycle bridging ---------------------------------------------------
  // The pool's updateAll() drives ent.update(dt) and removes dead items; we
  // poll each frame via ctx.onFrame (set by the engine host) OR the caller
  // steps it. For Wave 1 the theater host calls stepProjectile() explicitly.
  ent._attackHit = false;
  ent._attackDone = false;
  // Center the box on the resolved origin point using the FINAL box size
  // (natural or explicit) — done after the box is settled so the real
  // dimensions are what gets centered.
  ent.x = center.x - ent.w / 2;
  ent.y = center.y - ent.h / 2;
  return ent;
}

/**
 * Per-frame step for a spawned projectile (called by the host loop while the
 * handle is live). Emits 'hit' when the entity dies by contact (alive=false
 * before TTL ran out against a target) vs 'expire' on TTL/off-screen.
 * Simplification for Wave 1: any death before ttl elapses counts as a hit IF
 * the entity flagged _attackHit (set by collision handlers in gameplay);
 * otherwise it's an expire. In pure tests we set _attackHit manually.
 *
 * @returns {boolean} true if the attack finished this frame
 */
export function stepProjectile(ent, h) {
  if (ent._attackDone) return true;
  if (!ent.alive) {
    ent._attackDone = true;
    // Solid-impact debris: a shot that DIED against terrain (not an enemy hit,
    // not a fuse expiry) puffs dusty grain at its death point — the projectile
    // owns this juice so every host gets it for free (same pattern as bomb's
    // detonation VFX). 'phase' shots never die on terrain; specials handle
    // their own fizzle/detonation effects.
    // Terminal event carries the DEATH POINT. Pool slots are recycled after
    // death, so listeners must never re-read ent.x/y — the coordinates are
    // captured here, at the moment of death (same contract as bomb's
    // 'detonate' {x,y}). Existing listeners ignore the payload; it is purely
    // additive.
    //
    // TUNNELING: a fast shot can be deeply inside its victim/terrain by the
    // time the per-frame AABB check fires (12px box at 700px/s = ~12px/frame).
    // The raw center then reads as "victim middle". If the collision handler
    // recorded the entry-edge impact point (ent._impactPoint), use THAT
    // instead — it rewinds the shot to where it first crossed the target face.
    const ip = ent._impactPoint;
    const cx = ip ? ip.x : ent.x + ent.w / 2;
    const cy = ip ? ip.y : ent.y + ent.h / 2;
    if (!ent._attackHit && !ent.ttlExpired && ent.solidBehavior === 'stop') {
      fireDeclared({ type: 'debris', params: { x: cx, y: cy } }, h.declaredEffectTypes());
    }
    if (ent._attackHit) h._emit('hit', { dealt: ent.damage, x: cx, y: cy });
    else h._emit('expire', { x: cx, y: cy });
    h._complete();
    return true;
  }
  return false;
}

/** Rebound below this (px/s) settles the bomb instead of bouncing again. */
export const BOMB_SETTLE_VY = 40;

/**
 * Terrain stepping for a live arcing carrier (host calls once per frame).
 * Single source of truth for bomb-vs-terrain behavior — gameplay (level
 * floor + platform tops) and the sandbox (flat ground line) both call this,
 * so bounce numbers can never drift between the two hosts.
 *
 * Rules (match Projectile physics):
 *  - falling onto a surface with solidBehavior 'reflect' → bounce
 *    (restitution 0.5, friction 0.7); when the rebound is too weak to matter
 *    (< BOMB_SETTLE_VY), the bomb rests alive until its fuse expires.
 *  - solidBehavior 'stop' → immediate settle (impact = end).
 *
 * @param {object} ent          the Projectile entity (must be alive)
 * @param {number} dt           seconds
 * @param {number} groundY      floor top y (world)
 * @param {Array}  [platforms]  optional extra surfaces [{x, y, w}] (tops only)
 * @returns {boolean} true when the carrier settled this call (end pending)
 */
export function stepBombTerrain(ent, dt, groundY, platforms = []) {
  if (!ent || (!ent.alive && !ent.ttlExpired) || ent._attackDone) return false;
  if (ent._bombSettled) return false;
  const bottom = ent.y + ent.h;
  // Pick the first crossed top, independent of surface list ordering.
  const prevBottom = ent._bombPrevBottom ?? bottom - ent.vy * dt;
  let surface = null;
  if (ent.vy > 0) {
    if (Number.isFinite(groundY) && bottom >= groundY) surface = groundY;
    for (const p of platforms) {
      if (prevBottom <= p.y + 2 && bottom >= p.y &&
          ent.x + ent.w > p.x && ent.x < p.x + p.w &&
          (surface == null || p.y < surface)) surface = p.y;
    }
  }
  ent._bombSurfaceY = null;
  if (surface == null) return false;

  ent.y = surface - ent.h;
  invalidateImpactMotion(ent);
  ent._bombSurfaceY = surface;
  if (!ent.alive) return false; // fuse expired on this landing frame
  if (ent.solidBehavior === 'reflect') {
    if (ent.bounceHeight != null && ent.gravityValue > 0) {
      // CONSTANT-APEX MODE: rebound velocity derived from a fixed height, NOT
      // from impact velocity. vy = -sqrt(2·g·h) guarantees the apex lands at
      // exactly bounceHeight every time — zero drift, zero loss, bounces
      // forever until ttl. vx is untouched → horizontal speed stays exact.
      ent.vy = -Math.sqrt(2 * ent.gravityValue * ent.bounceHeight);
    } else {
      ent.vy = -Math.abs(ent.vy) * 0.5; // legacy restitution (bombs decay)
      ent.vx *= 0.7;                    // friction
    }
    if (Math.abs(ent.vy) < Math.sqrt(2 * ent.gravityValue * 3)) {
      // Rest on the surface — do NOT kill. The fuse keeps running;
      // stepBomb() fires when TTL expires or contact occurs.
      ent.vy = 0;
      ent.vx = 0;
      // Freeze orientation at immobilization: rotation + mirrorX are locked
      // at their last in-flight values and never updated again while settled.
      ent._bombOrientFrozen = true;
      if (ent._bombRetainOnSettle) ent._bombSettled = true;
      return false;
    }
    return false;
  }
  if (ent._bombRetainOnSettle) {
    ent.vx = ent.vy = 0;
    ent._bombSettled = true;
    return true;
  }
  // 'stop' (or anything non-reflect): impact ends the flight.
  ent._attackHit = true;
  ent.alive = false;
  return true;
}

/**
 * Per-frame step for an arcing carrier (called by the host loop while the
 * handle is live). Returns true when the carrier finished (ended or expired).
 * The host loop calls this until it returns true.
 *
 * End triggers:
 *  - contact: stepBombTerrain() settles the entity against terrain
 *    (sets _attackHit), or a collision handler kills it against an enemy.
 *  - fuse: ttlExpired flag set by Projectile.update() when the life timer ends.
 *  - off-screen: caller sets ent.alive=false via cullOffScreen().
 *
 * On end the handle emits 'detonate' { x, y, contact } at the death point —
 * ALWAYS (even a fizzle), so composed macros know exactly where the carrier
 * died. No VFX here: the carrier is dumb; macros own the aftermath.
 *
 * @param {object} ent   the spawned Projectile
 * @param {object} p     merged params
 * @param {object} ctx   AttackContext
 * @param {AttackHandle} h handle to emit on
 */
export function stepBomb(ent, p, ctx, h) {
  if (h._completed || h._cancelled || ent._attackDone) return true;
  if (ent.alive) return false;

  ent._attackDone = true;
  const cx = ent.x + ent.w / 2, cy = ent.y + ent.h / 2;

  // Fuse expiry without contact = timed end (still an end, not a silent
  // expire): bombs are designed to go off wherever they land.
  const contact = !!ent._attackHit;
  const surfaceY = ent._bombSurfaceY != null && Math.abs(ent.y + ent.h - ent._bombSurfaceY) < 0.01
    ? ent._bombSurfaceY : null;
  h._emit('detonate', { x: cx, y: cy, contact, surfaceY });

  // Basic carrier juice only (same tier as projectile's hit-sparkle/debris):
  // a landing puff when the carrier dies against terrain. Blast bursts, screen
  // flash, camera shake belong to whatever macro COMPOSES this carrier —
  // the primitive never double-dips.
  if (contact && !ent.ttlExpired) {
    fireDeclared({ type: 'debris', params: { x: cx, y: cy } }, h.declaredEffectTypes());
  }

  h._complete();
  return true;
}

// Collision hosts share this opt-in lifecycle hook; terrain still resolves normally.
export function retainBombContact(ent, target) {
  if (!ent._bombRetainOnContact) return false;
  ent._attackHandle?._emit('contact', { target });
  return true;
}

// ONE handler shape for both ids: spawn through the recipe-aware
// spawnProjectile, bridge the handle, and — for carriers that own an entity
// via _attackHandle — force-kill on cancel. Straight-recipe entities never
// carry _attackHandle, so the cancel override is a no-op for them
// (byte-identical to the old projectile primitive); arcing carriers get the
// old ballistic cancel contract.
function makeImpl(id) {
  return (params, ctx) => {
    const h = new AttackHandle(id, null, declaredEffectsOf(id));
    // ONE shot per invoke — the primitive is a single mechanical verb.
    // Repeated-fire patterns (bursts, fire-groups) are macro/attack-plan
    // sequencing: spreadShot with angle 0 + sequenceInterval, or plans that
    // invoke this id multiple times with delays.
    const ent = spawnProjectile(params, ctx, h);
    if (!ent) {
      h._emit('expire');
      h._complete();
      return h;
    }
    h.entity = ent;
    h.entities = [ent];
    const cancel = h.cancel.bind(h);
    h.cancel = () => {
      if (ent._attackHandle === h && !h._completed) {
        ent.alive = false;
        ent._attackDone = true;
        ctx.collisionWorld?.remove(ent);
      }
      cancel();
    };
    return h;
  };
}

registerPrimitive('projectile', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Projectile',
    effects: [
      { type: 'hit-sparkle', desc: 'blood sparkles on enemy impact (hit juice)' },
      { type: 'debris', desc: 'dusty grain puff when a solid-behavior shot dies on terrain' },
    ],
    desc: 'One primitive for every flying entity: straight-line shots (arc absent) and arcing gravity bodies (arc != null — the former ballistic recipe).',
    params: [
      { key: 'speed', desc: 'px/s travel speed' },
      { key: 'direction', desc: 'radians (0 = right)' },
      { key: 'ttl', desc: 'seconds before auto-cull' },
      { key: 'damage', desc: 'damage on valid contact' },
      { key: 'origin', desc: "marker label | {x,y} | null → attacker center (box is CENTERED on this point)" },
      { key: 'solidBehavior', desc: 'phase | stop | reflect (existing flag)' },
      { key: 'team', desc: "ally | foe — who this shot hurts (maps to PROJ_ALLY/PROJ_FOE layer)" },
      { key: 'size', desc: 'square box size px; null = keep the entity\'s natural sheet box' },
      { key: 'width', desc: 'explicit box width px (overrides size)' },
      { key: 'height', desc: 'explicit box height px (overrides size)' },
      { key: 'specialType', desc: "special-weapon id ('saw'|'spread'|'bomb'|'homing'|'explosive') → typed Projectile entity; null = thorn path" },
      { key: 'arc', desc: 'gravity px/s² — recipe discriminator: absent/null = straight, any number (0 included) = arcing' },
      { key: 'bounce', desc: 'arc recipe: reflect off surfaces (true) or stop on impact (false)' },
      { key: 'bounceHeight', desc: 'arc recipe: px apex for constant-apex rebound mode; null = legacy decay' },
      { key: 'retainOnContact', desc: 'arc recipe: emit contact without damage/consumption (composed payloads)' },
      { key: 'retainOnSettle', desc: 'arc recipe: keep the carrier alive and expose settled state' },
      { key: 'radius', desc: 'reference size for host-side effects (macro-owned)' },
    ],
  },
  impl: makeImpl('projectile'),
});
