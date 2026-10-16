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
import { Effects } from '../../../effects.js';

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

/** Rebound below this (px/s) settles the bomb instead of bouncing again. */
export const BOMB_SETTLE_VY = 40;

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
  // Fuse: the bomb's TTL label is 'fuse' (Special relabels it), so setLife()
  // — which writes the 'life' timer — would be ignored by tickTtl(). Write
  // the labeled timer directly so the declared ttl actually governs expiry.
  const label = ent._ttlLabel ?? 'life';
  ent.setLife(p.ttl);
  ent.timers.set(label, p.ttl);
  ent.solidBehavior = p.bounce ? 'reflect' : 'stop';
  ent._attackId = 'bomb';
  ent._attackDone = false;
  ctx.collisionWorld?.add(ent);
  return ent;
}

/**
 * Terrain stepping for a live bomb entity (host calls once per frame).
 * Single source of truth for bomb-vs-terrain behavior — gameplay (level
 * floor + platform tops) and the sandbox (flat ground line) both call this,
 * so bounce numbers can never drift between the two hosts.
 *
 * Rules (match Special physics):
 *  - falling onto a surface with solidBehavior 'reflect' → bounce
 *    (restitution 0.5, friction 0.7); when the rebound is too weak to matter
 *    (< BOMB_SETTLE_VY), the bomb SETTLES: it is killed with _attackHit set,
 *    which makes stepBomb() detonate it on the host's next step.
 *  - solidBehavior 'stop' → immediate settle (impact = detonation).
 *
 * @param {object} ent          the Special entity (must be alive)
 * @param {number} dt           seconds
 * @param {number} groundY      floor top y (world)
 * @param {Array}  [platforms]  optional extra surfaces [{x, y, w}] (tops only)
 * @returns {boolean} true when the bomb settled this call (detonation pending)
 */
export function stepBombTerrain(ent, dt, groundY, platforms = []) {
  if (!ent?.alive || ent._attackDone) return false;
  const bottom = ent.y + ent.h;
  // Floor first (the common case), then platform tops.
  let surface = null;
  if (bottom >= groundY && ent.vy > 0) surface = groundY;
  else {
    for (const p of platforms) {
      const prevBottom = bottom - ent.vy * dt;
      if (prevBottom <= p.y + 2 && bottom >= p.y && ent.vy > 0 &&
          ent.x + ent.w > p.x && ent.x < p.x + p.w) { surface = p.y; break; }
    }
  }
  if (surface == null) return false;

  ent.y = surface - ent.h;
  if (ent.solidBehavior === 'reflect') {
    ent.vy = -Math.abs(ent.vy) * 0.5; // restitution
    ent.vx *= 0.7;                    // friction
    if (Math.abs(ent.vy) < BOMB_SETTLE_VY) {
      ent._attackHit = true;
      ent.alive = false;
      return true;
    }
    return false;
  }
  // 'stop' (or anything non-reflect): impact ends the flight.
  ent._attackHit = true;
  ent.alive = false;
  return true;
}

/**
 * Per-frame step. Returns true when the bomb finished (detonated or expired).
 * The host loop calls this until it returns true.
 *
 * Detonation triggers:
 *  - contact: stepBombTerrain() settles the entity against terrain
 *    (sets _attackHit), or a collision handler kills it against an enemy.
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

  // Detonation VFX — same juice as gameplay's explodeSpecial(): blast burst +
  // screen flash + shake. The bomb primitive is the single source of truth for
  // "a bomb went off", so the visual lives here and every host (gameplay,
  // theater, macros) gets it for free.
  Effects.spawnExplosion(cx, cy, p.radius ?? 100);
  Effects.bigExplosion();
  Effects.triggerShake(6);

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
    effects: [
      { type: 'explosion', desc: 'blast burst at detonation point' },
      { type: 'screen-flash', desc: 'white flash on detonation' },
      { type: 'camera-shake', desc: 'shake on detonation' },
    ],
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
