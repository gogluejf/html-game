// Attack Engine — Surface Strike primitive.
//
// A damaging STRIKE across ALL supporting surfaces under a horizontal span:
// the ground-slam damage shape ("the floor is hot for a moment — JUMP"). One
// invoke = one x-span; EVERY surface with a top inside that span (floor,
// platforms, blocks) gets its own hot band segment at its own top line. The
// dodge verb is the same everywhere: jump over it, or never be on those
// surfaces during the window.
//
// This is the impact-event twin of spike (same idea — bands hot for a window —
// but WITHOUT spike's trap semantics: no warning/hidden/repeat cycle; the
// CALLER owns the telegraph, e.g. stomp's hop or skyDiveStomp's marker).
//
// Surface scan: the floor (ctx.groundY) plus every platform/solid whose top y
// lies within [refY - reach, refY + reach] AND whose span overlaps the band
// x-range. Each match contributes one segment clamped to the overlap of the
// band span and the surface span. No surface under the span → no-surface
// complete (nothing to burn).
//
// Damage: each live target overlapping ANY segment takes `damage` ONCE during
// the whole window (shared hitSet via the unified hitbox system — takeDamage
// pipeline + team routing). No ticks, no repeat — one slam, one number.
//
// Presentation: the primitive fires ONE 'ground-strike' effect per segment so
// every host sees the slam-in band exactly where the damage is (same pattern
// as surfaceWave firing 'ground-wave').
//
// Usage pattern (host loop):
//   const h = attackEngine.invoke('surfaceStrike', { x, y, width }, ctx);
//   each frame: h.step(dt, targets) → true when the window closed.

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { fireDeclared } from '../../../effects/index.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../hitbox.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel renders).
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  x: 0,               // center x (world) — usually the stomp impact point
  y: 0,               // reference y (world) — the surface line the strike is aimed at
  width: Infinity,    // horizontal extent of the strike span (px); Infinity = EVERY surface's full extent
  height: 30,         // dangerous area height above EACH surface top (px) — jump clearance
  reach: Infinity,    // vertical scan window around the reference y (px); Infinity = every surface in the scene
  duration: 0.35,     // s every band segment stays hot
  damage: 25,         // per target (each target hit ONCE during the window)
  team: 'foe',        // who the bands hurt (stomps are enemy attacks)
  method: 'melee',    // telemetry label; melee-family → blood sparkles + enemy shake on hit
  shakeStrength: 6,   // camera shake intensity fired at impact (0 = none)
});

/**
 * Scan every supporting surface and build the hot segments.
 * @returns {Array<{x:number, y:number, w:number}>} one AABB per surface
 *          (band clamped to the surface's own extent), or [] when nothing
 *          supports the span.
 */
export function resolveStrikeSegments(p, ctx) {
  const lo = p.x - p.width / 2;   // -Infinity when width is Infinity → full span
  const hi = p.x + p.width / 2;
  const yLo = p.y - p.reach;      // -Infinity when reach is Infinity → every surface
  const yHi = p.y + p.reach;
  const segs = [];

  const add = (surfLo, surfHi, topY) => {
    if (topY < yLo || topY > yHi) return;
    const a = Math.max(lo, surfLo);
    const b = Math.min(hi, surfHi);
    if (!Number.isFinite(b) || !Number.isFinite(a) || b <= a) return;
    segs.push({ x: a, y: topY, w: b - a });
  };

  // Floor: the widest floor-aligned solid defines the arena bounds (same rule
  // as surfaceWave.resolveSurface); fall back to a wide default.
  const groundY = ctx?.groundY;
  if (typeof groundY === 'number') {
    let leftEdge = null, rightEdge = null;
    for (const s of ctx?.solids ?? []) {
      if (!s || typeof s.x !== 'number') continue;
      if (Math.abs((s.y ?? groundY) - groundY) >= 2) continue;
      const l = s.x, r = s.x + (s.w ?? 0);
      if (leftEdge == null || (r - l) > (rightEdge - leftEdge)) { leftEdge = l; rightEdge = r; }
    }
    // Arena bounds are always FINITE (the floor has edges) — even with an
    // infinite strike span the floor segment spans exactly the arena.
    add(leftEdge ?? -2000, rightEdge ?? 2000, groundY);
  }
  // Platforms: explicit extra surfaces [{x, y, w}] (tops only). With the
  // default infinite span each platform contributes its FULL extent.
  for (const pl of ctx?.platforms ?? []) {
    add(pl.x, pl.x + pl.w, pl.y);
  }
  // Solids (blocks): any solid whose TOP sits inside the scan window counts as
  // a strikable surface — standing on a block means the block top is hot too.
  for (const s of ctx?.solids ?? []) {
    if (!s || typeof s.x !== 'number' || typeof s.y !== 'number') continue;
    if (Math.abs(s.y - groundY) < 2) continue; // the floor itself, already added
    add(s.x, s.x + (s.w ?? 0), s.y);
  }
  return segs;
}

/** World-space AABB of one hot segment. */
export function segmentBox(seg, p) {
  return { x: seg.x, y: seg.y - p.height, w: seg.w, h: p.height };
}

/**
 * Per-frame step. Returns true when the hot window closed.
 * @param {object} state   internal state bag (from impl)
 * @param {object} p       merged params
 * @param {Array<object>} targets candidate entities
 * @param {AttackHandle} h   handle to emit on
 */
export function stepSurfaceStrike(state, p, dt, targets, h) {
  if (state.done) return true;
  state.t += dt;
  if (state.t >= p.duration) {
    state.done = true;
    state.hb.active = false;
    h._complete({ reason: 'window-end', hits: state.hitCount, segments: state.segments.length });
    return true;
  }

  // Hot for the WHOLE window; each target damaged at most once (the hitbox's
  // hitSet persists across frames of this single window).
  state.hb.active = true;
  state.hb.damage = p.damage;
  const hits = [];
  for (const seg of state.segments) {
    state.hb.box = segmentBox(seg, p);
    processHitboxes([state.hb], targets, (hb, t, dealt) => hits.push({ target: t, dealt }));
  }
  for (const hit of hits) {
    state.hitCount++;
    h._emit('hit', { target: hit.target, dealt: hit.dealt });
  }

  return false;
}

registerPrimitive('surfaceStrike', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Surface Strike',
    effects: [
      { type: 'ground-strike', desc: 'slam-in band visual per surface segment (presentation)' },
      { type: 'camera-shake', desc: 'impact shake fired when the strike lands' },
    ],
    desc: 'Every surface (floor/platform/block) under the x-span gets a hot band at its own top, for `duration`, each target hit once. Jump to dodge. Caller owns the telegraph.',
    params: [
      { key: 'x', desc: 'center x (world) — impact point' },
      { key: 'y', desc: 'reference y (world) — aim line for the surface scan' },
      { key: 'width', desc: 'horizontal extent of the strike span (px); Infinity = full surface extents' },
      { key: 'height', desc: 'dangerous area height above each surface (px)' },
      { key: 'reach', desc: 'vertical scan window around the reference y (px); Infinity = every surface' },
      { key: 'duration', desc: 'hot window (s)' },
      { key: 'damage', desc: 'per target (hit once per window)' },
      { key: 'team', desc: "who the bands hurt" },
      { key: 'shakeStrength', desc: 'camera shake on impact (0 = none)' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('surfaceStrike', null, declaredEffectsOf('surfaceStrike'));
    const segments = resolveStrikeSegments(p, ctx);
    if (segments.length === 0) {
      // Nothing supports the span — nothing to burn.
      h.state = { done: true, segments: [], t: 0, hitCount: 0, hb: null };
      h._emit('expire');
      h._complete({ reason: 'no-surface', segments: 0 });
      return h;
    }
    const hb = makeHitbox({ owner: ctx.attacker, team: p.team, box: segmentBox(segments[0], p), damage: p.damage, method: p.method });
    resetHitbox(hb);
    h.state = { done: false, segments, t: 0, hitCount: 0, hb };

    // Presentation twins owned by the PRIMITIVE (same pattern as surfaceWave's
    // ground-wave crest): one real ground-strike effect PER SEGMENT, riding
    // alongside that segment's collision volume so EVERY host sees the slam
    // exactly where the damage is — floor strip, platform strip, block strip.
    for (const seg of segments) {
      fireDeclared({ type: 'ground-strike', params: {
        x: seg.x + seg.w / 2, y: seg.y,
        width: seg.w,
        thickness: Math.min(14, p.height),
        duration: Math.max(0.1, p.duration),
      } }, h.declaredEffectTypes());
    }
    // Impact juice: camera shake on the landing itself, even when nothing is
    // hit (same rule as stomp/stompWave). Hit juice (blood sparkles + enemy
    // shake) comes free from processHitboxes via method='melee'.
    if (p.shakeStrength > 0) {
      fireDeclared({ type: 'camera-shake', params: { intensity: p.shakeStrength } }, h.declaredEffectTypes());
    }

    h.step = (dt, targets) => stepSurfaceStrike(h.state, p, dt, targets ?? [], h);
    return h;
  },
});
