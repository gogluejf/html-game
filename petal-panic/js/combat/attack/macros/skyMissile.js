// Attack Engine — Sky Missile (macro, doc §22). ONE object, one id.
//
// A single missile arriving from above at a FIXED ground position:
//   warning (Ground Target Marker at the impact point) → timeToTarget →
//   Explosive Projectile drops straight down and detonates on the marked spot.
//
// The vertical, telegraphed twin of explosiveProjectile — same blast, but the
// approach vector is always straight down and the impact point is announced in
// advance. Fairness comes from the WARNING, not from prediction: no homing,
// no drift, strictly vertical.
//
// Column resolution: the impact y is the TOP of the highest surface in the
// drop column (floor, platform, or block) — the marker AND the blast land on
// whatever is actually there, not on an invisible floor below it. Same
// "highest top at or below the reference" rule as surfaceWave's resolveSurface.
//
// This is the building block for Missile Rain (§7): the rain is N sky missiles
// with staggered positions/timing plus the launch-up visual. One missile, one id.
//
// Handle shape:
//   h.step(dt, targets) — advance the sequence; true when the missile is done
//   state.phase         — 'warning' | 'drop'
//   state.impact        — { x, y } of the resolved impact point (marker placement)
//   hit / complete      — hit per damaged target (via the blast); complete {}

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { fireDeclared } from '../../../effects/index.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read lazily at construction so synchronous fires inside
// impl() see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}
import { getPrimitive, getMacro } from '../registry.js';

const DEFAULTS = Object.freeze({
  x: 0,               // impact x (world) — marker AND drop share it
  groundY: null,      // fallback impact y; null → resolve from ctx (surface column)
  timeToTarget: 1.0,  // s between marker appearance and impact (the survival window)
  dropHeight: 260,    // px above the impact point where the missile becomes visible
  fallSpeed: 500,     // px/s descent speed
  damage: 30,         // carrier contact + blast damage (one value, like explosiveProjectile)
  radius: 60,         // blast radius (px)
  team: 'foe',        // who the falling carrier hurts
  blastTeam: 'neutral', // who the blast hurts
  size: 14,           // carrier box size (px)
  markerStyle: null,  // ground-target-marker effect override
});

/**
 * Resolve the impact point for a sky missile.
 *
 * x is the caller's drop column. y is the TOP of the highest surface in that
 * column: explicit `groundY` param wins outright; otherwise the host's
 * ctx.groundY floor plus any ctx.platforms whose span contains x — the
 * HIGHEST top among them (same "highest top" rule as surfaceWave's
 * resolveSurface, minus the horizontal extent we don't need). A platform
 * catches the drop even when no floor line was provided.
 *
 * @param {object} p   merged params (x, groundY)
 * @param {object} ctx AttackContext (groundY, platforms)
 * @returns {{x:number,y:number}}
 */
export function resolveImpactPoint(p, ctx) {
  if (typeof p.groundY === 'number') return { x: p.x, y: p.groundY };
  let best = null;
  if (typeof ctx?.groundY === 'number') best = ctx.groundY;
  for (const pl of ctx?.platforms ?? []) {
    if (p.x < pl.x || p.x > pl.x + pl.w) continue;
    if (best == null || pl.y < best) best = pl.y;
  }
  return { x: p.x, y: best ?? 0 };
}

defineMacro('skyMissile', {
  attacks: [{ id: 'explosiveProjectile', role: 'payload' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Sky Missile',
    desc: 'Ground marker warns a fixed spot → timeToTarget → vertical explosive projectile drops and detonates on the marked surface.',
    effects: [
      { type: 'ground-target-marker', desc: 'landing warning fixed at the impact point for the whole warning window' },
    ],
    params: [
      { key: 'x', desc: 'impact x (world) — marker and drop share it' },
      { key: 'groundY', desc: 'fallback impact y; null → highest surface in the drop column' },
      { key: 'timeToTarget', desc: 'seconds between marker and impact (survival window)' },
      { key: 'dropHeight', desc: 'px above the impact where the missile appears' },
      { key: 'fallSpeed', desc: 'descent speed (px/s)' },
      { key: 'damage', desc: 'contact + blast damage' },
      { key: 'radius', desc: 'blast radius (px)' },
      { key: 'team', desc: 'who the falling carrier hurts' },
      { key: 'blastTeam', desc: 'who the blast hurts' },
      { key: 'size', desc: 'carrier box size (px)' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('skyMissile', null, declaredEffectsOf('skyMissile'));
    const pt = resolveImpactPoint(p, ctx);
    const spawnY = pt.y - p.dropHeight;

    h.state = {
      phase: 'warning',
      t: 0,
      impact: pt,
      markerFired: false,
      missile: null,
      done: false,
    };

    const launchMissile = () => {
      // Strictly vertical: direction π/2 = straight down (radians, 0 = right).
      // ttl covers the full fall from spawn to the impact line (+ small margin
      // so the surface contact resolves first, not the fuse).
      const fallTtl = (p.dropHeight / Math.max(1, p.fallSpeed)) + 0.25;
      const m = invoke('explosiveProjectile', {
        origin: { x: pt.x - p.size / 2, y: spawnY },
        direction: Math.PI / 2,
        speed: p.fallSpeed,
        ttl: fallTtl,
        damage: p.damage,
        radius: p.radius,
        team: p.team,
        blastTeam: p.blastTeam,
        size: p.size,
        solidBehavior: 'phase',
      }, ctx);
      h.state.missile = m;
      if (m) {
        m.on('hit', (...args) => h._emit('hit', ...args));
        m.on('complete', () => { h._complete(); });
      } else {
        // Pool exhausted — soft-fail: nothing to drop, finish cleanly.
        h._complete();
      }
    };

    h.step = (dt, _targets) => {
      const s = h.state;
      if (s.done) return true;
      s.t += dt;

      if (s.phase === 'warning') {
        // The warning is the REAL Ground Target Marker effect (effects.md #9):
        // FIXED at the impact point for the whole window — the player reads
        // "leave this spot", never "track a moving thing".
        if (s.t <= dt && !s.markerFired) {
          s.markerFired = true;
          fireDeclared({ type: 'ground-target-marker', params: { x: pt.x, y: pt.y, duration: Math.max(0.1, p.timeToTarget), ...(p.markerStyle ?? {}) } }, h.declaredEffectTypes());
        }
        if (s.t >= p.timeToTarget) { s.phase = 'drop'; s.t = 0; launchMissile(); }
      } else if (s.phase === 'drop') {
        // Step the child carrier (flight + detonation are its job). The macro
        // completes when the child handle has completed (its 'complete' event
        // already forwarded via on('complete') above — _complete is idempotent).
        if (s.missile?.step) s.missile.step(dt, _targets);
        // Surface landing: plain projectiles get NO terrain handling (only
        // bombs do), so without this the carrier would phase through the
        // marked surface and fizzle at TTL below it — marker says "boom HERE",
        // boom happens elsewhere. Kill the carrier the frame its bottom reaches
        // the impact line; _attackHit routes the death through stepProjectile's
        // 'hit' → the blast resolves at exactly the marked point. Marker and
        // blast share state.impact, so they can never drift apart.
        const ent = s.missile?.entity;
        if (ent?.alive && !ent._attackDone && ent.y + ent.h >= pt.y) {
          ent.alive = false;
          ent._attackHit = true;
        }
        if (s.missile?._completed) {
          s.done = true;
          h._complete();
          return true;
        }
      }
      return false;
    };

    return h;
  },
});
