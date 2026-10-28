// Ballistic Arc carrier → persistent mine. Hosts own all flight integration/collision.
import {defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { stepBombTerrain } from '../primitives/ballistic.js';
import { MINE_DEFAULTS, MINE_PARAMS } from './mine.js';

defineMacro('throwMine', {
  attacks: [{ id: 'ballistic', role: 'carrier' }, { id: 'mine', role: 'payload' }],
  params: { ...MINE_DEFAULTS, speed: 500, direction: -0.5, arc: 1000, bounce: true, origin: null },
  meta: { name: 'Throw Mine', desc: 'Bouncing mine; fuse starts at rest. Airborne contact arms a warning that starts on landing.',
    effects: [{ type: 'blink-transition', desc: 'mine warning overlay' }],
    params: [...MINE_PARAMS,
      { key: 'speed', desc: 'launch speed px/s' }, { key: 'direction', desc: 'launch radians' },
      { key: 'arc', desc: 'gravity px/s²' }, { key: 'bounce', desc: 'bounce before settling' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' }],
  },
  impl(p, ctx) {
    const carrier = invoke('ballistic', {
      speed: p.speed, direction: p.direction, arc: p.arc, bounce: p.bounce,
      origin: p.origin, team: p.team, damage: 0, ttl: null,
      retainOnContact: true, retainOnSettle: true,
    }, ctx);
    const h = invoke('mine', p, ctx);
    h.inner = carrier; // lifecycle owned here, never proxy carrier completion
    const ent = carrier.entity;
    if (!ent) { h._complete(); return h; }
    h.entity = ent;
    // Same rectangular body for collision and visual; Special remains the only integrator.
    const cx = ent.x + ent.w / 2, cy = ent.y + ent.h / 2;
    Object.assign(ent, { x: cx - 12, y: cy - 4, w: 24, h: 8, _attackVisualOwned: true });
    Object.assign(ent.box, { ox: 0, oy: 0, bw: 24, bh: 8 });
    const box = h.state.box;
    const sync = () => { box.x = ent.x; box.y = ent.y; };
    sync();
    h.state.settled = false;
    carrier.on('contact', ({ target }) => { if (h.validTarget(target)) h.arm(); });
    const step = h.step;
    h.step = (dt, targets) => {
      if (h._completed || h._cancelled) return true;
      if (!h.state.settled) {
        if (!ctx.bombTerrainStepped) {
          stepBombTerrain(ent, dt, p.groundY ?? ctx.groundY, p.platforms ?? ctx.platforms ?? []);
        }
        sync();
        if (h.checkContact(targets)) h.arm();
        if (!ent.alive) { carrier.cancel(); h.cancel(); return true; }
        if (ent._bombSettled) {
          // Snapshot the resting body and release the pooled flight carrier.
          h.state.settled = true;
          carrier.cancel();
          h.entity = null;
          return step(0, targets); // landing time never consumes resting TTL
        }
      }
      return step(dt, targets);
    };
    const cancel = h.cancel.bind(h);
    h.cancel = () => { carrier.cancel(); cancel(); };
    return h;
  },
});
