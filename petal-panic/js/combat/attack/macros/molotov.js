// Attack Engine — Molotov (macro). ONE object, one id.
//
// A thrown bottle that shatters on impact/fuse and leaves a persistent
// burning area (fireArea primitive) at the death point. Same deferred
// pattern as explosiveBomb: the dumb bomb CARRIER owns flight; THIS macro
// subscribes to 'detonate' and fires a fireArea at exactly where it landed.
//
// VFX contract: no explosion burst, no screen flash. The fire glow comes
// from the fireArea primitive's effect. Camera shake: yes (impact read).
// resolveEffects() inherits rows via meta.invokes.
//
// Handle shape: proxies the inner carrier handle; h.inner is the carrier.

import { registerMacro } from '../registry.js';
import { invoke, AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  speed: 500,           // launch force (px/s)
  direction: -Math.PI / 4, // up-right throw
  arc: 800,             // gravity px/s²
  bounce: false,        // molotovs don't bounce — they shatter on first impact
  ttl: 4,               // fuse seconds (if it doesn't hit anything)
  damage: 12,           // contact damage on the carrier itself
  fireWidth: 96,        // horizontal coverage of the burn area (px)
  fireDuration: 3,      // how long the area burns (s)
  fireTickRate: 5,      // damage ticks per second while in the area
  fireDamage: 8,        // damage per tick in the area
  origin: null,         // marker label | {x,y} | null → attacker center
  team: 'neutral',      // who the fire hurts
});

registerMacro('molotov', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Molotov',
    effects: [],
    desc: 'Thrown bottle → shatters on impact/fuse → persistent burning area at death point. No explosion burst; fire glow + shake.',
    invokes: ['bomb', 'fireArea'],
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
    const h = new AttackHandle('molotov');
    h.handles = [];

    const carrier = invoke('bomb', {
      speed: p.speed,
      direction: p.direction,
      arc: p.arc,
      bounce: p.bounce,
      explodeOnContact: true,
      ttl: p.ttl,
      damage: p.damage,
      radius: 0, // no AoE on the carrier itself — the fire area IS the damage
      origin: p.origin,
    }, ctx);

    if (!carrier?.entity) {
      h._emit('expire');
      h._complete();
      return h;
    }

    carrier._params = p;

    const fireTargets = () => {
      const set = new Set();
      for (const t of ctx.world?.targets ?? []) if (t) set.add(t);
      const aimed = p.target ?? ctx.target;
      if (aimed) set.add(aimed);
      return [...set];
    };

    carrier.on('detonate', ({ x, y }) => {
      try {
        const fire = invoke('fireArea', {
          x, y,
          width: p.fireWidth,
          duration: p.fireDuration,
          tickRate: p.fireTickRate,
          damage: p.fireDamage,
          team: p.team,
          targets: fireTargets(),
        }, ctx);
        h.handles.push(fire);
        fire.on('hit', (...args) => h._emit('hit', ...args));
      } catch (err) {
        console.error(`attack/molotov: fire failed`, err.message);
      }
    });

    h.setInner(carrier);
    h.entity = carrier.entity;
    h.inner = carrier;
    return h;
  },
});
