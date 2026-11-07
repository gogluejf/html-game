// Attack Engine — Molotov (macro). ONE object, one id.
//
// A thrown bottle that shatters on impact and leaves a persistent
// burning area (fireArea) at the death point. Uses CarrierMacro base for
// unified stepping + deferred child management.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { createCarrierHandle } from '../carrierMacro.js';
import '../primitives/fireArea.js';
import { fireballDrawer } from '../drawers/index.js';

const DEFAULTS = Object.freeze({
  speed: 600,           // launch force (px/s)
  direction: -0.5,
  arc: 800,             // gravity px/s²
  bounce: false,        // molotovs shatter on first impact
  flightTtl: null,      // optional carrier fuse (s); null = contact only
  damage: 12,           // carrier contact damage
  fireSegments: 3,     // burn area width in 48px fire units (integer); height fixed at 1 unit
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
    effects: [
      { type: 'sprite-burst', desc: 'bomb-explode art at each fire segment spawn point (via fireArea ignitePerSegment; procedural fallback in primitive mode)' },
    ],
    desc: 'Thrown bottle → shatters on impact OR flight-fuse expiry → persistent burning area at the death point.',
    params: [
      { key: 'speed', desc: 'launch force (px/s)' },
      { key: 'direction', desc: 'throw direction (radians)' },
      { key: 'arc', desc: 'gravity px/s²' },
      { key: 'bounce', desc: 'reflect off surfaces (default false)' },
      { key: 'flightTtl', desc: 'carrier fuse seconds; null = contact only', nullMeans: 'contact' },
      { key: 'fireSegments', desc: 'burn area width in 48px fire units (integer, default 2); height fixed at 1 unit' },
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
        // Off-screen cleanup is not an impact — no fire. Both a real hit AND
        // a flight-fuse expiry (contact=false, ttlExpired) must shatter: a
        // bottle that runs out of air still breaks into a burning area.
        if (!contact && !h.entity?.ttlExpired) return;
        try {
          const targets = new Set();
          for (const t of ctx.world?.targets ?? []) if (t) targets.add(t);
          const aimed = p.target ?? ctx.target;
          if (aimed) targets.add(aimed);
          // Per-segment ignition VFX lives in the fireArea primitive — each
          // flame pops at its own spawn point (no single death-point burst).
          const fire = invoke('fireArea', {
            x, y, surfaceY,
            segments: p.fireSegments,
            duration: p.fireDuration,
            tickRate: p.fireTickRate,
            damage: p.fireDamage,
            team: p.team,
            ignitePerSegment: true,
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
      ttl: p.flightTtl ?? null, // explicit null preserves contact-only behavior
      damage: p.damage,
      radius: 0,
      origin: p.origin,
      drawer: fireballDrawer,
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
