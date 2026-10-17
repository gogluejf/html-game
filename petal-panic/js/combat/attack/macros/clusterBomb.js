// Attack Engine — Cluster Bomb (macro). ONE object, one id.
//
// A parent explosiveBomb that, on detonation, splits into N smaller bombs
// via spawnSplit (spawnType 'bomb'). Macro→macro composition: the parent's
// terminal 'detonate' triggers a child fan-out at the death point.
//
// VFX contract: no native effects. The parent's blast comes from its inner
// explosiveBomb (explosion primitive); the children each bring their own
// explosion when they land. resolveEffects() inherits via meta.invokes.
//
// Handle shape: proxies the parent carrier; h.children is the spawnSplit
// handle (when it fires). Complete fires when ALL children complete.

import { registerMacro } from '../registry.js';
import { invoke, AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  // Parent bomb
  speed: 500,           // launch force (px/s)
  direction: -Math.PI / 4,
  arc: 800,             // gravity px/s²
  bounce: false,        // shatters on first impact
  ttl: 3,               // fuse seconds
  damage: 20,           // parent blast damage
  radius: 40,           // parent blast radius (smaller than standalone bomb)
  origin: null,         // marker label | {x,y} | null → attacker center
  blastTeam: 'neutral',
  // Children (spawnSplit params)
  count: 4,             // number of child bombs
  childAngle: Math.PI,  // spread width (π = full upward hemisphere)
  childDirection: -Math.PI / 2, // center direction (up)
  childForce: 300,      // child launch force (px/s)
  childTtl: 2,          // child fuse seconds
  childDamage: 15,      // child blast damage
  childRadius: 30,      // child blast radius (px)
});

registerMacro('clusterBomb', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Cluster Bomb',
    effects: [],
    desc: 'Parent bomb detonates → spawns N smaller bombs in a fan. Each child explodes on its own impact/fuse.',
    invokes: ['explosiveBomb', 'spawnSplit'],
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
      { key: 'count', desc: 'number of child bombs' },
      { key: 'childAngle', desc: 'child spread width (radians)' },
      { key: 'childDirection', desc: 'child center direction (radians)' },
      { key: 'childForce', desc: 'child launch force (px/s)' },
      { key: 'childTtl', desc: 'child fuse seconds' },
      { key: 'childDamage', desc: 'child blast damage' },
      { key: 'childRadius', desc: 'child blast radius (px)' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('clusterBomb');

    const parent = invoke('explosiveBomb', {
      speed: p.speed,
      direction: p.direction,
      arc: p.arc,
      bounce: p.bounce,
      ttl: p.ttl,
      damage: p.damage,
      radius: p.radius,
      origin: p.origin,
      blastTeam: p.blastTeam,
    }, ctx);

    if (!parent?.entity) {
      h._emit('expire');
      h._complete();
      return h;
    }

    parent._params = p;
    parent.on('hit', (...args) => h._emit('hit', ...args));

    // Track completion: parent must finish AND all children must finish.
    let parentDone = false;
    let childrenDone = true; // no children yet = trivially done
    const checkComplete = () => {
      if (parentDone && childrenDone) h._complete();
    };

    parent.on('complete', () => {
      parentDone = true;
      checkComplete();
    });

    // On the carrier's detonate event, fire the split.
    const carrier = parent.inner ?? parent;
    carrier.on('detonate', ({ x, y }) => {
      try {
        const split = invoke('spawnSplit', {
          x, y,
          count: p.count,
          centerDirection: p.childDirection,
          angle: p.childAngle,
          force: p.childForce,
          spawnType: 'bomb',
          bomb: {
            speed: p.childForce,
            direction: p.childDirection,
            arc: p.arc,
            bounce: false,
            ttl: p.childTtl,
            damage: p.childDamage,
            radius: p.childRadius,
            blastTeam: p.blastTeam,
          },
        }, ctx);
        h.children = split;
        if (split?.handles?.length > 0) {
          childrenDone = false;
          for (const ch of split.handles) {
            ch.on('hit', (...args) => h._emit('hit', ...args));
          }
          split.on('complete', () => {
            childrenDone = true;
            checkComplete();
          });
        }
      } catch (err) {
        console.error(`attack/clusterBomb: split failed`, err.message);
      }
    });

    h.setInner(parent);
    h.entity = parent.entity;
    h.inner = parent;
    return h;
  },
});
