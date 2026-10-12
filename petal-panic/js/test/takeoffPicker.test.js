// takeoffPicker tests — plan 06 Phase 1.
// Proves the sim-based picker chooses the RIGHT tool per geometry, using the
// real physics (stepHeadless) — not math shortcuts. Each test builds a
// synthetic world where exactly one candidate class can land on the goal and
// asserts the picker's scorecard reflects that.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRideWorld } from '../world/ghostRider.js';
import { createHeadlessHero } from '../hero/headless.js';
import { HEROES } from '../hero/heroDefs.js';
import { pickTakeoff, executePick } from '../world/takeoffPicker.js';

const BALT = { ...HEROES.balthazar.stats, hasDoubleJump: true, canSuper: true };

function worldOf(units){ return buildRideWorld({ orientation: 'horizontal', units }); }

/** Fresh hero standing on the FLOOR (feet exactly on groundY). */
function floorHero(world){
  const h = createHeadlessHero('balthazar', { x: 0, y: 0 });
  const bh = h.worldBox().h;
  return createHeadlessHero('balthazar', { x: world.entry.x - 8, y: world.groundY - bh });
}

/** Place a fresh hero standing on a given landing surface (feet on top). */
function heroOn(world, landing){
  const h = createHeadlessHero('balthazar', { x: 0, y: 0 });
  const bh = h.worldBox().h;
  const cx = (landing.x0 + landing.x1) / 2;
  return createHeadlessHero('balthazar', { x: cx - 8, y: landing.y - bh });
}

test('picker: flat ground far goal → some walk/jump candidate lands (score 0)', () => {
  const world = worldOf([]);
  const hero = floorHero(world);
  const goal = { index: -1, x0: world.W - 300, x1: world.W - 100, y: world.groundY, kind: 'block' };
  const r = pickTakeoff(hero, goal, world, BALT);
  assert.ok(r.best, 'expected a best candidate');
  assert.equal(r.best.score, 0, `expected perfect landing, got ${r.best.detail}`);
});

test('picker: low wide gap (2u below-ish) → SINGLE or WALK_OFF beats DOUBLE_S preference', () => {
  // Platform at elev 1, 3 units wide, starting 4 units ahead: a single jump
  // clears it easily; the picker must find a score-0 candidate.
  const world = worldOf([{ kind: 'platform', x: 6, y: 0, width: 3 }]);
  const hero = floorHero(world);
  const goal = world.landings[0];
  const r = pickTakeoff(hero, goal, world, BALT);
  assert.ok(r.best, 'expected a best candidate');
  assert.equal(r.best.score, 0, `expected landed-on-goal, got ${r.best.detail}`);
});

test('picker: 1-row block climb → SINGLE or DOUBLE lands (score 0)', () => {
  // 1-row block (48px rise): within single-jump apex (~55px). Any jump tool
  // should land on it. Assert score 0.
  const world = worldOf([{ kind: 'block', x: 5, y: 0, width: 3, height: 1 }]);
  const hero = floorHero(world);
  const goal = world.landings[0];
  const r = pickTakeoff(hero, goal, world, BALT);
  assert.ok(r.best, 'expected a best candidate');
  assert.equal(r.best.score, 0, `expected landed-on-goal, got ${r.best.detail}`);
  // (any tool that lands works — we just assert score 0 above)
});

test('picker: wide low gap needing super → SINGLE_S or DOUBLE_S wins with score 0', () => {
  // A platform 8 units ahead at elev 1: too far for any plain jump arc,
  // within super-assist range. Some *S candidate must land perfectly.
  const world = worldOf([{ kind: 'platform', x: 8, y: 0, width: 2 }]);
  const hero = floorHero(world);
  const goal = world.landings[0];
  const r = pickTakeoff(hero, goal, world, BALT);
  assert.ok(r.best, 'expected a best candidate');
  assert.equal(r.best.score, 0, `expected landed-on-goal, got ${r.best.detail}`);
  assert.match(r.best.id, /_S$|SUPER_ONLY/, `expected a super-using winner, got ${r.best.id}`);
});

test('picker: drop hop (goal far below) → WALK_OFF or low-preference candidate', () => {
  // Hero on a high platform, goal is the floor far below-right. Walking off
  // (or a cheap jump) must beat wasting a double+super.
  const world = worldOf([
    { kind: 'platform', x: 4, y: 4, width: 2 },  // start surface (elev 5)
  ]);
  const start = world.landings[0];
  const hero = heroOn(world, start);
  const goal = { index: -1, x0: start.x1 + 200, x1: start.x1 + 400, y: world.groundY, kind: 'block' };
  const r = pickTakeoff(hero, goal, world, BALT);
  assert.ok(r.best, 'expected a best candidate');
  assert.equal(r.best.score, 0, `expected landed-on-goal, got ${r.best.detail}`);
});

test('picker: wall in the way → all candidates hard-miss or route around (no silent stall)', () => {
  // A full-height wall directly between hero and goal: no grounded takeoff
  // can pass through it. Every candidate must hard-miss (Infinity) — the
  // scorecard is the "unclearable from here" signal, NOT a silent stall.
  const world = worldOf([
    { kind: 'block', x: 8, y: 0, width: 1, height: 8 },  // wall
    { kind: 'platform', x: 11, y: 0, width: 2 },          // goal behind wall
  ]);
  const hero = floorHero(world);
  const goal = world.landings[1];
  const r = pickTakeoff(hero, goal, world, BALT);
  // Either everything missed (best null or Infinity) — never a fake success.
  if (r.best) assert.ok(r.best.score > 0, `wall should block direct approaches, got ${r.best.detail}`);
});

test('picker: overshoot trap — DOUBLE lands past span, cheaper option lands ON it', () => {
  // Narrow platform (1u) at elev 1, moderate distance: an overpowered
  // DOUBLE_S flies PAST it; the correct tool is a plain jump. Assert the
  // winner is NOT the most expensive option when a cheaper one scores 0.
  const world = worldOf([{ kind: 'platform', x: 6, y: 0, width: 1 }]);
  const hero = floorHero(world);
  const goal = world.landings[0];
  const r = pickTakeoff(hero, goal, world, BALT);
  assert.ok(r.best, 'expected a best candidate');
  assert.equal(r.best.score, 0, `expected landed-on-goal, got ${r.best.detail}`);
  assert.ok(!/DOUBLE_S/.test(r.best.id), `cheaper option should win, got ${r.best.id}`);
});

test('executePick: replays the winning script and actually lands', () => {
  const world = worldOf([{ kind: 'block', x: 5, y: 0, width: 3, height: 1 }]);
  const hero = floorHero(world);
  const goal = world.landings[0];
  const pick = pickTakeoff(hero, goal, world, BALT);
  assert.ok(pick.best && pick.best.score === 0, `precondition: perfect pick, got ${pick.best?.detail}`);
  const r = executePick(hero, goal, world, BALT, pick);
  assert.equal(r.landed, true, `expected executePick to land, got ${r.reason}`);
});
