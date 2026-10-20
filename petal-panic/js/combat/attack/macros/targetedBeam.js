// Attack Engine — Targeted Beam macro (target-reticle effect → Beam).
//
// A telegraphed beam attack: a target-reticle EFFECT tracks the target,
// LOCKS its position at lockTime, and when the warning window ends
// (duration) a BEAM fires from the attacker's facing edge through the
// LOCKED point — not where the target happens to be at that moment.
//
// Same "telegraph then fire" pattern as reticleShot, but the payload is a
// sustained damaging beam (with laser shimmer) instead of a single
// projectile. The beam direction is computed from the attacker's gun tip
// toward the locked reticle point.
//
// The telegraph is the `target-reticle` effect (effects.md §10). This macro
// owns its lifecycle directly — fire it once, move its origin while tracking,
// freeze it at lock.
//
// Owning this here (not in a debug demo) means heroes/enemies get identical
// behavior. See attack-macros.md §14.
//
// Params (flat):
//   - Telegraph: target, duration, lockTime, color, radius, tracking
//   - Beam: beamDuration, beamWidth, damage, tickRate, beamStyle
//
// Handle events: 'complete' ({point}) when the beam has been fired; 'hit'
// events are forwarded from the beam so hosts can react to connections.
// handle.state carries the timing + the live effect instance (state._fx)
// for renderers/debug.

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { targetCenter } from '../context.js';
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
  // Telegraph stage.
  target: null,        // entity to track (default ctx.target)
  duration: 1.2,       // total warning window (s): track → lock → fire
  lockTime: 0.5,       // seconds after start when the aim freezes
  color: '#ff5555',
  radius: 30,          // reticle size (px)
  tracking: true,      // follow the target until lockTime
  // Beam stage.
  beamDuration: 1.0,   // how long the beam stays active (s)
  beamWidth: 24,       // damaging thickness (px)
  beamLength: 1000,    // reach along the axis (px)
  damage: 15,          // per tick
  tickRate: 8,         // damage ticks per second while overlapping
  team: 'ally',        // ally | foe | neutral
  beamStyle: null,     // Effect Engine beam params override
});

/**
 * Resolve the current aim point: tracked target center → attacker center.
 * A dead/missing target falls back to the attacker so the math never NaNs.
 */
function aimPoint(params, ctx) {
  const t = params.target ?? ctx.target;
  if (t && t.alive !== false) return targetCenter(t);
  const a = ctx.attacker;
  return { x: (a?.x ?? 0) + (a?.w ?? 0) / 2, y: (a?.y ?? 0) + (a?.h ?? 0) / 2 };
}

/**
 * Compute the gun-tip origin (facing edge of the attacker) and the direction
 * angle from that tip toward the target point.
 */
function gunTipAndDir(attacker, dirHint, pt) {
  const hw = (attacker?.w ?? 0) / 2;
  const hh = (attacker?.h ?? 0) / 2;
  const cx = (attacker?.x ?? 0) + hw;
  const cy = (attacker?.y ?? 0) + hh;
  // Direction from center to target point
  const ang = Math.atan2(pt.y - cy, pt.x - cx);
  const cos = Math.cos(ang), sin = Math.sin(ang);
  // Offset to the facing edge (gun tip)
  const dx = Math.abs(cos) * hw + Math.abs(sin) * hh;
  return {
    origin: { x: cx + cos * dx, y: cy + sin * dx },
    angle: ang,
  };
}

defineMacro('targetedBeam', {
  attacks: [{ id: 'beam', role: 'payload' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Targeted Beam',
    effects: [
      { type: 'target-reticle', desc: 'telegraph reticle that tracks then locks' },
    ],
    desc: 'Target-reticle effect tracks the target, locks at lockTime, then fires a sustained beam from the attacker through the locked point when duration ends.',
    params: [
      { key: 'target', desc: 'entity to track (default ctx.target)' },
      { key: 'duration', desc: 'warning window (s)' },
      { key: 'lockTime', desc: 's after start when the aim freezes' },
      { key: 'color', desc: 'VFX color' },
      { key: 'radius', desc: 'reticle size (px)' },
      { key: 'tracking', desc: 'follow the target until lockTime' },
      { key: 'beamDuration', desc: 'beam active time (s)' },
      { key: 'beamWidth', desc: 'damaging thickness (px)' },
      { key: 'beamLength', desc: 'reach along the axis (px)' },
      { key: 'damage', desc: 'damage per tick' },
      { key: 'tickRate', desc: 'damage ticks per second' },
      { key: 'team', desc: 'ally | foe | neutral' },
      { key: 'beamStyle', desc: 'Effect Engine beam params override' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('targetedBeam', null, declaredEffectsOf('targetedBeam'));
    const pt0 = aimPoint(params, ctx);
    h.state = { t: 0, done: false, pt: pt0, locked: null, _fx: null };

    // Fire the telegraph effect ONCE. Fixed-mode instance (null carrier):
    // THIS macro owns tracking by mutating body.origin each step.
    // Duration covers warning + beam lifetime so the same instance
    // survives the beam. lockAt drives the effect's own zoom/blink
    // lock-on visual.
    try {
      h.state._fx = fireDeclared({
        type: 'target-reticle',
        params: {
          x: pt0.x, y: pt0.y, color: params.color, size: params.radius,
          duration: params.duration + params.beamDuration, pulseRate: 1,
          lockAt: params.lockTime > 0 ? params.lockTime : null,
        },
      });
    } catch {
      h.state._fx = null; // unknown type in a minimal context — timing only
    }

    let fired = false;
    h.step = (dt, targets) => {
      const s = h.state;
      if (s.done && !h.beam?.alive) return true; // beam finished, macro done
      s.t += dt;

      // Track the target until lockTime, then freeze the aim point.
      if (!s.locked && (!params.tracking || params.lockTime == null || s.t >= params.lockTime)) {
        s.locked = aimPoint(params, ctx);
        s.pt = s.locked;
      } else if (params.tracking && !s.locked) {
        s.pt = aimPoint(params, ctx);
      }
      // Move the live effect with the aim (no re-fire).
      if (s._fx?.body) s._fx.body.origin = { x: s.pt.x, y: s.pt.y };

      // Dismiss the reticle once the beam is active (it served its purpose).
      if (fired && s._fx?.body) {
        try { s._fx.complete?.(); } catch { /* noop */ }
        s._fx = null;
      }

      if (s.t < params.duration) return false;
      if (!fired) {
        fired = true;
        const pt = s.locked ?? s.pt;
        const { origin, angle } = gunTipAndDir(ctx.attacker, null, pt);
        const beam = invoke('beam', {
          origin,
          direction: angle,
          length: params.beamLength,
          width: params.beamWidth,
          duration: params.beamDuration,
          damage: params.damage,
          tickRate: params.tickRate,
          team: params.team,
          style: params.beamStyle,
        }, ctx);
        if (beam) {
          h.beam = beam;
          beam.on('hit', (info) => h._emit('hit', info));
          beam.on('complete', () => h._emit('complete', { point: pt }));
        }
        h._complete({ point: pt });
      }
      // Keep stepping the beam while it's active.
      if (h.beam && !h.beam.done) {
        h.beam.step(dt, targets ?? []);
      }
      return h.beam ? h.beam.done : true;
    };

    h.cancel = () => {
      try { h.state._fx?.complete?.(); } catch { /* noop */ }
      h.state._fx = null;
      h.beam?.cancel?.();
    };
    return h;
  },
});
