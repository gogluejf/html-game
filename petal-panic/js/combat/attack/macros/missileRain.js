// Attack Engine — Missile Rain (macro, doc §7). ONE object, one id.
//
// N Sky Missiles with staggered positions/timing plus the launch-up visual:
// rockets fire upward from the attacker (subtle sine drift while ascending —
// visual only), leave the play area, ground markers appear at the landing
// points, and the missiles drop straight down on the marked spots.
//
// Composition: this macro OWNS the pattern (position math, ordering, timing)
// and the ascent visuals; each missile OWNS its own marker → delay → drop
// sequence via the skyMissile macro. Callers configure; they never rebuild
// the sequence.
//
// Ascent visuals are fired through fireDeclared as 'trail' effects riding the
// rocket x position — the declared type is a VFX choice, swappable per call
// via `projectileStyle` without touching the drop logic.
//
// Handle shape:
//   h.step(dt, targets) — advance the rain; true when every missile is done
//   state.missiles      — live skyMissile handles
//   state.positions     — resolved landing x's (pattern output, for tests/theater)
//   hit / complete      — hits forwarded from children; complete { count }

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { fireDeclared } from '../../../effects/index.js';
import { VIEW_W } from '../../../core/view.js';

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
  count: 5,               // missiles in the rain
  xCoordinate: null,      // center x for the pattern; null → view center
  distanceType: 'fixed',  // 'fixed' | 'relative'
  distance: 90,           // fixed spacing around the center (px); 0 = all at center
  pattern: 'simultaneous',// 'simultaneous' | 'sequential'
  interval: 0.35,         // sequential: s between missile activations
  coordination: 'from_left', // sequential order: 'from_left' | 'from_right' | 'random'
  launchInterval: 0.12,   // s between rockets during the upward burst
  ascentSpeed: 900,       // px/s upward travel of the launch visual
  ascentOscillation: 6,   // sine drift amplitude while rising (px, visual only)
  fallDelay: 0,           // extra s after ascent before the warning phase begins
  timeToTarget: 1.0,      // per-missile marker → impact window (s)
  descentSpeed: 500,      // per-missile fall speed (px/s)
  dropHeight: 260,        // per-missile spawn height above the impact (px)
  damage: 30,             // per-missile contact + blast damage
  radius: 60,             // per-missile blast radius (px)
  team: 'foe',            // who the falling carriers hurt
  blastTeam: 'neutral',   // who the blasts hurt
  size: 14,               // carrier box size (px)
  margin: 40,             // keep landing positions this far inside the view
  seed: null,             // optional RNG seed for 'random' coordination (determinism)
  markerStyle: null,      // ground-target-marker override (passed to each missile)
  projectileStyle: null,  // ascent-visual effect override
});

/**
 * Resolve the landing x positions for the rain.
 *
 * fixed:    center ± i·distance for i in -(n-1)/2..(n-1)/2. If the pattern
 *           would leave the playable span [margin, VIEW_W-margin], the SPACING
 *           is shrunk so the whole pattern fits (positions stay symmetric).
 * relative: n positions evenly distributed edge-to-edge across the usable
 *           span, independent of `distance`.
 *
 * @param {object} p merged params (count, xCoordinate, distanceType, distance, margin)
 * @returns {number[]} landing x's, centered order (not activation order)
 */
export function resolvePositions(p) {
  const n = Math.max(1, Math.floor(p.count));
  const lo = p.margin ?? 40;
  const hi = (typeof VIEW_W === 'number' ? VIEW_W : 960) - (p.margin ?? 40);
  const center = typeof p.xCoordinate === 'number' ? p.xCoordinate : (lo + hi) / 2;
  if (n === 1) return [Math.min(hi, Math.max(lo, center))];

  let xs;
  if (p.distanceType === 'relative') {
    const span = hi - lo;
    xs = Array.from({ length: n }, (_, i) => lo + (span * i) / (n - 1));
  } else {
    const d = Math.max(0, p.distance ?? 0);
    const half = (n - 1) / 2;
    xs = Array.from({ length: n }, (_, i) => center + (i - half) * d);
    // Fit check: shrink spacing so min/max land inside the usable span.
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    if (minX < lo || maxX > hi) {
      const needed = Math.max(minX - lo, maxX - hi, 0);
      const scale = d > 0 ? (d - 2 * needed / (n - 1)) / d : 0;
      const d2 = Math.max(0, d * scale);
      xs = xs.map((x) => center + (x - center) * (d2 / (d || 1)));
    }
  }
  return xs.map((x) => Math.min(hi, Math.max(lo, x)));
}

/** Activation order indices for a sequential rain (doc §7 coordination). */
export function resolveOrder(n, coordination, rng = Math.random) {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (coordination === 'from_right') return idx.reverse();
  if (coordination === 'random') {
    // Fisher-Yates with the caller-supplied rng (tests pass a seeded one).
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
  }
  return idx; // from_left (default): natural order
}

defineMacro('missileRain', {
  attacks: [{ id: 'skyMissile', role: 'payload' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Missile Rain',
    desc: 'N rockets ascend (sine-drift visual) → ground markers at landing points → vertical drops via skyMissile. Pattern: simultaneous or sequential (left/right/random).',
    effects: [
      { type: 'trail', desc: 'ascent visual riding each rocket while it leaves the play area' },
    ],
    params: [
      { key: 'count', desc: 'missiles in the rain' },
      { key: 'xCoordinate', desc: 'center x (null → view center)' },
      { key: 'distanceType', desc: "'fixed' | 'relative'" },
      { key: 'distance', desc: 'fixed spacing around center (px)' },
      { key: 'pattern', desc: "'simultaneous' | 'sequential'" },
      { key: 'interval', desc: 'sequential: s between activations' },
      { key: 'coordination', desc: "'from_left' | 'from_right' | 'random'" },
      { key: 'launchInterval', desc: 's between rockets in the launch burst' },
      { key: 'ascentSpeed', desc: 'launch visual rise speed (px/s)' },
      { key: 'ascentOscillation', desc: 'sine drift amplitude while rising (px)' },
      { key: 'fallDelay', desc: 'extra s after ascent before warnings begin' },
      { key: 'timeToTarget', desc: 'per-missile marker → impact window (s)' },
      { key: 'descentSpeed', desc: 'per-missile fall speed (px/s)' },
      { key: 'damage', desc: 'per-missile contact + blast damage' },
      { key: 'radius', desc: 'per-missile blast radius (px)' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('missileRain', null, declaredEffectsOf('missileRain'));
    const n = Math.max(1, Math.floor(p.count));
    const xs = resolvePositions(p);
    const order = p.pattern === 'sequential' ? resolveOrder(n, p.coordination) : xs.map((_, i) => i);

    // Drop schedule: missile in activation slot k drops at k·interval after
    // the ascent visual finished (+ fallDelay). NOTE: the per-position launch
    // stagger (i·launchInterval) is ASCENT-visual timing only — mixing it into
    // the drop schedule made sequential coordination uneven (from_right slot 0
    // carries the last position's launch offset, shrinking the gap to slot 1
    // until two drops collide). Drops depend on the SLOT, nothing else.
    const ascentDur = 0.45; // visual-only flight time off the top of the view
    const base = ascentDur + p.fallDelay;
    const activateAt = order.map((_, slot) =>
      base + (p.pattern === 'sequential' ? slot * p.interval : 0));

    h.state = {
      phase: 'launch',
      t: 0,
      positions: xs,
      missiles: [],          // live skyMissile handles
      activated: new Array(n).fill(false),
      rockets: xs.map((x) => ({ x, y: (ctx.attacker?.y ?? 0), t: 0, done: false })),
      trails: new Array(n).fill(null), // trail effect instances (ascent visuals)
      done: false,
    };

    const startMissile = (posIdx) => {
      const m = invoke('skyMissile', {
        x: xs[posIdx],
        timeToTarget: p.timeToTarget,
        dropHeight: p.dropHeight,
        fallSpeed: p.descentSpeed,
        damage: p.damage,
        radius: p.radius,
        team: p.team,
        blastTeam: p.blastTeam,
        size: p.size,
        markerStyle: p.markerStyle,
      }, ctx);
      h.state.missiles.push(m);
      // NOTE: no on('complete') → _complete here. Completion is owned by the
      // step loop below (all n activated AND all done) — a callback would fire
      // when the FIRST missile ends and cut the sequential pattern short.
      m.on('hit', (...args) => h._emit('hit', ...args));
    };

    h.step = (dt, targets) => {
      const s = h.state;
      if (s.done) return true;
      s.t += dt;

      // --- Launch burst: rockets rise, sine drift, ONE trail per rocket ----
      if (s.phase === 'launch') {
        for (let i = 0; i < n; i++) {
          const r = s.rockets[i];
          if (r.done) continue;
          const localT = s.t - i * p.launchInterval;
          if (localT < 0) continue;
          r.t = localT;
          r.y -= p.ascentSpeed * dt;
          const drift = Math.sin(localT * 18) * p.ascentOscillation;
          // One persistent trail instance per rocket; addPoint() feeds it the
          // live position each frame (the no-carrier feed path). The ribbon
          // terminates on its own lifetime once the rocket leaves the view.
          if (!s.trails[i]) {
            s.trails[i] = fireDeclared({
              type: 'trail',
              params: { length: 40, width: 5, lifetime: 0.6, ...(p.projectileStyle ?? {}) },
            }, h.declaredEffectTypes());
          }
          s.trails[i]?.addPoint?.(r.x + drift, r.y);
          if (r.y < -40) r.done = true;
        }
        if (s.rockets.every((r) => r.done)) s.phase = 'rain';
      }

      // --- Rain: activate each missile at its scheduled time ----------------
      // Runs on the SAME clock as the launch visuals (not gated behind the
      // phase flip): a drop scheduled at 0.45s must fire at 0.45s even if the
      // last rocket is still ascending. Gating activations on phase === 'rain'
      // made the first two slots land on the transition frame together —
      // the "two missiles at once" bug.
      for (let slot = 0; slot < n; slot++) {
        const posIdx = order[slot];
        if (!s.activated[posIdx] && s.t >= activateAt[slot]) {
          s.activated[posIdx] = true;
          startMissile(posIdx);
        }
      }
      for (const m of s.missiles) m.step(dt, targets);
      if (s.missiles.length === n && s.missiles.every((m) => m._completed)) {
        s.done = true;
        h._complete({ count: n });
        return true;
      }
      return false;
    };

    return h;
  },
});
