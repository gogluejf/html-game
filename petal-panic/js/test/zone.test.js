// Task 2.1 — zone model replacing the single corridor (level.js).
// Run: node --test petal-panic/js/test/zone.test.js
//
// Source of truth:
//   docs/levels/structure.md  §1 Five zones per level, §2 Independent zones,
//                             §3 Horizontal areas, §4 Vertical areas
//   docs/levels/checkpoints.md §1 Where flags appear
//
// Acceptance criteria covered:
//   1. Level def yields 5 zones (areas -1..-4 + boss zone)
//   2. -1 has no entry flag
//   3. -2..-4 have entry flags at their start
//   4. -4 exit uses boss-checkpoint appearance
//   5. Zones share no geometry (independent sealed worlds)
//   6. Exactly one ordinary area is vertical, and it is never -1

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { LEVELS, buildLevelZones, BOSS_CHECKPOINT, ZONE_H_HORIZONTAL, ZONE_H_VERTICAL, ZONE_WIDTH_HORIZONTAL, ZONE_WIDTH_VERTICAL } from '../level.js';
import { VIEW_H } from '../view.js';

const def = LEVELS[0];
const zones = buildLevelZones(def);

test('a level yields exactly 5 sealed zones (areas -1..-4 + boss)', () => {
  assert.equal(zones.length, 5, 'five zones: four areas + one boss zone');
  assert.deepEqual(
    zones.map((z) => z.idx),
    [-1, -2, -3, -4, 'boss'],
    'zones are in play order: -1, -2, -3, -4, boss',
  );
  assert.equal(zones[4].kind, 'boss', 'the final zone is the boss zone');
  assert.equal(zones[4].orientation, 'boss', 'boss zone is its own orientation');
});

test('every zone owns its own world bounds', () => {
  for (const z of zones) {
    assert.ok(z.bounds, `${z.idx} has bounds`);
    assert.ok(z.bounds.w > 0 && z.bounds.h > 0, `${z.idx} bounds are positive`);
    assert.ok(z.bounds.w > 0 && z.bounds.h > 0, `${z.idx} bounds have area`);
  }
});

test('area -1 has no entry flag (checkpoints.md §1)', () => {
  const z1 = zones.find((z) => z.idx === -1);
  assert.equal(z1.entryFlag, null, '-1 must not draw an entry checkpoint');
});

test('areas -2..-4 have an entry flag at their start (checkpoints.md §1)', () => {
  for (const idx of [-2, -3, -4]) {
    const z = zones.find((zz) => zz.idx === idx);
    assert.ok(z.entryFlag, `${idx} has an entry flag`);
    assert.equal(
      z.entryFlag.x,
      z.bounds.x + 120,
      `${idx} entry flag sits at the start of the zone`,
    );
  }
});

test('each ordinary area has an exit flag; the boss zone has none', () => {
  for (const idx of [-1, -2, -3, -4]) {
    const z = zones.find((zz) => zz.idx === idx);
    assert.ok(z.exitFlag, `${idx} has an exit flag`);
    assert.ok(z.exitFlag.x > z.bounds.x, `${idx} exit flag is inside the zone`);
  }
  const boss = zones.find((z) => z.idx === 'boss');
  assert.equal(boss.exitFlag, null, 'boss zone has no exit (final zone)');
  assert.ok(boss.entryFlag, 'boss zone begins beside a boss checkpoint flag');
  assert.equal(
    boss.entryFlag.appearance,
    BOSS_CHECKPOINT.appearance,
    'boss zone entry flag uses the boss-checkpoint appearance',
  );
});

test('the -4 exit uses the boss-checkpoint appearance (checkpoints.md §1)', () => {
  const z4 = zones.find((z) => z.idx === -4);
  assert.equal(
    z4.exitFlag.appearance,
    BOSS_CHECKPOINT.appearance,
    '-4 exit is a boss checkpoint leading to the boss zone',
  );
  // Ordinary exits are plain exits, not boss checkpoints.
  for (const idx of [-1, -2, -3]) {
    const z = zones.find((zz) => zz.idx === idx);
    assert.notEqual(
      z.exitFlag.appearance,
      BOSS_CHECKPOINT.appearance,
      `${idx} exit is not a boss checkpoint`,
    );
  }
});

test('zones share no geometry (structure.md §2 — independent sealed worlds)', () => {
  // Zones are independent worlds: each owns its own platforms and flags. A
  // zone's geometry must not be the SAME object as another zone's (no shared
  // reference), and every flag must be a distinct instance.
  //
  // (Absolute floor AABBs are intentionally identical — each zone uses its own
  // local coordinate space with bounds starting at x:0. Independence is about
  // construction, not about placing zones at different absolute coordinates,
  // because a new zone REPLACES the current one rather than sitting beside it.)
  const floors = zones.map((z) => z.platforms[0]);
  for (let i = 0; i < floors.length; i++) {
    for (let j = i + 1; j < floors.length; j++) {
      assert.notEqual(
        floors[i],
        floors[j],
        `zone ${zones[i].idx} and ${zones[j].idx} must each own a distinct floor`,
      );
    }
  }
  // Every zone's floor spans its own bounds (per-zone construction).
  for (const z of zones) {
    const f = z.platforms[0];
    assert.equal(f.x, z.bounds.x, `${z.idx} floor starts at its own bounds.x`);
    assert.equal(f.w, z.bounds.w, `${z.idx} floor spans its own bounds.w`);
  }
  // Flag objects are unique per zone (no shared references / ids).
  const flags = zones.flatMap((z) => [z.entryFlag, z.exitFlag].filter(Boolean));
  const ids = new Set(flags.map((f) => f.id));
  assert.equal(ids.size, flags.length, 'every flag has a unique id');
});

test('exactly one ordinary area is vertical, and it is never -1 (structure.md §1)', () => {
  const ordinary = zones.filter((z) => z.kind === 'area');
  const vertical = ordinary.filter((z) => z.orientation === 'vertical');
  assert.equal(vertical.length, 1, 'exactly one vertical area');
  assert.notEqual(vertical[0].areaIdx, -1, 'the vertical area is never -1');
  assert.ok([-2, -3, -4].includes(vertical[0].areaIdx), 'vertical area is -2, -3, or -4');
  const horizontal = ordinary.filter((z) => z.orientation === 'horizontal');
  assert.equal(horizontal.length, 3, 'the other three areas are horizontal');
});

test('vertical zones are a taller climb; horizontal zones are one view tall (structure.md §4)', () => {
  // Heights must derive from VIEW_H (view.js), not a hardcoded magic number.
  assert.equal(ZONE_H_HORIZONTAL, VIEW_H, 'horizontal zone world is exactly one view tall');
  assert.ok(ZONE_H_VERTICAL > ZONE_H_HORIZONTAL, 'a vertical climb is taller than a horizontal walk');

  for (const z of zones) {
    if (z.orientation === 'vertical') {
      assert.equal(z.bounds.h, ZONE_H_VERTICAL, `${z.idx} vertical zone uses the tall climb height`);
    } else {
      assert.equal(z.bounds.h, ZONE_H_HORIZONTAL, `${z.idx} horizontal/boss zone is one view tall`);
    }
  }
});

test('vertical zone: entry flag at the bottom, exit flag at the top (structure.md §4, checkpoints.md §1)', () => {
  const vz = zones.find((z) => z.orientation === 'vertical');
  assert.ok(vz, 'there is a vertical zone');
  // Entry flag sits on the bottom supporting platform; exit flag on a top platform.
  assert.ok(vz.entryFlag, 'vertical zone has an entry flag');
  assert.ok(vz.exitFlag, 'vertical zone has an exit flag');
  // The two flags are at different heights (bottom entry, top exit).
  assert.notEqual(
    vz.entryFlag.y,
    vz.exitFlag.y,
    'vertical entry and exit flags are at different y positions',
  );
  // In screen coordinates y=0 is the top, so the BOTTOM entry flag has the
  // LARGER y and the TOP exit flag has the SMALLER y.
  assert.ok(
    vz.entryFlag.y > vz.exitFlag.y,
    'entry flag has a larger y (lower on screen) than the exit flag — ' +
      'entry is at the bottom of the climb, exit at the top',
  );
  // Entry flag rests on the bottom supporting platform (at the bottom of the zone).
  const bottomY = vz.bounds.y + vz.bounds.h;
  assert.equal(vz.entryFlag.y, bottomY - 48, 'vertical entry flag sits on the bottom platform');
  // Exit flag rests near the top of the climb (within the world bounds).
  assert.ok(vz.exitFlag.y >= vz.bounds.y, 'vertical exit flag is inside the world (top)');
  assert.ok(vz.exitFlag.y + 48 <= vz.bounds.y + vz.bounds.h, 'vertical exit flag fits within the world');
  // Exit flag is well above the entry flag (the climb is substantial).
  assert.ok(
    vz.entryFlag.y - vz.exitFlag.y > 100,
    'the vertical climb spans a significant distance',
  );
});

test('vertical-area slot is explicit config, not an undocumented default', () => {
  // The vertical slot must be declared on the level definition (R1 #2), not read
  // from a field that silently defaults.
  assert.equal(def.verticalArea, -3, 'LEVELS[0] declares verticalArea explicitly');
  // And buildLevelZones honors it: the declared area is the vertical one.
  const vz = zones.find((z) => z.orientation === 'vertical');
  assert.equal(vz.areaIdx, def.verticalArea, 'the configured area is the vertical one');
});

test('horizontal zones are ~2x the prototype segment wide; vertical/boss are one screen (structure.md §4/§6)', () => {
  // A horizontal zone's width IS the area's playable length (structure.md §6:
  // the zone is the world; the terrain fills it). The target is ~2x the
  // ~2000px prototype segment = 4000px.
  // A vertical zone is one screen wide (structure.md §4: the climb is
  // constrained to a single-screen-wide corridor), so it stays at the
  // original 1600px width.
  // The boss zone is a fixed-size arena, not a doubled corridor, so it also
  // stays at 1600px.
  const horizontalZones = zones.filter((z) => z.kind === 'area' && z.orientation === 'horizontal');
  const verticalZone = zones.find((z) => z.kind === 'area' && z.orientation === 'vertical');
  const bossZone = zones.find((z) => z.kind === 'boss');
  for (const z of horizontalZones) {
    assert.equal(z.bounds.w, ZONE_WIDTH_HORIZONTAL, `${z.idx} horizontal zone is the doubled width`);
  }
  assert.equal(verticalZone.bounds.w, ZONE_WIDTH_VERTICAL, 'vertical zone is one screen wide');
  assert.equal(bossZone.bounds.w, ZONE_WIDTH_VERTICAL, 'boss zone is a fixed-size arena');
  // The horizontal width is ~2x the vertical (one-screen) width.
  assert.ok(
    ZONE_WIDTH_HORIZONTAL > ZONE_WIDTH_VERTICAL,
    'horizontal zones are wider than the one-screen vertical/boss width',
  );
});
