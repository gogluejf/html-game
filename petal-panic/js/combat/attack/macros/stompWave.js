// Attack Engine — Stomp Wave (macro, doc §17). ONE object, one id.
//
// Telegraph → tiny hop → land: dust + screen shake at the impact spot →
// one Surface Wave per side rolls out from there.
//
// The macro owns the PATTERN, not the geometry: it invokes the surfaceWave
// primitive once per side it wants (`sides: 'both'` = two invokes, one with
// direction 'left', one with direction 'right'). The direction parameter
// lives on the primitive only. Wave termination (ttl / end of surface /
// solid block) is owned by the primitive.
//
// Handle shape:
//   h.step(dt, targets) — advances the sequence AND steps live waves;
//                         true when the stomp landed and every wave died
//   state.phase         — 'telegraph' | 'hop' | 'waves'
//   state.impact        — {x,y} impact point (dust/shake placement)
//   h.waves             — live surfaceWave handles (theater can render them)
//   hit / complete      — hits forwarded from the waves; complete { waves }

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
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
  // --- Telegraph timing (absolute seconds; the effect derives its total) ---
  buildTime: 0.6,         // circle grows (expand)
  gapTime: 0.4,           // silence hold ("be ready")
  blinkTime: 0.3,         // final warning blinks
  impactDelay: 0.1,       // beat AFTER the warning, BEFORE the hop/waves
                          // (macro-only — the effect finishes at blink end)
  sides: 'both',          // 'left' | 'right' | 'both'
  hopHeight: 10,          // tiny visual hop (px)
  hopTime: 0.12,          // hop duration (s)
  waveSpeed: 300,         // px/s along the surface
  waveHeight: 24,         // dangerous area height above the surface (px)
  waveWidth: 28,          // leading-edge length (px)
  damage: 20,             // per target (each target hit once per wave)
  ttl: null,              // wave lifetime cap (s); null = until surface ends
  team: 'neutral',        // who the waves hurt (area hazard default)
  dustStyle: null,        // dust-cloud effect override
  shakeStrength: 5,       // camera shake on impact
});

/** Impact point: attacker's feet center (world). */
export function stompWaveImpactPoint(attacker) {
  return {
    x: (attacker?.x ?? 0) + (attacker?.w ?? 0) / 2,
    y: (attacker?.y ?? 0) + (attacker?.h ?? 0),
  };
}

defineMacro('stompWave', {
  attacks: [{ id: 'surfaceWave', role: 'payload' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Stomp Wave',
    desc: 'Telegraph → tiny hop → land: dust + screen shake, then a surface wave rolls out per side. Waves die on ttl / surface end / block.',
    effects: [
      // Own VFX (fired directly by this macro). hit-sparkle is inherited from
      // surfaceWave via resolveEffects() for the panel; it is NOT fired here.
      { type: 'dust-cloud', desc: 'ground dust puff at the impact point' },
      { type: 'camera-shake', desc: 'shake on impact' },
      { type: 'telegraph-circle', desc: 'warning circle that grows/blinks before the slam' },
    ],
    params: [
      { key: 'buildTime', desc: 'telegraph grow (s)' },
      { key: 'gapTime', desc: 'telegraph silence (s)' },
      { key: 'blinkTime', desc: 'telegraph final warning (s)' },
      { key: 'impactDelay', desc: 'beat after warning, before waves (s)' },
      { key: 'sides', desc: "'left' | 'right' | 'both'" },
      { key: 'waveSpeed', desc: 'travel speed (px/s)' },
      { key: 'waveHeight', desc: 'dangerous area height (px)' },
      { key: 'damage', desc: 'per target (once per wave)' },
      { key: 'ttl', desc: 'wave lifetime cap (s); null = unlimited' },
      { key: 'team', desc: "who the waves hurt" },
      { key: 'shakeStrength', desc: 'camera shake on impact' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('stompWave', null, declaredEffectsOf('stompWave'));

    const sidesList = p.sides === 'both' ? ['left', 'right'] : [p.sides];
    const teleTotal = (p.buildTime ?? 0) + (p.gapTime ?? 0) + (p.blinkTime ?? 0);

    h.state = {
      phase: teleTotal > 0 ? 'telegraph' : 'hop',
      t: 0,
      impact: null,
      hopOffset: 0,
      telegraphFired: false,
      done: false,
    };
    h.waves = [];

    const fireWaves = () => {
      const pt = stompWaveImpactPoint(ctx.attacker);
      h.state.impact = pt;
      h.state.phase = 'waves';
      h.state.t = 0;

      for (const dir of sidesList) {
        const w = invoke('surfaceWave', {
          x: pt.x, y: pt.y,
          direction: dir,
          speed: p.waveSpeed,
          height: p.waveHeight,
          width: p.waveWidth,
          damage: p.damage,
          ttl: p.ttl,
          team: p.team,
        }, ctx);
        w.on('hit', (...x) => h._emit('hit', ...x));
        h.waves.push(w);
      }

      // Impact juice via the REAL Effect Engine: dust at the feet + camera
      // shake — fires even if no wave hits anything. (The waves' own crest
      // visuals are owned by the surfaceWave primitive.)
      fireDeclared({ type: 'dust-cloud', params: { x: pt.x, y: pt.y, particleCount: 16, lifetime: 0.5, ...(p.dustStyle ?? {}) } }, h.declaredEffectTypes());
      fireDeclared({ type: 'camera-shake', params: { intensity: p.shakeStrength } }, h.declaredEffectTypes());
    };

    h.step = (dt, targets) => {
      const s = h.state;
      if (s.done) return true;
      s.t += dt;

      if (s.phase === 'telegraph') {
        // Real Telegraph Circle effect (effects.md #8), expand mode — the
        // stomp warning: "GET OUT of this zone" across the impact surface.
        // Phase times in absolute seconds; the effect derives its total.
        if (s.t <= dt && !s.telegraphFired) {
          s.telegraphFired = true;
          const pt = stompWaveImpactPoint(ctx.attacker);
          fireDeclared({ type: 'telegraph-circle', params: { x: pt.x, y: pt.y - 8, radius: 140, expand: true, buildTime: p.buildTime, gapTime: p.gapTime, blinkTime: p.blinkTime } }, h.declaredEffectTypes());
        }
        if (s.t >= teleTotal + p.impactDelay) { s.phase = 'hop'; s.t = 0; }
        return false;
      }

      if (s.phase === 'hop') {
        const k = Math.min(1, s.t / Math.max(0.001, p.hopTime));
        s.hopOffset = Math.sin(k * Math.PI) * p.hopHeight;
        if (k >= 1) { s.hopOffset = 0; fireWaves(); }
        return false;
      }

      // --- waves phase: step every live wave; complete when all are dead ----
      let allDone = true;
      for (let i = h.waves.length - 1; i >= 0; i--) {
        const w = h.waves[i];
        const finished = typeof w.step === 'function' ? w.step(dt, targets ?? []) : true;
        if (finished) h.waves.splice(i, 1);
        else allDone = false;
      }
      if (allDone && h.waves.length === 0) {
        s.done = true;
        h._complete({ waves: sidesList.length });
        return true;
      }
      return false;
    };

    return h;
  },
});
