// Attack Engine — Fire / Persistent Area primitive (Task 1.13).
//
// A damaging area that persists for a duration, ticking damage at a fixed rate
// against anything inside it. The canonical form is the ground-anchored
// horizontal strip left by a Molotov: placed at a point on the ground, it
// burns for `duration` seconds and damages per tick.
//
// Same shape as Beam but without direction/length math: one static AABB.
// The Effect Engine renders the persistent visual; this primitive owns the
// hitbox + lifetime.

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../hitbox.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read lazily at construction so synchronous fires inside
// impl() see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  x: 0,               // center x of the area (world coords)
  y: 0,               // center y
  width: 96,           // horizontal coverage (px)
  duration: 3,        // seconds the area stays active
  tickRate: 5,        // damage ticks per second
  damage: 8,          // damage per tick
  team: 'ally',       // ally | foe | neutral
  method: 'fire',     // telemetry label
  style: null,        // Effect Engine style override
});

/** Fixed vertical extent of a fire area (px). */
export const FIRE_HEIGHT = 48;

/** World-space AABB for the area. */
export function fireAreaBox(p) {
  return { x: p.x - p.width / 2, y: p.y - FIRE_HEIGHT / 2, w: p.width, h: FIRE_HEIGHT };
}

/**
 * Per-frame step: advance clock, run the hitbox at tick rate.
 * @returns {boolean} true when the area burned out
 */
export function stepFireArea(state, p, dt, targets, h) {
  if (state.done) return true;
  state.t += dt;
  state.tickAcc += dt;

  const tickInterval = 1 / Math.max(1, p.tickRate);
  while (state.tickAcc >= tickInterval) {
    state.tickAcc -= tickInterval;
    state.hb.box = fireAreaBox(p);
    state.hb.damage = p.damage;
    resetHitbox(state.hb); // fresh tick → re-hit allowed each tick
    const hits = [];
    processHitboxes([state.hb], targets, (hb, t, dealt) => hits.push({ target: t, dealt }));
    for (const hit of hits) h._emit('hit', { target: hit.target, dealt: hit.dealt });
  }

  if (state.t >= p.duration) {
    state.done = true;
    state.hb.active = false;
    h._complete({ ticks: Math.round(state.t * p.tickRate) });
    return true;
  }
  return false;
}

registerPrimitive('fireArea', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Fire / Persistent Area',
    desc: 'Ground-anchored damaging area that persists for a duration, ticking damage (Molotov pattern).',
    params: [
      { key: 'x', desc: 'center x (world)' },
      { key: 'y', desc: 'center y (world)' },
      { key: 'width', desc: 'horizontal coverage (px); height fixed at 48' },
      { key: 'duration', desc: 'seconds active' },
      { key: 'tickRate', desc: 'damage ticks per second' },
      { key: 'damage', desc: 'damage per tick' },
      { key: 'team', desc: 'ally | foe | neutral' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('fireArea', null, declaredEffectsOf('fireArea'));
    const hb = makeHitbox({ owner: ctx.attacker, team: params.team, box: null, damage: params.damage, method: params.method });
    resetHitbox(hb);
    h.state = { t: 0, tickAcc: 0, done: false, hb };
    h._params = params;
    h.step = (dt, targets) => stepFireArea(h.state, params, dt, targets ?? [], h);
    return h;
  },
});
