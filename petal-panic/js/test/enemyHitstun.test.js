// Enemy hit-stun window + AI interrupt (design: docs/architecture/knockback.md §6).
// Run: node js/test/enemyHitstun.test.js
// Pure node unit tests on enemy.js (no DOM): while hitstunTimer > 0 the
// enemy's ai() is skipped but physics still integrate (knockback plays out),
// the `stunned` getter reflects the window, and after the TTL expires the
// enemy resumes its prior AI state. Fixed dt = 1/60.

import { strict as assert } from 'node:assert';
import { Enemy } from '../enemy.js';
import { GRAVITY } from '../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const EPS = 1e-9;
const close = (a, b) => Math.abs(a - b) < EPS;

const DEF = {
  id: 'test_enemy', name: 'Test Enemy', w: 32, h: 48, aggroRadius: 300,
  stats: { weight: 1, speed: 120, attack: 10, defense: 0, stamina: 40, fly: false },
};

/** Minimal stand-in hero — only what a base Enemy update() touches. */
const HERO = { x: 0, y: 0, w: 32, h: 48 };

/**
 * A spy subclass that records every ai() call and sets vx when it runs,
 * so we can prove ai() is frozen during stun and resumed after.
 */
class SpyEnemy extends Enemy {
  constructor(x = 0, y = 0) { super(DEF, x, y); this.aiCalls = 0; }
  ai(dt, hero, world) {
    this.aiCalls++;
    this.vx = 50; // any non-zero velocity the AI would write
  }
}

console.log('Enemy hit-stun window (§6)');

ok('fresh enemy is not stunned; hitstunTimer defaults to 0', () => {
  const e = new SpyEnemy();
  assert.equal(e.hitstunTimer, 0);
  assert.equal(e.stunned, false);
});

ok('setting hitstunTimer above zero makes stunned true', () => {
  const e = new SpyEnemy();
  e.hitstunTimer = 0.2;
  assert.equal(e.stunned, true);
});

// --- Acceptance 1: ai() does not run until the timer expires -----------------
ok('ai() is skipped for every frame while hitstunTimer > 0', () => {
  const e = new SpyEnemy();
  e.hitstunTimer = 0.1; // ~6 frames at fixed dt
  let steps = 0;
  while (e.stunned && steps < 100) { e.update(DT, HERO, null); steps++; }
  assert.equal(e.aiCalls, 0, `ai() must not run during stun, ran ${e.aiCalls}x`);
  assert.ok(steps >= 5, `stun should last several frames, lasted ${steps}`);
});

ok('ai() does not run on the frame the timer crosses zero, resumes next', () => {
  const e = new SpyEnemy();
  e.hitstunTimer = 2 * DT; // expires exactly after 2 steps
  e.update(DT, HERO, null); // step 1: timer was > 0 at check → stunned
  assert.equal(e.aiCalls, 0);
  e.update(DT, HERO, null); // step 2: timer now 0 → still stunned this frame (crosses to 0)
  assert.equal(e.aiCalls, 0, 'the frame that drives the timer to 0 is still a stun frame');
  e.update(DT, HERO, null); // step 3: window fully expired → ai() runs again
  assert.equal(e.aiCalls, 1, 'ai() resumes once the window has fully expired');
});

// --- Acceptance 2: physics still integrate during stun -----------------------
ok('horizontal knockback velocity integrates while stunned (shove visible)', () => {
  const e = new SpyEnemy();
  e.gravity = 0; // isolate horizontal motion
  e.vx = 300;
  e.hitstunTimer = 0.1;
  const x0 = e.x;
  e.update(DT, HERO, null);
  assert.ok(close(e.x - x0, 300 * DT), `expected dx=${300 * DT}, got ${e.x - x0}`);
  assert.equal(e.aiCalls, 0, 'AI did not overwrite the knockback velocity');
});

ok('gravity still applies while stunned (lofted enemies fall back)', () => {
  const e = new SpyEnemy(); // gravity = 1 (ground enemy)
  e.vy = 0;
  e.hitstunTimer = 0.1;
  e.update(DT, HERO, null);
  assert.ok(close(e.vy, GRAVITY * DT), `expected vy=${GRAVITY * DT}, got ${e.vy}`);
});

// --- Acceptance 3: enemy resumes its prior AI state after the window ---------
ok('stunned enemy keeps its prior aiState and resumes it after the window', () => {
  const e = new SpyEnemy();
  e.aiState = 'chase'; // simulate mid-action (e.g. a Jester mid-whip)
  e.hitstunTimer = 0.1;
  e.update(DT, HERO, null);
  assert.equal(e.aiState, 'chase', 'aiState untouched during stun');
  while (e.stunned) e.update(DT, HERO, null);
  e.update(DT, HERO, null); // first frame with ai() running again
  assert.equal(e.aiCalls, 1, 'ai() resumed');
  assert.equal(e.aiState, 'chase', 'resumed into the same prior state');
  assert.ok(close(e.vx, 50), 'AI wrote its own velocity on resume');
});

ok('hitFlash visual is independent of and preserved across stun', () => {
  const e = new SpyEnemy();
  e.hitFlash = 0.1;
  e.hitstunTimer = 0.1;
  e.update(DT, HERO, null);
  assert.ok(e.hitFlash > 0, 'hitFlash keeps decaying during stun');
  assert.equal(e.stunned, true);
});

ok('a dead enemy ignores the stun window (death pipeline owns it)', () => {
  const e = new SpyEnemy();
  e.die();
  e.hitstunTimer = 0.5;
  e.update(DT, HERO, null);
  assert.equal(e.aiCalls, 0);
  assert.equal(e.alive, true, 'death anim still in progress');
});

console.log(`\n${passed} passed`);
