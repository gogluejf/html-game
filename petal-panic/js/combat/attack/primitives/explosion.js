// Attack Engine — Explosion primitive (Task 1.5).
//
// Thin wrapper over the EXISTING resolveExplosion() (combat/explosion.js).
// This file owns: param translation, target gathering, VFX dispatch, and
// lifecycle events. It never does HP math or knockback math itself — those
// live in damage()/takeDamage() and applyKnockback() behind resolveExplosion.
//
// Synchronous: a blast resolves in one call. The handle completes immediately
// with the hit summary; 'detonate' fires first so bomb payloads can chain.

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { resolveExplosion, ALIGNMENT, BARREL_EXPLOSION_KNOCKBACK } from '../../explosion.js';
import { Effects } from '../../../effects.js';

const DEFAULTS = Object.freeze({
  x: 0,               // blast center (world coords)
  y: 0,
  radius: 60,
  damage: 40,
  alignment: ALIGNMENT.NEUTRAL, // foe | ally | neutral
  knockback: null,      // KnockbackSetting; default = barrel character
  self: null,           // detonator entity (excluded from its own blast)
  targets: null,        // candidate entities; default = ctx.world.targets ?? []
  style: null,          // Effect Engine style override (rendered by caller)
});

/**
 * Resolve a blast at (x, y). Pure logic core — no VFX, no registry.
 * Exported for direct use by tests and by macros that want the summary.
 *
 * @param {object} p   merged params
 * @param {object} ctx AttackContext
 * @returns {{center:{cx,cy}, radius:number, hit:object[]}} resolveExplosion summary
 */
export function fireBlast(p, ctx) {
  const self = p.self ?? ctx.attacker ?? null;
  const targets = p.targets ?? ctx.world?.targets ?? [];
  // Telemetry: resolveExplosion() routes damage with `self` as the source.
  // A null self is legal (environmental blasts), but the central damage()
  // telemetry path expects a real entity — pass an inert stand-in so we
  // never feed null into record(). The blast still reports via `self`.
  const telemetrySource = self ?? { traceStats: undefined };
  return resolveExplosion(
    {
      cx: p.x, cy: p.y,
      radius: p.radius,
      damage: p.damage,
      alignment: p.alignment,
      knockback: p.knockback ?? BARREL_EXPLOSION_KNOCKBACK,
      self: telemetrySource,
      ctx: { hero: ctx.world?.hero ?? null },
    },
    targets,
  );
}

registerPrimitive('explosion', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Explosion',
    desc: 'Radial damage event via the single resolveExplosion() path. Alignment decides who it hurts; knockback shoves radially.',
    params: [
      { key: 'x', desc: 'blast center x' },
      { key: 'y', desc: 'blast center y' },
      { key: 'radius', desc: 'damaging radius (px)' },
      { key: 'damage', desc: 'raw damage per valid target' },
      { key: 'alignment', desc: 'foe | ally | neutral' },
      { key: 'knockback', desc: 'KnockbackSetting (default: barrel character)' },
      { key: 'style', desc: 'Effect Engine style override' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('explosion');
    const result = fireBlast(params, ctx);

    // VFX owned by the primitive (same as bomb's detonation juice): blast
    // burst + shake. resolveExplosion is deliberately VFX-free; the explosion
    // primitive IS "a blast happened", so every host gets the visual for free.
    Effects.spawnExplosion(params.x, params.y, params.radius);
    Effects.triggerShake(4);

    h._emit('detonate', { x: params.x, y: params.y, hit: result.hit.length });
    h._complete(result);
    return h;
  },
});
