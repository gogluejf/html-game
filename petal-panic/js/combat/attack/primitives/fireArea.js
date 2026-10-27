// Attack Engine — Fire / Persistent Area primitive (Task 1.13).
//
// A damaging area that persists for a duration, ticking damage at a fixed rate
// against anything inside it. The canonical form is the ground-anchored
// horizontal strip left by a Molotov: placed at a point on the ground, it
// burns for `duration` seconds and damages per tick.
//
// Delegates to a HazardZone object for the actual zone lifecycle + rendering.
// The attack handle wraps the zone so the theater/gameplay can step it
// uniformly with other attacks.

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { HazardZone } from '../../../objects/hazardZone.js';
import { fireZoneDrawer } from '../drawers/index.js';

function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  x: 0,               // center x of the area (world coords)
  y: 0,               // center y
  width: 96,           // horizontal coverage (px)
  duration: 2,        // seconds the area stays active
  tickRate: 5,        // damage ticks per second
  damage: 8,          // damage per tick
  team: 'ally',       // ally | foe | neutral
  method: 'fire',     // telemetry label
});

/** Fixed vertical extent of a fire area (px). */
export const FIRE_HEIGHT = 48;

/** World-space AABB for the area (center-based → top-left). */
export function fireAreaBox(p) {
  return { x: p.x - p.width / 2, y: p.y - FIRE_HEIGHT / 2, w: p.width, h: FIRE_HEIGHT };
}

registerPrimitive('fireArea', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Fire / Persistent Area',
    desc: 'Ground-anchored damaging area that persists for a duration, ticking damage (Molotov pattern).',
    effects: [
      { type: 'dust-cloud', desc: 'fire particles at the zone (optional visual)' },
    ],
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
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('fireArea', null, declaredEffectsOf('fireArea'));
    const box = fireAreaBox(p);
    const zone = new HazardZone({
      x: box.x, y: box.y, w: box.w, h: box.h,
      duration: p.duration, tickRate: p.tickRate, damage: p.damage,
      team: p.team, color: 'rgba(255,120,30,0.35)', label: 'fire',
    });
    zone.setOwner(ctx.attacker);
    zone.drawer = fireZoneDrawer;
    const cancel = h.cancel.bind(h);
    h.cancel = () => { zone.alive = false; zone._hb.active = false; cancel(); };
    h.zone = zone; // expose for host drawing/world integration
    h.state = { done: false, t: 0 };
    h._params = p;
    h.step = (dt, targets) => {
      if (h.state.done) return true;
      const hits = zone.update(dt, targets ?? []);
      for (const hit of hits) h._emit('hit', { target: hit.target, dealt: hit.dealt });
      if (!zone.alive) {
        h.state.done = true;
        h._complete({ ticks: Math.round(zone.t * p.tickRate) });
        return true;
      }
      h.state.t = zone.t;
      return false;
    };
    return h;
  },
});
