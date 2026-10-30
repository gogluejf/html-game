// Pixel-speed + shared ride-grid regression tests (square-grid cutover).
//
// Guards the two invariants restored by the shared-constants repair:
//   1. HERO/ENEMY PIXEL SPEEDS — unit-native def stats are converted to px at
//      exactly ONE conversion point per domain, and the resulting px/s match
//      the pre-cutover pixel values (scarlet 250, balthazar 180) so gameplay
//      speed is preserved even though UNIT_PX_X changed 72 -> 48.
//   2. SHARED RIDE GRID — the headless ride world, the runtime hero pipeline,
//      and the composer all consume the SAME square cell (UNIT_PX_X ==
//      UNIT_PX_Y == 48), so a macro authored in cells tiles identically for
//      the editor ghost, the node picker ride, and the game.
//
// Run: node --test js/test/pixelSpeedRideGrid.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GRAVITY, DOUBLE_JUMP_FACTOR, UNIT_PX_X, UNIT_PX_Y } from '../consts.js';
import { HEROES, resolveHeroStats } from '../hero/heroDefs.js';
import { createHeadlessHero, stepHeadless } from '../hero/headless.js';
import { buildRideWorld } from '../world/ghostRider.js';
import { RIDE_PARAMS } from '../world/pickerRide.js';
import {
  HORIZONTAL_ZONE_LENGTH_UNITS,
  VERTICAL_ZONE_HEIGHT_UNITS,
  VERTICAL_ZONE_WIDTH_UNITS,
  BOSS_ZONE_LENGTH_UNITS,
  BOSS_TRIGGER_UNITS,
  H_ENTRY_CLEAR,
  V_ENTRY_CLEAR,
} from '../world/macros.js';
import { VIEW_W } from '../core/view.js';

// ---------------------------------------------------------------------------
// 1. Square grid contract
// ---------------------------------------------------------------------------

test('grid: the cell is square and 48px on both axes', () => {
  assert.equal(UNIT_PX_X, 48, 'horizontal cell is 48px');
  assert.equal(UNIT_PX_Y, 48, 'vertical cell is 48px');
  assert.equal(UNIT_PX_X, UNIT_PX_Y, 'square grid: X and Y units are equal');
});

test('grid: derived screen width is floor(VIEW_W / 48) = 20 columns', () => {
  assert.equal(VIEW_W, 960);
  assert.equal(Math.floor(VIEW_W / UNIT_PX_X), 20);
  assert.equal(VERTICAL_ZONE_WIDTH_UNITS, 20, 'one-screen vertical zone = 20 whole columns');
});

// ---------------------------------------------------------------------------
// 2. Authored vs derived zone geometry (migration semantics)
// ---------------------------------------------------------------------------

test('zones: authored horizontal dims doubled, vertical unchanged, trigger x2', () => {
  // Authored horizontal geometry was migrated ×2 (square-grid plan §3):
  assert.equal(HORIZONTAL_ZONE_LENGTH_UNITS, 112, 'horizontal zone 56 → 112 cells');
  assert.equal(BOSS_ZONE_LENGTH_UNITS, 44, 'boss approach 22 → 44 cells');
  assert.equal(BOSS_TRIGGER_UNITS, 30, 'boss trigger column 15 → 30');
  assert.equal(H_ENTRY_CLEAR, 6, 'horizontal entry clear 3 → 6');
  // Vertical dimensions are UNCHANGED by the migration:
  assert.equal(VERTICAL_ZONE_HEIGHT_UNITS, 56, 'climb height stays 56 rows');
  assert.equal(V_ENTRY_CLEAR, 0, 'vertical entry clear stays 0');
  // Derived (recomputed from the pixel viewport, never doubled):
  assert.equal(VERTICAL_ZONE_WIDTH_UNITS, Math.floor(VIEW_W / UNIT_PX_X));
});

// ---------------------------------------------------------------------------
// 3. Hero pixel speeds — the previously broken invariant
// ---------------------------------------------------------------------------

test('speeds: def stats are unit-native and convert to the exact legacy px/s', () => {
  // Defs store X-units/s and Y-units/s; with the 48px cell the stored values
  // are chosen so the px result equals the PRE-CUTOVER pixel speed exactly.
  const scarlet = resolveHeroStats(HEROES.scarlet);
  const balthazar = resolveHeroStats(HEROES.balthazar);
  assert.equal(scarlet.speed, 250, 'scarlet run speed is exactly 250 px/s');
  assert.equal(balthazar.speed, 180, 'balthazar run speed is exactly 180 px/s');
  // Jump impulses convert through the same single point:
  assert.ok(Number.isFinite(scarlet.jump) && scarlet.jump > 0);
  assert.ok(Number.isFinite(balthazar.jump) && balthazar.jump > 0);
});

test('speeds: physics-derived reach math uses the converted px stats', () => {
  // The composer's weakest-hero double-jump airtime must be computed from
  // px/s stats (not raw unit stats) — a regression here silently re-scales
  // every gap/reachability check after a grid change.
  const jumpPx = resolveHeroStats(HEROES.balthazar).jump;
  const t1 = (2 * jumpPx) / GRAVITY;
  const t2 = (2 * DOUBLE_JUMP_FACTOR * jumpPx) / GRAVITY;
  const dist = resolveHeroStats(HEROES.balthazar).speed * (t1 + t2);
  assert.ok(dist > 100 && dist < 400, `balthazar full-double-jump distance ${dist.toFixed(1)}px is sane`);
});

// ---------------------------------------------------------------------------
// 4. Shared ride grid — one cell everywhere
// ---------------------------------------------------------------------------

test('ride: the headless hero runs at the real pixel speed (shared constants)', () => {
  const hero = createHeadlessHero('balthazar', { x: 0, y: 0 });
  // No input, no solids: the hero accelerates toward its run speed.
  const dt = 1 / 60;
  for (let i = 0; i < 600; i++) stepHeadless(hero, dt, { right: true }, []);
  // After 10s of holding right at full ramp, vx must equal the def px speed.
  assert.ok(Math.abs(hero.vx - 180) < 1e-6,
    `headless hero reaches 180 px/s (got ${hero.vx}) — ride and game share the same speed constant`);
});

test('ride: the ride brain params match the runtime hero conversion', () => {
  // RIDE_PARAMS is the mover's copy of balthazar's stats; it MUST equal the
  // single-conversion-point output or the ride proves a different physics
  // than the game plays.
  const resolved = resolveHeroStats(HEROES.balthazar);
  assert.equal(RIDE_PARAMS.speed, resolved.speed, 'ride speed === runtime hero speed');
  assert.equal(RIDE_PARAMS.jump, resolved.jump, 'ride jump === runtime hero jump');
});

test('ride: the ride world builds terrain on the shared 48px cell', () => {
  const macro = {
    id: 'regression-grid',
    orientation: 'horizontal',
    units: [
      { kind: 'block', x: 10, y: 0, width: 4, height: 1 },
      { kind: 'platform', x: 20, y: 1, width: 4 },
    ],
  };
  const world = buildRideWorld(macro);
  const solids = world.solids ?? [];
  // The ride world carries a full-width floor slab plus the macro's units,
  // each tagged with its authored unitIndex. Cell-exact pixel extents:
  // 4 cells × 48px. No rounding drift between editor ghost, node ride, game.
  const block = solids.find((s) => !s.oneWay && s.unitIndex === 0);
  const plat = solids.find((s) => s.oneWay && s.unitIndex === 1);
  assert.ok(block, 'ride world contains the solid block');
  assert.ok(plat, 'ride world contains the one-way platform');
  assert.equal(block.w, 4 * UNIT_PX_X, 'block width is exactly 4 cells in px');
  assert.equal(plat.w, 4 * UNIT_PX_X, 'platform width is exactly 4 cells in px');
  // Grid-anchored positions: x = col × 48, surface at (row+height) × 48 above floor.
  assert.equal(block.x, 10 * UNIT_PX_X, 'block sits at column 10 of the shared grid');
});
