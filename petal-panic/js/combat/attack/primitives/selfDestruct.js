// Attack Engine — Self-Destruct / Kill Self primitive (Task 1.18).
//
// Removes or kills the attacker as part of an attack sequence (kamikaze
// pattern). This primitive controls the ATTACKER LIFECYCLE only — the damage
// normally comes from another primitive (Explosion, Spawn/Split) triggered
// first via `payload`.
//
// Sequence:
//   1. if `triggerPayloadFirst` and a payload is given: invoke it now and
//      wait for its 'complete' (or `payloadDelay` seconds, whichever first)
//   2. apply the death behavior to ctx.attacker
//   3. emit 'detonate' (the self-destruct happened), then 'complete'
//
// Death behaviors:
//   'kill'    — takeDamage(9999) routed through the entity's own pipeline
//               (runs the real death VFX/coins/drop logic); fallback to
//               alive=false when no pipeline exists.
//   'remove'  — alive = false immediately (no death pipeline).
//
// Synchronous unless a payload with a live handle is provided; in that case
// the host steps it via h.step(dt) until complete.

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { invoke } from '../engine.js';

const DEFAULTS = Object.freeze({
  timing: 'immediate',     // 'immediate' | 'afterPayload'
  deathBehavior: 'kill',   // 'kill' | 'remove'
  triggerPayloadFirst: true,
  payload: null,           // { id, params } — another attack to fire first
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

registerPrimitive('selfDestruct', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Self-Destruct / Kill Self',
    desc: 'Kills/removes the attacker, optionally after triggering a payload (kamikaze). Damage comes from the payload, not this primitive.',
    params: [
      { key: 'timing', desc: "immediate | afterPayload" },
      { key: 'deathBehavior', desc: "kill (death pipeline) | remove (instant)" },
      { key: 'triggerPayloadFirst', desc: 'fire payload before dying' },
      { key: 'payload', desc: '{ id, params } attack to trigger first' },
      { key: 'payloadDelay', desc: 'max s to wait for payload completion' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('selfDestruct');
    const target = ctx.attacker;
    h.state = { done: false, payloadT: 0, payloadHandle: null };

    const finish = () => {
      if (h.state.done) return;
      h.state.done = true;
      killAttacker(target, params.deathBehavior);
      h._emit('detonate');
      h._complete({ killed: !!target && !target.alive });
    };

    const wantPayload = params.triggerPayloadFirst && params.payload?.id &&
      (params.timing === 'afterPayload' || params.timing === 'immediate');

    if (wantPayload) {
      try {
        h.state.payloadHandle = invoke(params.payload.id, params.payload.params ?? {}, ctx);
      } catch {
        h.state.payloadHandle = null; // unknown payload id → just die
      }
      if (!h.state.payloadHandle || h.state.payloadHandle._completed) {
        finish(); // payload was synchronous (e.g. explosion) → proceed now
        return h;
      }
      // Async payload: host steps us; we wait for its completion or the delay cap.
      h.step = (dt) => {
        if (h.state.done) return true;
        h.state.payloadT += dt;
        const ph = h.state.payloadHandle;
        if (ph?._completed || h.state.payloadT >= params.payloadDelay) {
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
