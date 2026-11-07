// Attack Engine — Fire / Persistent Area primitive (Task 1.13).
//
// A damaging area that persists for a duration, ticking damage at a fixed rate
// against anything inside it. The canonical form is the ground-anchored
// horizontal strip left by a Molotov: placed at a point on the ground, it
// burns for `duration` seconds and damages per tick.
//
// SIZING IS UNIT-BASED. One fire unit is a square FIRE_UNIT px cell
// (FIRE_UNIT = 48). Callers pass `segments` (integer count of units); the
// primitive owns all pixel math. Macros never compute pixels from units —
// they pass intent, this primitive converts.
//
// SEGMENTED PHYSICS. The area is N independent 48×48 segments laid out side
// by side around the spawn center. Each segment has its OWN gravity and
// resolves support in its OWN column only: a segment over a platform or block
// sticks to it; a segment over a gap keeps falling to the lower surface; a
// destroyed support releases that segment alone. Enemies and attacks NEVER
// support fire. Damage is one hitbox per segment (a target standing in two
// segments takes ticks from each — no double-dip within one segment's tick).
// The zone completes after `duration` regardless of segment positions.

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { HazardZone } from '../../../objects/hazardZone.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../../combat/hitbox.js';
import { GRAVITY, LAYER } from '../../../consts.js';

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

// Context terrain plus live solid world objects. Never use damage targets:
// enemies and other attacks cannot hold fire up. Read anew every step so a
// destroyed/moved support releases the segments standing on it.
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

/**
 * Per-segment gravity + swept landing in the segment's OWN column.
 * A segment only considers tops that span its own 48px x-range — a segment
 * over a gap falls past a neighbor's platform; a segment over a barrel stops
 * on the barrel. Resting contact uses an FP epsilon so a settled segment does
 * not fall through its support between frames.
 */
function stepSegment(seg, dt, ctx, surfaces) {
  const bottom = seg.y + FIRE_HEIGHT;
  seg.vy += GRAVITY * dt;
  const nextBottom = bottom + seg.vy * dt;
  let landing = Infinity;
  const consider = (y) => {
    if (!Number.isFinite(y) || y < bottom - 1e-6 || y > nextBottom + 1e-6) return;
    landing = Math.min(landing, y);
  };
  consider(ctx.groundY);
  for (const s of surfaces) {
    if (seg.x < s.x + s.w && seg.x + FIRE_UNIT > s.x) consider(s.y);
  }
  if (landing < Infinity) {
    seg.y = landing - FIRE_HEIGHT;
    seg.vy = 0;
  } else {
    seg.y = nextBottom - FIRE_HEIGHT;
  }
}

/**
 * Build the N segment bodies for a fire area. Each segment is a plain object
 * (not a pool entity): fixed x column, own y/vy, own per-tick hitbox.
 * Initial placement honors carrier top-contact (surfaceY) or a shallow
 * overlap with a surface at/below the spawn center — never a teleport to a
 * surface overhead or a distant floor below.
 */
function buildSegments(p, ctx) {
  const n = Math.max(1, Math.round(Number(p.segments) || DEFAULTS.segments));
  const totalW = n * FIRE_UNIT;
  const left = p.x - totalW / 2;
  const centerY = Number.isFinite(p.surfaceY) ? p.surfaceY - FIRE_HEIGHT / 2 : p.y;
  const surfaces = fireSurfaces(ctx);
  const segs = [];
  for (let i = 0; i < n; i++) {
    const x = left + i * FIRE_UNIT;
    let y = centerY - FIRE_HEIGHT / 2;
    if (!Number.isFinite(p.surfaceY)) {
      // Shallow-overlap resolve in THIS column only: the highest top that
      // already intersects the segment box (spawn sunk into a surface).
      const tops = [ctx.groundY, ...surfaces.filter(b => x < b.x + b.w && x + FIRE_UNIT > b.x).map(b => b.y)];
      const top = Math.min(...tops.filter(yy => Number.isFinite(yy) && yy >= centerY && yy <= y + FIRE_HEIGHT));
      if (Number.isFinite(top)) y = top - FIRE_HEIGHT;
    }
    const seg = { x, y, vy: 0, w: FIRE_UNIT, h: FIRE_HEIGHT };
    segs.push(seg);
  }
  return segs;
}

/** Segment-aware drawer: glow + flicker per segment box. */
function segmentedFireDrawer(ctx, z) {
  if (!z.alive) return;
  const frac = 1 - z.t / z.duration;
  const alpha = frac < 0.2 ? frac / 0.2 : 1;
  const t = performance.now() * 0.003;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const s of z.segs) {
    const grad = ctx.createLinearGradient(s.x, s.y + FIRE_HEIGHT, s.x, s.y);
    grad.addColorStop(0, 'rgba(255,80,0,0.7)');
    grad.addColorStop(0.5, 'rgba(255,160,0,0.4)');
    grad.addColorStop(1, 'rgba(255,220,0,0.1)');
    ctx.fillStyle = grad;
    ctx.fillRect(s.x, s.y, FIRE_UNIT, FIRE_HEIGHT);
    ctx.fillStyle = 'rgba(255,120,0,0.5)';
    const cols = Math.floor(FIRE_UNIT / 12);
    for (let i = 0; i < cols; i++) {
      const fx = s.x + i * 12 + 4;
      const fh = (Math.sin(t + (s.x + i) * 0.17) * 0.5 + 0.5) * FIRE_HEIGHT * 0.7;
      ctx.fillRect(fx, s.y + FIRE_HEIGHT - fh, 6, fh);
    }
  }
  ctx.restore();
}

function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

registerPrimitive('fireArea', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Fire / Persistent Area',
    desc: 'Ground-anchored damaging area that persists for a duration, ticking damage (Molotov pattern). Width is unit-based: N × 48px segments, each with its own gravity and column support.',
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
    const segs = buildSegments(p, ctx);

    // The zone is the shared lifecycle/draw container: one clock, one
    // duration, one alive flag. Damage is per-segment (see step below).
    const zone = new HazardZone({
      x: segs[0].x, y: Math.min(...segs.map(s => s.y)),
      w: segs.length * FIRE_UNIT, h: FIRE_HEIGHT,
      duration: p.duration, tickRate: p.tickRate, damage: p.damage,
      team: p.team, color: 'rgba(255,120,30,0.35)', label: 'fire',
    });
    zone.setOwner(ctx.attacker);
    zone.drawer = segmentedFireDrawer;
    zone.segs = segs;
    // Per-segment hitboxes: each tracks its OWN segment position so damage
    // follows the fall. A single processHitboxes() call with ALL boxes means
    // the hitSet guard prevents double-dip when a target straddles a seam.
    h._segHbs = segs.map(s => makeHitbox({ owner: ctx.attacker, team: p.team, box: { x: s.x, y: s.y, w: FIRE_UNIT, h: FIRE_HEIGHT }, damage: p.damage, method: p.method }));

    const cancel = h.cancel.bind(h);
    h.cancel = () => {
      zone.alive = false;
      zone._hb.active = false;
      for (const hb of h._segHbs) hb.active = false;
      cancel();
    };
    h.zone = zone; // expose for host drawing/world integration
    h.state = { done: false, t: 0 };
    h._params = p;
    h.step = (dt, targets) => {
      if (h.state.done) return true;
      const list = targets ?? [];
      const surfaces = fireSurfaces(ctx);
      for (const s of segs) stepSegment(s, dt, ctx, surfaces);
      // Advance the zone clock manually (t/duration/alive) WITHOUT running its
      // internal damage tick — the union hitbox owns all damage. This avoids
      // the double-damage from zone.update() resetting _hb.active/box.
      zone.t += dt;
      if (zone.t >= zone.duration) {
        zone.alive = false;
        zone._hb.active = false;
      }
      // Per-segment damage: each hitbox tracks its OWN segment position so
      // damage follows the fall. ONE processHitboxes() call with ALL boxes —
      // the shared hitSet guard means a target straddling a seam is hit once,
      // not twice. Tick rate matches the unsegmented contract exactly.
      const interval = 1 / Math.max(1, p.tickRate);
      h._tickAcc = (h._tickAcc ?? 0) + dt;
      if (h._tickAcc >= interval) {
        h._tickAcc -= interval;
        // Shared hitSet across ALL segment boxes: a target straddling a seam
        // is hit ONCE per tick, not once per overlapping segment.
        const sharedHitSet = new Set();
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          h._segHbs[i].box = { x: s.x, y: s.y, w: FIRE_UNIT, h: FIRE_HEIGHT };
          h._segHbs[i].damage = p.damage;
          h._segHbs[i].hitSet = sharedHitSet;
          h._segHbs[i].active = true;
        }
        processHitboxes(h._segHbs, list, (_hb, t, dealt) => {
          h._emit('hit', { target: t, dealt });
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
