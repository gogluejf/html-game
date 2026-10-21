// Petal Panic — Lane Sequence macro (attack-macros.md §27).
//
// A telegraphed sequence where the attacker enters from offscreen and attacks
// completely across the screen through each configured Y lane exactly once.
// Per lane: boundary marker → gap → attack (charge or beam) → exit/end →
// interval → next lane.
//
// mode: 'charge'   → charge primitive (distanceType:infinit, announceMarker:true)
// mode: 'beam'     → beam primitive (length:9999, announceMarker:true)
//
// Lanes are auto-calculated from laneCount + laneSpacing, anchored to the
// ACTIVE ROOM'S FLOOR (getActiveFloorY): lane 0 sits `laneOffset` px above the
// floor and each next lane goes UP by laneSpacing. Override with an explicit
// `lanes` array of absolute Y positions.
//
// The announcement is HARDCODED ON (not a param) — a lane sequence is by
// definition a telegraphed attack. The announceDelay is passed to the
// primitive's built-in announcement.
//
// The interval starts AFTER the current lane's attack fully ends (beam fade
// complete / charge exited), so the next marker never overlaps the previous
// attack.

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { getPrimitive, getMacro } from '../registry.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../hitbox.js';
import { VIEW_W } from '../../../core/view.js';
import { getActiveFloorY } from '../../../world/accessors.js';
import { ZONE_GROUND_Y } from '../../../world/level.js';

/** Fallback floor when no zone context exists (attack theater pre-boot). */
const FALLBACK_FLOOR_Y = ZONE_GROUND_Y;

function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

const DEFAULTS = Object.freeze({
  mode: 'charge',               // 'charge' | 'beam'
  laneCount: 3,                 // number of rows
  laneSpacing: 120,             // px between rows (measured UP from the floor)
  laneOffset: 0,                // px above the floor where lane 0's BOTTOM sits
  lanes: null,                  // explicit absolute Y positions override (if set, count/spacing/offset ignored)
  laneOrder: 'bottom_to_top',   // 'bottom_to_top' | 'top_to_bottom' | 'random'
  sideMode: 'fixed_left',       // 'fixed_left' | 'fixed_right' | 'alternate' | 'random'
  alternateStartSide: 'left',   // 'left' | 'right'
  announceDelay: 0.5,           // s the boundary marker stays visible per lane (hardcoded ON)
  // Charge params:
  dashSpeed: 1200,              // px/s
  damage: 20,                   // contact damage during charge / per tick for beam
  knockback: null,              // {x,y} or null (charge only)
  // Beam params:
  beamDuration: 0.8,            // s the beam stays hot per lane
  beamWidth: 36,                // damaging thickness px
  tickRate: 8,                  // damage ticks per second (beam only)
  // Shared:
  interval: 0.15,               // pause between lanes (s) — starts after attack ends
  team: 'foe',                  // ally | foe
  style: null,                  // beam effect style override (beam only)
});

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Half-height of the attack body per mode — lane Y is the attack CENTER, so
 *  anchoring "bottom on the floor" means center = floor − halfHeight. Reads
 *  the LIVE attacker (charge) or the beam width param (beam). */
function laneHalfHeight(params, ctx) {
  if (params.mode === 'beam') return (params.beamWidth ?? 36) / 2;
  const h = ctx?.attacker?.h;
  return (typeof h === 'number' && h > 0) ? h / 2 : 24; // fallback: standard hero height
}

/** Calculate lane Y positions: anchored to the active room's floor.
 *  Lane 0's BOTTOM sits `offset` px above the floor; each next lane goes UP
 *  by spacing. Returns CENTER y (what beam/charge expect as their origin). */
function calcLanes(count, spacing, offset, params, ctx) {
  const floorY = getActiveFloorY() ?? FALLBACK_FLOOR_Y;
  const hh = laneHalfHeight(params, ctx);
  const lanes = [];
  for (let i = 0; i < count; i++) {
    lanes.push(floorY - hh - offset - i * spacing);
  }
  return lanes;
}

function resolveLanes(params, ctx) {
  // Explicit lanes override auto-calculation.
  const raw = params.lanes ?? calcLanes(params.laneCount, params.laneSpacing, params.laneOffset, params, ctx);
  if (params.laneOrder === 'random') return shuffled(raw);
  if (params.laneOrder === 'top_to_bottom') return [...raw].sort((a, b) => a - b);
  return [...raw].sort((a, b) => b - a); // bottom_to_top (default)
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
    desc: 'Telegraphed offscreen attack across each Y lane exactly once. mode: charge (offscreen dash) or beam (static full-screen line). Lanes anchored to the active room floor: lane 0 BOTTOM at laneOffset above floor, stacked up by laneSpacing.',
    params: [
      { key: 'mode', desc: "'charge' | 'beam'" },
      { key: 'laneCount', desc: 'number of rows (default 3)' },
      { key: 'laneSpacing', desc: 'px between rows, measured up from the floor (default 120)' },
      { key: 'laneOffset', desc: 'px above the floor where lane 0 BOTTOM sits (default 0 = bottom on the ground)' },
      { key: 'lanes', desc: 'explicit absolute Y positions override (null = auto-calc from floor)' },
      { key: 'laneOrder', desc: "'bottom_to_top' | 'top_to_bottom' | 'random'" },
      { key: 'sideMode', desc: "'fixed_left' | 'fixed_right' | 'alternate' | 'random'" },
      { key: 'alternateStartSide', desc: "'left' | 'right'" },
      { key: 'announceDelay', desc: 's the boundary marker stays visible per lane (default 0.5)' },
      { key: 'dashSpeed', desc: 'px/s (charge mode, default 1200)' },
      { key: 'damage', desc: 'contact damage (charge) / per tick (beam)' },
      { key: 'knockback', desc: '{x,y} or null (charge only)' },
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
    const laneSeq = resolveLanes(params, ctx);
    const n = laneSeq.length;
    // Charge is motion-only. This macro owns contact, once per victim per lane,
    // through the same physical hitbox/team routing used by beam.
    const contact = makeHitbox({ owner: ctx.attacker, team: params.team,
      box: null, damage: params.damage, method: 'contact' });

    h.state = {
      laneIdx: 0,
      phase: 'idle',       // 'idle' | 'attacking' | 'interval' | 'done'
      intervalTimer: 0,
      active: null,        // current charge/beam handle
      done: false,
    };

    /** Position the attacker offscreen (charge mode only). */
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
        // charge
        positionOffscreen(side, y);
        resetHitbox(contact);
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
          if (s.active) {
            if (params.mode === 'beam') {
              s.active.step(dt, targets ?? []);
            } else {
              const before = s.active.state.traveled;
              s.active.step(dt); // charge accepts obstacle input, NOT targets
              // No contact during the announcement/gap or interval.
              if (s.active.state.traveled > before && ctx.attacker) {
                const a = ctx.attacker;
                contact.box = a.worldBox ? a.worldBox() : { x: a.x, y: a.y, w: a.w, h: a.h };
                processHitboxes([contact], targets ?? [], (_hb, target, dealt) => {
                  h._emit('hit', { target, dealt });
                });
              }
            }
          }
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
