// Attack Engine — Spike / Static Hazard primitive (Task 1.14).
//
// A stationary damaging hazard that cycles between VISIBLE (active, damaging)
// and HIDDEN (inactive) phases. The same primitive covers both a one-shot
// spike trap (repeatCount 1) and a repeating spike floor (repeatCount N or -1
// for infinite until cancel/ttl).
//
// Phase timeline per cycle:
//   [warningTime warning] → [visibleTTL active/damaging] → [hiddenTTL inactive]
// Damage ticks at tickRate while visible, via the unified hitbox system.
//
// Usage pattern (host loop):
//   const h = attackEngine.invoke('spike', { x, y, ... }, ctx);
//   each frame: h.step(dt, targets) → true when finished.
// handle.state.phase is 'warning' | 'visible' | 'hidden' so VFX/theater can
// render the right state.

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../hitbox.js';

const DEFAULTS = Object.freeze({
  x: 0,               // center x (world)
  y: 0,               // center y
  size: 32,           // square collision size (px)
  warningTime: 0.4,   // pre-appearance warning (s); 0 = none
  visibleTTL: 0.8,    // how long the spike stays active (s)
  hiddenTTL: 0.6,     // how long it stays hidden before repeating (s)
  repeatCount: 1,     // cycles total; -1 = infinite
  damage: 15,         // per tick while visible
  tickRate: 10,       // damage ticks per second while visible
  ttl: null,          // optional hard cap on total lifetime (s); null = unlimited
  team: 'ally',
  method: 'melee',    // telemetry label; melee-family → blood sparkles on hit
});

/** World-space AABB for the hazard. */
export function spikeBox(p) {
  return { x: p.x - p.size / 2, y: p.y - p.size / 2, w: p.size, h: p.size };
}

/**
 * Per-frame step: advance the phase machine, tick damage while visible.
 * @returns {boolean} true when the hazard sequence finished
 */
export function stepSpike(state, p, dt, targets, h) {
  if (state.done) return true;
  state.t += dt;
  state.phaseT += dt;

  // Hard lifetime cap (infinite-repeat safety).
  if (p.ttl != null && state.t >= p.ttl) {
    state.done = true;
    state.hb.active = false;
    h._complete({ cycles: state.cycle });
    return true;
  }

  // Phase transitions.
  if (state.phase === 'warning' && state.phaseT >= p.warningTime) {
    state.phase = 'visible'; state.phaseT = 0; state.tickAcc = 0;
  } else if (state.phase === 'visible' && state.phaseT >= p.visibleTTL) {
    state.phase = 'hidden'; state.phaseT = 0;
    state.hb.active = false;
  } else if (state.phase === 'hidden' && state.phaseT >= p.hiddenTTL) {
    state.cycle++;
    if (p.repeatCount > 0 && state.cycle >= p.repeatCount) {
      state.done = true;
      h._complete({ cycles: state.cycle });
      return true;
    }
    state.phase = p.warningTime > 0 ? 'warning' : 'visible';
    state.phaseT = 0;
  }

  // Damage only while visible.
  if (state.phase === 'visible') {
    state.hb.active = true;
    state.tickAcc += dt;
    const tickInterval = 1 / Math.max(1, p.tickRate);
    while (state.tickAcc >= tickInterval) {
      state.tickAcc -= tickInterval;
      state.hb.box = spikeBox(p);
      state.hb.damage = p.damage;
      resetHitbox(state.hb);
      const hits = [];
      processHitboxes([state.hb], targets, (hb, t, dealt) => hits.push({ target: t, dealt }));
      for (const hit of hits) h._emit('hit', { target: hit.target, dealt: hit.dealt });
    }
  }

  return false;
}

registerPrimitive('spike', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Spike / Static Hazard',
    effects: [
      { type: 'hit-sparkle', desc: 'blood sparkles while damaging (melee hit juice)' },
    ],
    desc: 'Stationary hazard with warning → visible(damaging) → hidden cycle. repeatCount -1 = infinite.',
    params: [
      { key: 'x', desc: 'center x (world)' },
      { key: 'y', desc: 'center y (world)' },
      { key: 'size', desc: 'square size (px)' },
      { key: 'warningTime', desc: 'pre-appear warning (s)' },
      { key: 'visibleTTL', desc: 'active window (s)' },
      { key: 'hiddenTTL', desc: 'dormant window (s)' },
      { key: 'repeatCount', desc: 'cycles (-1 = ∞)' },
      { key: 'damage', desc: 'damage per tick' },
      { key: 'tickRate', desc: 'ticks per second while visible' },
      { key: 'ttl', desc: 'hard lifetime cap (s), null = ∞' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('spike');
    const hb = makeHitbox({ owner: ctx.attacker, team: params.team, box: null, damage: params.damage, method: params.method });
    resetHitbox(hb);
    h.state = {
      t: 0, phaseT: 0, done: false, hb,
      phase: params.warningTime > 0 ? 'warning' : 'visible',
      tickAcc: 0, cycle: 1,
    };
    h.step = (dt, targets) => stepSpike(h.state, params, dt, targets ?? [], h);
    return h;
  },
});
