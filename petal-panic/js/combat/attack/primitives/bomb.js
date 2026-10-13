// Attack Engine — Bomb / Ballistic Arc primitive (Task 1.4).
//
// A thrown object with a gravity arc that detonates a payload on contact,
// TTL, or off-screen. Reuses the EXISTING Special-class physics (gravityValue
// integration + solidBehavior bounce via collisionHandlers.js) — this file
// only owns: spawn translation, per-frame stepping, and detonation routing.
//
// Payload contract: params.payload is { id, params } — another registered
// attack (e.g. the Explosion primitive) invoked at the blast point when the
// bomb detonates. If omitted, the bomb fizzles (no damage) but still emits
// 'detonate' so macros can chain.

import { registerPrimitive } from '../registry.js';
import { AttackHandle, invoke } from '../engine.js';
import { makeContext } from '../context.js';

const DEFAULTS = Object.freeze({
  speed: 300,           // launch force (px/s)
  direction: -Math.PI / 4, // up-right throw
  arc: 800,             // gravity px/s² (throw height control)
  bounce: true,         // → solidBehavior 'reflect' (existing flag)
  explodeOnContact: true,
  ttl: 4,               // fuse seconds (runs while airborne AND bouncing)
  damage: 40,           // direct-contact damage (also used by default explosion)
  radius: 60,           // blast radius for the default explosion payload
  origin: null,         // marker label | {x,y} | null → attacker center
  payload: null,        // { id, params } attack to run on detonation; null = fizzle
});

/**
 * Spawn the bomb entity into the special pool (ballistic carrier).
 * @returns {object|null} the Special entity, or null if the pool is exhausted
 */
export function spawnBomb(p, ctx) {
  const a = ctx.attacker;
  let ox, oy;
  if (p.origin && typeof p.origin === 'object') { ox = p.origin.x; oy = p.origin.y; }
  else if (typeof p.origin === 'string') {
    const m = (ctx.markers ?? a?.markers)?.find((mk) => mk.label === p.origin);
    ox = m ? m.x : a.x + a.w / 2; oy = m ? m.y : a.y + a.h / 2;
  } else { ox = a.x + a.w / 2; oy = a.y + a.h / 2; }

  const size = 18; // bomb box (matches Special default)
  const ent = ctx.pools.specialPool?.spawn(ox - size / 2, oy - size / 2, 0, 'bomb');
  if (!ent) return null;
  ent.vx = Math.cos(p.direction) * p.speed;
  ent.vy = Math.sin(p.direction) * p.speed;
  ent.gravityValue = p.arc;
  ent.damage = p.damage;
  ent.setLife?.(p.ttl);
  ent.solidBehavior = p.bounce ? 'reflect' : 'stop';
  ent._attackId = 'bomb';
  ent._attackDone = false;
  ctx.collisionWorld?.add(ent);
  return ent;
}

/**
 * Per-frame step. Returns true when the bomb finished (detonated or expired).
 * The host loop calls this until it returns true.
 *
 * Detonation triggers:
 *  - contact: the collision handler kills the entity against an enemy/barrel
 *    (sets _attackHit) OR against terrain with solidBehavior 'stop'.
 *  - fuse: ttlExpired flag set by Special.update() when the life timer ends.
 *  - off-screen: caller sets ent.alive=false via cullOffScreen().
 *
 * @param {object} ent   the spawned Special
 * @param {object} p     merged params
 * @param {object} ctx   AttackContext
 * @param {AttackHandle} h handle to emit on
 */
export function stepBomb(ent, p, ctx, h) {
  if (ent._attackDone) return true;
  if (ent.alive) return false;

  ent._attackDone = true;
  const cx = ent.x + ent.w / 2, cy = ent.y + ent.h / 2;

  // Fuse expiry without contact = timed detonation (still a detonation, not
  // a silent expire): bombs are designed to go off wherever they land.
  const contact = !!ent._attackHit;
  h._emit('detonate', { x: cx, y: cy, contact });

  // Run the payload (default: an Explosion at the blast point).
  const payload = p.payload ?? (contact ? { id: 'explosion', params: { x: cx, y: cy, radius: p.radius, damage: p.damage } } : null);
  if (payload?.id) {
    try {
      const sub = invoke(payload.id, { ...(payload.params ?? {}), self: ctx.attacker }, ctx);
      h.setInner(sub);
    } catch (err) {
      // Unknown payload id in a test harness — surface loudly in dev.
      console.error(`attack/bomb: unknown payload '${payload.id}'`, err.message);
    }
  }
  h._complete();
  return true;
}

registerPrimitive('bomb', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Bomb / Ballistic Arc',
    desc: 'Thrown object with gravity arc + bounce (reuses Special physics). Detonates a payload on contact/fuse/off-screen.',
    params: [
      { key: 'speed', desc: 'launch force (px/s)' },
      { key: 'direction', desc: 'throw direction (radians)' },
      { key: 'arc', desc: 'gravity px/s² (throw height)' },
      { key: 'bounce', desc: 'reflect off surfaces (solidBehavior)' },
      { key: 'explodeOnContact', desc: 'trigger payload on contact' },
      { key: 'ttl', desc: 'fuse seconds' },
      { key: 'damage', desc: 'blast/contact damage' },
      { key: 'radius', desc: 'default explosion radius' },
      { key: 'payload', desc: '{id, params} attack run on detonation' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('bomb');
    const ent = spawnBomb(params, ctx);
    if (!ent) { h._emit('expire'); h._complete(); return h; }
    h.entity = ent;
    return h;
  },
});
