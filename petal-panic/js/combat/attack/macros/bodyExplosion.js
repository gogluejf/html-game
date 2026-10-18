// Attack Engine — Body Explosion / Kamikaze (macro). ONE object, one id.
//
// An attacker detonates a payload blast and dies. This macro owns the whole
// sequence: fire the payload attack (default: an explosion centered on the
// target), wait for it to land (or payloadDelay cap), then kill the attacker.
// Callers invoke 'bodyExplosion' with a victim context — no caller builds fake
// victims or pre-aims payloads by hand.
//
// It's a MACRO because it composes another attack via invoke() (the payload) —
// the old selfDestruct primitive did exactly this, which violated the
// "primitives never invoke" contract; the composition now lives where it
// belongs. The death behavior (kill pipeline vs instant remove) is inlined.
//
// Handle shape:
//   h.step(dt)  — advance while waiting on an async payload; true when done
//   detonate    — emitted when the self-destruct happens (after payload)
//   complete    — { killed } once the attacker is dead
//   hit         — forwarded from the payload (so hosts log the blast damage)

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { targetCenter } from '../context.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read at construction so synchronous fires inside impl()
// see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}
import { getPrimitive, getMacro } from '../registry.js';

const DEFAULTS = Object.freeze({
  deathBehavior: 'kill',   // 'kill' (death pipeline) | 'remove' (instant)
  triggerPayloadFirst: true,
  payload: null,           // { id, params } — attack to fire first (default: explosion on target)
  payloadDelay: 0.1,       // max seconds to wait for the payload to complete
});

/**
 * Apply the death behavior to an entity. Returns true if the entity is dead.
 */
export function killAttacker(entity, behavior) {
  if (!entity) return false;
  if (behavior === 'kill' && typeof entity.takeDamage === 'function') {
    entity.takeDamage(9999, null, 'selfDestruct');
  }
  entity.alive = false;
  return !entity.alive;
}

defineMacro('bodyExplosion', {
  attacks: [{ id: 'explosion', role: 'payload' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Body Explosion / Kamikaze',
    // No native effects: the blast burst is inherited from the Explosion
    // payload via resolveEffects() (meta.invokes) — declaring it here would
    // shadow the primitive's own row in the dedup.
    effects: [],
    desc: 'Fire a payload blast (default: explosion on the target), then die. Kamikaze pattern.',
    params: [
      { key: 'deathBehavior', desc: "kill (death pipeline) | remove (instant)" },
      { key: 'triggerPayloadFirst', desc: 'fire payload before dying' },
      { key: 'payload', desc: '{ id, params } attack to trigger first (default: explosion at target)' },
      { key: 'payloadDelay', desc: 'max s to wait for payload completion' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('bodyExplosion', null, declaredEffectsOf('bodyExplosion'));
    const victim = ctx.attacker;
    h.state = { done: false, payloadT: 0, payloadHandle: null };

    const finish = () => {
      if (h.state.done) return;
      h.state.done = true;
      killAttacker(victim, p.deathBehavior);
      h._emit('detonate');
      h._complete({ killed: !!victim && !victim.alive });
    };

    // Resolve the payload: explicit {id,params}, or default to an explosion
    // centered on the current target (the canonical kamikaze blast).
    let payload = p.payload;
    if (!payload?.id) {
      const tc = targetCenter(p.target ?? ctx.target);
      if (tc) {
        payload = {
          id: 'explosion',
          params: { x: tc.x, y: tc.y, radius: 70, damage: 40, team: 'neutral' },
        };
      }
    }

    if (p.triggerPayloadFirst && payload?.id) {
      try {
        h.state.payloadHandle = invoke(payload.id, payload.params ?? {}, ctx);
      } catch {
        h.state.payloadHandle = null; // unknown payload id → just die
      }
      const ph = h.state.payloadHandle;
      if (ph) ph.on('hit', (...x) => h._emit('hit', ...x));
      if (!ph || ph._completed) {
        finish(); // payload was synchronous (e.g. explosion) → proceed now
        return h;
      }
      // Async payload: host steps us; we wait for its completion or the delay cap.
      h.step = (dt) => {
        if (h.state.done) return true;
        h.state.payloadT += dt;
        if (ph?._completed || h.state.payloadT >= p.payloadDelay) {
          finish();
          return true;
        }
        return false;
      };
      return h;
    }

    finish();
    return h;
  },
});
