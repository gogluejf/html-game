// platformMover tests — the smart movement brain (plan 05).
// Proves the mover LANDS on target surfaces using real button inputs + real
// stepHeadless physics, not math shortcuts or mashing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRideWorld } from '../world/ghostRider.js';
import { createHeadlessHero } from '../hero/headless.js';
import { HEROES } from '../hero/heroDefs.js';
import { moveToward, stepAndCorrect, feetPos } from '../world/platformMover.js';

const DT = 1 / 60;
const BALT = { ...HEROES.balthazar.stats, hasDoubleJump: true, canSuper: true };

function worldOf(units){ return buildRideWorld({ orientation: 'horizontal', units }); }
function freshHero(world){ return createHeadlessHero('balthazar', { x: world.entry.x - 8, y: world.entry.y - 40 }); }

test('mover: runs across flat ground to a far point', () => {
  const world = worldOf([]);
  const hero = freshHero(world);
  const goal = { x0: world.W - 200, x1: world.W - 50, y: world.groundY, kind: 'block', index: -1 };
  const r = moveToward(hero, goal, world, BALT, { maxFrames: 60 * 30 });
  assert.equal(r.landed, true, `expected landed, got ${r.reason}`);
});

test('mover: jumps onto a 1-high block', () => {
  const world = worldOf([{ kind: 'block', x: 6, y: 0, width: 3, height: 1 }]);
  const hero = freshHero(world);
  const goal = world.landings[0];
  const r = moveToward(hero, goal, world, BALT, { maxFrames: 60 * 10 });
  assert.equal(r.landed, true, `expected landed, got ${r.reason}`);
  const f = feetPos(hero);
  assert.ok(Math.abs(f.y - goal.y) <= 6, `feet y ${f.y} should be on goal top ${goal.y}`);
});

test('mover: lands ON a small platform over a hole (precise landing)', () => {
  // A 1-wide platform at height 1. The old reflex bot would overshoot into the
  // gap; the mover must steer + drop onto the platform top specifically.
  const world = worldOf([{ kind: 'platform', x: 8, y: 0, width: 1 }]);
  const hero = freshHero(world);
  const goal = world.landings[0];
  const r = moveToward(hero, goal, world, BALT, { maxFrames: 60 * 10 });
  assert.equal(r.landed, true, `expected landed on small platform, got ${r.reason}`);
  const f = feetPos(hero);
  assert.ok(f.x >= goal.x0 - 6 && f.x <= goal.x1 + 6, `feet x ${f.x} within platform span [${goal.x0},${goal.x1}]`);
  assert.ok(Math.abs(f.y - goal.y) <= 6, `feet y ${f.y} on platform top ${goal.y}`);
});

test('mover: climbs a 2-high block (double jump)', () => {
  const world = worldOf([{ kind: 'block', x: 6, y: 0, width: 3, height: 2 }]);
  const hero = freshHero(world);
  const goal = world.landings[0];
  const r = moveToward(hero, goal, world, BALT, { maxFrames: 60 * 15 });
  assert.equal(r.landed, true, `expected to climb 2h block, got ${r.reason}`);
});

test('mover: unreachable surface stops cleanly (no infinite loop)', () => {
  // A shelf far above max elevation with no stepping stone → envelope says
  // impossible → mover returns 'unreachable' quickly, bounded frames.
  const world = worldOf([{ kind: 'block', x: 6, y: 0, width: 3, height: 9 }]);
  const hero = freshHero(world);
  const goal = world.landings[0];
  const t0 = Date.now();
  const r = moveToward(hero, goal, world, BALT, { maxFrames: 60 * 5, maxAttempts: 2 });
  assert.equal(r.landed, false);
  assert.ok(['unreachable', 'failed'].includes(r.reason), `reason was ${r.reason}`);
  assert.ok(Date.now() - t0 < 5000, 'should give up fast, not loop');
});

test('mover: param injection — no double jump makes a 2h block unreachable', () => {
  const world = worldOf([{ kind: 'block', x: 6, y: 0, width: 3, height: 2 }]);
  const weak = { ...BALT, hasDoubleJump: false, canSuper: false };
  const hero = freshHero(world);
  const goal = world.landings[0];
  const r = moveToward(hero, goal, world, weak, { maxFrames: 60 * 8, maxAttempts: 2 });
  // Without double jump OR super, a 2-row rise is beyond a single jump apex.
  assert.equal(r.landed, false, 'weaker params should NOT clear a 2h block');
});

test('mover: determinism — same macro+params gives identical path', () => {
  const mk = () => worldOf([{ kind: 'block', x: 6, y: 0, width: 3, height: 1 }, { kind: 'platform', x: 12, y: 1, width: 2 }]);
  const run = () => {
    const world = mk();
    const hero = freshHero(world);
    const r1 = moveToward(hero, world.landings[0], world, BALT, { maxFrames: 60 * 10 });
    const r2 = moveToward(hero, world.landings[1], world, BALT, { maxFrames: 60 * 10 });
    return JSON.stringify([r1.path, r2.path]);
  };
  assert.equal(run(), run(), 'two identical runs must produce byte-equal paths');
});
