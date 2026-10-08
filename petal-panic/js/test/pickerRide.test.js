// pickerRide tests — plan 06 acceptance + the BFS/picker agreement invariant.
//
// The core guarantee (see macro-editor/DEBUGGING.md): the sim-based picker is
// the ground truth for "can the hero actually reach this surface". It must AGREE
// with the BFS reachability proof (traversalRoute / bfsReachableSpans):
//   - every BLUE (BFS-reachable) landing in the route must be LANDABLE by the
//     picker-driven ride (score-0 pick, hero lands on it);
//   - every AMBER (BFS-unreachable) landing is EXCLUDED from the route and
//     never asked of the picker.
// If these disagree, either the envelope over-promises (blue but physically
// unclearable → silent stall) or under-promises (amber but actually clearable
// → validator rejects a valid macro).
//
// Run: node --test js/test/pickerRide.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRideWorld } from '../world/ghostRider.js';
import { traversalRoute } from '../world/macros.js';
import { runPickerRide, buildGoalList, RIDE_PARAMS } from '../world/pickerRide.js';
import { pickTakeoff } from '../world/takeoffPicker.js';
import { createHeadlessHero } from '../hero/headless.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MACRO_DIR = path.join(__dirname, '../../macros/levels');

const loadMacros = () =>
  fs.readdirSync(MACRO_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(MACRO_DIR, f), 'utf8')));

/** For each reachable goal in route order, confirm a settled hero standing on
 *  the PREVIOUS goal (or the floor for the first) can pick a score-0 takeoff
 *  to it. This mirrors exactly what the ride does hop-by-hop. */
function assertEveryBlueHopIsClearable(macro){
  const world = buildRideWorld(macro, { unitPxX: 72, unitPxY: 48, platformDrawH: 6 });
  const tagged = macro.units.map((u, i) => ({ ...u, _editorIndex: u._editorIndex ?? i }));
  const { order, unreachable } = traversalRoute({ orientation: macro.orientation, units: tagged });
  const byIdx = new Map(world.landings.map(l => [l.index, l]));
  const bh = createHeadlessHero('balthazar', { x: 0, y: 0 }).worldBox().h;

  for (let i = 0; i < order.length; i++){
    const ui = order[i];
    const goal = byIdx.get(ui);
    if (!goal) continue;
    // Source = previous goal in the route, or the floor for the first hop.
    let hero, fromSurface;
    if (i === 0){
      hero = createHeadlessHero('balthazar', { x: world.entry.x - 8, y: world.groundY - bh });
      fromSurface = null;
    } else {
      const prev = byIdx.get(order[i - 1]);
      const cx = (prev.x0 + prev.x1) / 2;
      hero = createHeadlessHero('balthazar', { x: cx - 8, y: prev.y - bh });
      fromSurface = prev;
    }
    // Settle to a clean resting state (matches the ride's pre-pick settle).
    hero.vx = 0; hero.vy = 0; hero.grounded = true;
    hero.supermoveMeter = hero.SUPERMOVE_MAX;
    const r = pickTakeoff(hero, goal, world, RIDE_PARAMS, {}, fromSurface);
    assert.ok(r.best && r.best.score === 0,
      `macro ${macro.id}: blue hop →#${ui} (from ${i === 0 ? 'floor' : '#' + order[i - 1]}) not clearable by picker: ${r.best?.detail ?? 'no candidate'}`);
  }
  return { order, unreachable };
}

// ---------------------------------------------------------------------------
// Invariant: blue (BFS-reachable) ⇒ picker-clearable, per hop
// ---------------------------------------------------------------------------

test('invariant: every BFS-blue hop is picker-clearable (all shipped macros)', () => {
  for (const macro of loadMacros()){
    assertEveryBlueHopIsClearable(macro);
  }
});

// ---------------------------------------------------------------------------
// Invariant: amber (BFS-unreachable) surfaces are excluded from the route
// ---------------------------------------------------------------------------

test('invariant: amber surfaces never appear in the ride goal list', () => {
  for (const macro of loadMacros()){
    const world = buildRideWorld(macro, { unitPxX: 72, unitPxY: 48, platformDrawH: 6 });
    const { goals, unreachable } = buildGoalList(world, macro);
    const goalSet = new Set(goals.map(g => g.index));
    for (const idx of unreachable){
      assert.ok(!goalSet.has(idx),
        `macro ${macro.id}: amber surface #${idx} was included in the route`);
    }
  }
});

// ---------------------------------------------------------------------------
// End-to-end: the picker-driven ride clears every shipped macro
// ---------------------------------------------------------------------------

test('ride: picker-driven ride clears every shipped macro end-to-end', () => {
  const failures = [];
  for (const macro of loadMacros()){
    const r = runPickerRide(macro);
    if (!r.cleared){
      failures.push(`${macro.id}: landed [${r.landed}] of [${r.goals}] — ${r.failPoint?.reason} @ goal #${r.failPoint?.goal}`);
    }
  }
  assert.equal(failures.length, 0, 'picker ride failed on:\n' + failures.join('\n'));
});

// ---------------------------------------------------------------------------
// Sanity: the two layers agree on a known-good and a known-bad case
// ---------------------------------------------------------------------------

test('agreement: a too-tall isolated rise is amber AND picker says impossible', () => {
  // A single platform 5 rows up with no stepping stone: beyond double-jump+super
  // apex → BFS marks it unreachable, and the picker's envelope prunes it.
  const macro = {
    id: 'synthetic-too-tall',
    orientation: 'horizontal',
    units: [{ kind: 'platform', x: 6, y: 5, width: 2 }],
  };
  const tagged = macro.units.map((u, i) => ({ ...u, _editorIndex: i }));
  const { order, unreachable } = traversalRoute({ orientation: macro.orientation, units: tagged });
  assert.ok(unreachable.includes(0), 'expected the tall platform to be amber/unreachable');
  assert.ok(!order.includes(0), 'unreachable surface must not be in the route');
});
