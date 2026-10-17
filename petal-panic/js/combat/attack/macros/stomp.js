// Attack Engine — Stomp (macro, doc §16). ONE object, one id.
//
// Telegraph once → [tiny hop → land: radius blast + dust + screen shake] × count.
//
// The stomp is a SURFACE-AWARE AREA ATTACK: on impact a circular radius around
// the impact point damages everyone inside it (enemies on the ground AND on
// platforms — if they're in the circle they get hit; above the radius they
// don't). The attacker does a very small hop before landing — just enough to
// read that it moved. Dust puff + camera shake fire on EVERY impact, even when
// nothing is hit.
//
// Composition (per the doc):
//   telegraph (once) → repeat count times: [hop → land: explosion(radius) +
//   dust-cloud + camera-shake → interval]
//
// The damage itself is the Explosion primitive (single resolveExplosion path,
// radial knockback included). Hop/dust/shake are presentation owned by this
// macro — the host renders h.state.phase ('telegraph' | 'hop' | 'impact' |
// 'interval') and reads h.state.impact {x,y} for placement.
//
// Handle shape:
//   h.step(dt, targets) — advance the sequence; true when all stomps done
//   state.phase         — current phase (for VFX/theater rendering)
//   state.impact        — { x, y } of the last impact (dust/shake placement)
//   hit / complete      — hits forwarded from the blast; complete { stomps }

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { Effects } from '../../../effects.js';

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
  radius: 70,             // blast radius around the impact point (px)
  damage: 30,             // stomp damage (everyone in the radius)
  team: 'neutral',        // who the stomp hurts (area hazard default)
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

defineMacro('stomp', {
  attacks: [{ id: 'explosion', role: 'payload' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Stomp',
    desc: 'Telegraph → tiny hop → land: circular radius blast + dust + screen shake. Repeats `count` times with an interval.',
    effects: [], // blast burst/shake inherited from Explosion via resolveEffects()
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
    const h = new AttackHandle('stomp');
    const fx = ctx.effects ?? Effects;
    const n = Math.max(1, Math.floor(p.count));
    const teleTotal = telegraphTotal(p); // grow + silence + warning

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

      // Damage: circular radius via the single explosion path. Suppress the
      // explosion's own flash (a stomp is not a bomb going off) but keep its
      // burst; the stomp adds its OWN dust + stronger shake at the feet.
      // The blast resolves against world targets (gameplay passes them in
      // ctx.world.targets); `targets` here are for the host's step loop.
      const blast = invoke('explosion', {
        x: pt.x, y: pt.y - 8,
        radius: p.radius,
        damage: p.damage,
        team: p.team,
        self: ctx.attacker,
        screenFlash: false,
        shake: false, // the macro owns the shake (tuned strength)
      }, ctx);
      blast.on('hit', (...x) => h._emit('hit', ...x));
      // Surface the blast summary as hit events so hosts that subscribe
      // BEFORE stepping still see who was hit (the blast is synchronous).
      if (blast._lastResult?.hit?.length) {
        for (const t of blast._lastResult.hit) h._emit('hit', { target: t, dealt: p.damage });
      }

      // Impact juice via the REAL Effect Engine (effects.md #20 dust-cloud,
      // #13 camera-shake): fires on every impact, even when nothing is hit.
      fx.fireManual?.({ type: 'dust-cloud', params: { x: pt.x, y: pt.y, particleCount: 16, lifetime: 0.5, ...(p.dustStyle ?? {}) } });
      fx.triggerShake?.(p.shakeStrength);
    };

    h.step = (dt, targets) => {
      const s = h.state;
      if (s.done) return true;
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
            fx.fireManual?.({ type: 'telegraph-circle', params: { x: pt.x, y: pt.y - 8, radius: p.radius, expand: true, buildTime: p.buildTime, gapTime: p.gapTime, blinkTime: p.blinkTime } });
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

    // Zero-telegraph + synchronous hosts may want the first impact immediately;
    // the step-based contract still applies (host calls h.step each frame).
    return h;
  },
});
