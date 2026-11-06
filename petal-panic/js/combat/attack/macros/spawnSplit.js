// Attack Engine — Spawn / Split (macro). ONE object, one id.
//
// Owns the full spawn-split behavior: generate N fan vectors AND materialize
// each into a live attack (projectile/bomb via invoke) or a real enemy entity
// (via makeEnemy). Callers stay declarative — invoke 'spawnSplit', get live
// results. No caller loops children or handles launch physics.
//
// It's a MACRO (not a primitive) because it composes other attacks via invoke().
// The vector math (splitChildren) lives here too — it's small and only this
// attack uses it, so there's no separate primitive file to keep in sync.
//
// Handle shape (what callers read):
//   h.children  — raw fan vectors, for inspection
//   h.handles   — live handles for materialized projectiles/bombs
//   h.enemies   — created enemy entities (caller adds to its world + steps AI;
//                 per-frame enemy AI is the GAME LOOP's job, never the engine's)
//   complete    — fires once all materialized projectile/bomb handles end
//                 (enemies are caller-stepped, so they don't gate completion)
//
// Enemy launch: each enemy gets the fan velocity + a knockback-style hitstun so
// gravity integrates the full X+Y arc before AI resumes (same as shoving an
// enemy in gameplay). Grounding is the caller's job (it owns the floor/world).

import './throwMine.js';
import './shockwaveBomb.js'; // ensure registered (spawnSplit child)
import { SHOCK_BOMB_DEFAULTS } from './shockwaveBomb.js';
import './rock.js'; // ensure registered (spawnSplit child)
import { ROCK_DEFAULTS } from './rock.js';
import { defineMacro } from '../defineMacro.js';
import { AttackHandle } from '../engine.js';
import { invokeChild } from '../attackIds.js';
import { spreadAngles } from './spreadShot.js';
import { makeEnemy } from '../../../world/build.js';
import { GRAVITY } from '../../../consts.js';
import { resolveCarrier } from '../carrierMacro.js';
import { stepBomb, stepBombTerrain } from '../primitives/projectile.js';
import { stepProjectile } from '../primitives/projectile.js';

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
  x: 0,
  y: 0,
  count: 3,
  centerDirection: 0,
  angle: Math.PI / 3,
  force: 300,
  inheritVelocity: 0,
  parentVx: 0,
  parentVy: 0,
  delay: 0,
  child: 'projectile',     // any ATTACK_IDS child — one fan, one child type
  mineType: 'explosion',
  mine: { ttl: 2, blinkDuration: 2 },
  enemyType: 'explosive_monkey',
  enemy: { mineType: 'explosion', ttl: null }, // nested throwEnemy config when child='enemy'
  bomb: null,
  projectile: { ttl: 2, damage: 8 },
  blast: { explosionRadius: 60, shockRadius: 150, fireWidth: 96 }, // legacy impact-child sizes
  // Sub-payload contract (unified): one nested object, keys per the child's
  // CHILD_PARAM_SPECS (attackIds.js). NULL by default — a concrete default
  // would clobber the caller's flat legacy keys (mine.*, blast.*, ...) at
  // every read now that payload wins. With null, flat keys fall through and
  // unconfigured children read their OWN target-macro defaults (single owner).
  payload: null,
  blastTeam: 'neutral',
});

/**
 * Generate N child launch descriptors (pure vector math). Exported for tests.
 * Each child: { x, y, vx, vy, angle, child, enemyType?, bomb? }.
 */
export function splitChildren(p) {
  const angles = spreadAngles(p.count, p.centerDirection, p.angle);
  const ivx = (p.parentVx ?? 0) * (p.inheritVelocity ?? 0);
  const ivy = (p.parentVy ?? 0) * (p.inheritVelocity ?? 0);
  return angles.map((a) => ({
    x: p.x, y: p.y,
    vx: Math.cos(a) * p.force + ivx,
    vy: Math.sin(a) * p.force + ivy,
    angle: a,
    child: p.child ?? 'projectile',
    enemyType: p.child === 'enemy' ? (p.enemyType ?? 'explosive_monkey') : undefined,
    ballistic: p.child === 'bomb' ? (p.ballistic ?? {}) : undefined,
  }));
}

/** Flight-time estimate from vertical velocity (rise + fall + margin). */
function flightStun(vy) {
  const rise = Math.max(0, -vy) / GRAVITY;
  return Math.max(0.3, rise * 2 + 0.2);
}

// Enemy children no longer spawn as immediate entities: they are THROWN via
// the throwEnemy macro (ballistic carrier → real enemy on landing), so the
// fan velocity becomes a genuine arc instead of an instant shove. The legacy
// makeEnemy path is kept only for non-throwable types when `enemy.thrown`
// is explicitly false.

defineMacro('spawnSplit', {
  attacks: [
    { id: 'projectile', role: 'child' },
    { id: 'explosiveBomb', role: 'child' },
    { id: 'shockwaveBomb', role: 'child' },
    { id: 'throwMine', role: 'child' },
    { id: 'throwEnemy', role: 'child' },
    { id: 'molotov', role: 'child' },
    { id: 'explosiveProjectile', role: 'child' },
    { id: 'shockwaveProjectile', role: 'child' },
    { id: 'rock', role: 'child' },
    { id: 'napalm', role: 'child' },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Spawn / Split',
    // No native effects: VFX come from the children it materializes —
    // bomb children bring explosion/camera-shake (via the explosiveBomb
    // macro → Bomb primitive), projectile children bring hit-sparkle/debris.
    // resolveEffects() surfaces them as inherited rows; declaring them here
    // would duplicate.
    effects: [],
    desc: 'Fan out N children and materialize each into a live projectile/bomb or enemy. Declarative — one invoke, live results.',
    params: [
      { key: 'child', desc: 'any ATTACK_IDS child: projectile | bomb | mine | molotov | enemy | expl_proj | shock_proj | shock_bomb | rock | napalm' },
      { key: 'payload', desc: 'sub-payload config object — keys per the child (see CHILD_PARAM_SPECS); legacy flat keys below still work' },
      { key: 'count', desc: 'children created' },
      { key: 'centerDirection', desc: 'central direction (radians)' },
      { key: 'angle', desc: 'distribution width (radians)' },
      { key: 'force', desc: 'launch speed (px/s)' },
      { key: 'mine', desc: 'legacy: throwMine params (overrides payload.mine); ttl null = contact only' },
      { key: 'enemy', desc: 'legacy: nested throwEnemy config (overrides payload.enemy); thrown:false = immediate spawn' },
      { key: 'bomb', desc: 'legacy: exploding-bomb params (overrides payload.bomb)' },
      { key: 'blast.explosionRadius', desc: 'legacy: blast radius when child=explosion (px)' },
      { key: 'blast.shockRadius', desc: 'legacy: ring radius when child=shockwave (px)' },
      { key: 'blast.fireWidth', desc: 'legacy: burn width when child=napalm (px)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('spawnSplit', null, declaredEffectsOf('spawnSplit'));
    const p = { ...DEFAULTS, ...params };

    const children = splitChildren(p);
    h.children = children;

    const handles = [];
    const enemies = [];

    // Sub-payload resolution (unified contract): the nested `payload` object
    // (keys per CHILD_PARAM_SPECS in attackIds.js) is the SINGLE config
    // surface — one sub-object per child, read ONLY by its child. The panel
    // materializes it from the TARGET macro's own defaults, so display always
    // equals behavior. Legacy flat keys/sub-objects (p.mine, p.enemy, p.bomb,
    // p.blast.*, p.damage) are FILL-ONLY: they apply to keys the payload does
    // not set (explicit nulls in the payload survive), never the reverse.
    const pl = p.payload ?? {};
    const defined = (o) => Object.fromEntries(
      Object.entries(o ?? {}).filter(([, v]) => v !== undefined));
    const cfg = (child, legacy, defaults, { damageKey } = {}) => {
      const sub = pl[child] ?? {};
      const merged = { ...defaults, ...defined(legacy), ...sub };
      if (damageKey) merged[damageKey] = sub[damageKey]
        ?? defined(legacy)[damageKey]
        ?? p.damage ?? defaults[damageKey];
      return merged;
    };

    // The child → invoke-target mapping is centralized in attackIds.js:
    // each branch below only shapes the params its target reads; invokeChild
    // resolves c.child to the concrete id (and fails loud on an unknown one).
    for (const c of children) {
      const speed = Math.hypot(c.vx, c.vy);
      if (c.child === 'enemy') {
        const ec = cfg('enemy', { thrown: p.enemy?.thrown },
          { enemyType: p.enemyType ?? 'explosive_monkey', mineType: p.mineType ?? 'explosion', ttl: null });
        // Default: the child is THROWN (ballistic arc → real enemy on
        // landing) via throwEnemy — same bomb primitive + terrain path as
        // throwMine, no duplicated physics. The fan velocity becomes the
        // launch vector; inherited velocity already folded into c.vx/c.vy.
        // `enemy.thrown === false` (legacy key, still honored) keeps the
        // immediate makeEnemy spawn with fan velocity + hitstun.
        if (ec.thrown === false) {
          const e = makeEnemy(c.enemyType ?? p.enemyType ?? 'explosive_monkey', c.x - 16, c.y - 24);
          if (!e) continue;
          e.vx = c.vx;
          e.vy = c.vy;
          e.hitstunTimer = flightStun(c.vy);
          enemies.push(e);
        } else {
          const child = invokeChild(c.child, {
            ...ec,
            origin: { x: c.x, y: c.y }, direction: Math.atan2(c.vy, c.vx), speed,
            groundY: p.groundY, platforms: p.platforms,
            target: p.target ?? ctx.world?.hero ?? null,
          }, ctx);
          handles.push(child);
          // Landed enemies surface in h.enemies as they materialize so hosts
          // keep the same registration contract as before. The 'land' event is
          // emitted SYNCHRONOUSLY inside this loop (the carrier can settle on
          // its first step), so subscribe BEFORE stepping any child — a
          // post-loop subscription would miss early landings.
          child.on('land', ({ enemy }) => { if (enemy) enemies.push(enemy); });
        }
      } else if (c.child === 'mine') {
        // throwMine owns ALL mine defaults (single source). Legacy flat keys
        // fill only what the payload leaves unset.
        const m = cfg('mine', {
          ttl: p.mine?.ttl, blinkDuration: p.mine?.blinkDuration, mineType: p.mineType,
        }, {});
        const child = invokeChild(c.child, {
          ...m,
          origin: { x: c.x, y: c.y }, direction: Math.atan2(c.vy, c.vx), speed,
          groundY: p.groundY, platforms: p.platforms,
        }, ctx);
        handles.push(child);
      } else if (c.child === 'bomb') {
        // Classic exploding bomb → the explosiveBomb macro (composition:
        // bomb flight + explosion payload). Primitives don't compose, so the
        // "it explodes" behavior is a macro concern.
        // explosiveBomb owns ALL bomb defaults (single source).
        const b = cfg('bomb', {
          arc: p.bomb?.arc, bounce: p.bomb?.bounce, ttl: p.bomb?.ttl,
          damage: p.bomb?.damage, radius: p.bomb?.radius,
          blastTeam: p.bomb?.blastTeam, explodeOnContact: p.bomb?.explodeOnContact,
        }, {});
        const child = invokeChild(c.child, {
          origin: { x: c.x, y: c.y - 9 }, direction: c.angle, speed,
          arc: b.arc, bounce: b.bounce, ttl: b.ttl,
          damage: b.damage, radius: b.radius,
          blastTeam: b.blastTeam ?? p.blastTeam,
          groundY: p.groundY, platforms: p.platforms,
          explodeOnContact: b.explodeOnContact,
        }, ctx);
        if (child?.entity) handles.push(child);
      } else if (c.child === 'shock_bomb') {
        // Shockwave bomb → the shockwaveBomb macro (composition:
        // bomb flight + telegraph blink + shockwave ring payload).
        // shockwaveBomb owns ALL defaults (single source).
        const sb = cfg('shock_bomb', {
          arc: p.shockBomb?.arc, bounce: p.shockBomb?.bounce, ttl: p.shockBomb?.ttl,
          damage: p.shockBomb?.damage, radius: p.shockBomb?.radius,
          duration: p.shockBomb?.duration,
          blastTeam: p.shockBomb?.blastTeam, explodeOnContact: p.shockBomb?.explodeOnContact,
        }, SHOCK_BOMB_DEFAULTS);
        const child = invokeChild(c.child, {
          origin: { x: c.x, y: c.y - 9 }, direction: c.angle, speed,
          arc: sb.arc, bounce: sb.bounce, ttl: sb.ttl,
          damage: sb.damage, radius: sb.radius, duration: sb.duration,
          blastTeam: sb.blastTeam ?? p.blastTeam,
          groundY: p.groundY, platforms: p.platforms,
          explodeOnContact: sb.explodeOnContact,
        }, ctx);
        if (child?.entity) handles.push(child);
      } else if (c.child === 'molotov') {
        // Fire lobe → the molotov macro (ballistic carrier + fireArea payload
        // on impact). Same composition pattern as the bomb branch above.
        // molotov owns ALL fire-lobe defaults (single source).
        const m = cfg('molotov', {
          arc: p.molotov?.arc, bounce: p.molotov?.bounce, ttl: p.molotov?.ttl,
          damage: p.molotov?.damage, fireWidth: p.molotov?.fireWidth,
          fireDuration: p.molotov?.fireDuration, fireTickRate: p.molotov?.fireTickRate,
          fireDamage: p.molotov?.fireDamage, team: p.molotov?.team,
        }, {});
        const child = invokeChild(c.child, defined({
          origin: { x: c.x, y: c.y - 9 }, direction: c.angle, speed,
          arc: m.arc, bounce: m.bounce, ttl: m.ttl,
          damage: m.damage, fireWidth: m.fireWidth,
          fireDuration: m.fireDuration, fireTickRate: m.fireTickRate,
          fireDamage: m.fireDamage, team: m.team,
          groundY: p.groundY, platforms: p.platforms,
        }), ctx);
        if (child?.entity) handles.push(child);
      } else if (c.child === 'expl_proj' || c.child === 'shock_proj' || c.child === 'napalm') {
        // Impact child → straight carrier macro (explosiveProjectile /
        // shockwaveProjectile / napalm): flies the fan vector and detonates at
        // its death point (contact, surface, or ttl) — same composition as
        // skyMissile's payloads, no settle/rest phase. The macro's .step()
        // drives flight + payload; h.step above steps any handle that has one.
        // The carrier macros own their size defaults (single source); legacy
        // blast.* fills only what the payload leaves unset.
        const bl = cfg(c.child, {
          radius: c.child === 'shock_proj' ? p.blast?.shockRadius : c.child === 'expl_proj' ? p.blast?.explosionRadius : undefined,
          fireWidth: c.child === 'napalm' ? p.blast?.fireWidth : undefined,
        }, {});
        const child = invokeChild(c.child, {
          origin: { x: c.x, y: c.y }, direction: c.angle, speed,
          solidBehavior: 'stop',
          ...((c.child === 'napalm')
            ? { fireWidth: bl.fireWidth }
            : { radius: bl.radius }),
          // Do not pass an absent damage override: the payload macro owns its
          // default contact+blast damage (legacy behavior preserved).
          ...(p.damage != null ? { damage: p.damage } : {}),
          ...(p.blastTeam != null ? { blastTeam: p.blastTeam } : {}),
        }, ctx);
        if (child?.entity) handles.push(child);
      } else if (c.child === 'rock') {
        // Rock → the rock macro (composition: arc flight + decay bounce,
        // NO explosion — contact damage only, ttl fuse). rock owns ALL
        // defaults (single source).
        const rk = cfg('rock', {
          arc: p.rock?.arc, ttl: p.rock?.ttl, damage: p.rock?.damage, spin: p.rock?.spin,
        }, ROCK_DEFAULTS);
        const child = invokeChild(c.child, {
          origin: { x: c.x, y: c.y - 9 }, direction: c.angle, speed,
          arc: rk.arc, ttl: rk.ttl, damage: rk.damage, spin: rk.spin,
          groundY: p.groundY, platforms: p.platforms,
        }, ctx);
        if (child?.entity) handles.push(child);
      } else {
        // The projectile primitive owns its default contact damage (single
        // source); legacy p.projectile.damage / p.damage fill below it.
        const pr = cfg('projectile', { damage: p.projectile?.damage },
          {}, { damageKey: 'damage' });
        const child = invokeChild(c.child, {
          origin: { x: c.x, y: c.y - 9 }, direction: c.angle, speed,
          damage: pr.damage,
        }, ctx);
        if (child?.entity) handles.push(child);
      }
    }

    h.handles = handles;
    h.enemies = enemies; // live list: thrown children append here on landing
    const cancel = h.cancel.bind(h);
    h.cancel = () => { for (const child of handles) child.cancel(); cancel(); };

    // Unified stepping: host calls h.step(dt, targets) each frame.
    h.step = (dt, targets = []) => {
      for (const child of handles) {
        if (child._completed || child._cancelled) continue;
        if (child.step) { child.step(dt, targets); continue; }
        const inner = resolveCarrier(child);
        if (inner.entity?._arcRecipe) {
          const groundY = p.groundY ?? ctx.groundY;
          const platforms = p.platforms ?? ctx.platforms ?? [];
          if (groundY != null) stepBombTerrain(inner.entity, dt, groundY, platforms);
          stepBomb(inner.entity, inner._params ?? p, ctx, inner);
        } else if (inner.entity?._attackId === 'projectile') {
          stepProjectile(inner.entity, inner);
        }
      }
      return h._completed;
    };

    if (handles.length === 0) {
      h._complete({ count: children.length, enemies: enemies.length });
    } else {
      let remaining = handles.length;
      const done = () => {
        remaining -= 1;
        if (remaining <= 0) h._complete({ count: children.length, enemies: enemies.length });
      };
      for (const ch of handles) {
        // throwEnemy roots stay OPEN while the landed enemy lives — completion
        // only fires when the enemy is fully gone. Hosts that step the root
        // (BombAttackHost / theater) keep stepping until then.
        if (ch.id !== 'throwEnemy') {
          ch.on('complete', done);
          ch.on('expire', done);
          if (ch._completed || ch._cancelled) done();
        }
      }
      // No immediate-kill children → nothing to wait for beyond the handles
      // above; a pure-throwEnemy split stays open by design (host-driven).
    }
    return h;
  },
});
