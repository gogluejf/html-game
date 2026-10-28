// Attack Engine — Circus Ball (macro). ONE object, one id.
//
// A striped circus ball thrown on a ballistic arc that bounces FOREVER at a
// constant height with zero velocity loss (the `bounceHeight` constant-apex
// mode of the ballistic primitive), rolling/ping-ponging until its ttl runs
// out or it leaves the screen. Renders the generated circus_ball bounce sheet
// via circusBallDrawer.
//
// "Heavy vs light" feel is two knobs: speed (horizontal px/s) and
// bounceHeight (px apex per bounce). arc/gravity are locked in here because
// bounceHeight owns the visual rhythm after the first landing.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { circusBallDrawer } from '../drawers/index.js';

const DEFAULTS = Object.freeze({
  speed: 400,           // horizontal px/s — constant for the whole life
  direction: -Math.PI / 3, // launch angle (up-left; use +angle for up-right)
  arc: 1800,            // gravity px/s² (shapes the initial throw only)
  bounceHeight: 80,     // px — apex of EVERY bounce (the feel knob)
  damage: 10,           // per enemy contact
  ttl: 6,               // lifetime cap — the only thing that kills it
  size: 28,             // collision box (visual follows via drawer scale)
  origin: null,         // marker label | {x,y} | null → attacker center
  team: 'ally',
});

defineMacro('circusBall', {
  attacks: [{ id: 'ballistic', role: 'carrier' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Circus Ball',
    effects: [
      { type: 'debris', desc: 'landing puff when the carrier dies on terrain' },
    ],
    desc: 'Ballistic arc → constant-height infinite bouncing (no velocity loss), circus_ball sprites. Dies on ttl or off-screen.',
    params: [
      { key: 'speed', desc: 'horizontal px/s (constant)' },
      { key: 'direction', desc: 'launch angle (radians)' },
      { key: 'arc', desc: 'gravity px/s² (initial throw shape)' },
      { key: 'bounceHeight', desc: 'px apex per bounce (feel knob)' },
      { key: 'damage', desc: 'damage per enemy contact' },
      { key: 'ttl', desc: 'lifetime seconds' },
      { key: 'size', desc: 'collision box px' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
      { key: 'team', desc: 'ally | foe' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    return invoke('ballistic', {
      speed: p.speed,
      direction: p.direction,
      arc: p.arc,
      bounce: true,
      bounceHeight: p.bounceHeight,
      damage: p.damage,
      ttl: p.ttl,
      radius: p.size,
      origin: p.origin,
      team: p.team,
      drawer: circusBallDrawer,
    }, ctx);
  },
});
