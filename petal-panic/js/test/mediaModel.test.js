// Task 5.1 — Media unlock model tests (pure logic, no DOM).
// Run: node --test petal-panic/js/test/mediaModel.test.js

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildMediaCards, isKnownMediaId, levelBgPath, MEDIA_IDS } from '../ui/mediaModel.js';
import { LEVEL_CONFIGS } from '../world/levelConfigs.js';

const empty = () => ({ mediaUnlocked: [] });

/** Progress with a fixed set of media ids unlocked. */
function withUnlocked(...ids) {
  return { mediaUnlocked: [...ids] };
}

test('buildMediaCards returns intro + eight level clips + ending (10 cards)', () => {
  const cards = buildMediaCards(empty());
  assert.equal(cards.length, 10);
  assert.deepEqual(cards.map(c => c.id), [
    'intro',
    ...LEVEL_CONFIGS.map(c => `level-${c.index}`),
    'ending',
  ]);
});

test('cards carry exactly id/title/kind/level/status/tooltip/asset', () => {
  for (const card of buildMediaCards(empty())) {
    assert.deepEqual(Object.keys(card).sort(),
      ['asset', 'id', 'kind', 'level', 'status', 'title', 'tooltip']);
    assert.ok(['sprite-loop', 'video'].includes(card.kind));
    assert.ok(['locked', 'unlocked'].includes(card.status));
  }
});

test('fresh progress locks every card with an unlock tooltip', () => {
  const cards = buildMediaCards(empty());
  assert.ok(cards.every(c => c.status === 'locked'), 'all locked on fresh progress');
  assert.equal(cards[0].tooltip, 'Start a new game to unlock');
  for (let i = 0; i < LEVEL_CONFIGS.length; i++) {
    const cfg = LEVEL_CONFIGS[i];
    const expectedBoss = cfg.boss.replace(/_/g, ' ');
    assert.equal(cards[i + 1].tooltip, `Beat ${expectedBoss} to unlock`, `level ${cfg.index}`);
  }
  const lastBoss = LEVEL_CONFIGS[LEVEL_CONFIGS.length - 1].boss.replace(/_/g, ' ');
  assert.equal(cards[cards.length - 1].tooltip, `Beat ${lastBoss} to unlock`);
});

test('intro unlocks after any New Game start (mediaUnlocked contains "intro")', () => {
  const cards = buildMediaCards(withUnlocked('intro'));
  assert.equal(cards[0].status, 'unlocked');
  assert.equal(cards[0].tooltip, null, 'unlocked cards carry no tooltip');
  // Unlocking the intro must not leak into other cards.
  assert.ok(cards.slice(1).every(c => c.status === 'locked'), 'other cards stay locked');
});

test('a level clip unlocks only via its own id (matching boss defeated)', () => {
  const cards = buildMediaCards(withUnlocked('level-3'));
  assert.equal(cards[3].status, 'unlocked', 'level-3 clip unlocked');
  assert.equal(cards[3].tooltip, null);
  assert.equal(cards[2].status, 'locked', 'level-2 still locked');
  assert.equal(cards[4].status, 'locked', 'level-4 still locked');
  assert.equal(cards[0].status, 'locked', 'intro still locked');
  assert.equal(cards[9].status, 'locked', 'ending still locked');
});

test('ending unlocks only via the "ending" id (final boss defeated)', () => {
  const cards = buildMediaCards(withUnlocked('ending'));
  assert.equal(cards[9].status, 'unlocked');
  assert.equal(cards[9].tooltip, null);
  assert.ok(cards.slice(0, 9).every(c => c.status === 'locked'), 'nothing else unlocked');
});

test('fully earned progress unlocks all ten cards', () => {
  const cards = buildMediaCards({ mediaUnlocked: [...MEDIA_IDS] });
  assert.ok(cards.every(c => c.status === 'unlocked' && c.tooltip === null));
});

test('card metadata: kind, titles, and level pointers', () => {
  const cards = buildMediaCards(empty());
  assert.equal(cards[0].kind, 'sprite-loop');
  assert.equal(cards[0].level, null, 'intro has no level');
  assert.equal(cards[0].title, 'Intro');
  for (let i = 0; i < LEVEL_CONFIGS.length; i++) {
    assert.equal(cards[i + 1].level, LEVEL_CONFIGS[i].index);
    assert.equal(cards[i + 1].title, `${LEVEL_CONFIGS[i].name} Clip`);
  }
  assert.equal(cards[9].title, 'Ending');
  assert.equal(cards[9].level, null, 'ending has no level');
});

test('asset paths match the per-level template for every level (N1/N4)', () => {
  const cards = buildMediaCards(empty());
  assert.equal(cards[0].asset, null, 'intro placeholder');
  assert.equal(cards[9].asset, null, 'ending placeholder');
  // N1: all eight levels carry their bg path — the model builds it from the
  // config (bg_f1.png exists on disk for every level), so no null gating.
  // N4: assert the PATH FORMAT, not exact values, so future asset drops
  // (e.g. real clips replacing placeholders) don't break this test.
  for (let i = 1; i <= LEVEL_CONFIGS.length; i++) {
    const cfg = LEVEL_CONFIGS[i - 1];
    const card = cards[i];
    assert.equal(card.asset, levelBgPath(cfg.index), `level ${cfg.index} path format`);
    assert.match(card.asset, /^\.\.\/\.\.\/assets\/levels\/level\d+\/bg_f1\.png$/,
      `level ${cfg.index} matches template shape`);
  }
});

test('levelBgPath is well-formed for every configured level', () => {
  for (const cfg of LEVEL_CONFIGS) {
    assert.equal(levelBgPath(cfg.index), `../../assets/levels/level${cfg.index}/bg_f1.png`);
  }
});

test('null / mistyped progress degrades safely to all-locked', () => {
  for (const bad of [null, undefined, 42, 'x', [], { mediaUnlocked: null }, { mediaUnlocked: 7 }, {}]) {
    const cards = buildMediaCards(bad);
    assert.equal(cards.length, 10, `length stable for ${JSON.stringify(bad)}`);
    assert.ok(cards.every(c => c.status === 'locked'), `all locked for ${JSON.stringify(bad)}`);
  }
});

test('non-string entries in mediaUnlocked are ignored, duplicates collapse', () => {
  const cards = buildMediaCards({ mediaUnlocked: ['intro', 'intro', 5, null, 'level-1', 'bogus'] });
  assert.equal(cards[0].status, 'unlocked');
  assert.equal(cards[1].status, 'unlocked');
  assert.ok(cards.slice(2).every(c => c.status === 'locked'), 'junk/bogus ids never unlock');
});

test('isKnownMediaId validates catalog ids', () => {
  assert.ok(MEDIA_IDS.includes('intro') && MEDIA_IDS.includes('level-8') && MEDIA_IDS.includes('ending'));
  assert.equal(isKnownMediaId('intro'), true);
  assert.equal(isKnownMediaId('level-1'), true);
  assert.equal(isKnownMediaId('ending'), true);
  assert.equal(isKnownMediaId('level-9'), false, 'out-of-range level');
  assert.equal(isKnownMediaId('bogus'), false);
  assert.equal(isKnownMediaId(null), false);
  assert.equal(isKnownMediaId(3), false);
});
