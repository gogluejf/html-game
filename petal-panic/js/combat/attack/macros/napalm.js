// Attack Engine — Napalm (macro). ONE object, one id.
//
// Straight-line twin of explosiveProjectile: projectile CARRIER → persistent
// FIRE AREA at the death point (impact or TTL). Same instant-detonation shape
// as explosiveProjectile (no telegraph, no beat clock) — the payload is a
// burning ground zone instead of a radial blast.
//
// The difference from molotov: molotov LOBS (bomb carrier, arced throw),
// napalm SHOTS (projectile carrier, straight line). Same fireArea payload.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { createCarrierHandle } from '../carrierMacro.js';
import '../primitives/fireArea.js';

const DEFAULTS = Object.freeze({
  speed: 700,           // px/s
  direction: 0,         // radians (NOT an 8-way index)
  ttl: 2,               // seconds before auto-cull
  damage: 12,           // carrier contact damage
  // Fire area params (payload)
  fireSegments: 2,     // burn area width in 48px fire units (integer); height fixed at 1 unit
  fireDuration: 3,      // how long the area burns (s)
  fireTickRate: 5,      // damage ticks per second in the area
  fireDamage: 8,        // damage per tick in the area
  origin: null,         // marker label | {x,y} | null → attacker center
  solidBehavior: 'stop', // phase | stop | reflect — stop: ignite on contact
  gravity: 0,           // px/s²; >0 routes to the ballistic (Projectile) pool
  team: 'ally',         // ally | foe — who the carrier shot hurts
  size: 12,             // box size
  blastTeam: 'neutral', // fire team: foe | ally | neutral — who the fire hurts
});

defineMacro('napalm', {
  attacks: [
    { id: 'projectile', role: 'carrier' },
    { id: 'fireArea', role: 'payload' },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Napalm',
    effects: [],
    desc: 'Straight-line shot that leaves a persistent burning area at its death point (impact or TTL). Instant ignition, no telegraph.',
    params: [
      { key: 'speed', desc: 'px/s travel speed' },
      { key: 'direction', desc: 'radians (0 = right)' },
      { key: 'ttl', desc: 'seconds before auto-cull; null = contact only', nullMeans: 'contact' },
      { key: 'damage', desc: 'carrier contact damage' },
      { key: 'fireSegments', desc: 'burn area width in 48px fire units (integer, default 2); height fixed at 1 unit' },
      { key: 'fireDuration', desc: 'how long the area burns (s)' },
      { key: 'fireTickRate', desc: 'damage ticks per second in the area' },
      { key: 'fireDamage', desc: 'damage per tick in the area' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
      { key: 'solidBehavior', desc: 'phase | stop | reflect' },
      { key: 'gravity', desc: 'px/s² (>0 = ballistic arc)' },
      { key: 'team', desc: 'ally | foe — who the carrier shot hurts' },
      { key: 'size', desc: 'box size (px)' },
      { key: 'blastTeam', desc: 'foe | ally | neutral — who the fire hurts' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };

    const h = createCarrierHandle('napalm', p, ctx, {
      onDetonate({ x, y }, macroH) {
        try {
          const targets = new Set();
          for (const t of ctx.world?.targets ?? []) if (t) targets.add(t);
          const aimed = p.target ?? ctx.target;
          if (aimed) targets.add(aimed);
          const fire = invoke('fireArea', {
            x, y,
            segments: p.fireSegments,
            duration: p.fireDuration,
            tickRate: p.fireTickRate,
            damage: p.fireDamage,
            team: p.blastTeam,
            targets: [...targets],
          }, ctx);
          macroH.handles.push(fire);
          fire.on('hit', (...args) => macroH._emit('hit', ...args));
        } catch (err) {
          console.error(`attack/napalm: fire failed`, err.message);
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
    // to the carrier handle's detonate so the base's onDetonate fires. The
    // event payload carries the DEATH POINT captured by stepProjectile() —
    // pool slots are recycled after death, so re-reading ent.x/y would land
    // the fire on the recycled slot's position, not the true impact.
    const fireAtDeath = ({ x, y } = {}) => {
      if (carrier.entity?._cullOffScreen) return;
      if (x == null || y == null) {
        const ent = carrier.entity;
        x = ent.x + ent.w / 2; y = ent.y + ent.h / 2;
      }
      carrier._emit('detonate', { x, y, contact: true });
    };
    carrier.on('hit', (info) => {
      fireAtDeath(info);
      h._emit('hit', info);
    });
    carrier.on('expire', (info) => {
      fireAtDeath(info);
      h._emit('expire');
    });

    h._wireCarrier(carrier);
    return h;
  },
});
