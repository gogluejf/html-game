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
import { FIRE_HEIGHT } from '../primitives/fireArea.js';
import { resolveImpactPoint } from './skyMissile.js';

const DEFAULTS = Object.freeze({
  speed: 700,           // px/s
  direction: 0,         // radians (NOT an 8-way index)
  ttl: 2,               // seconds before auto-cull
  damage: 12,           // carrier contact damage
  // Fire area params (payload)
  fireWidth: 96,        // burn area width (px); height fixed at FIRE_HEIGHT
  fireDuration: 3,      // how long the area burns (s)
  fireTickRate: 5,      // damage ticks per second in the area
  fireDamage: 8,        // damage per tick in the area
  origin: null,         // marker label | {x,y} | null → attacker center
  solidBehavior: 'stop', // phase | stop | reflect — stop: ignite on contact
  gravity: 0,           // px/s²; >0 routes to the ballistic (Special) pool
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
      { key: 'ttl', desc: 'seconds before auto-cull' },
      { key: 'damage', desc: 'carrier contact damage' },
      { key: 'fireWidth', desc: 'burn area width (px); height fixed at 48' },
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
          // Ground-anchor the fire on the HIGHEST surface in the impact column
          // (floor OR platform) — same "highest top" rule as skyMissile's
          // resolveImpactPoint, so the zone sits ON whatever is actually there.
          // Straight projectiles carry no terrain info (unlike bombs' surfaceY),
          // so we resolve it here from ctx.
          const pt = resolveImpactPoint({ x, groundY: null }, ctx);
          const zoneY = (pt.y != null && y + FIRE_HEIGHT / 2 > pt.y)
            ? pt.y - FIRE_HEIGHT / 2
            : y;
          const fire = invoke('fireArea', {
            x, y: zoneY,
            width: p.fireWidth,
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
      if (x == null || y == null) {
        const ent = carrier.entity;
        x = ent.x + ent.w / 2; y = ent.y + ent.h / 2;
      }
      carrier._emit('detonate', { x, y, contact: true });
    };
    carrier.on('hit', (info) => {
      fireAtDeath();
      h._emit('hit', info);
    });
    carrier.on('expire', () => {
      fireAtDeath();
      h._emit('expire');
    });

    h._wireCarrier(carrier);
    return h;
  },
});
