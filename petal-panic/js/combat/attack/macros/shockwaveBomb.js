// Attack Engine — Shockwave Bomb (macro).
//
// bomb CARRIER → telegraph blink at impact → SHOCKWAVE primitive.
// The bomb arcs in, lands, blinks briefly (telegraph), then the expanding
// ring deals ring-pass damage to everything it crosses.

import { invoke } from '../engine.js';
import { defineMacro } from '../defineMacro.js';
import { createCarrierHandle } from '../carrierMacro.js';
import { fireDeclared } from '../../../effects/index.js';

const DEFAULTS = Object.freeze({
  speed: 500,
  direction: -0.5,
  arc: 800,
  bounce: true,
  explodeOnContact: true,
  ttl: 2,
  // Shockwave params
  radius: 150,
  damage: 70,
  duration: 1.2,
  easing: 'easeIn',
  knockbackIntensity: 8,
  shakeIntensity: 5,
  // Telegraph timing (tight: quick shrink + blink, no gap)
  telegraphBuild: 0.15,
  telegraphGap: 0,
  telegraphBlink: 0.1,
  origin: null,
  blastTeam: 'neutral',
});

defineMacro('shockwaveBomb', {
  attacks: [
    { id: 'bomb', role: 'carrier' },
    { id: 'shockwave', role: 'payload' },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Shockwave Bomb',
    desc: 'Ballistic bomb that detonates into an expanding shockwave ring at its landing point. Telegraph blink warns before the ring launches.',
    effects: [
      { type: 'telegraph-circle', desc: 'blink warning at impact point' },
      { type: 'shockwave', desc: 'expanding damage ring' },
      { type: 'camera-shake', desc: 'shake on shockwave launch' },
    ],
    params: [
      { key: 'speed', desc: 'launch force (px/s)' },
      { key: 'direction', desc: 'throw direction (radians)' },
      { key: 'arc', desc: 'gravity px/s²' },
      { key: 'bounce', desc: 'reflect off surfaces' },
      { key: 'ttl', desc: 'fuse seconds' },
      { key: 'radius', desc: 'shockwave max radius (px)' },
      { key: 'damage', desc: 'ring-pass damage' },
      { key: 'duration', desc: 'ring expansion time (s)' },
      { key: 'easing', desc: 'growth curve' },
      { key: 'knockbackIntensity', desc: 'radial push strength' },
      { key: 'blastTeam', desc: 'foe | ally | neutral' },
    ],
  },
  impl(p, ctx) {
    const h = createCarrierHandle('shockwaveBomb', p, ctx, {
      onDetonate({ x, y }, macroH) {
        try {
          const targets = new Set();
          for (const t of ctx.world?.targets ?? []) if (t) targets.add(t);
          const aimed = p.target ?? ctx.target;
          if (aimed) targets.add(aimed);

          // Telegraph blink at impact point (tight timing).
          fireDeclared(
            { type: 'telegraph-circle', params: { x, y, radius: Math.min(p.radius * 0.4, 60), buildTime: p.telegraphBuild, gapTime: p.telegraphGap, blinkTime: p.telegraphBlink, color: '#ff5a5a' } },
            ['telegraph-circle'],
          );

          // Fire the shockwave after a brief delay (telegraph duration).
          const delay = (p.telegraphBuild ?? 0.15) + (p.telegraphGap ?? 0) + (p.telegraphBlink ?? 0.1);
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
          console.error(`attack/shockwaveBomb: shockwave failed`, err.message);
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
      damage: 0, // no contact damage — the shockwave IS the damage
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
