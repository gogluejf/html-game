// Attack Engine — Bomb / Ballistic Arc primitive (Task 1.4).
//
// A dumb ballistic carrier: a thrown object with a gravity arc that bounces
// or stops on impact, deals its contact damage like any projectile, and dies
// on impact/fuse/off-screen. It NEVER composes other attacks and NEVER fires
// blast VFX — "what happens when it goes off" is a MACRO concern
// (explosiveBomb owns the explosion; cluster bombs own the split, etc.).
//
// Reuses the EXISTING Special-class physics (gravityValue integration +
// solidBehavior bounce via collisionHandlers.js) — this file only owns:
// spawn translation, per-frame stepping, and lifecycle bridging.
//
// Terminal event: 'detonate' { x, y, contact } — emitted at the death point
// whenever the bomb ends (impact, fuse expiry, or off-screen cull). Macros
// subscribe to this to fire their payload effect at exactly that point.

import { invalidateImpactMotion } from '../../entryImpact.js';
import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { LAYER } from '../../../consts.js';
import { fireDeclared } from '../../../effects/index.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read lazily at construction so synchronous fires inside
// impl() see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  speed: 500,           // launch force (px/s)
  direction: -0.5,        // up-right throw (tuned via Attack Theater)
  arc: 800,             // gravity px/s² (throw height control)
  team: 'ally',
  bounce: true,         // → solidBehavior 'reflect' (existing flag)
  explodeOnContact: true,
  ttl: 2,               // fuse seconds (runs while airborne AND resting)
  damage: 40,           // direct-contact damage
  radius: 70,           // reference size for host-side effects (macro-owned)
  origin: null,         // marker label | {x,y} | null → attacker center
});

/** Rebound below this (px/s) settles the bomb instead of bouncing again. */
export const BOMB_SETTLE_VY = 40;

/**
 * Spawn the bomb entity into the special pool (ballistic carrier).
 * @returns {object|null} the Special entity, or null if the pool is exhausted
 */
export function spawnBomb(p, ctx, h = null) {
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
  ent.friendly = p.team !== 'foe';
  ent.layer = ent.friendly ? LAYER.PROJ_ALLY : LAYER.PROJ_FOE;
  // Fuse: the bomb's TTL label is 'fuse' (Special relabels it), so setLife()
  // — which writes the 'life' timer — would be ignored by tickTtl(). Write
  // the labeled timer directly so the declared ttl actually governs expiry.
  const label = ent._ttlLabel ?? 'life';
  ent.setLife(p.ttl);
  ent.timers.set(label, p.ttl);
  ent.solidBehavior = p.bounce ? 'reflect' : 'stop';
  ent._attackId = 'bomb';
  ent._attackDone = false;
  ent._attackHit = false;
  ent._bombSurfaceY = null;
  ctx.collisionWorld?.add(ent);
  // Gameplay host bridge: the world update loop (systems/update.js) steps
  // engine-spawned bombs via stepBomb() — it finds them by this tag. The
  // theater sandbox drives its own handles directly and never sets this.
  if (h) ent._attackHandle = h;
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
 *    (< BOMB_SETTLE_VY), the bomb rests alive until its fuse expires.
 *  - solidBehavior 'stop' → immediate settle (impact = end).
 *
 * @param {object} ent          the Special entity (must be alive)
 * @param {number} dt           seconds
 * @param {number} groundY      floor top y (world)
 * @param {Array}  [platforms]  optional extra surfaces [{x, y, w}] (tops only)
 * @returns {boolean} true when the bomb settled this call (end pending)
 */
export function stepBombTerrain(ent, dt, groundY, platforms = []) {
  if (!ent || (!ent.alive && !ent.ttlExpired) || ent._attackDone) return false;
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
    ent.vy = -Math.abs(ent.vy) * 0.5; // restitution
    ent.vx *= 0.7;                    // friction
    if (Math.abs(ent.vy) < BOMB_SETTLE_VY) {
      // Rest on the surface — do NOT kill. The fuse keeps running;
      // stepBomb() fires when TTL expires or contact occurs.
      ent.vy = 0;
      ent.vx = 0;
      return false;
    }
    return false;
  }
  // 'stop' (or anything non-reflect): impact ends the flight.
  ent._attackHit = true;
  ent.alive = false;
  return true;
}

/**
 * Per-frame step. Returns true when the bomb finished (ended or expired).
 * The host loop calls this until it returns true.
 *
 * End triggers:
 *  - contact: stepBombTerrain() settles the entity against terrain
 *    (sets _attackHit), or a collision handler kills it against an enemy.
 *  - fuse: ttlExpired flag set by Special.update() when the life timer ends.
 *  - off-screen: caller sets ent.alive=false via cullOffScreen().
 *
 * On end the handle emits 'detonate' { x, y, contact } at the death point —
 * ALWAYS (even a fizzle), so composed macros know exactly where the carrier
 * died. No VFX here: the carrier is dumb; macros own the aftermath.
 *
 * @param {object} ent   the spawned Special
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
  // a landing puff when the bomb dies against terrain. Blast bursts, screen
  // flash, camera shake belong to whatever macro COMPOSES this carrier —
  // the primitive never double-dips.
  if (contact && !ent.ttlExpired) {
    fireDeclared({ type: 'debris', params: { x: cx, y: cy } }, h.declaredEffectTypes());
  }

  h._complete();
  return true;
}

registerPrimitive('bomb', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Ballistic Arc',
    effects: [
      { type: 'debris', desc: 'landing puff when the carrier dies on terrain' },
    ],
    desc: 'Dumb ballistic carrier: gravity arc + bounce, contact damage, dies on impact/fuse/off-screen emitting detonate{x,y}. No blast VFX, no composition — explosiveBomb (macro) owns the explosion.',
    params: [
      { key: 'speed', desc: 'launch force (px/s)' },
      { key: 'direction', desc: 'throw direction (radians)' },
      { key: 'arc', desc: 'gravity px/s² (throw height)' },
      { key: 'bounce', desc: 'reflect off surfaces (solidBehavior)' },
      { key: 'explodeOnContact', desc: 'legacy flag (kept for param parity)' },
      { key: 'ttl', desc: 'fuse seconds' },
      { key: 'damage', desc: 'contact damage' },
      { key: 'radius', desc: 'reference size for composed effects' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('bomb', null, declaredEffectsOf('bomb'));
    const ent = spawnBomb(params, ctx, h);
    if (!ent) { h._emit('expire'); h._complete(); return h; }
    h.entity = ent;
    return h;
  },
});
