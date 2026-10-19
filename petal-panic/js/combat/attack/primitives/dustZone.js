// Attack Engine — Dust Cloud Zone primitive.
//
// A persistent damaging area rendered as a continuous toxic dust cloud.
// Enemies inside the zone take ticking damage for the cloud's duration.
// The visual is NOT one burst — it re-spawns small dust puffs across the
// full w×h rectangle every few frames so the zone stays visually "alive"
// and fully covered for its whole lifetime.
//
// Same shape as fireArea (static AABB + tick clock) but:
//   - Height is a param (fireArea is fixed 48px)
//   - Visual = repeated dust-cloud spawns (palette: hazard by default)
//   - Reads as "toxic gas / poison fog" rather than fire strip

import { registerPrimitive } from '../registry.js';
import { getPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../hitbox.js';
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
  puffInterval: 0.12, // s between visual puff spawns (coverage cadence)
  puffsPerSpawn: 4,   // particles per puff spawn
});

/** World-space AABB for the zone. */
export function dustZoneBox(p) {
  return { x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height };
}

/**
 * Per-frame step: advance clock, run hitbox at tick rate, spawn visual puffs.
 * @returns {boolean} true when the cloud dissipated
 */
export function stepDustZone(state, p, dt, targets, h) {
  if (state.done) return true;
  state.t += dt;
  state.tickAcc += dt;
  state.puffAcc += dt;

  // Damage ticks.
  const tickInterval = 1 / Math.max(1, p.tickRate);
  while (state.tickAcc >= tickInterval) {
    state.tickAcc -= tickInterval;
    state.hb.box = dustZoneBox(p);
    state.hb.damage = p.damage;
    resetHitbox(state.hb);
    const hits = [];
    processHitboxes([state.hb], targets, (hb, t, dealt) => hits.push({ target: t, dealt }));
    for (const hit of hits) h._emit('hit', { target: hit.target, dealt: hit.dealt });
  }

  // Visual: spawn small dust puffs at random points within the zone so the
  // cloud looks continuously filled, not a single burst.
  const puffInterval = Math.max(0.02, p.puffInterval);
  while (state.puffAcc >= puffInterval) {
    state.puffAcc -= puffInterval;
    const box = dustZoneBox(p);
    const px = box.x + Math.random() * box.w;
    const py = box.y + Math.random() * box.h;
    fireManual({
      type: 'dust-cloud',
      params: {
        x: px, y: py,
        particleCount: p.puffsPerSpawn,
        spread: box.w * 0.15,
        height: box.h * 0.15,
        size: 6,
        velocity: 20,
        lifetime: 0.7,
        opacity: 0.6,
        palette: p.palette,
      },
    });
  }

  if (state.t >= p.duration) {
    state.done = true;
    state.hb.active = false;
    h._complete({ ticks: Math.round(state.t * p.tickRate) });
    return true;
  }
  return false;
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
    const hb = makeHitbox({ owner: ctx.attacker, team: p.team, box: null, damage: p.damage, method: p.method });
    resetHitbox(hb);
    h.state = { t: 0, tickAcc: 0, puffAcc: 0, done: false, hb };
    h._params = p;
    h.step = (dt, targets) => stepDustZone(h.state, p, dt, targets ?? [], h);
    return h;
  },
});
