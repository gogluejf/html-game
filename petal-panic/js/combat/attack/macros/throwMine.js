// Ballistic Arc carrier → persistent mine. Hosts own all flight integration/collision.
import {defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { stepBombTerrain } from '../primitives/projectile.js';
import { mineDrawer } from '../drawers/ballistic/mine.js';
import { MINE_DEFAULTS, MINE_PARAMS } from './mine.js';

defineMacro('throwMine', {
  attacks: [{ id: 'projectile', role: 'carrier' }, { id: 'mine', role: 'payload' }],
  params: { ...MINE_DEFAULTS, speed: 500, direction: -0.5, arc: 1300, bounce: true, origin: null },
  meta: { name: 'Throw Mine', desc: 'Bouncing mine; fuse starts at rest. Airborne contact arms a warning that starts on landing.',
    effects: [{ type: 'blink-transition', desc: 'mine warning overlay' }],
    params: [...MINE_PARAMS,
      { key: 'speed', desc: 'launch speed px/s' }, { key: 'direction', desc: 'launch radians' },
      { key: 'arc', desc: 'gravity px/s²' }, { key: 'bounce', desc: 'bounce before settling' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' }],
  },
  impl(p, ctx) {
    // Plain gravity projectile — identical flight pipeline to rock/bomb
    // (stepBombTerrain + retain flags), but the carrier keeps the MINE body:
    // 24x8 flat slab + mineDrawer for the whole flight (same art as the
    // settled box). No rock look, no visual-ownership flags.
    // retainOnSettle keeps the carrier alive until it rests so we can
    // snapshot the landing point.
    const carrier = invoke('projectile', {
      speed: p.speed, direction: p.direction, arc: p.arc, bounce: p.bounce,
      width: 24, height: 8,
      drawer: mineDrawer,
      origin: p.origin, team: p.team, damage: 0, ttl: null,
      retainOnContact: true, retainOnSettle: true,
    }, ctx);
    const h = invoke('mine', p, ctx);
    h.inner = carrier; // lifecycle owned here, never proxy carrier completion
    const ent = carrier.entity;
    if (!ent) { h._complete(); return h; }
    h.entity = ent;
    const box = h.state.box;
    // Resting body matches the flight carrier (24x8 slab) so the settle frame
    // shows no size jump. The base `mine` (no carrier) keeps its own 24x8 box
    // — this only runs for throwMine, which parks the live carrier.
    Object.assign(box, { w: ent.w, h: ent.h });
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
