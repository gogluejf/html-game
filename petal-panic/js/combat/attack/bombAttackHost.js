// Bomb-family attack spawn facade (task 3.2 part B1).
//
// Contract: the SINGLE lifecycle owner is AttackLifecycle (lifecycle.js).
// This class does NOT step or draw anything — it only builds rich contexts
// for bomb-family hero shots and tears them down on level transition.
//
// - spawn(): builds the ctx via makeContext() and calls invoke() WITHOUT
//   { owned: true }, so hero-shot roots are REGISTRY-owned:
//   AttackLifecycle.stepAll() steps them (with opts.refreshCtx driving
//   h._ctxRefresh(live) each frame) and drawAll() draws their zones. The
//   handle carries _ctx (the same bag _ctxRefresh mutates in place) so the
//   registry's arc-recipe terrain fallback can read groundY/platforms/
//   bombTerrainStepped from it.
// - clear(): cancels every root recursively and kills carrier entities;
//   never steps or draws.
import { invoke } from './engine.js';
import { makeContext } from './context.js';
import './primitives/explosion.js';
import './macros/index.js';

export class BombAttackHost {
  constructor(getContext) {
    this.getContext = getContext;
    // Pure bookkeeping for clear(): {h, ctx} entries for live roots.
    this.roots = new Set();
  }
  spawn(id, params, attacker) {
    const ctx = makeContext(attacker, this.getContext());
    // Registry-owned root: no { owned: true }. engine.invoke() registers the
    // handle with _registryStepped=true, so AttackLifecycle owns step/draw/
    // prune. We attach per-frame services ON THE HANDLE:
    //   _ctx         — the AttackContext bag the registry reads for the
    //                  arc-recipe terrain fallback (groundY, platforms,
    //                  bombTerrainStepped);
    //   _ctxRefresh  — merges a fresh world-state bag into that same ctx
    //                  each frame (stepAll's opts.refreshCtx supplies it).
    const h = invoke(id, params, ctx);
    if (!h._completed && !h._cancelled) {
      h._ctx = ctx;
      h._ctxRefresh = (live) => Object.assign(ctx, live);
      this.roots.add({ h, ctx });
    }
    return h;
  }
  clear() {
    const stop = (h) => {
      for (const child of h.handles ?? []) stop(child);
      if (h.inner) stop(h.inner);
      if (h.entity?._attackHandle === h && !h._completed) {
        h.entity.alive = false;
        h.entity._attackDone = true;
      }
      h.cancel();
    };
    for (const { h } of this.roots) {
      stop(h);
      if (h.entity?._attackHandle === h) {
        h.entity.alive = false;
        h.entity._attackDone = true;
      }
    }
    this.roots.clear();
  }
}
