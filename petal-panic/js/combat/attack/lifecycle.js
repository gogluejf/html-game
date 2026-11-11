// Self-contained attack lifecycle (Task 1.1).
//
// A single engine-owned registry that tracks every live attack handle and
// drives its step/draw/prune in one place, so invoke() never abandons a
// handle. Callers fire via invoke() and NEVER wire step/draw themselves —
// the game loop calls AttackLifecycle.stepAll(dt, targets) once per frame
// and AttackLifecycle.drawAll(ctx) once per render.
//
// A handle is 'live' when it has a .step fn or a .zone (i.e. it needs
// per-frame driving). Handles that complete synchronously (instant macros)
// are skipped at registration. Live handles self-prune once _completed /
// _cancelled.
//
// Ownership: a handle is driven by EXACTLY ONE owner — this registry OR a
// host (e.g. bombAttacks for hero shots). register(h, { owned: true }) means
// a host already steps the handle; the registry still DRAWS its zones but
// never calls h.step(). This prevents double-stepping (double physics,
// payloads firing twice).

import { stepBomb, stepBombTerrain } from './primitives/projectile.js';
import { _step } from './engineDepth.js';
import { ctx as wctx } from '../../world/context.js';
/**
 * @typedef {object} AttackHandle
 * @property {Function} [step]      per-frame driver: step(dt, targets)
 * @property {object}   [zone]      drawable zone: zone.draw(ctx)
 * @property {Array}    [handles]   nested child handles (carriers/splits)
 * @property {Function} [_ctxRefresh] optional per-frame context refresher:
 *   called as _ctxRefresh(live) before stepping with the fresh world state
 *   provided by stepAll's opts.refreshCtx (replaces Object.assign(ctx, live))
 * @property {boolean}  [_completed]
 * @property {boolean}  [_cancelled]
 */

export const AttackLifecycle = {
  /** @type {Set<AttackHandle>} live handles needing per-frame driving */
  _live: new Set(),

  /**
   * Register a handle if it needs per-frame driving (has .step or a .zone).
   * Skips completed/cancelled handles and handles with no step/zone.
   *
   * Every registered root ends up with an EXPLICIT _registryStepped flag
   * (true = registry steps it, false = a host does) — even zone-less roots
   * that skip the live set — so callers can always read ownership.
   *
   * This is the SINGLE stamp point for stepping ownership: engine.invoke()
   * registers every handle exactly once (hosts pass { owned: true } through
   * invoke's opts), and this guard makes any accidental later re-register a
   * hard no-op for ownership — the first registration wins and later calls
   * cannot flip the stepping owner.
   *
   * @param {AttackHandle} h
   * @param {{owned?: boolean}} [opts]  owned=true => a host steps this handle;
   *   the registry draws it but never steps it. (Per-frame services such as
   *   _ctxRefresh are carried ON THE HANDLE itself, not in these opts.)
   */
  register(h, opts = {}) {
    if (!h || h._completed || h._cancelled) return;
    // Guard against ownership flip-flop: re-registering a handle must never
    // change its stepping owner. The flag is set only on FIRST registration;
    // later calls are no-ops for ownership (the Set add is idempotent).
    const alreadyOwned = h._registryStepped === true || h._registryStepped === false;
    if (!needsDriving(h)) {
      // Still stamp the flag so EVERY registered root carries an explicit
      // _registryStepped (task 2.1 acceptance), even zone-less roots that
      // skip the live set.
      if (!alreadyOwned) h._registryStepped = !opts.owned;
      return;
    }
    this._live.add(h);
    // false => host owns stepping; true => the registry steps it.
    if (!alreadyOwned) h._registryStepped = !opts.owned;
  },

  /**
   * Step every live handle once; prune completed/cancelled ones.
   * Host-owned handles (_registryStepped === false) are NOT stepped here —
   * their host does that — but they are still pruned when terminal.
   *
   * Generic per-frame services for registry-stepped handles (mirrors what a
   * host such as BombAttackHost.step() does today, so the SAME code path
   * works for any future host-owned-by-registry handle):
   *  - Live ctx refresh: if the handle carries a _ctxRefresh(live) function
   *    AND opts.refreshCtx is provided, _ctxRefresh(opts.refreshCtx()) runs
   *    BEFORE stepping (replaces the host's Object.assign(ctx, live)).
   *  - Arc-recipe terrain fallback: if the handle has no .step but its
   *    entity carries an _arcRecipe, stepBombTerrain + stepBomb run instead,
   *    using data available on the handle/ctx (h.entity, h._params, and the
   *    refreshed ctx). The bombTerrainStepped guard semantics are identical
   *    to the host's: terrain steps only while ctx.bombTerrainStepped is
   *    falsy; stepBomb always follows. The context read is h._ctx ?? {} —
   *    whoever registers an arc-recipe handle must attach its AttackContext
   *    there (the same bag _ctxRefresh updates).
   * @param {number} dt
   * @param {Array} [targets] damageable entities passed to each step
   * @param {{refreshCtx?: Function}} [opts]
   *   refreshCtx: () => fresh world-state bag; called once per frame and
   *   handed to each handle's _ctxRefresh before stepping.
   */
  stepAll(dt, targets, opts = {}) {
    const live = typeof opts.refreshCtx === 'function' ? opts.refreshCtx() : null;
    _step.depth += 1; // suppress auto-registration of handles born inside a step
    try {
      for (const h of [...this._live]) {
        if (h._completed || h._cancelled) {
          this._live.delete(h);
          continue;
        }
        // Explicit check: only a handle stamped _registryStepped === true by
        // register() is stepped here. An unflagged/undefined flag can never
        // silently skip stepping — it simply isn't stepped (and every current
        // path stamps the flag explicitly at registration).
        if (h._registryStepped === true) {
          if (typeof h._ctxRefresh === 'function' && live !== null) h._ctxRefresh(live);
          if (h.step) {
            h.step(dt, targets);
          } else if (h.entity?._arcRecipe) {
            // Generic arc-recipe fallback (same sequence as the host loop):
            // terrain first (guarded), then the fuse/contact driver.
            const ctx = h._ctx ?? {};
            if (!ctx.bombTerrainStepped) stepBombTerrain(h.entity, dt, ctx.groundY, ctx.platforms);
            stepBomb(h.entity, h._params ?? {}, ctx, h);
          }
        }
        // Prune AFTER stepping: a handle may complete during its own step.
        if (h._completed || h._cancelled) this._live.delete(h);
      }
    } finally {
      _step.depth -= 1;
    }
  },

  /**
   * Draw every live handle's zones: the handle's own h.zone plus every
   * nested entry in h.handles (recursively).
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  drawAll(ctx) {
    for (const h of this._live) visitAndDraw(h, ctx);
  },

  /** Tear down everything (level transition / teardown). */
  clear() {
    // Snapshot first and empty the set BEFORE cancelling: a throwing cancel()
    // must never leave _live non-empty (the registry must be reset either way).
    const handles = [...this._live];
    this._live.clear();
    for (const h of handles) {
      try { h.cancel?.(); } catch (err) { console.warn('[AttackLifecycle] cancel threw during clear:', err); }
    }
  },

  /**
   * Full transient-world teardown — the SINGLE place "remove all entities"
   * lives. Called on every attempt boundary (death-restart, manual retry,
   * continue, zone advance): anything that is NOT authored zone content
   * (enemies/barrels/powerups/checkpoints are restored from their snapshots by
   * restoreArea instead) dies here, so no attack, projectile, fire zone,
   * particle, or effect can ever bleed into the next attempt. New transient
   * systems register themselves in world/context.js; they get cleaned up for
   * free.
   */
  clearTransientWorld() {
    // Host-owned roots (hero shots via BombAttackHost) plus carrier entities.
    wctx.bombAttacks?.clear();
    // Registry-owned roots: hero-shot fire zones, barrel payloads, enemy/boss
    // handles. cancel() cascades to nested children (carrierMacro) and kills
    // the handle's zone + hitboxes.
    this.clear();
    // Pooled transients.
    wctx.projectilePool?.reset?.();
    wctx.coins?.reset?.();
    wctx.particles?.reset?.();
    wctx.effects?.reset?.();
    if (wctx.floatTexts) for (const t of wctx.floatTexts) t.alive = false;
  },
};

/** A handle needs driving when it has a .step fn or a drawable .zone. */
function needsDriving(h) {
  return typeof h?.step === 'function' || !!h?.zone;
}

/** Recursively draw h.zone and every nested handle in h.handles. */
function visitAndDraw(h, ctx) {
  if (h._completed || h._cancelled) return;
  h.zone?.draw?.(ctx);
  for (const child of h.handles ?? []) visitAndDraw(child, ctx);
}
