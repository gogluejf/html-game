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

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { spreadAngles } from './spreadShot.js';
import { makeEnemy } from '../../../world/build.js';
import { GRAVITY } from '../../../consts.js';
import { resolveCarrier } from '../carrierMacro.js';
import { stepBomb, stepBombTerrain } from '../primitives/bomb.js';
import { stepProjectile } from '../primitives/projectile.js';

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
  spawnType: 'projectile', // 'projectile' | 'bomb' | 'enemy'
  enemyType: 'jester',
  bomb: null,
  projectile: { ttl: 2, damage: 8 },
});

/**
 * Generate N child launch descriptors (pure vector math). Exported for tests.
 * Each child: { x, y, vx, vy, angle, spawnType, enemyType?, bomb? }.
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
    spawnType: p.spawnType ?? 'projectile',
    enemyType: p.spawnType === 'enemy' ? (p.enemyType ?? 'jester') : undefined,
    bomb: p.spawnType === 'bomb' ? (p.bomb ?? {}) : undefined,
  }));
}

/** Flight-time estimate from vertical velocity (rise + fall + margin). */
function flightStun(vy) {
  const rise = Math.max(0, -vy) / GRAVITY;
  return Math.max(0.3, rise * 2 + 0.2);
}

defineMacro('spawnSplit', {
  attacks: [
    { id: 'projectile', role: 'child' },
    { id: 'explosiveBomb', role: 'child' },
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
      { key: 'count', desc: 'children created' },
      { key: 'centerDirection', desc: 'central direction (radians)' },
      { key: 'angle', desc: 'distribution width (radians)' },
      { key: 'force', desc: 'launch speed (px/s)' },
      { key: 'spawnType', desc: 'projectile | bomb | enemy' },
      { key: 'enemyType', desc: 'enemy id when spawnType=enemy' },
      { key: 'bomb', desc: 'bomb params when spawnType=bomb' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('spawnSplit');
    const p = { ...DEFAULTS, ...params };

    const children = splitChildren(p);
    h.children = children;

    const handles = [];
    const enemies = [];

    for (const c of children) {
      const speed = Math.hypot(c.vx, c.vy);
      if (c.spawnType === 'enemy') {
        const e = makeEnemy(c.enemyType ?? p.enemyType, c.x - 16, c.y - 24);
        if (!e) continue;
        e.vx = c.vx;
        e.vy = c.vy;
        e.hitstunTimer = flightStun(c.vy);
        enemies.push(e);
      } else if (c.spawnType === 'bomb') {
        const b = p.bomb ?? {};
        // Classic exploding bomb → the explosiveBomb macro (composition:
        // bomb flight + explosion payload). Primitives don't compose, so the
        // "it explodes" behavior is a macro concern.
        const child = invoke('explosiveBomb', {
          origin: { x: c.x, y: c.y }, direction: c.angle, speed,
          arc: b.arc ?? 700, bounce: b.bounce ?? true, ttl: b.ttl ?? 4,
          damage: b.damage ?? 25, radius: b.radius ?? 60,
          explodeOnContact: b.explodeOnContact ?? true,
        }, ctx);
        if (child?.entity) handles.push(child);
      } else {
        const pr = p.projectile ?? {};
        const child = invoke('projectile', {
          origin: { x: c.x, y: c.y }, direction: c.angle, speed,
          ttl: pr.ttl ?? 2, damage: pr.damage ?? 8,
        }, ctx);
        if (child?.entity) handles.push(child);
      }
    }

    h.handles = handles;
    h.enemies = enemies;

    // Unified stepping: host calls h.step(dt, targets) each frame.
    h.step = (dt, targets = []) => {
      for (const child of handles) {
        if (child._completed || child._cancelled) continue;
        const inner = resolveCarrier(child);
        if (inner.entity?._attackId === 'bomb') {
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
        ch.on('complete', done);
        ch.on('expire', done);
      }
      for (const ch of handles) {
        if (ch._completed || ch._cancelled) done();
      }
    }
    return h;
  },
});
