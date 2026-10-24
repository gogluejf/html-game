// Ballistic Arc carrier → real Enemy entity. Hosts own all flight integration/collision.
//
// The generic "throw a living thing" composition, built on the SAME bomb
// (Ballistic Arc) primitive + stepBombTerrain() path as throwMine — no
// duplicated physics. Two phases with two owners:
//   FLYING  — the pooled Special carrier (projectile/bomb layer). This macro
//             steps it exactly like throwMine does (terrain, retain flags).
//   LANDED  — a REAL Enemy entity spawned at the rest point via makeEnemy().
//             From here it lives in the enemy layer: host AI stepping, world
//             collision registration, normal enemy rules. For the default
//             'explosive_monkey' payload that means walk-toward-target +
//             contact/TTL detonation through the shared explosion/shockwave
//             primitives.
//
// On settling, the carrier is cancelled/released (pooled slot freed) and the
// handle transfers to the landed entity. Completion fires when the landed
// enemy is fully gone (death pipeline finished) — or immediately if no enemy
// could be spawned (unknown type / pool-free spawn failure).

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { AttackHandle } from '../engine.js';
import { stepBombTerrain } from '../primitives/bomb.js';
import { makeEnemy } from '../../../world/build.js';

export const THROW_ENEMY_DEFAULTS = Object.freeze({
  // --- flight (bomb primitive params; arc 1000 = recent user preference) ----
  speed: 500,
  direction: -0.5,
  arc: 1000,
  bounce: true,
  origin: null,          // marker label | {x,y} | null → attacker center
  // --- payload ---------------------------------------------------------------
  enemyType: 'explosive_monkey',
  ttl: null,             // fuse seconds from enemy spawn; null = contact only
  settleDelay: 0.2,      // legacy option; TTL starts at enemy spawn
  explodeOnContact: true,
  mineType: 'explosion', // explosion | shockwave
  team: 'neutral',       // ally | foe | neutral (who the blast hurts)
  damage: 40,
  radius: 70,
});

defineMacro('throwEnemy', {
  attacks: [{ id: 'bomb', role: 'carrier' }, { id: 'explosion', role: 'payload' }, { id: 'shockwave', role: 'payload' }],
  params: { ...THROW_ENEMY_DEFAULTS },
  meta: { name: 'Throw Enemy', desc: 'Ballistic carrier that lands and BECOMES a real enemy (default: explosive monkey). Flight = bomb layer; landed = enemy layer/AI.',
    effects: [],
    params: [
      { key: 'speed', desc: 'launch speed px/s' }, { key: 'direction', desc: 'launch radians' },
      { key: 'arc', desc: 'gravity px/s²' }, { key: 'bounce', desc: 'bounce before settling' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
      { key: 'enemyType', desc: 'ENEMY_FACTORIES id materialized on landing' },
      { key: 'ttl', desc: 'fuse seconds from enemy spawn; null = contact only' },
      { key: 'settleDelay', desc: 'legacy option; does not delay the spawn-based fuse' },
      { key: 'explodeOnContact', desc: 'detonate on first valid body contact' },
      { key: 'mineType', desc: 'explosion | shockwave payload subtype' },
      { key: 'team', desc: 'ally targets enemies; foe targets hero; neutral targets both' },
      { key: 'damage', desc: 'payload damage' }, { key: 'radius', desc: 'payload radius (px)' },
    ],
  },
  impl(p, ctx) {
    const h = new AttackHandle('throwEnemy', null, []);
    h._params = p;
    const carrier = invoke('bomb', {
      speed: p.speed, direction: p.direction, arc: p.arc, bounce: p.bounce,
      origin: p.origin, team: p.team, damage: 0, ttl: null,
      retainOnContact: true, retainOnSettle: true,
    }, ctx);
    h.inner = carrier; // lifecycle owned here, never proxy carrier completion
    const ent = carrier.entity;
    if (!ent) { h._complete(); return h; }
    h.entity = ent;
    h.state = { settled: false, enemy: null };

    const groundY = () => p.groundY ?? ctx.groundY;
    const platforms = () => p.platforms ?? ctx.platforms ?? [];

    const land = () => {
      // Snapshot the resting body and release the pooled flight carrier.
      const cx = ent.x + ent.w / 2, cy = ent.y + ent.h / 2;
      carrier.cancel();
      h.entity = null;
      const e = makeEnemy(p.enemyType, cx - 14, cy - 18);
      if (!e) { h._complete({ landed: false }); return; }
      // Wire the detonation config for supported payload types.
      if (typeof e.applyThrowConfig === 'function') {
        e.applyThrowConfig({
          ttl: p.ttl, settleDelay: p.settleDelay, explodeOnContact: p.explodeOnContact,
          mineType: p.mineType, team: p.team, damage: p.damage, radius: p.radius,
          target: p.target ?? ctx.world?.hero ?? null,
        });
        e._attackCtx = ctx;
        e._heroRef = ctx.world?.hero ?? null;
      }
      e.hitstunTimer = 0.3; // short landing beat so the throw reads as an arc
      h.state.enemy = e;
      h.entity = e;
      ctx.collisionWorld?.add(e);
      h._emit('land', { x: cx, y: cy, enemy: e });
    };

    const step = (dt, targets) => {
      if (h._completed || h._cancelled) return true;
      if (!h.state.settled) {
        if (!ctx.bombTerrainStepped) stepBombTerrain(ent, dt, groundY(), platforms());
        if (!ent.alive) { carrier.cancel(); h.cancel(); return true; }
        if (ent._bombSettled) { h.state.settled = true; land(); return false; }
        return false;
      }
      // Landed phase: the enemy entity owns its own update() (host-driven);
      // this step only tracks its lifetime for completion.
      const e = h.state.enemy;
      if (!e) return true;
      if (e.hostStep) e.hostStep(dt, targets);
      return !e.alive;
    };
    h.step = step;
    const cancel = h.cancel.bind(h);
    h.cancel = () => {
      const e = h.state.enemy;
      if (e) {
        // Clean removal: kill the entity and drop it from the collision world.
        e.alive = false;
        ctx.collisionWorld?.remove(e);
      } else if (ent && !ent._attackDone) {
        ent.alive = false;
        ent._attackDone = true;
        ctx.collisionWorld?.remove(ent);
      }
      cancel();
    };
    return h;
  },
});
