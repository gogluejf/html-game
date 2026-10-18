// Attack Engine — Carrier Macro base (Wave 3.5 refactor).
//
// A carrier macro composes a dumb ballistic/flying CARRIER primitive (bomb,
// projectile) with a deferred PAYLOAD that fires on the carrier's terminal
// event ('detonate'). Examples: explosiveBomb (carrier → explosion), molotov
// (carrier → fireArea), clusterBomb (carrier → spawnSplit).
//
// This base provides:
//   - h.step(dt, targets)  — unified per-frame stepping. Resolves the
//     innermost carrier, calls stepBomb/stepProjectile + terrain, steps
//     any deferred children in h.handles. Returns true when done.
//   - Auto-promotion: deferred children spawned on detonate are exposed in
//     h.handles so hosts (theater, game loop) can promote them to their own
//     handle list and keep stepping them after the parent completes.
//   - Completion tracking: parent carrier done AND all children done.
//
// Subclasses (or inline impls) call createCarrierHandle() and get back a
// fully-wired AttackHandle with .step already set. They only need to:
//   1. Invoke the carrier primitive
//   2. Subscribe to 'detonate' to spawn their payload
//   3. Push payload handles into h.handles
//
// No theater wiring, no manual innermost resolution, no orphaned children.

import { AttackHandle } from './engine.js';
import { stepBomb, stepBombTerrain } from './primitives/bomb.js';
import { stepProjectile } from './primitives/projectile.js';
import { getPrimitive, getMacro } from './registry.js';

/**
 * Resolve the innermost carrier handle (the one whose entity has _attackId).
 * Walks the .inner chain until no deeper entity exists.
 */
export function resolveCarrier(h) {
  let ch = h;
  while (ch.inner?.entity) ch = ch.inner;
  return ch;
}

/**
 * Create a carrier-macro handle with unified stepping.
 *
 * @param {string} id           macro registry id
 * @param {object} params       merged params (for _params storage)
 * @param {object} ctx          AttackContext
 * @param {object} opts
 * @param {function} opts.onDetonate  called with ({x, y}, h) at death point
 * @returns {AttackHandle}      the macro handle (with .step set)
 */
export function createCarrierHandle(id, params, ctx, { onDetonate }) {
  // Same declared set the guard checks / theater renders (meta.effects of THIS
  // registration) — populated at construction so synchronous fires inside the
  // carrier's setup see the real declaration.
  const def = getPrimitive(id) ?? getMacro(id);
  const declaredEffects = (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
  const h = new AttackHandle(id, null, declaredEffects);
  h._params = params;
  h.handles = []; // deferred children (fireArea, split bombs, etc.)

  let parentDone = false;
  let childrenDone = true;

  const checkComplete = () => {
    if (parentDone && childrenDone) h._complete();
  };

  /**
   * Unified per-frame step. Hosts call this once per frame.
   * @param {number} dt        seconds
   * @param {Array}  targets   live target entities for damage
   * @returns {boolean} true when the macro is fully done
   */
  h.step = (dt, targets = []) => {
    // Step the innermost carrier.
    const ch = resolveCarrier(h);
    if (!parentDone && ch.entity) {
      if (ch.entity._attackId === 'bomb') {
        // Terrain: host supplies groundY via params or ctx.
        const groundY = params.groundY ?? ctx.groundY;
        const platforms = params.platforms ?? ctx.platforms ?? [];
        if (groundY != null) stepBombTerrain(ch.entity, dt, groundY, platforms);
        stepBomb(ch.entity, ch._params ?? params, ctx, ch);
      } else if (ch.entity._attackId === 'projectile') {
        stepProjectile(ch.entity, ch);
      }
    }

    // Step deferred children (fireArea, child bombs, etc.).
    for (const child of h.handles) {
      if (child._completed || child._cancelled) continue;
      if (typeof child.step === 'function') {
        child.step(dt, targets);
      } else if (child.entity?._attackId === 'bomb') {
        // Child bomb carriers (clusterBomb splits).
        let inner = child;
        while (inner.inner?.entity) inner = inner.inner;
        const groundY = params.groundY ?? ctx.groundY;
        const platforms = params.platforms ?? ctx.platforms ?? [];
        if (groundY != null) stepBombTerrain(inner.entity, dt, groundY, platforms);
        stepBomb(inner.entity, inner._params ?? params, ctx, inner);
      }
    }

    // Completion: parent done + all children done.
    if (!h._completed && !h._cancelled) {
      const carrierDead = !ch.entity?.alive || ch.entity?._attackDone;
      if (carrierDead && !parentDone) {
        parentDone = true;
      }
      if (h.handles.length > 0) {
        childrenDone = h.handles.every((c) => c.state?.done || c._completed || !c.entity?.alive);
      }
      if (parentDone && childrenDone) {
        h._complete();
      }
    }

    return h._completed;
  };

  // Wire the detonate subscription.
  const wireDetonate = (carrier) => {
    carrier.on('detonate', ({ x, y }) => {
      // The payload can immediately recycle the dead carrier's pool slot.
      // From here on its entity belongs to another attack, not this parent.
      parentDone = true;
      onDetonate?.({ x, y }, h);
      childrenDone = h.handles.every((child) => child._completed || child._cancelled);
    });
    carrier.on('hit', (...args) => h._emit('hit', ...args));
    carrier.on('complete', () => {
      parentDone = true;
      checkComplete();
    });
  };

  // Expose for the impl to call after invoking the carrier.
  h._wireCarrier = wireDetonate;

  return h;
}
