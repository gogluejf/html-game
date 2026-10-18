// Attack Engine — Explosion primitive (Task 1.5).
//
// Thin wrapper over the EXISTING resolveExplosion() (combat/explosion.js).
// This file owns: param translation, target gathering, VFX dispatch, and
// lifecycle events. It never does HP math or knockback math itself — those
// live in damage()/takeDamage() and applyKnockback() behind resolveExplosion.
//
// Synchronous: a blast resolves in one call. The handle completes immediately
// with the hit summary; 'detonate' fires first so bomb payloads can chain.
//
// VFX are PARAMETERIZED: burst / screenFlash / shake each default to true but
// can be suppressed per call. Callers that compose an explosion inside a
// bigger set piece (e.g. the explosiveBomb macro) pass explicit flags so the
// combined effect reads as ONE event instead of double-flashing.

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { resolveExplosion, BARREL_EXPLOSION_KNOCKBACK } from '../../explosion.js';
import { fireDeclared } from '../../../effects/index.js';
import { VIEW_W, VIEW_H } from '../../../core/view.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read lazily at construction so synchronous fires inside
// impl() see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  x: 0,               // blast center (world coords)
  y: 0,
  radius: 60,
  damage: 40,
  team: 'neutral',         // ally | foe | neutral (engine-wide side vocabulary)
  knockback: null,      // KnockbackSetting; default = barrel character
  self: null,           // detonator entity (excluded from its own blast)
  targets: null,        // candidate entities; default = ctx.world.targets ?? []
  style: null,          // Effect Engine style override (rendered by caller)
  // --- VFX switches (all on by default; composed callers tune these) -------
  burst: true,          // particle blast burst at the center
  screenFlash: true,    // white screen flash (bigExplosion)
  shake: true,          // camera shake on detonation
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
      team: p.team,
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
    effects: [
      { type: 'explosion', desc: 'blast particle burst at the center' },
      { type: 'screen-flash', desc: 'white flash on detonation' },
      { type: 'camera-shake', desc: 'shake on detonation' },
    ],
    desc: 'Radial damage event via the single resolveExplosion() path. Alignment decides who it hurts; knockback shoves radially. burst/screenFlash/shake are switchable per call.',
    params: [
      { key: 'x', desc: 'blast center x' },
      { key: 'y', desc: 'blast center y' },
      { key: 'radius', desc: 'damaging radius (px)' },
      { key: 'damage', desc: 'raw damage per valid target' },
      { key: 'team', desc: "ally | foe | neutral — who the blast hurts" },
      { key: 'knockback', desc: 'KnockbackSetting (default: barrel character)' },
      { key: 'style', desc: 'Effect Engine style override' },
      { key: 'burst', desc: 'particle burst (true)' },
      { key: 'screenFlash', desc: 'white screen flash (true)' },
      { key: 'shake', desc: 'camera shake (true)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('explosion', null, declaredEffectsOf('explosion'));
    const result = fireBlast(params, ctx);

    // VFX owned by the primitive, gated by the per-call switches.
    // resolveExplosion is deliberately VFX-free; the explosion primitive IS
    // "a blast happened", so every host gets the visual for free unless it
    // explicitly suppresses a channel (composed set pieces do this so the
    // parent's juice isn't doubled). All three route through the guarded
    // declared-fire path — each type is declared in meta.effects above.
    if (params.burst !== false) fireDeclared({ type: 'explosion', params: { x: params.x, y: params.y, radius: params.radius } }, h.declaredEffectTypes());
    if (params.screenFlash !== false) fireDeclared({ type: 'screen-flash', params: { strength: 1, viewW: VIEW_W, viewH: VIEW_H } }, h.declaredEffectTypes());
    if (params.shake !== false) fireDeclared({ type: 'camera-shake', params: { intensity: 4 } }, h.declaredEffectTypes());

    h._emit('detonate', { x: params.x, y: params.y, hit: result.hit.length });
    h._lastResult = result; // synchronous blast summary (macros surface it as hits)
    h._complete(result);
    return h;
  },
});
