// Attack Engine — Explosive Bomb (macro). ONE object, one id.
//
// bomb CARRIER → Explosion at death point. Uses CarrierMacro base +
// defineMacro unified contract.

import { invoke } from '../engine.js';
import { defineMacro } from '../defineMacro.js';
import { createCarrierHandle } from '../carrierMacro.js';
import { bombDrawer } from '../drawers/index.js';

const DEFAULTS = Object.freeze({
  speed: 500,
  direction: -0.5,
  arc: 800,
  bounce: true,
  explodeOnContact: true,
  ttl: 2,
  damage: 40,
  radius: 70,
  origin: null,
  blastTeam: 'neutral',
});

defineMacro('explosiveBomb', {
  attacks: [
    { id: 'bomb', role: 'carrier' },
    { id: 'explosion', role: 'payload', overrides: { 'screen-flash': false } },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Explosive Bomb',
    desc: 'Ballistic bomb that detonates into a radial explosion at its death point.',
    effects: [],
    params: [
      { key: 'speed', desc: 'launch force (px/s)' },
      { key: 'direction', desc: 'throw direction (radians)' },
      { key: 'arc', desc: 'gravity px/s² (throw height)' },
      { key: 'bounce', desc: 'reflect off surfaces' },
      { key: 'ttl', desc: 'fuse seconds' },
      { key: 'damage', desc: 'contact + blast damage' },
      { key: 'radius', desc: 'blast radius (px)' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
      { key: 'blastTeam', desc: 'foe | ally | neutral' },
    ],
  },
  impl(p, ctx) {
    const h = createCarrierHandle('explosiveBomb', p, ctx, {
      onDetonate({ x, y }, macroH) {
        try {
          const targets = new Set();
          for (const t of ctx.world?.targets ?? []) if (t) targets.add(t);
          const aimed = p.target ?? ctx.target;
          if (aimed) targets.add(aimed);
          const blast = invoke('explosion', {
            x, y,
            radius: p.radius,
            damage: p.damage,
            team: p.blastTeam,
            self: ctx.attacker,
            targets: [...targets],
            shake: true,
            screenFlash: false,
          }, ctx);
          blast.on('hit', (...args) => macroH._emit('hit', ...args));
        } catch (err) {
          console.error(`attack/explosiveBomb: blast failed`, err.message);
        }
      },
    });

    const carrier = invoke('bomb', {
      team: p.team ?? p.blastTeam,
      speed: p.speed,
      direction: p.direction,
      arc: p.arc,
      bounce: p.bounce,
      explodeOnContact: p.explodeOnContact,
      ttl: p.ttl,
      damage: p.damage,
      radius: p.radius,
      origin: p.origin,
      drawer: bombDrawer,
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
