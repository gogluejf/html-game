// Vector-debug plan — unit tests for Entity's generic transform/motion reads.
// Run: node js/test/entityTransform.test.js
// Pure math on Entity fields; no DOM/canvas needed.

import { strict as assert } from 'node:assert';
import { Entity } from '../entity.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const rad = d => d * Math.PI / 180;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('Entity transform & motion');

ok('spriteOrientation upright (no mirror, no rotation) = baseAngle', () => {
  const e = new Entity({});
  assert.ok(near(e.spriteOrientation(), 0));
});

ok('spriteOrientation respects baseSpriteAngle', () => {
  const e = new Entity({ baseSpriteAngle: rad(90) });
  assert.ok(near(e.spriteOrientation(), rad(90)));
});

ok('spriteOrientation mirrored-X flips direction (PI - rot)', () => {
  const e = new Entity({ mirrorX: true });
  assert.ok(near(e.spriteOrientation(), Math.PI));
});

ok('spriteOrientation rotated then mirrored combines correctly', () => {
  // rotation 45°, mirrorX → PI - 45° = 135°
  const e = new Entity({ rotation: rad(45), mirrorX: true });
  assert.ok(near(e.spriteOrientation(), rad(135)));
});

ok('spriteOrientation ignores mirrorY (vertical flip does not change facing)', () => {
  const e = new Entity({ mirrorY: true, rotation: rad(30) });
  assert.ok(near(e.spriteOrientation(), rad(30)));
});

ok('velocityAngle returns null when stationary', () => {
  const e = new Entity({ vx: 0, vy: 0 });
  assert.equal(e.velocityAngle(), null);
});

ok('velocityAngle respects threshold', () => {
  const e = new Entity({ vx: 0.5, vy: 0 });
  assert.equal(e.velocityAngle(1), null);
});

ok('velocityAngle points up for a jumping enemy', () => {
  const e = new Entity({ vx: 0, vy: -240 });
  assert.ok(near(e.velocityAngle(), -Math.PI / 2));
});

ok('velocityAngle at 45° diagonal', () => {
  const e = new Entity({ vx: 100, vy: 100 });
  assert.ok(near(e.velocityAngle(), rad(45)));
});

ok('velocitySpeed is hypot of vx,vy', () => {
  const e = new Entity({ vx: 300, vy: 400 });
  assert.ok(near(e.velocitySpeed(), 500));
});

console.log(`\n${passed} passed`);
