// Attack Engine — Surface Wave primitive (doc §9).
//
// A damaging wave that travels ALONG A SUPPORTING SURFACE from an origin,
// one invoke = ONE wave going ONE direction (left | right). A two-sided
// stomp is two invokes — the pattern lives in the macro, the geometry here.
//
// The wave owns ONLY its travel + damage window. It never moves entities,
// never does HP math itself (damage() via takeDamage()), and never spawns
// VFX beyond hit-sparkle juice on each struck target. Termination rules:
//   1. ttl elapses (optional; null = unlimited until surface ends)
//   2. end of supporting surface (wavefront walks off a platform edge)
//   3. solid geometry in its path (a block stops it)
// whichever comes FIRST. On death it simply stops — no explosion, no
// secondary effect.
//
// Surface model (same convention as stepBombTerrain in bomb.js):
//   ctx.groundY      floor top y (world)
//   ctx.platforms    optional extra surfaces [{x, y, w}] (tops only)
//   ctx.solids       optional blocking boxes [{x, y, w, h}]
// The wave's surface line is resolved ONCE at spawn from the origin point
// (nearest surface top at or below the origin bottom), then the front
// travels along that fixed line — it does not drop onto lower surfaces.
//
// Usage pattern (host loop):
//   const h = attackEngine.invoke('surfaceWave', { x, y, direction: 'right' }, ctx);
//   each frame: h.step(dt, targets) → true when the wave died.

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { Effects } from '../../../effects.js';

const DEFAULTS = Object.freeze({
  x: 0,               // origin x (world) — usually the stomp impact point
  y: 0,               // origin y (world) — surface top where the wave rides
  direction: 'right', // 'left' | 'right'
  speed: 300,         // px/s along the surface
  height: 24,         // dangerous area height above the surface (px)
  width: 28,          // leading-edge length (px) — the visible crest body
  damage: 15,         // per target (each target hit ONCE by this wave)
  ttl: null,          // s; null = travel until surface ends / blocked
  team: 'foe',        // who the wave hurts (stomps are enemy attacks)
});

/** Normalize the direction param to -1 (left) | +1 (right). */
export function waveSign(direction) {
  if (direction === 'left') return -1;
  if (direction === 'right') return 1;
  const n = Number(direction);
  return n < 0 ? -1 : 1;
}

/**
 * Resolve the surface line the wave rides on.
 * @param {object} p   merged params
 * @param {object} ctx AttackContext (groundY, platforms)
 * @returns {{y:number, leftEdge:number, rightEdge:number}|null}
 *          the surface top y + horizontal extent, or null when the origin
 *          floats above every surface (no ground under the impact point).
 */
export function resolveSurface(p, ctx) {
  const sign = waveSign(p.direction);
  const groundY = ctx?.groundY;
  // Candidate tops: the floor plus any platform whose span contains the
  // origin x. Pick the HIGHEST top at or below the origin y (the surface
  // actually under the impact point). Floor extent comes from the host's
  // floor solid when provided (ctx.solids), else a wide default — finite by
  // construction so travel math (distance/duration) stays sane.
  let best = null;
  if (typeof groundY === 'number' && groundY >= p.y - 1) {
    // The host's floor solid defines the arena bounds. Take the WIDEST
    // floor-aligned solid (the sandbox/game floor), not a min/max merge —
    // merging would keep the wide defaults when the real floor is narrower.
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
  // Clamp the travel range to the side the wave goes toward.
  return {
    y: best.y,
    min: sign < 0 ? best.leftEdge : p.x,
    max: sign > 0 ? best.rightEdge : p.x,
  };
}

/** World-space AABB of the wavefront's dangerous area for this frame. */
export function waveBox(state, p) {
  const sign = waveSign(p.direction);
  const frontX = state.x; // leading edge center
  const backX = frontX - sign * p.width;
  const x = Math.min(frontX, backX);
  return { x, y: state.surfaceY - p.height, w: p.width, h: p.height };
}

/**
 * Per-frame step. Advances the front, damages new contacts once, checks
 * termination. Returns true when the wave finished.
 *
 * @param {object} state   internal state bag (from impl)
 * @param {object} p       merged params
 * @param {object} ctx     AttackContext (solids for blocking)
 * @param {Array<object>} targets candidate entities
 * @param {AttackHandle} h   handle to emit on
 */
export function stepSurfaceWave(state, p, ctx, targets, h) {
  if (state.done) return true;
  const dt = state._dt ?? 1 / 60;
  const sign = waveSign(p.direction);

  // --- ttl ------------------------------------------------------------------
  if (p.ttl != null && state.t >= p.ttl) {
    state.done = true;
    h._complete({ reason: 'ttl', distance: state.distance });
    return true;
  }

  // --- advance the front ------------------------------------------------------
  const step = p.speed * dt;
  const nextX = state.x + sign * step;

  // End of surface: the front walked past the surface extent on its side.
  if ((sign > 0 && nextX > state.max) || (sign < 0 && nextX < state.min)) {
    state.x = sign > 0 ? state.max : state.min;
    state.distance = Math.abs(state.x - p.x);
    state.done = true;
    h._complete({ reason: 'surface-end', distance: state.distance });
    return true;
  }

  // Solid geometry in the path: any blocking box overlapping the crest band.
  for (const s of ctx?.solids ?? []) {
    if (!s || typeof s.x !== 'number') continue;
    const overlapX = Math.min(nextX, state.x) < s.x + s.w && Math.max(nextX, state.x) > s.x;
    const overlapY = state.surfaceY > s.y && state.surfaceY - p.height < s.y + s.h;
    if (overlapX && overlapY) {
      state.distance = Math.abs(state.x - p.x);
      state.done = true;
      h._complete({ reason: 'blocked', distance: state.distance });
      return true;
    }
  }

  state.x = nextX;
  state.t += dt;
  state.distance = Math.abs(state.x - p.x);

  // --- damage: each target hit ONCE while inside the crest ---------------------
  const box = waveBox(state, p);
  for (const t of targets ?? []) {
    if (!t || !t.alive || state.hitSet.has(t)) continue;
    if (t.x + t.w <= box.x || t.x >= box.x + box.w ||
        t.y + t.h <= box.y || t.y >= box.y + box.h) continue;
    state.hitSet.add(t);
    const dealt = typeof t.takeDamage === 'function'
      ? t.takeDamage(p.damage, ctx.attacker, 'stompWave')
      : p.damage;
    // Hit juice owned by the primitive (same pattern as projectile debris).
    const fx = ctx.effects ?? Effects;
    fx.spawnHitSparkles?.(t.x + t.w / 2, t.y + t.h / 2, 5);
    h._emit('hit', { target: t, dealt });
  }

  return false;
}

registerPrimitive('surfaceWave', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Surface Wave',
    effects: [
      { type: 'ground-wave', desc: 'crest visual riding alongside the collision volume (effects.md #4)' },
      { type: 'hit-sparkle', desc: 'blood sparkles on every enemy struck (hit juice)' },
    ],
    desc: 'One damaging wave traveling along a supporting surface, one direction per invoke. Dies on ttl / end of surface / solid geometry.',
    params: [
      { key: 'x', desc: 'origin x (world)' },
      { key: 'y', desc: 'origin y (world) — surface top under the origin' },
      { key: 'direction', desc: "'left' | 'right'" },
      { key: 'speed', desc: 'travel speed px/s' },
      { key: 'height', desc: 'dangerous area height above surface (px)' },
      { key: 'width', desc: 'leading-edge length (px)' },
      { key: 'damage', desc: 'per target (hit once per wave)' },
      { key: 'ttl', desc: 'lifetime cap (s); null = until surface ends/blocked' },
      { key: 'team', desc: "who the wave hurts" },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('surfaceWave');
    const surf = resolveSurface(params, ctx);
    if (!surf) {
      // No surface under the origin — nothing to ride on.
      h.state = { done: true, x: params.x, surfaceY: params.y, t: 0, distance: 0, hitSet: new Set(), _dt: 1 / 60 };
      h._emit('expire');
      h._complete({ reason: 'no-surface' });
      return h;
    }
    h.state = {
      x: params.x,
      surfaceY: surf.y,
      min: surf.min,
      max: surf.max,
      t: 0,
      distance: 0,
      hitSet: new Set(),
      done: false,
      _dt: 1 / 60,
    };
    // Presentation twin owned by the PRIMITIVE (same pattern as projectile's
    // debris puff): the real ground-wave effect (effects.md #4) rides along-
    // side the collision volume so EVERY host gets the crest for free. Both
    // geometry values come from the RESOLVED SURFACE EXTENT — never from a
    // time window — so the crest travels exactly as far as the wave can and
    // fades exactly when the wave dies (ttl cut short OR surface end).
    const fx = ctx.effects ?? Effects;
    // Travel to the surface edge on this side, cut short by ttl when set.
    // Both values are FINITE by construction (floor bounds are finite).
    const edgeX = params.direction === 'left' ? surf.min : surf.max;
    const fullTravel = Math.abs(edgeX - params.x);
    const travelTime = fullTravel / Math.max(1, params.speed);
    const life = params.ttl != null ? Math.min(params.ttl, travelTime) : travelTime;
    const travel = life * params.speed; // crest distance == wave distance
    fx.fireManual?.({ type: 'ground-wave', params: {
      x: params.x, y: surf.y,
      direction: waveSign(params.direction),
      speed: params.speed,
      distance: travel,
      height: params.height,
      width: params.width,
      duration: Math.max(0.1, life + 0.05),
    } });
    h.step = (dt, targets) => {
      h.state._dt = dt;
      return stepSurfaceWave(h.state, params, ctx, targets ?? [], h);
    };
    return h;
  },
});
