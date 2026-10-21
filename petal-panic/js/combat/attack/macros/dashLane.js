// Petal Panic — Dash Lane macro (attack-macros.md §20).
//
// A telegraphed sequence where the attacker enters from offscreen and dashes
// completely across the screen through each configured Y lane exactly once.
// Per lane: boundary marker (via charge's announceMarker) → dash across →
// exit → interval → next lane.
//
// The macro is a thin loop: it picks row + side per lane, positions the
// attacker offscreen, and invokes the charge primitive with
// distanceType:'infinit' + announceMarker:true. The charge handles the
// marker, gap, straight-line motion, and offscreen stop. The macro owns the
// lane ordering, side selection, and inter-lane pause.
//
// Params:
//   lanes          — array of Y positions (world coords)
//   laneOrder      — 'bottom_to_top' | 'top_to_bottom' | 'random'
//   sideMode       — 'fixed_left' | 'fixed_right' | 'alternate' | 'random'
//   alternateStartSide — 'left' | 'right' (for sideMode 'alternate')
//   announceDelay  — s the boundary marker stays visible per lane (default 1.0)
//   dashSpeed      — px/s (default 700)
//   damage         — contact damage during dash (default 20)
//   knockback      — {x,y} or null (default null)
//   interval       — pause between lanes in seconds (default 0.4)
//   team           — ally | foe (default 'foe')

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { getPrimitive, getMacro } from '../registry.js';
import { VIEW_W, VIEW_H } from '../../../core/view.js';

// Declared effect types for THIS registration.
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  lanes: [150, 270, 390],     // Y positions (world coords)
  laneOrder: 'bottom_to_top', // 'bottom_to_top' | 'top_to_bottom' | 'random'
  sideMode: 'fixed_left',     // 'fixed_left' | 'fixed_right' | 'alternate' | 'random'
  alternateStartSide: 'left', // 'left' | 'right'
  announceDelay: 1.0,         // s the boundary marker stays visible per lane
  dashSpeed: 700,             // px/s
  damage: 20,                 // contact damage during dash
  knockback: null,            // {x,y} or null
  interval: 0.4,              // pause between lanes (s)
  team: 'foe',                // ally | foe
});

/** Shuffle an array (Fisher-Yates, non-mutating). */
function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Resolve the lane order into a sequence of Y values. */
function resolveLanes(lanes, order) {
  if (order === 'random') return shuffled(lanes);
  if (order === 'top_to_bottom') return [...lanes].sort((a, b) => a - b);
  // default: bottom_to_top
  return [...lanes].sort((a, b) => b - a);
}

/** Resolve the entry side for a given lane index. Returns 'left' or 'right'. */
function resolveSide(sideMode, idx, altStart) {
  switch (sideMode) {
    case 'fixed_right': return 'right';
    case 'alternate': {
      const start = altStart === 'right' ? 1 : 0;
      return (start + idx) % 2 === 0 ? 'left' : 'right';
    }
    case 'random': return Math.random() < 0.5 ? 'left' : 'right';
    default: return 'left'; // fixed_left
  }
}

defineMacro('dashLane', {
  attacks: [{ id: 'charge', role: 'body' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Dash Lane Sequence',
    effects: [
      { type: 'surface-target-marker', desc: 'boundary telegraph per lane (via charge announceMarker)' },
    ],
    desc: 'Telegraphed offscreen dash across each configured Y lane exactly once. Reuses the charge primitive (distanceType:infinit, announceMarker:true) per lane.',
    params: [
      { key: 'lanes', desc: 'array of Y positions (world coords)' },
      { key: 'laneOrder', desc: "'bottom_to_top' | 'top_to_bottom' | 'random'" },
      { key: 'sideMode', desc: "'fixed_left' | 'fixed_right' | 'alternate' | 'random'" },
      { key: 'alternateStartSide', desc: "'left' | 'right' (for alternate mode)" },
      { key: 'announceDelay', desc: 's the boundary marker stays visible per lane (default 1.0)' },
      { key: 'dashSpeed', desc: 'px/s (default 700)' },
      { key: 'damage', desc: 'contact damage during dash (default 20)' },
      { key: 'knockback', desc: '{x,y} or null' },
      { key: 'interval', desc: 'pause between lanes in seconds (default 0.4)' },
      { key: 'team', desc: 'ally | foe' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('dashLane', null, declaredEffectsOf('dashLane'));
    const laneSeq = resolveLanes(params.lanes, params.laneOrder);
    const n = laneSeq.length;

    h.state = {
      laneIdx: 0,
      phase: 'idle',       // 'idle' | 'dashing' | 'interval' | 'done'
      intervalTimer: 0,
      charge: null,
      done: false,
    };

    /** Position the attacker offscreen on the given side at the given Y. */
    function positionOffscreen(side, y) {
      const a = ctx.attacker;
      if (!a) return;
      a.y = y - (a.h ?? 32) / 2;
      if (side === 'left') a.x = -60;
      else a.x = VIEW_W + 60 - (a.w ?? 32);
    }

    /** Start the dash for the current lane. */
    function startDash() {
      const s = h.state;
      const y = laneSeq[s.laneIdx];
      const side = resolveSide(params.sideMode, s.laneIdx, params.alternateStartSide);
      positionOffscreen(side, y);

      const direction = side === 'left' ? 0 : Math.PI;
      const charge = invoke('charge', {
        direction,
        speed: params.dashSpeed,
        distanceType: 'infinit',
        acceleration: 0, // instant full speed (the announcement IS the ramp-up)
        stopOnObstacle: false, // cross the full screen regardless
        bodyDamageOverride: { damage: params.damage, ...(params.knockback ? { knockback: params.knockback } : {}) },
        announceMarker: true,
        announceDelay: params.announceDelay,
        team: params.team,
      }, ctx);
      if (charge) {
        charge.on('hit', (info) => h._emit('hit', info));
        charge.on('complete', () => {
          s.phase = 'interval';
          s.intervalTimer = params.interval;
        });
        s.charge = charge;
      }
      s.phase = 'dashing';
    }

    h.step = (dt, targets) => {
      const s = h.state;
      if (s.done) return true;

      switch (s.phase) {
        case 'idle':
          startDash();
          break;

        case 'dashing':
          if (s.charge) s.charge.step(dt, targets ?? []);
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
