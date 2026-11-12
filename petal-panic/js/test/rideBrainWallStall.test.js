// rideBrain first-hop stall regression — wall-equals-target + body-aware clamp.
//
// The shared brain's walk-to-edge phase (decideInput) must:
//   1. treat a solid face EXACTLY at the walk target as blocking (the old
//      strict `face < targetX` missed walls sitting exactly on the target),
//   2. stop the hero with its full collision box clear of the face (old code
//      stopped feet 6px short, but the box extends ~36px past the feet), and
//   3. transfer to the picker when the approach is genuinely blocked instead
//      of walking into the wall forever.
// These are the exact stalls seen in stretchedPyramid / pyramid3 /
// mixedCrossing / blockPlatformBridge / newMacro (first hop, goal-top wall).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRideWorld } from '../world/ghostRider.js';
import { createHeadlessHero, ensureHeadlessSprites, stepHeadless } from '../hero/headless.js';
import { RIDE_PARAMS } from '../world/pickerRide.js';
import { createRideBrain, decideInput, surfaceUnder } from '../world/rideBrain.js';
import { pickTakeoff } from '../world/takeoffPicker.js';

await ensureHeadlessSprites('balthazar');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MACRO_DIR = path.join(__dirname, '../../macros/levels');
const DT = 1 / 60;

function loadMacro(id){
  return JSON.parse(fs.readFileSync(path.join(MACRO_DIR, `${id}.json`), 'utf8'));
}

/** Spawn a settled hero standing on `landing` with feet centered at `feetX`. */
function heroOnLanding(world, landing, feetX){
  const h = createHeadlessHero('balthazar', { x: 0, y: 0 });
  const bh = h.worldBox().h;
  h.x = feetX - h.worldBox().w / 2 - h._boxOx;
  h.y = landing.y - bh - h._boxOy;
  h.grounded = true;
  return h;
}

/** Drive THE shared per-frame decision until the brain makes a pick.
 *  Returns the frame count used. A wall-pin loop regresses this to maxFrames. */
function driveUntilPick(brain, hero, world, maxFrames = 240){
  let frames = 0;
  while (!brain._pick && frames < maxFrames){
    const inp = decideInput(brain, hero, world);
    stepHeadless(hero, DT, inp, world.solids);
    frames++;
  }
  return frames;
}

test('brain: wall exactly at walk target → no infinite walk, box clears face, pick succeeds', () => {
  const macro = loadMacro('stretchedPyramid');
  const world = buildRideWorld(macro);
  const ls = [...world.landings].sort((a, b) => a.index - b.index);
  const src = ls[0];            // top y432, x192..672
  const goal = ls.find(l => l.index === 1); // top y384, x672..1152
  assert.ok(goal && goal.x0 === 672 && src.x1 === 672, 'fixture: goal-top wall at source edge');

  const hero = heroOnLanding(world, src, 635.52); // caller's exact stalled feet x
  const brain = createRideBrain([goal], { stepFn: stepHeadless, dt: DT, params: RIDE_PARAMS });
  assert.ok(surfaceUnder(hero, world), 'hero must be on a known surface');

  const frames = driveUntilPick(brain, hero, world);
  assert.ok(brain._pick != null, `brain made a pick within ${frames} frames (no wall-pin loop)`);

  // Body-aware clearance: the hero's collision box must not overlap the wall.
  const wb = hero.worldBox();
  assert.ok(wb.x + wb.w <= goal.x0 + 1e-6, `box right edge ${wb.x + wb.w} must clear wall face ${goal.x0}`);
  assert.ok(Math.abs((wb.y + wb.h) - src.y) <= 8, 'still resting on the source surface');

  // The pick from this state must actually land on the goal (score 0).
  const res = pickTakeoff(hero, goal, world, RIDE_PARAMS, {}, surfaceUnder(hero, world));
  assert.ok(res.best, 'picker found a candidate');
  assert.equal(res.best.score, 0, `expected landed-on-goal, got ${res.best.detail}`);
});

test('brain: leftward wall exactly at walk target (mirror direction)', () => {
  // Synthetic mirror of the same geometry: source block on the RIGHT, goal
  // block on the LEFT whose top face sits exactly at the source's left edge.
  const world = buildRideWorld({
    orientation: 'horizontal',
    units: [
      { kind: 'block', height: 1, y: 0, x: 14, width: 10 }, // source, x672..1152, top 432
      { kind: 'block', height: 2, y: 0, x: 4, width: 10 },  // goal,   x192..672, top 384
    ],
  });
  const ls = [...world.landings].sort((a, b) => a.index - b.index);
  const src = ls.find(l => l.index === 0);  // x672..1152 top 432
  const goal = ls.find(l => l.index === 1); // x192..672 top 384
  assert.ok(goal && src && src.x0 === 672 && goal.x1 === 672, 'fixture mirrored');

  const hero = heroOnLanding(world, src, 708.48); // feet just inside the source left edge
  const brain = createRideBrain([goal], { stepFn: stepHeadless, dt: DT, params: RIDE_PARAMS });
  assert.ok(surfaceUnder(hero, world), 'hero on a known surface');

  const frames = driveUntilPick(brain, hero, world);
  assert.ok(brain._pick != null, `leftward pick within ${frames} frames`);
  const wb = hero.worldBox();
  assert.ok(wb.x >= goal.x1 - 1e-6, `box left edge ${wb.x} must clear wall face ${goal.x1}`);
  const res = pickTakeoff(hero, goal, world, RIDE_PARAMS, {}, surfaceUnder(hero, world));
  assert.ok(res.best && res.best.score === 0, `landed-on-goal expected, got ${res.best?.detail}`);
});

test('brain: shipped macros — first hop reaches a pick without wall-pin looping', () => {
  // The five caller-reported stalls. Each: spawn on goal #0 near its far edge,
  // drive decideInput; a pick must appear well before the old 600-frame stall.
  const cases = [
    ['stretchedPyramid', 635.52],
    ['pyramid3', 539.52],
    ['mixedCrossing', 251.52],
    ['blockPlatformBridge', 251.52],
    ['newMacro', 827.52],
  ];
  for (const [id, feetX] of cases){
    const macro = loadMacro(id);
    const world = buildRideWorld(macro);
    const ls = [...world.landings].sort((a, b) => a.index - b.index);
    const src = ls[0];
    const goal = ls.find(l => l.index === 1);
    assert.ok(goal, `${id}: goal #1 exists`);
    const hero = heroOnLanding(world, src, feetX);
    const brain = createRideBrain([goal], { stepFn: stepHeadless, dt: DT, params: RIDE_PARAMS });
    const frames = driveUntilPick(brain, hero, world);
    assert.ok(brain._pick != null, `${id}: pick made within ${frames} frames (no wall-pin loop)`);
    // Box must not overlap any non-oneWay solid at pick time (wall-pinned).
    const wb = hero.worldBox();
    for (const s of world.solids){
      if (s.oneWay) continue;
      const ox = Math.min(wb.x + wb.w - s.x, s.x + s.w - wb.x);
      const oy = Math.min(wb.y + wb.h - s.y, s.y + s.h - wb.y);
      assert.ok(ox <= 0 || oy <= 0, `${id}: box overlaps solid ${JSON.stringify(s)} at pick time`);
    }
  }
});
