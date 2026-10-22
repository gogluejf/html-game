// Macro-owned flight avoids pooled Special TTL/contact killing an armed mine.
// Reuses bomb terrain restitution/friction/settle threshold, not a second physics rule.
import {defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { stepBombTerrain } from '../primitives/bomb.js';
import { MINE_DEFAULTS, MINE_PARAMS } from './mine.js';

defineMacro('throwMine', {
  attacks: [{ id: 'mine', role: 'payload' }],
  params: { ...MINE_DEFAULTS, speed: 500, direction: -0.5, arc: 800, bounce: true, origin: null },
  meta: { name: 'Throw Mine', desc: 'Bouncing mine; fuse starts at rest. Airborne contact arms a warning that starts on landing.',
    effects: [{ type: 'blink-transition', desc: 'mine warning overlay' }],
    params: [...MINE_PARAMS,
      { key: 'speed', desc: 'launch speed px/s' }, { key: 'direction', desc: 'launch radians' },
      { key: 'arc', desc: 'gravity px/s²' }, { key: 'bounce', desc: 'bounce before settling' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' }],
  },
  impl(p, ctx) {
    const a = ctx.attacker;
    const origin = typeof p.origin === 'string'
      ? (ctx.markers ?? a?.markers ?? []).find(m => m.label === p.origin)
      : p.origin;
    const x = origin?.x ?? (a.x + a.w / 2);
    const y = origin?.y ?? (a.y + a.h / 2);
    const h = invoke('mine', { ...p, x }, ctx);
    const b = h.state.box;
    Object.assign(b, { y: y - b.h / 2, vx: Math.cos(p.direction) * p.speed,
      vy: Math.sin(p.direction) * p.speed, alive: true, solidBehavior: p.bounce ? 'reflect' : 'stop' });
    h.state.settled = false;
    const step = h.step;
    h.step = (dt, targets) => {
      if (h._completed || h._cancelled) return true;
      if (!h.state.settled) {
        if (h.checkContact(targets)) h.arm();
        b._bombPrevBottom = b.y + b.h;
        b.vy += p.arc * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        stepBombTerrain(b, dt, p.groundY ?? ctx.groundY, p.platforms ?? ctx.platforms ?? []);
        if (b._bombSurfaceY != null && (!b.alive || b.vy === 0)) {
          b.alive = true; b.vx = b.vy = 0;
          h.state.settled = true;
          // Landing frame belongs to flight, not to the resting TTL.
          return step(0, targets);
        }
      }
      return step(dt, targets);
    };
    return h;
  },
});
