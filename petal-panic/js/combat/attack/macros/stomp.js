// Attack Engine — Stomp (macro, doc §16). ONE object, one id.
//
// Telegraph once → [tiny hop → land: radius blast + dust + screen shake] × count.
//
// The stomp is a SURFACE-AWARE AREA ATTACK: on impact a circular radius around
// the impact point damages everyone inside it — enemies on the ground AND
// floating in the air, as long as they're inside the circle (above the radius
// they don't). The attacker does a very small hop before landing — just enough
// to read that it moved. Dust puff + camera shake fire on EVERY impact, even
// when nothing is hit.
//
// The stomp owns its OWN radius damage: a single-frame circular check against
// the host's targets, routed through each target's real takeDamage() (the
// engine's damage pipeline). It does NOT invoke the explosion primitive and
// fires no explosion VFX — a stomp reads as ground impact (dust + shake), not
// a bomb going off.
//
// Composition:
//   telegraph (once) → repeat count times: [hop → land: radius damage +
//   dust-cloud + camera-shake → interval]
//
// Handle shape:
//   h.step(dt, targets) — advance the sequence; true when all stomps done
//   state.phase         — current phase (for VFX/theater rendering)
//   state.impact        — { x, y } of the last impact (dust/shake placement)
//   hit / complete      — hit per damaged target; complete { stomps }

import { defineMacro } from '../defineMacro.js';
import { AttackHandle } from '../engine.js';
import { fireDeclared } from '../../../effects/index.js';

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
  surface: 'current',    // 'current' | 'all' (documented; blast is positional)
  // --- Telegraph timing (absolute seconds; the effect derives its total) ---
  buildTime: 0.6,         // circle grows (expand)
  gapTime: 0.4,           // silence hold ("be ready")
  blinkTime: 0.3,         // final warning blinks
  impactDelay: 0.1,       // beat AFTER the warning, BEFORE the hop/slam
                          // (macro-only — the effect finishes at blink end)
  count: 1,               // number of stomps
  interval: 0.5,          // pause between stomps (s)
  hopHeight: 10,          // tiny visual hop offset (px)
  hopTime: 0.12,          // hop duration (s) — up then down
  radius: 90,             // blast radius around the impact point (px)
  damage: 30,             // stomp damage (everyone in the radius)
  team: 'neutral',        // who the stomp hurts (area hazard default)
  method: 'stomp',        // damage() telemetry label
  dustStyle: null,        // dust-cloud effect override
  shakeStrength: 5,       // camera shake intensity on impact
});

/** Total telegraph time (s): grow + silence + warning. */
export function telegraphTotal(p) {
  return (p.buildTime ?? 0) + (p.gapTime ?? 0) + (p.blinkTime ?? 0);
}

/** Impact point: attacker's feet center (world). */
export function stompImpactPoint(attacker) {
  return {
    x: (attacker?.x ?? 0) + (attacker?.w ?? 0) / 2,
    y: (attacker?.y ?? 0) + (attacker?.h ?? 0),
  };
}

/**
 * Resolve the stomp's own radius blast. Single-frame circular check: every
 * live target whose CENTER is within `radius` of the impact point takes
 * damage through its real takeDamage() (engine pipeline). No explosion
 * primitive, no blast VFX — the stomp IS the attack.
 *
 * @param {object} p     merged params (radius, damage, team, method)
 * @param {object} ctx   AttackContext (attacker for self-exclusion/telemetry)
 * @param {Array<object>} targets candidate entities (host-provided)
 * @returns {Array<{target:object, dealt:number}>} hits landed
 */
export function resolveStompBlast(p, ctx, targets) {
  const pt = stompImpactPoint(ctx.attacker);
  const cx = pt.x, cy = pt.y - 8; // slightly above the feet so standing bodies register
  const hits = [];
  for (const t of targets ?? []) {
    if (!t || !t.alive || t === ctx.attacker) continue;
    const dx = (t.x + t.w / 2) - cx;
    const dy = (t.y + t.h / 2) - cy;
    if (Math.hypot(dx, dy) > p.radius) continue;
    const dealt = typeof t.takeDamage === 'function'
      ? t.takeDamage(p.damage, ctx.attacker, p.method ?? 'stomp')
      : 0;
    if (dealt > 0) hits.push({ target: t, dealt });
  }
  return hits;
}

defineMacro('stomp', {
  attacks: [], // self-contained: owns its radius damage, invokes nothing
  params: { ...DEFAULTS },
  meta: {
    name: 'Stomp',
    desc: 'Telegraph → tiny hop → land: own circular radius blast + dust + screen shake. Repeats `count` times with an interval.',
    effects: [
      { type: 'dust-cloud', desc: 'ground dust puff at the impact point (every impact)' },
      { type: 'camera-shake', desc: 'shake on impact' },
      { type: 'hit-sparkle', desc: 'blood-like sparkle on each target the radius catches' },
      { type: 'telegraph-circle', desc: 'warning circle that grows/blinks before the slam' },
    ],
    params: [
      { key: 'surface', desc: "'current' | 'all'" },
      { key: 'buildTime', desc: 'telegraph grow (s)' },
      { key: 'gapTime', desc: 'telegraph silence (s)' },
      { key: 'blinkTime', desc: 'telegraph final warning (s)' },
      { key: 'impactDelay', desc: 'beat after warning, before slam (s)' },
      { key: 'count', desc: 'number of stomps' },
      { key: 'interval', desc: 'pause between stomps (s)' },
      { key: 'hopHeight', desc: 'tiny pre-impact hop (px, visual only)' },
      { key: 'radius', desc: 'blast radius (px)' },
      { key: 'damage', desc: 'damage to everyone in the radius' },
      { key: 'team', desc: "who the stomp hurts" },
      { key: 'shakeStrength', desc: 'camera shake on impact' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('stomp', null, declaredEffectsOf('stomp'));
    const n = Math.max(1, Math.floor(p.count));
    const teleTotal = telegraphTotal(p); // grow + silence + warning
    // Pending targets: the host passes them on every step(); the impact frame
    // consumes the latest set (a stomp lands mid-sequence, not at invoke).
    let pendingTargets = [];

    h.state = {
      phase: teleTotal > 0 ? 'telegraph' : 'hop',
      t: 0,              // time in current phase
      stompIndex: 0,     // stomps landed so far
      impact: null,      // {x,y} of the latest impact
      hopOffset: 0,      // current visual hop offset (px up)
      telegraphFired: false,
      done: false,
    };

    const doImpact = () => {
      const pt = stompImpactPoint(ctx.attacker);
      h.state.impact = pt;
      h.state.phase = 'impact';
      h.state.t = 0;

      // The stomp's OWN radius blast — no explosion invoke, no blast VFX.
      const hits = resolveStompBlast(p, ctx, pendingTargets);
      for (const hit of hits) {
        h._emit('hit', hit);
        // Blood-like hit sparkle on the struck target (design §12): the impact
        // reads as a physical hit, not just numbers going down.
        fireDeclared({ type: 'hit-sparkle', params: { x: hit.target.x + hit.target.w / 2, y: hit.target.y + hit.target.h / 2, count: 6 } }, h.declaredEffectTypes());
      }

      // Impact juice via the REAL Effect Engine (effects.md #20 dust-cloud,
      // #13 camera-shake): fires on every impact, even when nothing is hit.
      fireDeclared({ type: 'dust-cloud', params: { x: pt.x, y: pt.y, particleCount: 16, lifetime: 0.5, ...(p.dustStyle ?? {}) } }, h.declaredEffectTypes());
      fireDeclared({ type: 'camera-shake', params: { intensity: p.shakeStrength } }, h.declaredEffectTypes());
    };

    h.step = (dt, targets) => {
      const s = h.state;
      if (s.done) return true;
      if (targets) pendingTargets = targets;
      s.t += dt;

      switch (s.phase) {
        case 'telegraph':
          // The warning is the REAL Telegraph Circle effect (effects.md #8):
          // expand mode — "GET OUT of this zone" — sized to the blast radius.
          // Phase times are passed in absolute seconds; the effect derives
          // its own total from them.
          if (s.t <= dt && !s.telegraphFired) {
            s.telegraphFired = true;
            const pt = stompImpactPoint(ctx.attacker);
            fireDeclared({ type: 'telegraph-circle', params: { x: pt.x, y: pt.y - 8, radius: p.radius, expand: true, buildTime: p.buildTime, gapTime: p.gapTime, blinkTime: p.blinkTime } }, h.declaredEffectTypes());
          }
          if (s.t >= teleTotal + p.impactDelay) { s.phase = 'hop'; s.t = 0; }
          break;

        case 'hop': {
          // Tiny parabola: up then back down over hopTime. Visual only —
          // the host can offset the sprite by s.hopOffset.
          const k = Math.min(1, s.t / Math.max(0.001, p.hopTime));
          s.hopOffset = Math.sin(k * Math.PI) * p.hopHeight;
          if (k >= 1) { s.hopOffset = 0; doImpact(); }
          break;
        }

        case 'impact': {
          // Brief hold so the dust/shake read, then interval or finish.
          if (s.t >= 0.12) {
            s.stompIndex++;
            if (s.stompIndex >= n) {
              s.done = true;
              h._complete({ stomps: s.stompIndex });
              return true;
            }
            s.phase = 'interval';
            s.t = 0;
          }
          break;
        }

        case 'interval':
          if (s.t >= p.interval) { s.phase = 'hop'; s.t = 0; }
          break;
      }
      return false;
    };

    return h;
  },
});
