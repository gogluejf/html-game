// Task 3.1 — Level select model tests (pure logic, no DOM).
// Run: node --test petal-panic/js/test/levelSelectModel.test.js

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildLevelMap, buildSubAreasForLevel, AREA_BOSS } from '../ui/levelSelectModel.js';
import { LEVEL_CONFIGS } from '../world/levelConfigs.js';

const empty = () => ({ completedAreas: {}, defeatedBosses: [] });

/** Mark every area of a level completed in a fresh progress object. */
function completeLevel(progress, level) {
  for (const area of [1, 2, 3, 4, AREA_BOSS]) {
    progress.completedAreas[`${level}-${area >= AREA_BOSS ? 'B' : area}`] = true;
  }
}

test('buildLevelMap returns exactly 8 markers, one per LEVEL_CONFIGS entry', () => {
  const map = buildLevelMap(empty());
  assert.equal(map.length, 8);
  assert.deepEqual(map.map(m => m.level), LEVEL_CONFIGS.map(c => c.index));
  assert.deepEqual(map.map(m => m.name), LEVEL_CONFIGS.map(c => c.name));
});

test('buildLevelMap markers carry only level/name/status/selected — never zone nodes', () => {
  const map = buildLevelMap(empty());
  for (const marker of map) {
    assert.deepEqual(Object.keys(marker).sort(), ['level', 'name', 'selected', 'status']);
    assert.equal(typeof marker.selected, 'boolean');
    assert.ok(['locked', 'available', 'completed'].includes(marker.status));
  }
});

test('fresh progress: level 1 available, levels 2-8 locked', () => {
  const map = buildLevelMap(empty());
  assert.equal(map[0].status, 'available');
  for (let i = 1; i < 8; i++) assert.equal(map[i].status, 'locked', `level ${i + 1}`);
});

test('completing a level marks it completed and unlocks the next', () => {
  const p = empty();
  completeLevel(p, 1);
  const map = buildLevelMap(p);
  assert.equal(map[0].status, 'completed');
  assert.equal(map[1].status, 'available');
  assert.equal(map[2].status, 'locked');
});

test('a partially completed level is not completed', () => {
  const p = empty();
  for (const area of [1, 2, 3, 4]) p.completedAreas[`1-${area}`] = true; // boss missing
  assert.equal(buildLevelMap(p)[0].status, 'available');
});

test('level availability chains through the previous level: a later level stays locked while its predecessor is incomplete', () => {
  const p = empty();
  completeLevel(p, 1);
  for (const area of [1, 2, 3]) p.completedAreas[`2-${area}`] = true; // 2-B missing
  const map = buildLevelMap(p);
  assert.equal(map[1].status, 'available');
  assert.equal(map[2].status, 'locked', 'level 3 locks until level 2 fully completes');
});

test('buildSubAreasForLevel returns exactly X-1..X-4 and X-B', () => {
  const subs = buildSubAreasForLevel(3, empty());
  assert.equal(subs.length, 5);
  assert.deepEqual(subs.map(s => s.label), ['3-1', '3-2', '3-3', '3-4', '3-B']);
  assert.deepEqual(subs.map(s => s.zone), ['1', '2', '3', '4', 'B']);
  assert.deepEqual(subs.map(s => s.boss), [false, false, false, false, true]);
  assert.deepEqual(subs.map(s => s.start), [
    { level: 3, area: 1 }, { level: 3, area: 2 }, { level: 3, area: 3 },
    { level: 3, area: 4 }, { level: 3, area: AREA_BOSS },
  ]);
});

test('first sub-area of level 1 is unlocked by default', () => {
  const first = buildSubAreasForLevel(1, empty())[0];
  assert.equal(first.status, 'unlocked');
  assert.equal(first.tooltip, null);
});

test('sub-areas lock behind their previous sub-area', () => {
  const subs = buildSubAreasForLevel(1, empty());
  assert.equal(subs[1].status, 'locked');
  assert.equal(subs[1].tooltip, 'Pass 1-1 to unlock');
  assert.equal(subs[4].status, 'locked');
  assert.equal(subs[4].tooltip, 'Pass 1-4 to unlock');
});

test('completing areas unlocks the next sub-area and flags completion', () => {
  const p = empty();
  p.completedAreas['1-1'] = true;
  let subs = buildSubAreasForLevel(1, p);
  assert.equal(subs[0].status, 'completed');
  assert.equal(subs[1].status, 'unlocked');
  assert.equal(subs[1].tooltip, null);
  assert.equal(subs[2].status, 'locked');
  assert.equal(subs[2].tooltip, 'Pass 1-2 to unlock');
});

test('boss area completes the level chain: next level opens at its first sub-area', () => {
  const p = empty();
  completeLevel(p, 1);
  const next = buildSubAreasForLevel(2, p);
  assert.equal(next[0].status, 'unlocked', '2-1 opens after 1-B');
  assert.equal(next[1].status, 'locked');
  assert.equal(next[1].tooltip, 'Pass 2-1 to unlock');
});

test('first sub-area of a later level locks until the previous level boss is done', () => {
  const p = empty();
  p.completedAreas['1-4'] = true; // everything but 1-B
  const subs = buildSubAreasForLevel(2, p);
  assert.equal(subs[0].status, 'locked');
  assert.equal(subs[0].tooltip, 'Pass 1-B to unlock');
});

test('null/mistyped progress degrades to defaults without throwing', () => {
  assert.equal(buildLevelMap(null)[0].status, 'available');
  assert.equal(buildSubAreasForLevel(1, null)[0].status, 'unlocked');
  assert.equal(buildSubAreasForLevel(1, { completedAreas: 'nope' })[0].status, 'unlocked');
  assert.equal(buildSubAreasForLevel(1, {})[1].status, 'locked');
});
