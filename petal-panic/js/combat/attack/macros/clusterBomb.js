// Attack Engine — Cluster Bomb (macro). ONE object, one id.
//
// A parent bomb that, on detonation, splits into N smaller explosive bombs
// via spawnSplit. Uses CarrierMacro base for unified stepping.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { createCarrierHandle } from '../carrierMacro.js';

const DEFAULTS = Object.freeze({
  // Parent bomb
  speed: 500,
  direction: -0.5,
  arc: 800,
  bounce: false,
  ttl: 3,
  damage: 20,
  radius: 40,
  origin: null,
  blastTeam: 'neutral',
  // Children
  spawnType: 'bomb',
  mineType: 'explosion',
  mineTtl: 4,
  blinkDuration: 2,
  count: 4,
  childAngle: 120 * Math.PI / 180,
  childDirection: -Math.PI / 2,
  childForce: 300,
  childArc: 700,
  childTtl: 2,
  childDamage: 15,
  childRadius: 30,
});

defineMacro('clusterBomb', {
  attacks: [
    { id: 'bomb', role: 'carrier' },
    { id: 'spawnSplit', role: 'payload' },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Cluster Bomb',
    effects: [],
    desc: 'Parent bomb detonates → spawns N smaller bombs in a fan. Each child explodes on its own impact/fuse.',
    params: [
      { key: 'speed', desc: 'parent launch force (px/s)' },
      { key: 'direction', desc: 'parent throw direction (radians)' },
      { key: 'arc', desc: 'gravity px/s²' },
      { key: 'bounce', desc: 'reflect off surfaces' },
      { key: 'ttl', desc: 'parent fuse seconds' },
      { key: 'damage', desc: 'parent blast damage' },
      { key: 'radius', desc: 'parent blast radius (px)' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
      { key: 'blastTeam', desc: 'foe | ally | neutral' },
      { key: 'spawnType', desc: 'bomb | mine (children)' },
      { key: 'mineType', desc: 'explosion | shockwave' },
      { key: 'mineTtl', desc: 'resting mine seconds; null = contact only' },
      { key: 'blinkDuration', desc: 'mine warning seconds' },
      { key: 'count', desc: 'number of child bombs' },
      { key: 'childAngle', desc: 'child spread width (radians)' },
      { key: 'childDirection', desc: 'child center direction (radians)' },
      { key: 'childForce', desc: 'child launch force (px/s)' },
      { key: 'childArc', desc: 'child gravity (px/s²)' },
      { key: 'childTtl', desc: 'child fuse seconds' },
      { key: 'childDamage', desc: 'child blast damage' },
      { key: 'childRadius', desc: 'child blast radius (px)' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };

    const h = createCarrierHandle('clusterBomb', p, ctx, {
      onDetonate({ x, y }, macroH) {
        try {
          const split = invoke('spawnSplit', {
            x, y, groundY: p.groundY, platforms: p.platforms,
            count: p.count,
            centerDirection: p.childDirection,
            angle: p.childAngle,
            force: p.childForce,
            spawnType: p.spawnType,
            mineType: p.mineType,
            mine: { ttl: p.mineTtl, blinkDuration: p.blinkDuration,
              arc: p.childArc, bounce: true, damage: p.childDamage, radius: p.childRadius, team: p.blastTeam },
            bomb: {
              speed: p.childForce,
              direction: p.childDirection,
              arc: p.childArc,
              bounce: false,
              ttl: p.childTtl,
              damage: p.childDamage,
              radius: p.childRadius,
              blastTeam: p.blastTeam,
            },
          }, ctx);
          if (split?.handles?.length > 0) {
            for (const ch of split.handles) {
              macroH.handles.push(ch);
              ch.on('hit', (...args) => macroH._emit('hit', ...args));

            }
          }
        } catch (err) {
          console.error(`attack/clusterBomb: split failed`, err.message);
        }
      },
    });

    const carrier = invoke('bomb', {
      team: p.team ?? p.blastTeam,
      speed: p.speed,
      direction: p.direction,
      arc: p.arc,
      bounce: p.bounce,
      explodeOnContact: true,
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
