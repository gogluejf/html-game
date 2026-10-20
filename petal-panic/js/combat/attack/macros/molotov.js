// Attack Engine — Molotov (macro). ONE object, one id.
//
// A thrown bottle that shatters on impact/fuse and leaves a persistent
// burning area (fireArea) at the death point. Uses CarrierMacro base for
// unified stepping + deferred child management.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { createCarrierHandle } from '../carrierMacro.js';
import { FIRE_HEIGHT } from '../primitives/fireArea.js';

const DEFAULTS = Object.freeze({
  speed: 600,           // launch force (px/s)
  direction: -Math.PI / 4,
  arc: 800,             // gravity px/s²
  bounce: false,        // molotovs shatter on first impact
  ttl: 2,               // fuse seconds
  damage: 12,           // carrier contact damage
  fireWidth: 96,        // burn area width (px); height fixed at FIRE_HEIGHT
  fireDuration: 3,      // how long the area burns (s)
  fireTickRate: 5,      // damage ticks per second in the area
  fireDamage: 8,        // damage per tick in the area
  origin: null,         // marker label | {x,y} | null → attacker center
  team: 'neutral',      // who the fire hurts
});

defineMacro('molotov', {
  attacks: [
    { id: 'bomb', role: 'carrier' },
    { id: 'fireArea', role: 'payload' },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Molotov',
    effects: [],
    desc: 'Thrown bottle → shatters on impact/fuse → persistent burning area at death point.',
    params: [
      { key: 'speed', desc: 'launch force (px/s)' },
      { key: 'direction', desc: 'throw direction (radians)' },
      { key: 'arc', desc: 'gravity px/s²' },
      { key: 'bounce', desc: 'reflect off surfaces (default false)' },
      { key: 'ttl', desc: 'fuse seconds' },
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
      onDetonate({ x, y, surfaceY }, macroH) {
        try {
          const targets = new Set();
          for (const t of ctx.world?.targets ?? []) if (t) targets.add(t);
          const aimed = p.target ?? ctx.target;
          if (aimed) targets.add(aimed);
          // Only actual shared bomb terrain contact anchors fire to terrain.
          // Midair expiry/contact burns at the death point, never teleports down.
          const fire = invoke('fireArea', {
            x, y: surfaceY == null ? y : surfaceY - FIRE_HEIGHT / 2,
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

    const carrier = invoke('bomb', {
      team: p.team ?? p.blastTeam,
      speed: p.speed,
      direction: p.direction,
      arc: p.arc,
      bounce: p.bounce,
      explodeOnContact: true,
      ttl: p.ttl,
      damage: p.damage,
      radius: 0,
      origin: p.origin,
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
