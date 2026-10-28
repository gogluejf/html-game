// Gameplay ownership for attack roots; children remain owned by their macros.
import { invoke } from './engine.js';
import { makeContext } from './context.js';
import { stepBomb, stepBombTerrain } from './primitives/ballistic.js';
import './primitives/explosion.js';
import './macros/index.js';

export class BombAttackHost {
  constructor(getContext) {
    this.getContext = getContext;
    this.roots = new Set();
  }
  spawn(id, params, attacker) {
    const ctx = makeContext(attacker, this.getContext());
    const h = invoke(id, params, ctx);
    if (!h._completed) this.roots.add({ h, ctx });
    return h;
  }
  step(dt) {
    const live = this.getContext();
    for (const entry of this.roots) {
      const { h, ctx } = entry;
      Object.assign(ctx, live);
      if (h.step) h.step(dt, live.world?.targets ?? []);
      else if (h.entity?._attackId === 'ballistic') {
        if (!ctx.bombTerrainStepped) stepBombTerrain(h.entity, dt, ctx.groundY, ctx.platforms);
        stepBomb(h.entity, h._params ?? {}, ctx, h);
      }
      if (h._completed || h._cancelled) this.roots.delete(entry);
    }
  }
  draw(canvas) {
    const visit = (h) => {
      if (h._completed || h._cancelled) return;
      h.zone?.draw(canvas);
      for (const child of h.handles ?? []) visit(child);
    };
    for (const { h } of this.roots) visit(h);
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
