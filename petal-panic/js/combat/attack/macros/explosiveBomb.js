// Attack Engine — Explosive Bomb (macro). ONE object, one id.
//
// The classic "bomb that explodes": composes the dumb bomb CARRIER (primitive)
// with the Explosion primitive via the CarrierMacro base. The carrier owns
// flight only; THIS macro owns the aftermath — explosion at the death point.
//
// VFX contract: no native effects. Blast burst + shake come from the Explosion
// primitive; screen flash is SUPPRESSED. resolveEffects() inherits via meta.invokes.

import { registerMacro } from '../registry.js';
import { invoke } from '../engine.js';
import { createCarrierHandle } from '../carrierMacro.js';

const DEFAULTS = Object.freeze({
  speed: 500,           // launch force (px/s)
  direction: -Math.PI / 4, // up-right throw
  arc: 800,             // gravity px/s² (throw height control)
  bounce: true,         // reflect off surfaces
  explodeOnContact: true,
  ttl: 1.5,             // fuse seconds
  damage: 40,           // carrier contact damage AND blast damage
  radius: 60,           // blast radius (px)
  origin: null,         // marker label | {x,y} | null → attacker center
  blastTeam: 'neutral', // blast team: foe | ally | neutral
});

registerMacro('explosiveBomb', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Explosive Bomb',
    effects: [],
    desc: 'Ballistic bomb that detonates into a radial explosion at its death point.',
    invokes: ['bomb', 'explosion'],
    params: [
      { key: 'speed', desc: 'launch force (px/s)' },
      { key: 'direction', desc: 'throw direction (radians)' },
      { key: 'arc', desc: 'gravity px/s² (throw height)' },
      { key: 'bounce', desc: 'reflect off surfaces' },
      { key: 'explodeOnContact', desc: 'legacy flag (kept for param parity)' },
      { key: 'ttl', desc: 'fuse seconds' },
      { key: 'damage', desc: 'contact + blast damage' },
      { key: 'radius', desc: 'blast radius (px)' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
      { key: 'blastTeam', desc: 'foe | ally | neutral — who the blast hurts' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };

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
      speed: p.speed,
      direction: p.direction,
      arc: p.arc,
      bounce: p.bounce,
      explodeOnContact: p.explodeOnContact,
      ttl: p.ttl,
      damage: p.damage,
      radius: p.radius,
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
