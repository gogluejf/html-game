// Attack Engine — Stomp (macro, doc §16). ONE object, one id.
//
// Telegraph once → [tiny hop → land: impact payload + dust + screen shake] × count.
//
// The stomp is a SURFACE-AWARE AREA ATTACK with THREE impact shapes, chosen by
// the `impact` param (one macro, no forks):
//   • 'strike' (DEFAULT) — the ground-slam: invokes the surfaceStrike primitive
//     at the impact point. Every surface under the span (floor/platforms/blocks)
//     gets a hot band; you JUMP to dodge. The modern default — "the floor just
//     became deadly".
//   • 'radius' — the classic circular blast around the impact point (own
//     single-frame check, no primitive invoke): damages everyone inside the
//     circle, ground AND airborne. You SIDESTEP or jump over it.
//   • 'wave' — the old stompWave behavior: one Surface Wave per `sides` rolls
//     out along the surface from the impact point. You move out of the path.
//
// All three share the SAME skeleton: telegraph (style adapts per mode) → tiny
// hop → impact juice (dust + camera shake fire on EVERY impact, even when
// nothing is hit). Only the damage shape differs.
//
// Composition:
//   telegraph (once) → repeat count times: [hop → land: impact payload +
//   dust-cloud + camera-shake → interval]
//
// Handle shape:
//   h.step(dt, targets) — advance the sequence; true when all stomps done
//   state.phase         — current phase (for VFX/theater rendering)
//   state.impact        — { x, y } of the last impact (dust/shake placement)
//   h.strike / h.waves  — live child handles for the current impact (theater)
//   hit / complete      — hit per damaged target; complete { stomps }

import { defineMacro } from '../defineMacro.js';
import { AttackHandle, invoke } from '../engine.js';
import { fireDeclared } from '../../../effects/index.js';
import { makeContext } from '../context.js';

// Ensure the payload primitives/macros are registered.
import '../primitives/surfaceStrike.js';
import '../primitives/surfaceWave.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel renders).
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}
import { getPrimitive, getMacro } from '../registry.js';

const DEFAULTS = Object.freeze({
  // --- Impact shape ----------------------------------------------------------
  impact: 'strike',       // 'strike' | 'radius' | 'wave'
  // --- Telegraph timing (absolute seconds; the effect derives its total) ---
  buildTime: 0.9,         // grow/expand phase (s)
  gapTime: 0.4,           // silence hold ("be ready")
  blinkTime: 0.5,         // final warning blinks (s)
  impactDelay: 0.1,       // beat AFTER the warning, BEFORE the hop/slam
                          // (macro-only — the effect finishes at blink end)
  // --- Pattern ----------------------------------------------------------------
  count: 1,               // number of stomps
  interval: 0.5,          // pause between stomps (s)
  hopHeight: 10,          // tiny visual hop offset (px)
  hopTime: 0.12,          // hop duration (s) — up then down
  // --- Shared impact tuning ----------------------------------------------------
  damage: 30,             // impact damage (all modes)
  team: 'neutral',        // who the stomp hurts (area hazard default)
  method: 'stomp',        // damage() telemetry label (radius mode)
  dustStyle: null,        // dust-cloud effect override
  shakeStrength: 5,       // camera shake intensity on impact
  // --- 'radius' mode ------------------------------------------------------------
  radius: 590,            // blast radius around the impact point (px)
  // --- 'strike' mode (surfaceStrike passthrough) --------------------------------
  strike: {
    width: Infinity,      // horizontal span (Infinity = full surface extents)
    height: 30,           // dangerous area height above each surface (px)
    reach: Infinity,      // vertical scan window (Infinity = every surface)
    duration: 0.35,       // s the bands stay hot
  },
  // --- 'wave' mode (old stompWave behavior) --------------------------------------
  wave: {
    sides: 'both',        // 'left' | 'right' | 'both'
    speed: 300,           // px/s along the surface
    height: 24,           // dangerous area height above the surface (px)
    width: 28,            // leading-edge length (px)
    ttl: null,            // wave lifetime cap (s); null = until surface ends
  },
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
 * Resolve the stomp's own radius blast ('radius' mode). Single-frame circular
 * check: every live target whose CENTER is within `radius` of the impact point
 * takes damage through its real takeDamage() (engine pipeline). No explosion
 * primitive, no blast VFX — the stomp IS the attack.
 *
 * @param {object} p     merged params (radius, damage, method)
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
  attacks: [
    { id: 'surfaceStrike', role: 'payload' },  // impact: 'strike'
    { id: 'surfaceWave', role: 'payload' },    // impact: 'wave' (one per side)
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Stomp',
    desc: 'Telegraph → tiny hop → land: impact payload (strike/radius/wave) + dust + screen shake. Repeats `count` times with an interval.',
    effects: [
      { type: 'dust-cloud', desc: 'ground dust puff at the impact point (every impact)' },
      { type: 'camera-shake', desc: 'shake on impact' },
      { type: 'hit-sparkle', desc: 'blood-like sparkle on each target struck (radius mode)' },
      { type: 'telegraph-circle', desc: 'warning marker sized/styled per impact mode' },
    ],
    params: [
      { key: 'impact', desc: "'strike' | 'radius' | 'wave'" },
      { key: 'buildTime', desc: 'telegraph grow (s)' },
      { key: 'gapTime', desc: 'telegraph silence (s)' },
      { key: 'blinkTime', desc: 'telegraph final warning (s)' },
      { key: 'impactDelay', desc: 'beat after warning, before slam (s)' },
      { key: 'count', desc: 'number of stomps' },
      { key: 'interval', desc: 'pause between stomps (s)' },
      { key: 'hopHeight', desc: 'tiny pre-impact hop (px, visual only)' },
      { key: 'damage', desc: 'impact damage (all modes)' },
      { key: 'team', desc: "who the stomp hurts" },
      { key: 'shakeStrength', desc: 'camera shake on impact' },
      { key: 'radius', desc: "blast radius (px) — 'radius' mode" },
      { key: 'strike.width', desc: "span width (px) — 'strike' mode" },
      { key: 'strike.height', desc: "band height (px) — 'strike' mode" },
      { key: 'strike.duration', desc: "hot window (s) — 'strike' mode" },
      { key: 'wave.sides', desc: "'left' | 'right' | 'both' — 'wave' mode" },
      { key: 'wave.speed', desc: 'travel speed (px/s) — \'wave\' mode' },
      { key: 'wave.height', desc: 'dangerous height (px) — \'wave\' mode' },
      { key: 'wave.ttl', desc: 'wave lifetime cap (s) — \'wave\' mode' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    p.strike = { ...DEFAULTS.strike, ...(params.strike ?? {}) };
    p.wave = { ...DEFAULTS.wave, ...(params.wave ?? {}) };
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
    h.strike = null;     // live surfaceStrike handle ('strike' mode)
    h.waves = [];        // live surfaceWave handles ('wave' mode)

    /** Fire the mode-specific payload at the impact point. Returns the child handle(s). */
    const firePayload = (pt) => {
      if (p.impact === 'strike') {
        // Ground slam: every surface under the span burns. The primitive owns
        // its own impact shake + melee hit juice; we still fire our shared
        // dust below. Its internal shake would double ours, so pass 0.
        const s = invoke('surfaceStrike', {
          x: pt.x, y: pt.y,
          width: p.strike.width,
          height: p.strike.height,
          reach: p.strike.reach,
          duration: p.strike.duration,
          damage: p.damage,
          team: p.team,
          shakeStrength: 0, // the macro owns the shared impact shake
        }, ctx);
        s.on('hit', (...args) => h._emit('hit', ...args));
        h.strike = s;
        return [s];
      }
      if (p.impact === 'wave') {
        // Old stompWave behavior: one Surface Wave per side rolls out.
        const sidesList = p.wave.sides === 'both' ? ['left', 'right'] : [p.wave.sides];
        h.waves = [];
        for (const dir of sidesList) {
          const w = invoke('surfaceWave', {
            x: pt.x, y: pt.y,
            direction: dir,
            speed: p.wave.speed,
            height: p.wave.height,
            width: p.wave.width,
            damage: p.damage,
            ttl: p.wave.ttl,
            team: p.team,
          }, ctx);
          w.on('hit', (...args) => h._emit('hit', ...args));
          h.waves.push(w);
        }
        return h.waves;
      }
      // 'radius' (and fallback): own single-frame circular check.
      const hits = resolveStompBlast(p, ctx, pendingTargets);
      for (const hit of hits) {
        h._emit('hit', hit);
        fireDeclared({ type: 'hit-sparkle', params: { x: hit.target.x + hit.target.w / 2, y: hit.target.y + hit.target.h / 2, count: 6 } }, h.declaredEffectTypes());
      }
      return [];
    };

    const doImpact = () => {
      const pt = stompImpactPoint(ctx.attacker);
      h.state.impact = pt;
      h.state.phase = 'impact';
      h.state.t = 0;

      const children = firePayload(pt);

      // Impact juice via the REAL Effect Engine: fires on every impact, even
      // when nothing is hit. (Child payloads own their extra juice.)
      fireDeclared({ type: 'dust-cloud', params: { x: pt.x, y: pt.y, particleCount: 16, lifetime: 0.5, ...(p.dustStyle ?? {}) } }, h.declaredEffectTypes());
      fireDeclared({ type: 'camera-shake', params: { intensity: p.shakeStrength } }, h.declaredEffectTypes());

      // Radius mode is instant (no children to settle) → skip straight to the
      // impact hold. Strike/wave modes settle their children first.
      if (children.length === 0) {
        h.state.phase = 'settle';
        h.state.t = 0;
      }
    };

    h.step = (dt, targets) => {
      const s = h.state;
      if (s.done) return true;
      if (targets) pendingTargets = targets;
      s.t += dt;

      switch (s.phase) {
        case 'telegraph': {
          // The warning is ALWAYS the expanding circle sized to `radius` —
          // the shared "GET OUT of this zone" read, regardless of impact mode.
          // (Strike/wave damage shapes differ from the circle, but the radius
          // param is the macro's single threat-size knob and the player reads
          // it as "this big an area is about to slam".)
          if (s.t <= dt && !s.telegraphFired) {
            s.telegraphFired = true;
            const pt = stompImpactPoint(ctx.attacker);
            fireDeclared({ type: 'telegraph-circle', params: {
              x: pt.x, y: pt.y - 8,
              radius: p.radius,
              expand: true,
              buildTime: p.buildTime, gapTime: p.gapTime, blinkTime: p.blinkTime,
            } }, h.declaredEffectTypes());
          }
          if (s.t >= teleTotal + p.impactDelay) { s.phase = 'hop'; s.t = 0; }
          break;
        }

        case 'hop': {
          // Tiny parabola: up then back down over hopTime. Visual only —
          // the host can offset the sprite by s.hopOffset.
          const k = Math.min(1, s.t / Math.max(0.001, p.hopTime));
          s.hopOffset = Math.sin(k * Math.PI) * p.hopHeight;
          if (k >= 1) { s.hopOffset = 0; doImpact(); }
          break;
        }

        case 'impact': {
          // Children are live (strike window open / waves traveling). Step
          // them with the LIVE targets from this frame (not the pendingTargets
          // snapshot): the old stompWave passed fresh targets every frame, so
          // enemies walking into a traveling wave still got hit. The snapshot
          // is only correct for the single-frame radius blast above.
          const live = targets ?? pendingTargets;
          let allDone = true;
          if (h.strike) {
            const fin = typeof h.strike.step === 'function' ? h.strike.step(dt, live) : true;
            if (fin || h.strike._completed) { h.strike = null; } else allDone = false;
          }
          for (let i = h.waves.length - 1; i >= 0; i--) {
            const w = h.waves[i];
            const finished = typeof w.step === 'function' ? w.step(dt, live) : true;
            if (finished) h.waves.splice(i, 1);
            else allDone = false;
          }
          if (allDone) { s.phase = 'settle'; s.t = 0; }
          break;
        }

        case 'settle': {
          // Brief hold so the dust/shake read, then interval or finish.
          if (s.t >= 0.12) {
            s.stompIndex++;
            if (s.stompIndex >= n) {
              s.done = true;
              h._complete({ stomps: s.stompIndex, impact: p.impact });
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
