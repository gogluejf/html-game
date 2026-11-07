// Attack Engine — Rock (macro). ONE object, ONE id.
//
// A rock is a basic arcing projectile: it flies a gravity arc and BOUNCES off
// terrain (classic decay, bomb-style) — but unlike a bomb it does NOT explode.
// If it never hits anyone it simply expires on ttl and disappears. If it DOES
// hit, it behaves exactly like a normal projectile: contact damage through the
// standard handlers, nothing more.
//
// It composes the `projectile` primitive's arcing recipe (`arc != null`) with
// `rock: true`, which gives the carrier the rock look (rock_medium sheet in
// high-res, rockDrawer in primitive mode, NO outline). The rock look is
// opt-in: the DEFAULT typeless arcing carrier keeps the thorn look.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';

const ROCK_DEFAULTS = Object.freeze({
  speed: 1200,           // launch force (px/s)
  direction: -0.5,       // radians — up-right throw
  arc: 800,              // gravity px/s² (throw height)
  damage: 40,            // contact damage (rock is heavy)
  ttl: 2,                // fuse seconds — the only thing that kills it if it never hits
  spin: 4,               // tumble angular rate (rad/s, center — random ±50% per rock)
  origin: null,          // marker label | {x,y} | null → attacker center
  team: 'ally',
});
export { ROCK_DEFAULTS };

defineMacro('rock', {
  attacks: [{ id: 'projectile', role: 'carrier' }],
  params: { ...ROCK_DEFAULTS },
  meta: {
    name: 'Rock',
    // Inherited from the projectile primitive it composes: the rock handle
    // carries the primitive's effects (h.id is rewritten to 'rock' at invoke,
    // but declared types ride on the handle). The guard checks THIS set, so
    // hit-sparkle/debris must be declared here or the first hit throws.
    effects: [
      { type: 'hit-sparkle', desc: 'blood sparkles on enemy impact (hit juice)' },
      { type: 'debris', desc: 'dusty grain puff when the rock dies on terrain' },
    ],
    desc: 'Arcing rock: gravity arc + decay bounce, NO explosion. Contact damage like a projectile; expires on ttl if it never hits.',
    params: [
      { key: 'speed', desc: 'launch force (px/s)' },
      { key: 'direction', desc: 'throw direction (radians)' },
      { key: 'arc', desc: 'gravity px/s² (throw height)' },
      { key: 'damage', desc: 'damage per enemy contact' },
      { key: 'ttl', desc: 'fuse seconds (disappears if it never hits)' },
      { key: 'spin', desc: 'tumble rate (rad/s, random ±50% per rock)' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
      { key: 'team', desc: 'ally | foe' },
    ],
  },
  impl(params, ctx) {
    const p = { ...ROCK_DEFAULTS, ...params };
    return invoke('projectile', {
      speed: p.speed,
      direction: p.direction,
      arc: p.arc,
      bounce: true,          // bomb-style decay bounce (classic 0.5 restitution)
      rock: true,            // rock look: rock_medium / rockDrawer, no outline
      spin: p.spin,          // tumble rate — random start + slow spin on tangent
      damage: p.damage,
      ttl: p.ttl,
      origin: p.origin,
      team: p.team,
    }, ctx);
  },
});
