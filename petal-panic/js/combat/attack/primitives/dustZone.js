// Attack Engine — Dust Cloud Zone primitive.
//
// A persistent damaging area rendered as a continuous toxic dust cloud.
// Enemies inside the zone take ticking damage for the cloud's duration.
// Delegates zone lifecycle to a HazardZone object; adds continuous visual
// puff spawns across the full w×h rectangle.

import { registerPrimitive, getPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { HazardZone } from '../../../objects/hazardZone.js';
import { fireManual } from '../../../effects/index.js';

function declaredEffectsOf(id) {
  const def = getPrimitive(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  x: 0,               // center x of the zone (world coords)
  y: 0,               // center y
  width: 120,         // horizontal extent (px)
  height: 64,         // vertical extent (px)
  duration: 3,        // seconds the cloud persists
  tickRate: 5,        // damage ticks per second
  damage: 6,          // damage per tick
  team: 'ally',       // ally | foe | neutral
  method: 'poison',   // telemetry label
  palette: 'hazard',  // dust-cloud palette name
  puffInterval: 0.12, // s between visual puff spawns
  puffsPerSpawn: 4,   // particles per puff spawn
});

/** World-space AABB for the zone (center-based → top-left). */
export function dustZoneBox(p) {
  return { x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height };
}

registerPrimitive('dustZone', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Dust Cloud Zone',
    desc: 'Persistent toxic dust cloud that damages enemies inside it. Continuous visual coverage via repeated puff spawns.',
    effects: [
      { type: 'dust-cloud', desc: 'toxic cloud visual (repeated spawns across the zone)' },
    ],
    params: [
      { key: 'x', desc: 'center x (world)' },
      { key: 'y', desc: 'center y (world)' },
      { key: 'width', desc: 'horizontal extent (px)' },
      { key: 'height', desc: 'vertical extent (px)' },
      { key: 'duration', desc: 'seconds active' },
      { key: 'tickRate', desc: 'damage ticks per second' },
      { key: 'damage', desc: 'damage per tick' },
      { key: 'team', desc: 'ally | foe | neutral' },
      { key: 'palette', desc: 'dust palette: dust | hazard' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('dustZone', null, declaredEffectsOf('dustZone'));
    const box = dustZoneBox(p);
    const zone = new HazardZone({
      x: box.x, y: box.y, w: box.w, h: box.h,
      duration: p.duration, tickRate: p.tickRate, damage: p.damage,
      team: p.team, color: 'rgba(57,255,20,0.15)', label: 'dust',
    });
    zone.setOwner(ctx.attacker);
    h.zone = zone;
    h.state = { done: false, t: 0, puffAcc: 0 };
    h._params = p;

    h.step = (dt, targets) => {
      if (h.state.done) return true;
      const hits = zone.update(dt, targets ?? []);
      for (const hit of hits) h._emit('hit', { target: hit.target, dealt: hit.dealt });

      // Visual: spawn small dust puffs at random points within the zone.
      h.state.puffAcc += dt;
      const puffInterval = Math.max(0.02, p.puffInterval);
      while (h.state.puffAcc >= puffInterval && zone.alive) {
        h.state.puffAcc -= puffInterval;
        const px = zone.x + Math.random() * zone.w;
        const py = zone.y + Math.random() * zone.h;
        fireManual({
          type: 'dust-cloud',
          params: {
            x: px, y: py,
            particleCount: p.puffsPerSpawn,
            spread: zone.w * 0.15,
            height: zone.h * 0.15,
            size: 6,
            velocity: 20,
            lifetime: 0.7,
            opacity: 0.6,
            palette: p.palette,
          },
        });
      }

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
