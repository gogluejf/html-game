// Attack Engine — Surface Strike primitive.
//
// A stationary damaging BAND along a supporting surface at the impact point:
// the ground-slam damage shape ("the floor is hot for a moment — JUMP"). One
// invoke = one band, one surface, one hit window. It is the impact-event twin
// of spike (same shape — a band hot for a window — but WITHOUT spike's
// trap semantics: no warning/hidden/repeat cycle; the CALLER owns the
// telegraph, e.g. stomp's hop or skyDiveStomp's marker).
//
// The band sits on the HIGHEST surface under its x (floor, platform, or
// block top) using the same column-resolution convention as surfaceWave and
// skyMissile. It extends ±width/2 around the center x, clamped to the
// supporting surface's extent — a strike centered near a platform edge only
// burns the part of the band that has floor under it.
//
// Damage: each live target overlapping the band takes `damage` ONCE during
// the whole window (hitSet), routed through the unified hitbox system
// (takeDamage pipeline + team routing). No ticks, no repeat — one slam, one
// number. Dodge verb: jump over it (or never be on that surface).
//
// Presentation: the primitive fires the REAL 'ground-strike' effect (slam-in
// band + fade) alongside the collision volume so every host gets the visual
// for free — same pattern as surfaceWave firing 'ground-wave'.
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
  y: 0,               // reference y (world) — surface top under x (resolved if above floor)
  width: 240,         // horizontal extent of the hot band (px)
  height: 30,         // dangerous area height above the surface (px) — jump clearance
  duration: 0.35,     // s the band stays hot
  damage: 25,         // per target (each target hit ONCE during the window)
  team: 'foe',        // who the band hurts (stomps are enemy attacks)
  method: 'stomp',    // telemetry label
});

/** Fixed vertical reach used for surface resolution (px above reference). */
export const STRIKE_RESOLVE_REACH = 80;

/**
 * Resolve the surface line the band sits on: the highest surface top at or
 * below the reference y whose span contains x (floor wins by default; a
 * platform/block directly under the point climbs up to it). Returns null when
 * nothing supports the point.
 */
export function resolveStrikeSurface(p, ctx) {
  const groundY = ctx?.groundY;
  let best = null;
  if (typeof groundY === 'number' && groundY >= p.y - 1) {
    // Widest floor-aligned solid defines the arena bounds (same rule as
    // surfaceWave.resolveSurface).
    let leftEdge = null, rightEdge = null;
    for (const s of ctx?.solids ?? []) {
      if (!s || typeof s.x !== 'number') continue;
      if (Math.abs((s.y ?? groundY) - groundY) >= 2) continue;
      const l = s.x, r = s.x + (s.w ?? 0);
      if (leftEdge == null || (r - l) > (rightEdge - leftEdge)) { leftEdge = l; rightEdge = r; }
    }
    best = { y: groundY, leftEdge: leftEdge ?? -2000, rightEdge: rightEdge ?? 2000 };
  }
  for (const pl of ctx?.platforms ?? []) {
    if (p.x < pl.x || p.x > pl.x + pl.w) continue;
    if (pl.y >= p.y - 1 && (best == null || pl.y < best.y)) {
      best = { y: pl.y, leftEdge: pl.x, rightEdge: pl.x + pl.w };
    }
  }
  if (!best) return null;
  // Clamp the band to the supporting surface's extent.
  const half = p.width / 2;
  const lo = Math.max(best.leftEdge, p.x - half);
  const hi = Math.min(best.rightEdge, p.x + half);
  if (hi <= lo) return null; // entirely off the surface — nothing to burn
  return { y: best.y, x: (lo + hi) / 2, w: hi - lo };
}

/** World-space AABB of the hot band. */
export function strikeBox(surf, p) {
  return { x: surf.x - surf.w / 2, y: surf.y - p.height, w: surf.w, h: p.height };
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
    h._complete({ reason: 'window-end', hits: state.hitCount });
    return true;
  }

  // Hot for the WHOLE window; each target damaged at most once (hitSet lives
  // on the hitbox and persists across frames of this single window).
  state.hb.active = true;
  state.hb.box = strikeBox(state.surf, p);
  state.hb.damage = p.damage;
  const hits = [];
  processHitboxes([state.hb], targets, (hb, t, dealt) => hits.push({ target: t, dealt }));
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
      { type: 'ground-strike', desc: 'slam-in band visual riding the collision volume (presentation)' },
    ],
    desc: 'Stationary damaging band along the surface under x, hot for `duration`, each target hit once. Jump to dodge. Caller owns the telegraph.',
    params: [
      { key: 'x', desc: 'center x (world) — impact point' },
      { key: 'y', desc: 'reference y (world) — surface top under x' },
      { key: 'width', desc: 'horizontal extent of the hot band (px)' },
      { key: 'height', desc: 'dangerous area height above surface (px)' },
      { key: 'duration', desc: 'hot window (s)' },
      { key: 'damage', desc: 'per target (hit once per window)' },
      { key: 'team', desc: "who the band hurts" },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('surfaceStrike', null, declaredEffectsOf('surfaceStrike'));
    const surf = resolveStrikeSurface(p, ctx);
    if (!surf) {
      // No surface under the point — nothing to burn.
      h.state = { done: true, surf: null, t: 0, hitCount: 0, hb: null };
      h._emit('expire');
      h._complete({ reason: 'no-surface' });
      return h;
    }
    const hb = makeHitbox({ owner: ctx.attacker, team: p.team, box: strikeBox(surf, p), damage: p.damage, method: p.method });
    resetHitbox(hb);
    h.state = { done: false, surf, t: 0, hitCount: 0, hb };

    // Presentation twin owned by the PRIMITIVE (same pattern as surfaceWave's
    // ground-wave crest): the real ground-strike effect rides alongside the
    // collision volume so EVERY host gets the slam visual for free. Geometry
    // comes from the RESOLVED SURFACE — the band slams in exactly where the
    // damage is and fades exactly when the window closes.
    fireDeclared({ type: 'ground-strike', params: {
      x: surf.x, y: surf.y,
      width: surf.w,
      thickness: Math.min(14, p.height),
      duration: Math.max(0.1, p.duration),
    } }, h.declaredEffectTypes());

    h.step = (dt, targets) => stepSurfaceStrike(h.state, p, dt, targets ?? [], h);
    return h;
  },
});
