// Petal Panic — Lane Sequence macro (attack-macros.md §27/§28 merged).
//
// A telegraphed sequence where the attacker enters from offscreen and attacks
// completely across the screen through each configured Y lane exactly once.
// Per lane: boundary marker → gap → attack (dash or beam) → exit/end →
// interval → next lane.
//
// mode: 'charge'   → charge primitive (distanceType:infinit, announceMarker:true)
// mode: 'beam'  → beam primitive (length:9999, announceMarker:true)
//
// The announcement is HARDCODED ON (not a param) — a lane sequence is by
// definition a telegraphed attack. The announceDelay is passed to the
// primitive's built-in announcement.
//
// The interval starts AFTER the current lane's attack fully ends (beam fade
// complete / dash exited), so the next marker never overlaps the previous
// attack.

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { getPrimitive, getMacro } from '../registry.js';
import { VIEW_W } from '../../../core/view.js';

function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  mode: 'charge',               // 'charge' | 'beam'
  lanes: [150, 270, 390],     // Y positions (world coords)
  laneOrder: 'bottom_to_top', // 'bottom_to_top' | 'top_to_bottom' | 'random'
  sideMode: 'fixed_left',     // 'fixed_left' | 'fixed_right' | 'alternate' | 'random'
  alternateStartSide: 'left', // 'left' | 'right'
  announceDelay: 0.5,         // s the boundary marker stays visible per lane (hardcoded ON)
  // Dash params:
  dashSpeed: 1200,            // px/s
  damage: 20,                 // contact damage during dash / per tick for beam
  knockback: null,            // {x,y} or null (dash only)
  // Laser params:
  beamDuration: 0.8,          // s the beam stays hot per lane
  beamWidth: 24,              // damaging thickness px
  tickRate: 8,                // damage ticks per second (beam only)
  // Shared:
  interval: 0.15,             // pause between lanes (s) — starts after attack ends
  team: 'foe',                // ally | foe
  style: null,                // beam effect style override (beam only)
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

defineMacro('laneSequence', {
  attacks: [{ id: 'charge', role: 'body' }, { id: 'beam', role: 'body' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Lane Sequence',
    effects: [
      { type: 'surface-target-marker', desc: 'boundary telegraph per lane (via primitive announceMarker)' },
      { type: 'beam', desc: 'full-screen beam per lane (mode: beam)' },
    ],
    desc: 'Telegraphed offscreen attack across each Y lane exactly once. mode: dash (charge infinit) or beam (static full-screen line). Announcement hardcoded on.',
    params: [
      { key: 'mode', desc: "'charge' | 'beam'" },
      { key: 'lanes', desc: 'array of Y positions (world coords)' },
      { key: 'laneOrder', desc: "'bottom_to_top' | 'top_to_bottom' | 'random'" },
      { key: 'sideMode', desc: "'fixed_left' | 'fixed_right' | 'alternate' | 'random'" },
      { key: 'alternateStartSide', desc: "'left' | 'right'" },
      { key: 'announceDelay', desc: 's the boundary marker stays visible per lane (default 0.5)' },
      { key: 'dashSpeed', desc: 'px/s (dash mode, default 1200)' },
      { key: 'damage', desc: 'contact damage (dash) / per tick (beam)' },
      { key: 'knockback', desc: '{x,y} or null (dash only)' },
      { key: 'beamDuration', desc: 's the beam stays hot (beam mode, default 0.8)' },
      { key: 'beamWidth', desc: 'damaging thickness px (beam mode, default 24)' },
      { key: 'tickRate', desc: 'damage ticks per second (beam mode, default 8)' },
      { key: 'interval', desc: 'pause between lanes in seconds (default 0.15)' },
      { key: 'team', desc: 'ally | foe' },
      { key: 'style', desc: 'beam effect style override (beam only)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('laneSequence', null, declaredEffectsOf('laneSequence'));
    const laneSeq = resolveLanes(params.lanes, params.laneOrder);
    const n = laneSeq.length;

    h.state = {
      laneIdx: 0,
      phase: 'idle',       // 'idle' | 'attacking' | 'interval' | 'done'
      intervalTimer: 0,
      active: null,        // current charge/beam handle
      done: false,
    };

    /** Position the attacker offscreen (dash mode only). */
    function positionOffscreen(side, y) {
      const a = ctx.attacker;
      if (!a) return;
      a.y = y - (a.h ?? 32) / 2;
      if (side === 'left') a.x = -60;
      else a.x = VIEW_W + 60 - (a.w ?? 32);
    }

    /** Start the attack for the current lane. */
    function startAttack() {
      const s = h.state;
      const y = laneSeq[s.laneIdx];
      const side = resolveSide(params.sideMode, s.laneIdx, params.alternateStartSide);
      const direction = side === 'left' ? 0 : Math.PI;

      let handle;
      if (params.mode === 'beam') {
        const originX = side === 'left' ? -10 : VIEW_W + 10;
        handle = invoke('beam', {
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
      } else {
        // dash
        positionOffscreen(side, y);
        handle = invoke('charge', {
          direction,
          speed: params.dashSpeed,
          distanceType: 'infinit',
          acceleration: 0,
          stopOnObstacle: false,
          bodyDamageOverride: { damage: params.damage, ...(params.knockback ? { knockback: params.knockback } : {}) },
          announceMarker: true,
          announceDelay: params.announceDelay,
          team: params.team,
        }, ctx);
      }

      if (handle) {
        handle.on('hit', (info) => h._emit('hit', info));
        handle.on('complete', () => {
          // Interval starts ONLY after the attack fully ends.
          s.phase = 'interval';
          s.intervalTimer = params.interval;
        });
        s.active = handle;
      }
      s.phase = 'attacking';
    }

    h.step = (dt, targets) => {
      const s = h.state;
      if (s.done) return true;

      switch (s.phase) {
        case 'idle':
          startAttack();
          break;

        case 'attacking':
          if (s.active) s.active.step(dt, targets ?? []);
          break;

        case 'interval':
          s.intervalTimer -= dt;
          if (s.intervalTimer <= 0) {
            s.laneIdx++;
            if (s.laneIdx >= n) {
              s.done = true;
              h._complete({ lanes: n, mode: params.mode });
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
