// Attack Engine — Body Contact Damage primitive (Task 1.8).
//
// Toggles/enables the entity's body as a damaging area, with optional
// temporary overrides for damage/knockback during an attack (e.g. a charge
// that hits harder than idle contact). This is DATA management on the
// attacker — the actual contact collision + damage routing stays in the
// existing 'contact' collision rule (collisionHandlers.js), which reads:
//   - source.stats?.attack ?? fallback  → we expose `bodyContactDamage`
//   - source.bodyKnockback              → we manage this field
//
// The host's contact handler should prefer `attacker.bodyContactDamage` over
// stats.attack when present (one-line change in collisionHandlers.js, done in
// Wave 6 alongside the hero refactor; until then the override rides on
// stats.attack directly via applyOverride()).

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  damage: null,        // explicit contact damage; null = use attacker.stats.attack
  knockback: null,     // KnockbackSetting to install on attacker.bodyKnockback
  enabled: true,       // false = explicitly disable body damage while live
  temporaryOverride: false, // restore previous values on complete
});

/**
 * Apply the body-contact configuration to the attacker.
 * Returns a restore function (for temporaryOverride) or null.
 *
 * @param {object} p   merged params
 * @param {object} a   the attacker entity
 * @returns {Function|null}
 */
export function applyBodyContact(p, a) {
  const prev = {
    bodyContactDamage: a.bodyContactDamage ?? null,
    bodyKnockback: a.bodyKnockback ?? null,
    disabled: a.bodyContactDisabled ?? false,
  };

  a.bodyContactDisabled = !p.enabled;
  if (p.damage != null) a.bodyContactDamage = p.damage;
  if (p.knockback != null) a.bodyKnockback = p.knockback;

  if (!p.temporaryOverride) return null;
  return () => {
    a.bodyContactDamage = prev.bodyContactDamage;
    a.bodyKnockback = prev.bodyKnockback;
    a.bodyContactDisabled = prev.disabled;
  };
}

registerPrimitive('bodyContact', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Body Contact Damage',
    desc: 'Makes the attacker\'s body deal contact damage (with optional temp override). Existing contact rule does the actual hit.',
    params: [
      { key: 'damage', desc: 'contact damage (null = stats.attack)' },
      { key: 'knockback', desc: 'KnockbackSetting installed on the body' },
      { key: 'enabled', desc: 'false disables body damage while live' },
      { key: 'temporaryOverride', desc: 'restore previous values on complete' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('bodyContact');
    const a = ctx.attacker;
    h.restore = applyBodyContact(params, a);
    // Completes when the host calls h.finish() (end of the owning attack) or
    // immediately if not temporary (persistent config change).
    h.finish = () => {
      if (h._completed || h._cancelled) return;
      h.restore?.();
      h._complete();
    };
    if (!params.temporaryOverride) h.finish();
    return h;
  },
});
