// Task 7.2 — concrete design-plan values + tuning pass (docs/levels/*.md).
// Run: node --test petal-panic/js/test/tuning.test.js
//
// The docs/levels/*.md contract marks several "design-plan decisions" that the
// plan must settle with concrete values. This test locks the concrete values
// into the single TUNING block (tuning.js) and verifies each deferred marker
// has a corresponding concrete value in code/config:
//
//   structure.md   §5/§6  — area lengths in px, usable reach margin
//   generation.md  §5/§7  — per-stage population budgets, breathing room
//   populate.md    §3     — super-structure ceiling (bounded, not 99)
//   boss-arena.md  §1/§2  — intro timings, bar-fill threshold, approach
//   checkpoints.md §2/§4  — clear banner + transition timings, death fade
//   game-rules.md  §2/§4/§5 — coin carryover, inventory persistence
//
// The values live in ONE place (tuning.js) and the consumers (levelConfigs.js,
// gameRules.js, terrain.js, macros.js, bossZone.js, update.js, lifecycle.js)
// import from there. These tests assert the values are concrete, in-range, and
// wired to their single owner — no magic numbers left uncited.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { TUNING, TUNING_REACH, TUNING_BARREL, TUNING_MACRO, TUNING_COINS, TUNING_INVENTORY, TUNING_SCROLL, TUNING_LIVES, TUNING_MUSIC } from '../tuning.js';
import { GAME_RULES, resetLevelCoinTally, resetHeroInventory } from '../gameRules.js';
import { REACH_MARGIN } from '../terrain.js';
import { BARREL_STRUCTURE, STAGE_WEIGHTS, classifyBarrelStructure } from '../macros.js';
import { BOSS_ZONE_TIMINGS } from '../bossZone.js';
import { VIEW_W, VIEW_H } from '../view.js';
import { LEVEL_CONFIGS, getLevelConfig } from '../levelConfigs.js';
import { ZONE_WIDTH_HORIZONTAL, ZONE_H_VERTICAL } from '../level.js';
import { Timers } from '../timers.js';

// ===========================================================================
// Single owner: the TUNING block is the one place the deferred values live.
// ===========================================================================

test('TUNING block is the single owner (frozen, non-empty, all concrete numbers)', () => {
  // The block exists and is frozen so a stray assignment can't drift a value.
  assert.equal(Object.isFrozen(TUNING), true, 'TUNING is frozen');
  // Every timing/duration is a concrete positive number (no null/undefined).
  const numericKeys = [
    'clearFlash', 'clearBanner', 'clearFadeOut', 'clearFadeIn',
    'deathFade',
    'bossIntroLocked', 'bossIntroSweep', 'bossIntroBarFill',
    'bossIntroEnter',
    'bossEnterTravelScreens',
    'rewardMinDwell',
  ];
  for (const k of numericKeys) {
    assert.equal(typeof TUNING[k], 'number', `TUNING.${k} is a concrete number`);
    assert.ok(Number.isFinite(TUNING[k]), `TUNING.${k} is finite`);
    assert.ok(TUNING[k] > 0, `TUNING.${k} is positive`);
  }
  // areaEntryMinDwell is a concrete number (0 = no mandatory dwell).
  assert.equal(typeof TUNING.areaEntryMinDwell, 'number',
    'areaEntryMinDwell is a concrete number');
  assert.ok(TUNING.areaEntryMinDwell >= 0, 'areaEntryMinDwell is non-negative');
  // The bar-fill threshold is a fraction in (0,1): the boss enters after a
  // PORTION of the bar has filled, never before it starts (0) or after it is
  // full (1) — boss-arena.md §2 step 7.
  assert.ok(TUNING.bossIntroBarFillPct > 0 && TUNING.bossIntroBarFillPct < 1,
    `bar-fill threshold ${TUNING.bossIntroBarFillPct} is a proper fraction (0,1)`);
});

// ===========================================================================
// New TUNING-owned decisions (task 7.2 fix pass)
// ===========================================================================

test('horizontal backward scrolling is a concrete, doc-cited decision (structure.md §3)', () => {
  // structure.md §3: "Horizontal backward-scroll behavior within the current
  // area is a design-plan decision." The concrete choice is owned by the
  // TUNING block (TUNING_SCROLL.backwardScroll) and is a boolean (not a
  // magic literal).
  assert.equal(typeof TUNING_SCROLL.backwardScroll, 'boolean',
    'backward scroll is a concrete boolean decision');
  // The camera follows the hero both ways inside the zone (clamped at the
  // zone's left edge) — the existing dead-zone follow in camera.js.
  assert.equal(TUNING_SCROLL.backwardScroll, true,
    'the concrete choice is free backward scrolling inside the area');
});

test('lives across level completion is a concrete, doc-cited decision (game-rules.md §1)', () => {
  // game-rules.md §1: "Whether completing a level replenishes lives or
  // preserves the remaining count is a design-plan decision." The concrete
  // choice is owned by the TUNING block (TUNING_LIVES.onLevelComplete).
  assert.equal(typeof TUNING_LIVES.onLevelComplete, 'string',
    'lives-on-complete is a concrete string decision');
  assert.ok(['preserve', 'replenish'].includes(TUNING_LIVES.onLevelComplete),
    `lives-on-complete is a known policy (${TUNING_LIVES.onLevelComplete})`);
  // The concrete choice: lives are PRESERVED across level completion (no
  // refill) — a clean run carries more lives into the next level.
  assert.equal(TUNING_LIVES.onLevelComplete, 'preserve',
    'the concrete choice is to preserve the remaining life count');
});

test('area-entry timing/skippability is a concrete, doc-cited decision (checkpoints.md §3)', () => {
  // checkpoints.md §3: "Timing and whether the screen is skippable are
  // design-plan concerns." The concrete values are owned by the TUNING block.
  assert.equal(typeof TUNING.areaEntrySkippable, 'boolean',
    'area-entry skippability is a concrete boolean decision');
  assert.equal(TUNING.areaEntrySkippable, true,
    'the area-entry screen is skippable (confirm starts the attempt)');
  assert.equal(typeof TUNING.areaEntryMinDwell, 'number',
    'area-entry min dwell is a concrete number');
  assert.ok(TUNING.areaEntryMinDwell >= 0, 'area-entry min dwell is non-negative');
  // The concrete choice: no mandatory dwell — the player controls the pace.
  assert.equal(TUNING.areaEntryMinDwell, 0,
    'no mandatory dwell (the player controls the pace)');
});

test('reward-screen duration/skipping/effects are concrete, doc-cited decisions (boss-arena.md §4–5)', () => {
  // boss-arena.md §4–5: "Its duration, skip behavior, and celebration effects
  // are design-plan concerns." The concrete values are owned by the TUNING
  // block.
  assert.equal(typeof TUNING.rewardSkippable, 'boolean',
    'reward skippability is a concrete boolean decision');
  assert.equal(TUNING.rewardSkippable, true,
    'the reward screen is skippable (confirm starts the next level)');
  assert.equal(typeof TUNING.rewardMinDwell, 'number',
    'reward min dwell is a concrete number');
  assert.ok(TUNING.rewardMinDwell >= 0, 'reward min dwell is non-negative');
  assert.equal(typeof TUNING.rewardCelebration, 'string',
    'reward celebration is a concrete string decision');
  // The concrete choice: a short celebratory beat before confirm is honored.
  assert.ok(TUNING.rewardMinDwell > 0,
    'the reward screen has a short celebratory beat before confirm');
});

test('music policy is a concrete, doc-cited decision (README.md, boss-arena.md §1)', () => {
  // README.md: "Music is deferred." boss-arena.md §1: "Music will be added
  // later. The visual sequence must communicate tension on its own." The
  // concrete policy is owned by the TUNING block (TUNING_MUSIC.policy).
  assert.equal(typeof TUNING_MUSIC.policy, 'string',
    'music policy is a concrete string decision');
  assert.equal(TUNING_MUSIC.policy, 'deferred',
    'the concrete choice is to defer music/audio in the level engine v1');
  assert.equal(typeof TUNING_MUSIC.bossIntroSilent, 'boolean',
    'boss-intro silence is a concrete boolean decision');
  assert.equal(TUNING_MUSIC.bossIntroSilent, true,
    'the boss-intro presentation is silent (visual carries the tension)');
});

test('converted-coin decision is concrete and wired to GAME_RULES (game-rules.md §2)', () => {
  // game-rules.md §2: "Are converted coins deducted from a spendable balance
  // or only marked rewarded?" The concrete choice is owned by the TUNING
  // block (TUNING_COINS.convertedCoins) and wired to GAME_RULES.coins.
  assert.equal(typeof TUNING_COINS.convertedCoins, 'string',
    'converted-coin policy is a concrete string decision');
  assert.ok(['mark', 'deduct'].includes(TUNING_COINS.convertedCoins),
    `converted-coin policy is a known choice (${TUNING_COINS.convertedCoins})`);
  assert.equal(GAME_RULES.coins.convertedCoins, TUNING_COINS.convertedCoins,
    'GAME_RULES.coins.convertedCoins is wired to the TUNING block');
  // The concrete choice: converted 1000-coin chunks are MARKED REWARDED, not
  // deducted from a spendable balance (coins are not a spendable currency in
  // v1 — the only conversion is the automatic continue credit).
  assert.equal(TUNING_COINS.convertedCoins, 'mark',
    'the concrete choice is to mark converted chunks as rewarded');
});

// ===========================================================================
// structure.md §5/§6 — area lengths in px + usable reach margin
// ===========================================================================

test('area lengths in px are concrete and match the documented budget', () => {
  // structure.md §6: horizontal ~2x the ~2000px prototype = 4000px.
  assert.equal(ZONE_WIDTH_HORIZONTAL, 4000, 'horizontal area length is the documented 4000px');
  // structure.md §4/§6: vertical is ~3 screens tall (VIEW_H × 3 = 1620px).
  assert.equal(ZONE_H_VERTICAL, VIEW_H * 3, 'vertical area length is 3 screens (VIEW_H × 3)');
  assert.equal(ZONE_H_VERTICAL, 1620, 'vertical area length is 1620px');
  // The Level 1 config references these single-source constants (no re-declared
  // literals) — levelConfigs.js cites structure.md §6.
  const l1 = getLevelConfig(1);
  assert.equal(l1.lengths.horizontal, ZONE_WIDTH_HORIZONTAL, 'config horizontal length === ZONE_WIDTH_HORIZONTAL');
  assert.equal(l1.lengths.vertical, ZONE_H_VERTICAL, 'config vertical length === ZONE_H_VERTICAL');
});

test('REACH_MARGIN is a concrete, doc-grounded margin (structure.md §5)', () => {
  // structure.md §5: "Spacing must work for both heroes with a usable margin,
  // not only a perfect jump." The margin is a concrete px value owned by the
  // TUNING block and re-exported by terrain.js (single owner).
  assert.equal(REACH_MARGIN, TUNING_REACH.reachMargin, 'REACH_MARGIN is owned by the TUNING block');
  assert.ok(TUNING_REACH.reachMargin > 0, 'the margin is positive (not a perfect jump)');
  // The margin must be small enough that a usable step remains below the
  // weakest hero's double-jump apex (a positive step, not a frame-perfect jump).
  const minReach = (420 * 420) / (2 * 1500) + ((0.85 * 420) * (0.85 * 420)) / (2 * 1500);
  assert.ok(TUNING_REACH.reachMargin < minReach, 'margin < min double-jump reach (a usable step remains)');
});

// ===========================================================================
// generation.md §5/§7 — population budgets + breathing room
// ===========================================================================

test('per-stage population budgets are concrete (populate.md §1, generation.md §5)', () => {
  const l1 = getLevelConfig(1);
  const stages = ['1', '2', '3', '4'];
  for (const s of stages) {
    const b = l1.stageBudgets[s];
    assert.ok(b, `stage ${s} has a budget`);
    // Each stage has concrete non-negative integer quantities for enemies,
    // barrels, and powerups (the per-stage QUANTITY budget).
    for (const section of ['enemies', 'barrels', 'powerups']) {
      assert.ok(b[section] && typeof b[section] === 'object', `stage ${s}: ${section} budget present`);
      for (const v of Object.values(b[section])) {
        assert.ok(Number.isInteger(v) && v >= 0, `stage ${s}/${section}: concrete non-negative integer`);
      }
    }
  }
  // The progression is visible: 1 (sparse) has fewer enemies than 4 (dense).
  const total = (b) => Object.values(b.enemies).reduce((a, c) => a + c, 0);
  assert.ok(total(l1.stageBudgets['4']) > total(l1.stageBudgets['1']),
    'stage 4 is denser than stage 1 (deliberate progression)');
});

test('breathing room is retained in 2/3 (generation.md §5)', () => {
  // generation.md §5: "Later areas should feel more intense, not impossible.
  // Breathing room and clear landings remain useful even in the hardest
  // patterns." The concrete breathing-room values are the STAGE_WEIGHTS easy-
  // tier weights: 2 keeps a 1:2 easy:hard split, 3 keeps a ~1:1:3 split.
  assert.ok(STAGE_WEIGHTS['2'][1] > 0, '2 retains an easy tier (breathing room)');
  assert.ok(STAGE_WEIGHTS['3'][1] > 0, '3 retains an easy tier (breathing room)');
  // The easy tier is down-weighted relative to the hard tier (more intense)
  // but NOT removed (breathing room remains).
  assert.ok(STAGE_WEIGHTS['2'][1] < STAGE_WEIGHTS['2'][2], '2: easy < hard (more intense)');
  assert.ok(STAGE_WEIGHTS['3'][1] < STAGE_WEIGHTS['3'][3], '3: easy < hard (more intense)');
  // 1 is the sparse intro: difficulty 1 only.
  assert.deepEqual(Object.keys(STAGE_WEIGHTS['1']), ['1'], '1 is sparse/simple (difficulty 1 only)');
});

test('anti-repetition is a concrete, bounded constraint (generation.md §5)', () => {
  // generation.md §5: "Pattern repetition is allowed, but unconstrained
  // repetition must not replace pacing." The concrete constraint is the
  // repeat penalty: a value in (0,1] that down-weights (never removes) a
  // just-placed macro so repeats are discouraged but the composer stays total.
  assert.equal(typeof TUNING_MACRO.repeatPenalty, 'number', 'repeat penalty is a concrete number');
  assert.ok(TUNING_MACRO.repeatPenalty > 0, 'repeat penalty > 0 (repeats are never REMOVED — composer stays total)');
  assert.ok(TUNING_MACRO.repeatPenalty < 1, 'repeat penalty < 1 (repeats are down-weighted — pacing preserved)');
});

// ===========================================================================
// populate.md §3 — super-structure ceiling (bounded, not 99)
// ===========================================================================

test('BARREL_STRUCTURE.super has a concrete, bounded ceiling (populate.md §3)', () => {
  // populate.md §3: "Super structure: a much larger set piece ... Exact
  // frequency and counts remain tuning values." The old max was an arbitrary
  // 99; the concrete ceiling is owned by the TUNING block.
  assert.equal(BARREL_STRUCTURE.super.max, TUNING_BARREL.superMax, 'super max is owned by the TUNING block');
  assert.ok(BARREL_STRUCTURE.super.max >= BARREL_STRUCTURE.super.min, 'super max >= super min');
  assert.ok(BARREL_STRUCTURE.super.max < 99, 'super max is a real ceiling (no longer the arbitrary 99)');
  assert.ok(BARREL_STRUCTURE.super.min === 10, 'super min is the doc\'s "much larger" threshold (10)');
  // A group of 10+ barrels classifies as super; a group above the ceiling is
  // still bounded (the classifier is total — it never rejects a count).
  assert.equal(classifyBarrelStructure(Array(10).fill(0).map((_, i) => i)), 'super');
  assert.equal(classifyBarrelStructure(Array(BARREL_STRUCTURE.super.max).fill(0).map((_, i) => i)), 'super');
});

// ===========================================================================
// boss-arena.md §1/§2 — intro timings, bar-fill threshold, approach
// ===========================================================================

test('boss intro timings are concrete and wired to the TUNING block (boss-arena.md §2)', () => {
  assert.equal(BOSS_ZONE_TIMINGS.LOCKED, TUNING.bossIntroLocked);
  assert.equal(BOSS_ZONE_TIMINGS.INTRO_SWEEP, TUNING.bossIntroSweep);
  assert.equal(BOSS_ZONE_TIMINGS.BAR_FILL, TUNING.bossIntroBarFill);
  assert.equal(BOSS_ZONE_TIMINGS.BOSS_ENTER, TUNING.bossIntroEnter);
  // The sweep is "rapid" (pure tension): a short duration.
  assert.ok(BOSS_ZONE_TIMINGS.INTRO_SWEEP < 3, 'the intro sweep is rapid (<3s)');
});

// ===========================================================================
// checkpoints.md §2/§4 — clear banner + transition timings, death fade
// ===========================================================================

test('area-clear transition timings are concrete (checkpoints.md §2)', () => {
  // checkpoints.md §2: "Exact timing and effect composition are tunable."
  // The concrete values are owned by the TUNING block.
  assert.ok(TUNING.clearFlash > 0, 'flag flash duration is concrete');
  assert.ok(TUNING.clearBanner > 0, 'banner duration is concrete');
  assert.ok(TUNING.clearFadeOut > 0, 'fade-out duration is concrete');
  assert.ok(TUNING.clearFadeIn > 0, 'fade-in duration is concrete');
  // The banner is the dominant beat of the clear sequence (a rewarding
  // presentation, not a blip).
  assert.ok(TUNING.clearBanner > TUNING.clearFlash, 'banner outlasts the flash');
});

test('death fade is a concrete "short delay" (checkpoints.md §4)', () => {
  // checkpoints.md §4: "After the death presentation and a short delay, fade
  // to black." The concrete delay is owned by the TUNING block.
  assert.ok(TUNING.deathFade > 0, 'death fade delay is concrete and positive');
});

// ===========================================================================
// game-rules.md §2/§4/§5 — coin carryover + inventory persistence
// ===========================================================================

test('coin carryover policy is concrete and wired to GAME_RULES (game-rules.md §2)', () => {
  // game-rules.md §2: the remainder below 1000 does NOT carry to the next
  // level; failed attempts do NOT count; a continue RESETS the tally.
  assert.equal(GAME_RULES.coins.carryoverRemainder, false, 'remainder does not carry between levels');
  assert.equal(GAME_RULES.coins.countFailedAttempts, false, 'failed attempts do not count toward the reward');
  assert.equal(GAME_RULES.coins.resetOnContinue, true, 'a continue resets the current level coin tally');
  assert.equal(GAME_RULES.coins.accountingOnFailure, 'rollback', 'failed attempts roll back to entry totals');
  // The policy is owned by the TUNING block (single owner).
  assert.equal(GAME_RULES.coins.carryoverRemainder, TUNING_COINS.carryoverRemainder);
  assert.equal(GAME_RULES.coins.accountingOnFailure, TUNING_COINS.accountingOnFailure);
});

test('inventory persistence policy is concrete and wired to GAME_RULES (game-rules.md §5)', () => {
  // game-rules.md §5: ammo/weapon/energy/temporary powerups/super meter
  // persistence across death, continue, and area advance. The concrete policy:
  // temporary state resets; energy is restored to full.
  assert.equal(GAME_RULES.inventory.ammo, 'reset');
  assert.equal(GAME_RULES.inventory.weapon, 'reset');
  assert.equal(GAME_RULES.inventory.energy, 'restore');
  assert.equal(GAME_RULES.inventory.powerups, 'reset', 'temporary powerups do NOT persist across death');
  assert.equal(GAME_RULES.inventory.superMeter, 'reset');
  // The policy is owned by the TUNING block (single owner).
  assert.equal(GAME_RULES.inventory.powerups, TUNING_INVENTORY.powerups);
  assert.equal(GAME_RULES.inventory.superMeter, TUNING_INVENTORY.superMeter);
});

// --- resetLevelCoinTally: obsolete under the trace/currentStats split --------
// The boss reward now reads a per-level delta (diffCounters since the
// level-start snapshot), so an explicit coin-tally zeroing is no longer needed
// — and zeroing would corrupt the append-only trace. The function is kept as a
// no-op for call-site compatibility.
test('resetLevelCoinTally is a no-op (reward uses per-level delta accounting)', () => {
  const h = { runStats: { coinsCollected: { bronze: 3, silver: 2, gold: 1, total: 6 } } };
  resetLevelCoinTally(h);
  // Untouched: the tally is preserved (the trace must never be zeroed).
  assert.deepEqual(h.runStats.coinsCollected, { bronze: 3, silver: 2, gold: 1, total: 6 },
    'the coin tally is NOT reset (no-op by design)');
});

test('resetLevelCoinTally is a safe no-op when runStats is absent', () => {
  const h = {};
  resetLevelCoinTally(h); // must not throw
  assert.equal(h.runStats, undefined);
});

// --- resetHeroInventory: temporary state does not persist across death -------
test('resetHeroInventory clears temporary powerups + super meter, restores energy', () => {
  const h = {
    maxEnergy: 100, energy: 40,   // drained energy → restored to full
    shield: 5,                     // active temporary powerup → cleared
    supermoveMeter: 100,           // charged super → reset to 0
    ammo: 12,                      // drained ammo → reset to baseline (200)
    specialAmmo: 7,                // granted special ammo → reset to 0
    selectedWeapon: 'special',     // toggled weapon → reset to default (thorn)
    timers: new Timers(), // active rapid-fire → cleared
  };
  h.timers.set('rapid', 2.5); // simulate an active rapid-fire window
  resetHeroInventory(h);
  assert.equal(h.energy, 100, 'energy is restored to full');
  assert.equal(h.shield, 0, 'temporary powerup (shield) is cleared');
  assert.equal(h.supermoveMeter, 0, 'super meter is reset');
  assert.equal(h.ammo, 200, 'ammo is reset to the baseline (200)');
  assert.equal(h.specialAmmo, 0, 'special ammo is reset to 0');
  assert.equal(h.selectedWeapon, 'thorn', 'selected weapon is reset to the default (thorn)');
  assert.equal(h.timers.get('rapid'), 0, 'temporary rapid-fire state is cleared');
});

test('resetHeroInventory is a safe no-op on a bare hero', () => {
  const h = {};
  resetHeroInventory(h); // must not throw
  assert.deepEqual(h, {});
});

// ===========================================================================
// Cross-file consistency: the single owner is actually wired through.
// ===========================================================================

test('LEVEL_CONFIGS references the single-source length constants (no re-declared literals)', () => {
  for (const cfg of LEVEL_CONFIGS) {
    assert.equal(cfg.lengths.horizontal, ZONE_WIDTH_HORIZONTAL,
      `level ${cfg.index}: horizontal length === ZONE_WIDTH_HORIZONTAL`);
    assert.equal(cfg.lengths.vertical, ZONE_H_VERTICAL,
      `level ${cfg.index}: vertical length === ZONE_H_VERTICAL`);
  }
});
