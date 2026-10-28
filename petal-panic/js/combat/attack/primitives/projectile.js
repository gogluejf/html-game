// Attack Engine — Projectile primitive (Task 1.2).
//
// Straight-line projectile ONLY: spawn into the existing projectile pool, set
// data, let the existing systems do the work. Arcing bodies are the
// `ballistic` primitive's job — this primitive has no gravity path.
// This primitive NEVER implements wall physics, damage math, or pooling itself:
//   - solidBehavior ('phase'|'stop'|'reflect') is mapped onto the entity flag
//     that collisionHandlers.js already consumes. Data, not code.
//   - damage routing stays in damage()/takeDamage() via the existing handlers.
//
// What this file OWNS: param → pool-spawn translation, origin resolution
// (marker or explicit point), and lifecycle bridging (entity death → handle
// events hit/expire/complete).

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { resolveMarker } from '../context.js';
import { AttackHandle } from '../engine.js';
import { dirAngle } from '../../../core/vec.js';
import { fireDeclared } from '../../../effects/index.js';

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
  size: 12,              // box size (thorn = 12, specials ~16) — square default
  width: null,           // explicit box width px (overrides size); null = size
  height: null,          // explicit box height px (overrides size); null = size
  drawer: null,          // (ctx, entity) => void — custom render override
});

/**
 * Resolve the spawn point for a shot.
 * Order: explicit {x,y} param → named marker on the attacker → attacker center.
 * @returns {{x:number,y:number}} top-left of the projectile box
 */
function spawnPoint(ctx, origin, size) {
  const a = ctx.attacker;
  if (origin && typeof origin === 'object' && 'x' in origin) {
    return { x: origin.x - size / 2, y: origin.y - size / 2 };
  }
  if (typeof origin === 'string') {
    const m = resolveMarker(ctx, origin);
    if (m) return { x: m.x - size / 2, y: m.y - size / 2 };
  }
  // Fallback: attacker center.
  return { x: (a?.x ?? 0) + (a?.w ?? 0) / 2 - size / 2, y: (a?.y ?? 0) + (a?.h ?? 0) / 2 - size / 2 };
}

/**
 * Spawn one projectile into the right pool and bridge its lifecycle to the
 * handle. Returns the spawned entity (or null if the pool is exhausted).
 *
 * @param {object} p merged params
 * @param {object} ctx AttackContext (must carry `pools` and optionally
 *                     `collisionWorld`)
 * @param {import('../engine.js').AttackHandle} h handle to emit on
 */
export function spawnProjectile(p, ctx, h) {
  const pt = spawnPoint(ctx, p.origin, p.size ?? 12);
  const angle = typeof p.direction === 'number' ? p.direction : dirAngle(p.direction);
  const cos = Math.cos(angle), sin = Math.sin(angle);

  // Straight-line path only: plain Projectile. The constructor takes an 8-way
  // index; we spawn with dir 0 and overwrite velocity for exact angles.
  // (Arcing bodies are the `ballistic` primitive's job — no gravity here.)
  const ent = ctx.pools.projectilePool?.spawn(pt.x, pt.y, 0, p.team !== 'foe');
  if (ent) {
    ent.vx = cos * p.speed;
    ent.vy = sin * p.speed;
    ent.damage = p.damage;
    ent.life = p.ttl;
  }
  if (!ent) return null; // pool exhausted — caller skips this shot (soft cap)

  // Explicit box dimensions (non-square shots). Everything downstream — AABB
  // collision, reflectVelocity, drawers reading e.w/e.h — works off these.
  const s = p.size ?? 12;
  ent.w = p.width ?? s;
  ent.h = p.height ?? s;

  // Data-only transport: the existing collision handler reads this flag.
  // Always set explicitly — pool slots are recycled via Object.assign from a
  // fresh instance, but a caller that omits solidBehavior must still get the
  // documented default ('phase') rather than inheriting a stale slot value.
  ent.solidBehavior = p.solidBehavior ?? 'phase';
  // Custom render override (drawer contract: (ctx, entity) => void).
  if (p.drawer) ent.drawer = p.drawer;
  // Tag so the theater/debug can find primitives' shots among pool items.
  ent._attackId = 'projectile';

  // Register in the collision world if one was provided (gameplay + theater).
  ctx.collisionWorld?.add(ent);

  // --- Lifecycle bridging ---------------------------------------------------
  // The pool's updateAll() drives ent.update(dt) and removes dead items; we
  // poll each frame via ctx.onFrame (set by the engine host) OR the caller
  // steps it. For Wave 1 the theater host calls stepProjectile() explicitly.
  ent._attackHit = false;
  ent._attackDone = false;
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

registerPrimitive('projectile', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Projectile',
    effects: [
      { type: 'hit-sparkle', desc: 'blood sparkles on enemy impact (hit juice)' },
      { type: 'debris', desc: 'dusty grain puff when a solid-behavior shot dies on terrain' },
    ],
    desc: 'Straight-line shot into the existing projectile pool. solidBehavior maps to the existing entity flag. Arcing bodies belong to the `ballistic` primitive.',
    params: [
      { key: 'speed', desc: 'px/s travel speed' },
      { key: 'direction', desc: 'radians (0 = right)' },
      { key: 'ttl', desc: 'seconds before auto-cull' },
      { key: 'damage', desc: 'damage on valid contact' },
      { key: 'origin', desc: "marker label | {x,y} | null → attacker center" },
      { key: 'solidBehavior', desc: 'phase | stop | reflect (existing flag)' },
      { key: 'team', desc: "ally | foe — who this shot hurts (maps to PROJ_ALLY/PROJ_FOE layer)" },
      { key: 'size', desc: 'square box size px (default 12)' },
      { key: 'width', desc: 'explicit box width px (overrides size)' },
      { key: 'height', desc: 'explicit box height px (overrides size)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('projectile', null, declaredEffectsOf('projectile'));
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
    return h;
  },
});
