// Targeting toolbox tests (pure math, no DOM).
// Run: node js/test/targeting.test.js

import { strict as assert } from 'node:assert';
import { aimAt, leadAt, ballisticAt } from '../combat/targeting.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const origin = { x: 100, y: 100 };

// --- aimAt -------------------------------------------------------------------
ok('aimAt: target right → 0', () => {
  // 32x32 box at (184, 84) → center exactly (200, 100) = same height as origin.
  assert.ok(close(aimAt(origin, { x: 184, y: 84, w: 32, h: 32 }), 0));
});

ok('aimAt: target below-right → +π/4 (screen-y-down)', () => {
  // target center (216, 216) vs origin (100,100): dx=116, dy=116
  assert.ok(close(aimAt(origin, { x: 200, y: 200, w: 32, h: 32 }), Math.PI / 4));
});

ok('aimAt: target left → π', () => {
  // Box at (-16, 84) → center (0, 100), directly left of origin.
  const a = aimAt(origin, { x: -16, y: 84, w: 32, h: 32 });
  assert.ok(Math.abs(a - Math.PI) < 1e-6, `got ${a}`);
});

ok('aimAt: aims at entity CENTER, not top-left', () => {
  // 32x32 box at (96, 96) → center (112, 112); origin (100,100) → dx=12,dy=12
  assert.ok(close(aimAt(origin, { x: 96, y: 96, w: 32, h: 32 }), Math.PI / 4));
});

// --- leadAt ------------------------------------------------------------------
ok('leadAt: stationary target → its current position, t = dist/speed', () => {
  // Center exactly (200, 100): distance 100, speed 500 → t = 0.2s.
  const r = leadAt({ x: 184, y: 84, w: 32, h: 32, vx: 0, vy: 0 }, origin, 500);
  assert.ok(r, 'solution exists');
  assert.ok(close(r.x, 200) && close(r.y, 100));
  assert.ok(close(r.t, 100 / 500), `t=${r.t}`);
});

ok('leadAt: target moving toward origin → meets sooner than static case', () => {
  const staticR = leadAt({ x: 184, y: 84, w: 32, h: 32, vx: 0, vy: 0 }, origin, 500);
  const closing = leadAt({ x: 184, y: 84, w: 32, h: 32, vx: -100, vy: 0 }, origin, 500);
  assert.ok(closing, 'solution exists');
  assert.ok(closing.t < staticR.t, `${closing.t} < ${staticR.t}`);
  // Meeting point is LEFT of the target's start (it moved toward us).
  assert.ok(closing.x < 200);
});

ok('leadAt: target outrunning the bullet → null', () => {
  const r = leadAt({ x: 200, y: 100, w: 32, h: 32, vx: 600, vy: 0 }, origin, 500);
  assert.equal(r, null);
});

ok('leadAt: leads a strafing target AHEAD of its current position', () => {
  // Target walks right at 100 px/s; bullet 500 px/s. The intercept must be
  // to the RIGHT of the target's current center — that's the whole point.
  const r = leadAt({ x: 184, y: 84, w: 32, h: 32, vx: 100, vy: 0 }, origin, 500);
  assert.ok(r, 'solution exists');
  assert.ok(r.x > 200, `intercept x=${r.x} should exceed current center 200`);
});

// --- ballisticAt ---------------------------------------------------------------
ok('ballisticAt: flat throw lands on a same-height target (round-trip sim)', () => {
  // Target center exactly at height 100 (same as origin): box (284, 84).
  const target = { x: 284, y: 84, w: 32, h: 32 }; // center (300, 100)
  const speed = 500, gravity = 800;
  const { direction, reached } = ballisticAt(origin, target, { speed, gravity, style: 'flat' });
  assert.ok(reached, 'in range');
  // Simulate the arc and check it passes through the target center.
  let x = origin.x, y = origin.y;
  let vx = Math.cos(direction) * speed, vy = Math.sin(direction) * speed;
  const DT = 1 / 240;
  let hit = false;
  for (let f = 0; f < 2400; f++) {
    vy += gravity * DT;
    x += vx * DT; y += vy * DT;
    if (Math.hypot(x - 300, y - 100) < 8) { hit = true; break; }
    if (y > 600) break;
  }
  assert.ok(hit, `arc missed target center (dir=${direction.toFixed(3)})`);
});

ok('ballisticAt: high lob also lands on the same point, with a steeper angle', () => {
  const target = { x: 284, y: 84, w: 32, h: 32 }; // center (300, 100)
  const speed = 500, gravity = 800;
  const flat = ballisticAt(origin, target, { speed, gravity, style: 'flat' });
  const high = ballisticAt(origin, target, { speed, gravity, style: 'high' });
  assert.ok(flat.reached && high.reached);
  // Both aim up-right (negative y on screen); the high arc is STEEPER —
  // farther from horizontal, i.e. more negative.
  assert.ok(high.direction < flat.direction,
    `high ${high.direction.toFixed(3)} should be < flat ${flat.direction.toFixed(3)}`);
  // And the high arc actually flies HIGHER (reaches a lower y = higher on screen).
  const apex = (dir) => {
    let y = origin.y, vy = Math.sin(dir) * speed;
    const DT = 1 / 240; let minY = y;
    for (let f = 0; f < 1200; f++) { vy += gravity * DT; y += vy * DT; minY = Math.min(minY, y); if (vy >= 0) break; }
    return minY;
  };
  assert.ok(apex(high.direction) < apex(flat.direction), 'high arc reaches higher');
});

ok('ballisticAt: target left of launcher mirrors the angle', () => {
  // Right target center (300, 100); left target center (-100, 100): symmetric d.
  const right = ballisticAt(origin, { x: 284, y: 84, w: 32, h: 32 }, { speed: 500, gravity: 800, style: 'flat' });
  const left = ballisticAt(origin, { x: -116, y: 84, w: 32, h: 32 }, { speed: 500, gravity: 800, style: 'flat' });
  assert.ok(right.reached && left.reached);
  // Left throw = π − rightAngle (mirror across vertical).
  assert.ok(close(left.direction, Math.PI - right.direction, 1e-9),
    `left=${left.direction} vs π−right=${(Math.PI - right.direction)}`);
});

ok('ballisticAt: out of range → 45°-up fallback angle, reached=false', () => {
  const r = ballisticAt(origin, { x: 5000, y: 100, w: 32, h: 32 }, { speed: 300, gravity: 800 });
  assert.equal(r.reached, false);
  // Max-range lobe: 45° UP toward the target (screen: −π/4 for rightward).
  assert.ok(close(r.direction, -Math.PI / 4), `fallback dir=${r.direction}`);
});

console.log(`\n${passed} passed`);
