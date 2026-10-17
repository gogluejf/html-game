// Attack Engine — Explosive Projectile (macro). ONE object, one id.
//
// Straight-line twin of explosiveBomb: projectile CARRIER → Explosion at
// death point (impact or TTL). Uses CarrierMacro base for unified stepping.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { createCarrierHandle } from '../carrierMacro.js';

const DEFAULTS = Object.freeze({
  speed: 600,           // px/s
  direction: 0,         // radians (NOT an 8-way index)
  ttl: 2,               // seconds before auto-cull
  damage: 10,           // carrier contact damage AND blast damage
  radius: 60,           // blast radius (px)
  origin: null,         // marker label | {x,y} | null → attacker center
  solidBehavior: 'phase', // phase | stop | reflect
  gravity: 0,           // px/s²; >0 routes to the ballistic (Special) pool
  team: 'ally',        // ally | foe — who the carrier shot hurts
  size: 12,             // box size
  blastTeam: 'neutral', // blast team: foe | ally | neutral
});

defineMacro('explosiveProjectile', {
  attacks: [
    { id: 'projectile', role: 'carrier' },
    { id: 'explosion', role: 'payload' },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Explosive Projectile',
    effects: [],
    desc: 'Straight-line shot that detonates into a radial explosion at its death point (impact or TTL).',
    params: [
      { key: 'speed', desc: 'px/s travel speed' },
      { key: 'direction', desc: 'radians (0 = right)' },
      { key: 'ttl', desc: 'seconds before auto-cull' },
      { key: 'damage', desc: 'contact + blast damage' },
      { key: 'radius', desc: 'blast radius (px)' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
      { key: 'solidBehavior', desc: 'phase | stop | reflect' },
      { key: 'gravity', desc: 'px/s² (>0 = ballistic arc)' },
      { key: 'team', desc: 'ally | foe — who the carrier shot hurts' },
      { key: 'size', desc: 'box size (px)' },
      { key: 'blastTeam', desc: 'foe | ally | neutral — who the blast hurts' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };

    const h = createCarrierHandle('explosiveProjectile', p, ctx, {
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
          console.error(`attack/explosiveProjectile: blast failed`, err.message);
        }
      },
    });

    const carrier = invoke('projectile', {
      speed: p.speed,
      direction: p.direction,
      ttl: p.ttl,
      damage: p.damage,
      origin: p.origin,
      solidBehavior: p.solidBehavior,
      gravity: p.gravity,
      team: p.team,
      size: p.size,
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

    // Projectile carriers emit 'hit'/'expire' (not 'detonate'). Bridge them
    // to the carrier handle's detonate so the base's onDetonate fires.
    const fireBlastAt = () => {
      const ent = carrier.entity;
      const x = ent.x + ent.w / 2, y = ent.y + ent.h / 2;
      carrier._emit('detonate', { x, y, contact: true });
    };
    carrier.on('hit', (info) => {
      fireBlastAt();
      h._emit('hit', info);
    });
    carrier.on('expire', () => {
      fireBlastAt();
      h._emit('expire');
    });

    h._wireCarrier(carrier);
    return h;
  },
});
