// Attack Engine — Explosive Projectile (macro). ONE object, one id.
//
// The straight-line twin of explosiveBomb: composes the dumb projectile
// CARRIER (primitive) with the Explosion primitive. The carrier owns flight
// only (straight/ballistic path, contact damage, TTL); THIS macro owns the
// aftermath — it subscribes to the carrier's terminal event and fires a radial
// explosion at the death point (impact or fuse expiry).
//
// Why a macro: primitives never invoke other attacks; "Projectile →
// Explosion" is composition, so it lives here (docs/architecture/
// attack-macros.md §12).
//
// VFX contract: this macro fires NO effects of its own. The blast burst,
// screen flash, and camera shake come from the Explosion primitive it invokes
// (default switches, all on) — same pattern as bodyExplosion. One owner per
// effect: the carrier fires no blast VFX either, so nothing double-dips.
// resolveEffects() inherits the rows dynamically via meta.invokes.
//
// Handle shape: proxies the inner carrier handle (entity, hit, expire,
// complete); h.inner is the carrier handle for hosts that need it directly.

import { registerMacro } from '../registry.js';
import { invoke, AttackHandle } from '../engine.js';

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

registerMacro('explosiveProjectile', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Explosive Projectile',
    // No native effects: the blast burst + screen flash + camera shake are
    // inherited from the Explosion payload via resolveEffects() (meta.invokes)
    // — declaring them here would shadow the primitive's own rows in the dedup.
    effects: [],
    desc: 'Straight-line shot that detonates into a radial explosion at its death point (impact or TTL). Carrier owns flight; this macro owns the blast.',
    invokes: ['projectile', 'explosion'],
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
    const h = new AttackHandle('explosiveProjectile');

    // The carrier: pure flight. Its terminal events ('hit' on contact,
    // 'expire' on TTL/off-screen) carry enough to aim the blast at the
    // entity's final position.
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

    // Hosts step the INNER carrier handle with the params they passed to us.
    carrier._params = p;

    // GOOD CONTEXT for the deferred blast: built from the LIVE context at
    // detonation time (world.targets + the aimed target), so the blast always
    // has real candidates even if the captured ctx's world went empty.
    const blastTargets = () => {
      const set = new Set();
      for (const t of ctx.world?.targets ?? []) if (t) set.add(t);
      const aimed = p.target ?? ctx.target;
      if (aimed) set.add(aimed);
      return [...set];
    };

    const fireBlastAt = (ent) => {
      const x = ent.x + ent.w / 2, y = ent.y + ent.h / 2;
      try {
        const blast = invoke('explosion', {
          x, y,
          radius: p.radius,
          damage: p.damage,
          team: p.blastTeam,
          self: ctx.attacker,
          targets: blastTargets(),
          shake: true, // screen shake inherited from the explosion primitive
        }, ctx);
        blast.on('hit', (...args) => h._emit('hit', ...args));
      } catch (err) {
        console.error(`attack/explosiveProjectile: blast failed`, err.message);
      }
    };

    // Impact: the carrier reports the hit; we add the blast at the impact
    // point, then forward the original hit event.
    carrier.on('hit', (info) => {
      fireBlastAt(carrier.entity);
      h._emit('hit', info);
    });
    // Fuse expiry / off-screen: still a detonation — bombs and explosive
    // shots go off wherever they end.
    carrier.on('expire', () => {
      fireBlastAt(carrier.entity);
      h._emit('expire');
    });

    h.setInner(carrier);
    h.entity = carrier.entity;
    h.inner = carrier;
    return h;
  },
});
