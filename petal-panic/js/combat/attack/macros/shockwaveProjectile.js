// Attack Engine — Shockwave Projectile (macro). ONE object, one id.
//
// Straight-line twin of shockwaveBomb: projectile CARRIER → telegraph blink
// at impact → SHOCKWAVE primitive. The shot flies, hits a wall/ground/target,
// blinks briefly, then the expanding ring deals ring-pass damage.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { createCarrierHandle } from '../carrierMacro.js';
import { fireDeclared } from '../../../effects/index.js';

const DEFAULTS = Object.freeze({
  speed: 700,
  direction: 0,
  ttl: 2,
  // Shockwave params
  radius: 150,
  damage: 70,
  duration: 1.2,
  easing: 'easeIn',
  knockbackIntensity: 8,
  shakeIntensity: 5,
  // Telegraph timing
  telegraphBuild: 0.15,
  telegraphGap: 0,
  telegraphBlink: 0.1,
  origin: null,
  solidBehavior: 'stop',
  gravity: 0,
  team: 'ally',
  size: 12,
  blastTeam: 'neutral',
});

defineMacro('shockwaveProjectile', {
  attacks: [
    { id: 'projectile', role: 'carrier' },
    { id: 'shockwave', role: 'payload' },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Shockwave Projectile',
    desc: 'Straight-line shot that detonates into an expanding shockwave ring at its impact point. Telegraph blink warns before the ring launches.',
    effects: [
      { type: 'telegraph-circle', desc: 'blink warning at impact point' },
      { type: 'shockwave', desc: 'expanding damage ring' },
      { type: 'camera-shake', desc: 'shake on shockwave launch' },
    ],
    params: [
      { key: 'speed', desc: 'px/s travel speed' },
      { key: 'direction', desc: 'radians (0 = right)' },
      { key: 'ttl', desc: 'seconds before auto-cull' },
      { key: 'radius', desc: 'shockwave max radius (px)' },
      { key: 'damage', desc: 'ring-pass damage' },
      { key: 'duration', desc: 'ring expansion time (s)' },
      { key: 'easing', desc: 'growth curve' },
      { key: 'knockbackIntensity', desc: 'radial push strength' },
      { key: 'solidBehavior', desc: 'phase | stop | reflect' },
      { key: 'gravity', desc: 'px/s² (>0 = ballistic arc)' },
      { key: 'team', desc: 'ally | foe — who the carrier shot hurts' },
      { key: 'size', desc: 'box size (px)' },
      { key: 'blastTeam', desc: 'foe | ally | neutral — who the ring hurts' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };

    const h = createCarrierHandle('shockwaveProjectile', p, ctx, {
      onDetonate({ x, y }, macroH) {
        try {
          const targets = new Set();
          for (const t of ctx.world?.targets ?? []) if (t) targets.add(t);
          const aimed = p.target ?? ctx.target;
          if (aimed) targets.add(aimed);

          // Telegraph blink at impact point.
          fireDeclared(
            { type: 'telegraph-circle', params: { x, y, radius: Math.min(p.radius * 0.4, 60), buildTime: p.telegraphBuild, gapTime: p.telegraphGap, blinkTime: p.telegraphBlink, color: '#ff5a5a' } },
            ['telegraph-circle'],
          );

          // Fire the shockwave.
          const sw = invoke('shockwave', {
            x, y,
            radius: p.radius,
            damage: p.damage,
            duration: p.duration,
            easing: p.easing,
            knockbackIntensity: p.knockbackIntensity,
            shake: true,
            shakeIntensity: p.shakeIntensity,
            team: p.blastTeam,
            targets: [...targets],
          }, ctx);
          sw.on('hit', (...args) => macroH._emit('hit', ...args));
          sw.on('complete', (...args) => macroH._emit('complete', ...args));
        } catch (err) {
          console.error(`attack/shockwaveProjectile: shockwave failed`, err.message);
        }
      },
    });

    const carrier = invoke('projectile', {
      speed: p.speed,
      direction: p.direction,
      ttl: p.ttl,
      damage: 0, // no contact damage — the shockwave IS the damage
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

    // Bridge projectile hit/expire to detonate.
    const fireShockwaveAt = () => {
      const ent = carrier.entity;
      const x = ent.x + ent.w / 2, y = ent.y + ent.h / 2;
      carrier._emit('detonate', { x, y, contact: true });
    };
    carrier.on('hit', (info) => {
      fireShockwaveAt();
      h._emit('hit', info);
    });
    carrier.on('expire', () => {
      fireShockwaveAt();
      h._emit('expire');
    });

    h._wireCarrier(carrier);
    return h;
  },
});
