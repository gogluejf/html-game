// Attack Engine — Beam primitive (Task 1.9).
//
// A continuous damaging line/ray for a duration. The Effect Engine renders the
// visual (registered 'beam' effect); this primitive owns the damaging AABB and
// its lifetime. Placement/motion is macro-level (horizontal, targeted,
// sweeping macros re-aim or move the beam by updating state each frame).
//
// Usage pattern (host loop):
//   const h = attackEngine.invoke('beam', { direction: 0, length: 300, ... }, ctx);
//   each frame while live: h.step(dt, targets) → true when finished.
// Damage ticks at `tickRate` Hz per target (a target standing in the beam
// takes damage every tick, not every frame).

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { resolveMarker } from '../context.js';
import { fireDeclared } from '../../../effects/index.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../hitbox.js';
import { VIEW_W, VIEW_H } from '../../../core/view.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read lazily at construction so synchronous fires inside
// impl() see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  origin: null,        // marker label | {x,y} | null → attacker facing edge
  direction: 0,        // radians; beam axis
  length: 240,         // reach along the axis (px)
  width: 24,           // damaging thickness (px)
  duration: 1,         // seconds active
  damage: 20,          // per tick
  tickRate: 8,         // damage ticks per second while overlapping
  team: 'ally',        // ally | foe | neutral (existing team routing)
  method: 'beam',      // telemetry label
  style: null,         // Effect Engine beam params override (color, opacity...)
  announceMarker: true,  // surface-target-marker telegraph before ignition (default ON)
  announceDelay: 1.0,    // s the marker stays visible before the beam ignites
});

// Announcement tuning — hardcoded on purpose (one consistent feel across all
// beams, same logic as telegraphCircle's baked-in gap phase):
const ANNOUNCE_GAP = 0.12;   // s of silence between marker death and ignition
const ANNOUNCE_OFFSET_FRAC = 0.05; // marker sits this fraction of screen in from the exit point

/**
 * Resolve the beam's start point (world space) for the current aim. Same
 * origin rules as beamBox: explicit {x,y} → marker label → attacker facing
 * edge (gun tip).
 * @param {object} p params
 * @param {object} ctx AttackContext
 * @returns {{x:number, y:number}}
 */
export function beamOrigin(p, ctx) {
  const a = ctx.attacker;
  if (p.origin && typeof p.origin === 'object' && 'x' in p.origin) {
    return { x: p.origin.x, y: p.origin.y };
  }
  if (typeof p.origin === 'string') {
    const m = resolveMarker(ctx, p.origin);
    if (m) return { x: (a?.x ?? 0) + m.x, y: (a?.y ?? 0) + m.y };
    return { x: (a?.x ?? 0) + (a?.w ?? 0) / 2, y: (a?.y ?? 0) + (a?.h ?? 0) / 2 };
  }
  // Default: offset to the facing edge (gun tip), not body center.
  const ang = p.direction;
  const cos0 = Math.cos(ang), sin0 = Math.sin(ang);
  const hw = (a?.w ?? 0) / 2, hh = (a?.h ?? 0) / 2;
  const dx = Math.abs(cos0) * hw + Math.abs(sin0) * hh;
  return {
    x: (a?.x ?? 0) + hw + cos0 * dx,
    y: (a?.y ?? 0) + hh + sin0 * dx,
  };
}

/**
 * Compute the beam's world-space AABB for the current aim.
 * @param {object} p params
 * @param {object} ctx AttackContext
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function beamBox(p, ctx) {
  const { x: cx, y: cy } = beamOrigin(p, ctx);
  const ang = p.direction;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  // Axis-aligned bounding box of the rotated beam segment (conservative:
  // full extent so nothing inside the visual is ever missed).
  const ex = cx + cos * p.length, ey = cy + sin * p.length;
  const x = Math.min(cx, ex) - p.width / 2;
  const y = Math.min(cy, ey) - p.width / 2;
  return { x, y, w: Math.abs(ex - cx) + p.width, h: Math.abs(ey - cy) + p.width };
}

/**
 * Fire the beam VFX via the Effect Engine (no-op when effects absent).
 * The effect's lifetime is DERIVED from flashInTime + holdTime + fadeOutTime.
 * By default we map the primitive's `duration` to the effect's `holdTime`
 * (the full-power shimmer phase) and use fixed tuned values for flash-in and
 * fade-out so the visual always looks good regardless of duration. A caller may
 * override ANY of the three phase times via `style` (e.g. the sweepingBeam
 * macro aligns them to its own choreography); style values win over the
 * derived defaults.
 */
export function fireBeamEffect(p, ctx) {
  const { x: ox, y: oy } = beamOrigin(p, ctx);
  const style = p.style ?? {};
  try {
    // 'beam' is declared in this primitive's meta.effects; the guard accepts it.
    return fireDeclared({ type: 'beam', params: {
      x: ox, y: oy,
      orientation: p.direction,
      length: p.length, width: p.width,
      // Derived defaults first, then spread style so explicit overrides win.
      flashInTime: 0.04,
      holdTime: Math.max(0, p.duration - 0.6),
      fadeOutTime: 0.6,
      ...style,
    } }, ['beam']); // standalone helper: no handle in scope; 'beam' is this primitive's declared type
  } catch {
    return null;
  }
}

/**
 * Compute where the announcement marker sits: at the beam's EXIT point
 * (where it leaves the screen, or its tip if shorter than the screen),
 * pulled back toward the origin by a fixed fraction of the screen so it is
 * always visible and never clipped at the border.
 * @param {object} p merged params
 * @param {object} ctx AttackContext
 * @returns {{x:number, y:number}} world-space marker center
 */
/**
 * Compute where the announcement marker sits: ALWAYS at the screen BOUNDARY
 * the beam line exits (pulled back a fixed fraction of the screen so it is
 * never clipped at the border) — regardless of where the beam originates.
 * A short beam that ends mid-screen still announces at the boundary: the
 * warning is about the LINE crossing the screen, not the beam's tip.
 * @param {object} p merged params
 * @param {object} ctx AttackContext
 * @returns {{x:number, y:number}} world-space marker center
 */
export function announceMarkerPoint(p, ctx) {
  const o = beamOrigin(p, ctx);
  const cam = ctx.camera ?? null;
  const viewX = cam?.x ?? 0;
  const viewY = cam?.y ?? 0;
  const cos = Math.cos(p.direction), sin = Math.sin(p.direction);
  // Distance along the axis to the first screen edge hit (boundary only —
  // the beam length does NOT cap this).
  let t = Infinity;
  if (cos > EPS_T) t = Math.min(t, (viewX + VIEW_W - o.x) / cos);
  else if (cos < -EPS_T) t = Math.min(t, (viewX - o.x) / cos);
  if (sin > EPS_T) t = Math.min(t, (viewY + VIEW_H - o.y) / sin);
  else if (sin < -EPS_T) t = Math.min(t, (viewY - o.y) / sin);
  if (!Number.isFinite(t)) t = p.length; // degenerate: origin outside every edge half-plane
  // Pull back from the boundary toward the origin (fixed offset).
  const pullback = ANNOUNCE_OFFSET_FRAC * (Math.abs(cos) >= Math.abs(sin) ? VIEW_W : VIEW_H);
  t = Math.max(0, t - pullback);
  return { x: o.x + cos * t, y: o.y + sin * t };
}
const EPS_T = 1e-6;

/**
 * Fire the announcement telegraph (surface-target-marker) for an announced
 * beam. The marker is painted ON the beam line near its exit point (angle =
 * beam direction) and stays visible for `announceDelay` seconds. Returns the
 * effect instance (null when effects are absent or not announcing).
 * @param {object} p merged params
 * @param {object} ctx AttackContext
 * @param {Array<string>} declared declared effect types (handle scope)
 * @returns {object|null}
 */
export function fireAnnounceMarker(p, ctx, declared) {
  if (!p.announceMarker) return null;
  const pt = announceMarkerPoint(p, ctx);
  try {
    return fireDeclared({ type: 'surface-target-marker', params: {
      x: pt.x, y: pt.y,
      // The marker squashes along the SURFACE NORMAL — so to squash ALONG the
      // beam axis (tall narrow ellipse stretched with the laser), pass the
      // normal of the beam direction, not the direction itself.
      angle: p.direction + Math.PI / 2,
      spinRate: 0, // LOCKED ticks — must read as painted along the beam line
      duration: Math.max(0, p.announceDelay),
      color: p.style?.color,
    } }, declared);
  } catch {
    return null;
  }
}

/**
 * Per-frame step: advance the clock, run the damaging hitbox against targets
 * at the configured tick rate. Returns true when the beam ended.
 *
 * @param {object} state internal state bag
 * @param {object} p     merged params
 * @param {object} ctx   AttackContext
 * @param {number} dt    frame delta (s)
 * @param {Array<object>} targets candidate entities
 * @param {AttackHandle} h handle to emit on
 */
export function stepBeam(state, p, ctx, dt, targets, h) {
  if (state.done) return true;
  state.t += dt;

  // Announcement window: the marker is already visible (fired at invoke time);
  // the beam itself — VFX and damage — stays OFF until announceDelay + the
  // fixed silence gap have elapsed. `state.active` flips once when the gap
  // ends and fires the beam VFX at that moment.
  const preDelay = p.announceMarker ? Math.max(0, p.announceDelay) + ANNOUNCE_GAP : 0;
  if (p.announceMarker && !state.active) {
    if (state.t < preDelay) return false;
    state.active = true;
    state.hb.active = true;
    state._fx = fireBeamEffect(p, ctx);
  } else if (!p.announceMarker) {
    state.active = true;
  }

  state.tickAcc += dt;

  const tickInterval = 1 / Math.max(1, p.tickRate);
  let hitsThisTick = 0;
  while (state.tickAcc >= tickInterval) {
    state.tickAcc -= tickInterval;
    // A host (e.g. the sweepingBeam macro) may overwrite the box each frame
    // to move the beam. When `_swept` is set, trust the existing box instead
    // of recomputing the static one.
    if (!state._swept) state.hb.box = beamBox(p, ctx);
    state.hb.damage = p.damage;
    // Fresh tick → same target can be hit again next tick. NOTE: resetHitbox
    // also re-asserts active=true, so for announced beams we restore the
    // pre-ignition inert state afterwards (the box is null then anyway).
    const wasActive = state.hb.active;
    resetHitbox(state.hb);
    if (!state.active) state.hb.active = wasActive; // keep inert pre-ignition
    const hits = [];
    processHitboxes([state.hb], targets, (hb, t, dealt) => hits.push({ target: t, dealt }));
    for (const hit of hits) h._emit('hit', { target: hit.target, dealt: hit.dealt });
    hitsThisTick = hits.length;
  }

  if (state.t >= p.duration) {
    state.done = true;
    state.hb.active = false;
    h._complete({ ticks: Math.round(Math.max(0, state.t - preDelay) * p.tickRate) });
    return true;
  }
  void hitsThisTick;
  return false;
}

registerPrimitive('beam', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Beam',
    effects: [
      { type: 'beam', desc: 'the beam body itself (Effect Engine renders it)' },
      { type: 'surface-target-marker', desc: 'optional pre-ignition telegraph at the beam exit point (announceMarker)' },
    ],
    desc: 'Continuous damaging line for a duration. Announces itself via a surface-marker telegraph at the beam exit point before ignition (announceMarker, default on). Effect Engine renders; primitive owns the AABB + tick-rate damage.',
    params: [
      { key: 'origin', desc: "marker label | {x,y} | null → attacker facing edge" },
      { key: 'direction', desc: 'radians (beam axis)' },
      { key: 'length', desc: 'reach (px)' },
      { key: 'width', desc: 'damaging thickness (px)' },
      { key: 'duration', desc: 'seconds active' },
      { key: 'damage', desc: 'damage per tick' },
      { key: 'tickRate', desc: 'damage ticks per second' },
      { key: 'team', desc: 'ally | foe | neutral' },
      { key: 'announceMarker', desc: 'bool (default true) — fire a surface-target-marker telegraph at the beam exit point before ignition' },
      { key: 'announceDelay', desc: 's the announcement marker stays visible (default 1.0)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('beam', null, declaredEffectsOf('beam'));
    const hb = makeHitbox({ owner: ctx.attacker, team: params.team, box: null, damage: params.damage, method: params.method });
    resetHitbox(hb);
    // Announced beams: the hitbox stays INERT until stepBeam flips it active
    // after announceDelay + the silence gap (processHitboxes skips !active).
    if (params.announceMarker) hb.active = false;
    h.state = { t: 0, tickAcc: 0, done: false, active: !params.announceMarker, hb };
    // Announced beams: the marker fires NOW (visible for announceDelay), the
    // beam VFX + damage wait until stepBeam flips state.active after the gap.
    if (params.announceMarker) {
      h.state._fx = fireAnnounceMarker(params, ctx, h.declaredEffectTypes());
    } else {
      h.state._fx = fireBeamEffect(params, ctx);
    }
    h.step = (dt, targets) => stepBeam(h.state, params, ctx, dt, targets ?? [], h);
    return h;
  },
});
