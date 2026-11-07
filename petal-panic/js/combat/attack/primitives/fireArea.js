// Attack Engine — Fire / Persistent Area primitive (Task 1.13).
//
// A damaging area that persists for a duration, ticking damage at a fixed rate
// against anything inside it. The canonical form is the ground-anchored
// horizontal strip left by a Molotov: placed at a point on the ground, it
// burns for `duration` seconds and damages per tick.
//
// SIZING IS UNIT-BASED. One fire unit is a square FIRE_UNIT px cell
// (FIRE_UNIT = 48). Callers pass `segments` (integer count of units); the
// primitive owns all pixel math (width = segments * FIRE_UNIT, height = one
// unit). Macros never compute pixels from units — they pass intent, this
// primitive converts. Future segmentation physics (per-unit gravity) will
// build directly on this contract.
//
// Delegates to a HazardZone object for the actual zone lifecycle + rendering.
// The attack handle wraps the zone so the theater/gameplay can step it
// uniformly with other attacks.

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { HazardZone } from '../../../objects/hazardZone.js';
import { fireZoneDrawer } from '../drawers/index.js';
import { GRAVITY, LAYER } from '../../../consts.js';

// Context terrain plus live solid world objects. Never use damage targets:
// enemies and other attacks cannot hold fire up. Read anew every step so a
// destroyed/moved support releases the entire (still unsegmented) rectangle.
function fireSurfaces(ctx) {
  const surfaces = [];
  const entities = ctx.collisionWorld?.entities;
  const live = (e) => e && e.alive !== false && !e.destroyed;
  const terrain = (e) => e.layer == null || e.layer === LAYER.SOLID || e.layer === LAYER.PLATFORM;
  for (const s of [...(ctx.platforms ?? []), ...(ctx.solids ?? [])]) {
    if (!live(s) || !terrain(s)) continue;
    const owner = s.owner;
    if (owner && (!live(owner) || !terrain(owner) || (entities && !entities.has(owner)))) continue;
    surfaces.push(owner?.worldBox?.() ?? s.worldBox?.() ?? s);
  }
  for (const e of entities ?? []) {
    if (!live(e)) continue;
    if (e.layer !== LAYER.SOLID && e.layer !== LAYER.PLATFORM) continue;
    surfaces.push(e.worldBox?.() ?? e);
  }
  return surfaces;
}

function stepFire(zone, dt, ctx) {
  const bottom = zone.y + zone.h;
  zone.vy += GRAVITY * dt;
  const nextBottom = bottom + zone.vy * dt;
  let landing = Infinity;
  const consider = (y) => {
    if (Number.isFinite(y) && y >= bottom && y <= nextBottom) landing = Math.min(landing, y);
  };
  consider(ctx.groundY);
  for (const s of fireSurfaces(ctx)) {
    if (zone.x < s.x + s.w && zone.x + zone.w > s.x) consider(s.y);
  }
  zone.y = (landing < Infinity ? landing : nextBottom) - zone.h;
  if (landing < Infinity) zone.vy = 0;
  // Keep debug/damage geometry in lockstep even between damage ticks.
  zone._hb.box = { x: zone.x, y: zone.y, w: zone.w, h: zone.h };
}

function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

/** One fire unit in world pixels — the square cell size (width AND height). */
export const FIRE_UNIT = 48;

const DEFAULTS = Object.freeze({
  x: 0,               // center x of the area (world coords)
  y: 0,               // center y
  segments: 2,        // number of 48px units wide (integer)
  duration: 2,        // seconds the area stays active
  tickRate: 5,        // damage ticks per second
  damage: 8,          // damage per tick
  team: 'ally',       // ally | foe | neutral
  method: 'fire',     // telemetry label
});

/** Fixed vertical extent of a fire area (px): always exactly one unit. */
export const FIRE_HEIGHT = FIRE_UNIT;

/** Resolve the width in px from the unit-based param surface. */
export function fireWidthPx(p) {
  const segs = Math.max(1, Math.round(Number(p.segments) || DEFAULTS.segments));
  return segs * FIRE_UNIT;
}

/** World-space AABB for the area (center-based → top-left). */
export function fireAreaBox(p) {
  const w = fireWidthPx(p);
  return { x: p.x - w / 2, y: p.y - FIRE_HEIGHT / 2, w, h: FIRE_HEIGHT };
}

registerPrimitive('fireArea', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Fire / Persistent Area',
    desc: 'Ground-anchored damaging area that persists for a duration, ticking damage (Molotov pattern). Width is unit-based: N × 48px squares.',
    effects: [
      { type: 'dust-cloud', desc: 'fire particles at the zone (optional visual)' },
    ],
    params: [
      { key: 'x', desc: 'center x (world)' },
      { key: 'y', desc: 'center y (world)' },
      { key: 'segments', desc: 'number of 48px fire units wide (integer, default 2); height is always 1 unit' },
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
    zone.vy = 0;
    // An actual carrier top-contact is placement data, not macro physics.
    if (Number.isFinite(p.surfaceY)) zone.y = p.surfaceY - zone.h;
    else {
      // Resolve initial shallow overlap only at/below the spawn center.
      // Never teleport to a surface overhead (or a distant floor below).
      const tops = fireSurfaces(ctx).filter(b => zone.x < b.x + b.w && zone.x + zone.w > b.x).map(b => b.y);
      tops.push(ctx.groundY);
      const top = Math.min(...tops.filter(y => Number.isFinite(y) && y >= p.y && y <= zone.y + zone.h));
      if (Number.isFinite(top)) zone.y = top - zone.h;
    }
    zone._hb.box = { x: zone.x, y: zone.y, w: zone.w, h: zone.h };
    zone.setOwner(ctx.attacker);
    zone.drawer = fireZoneDrawer;
    const cancel = h.cancel.bind(h);
    h.cancel = () => { zone.alive = false; zone._hb.active = false; cancel(); };
    h.zone = zone; // expose for host drawing/world integration
    h.state = { done: false, t: 0 };
    h._params = p;
    h.step = (dt, targets) => {
      if (h.state.done) return true;
      stepFire(zone, dt, ctx);
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
