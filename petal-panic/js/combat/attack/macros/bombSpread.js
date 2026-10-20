// Attack Engine — Bomb Spread (macro). ONE object, one id.
//
// N explosive bombs fanned across an angle around a center direction.
// Same fan math as spreadShot, but each child is an explosiveBomb handle
// instead of a projectile. Default is a high lobe trajectory (steep angle,
// strong force) — designed for enemies to throw bombs DOWN at the hero in
// a wide arc, not a direct horizontal shot.
//
// Handle shape:
//   h.handles  — live explosiveBomb handles (one per angle)
//   h.angles   — the generated angles
//   complete   — fires once ALL children have completed
//   hit        — forwarded from any child

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { spreadAngles } from './spreadShot.js';
import { resolveCarrier } from '../carrierMacro.js';
import { stepBomb, stepBombTerrain } from '../primitives/bomb.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read at construction so synchronous fires inside impl()
// see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}
import { getPrimitive, getMacro } from '../registry.js';

const DEFAULTS = Object.freeze({
  count: 3,              // number of bombs
  direction: -75 * Math.PI / 180, // steep lobe (radians)
  angle: 15 * Math.PI / 180,    // total spread width (radians)
  speed: 700,            // launch force (px/s) — high for lobe arcs
  arc: 800,              // gravity px/s²
  bounce: true,          // reflect off surfaces
  ttl: 2.5,               // fuse seconds (lobe needs more air time)
  damage: 40,            // contact + blast damage
  radius: 60,            // blast radius (px)
  origin: null,          // marker label | {x,y} | null → attacker center
  blastTeam: 'neutral',  // who the blast hurts
  sequenceInterval: null, // s between launches; null/0 = all simultaneous
});

defineMacro('bombSpread', {
  attacks: [{ id: 'explosiveBomb', role: 'child' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Bomb Spread',
    effects: [],
    desc: 'N explosive bombs fanned across an angle. High-lobe default (steep, strong). Children are explosiveBomb handles.',
    params: [
      { key: 'count', desc: 'number of bombs' },
      { key: 'direction', desc: 'center direction (radians)' },
      { key: 'angle', desc: 'total spread width (radians)' },
      { key: 'speed', desc: 'launch force (px/s)' },
      { key: 'arc', desc: 'gravity px/s²' },
      { key: 'bounce', desc: 'reflect off surfaces' },
      { key: 'ttl', desc: 'fuse seconds' },
      { key: 'damage', desc: 'contact + blast damage' },
      { key: 'radius', desc: 'blast radius (px)' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
      { key: 'blastTeam', desc: 'foe | ally | neutral' },
      { key: 'sequenceInterval', desc: 's between launches; null = simultaneous' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('bombSpread', null, declaredEffectsOf('bombSpread'));
    const angles = spreadAngles(p.count, p.direction, p.angle);
    h.angles = angles;
    h.handles = [];

    let remaining = angles.length;
    const onChildDone = () => {
      remaining--;
      if (remaining <= 0) h._complete();
    };

    for (const a of angles) {
      const child = invoke('explosiveBomb', {
        speed: p.speed,
        direction: a,
        arc: p.arc,
        bounce: p.bounce,
        ttl: p.ttl,
        damage: p.damage,
        radius: p.radius,
        origin: p.origin,
        blastTeam: p.blastTeam,
        groundY: p.groundY, platforms: p.platforms,
      }, ctx);
      if (!child?.entity) { onChildDone(); continue; }
      h.handles.push(child);
      child.on('hit', (...args) => h._emit('hit', ...args));
      child.on('complete', onChildDone);
    }

    if (h.handles.length === 0) {
      h._emit('expire');
      h._complete();
    }

    // Unified stepping: host calls h.step(dt, targets) each frame.
    h.step = (dt, targets = []) => {
      for (const child of h.handles) {
        if (child._completed || child._cancelled) continue;
        if (child.step) { child.step(dt, targets); continue; }
        const inner = resolveCarrier(child);
        if (inner.entity?._attackId === 'bomb') {
          const groundY = p.groundY ?? ctx.groundY;
          const platforms = p.platforms ?? ctx.platforms ?? [];
          if (groundY != null) stepBombTerrain(inner.entity, dt, groundY, platforms);
          stepBomb(inner.entity, inner._params ?? p, ctx, inner);
        }
      }
      return h._completed;
    };

    return h;
  },
});
