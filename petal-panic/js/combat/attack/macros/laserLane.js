// Petal Panic — Laser Lane macro (attack-macros.md §23).
//
// Same skeleton as Dash Lane, but instead of a dashing body: a static
// full-screen beam per lane. Per lane: boundary marker (via beam's
// announceMarker) → gap → beam hot for `beamDuration` → off → interval →
// next lane.
//
// The macro is a thin loop: it picks row + side per lane, invokes the beam
// primitive with length:9999 + announceMarker:true. The beam handles the
// marker, gap, ignition, and damage. The macro owns the lane ordering, side
// selection, and inter-lane pause.
//
// Params:
//   lanes          — array of Y positions (world coords)
//   laneOrder      — 'bottom_to_top' | 'top_to_bottom' | 'random'
//   sideMode       — 'fixed_left' | 'fixed_right' | 'alternate' | 'random'
//   alternateStartSide — 'left' | 'right'
//   announceDelay  — s the boundary marker stays visible per lane (default 1.0)
//   beamDuration   — s the beam stays hot per lane (default 1.2)
//   beamWidth      — damaging thickness px (default 24)
//   damage         — damage per tick (default 20)
//   tickRate       — damage ticks per second (default 8)
//   interval       — pause between lanes in seconds (default 0.4)
//   team           — ally | foe (default 'foe')
//   style          — beam effect style override (color, etc.)

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { getPrimitive, getMacro } from '../registry.js';
import { VIEW_W } from '../../../core/view.js';

function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  lanes: [150, 270, 390],
  laneOrder: 'bottom_to_top',
  sideMode: 'fixed_left',
  alternateStartSide: 'left',
  announceDelay: 1.0,
  beamDuration: 1.2,
  beamWidth: 24,
  damage: 20,
  tickRate: 8,
  interval: 0.4,
  team: 'foe',
  style: null,
});

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function resolveLanes(lanes, order) {
  if (order === 'random') return shuffled(lanes);
  if (order === 'top_to_bottom') return [...lanes].sort((a, b) => a - b);
  return [...lanes].sort((a, b) => b - a);
}

function resolveSide(sideMode, idx, altStart) {
  switch (sideMode) {
    case 'fixed_right': return 'right';
    case 'alternate': {
      const start = altStart === 'right' ? 1 : 0;
      return (start + idx) % 2 === 0 ? 'left' : 'right';
    }
    case 'random': return Math.random() < 0.5 ? 'left' : 'right';
    default: return 'left';
  }
}

defineMacro('laserLane', {
  attacks: [{ id: 'beam', role: 'body' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Laser Lane Sequence',
    effects: [
      { type: 'beam', desc: 'the full-screen beam per lane' },
      { type: 'surface-target-marker', desc: 'boundary telegraph per lane (via beam announceMarker)' },
    ],
    desc: 'Telegraphed full-screen static beam per configured Y lane. Reuses the beam primitive (length:9999, announceMarker:true) per lane.',
    params: [
      { key: 'lanes', desc: 'array of Y positions (world coords)' },
      { key: 'laneOrder', desc: "'bottom_to_top' | 'top_to_bottom' | 'random'" },
      { key: 'sideMode', desc: "'fixed_left' | 'fixed_right' | 'alternate' | 'random'" },
      { key: 'alternateStartSide', desc: "'left' | 'right'" },
      { key: 'announceDelay', desc: 's the boundary marker stays visible per lane (default 1.0)' },
      { key: 'beamDuration', desc: 's the beam stays hot per lane (default 1.2)' },
      { key: 'beamWidth', desc: 'damaging thickness px (default 24)' },
      { key: 'damage', desc: 'damage per tick (default 20)' },
      { key: 'tickRate', desc: 'damage ticks per second (default 8)' },
      { key: 'interval', desc: 'pause between lanes in seconds (default 0.4)' },
      { key: 'team', desc: 'ally | foe' },
      { key: 'style', desc: 'beam effect style override' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('laserLane', null, declaredEffectsOf('laserLane'));
    const laneSeq = resolveLanes(params.lanes, params.laneOrder);
    const n = laneSeq.length;

    h.state = {
      laneIdx: 0,
      phase: 'idle',       // 'idle' | 'beaming' | 'interval' | 'done'
      intervalTimer: 0,
      beam: null,
      done: false,
    };

    /** Start the beam for the current lane. */
    function startBeam() {
      const s = h.state;
      const y = laneSeq[s.laneIdx];
      const side = resolveSide(params.sideMode, s.laneIdx, params.alternateStartSide);

      // Beam origin at the entry-side boundary, pointing across the screen.
      const originX = side === 'left' ? -10 : VIEW_W + 10;
      const direction = side === 'left' ? 0 : Math.PI;

      const beam = invoke('beam', {
        origin: { x: originX, y },
        direction,
        length: 9999,
        width: params.beamWidth,
        duration: params.beamDuration,
        damage: params.damage,
        tickRate: params.tickRate,
        team: params.team,
        style: params.style,
        announceMarker: true,
        announceDelay: params.announceDelay,
      }, ctx);
      if (beam) {
        beam.on('hit', (info) => h._emit('hit', info));
        beam.on('complete', () => {
          s.phase = 'interval';
          s.intervalTimer = params.interval;
        });
        s.beam = beam;
      }
      s.phase = 'beaming';
    }

    h.step = (dt, targets) => {
      const s = h.state;
      if (s.done) return true;

      switch (s.phase) {
        case 'idle':
          startBeam();
          break;

        case 'beaming':
          if (s.beam) s.beam.step(dt, targets ?? []);
          break;

        case 'interval':
          s.intervalTimer -= dt;
          if (s.intervalTimer <= 0) {
            s.laneIdx++;
            if (s.laneIdx >= n) {
              s.done = true;
              h._complete({ lanes: n });
              return true;
            }
            s.phase = 'idle';
          }
          break;

        case 'done':
          return true;
      }
      return false;
    };

    return h;
  },
});
