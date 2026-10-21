// Attack Engine — Sweeping Beam macro (single continuous rotating beam).
//
// ONE beam for the entire attack. It does NOT re-fire or fade between phases;
// it is a single continuous laser that:
//   1. FLASH-IN / START HOLD (static): the beam pops in and holds at the start
//      direction with LOW shimmer, giving the player time to read it. Duration:
//      holdDuration.
//   2. SWEEP (rotating): the SAME beam rotates through sweepAngle around its
//      origin (pivot) at FULL power with HIGH shimmer — the dangerous phase.
//      Duration: sweepDuration.
//   3. END HOLD (static at final angle): holds at the end of the sweep at full
//      power with HIGH shimmer. Duration: endHoldDuration.
//   4. FADE-OUT: only AFTER the end angle is reached does the beam fade out.
//      Duration: fadeOut.
//
// The escalation (low → high shimmer) creates tension: the player sees the
// beam lock in, watches it rotate at full intensity, gets a last moment at the
// final angle, THEN it fades. The fade NEVER overlaps the motion.
//
// Implementation: this macro fires ONE beam primitive instance whose total
// duration == hold + sweep + endHold + fadeOut. The beam EFFECT's three-phase
// envelope is aligned to the macro's phases via explicit flashInTime/holdTime/
// fadeOutTime:
//   - flashInTime = holdDuration          (pop-in during the start hold)
//   - holdTime    = sweepDuration + endHoldDuration  (full-power shimmer across
//                       ALL motion + the end hold)
//   - fadeOutTime = fadeOut               (fade only after the end angle)
// So the effect stays at peak brightness through the entire sweep and end hold,
// and only begins fading once the motion is complete. No per-frame re-fire, no
// flicker, no ghost. Each frame the macro mutates the persistent instance:
//   - body.angle / body.origin  → the visual rotates/translates around the pivot
//   - state.hb.box              → the damage AABB follows the swept segment
//   - body.shimmerDepth         → the intensity ramps low→high→high
// The primitive trusts the externally-set box via the `_swept` flag.
//
// See attack-macros.md §15.
//
// Params (flat):
//   - Direction/geometry: direction, sweepAngle, length, width, speed
//   - Timing: holdDuration, sweepDuration, endHoldDuration, fadeOut
//   - Damage: damage, tickRate, team
//   - Style: beamStyle (base override), shimmerLow, shimmerHigh

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { targetCenter } from '../context.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read at construction so synchronous fires inside impl()
// see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}
import { getPrimitive, getMacro } from '../registry.js';

const DEFAULTS = Object.freeze({
  // Geometry / direction.
  direction: 0,              // radians — initial beam axis
  sweepAngle: 67.5 * Math.PI / 180, // total angle swept during the sweep phase
  length: 1000,              // beam reach (px)
  width: 24,                 // damaging thickness (px)
  speed: 0,                  // px/s — translation speed during sweep (0 = rotate in place)
  origin: null,              // marker label | {x,y} | null → attacker facing edge
  // Timing (4 phases).
  holdDuration: 0.4,         // start hold / flash-in (s)
  sweepDuration: 1.0,        // moving + rotating phase (s)
  endHoldDuration: 0.3,      // final-angle hold before fade (s)
  fadeOut: 0.5,              // fade-out AFTER the end angle is reached (s)
  // Damage.
  damage: 20,                // per tick
  tickRate: 8,               // ticks per second
  team: 'ally',              // ally | foe | neutral
  // Shimmer escalation.
  shimmerLow: 0.1,           // shimmer depth during the start hold (subtle)
  shimmerHigh: 0.35,         // shimmer depth during sweep + end hold (aggressive)
  // Announcement (entry direction only — the sweep motion itself is un-telegraphed).
  announceMarker: true,     // surface-target-marker at the entry point before pop-in
  announceDelay: 1.0,       // s the entry marker stays visible
  // Style override passed to the beam.
  beamStyle: null,
});

/**
 * Compute the world-space AABB of a beam segment from an origin, angle,
 * length and width (same conservative formula as the primitive's beamBox).
 */
function segmentAABB(ox, oy, ang, length, width) {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const ex = ox + cos * length, ey = oy + sin * length;
  return {
    x: Math.min(ox, ex) - width / 2,
    y: Math.min(oy, ey) - width / 2,
    w: Math.abs(ex - ox) + width,
    h: Math.abs(ey - oy) + width,
  };
}

defineMacro('sweepingBeam', {
  attacks: [{ id: 'beam', role: 'body' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Sweeping Beam',
    effects: [
      { type: 'beam', desc: 'the beam body itself (Effect Engine renders it)' },
    ],
    desc: 'One continuous beam: pop-in + start hold (low shimmer) → rotation sweep around the pivot (high shimmer) → end hold → fade-out after the end angle.',
    params: [
      { key: 'direction', desc: 'radians — initial beam axis' },
      { key: 'sweepAngle', desc: 'total angle swept during sweep phase' },
      { key: 'length', desc: 'beam reach (px)' },
      { key: 'width', desc: 'damaging thickness (px)' },
      { key: 'speed', desc: 'px/s translation during sweep (0 = rotate in place)' },
      { key: 'holdDuration', desc: 'start hold / flash-in (s)' },
      { key: 'sweepDuration', desc: 'moving + rotating phase (s)' },
      { key: 'endHoldDuration', desc: 'final-angle hold before fade (s)' },
      { key: 'fadeOut', desc: 'fade-out after the end angle is reached (s)' },
      { key: 'damage', desc: 'damage per tick' },
      { key: 'tickRate', desc: 'ticks per second' },
      { key: 'team', desc: 'ally | foe | neutral' },
      { key: 'announceMarker', desc: 'bool (default true) — entry-point marker before the beam pops in (same screen-edge rules as the beam primitive)' },
      { key: 'announceDelay', desc: 's the entry marker stays visible (default 1.0)' },
      { key: 'shimmerLow', desc: 'shimmer depth during the start hold (0..1)' },
      { key: 'shimmerHigh', desc: 'shimmer depth during sweep + end hold (0..1)' },
      { key: 'beamStyle', desc: 'Effect Engine beam params override' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('sweepingBeam', null, declaredEffectsOf('sweepingBeam'));
    // Motion ends here; the fade-out window comes AFTER.
    const motionEnd = params.holdDuration + params.sweepDuration + params.endHoldDuration;
    const totalDuration = motionEnd + params.fadeOut;
    h.state = { t: 0, done: false, beam: null };

    // Resolve the base origin (gun tip / pivot) once.
    const a = ctx.attacker;
    let baseX, baseY;
    if (params.origin && typeof params.origin === 'object' && 'x' in params.origin) {
      baseX = params.origin.x; baseY = params.origin.y;
    } else {
      const ang = params.direction;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      const hw = (a?.w ?? 0) / 2, hh = (a?.h ?? 0) / 2;
      const dx = Math.abs(cos) * hw + Math.abs(sin) * hh;
      baseX = (a?.x ?? 0) + hw + cos * dx;
      baseY = (a?.y ?? 0) + hh + sin * dx;
    }

    // Fire ONE beam for the whole attack. Align the effect's three-phase
    // envelope to the macro's phases so it stays at peak brightness through
    // the entire sweep + end hold and only fades after the end angle:
    //   flashInTime = holdDuration
    //   holdTime    = sweepDuration + endHoldDuration
    //   fadeOutTime = fadeOut
    const beam = invoke('beam', {
      origin: { x: baseX, y: baseY },
      direction: params.direction,
      length: params.length,
      width: params.width,
      duration: totalDuration,
      damage: params.damage,
      tickRate: params.tickRate,
      team: params.team,
      // Entry-direction announcement: the sweep's START is a known direction,
      // so a marker at that entry point (same screen-edge rules as any beam)
      // warns where the laser begins before it pops in. The sweep motion
      // itself then plays out un-telegraphed — that is its own read.
      announceMarker: params.announceMarker,
      announceDelay: params.announceDelay,
      style: {
        ...(params.beamStyle ?? {}),
        shimmerDepth: params.shimmerLow,
        flashInTime: params.holdDuration,
        holdTime: params.sweepDuration + params.endHoldDuration,
        fadeOutTime: params.fadeOut,
      },
    }, ctx);
    if (beam) beam.on('hit', (info) => h._emit('hit', info));
    // Trust our per-frame box mutation instead of the static recompute.
    if (beam?.state) beam.state._swept = true;
    h.state.beam = beam;

    h.step = (dt, targets) => {
      const s = h.state;
      if (s.done || !beam) return true;
      s.t += dt;

      // Determine current phase → angle, position, shimmer. Motion (angle +
      // translation) is fully resolved by `motionEnd`; the fade-out window
      // after that keeps the beam at the final angle while it dims.
      let ang = params.direction;
      let dist = 0;
      let shimmer = params.shimmerLow;
      if (s.t < params.holdDuration) {
        // Phase 0: start hold / flash-in, low shimmer.
        ang = params.direction;
        shimmer = params.shimmerLow;
      } else if (s.t < params.holdDuration + params.sweepDuration) {
        // Phase 1: rotating sweep, high shimmer.
        const p = (s.t - params.holdDuration) / params.sweepDuration;
        ang = params.direction + params.sweepAngle * p;
        dist = params.speed * (s.t - params.holdDuration);
        shimmer = params.shimmerHigh;
      } else {
        // Phase 2+3: end hold at final angle, then fade-out (envelope handles
        // the dimming). Angle and position are frozen at the end of the sweep.
        ang = params.direction + params.sweepAngle;
        dist = params.speed * params.sweepDuration;
        shimmer = params.shimmerHigh;
      }

      const curX = baseX + Math.cos(params.direction) * dist;
      const curY = baseY + Math.sin(params.direction) * dist;

      // Mutate the persistent beam in place BEFORE stepping so this frame's
      // damage tick uses the current swept position.
      beam.state.hb.box = segmentAABB(curX, curY, ang, params.length, params.width);
      const fxBody = beam.state._fx?.body;
      if (fxBody) {
        fxBody.origin = { x: curX, y: curY };
        fxBody.angle = ang;
        fxBody.shimmerDepth = shimmer;
      }

      // Step for damage.
      beam.step(dt, targets ?? []);

      if (s.t >= totalDuration - 1e-9 || beam.done) {
        s.done = true;
        h._complete({ phases: 4 });
        return true;
      }
      return false;
    };

    h.cancel = () => {
      try { beam?.complete?.(); } catch { /* noop */ }
      h.state.done = true;
    };
    return h;
  },
});
