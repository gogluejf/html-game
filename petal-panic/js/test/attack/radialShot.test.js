// Radial Shot macro tests (pure logic, no DOM).
// Run: node js/test/attack/radialShot.test.js

import { strict as assert } from 'node:assert';
import { radialAngle } from '../../combat/attack/macros/radialShot.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { Pool, Projectile, Special } from '../../objects/projectile.js';
import '../../combat/attack/primitives/projectile.js';
import '../../combat/attack/macros/spreadShot.js'; // radial wraps it
import '../../combat/attack/macros/radialShot.js'; // registers the macro

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const close = (a, b) => Math.abs(a - b) < 1e-9;

function pools() {
  return { projectilePool: new Pool(Projectile, 16), specialPool: new Pool(Special, 4) };
}
const attacker = () => ({ x: 100, y: 100, w: 32, h: 32 });

ok('radialAngle: even ring geometry (gap = 2π/count)', () => {
  // 8 shots → total width 2π*7/8 so neighbor gap is exactly 2π/8.
  const a = radialAngle(8);
  assert.ok(close(a, (Math.PI * 2 * 7) / 8), `got ${a}`);
});

ok('radialAngle: single shot collapses to zero width', () => {
  assert.equal(radialAngle(1), 0);
});

ok('simultaneous ring: all shots live at once, evenly spaced', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const h = invoke('radialShot', { count: 8, sequenceInterval: null, speed: 300, ttl: 5, damage: 5 }, ctx);
  assert.equal(h.handles.length, 8, 'all 8 spawned immediately');
  // Neighbor gap must be exactly 45° (2π/8) — the whole point of the
  // computed ring width.
  for (let i = 1; i < h.angles.length; i++) {
    const gap = h.angles[i] - h.angles[i - 1];
    assert.ok(close(gap, Math.PI / 4), `gap[${i}] = ${gap}`);
  }
});

ok('startAngle rotates the whole ring', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const base = invoke('radialShot', { count: 4, sequenceInterval: null, speed: 300, ttl: 5 }, ctx);
  const rotated = invoke('radialShot', { count: 4, startAngle: Math.PI / 2, sequenceInterval: null, speed: 300, ttl: 5 }, ctx);
  // Every rotated angle must equal a base angle + startAngle (the pattern is
  // rigidly rotated, not reshaped).
  for (const r of rotated.angles) {
    const hit = base.angles.some((b) => Math.abs(r - (b + Math.PI / 2)) < 1e-9);
    assert.ok(hit, `rotated angle ${r} has no base+startAngle match`);
  }
});
ok('sequenced ring: one bolt per interval, step-driven', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const h = invoke('radialShot', { count: 4, speed: 300, ttl: 5, sequenceInterval: 0.25 }, ctx);
  assert.equal(h.handles.length, 0, 'nothing spawned before first step');
  assert.equal(typeof h.step, 'function', 'exposes step()');
  // Step the launch window (4 bolts × 0.25s).
  for (let i = 0; i < 60; i++) h.step(1 / 60);
  assert.equal(h.handles.length, 4, 'all 4 eventually spawned');
  // Kill the shots (host would end them via hit/TTL) → macro completes.
  h.handles.forEach((ch) => { ch.entity.alive = false; });
  assert.equal(h.step(1 / 60), true, 'completes after last shot dies');
});

ok('forwards hit + complete from the inner spread', () => {
  const ctx = makeContext(attacker(), { pools: pools() });
  const h = invoke('radialShot', { count: 2, sequenceInterval: null, speed: 300, ttl: 5, damage: 7 }, ctx);
  const seen = [];
  h.on('hit', (i) => seen.push(['hit', i.dealt]));
  h.on('complete', () => seen.push('done'));
  h.handles[0]._emit('hit', { dealt: 7 });
  h.handles.forEach((ch) => ch._emit('complete', {}));
  assert.deepEqual(seen, [['hit', 7], 'done']);
});

console.log(`\n${passed} passed`);
