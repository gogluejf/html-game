// Attack Engine — Explosive Bomb (macro). ONE object, one id.
//
// The classic "bomb that explodes": composes the dumb bomb CARRIER (primitive)
// with the Explosion primitive. The carrier owns flight only (arc, bounce,
// fuse, contact damage, landing puff); THIS macro owns the aftermath — it
// subscribes to the carrier's 'detonate' event and fires a radial explosion
// at exactly the death point.
//
// Why a macro: the primitive/macro boundary forbids primitives from invoking
// other attacks. "Bomb → Explosion" is composition, so it lives here, as
// documented in docs/architecture/attack-macros.md §11.
//
// VFX contract: this macro fires NO effects of its own. The blast burst,
// screen flash, and camera shake come from the Explosion primitive it invokes
// (default switches, all on) — same pattern as bodyExplosion. One owner per
// effect: the carrier fires no blast VFX either, so nothing double-dips.
// resolveEffects() inherits the rows dynamically via meta.invokes.
//
// Handle shape: proxies the inner carrier handle (entity, detonate, complete);
// h.inner is the carrier handle for hosts that need it directly.

import { registerMacro } from '../registry.js';
import { invoke, AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  speed: 500,           // launch force (px/s)
  direction: -Math.PI / 4, // up-right throw
  arc: 800,             // gravity px/s² (throw height control)
  bounce: true,         // reflect off surfaces
  explodeOnContact: true,
  ttl: 4,               // fuse seconds
  damage: 40,           // carrier contact damage AND blast damage
  radius: 60,           // blast radius (px)
  origin: null,         // marker label | {x,y} | null → attacker center
  blastTeam: 'neutral', // blast team: foe | ally | neutral
});

registerMacro('explosiveBomb', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Explosive Bomb',
    // No native effects: the blast burst + screen flash + camera shake are
    // inherited from the Explosion payload via resolveEffects() (meta.invokes)
    // — declaring them here would shadow the primitive's own rows in the dedup.
    effects: [],
    desc: 'Ballistic bomb that detonates into a radial explosion at its death point. Carrier owns flight; this macro owns the blast.',
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
    const h = new AttackHandle('explosiveBomb');

    // The carrier: pure flight. Its terminal 'detonate' carries the death
    // point — we fire the blast there.
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

    // Hosts (theater, gameplay) step the INNER carrier handle with the params
    // they passed to us — store them so stepBomb() gets the merged values.
    carrier._params = p;

    // The aftermath: when the carrier dies (impact/fuse/off-screen), fire the
    // Explosion primitive at the exact death point. Synchronous invoke — the
    // blast resolves in the same frame as the detonate event. All VFX (burst,
    // flash, shake) come from the explosion primitive's default switches;
    // this macro adds none of its own.
    //
    // GOOD CONTEXT for the deferred call: the blast is fired LATER than the
    // macro's invoke, so it must not rely on a stale or host-local ctx. We
    // pass an explicit `targets` list built from the LIVE context at
    // detonation time (world.targets + the aimed target), so the blast always
    // has real candidates even if the captured ctx's world went empty.
    const blastTargets = () => {
      const set = new Set();
      for (const t of ctx.world?.targets ?? []) if (t) set.add(t);
      const aimed = p.target ?? ctx.target;
      if (aimed) set.add(aimed);
      return [...set];
    };
    carrier.on('detonate', ({ x, y }) => {
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
        console.error(`attack/explosiveBomb: blast failed`, err.message);
      }
    });

    h.setInner(carrier);
    h.entity = carrier.entity;
    h.inner = carrier;
    return h;
  },
});
