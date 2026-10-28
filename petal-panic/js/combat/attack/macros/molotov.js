// Attack Engine — Molotov (macro). ONE object, one id.
//
// A thrown bottle that shatters on impact/fuse and leaves a persistent
// burning area (fireArea) at the death point. Uses CarrierMacro base for
// unified stepping + deferred child management.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { createCarrierHandle } from '../carrierMacro.js';
import { FIRE_HEIGHT } from '../primitives/fireArea.js';
import { resolveImpactPoint } from './skyMissile.js';
import { molotovDrawer } from '../drawers/index.js';

const DEFAULTS = Object.freeze({
  speed: 600,           // launch force (px/s)
  direction: -0.5,
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
    { id: 'ballistic', role: 'carrier' },
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
          // Ground-anchor the fire on the HIGHEST surface in the impact column
          // (floor OR platform). The bomb's terrain detection already reports
          // the exact top it landed on via surfaceY — prefer that. If the
          // bottle broke midair (enemy contact / fuse expiry), resolve the
          // column so fire never renders below ground or through a platform.
          let anchor = null;
          if (surfaceY != null) anchor = surfaceY;
          else {
            const pt = resolveImpactPoint({ x, groundY: null }, ctx);
            if (pt.y != null && y + FIRE_HEIGHT / 2 > pt.y) anchor = pt.y;
          }
          const zoneY = anchor != null ? anchor - FIRE_HEIGHT / 2 : y;
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

    const carrier = invoke('ballistic', {
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
