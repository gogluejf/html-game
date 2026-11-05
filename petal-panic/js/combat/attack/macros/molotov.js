// Attack Engine — Molotov (macro). ONE object, one id.
//
// A thrown bottle that shatters on impact and leaves a persistent
// burning area (fireArea) at the death point. Uses CarrierMacro base for
// unified stepping + deferred child management.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { createCarrierHandle } from '../carrierMacro.js';
import { FIRE_HEIGHT } from '../primitives/fireArea.js';
import { molotovDrawer } from '../drawers/index.js';

const DEFAULTS = Object.freeze({
  speed: 600,           // launch force (px/s)
  direction: -0.5,
  arc: 800,             // gravity px/s²
  bounce: false,        // molotovs shatter on first impact
  // NO ttl — a molotov is contact-only by contract. The bottle carries no
  // fire until it breaks; a flight fuse would detonate it midair and anchor
  // the zone to the floor below (ghost fire through platforms). Callers
  // cannot arm a fuse: impl() ignores any supplied ttl.
  damage: 12,           // carrier contact damage
  fireWidth: 96,        // burn area width (px); height fixed at FIRE_HEIGHT
  fireDuration: 3,      // how long the area burns (s)
  fireTickRate: 5,      // damage ticks per second in the area
  fireDamage: 8,        // damage per tick in the area
  origin: null,         // marker label | {x,y} | null → attacker center
  team: 'neutral',      // who the fire hurts
  groundY: null,        // floor y for fallback anchoring (set by spawnSplit/barrelSync)
});

defineMacro('molotov', {
  attacks: [
    { id: 'projectile', role: 'carrier' },
    { id: 'fireArea', role: 'payload' },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Molotov',
    effects: [],
    desc: 'Thrown bottle → shatters on impact → persistent burning area at the death point. Contact-only (no flight fuse).',
    params: [
      { key: 'speed', desc: 'launch force (px/s)' },
      { key: 'direction', desc: 'throw direction (radians)' },
      { key: 'arc', desc: 'gravity px/s²' },
      { key: 'bounce', desc: 'reflect off surfaces (default false)' },
      { key: 'damage', desc: 'carrier contact damage' },
      { key: 'fireWidth', desc: 'burn area width (px); height fixed at 48' },
      { key: 'fireDuration', desc: 'how long the area burns (s)' },
      { key: 'fireTickRate', desc: 'ticks per second in the area' },
      { key: 'fireDamage', desc: 'damage per tick in the area' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
      { key: 'team', desc: 'foe | ally | neutral — who the fire hurts' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };

    const h = createCarrierHandle('molotov', p, ctx, {
      onDetonate({ x, y, surfaceY, contact }, macroH) {
        if (!contact) return; // Off-screen cleanup is not an impact.
        try {
          const targets = new Set();
          for (const t of ctx.world?.targets ?? []) if (t) targets.add(t);
          const aimed = p.target ?? ctx.target;
          if (aimed) targets.add(aimed);
          // Top landings put the fire base on the surface. Side/enemy hits
          // keep the fire centered at the actual impact, never at the floor.
          const zoneY = surfaceY != null ? surfaceY - FIRE_HEIGHT / 2 : y;
          const fire = invoke('fireArea', {
            x, y: zoneY,
            width: p.fireWidth,
            duration: p.fireDuration,
            tickRate: p.fireTickRate,
            damage: p.fireDamage,
            team: p.team,
            targets: [...targets],
          }, ctx);
          macroH.handles.push(fire);
          fire.on('hit', (...args) => macroH._emit('hit', ...args));
        } catch (err) {
          console.error(`attack/molotov: fire failed`, err.message);
        }
      },
    });

    const carrier = invoke('projectile', {
      team: p.team ?? p.blastTeam,
      speed: p.speed,
      direction: p.direction,
      arc: p.arc,
      bounce: p.bounce,
      explodeOnContact: true,
      ttl: null, // contact-only — molotovs never self-detonate midair (see DEFAULTS)
      damage: p.damage,
      radius: 0,
      origin: p.origin,
      drawer: molotovDrawer,
    }, ctx);

    if (!carrier?.entity) {
      h._emit('expire');
      h._complete();
      return h;
    }

    carrier._params = p;
    h.setInner(carrier);
    h.entity = carrier.entity;
    h.inner = carrier;
    h._wireCarrier(carrier);
    return h;
  },
});
