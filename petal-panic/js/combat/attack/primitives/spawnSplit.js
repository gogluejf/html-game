// Attack Engine — Spawn / Split primitive (Task 1.17).
//
// Creates N child launch vectors from a parent event (detonation, hit,
// expiration, or explicit trigger). Like Spread, this is a GENERATOR: it
// produces spawn descriptors (position + velocity per child) that the host
// feeds into the Projectile/Bomb primitives. It spawns nothing itself —
// keeping it pool-free and testable.
//
// Synchronous: impl() completes immediately; results on `handle.children`.
// Each child: { x, y, vx, vy, angle } ready to drive a pool spawn.
//
// Typical composition (Cluster_Bomb macro):
//   bomb.on('detonate', () => {
//     const split = attackEngine.invoke('spawnSplit', { count: 4, ... }, ctx);
//     for (const c of split.children)
//       attackEngine.invoke('projectile', { origin: {x:c.x,y:c.y}, direction: c.angle, speed: Math.hypot(c.vx,c.vy), ... }, ctx);
//   });

import { registerPrimitive } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { spreadAngles } from './spread.js';

const DEFAULTS = Object.freeze({
  x: 0,               // parent event position (world)
  y: 0,
  count: 3,           // children created
  centerDirection: 0, // central launch direction (radians)
  angle: Math.PI / 3, // distribution width (radians); 2π = radial
  force: 300,         // launch speed (px/s)
  inheritVelocity: 0, // 0..1 fraction of parent velocity added to each child
  parentVx: 0,        // parent velocity (for inheritance)
  parentVy: 0,
  delay: 0,           // seconds before the spawn happens (host honors this)
  spawnType: 'projectile', // 'projectile' | 'bomb' | 'enemy' — what children become
  enemyType: 'jester',    // enemy id when spawnType === 'enemy' (ENEMY_FACTORIES key)
  bomb: null,         // bomb params override when spawnType === 'bomb'
                      //   { arc, bounce, ttl, damage, radius, explodeOnContact }
});

/**
 * Generate N child launch descriptors.
 * Each child: { x, y, vx, vy, angle, spawnType, enemyType?, bomb? } ready to
 * drive a pool spawn via the Projectile/Bomb primitive, or an enemy factory
 * for spawnType === 'enemy'.
 * @returns {Array<object>}
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

registerPrimitive('spawnSplit', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Spawn / Split',
    desc: 'Generates N child launch vectors from a parent event. Feed into Projectile/Bomb. Synchronous — reads handle.children.',
    params: [
      { key: 'x', desc: 'parent event x (world)' },
      { key: 'y', desc: 'parent event y (world)' },
      { key: 'count', desc: 'children created' },
      { key: 'centerDirection', desc: 'central direction (radians)' },
      { key: 'angle', desc: 'distribution width (radians)' },
      { key: 'force', desc: 'launch speed (px/s)' },
      { key: 'inheritVelocity', desc: '0..1 fraction of parent velocity' },
      { key: 'delay', desc: 'seconds before spawn (host-honored)' },
      { key: 'spawnType', desc: "projectile | bomb | enemy — what children become" },
      { key: 'enemyType', desc: "enemy id when spawnType=enemy (jester, vine_hound...)" },
      { key: 'bomb', desc: 'bomb param override when spawnType=bomb' },
    ],
  },
  impl(params) {
    const h = new AttackHandle('spawnSplit');
    h.children = splitChildren(params);
    h.delay = params.delay ?? 0;
    h._complete();
    return h;
  },
});
