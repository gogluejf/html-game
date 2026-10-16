// Attack Engine — Projectile primitive (Task 1.2).
//
// Straight-line projectile: spawn into the EXISTING pools, set data, let the
// existing systems do the work. This primitive NEVER implements wall physics,
// damage math, or pooling itself:
//   - solidBehavior ('phase'|'stop'|'reflect') is mapped onto the entity flag
//     that collisionHandlers.js already consumes. Data, not code.
//   - gravity reuses the Special-class ballistic path (gravityValue + vy
//     integration in its update()).
//   - damage routing stays in damage()/takeDamage() via the existing handlers.
//
// What this file OWNS: param → pool-spawn translation, origin resolution
// (marker or explicit point), and lifecycle bridging (entity death → handle
// events hit/expire/complete).

import { registerPrimitive } from '../registry.js';
import { resolveMarker } from '../context.js';
import { AttackHandle } from '../engine.js';
import { dirAngle } from '../../../core/vec.js';
import { fireManual } from '../../../effects/index.js';

/** Default params (canonical values; callers override per shot). */
const DEFAULTS = Object.freeze({
  speed: 600,            // px/s
  direction: 0,          // radians (NOT an 8-way index)
  ttl: 2,                // seconds before auto-cull
  damage: 10,
  origin: null,          // marker label (string) | {x,y} | null → attacker center
  solidBehavior: 'phase', // phase | stop | reflect (existing entity-flag contract)
  gravity: 0,            // px/s²; >0 routes to the ballistic (Special) pool
  friendly: true,        // true = hero-side (PROJ_ALLY), false = foe (PROJ_FOE)
  size: 12,              // box size (thorn = 12, specials ~16)
  type: null,            // special weapon type id when spawning a Special
  count: 1,              // shots launched as part of this action
  burstInterval: 0,      // seconds between repeated launches (0 = all at once)
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

  let ent = null;
  if (p.gravity > 0 || p.type != null) {
    // Ballistic / named-special path: the Special class owns gravityValue and
    // the fuse/life relabeling. Pass 8-way dir 0 and fix vx/vy after spawn so
    // arbitrary angles work (the class computes velocity from its dir arg).
    // A typeless ballistic shot uses 'bomb' as the physics carrier — its
    // registry entry provides gravity + size; our params override speed/ttl/
    // damage/solidBehavior on top.
    const carrierType = p.type ?? 'bomb';
    ent = ctx.pools.specialPool?.spawn(pt.x, pt.y, 0, carrierType);
    if (ent) {
      ent.vx = cos * p.speed;
      ent.vy = sin * p.speed;
      ent.damage = p.damage;
      ent.setLife?.(p.ttl);
      // Arm the ballistic integrator even if the carrier's own gravity is 0.
      ent.gravityValue = Math.max(p.gravity, ent.gravityValue ?? 0);
    }
  } else {
    // Straight-line path: plain Projectile. The constructor takes an 8-way
    // index; we spawn with dir 0 and overwrite velocity for exact angles.
    ent = ctx.pools.projectilePool?.spawn(pt.x, pt.y, 0, p.friendly);
    if (ent) {
      ent.vx = cos * p.speed;
      ent.vy = sin * p.speed;
      ent.damage = p.damage;
      ent.life = p.ttl;
    }
  }
  if (!ent) return null; // pool exhausted — caller skips this shot (soft cap)

  // Data-only transport: the existing collision handler reads this flag.
  // Always set explicitly — pool slots are recycled via Object.assign from a
  // fresh instance, but a caller that omits solidBehavior must still get the
  // documented default ('phase') rather than inheriting a stale slot value.
  ent.solidBehavior = p.solidBehavior ?? 'phase';
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
    if (!ent._attackHit && !ent.ttlExpired && ent.solidBehavior === 'stop') {
      fireManual({ type: 'debris', params: { x: ent.x + ent.w / 2, y: ent.y + ent.h / 2 } });
    }
    if (ent._attackHit) h._emit('hit', { dealt: ent.damage });
    else h._emit('expire');
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
    desc: 'Straight-line shot into the existing projectile/special pools. solidBehavior maps to the existing entity flag; gravity routes to the ballistic pool.',
    params: [
      { key: 'speed', desc: 'px/s travel speed' },
      { key: 'direction', desc: 'radians (0 = right)' },
      { key: 'ttl', desc: 'seconds before auto-cull' },
      { key: 'damage', desc: 'damage on valid contact' },
      { key: 'origin', desc: "marker label | {x,y} | null → attacker center" },
      { key: 'solidBehavior', desc: 'phase | stop | reflect (existing flag)' },
      { key: 'gravity', desc: 'px/s² (>0 = ballistic arc)' },
      { key: 'friendly', desc: 'true = PROJ_ALLY, false = PROJ_FOE' },
      { key: 'count', desc: 'shots launched by this action' },
      { key: 'burstInterval', desc: 's between shots (0 = simultaneous)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('projectile');
    const count = Math.max(1, Math.floor(params.count ?? 1));
    const interval = Math.max(0, params.burstInterval ?? 0);
    if (count === 1 || interval <= 0) {
      // Single shot or simultaneous burst: spawn all now. The handle tracks
      // every entity; it completes when the LAST one finishes (host steps via
      // stepProjectile on each — see theater/step loop for multi-entity).
      const ents = [];
      for (let i = 0; i < count; i++) {
        const ent = spawnProjectile(params, ctx, h);
        if (ent) ents.push(ent);
      }
      if (!ents.length) {
        h._emit('expire');
        h._complete();
        return h;
      }
      h.entity = ents[0];
      h.entities = ents;
      return h;
    }
    // Timed burst: spawn one per interval until count is reached, then stay
    // live until all spawned entities have finished. Host calls h.step(dt).
    h.state = { spawned: 0, t: 0, done: false, ents: [] };
    h.entities = h.state.ents;
    h.step = (dt) => {
      const s = h.state;
      if (s.done) return true;
      s.t += dt;
      while (s.spawned < count && s.t >= s.spawned * interval) {
        const ent = spawnProjectile(params, ctx, h);
        if (ent) s.ents.push(ent);
        s.spawned++;
      }
      // All spawned AND all dead → complete.
      if (s.spawned >= count && s.ents.every((e) => !e.alive)) {
        s.done = true;
        h._complete({ shots: s.ents.length });
        return true;
      }
      return false;
    };
    return h;
  },
});
