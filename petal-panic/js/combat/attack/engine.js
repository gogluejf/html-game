// Attack Engine — dispatcher + handle (Task 1.1).
//
// attackEngine.invoke(id, params, ctx) is the single entry point for every
// attack in the game: hero weapons, enemy AI, boss phases, and the Theater all
// go through it. It looks up the primitive or macro in the registry, calls its
// impl with merged default+caller params, and wraps the result in a MacroHandle.
//
// Handles are uniform across primitives AND macros so callers never need to
// know which kind they invoked:
//   const h = attackEngine.invoke('projectile_shot', { damage: 4 }, ctx);
//   h.on('hit', () => {...});
//   h.cancel();

import { getPrimitive, getMacro } from './registry.js';
import { ATTACK_EVENTS } from './context.js';

/**
 * Uniform handle over an active attack.
 * Emits lifecycle events; `.cancel()` tears down early.
 */
export class AttackHandle {
  /**
   * @param {string} id          registry id of the invoked attack
   * @param {object|null} inner  optional inner handle returned by the impl
   *                              (e.g. a sub-primitive handle) whose events we proxy
   */
  constructor(id, inner = null) {
    this.id = id;
    this._inner = inner;
    this._listeners = new Map(); // event → Set<fn>
    this._cancelled = false;
    this._completed = false;
    if (inner && typeof inner.on === 'function') {
      for (const ev of ATTACK_EVENTS) {
        inner.on(ev, (...args) => this._emit(ev, ...args));
      }
    }
  }

  /** Re-point at a different inner handle (impls may return a wrapper). */
  setInner(inner) {
    if (this._inner && this._inner !== inner) this._inner.cancel?.();
    this._inner = inner ?? null;
    if (inner && typeof inner.on === 'function') {
      for (const ev of ATTACK_EVENTS) {
        inner.on(ev, (...args) => this._emit(ev, ...args));
      }
    }
    return this;
  }

  /** Subscribe to a lifecycle event ('hit'|'expire'|'detonate'|'complete'). */
  on(event, cb) {
    if (!ATTACK_EVENTS.includes(event)) throw new Error(`attack: unknown event '${event}'`);
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return this;
  }

  cancel() {
    if (this._cancelled || this._completed) return;
    this._cancelled = true;
    this._inner?.cancel?.();
    // Emit BEFORE flipping listener cleanup: subscribers must observe the
    // terminal event. Guard inside _emit still blocks any re-emit after this.
    const set = this._listeners.get('expire');
    if (set) for (const fn of [...set]) fn();
    this._finish();
  }

  /** Mark complete (called by impls when their sequence ends naturally). */
  _complete(...args) {
    if (this._completed || this._cancelled) return;
    this._completed = true;
    // Emit BEFORE flipping listener cleanup: subscribers must observe the
    // terminal event. Guard inside _emit still blocks any re-emit after this.
    const set = this._listeners.get('complete');
    if (set) for (const fn of [...set]) fn(...args);
    this._finish();
  }

  _emit(event, ...args) {
    if (this._completed || this._cancelled) return;
    const set = this._listeners.get(event);
    if (set) for (const fn of [...set]) fn(...args);
  }

  _finish() {
    // Clear listeners only after the terminal event has been delivered.
    queueMicrotask(() => this._listeners.clear());
  }
}

/**
 * Invoke a registered primitive or macro by id.
 *
 * @param {string} id            registry id ('projectile', 'spread_shot', ...)
 * @param {object} [params]      caller params; merged over the def's defaults
 * @param {object} ctx           AttackContext (see context.js)
 * @returns {AttackHandle}
 * @throws {Error} if the id is not registered
 */
export function invoke(id, params = {}, ctx) {
  const def = getPrimitive(id) ?? getMacro(id);
  if (!def) throw new Error(`attack: unknown attack '${id}'`);
  const merged = { ...(def.params ?? {}), ...params };
  const handle = new AttackHandle(id);
  // Wire the inner handle AFTER construction so its id is authoritative.
  const inner = def.impl(merged, ctx);
  if (inner instanceof AttackHandle) {
    inner.id = id;
    return inner.setInner(null); // it IS the handle; drop self-proxying
  }
  handle.setInner(inner);
  return handle;
}

export const attackEngine = { invoke };
export default attackEngine;
