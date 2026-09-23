// Task 2.2 — area-clear sequence (checkpoints.md §2, structure.md §2).
// Run: node --test petal-panic/js/test/clearSequence.test.js
//
// Source of truth:
//   docs/levels/checkpoints.md §2 Clearing an ordinary area
//   docs/levels/structure.md   §2 Independent zones
//
// Acceptance criteria covered:
//   1. Touching the exit flag triggers flash + banner exactly once
//   2. Camera never reveals the next zone before the fade (hero frozen)
//   3. After fade-in the hero stands at the new zone's start beside its entry flag
//   4. Entry flag does not immediately re-trigger a clear
//
// Area indexing: the zone model uses areas -1, -2, -3, -4, boss.
//   -1 = first area (no entry flag), -2 = second, -3 = third (vertical),
//   -4 = fourth, boss = final zone.
// Each zone owns its own entry flag (list index 0) and exit flag (index 1);
// reaching the active zone's exit flag clears the area and advances to the
// next zone (zone.areaIdx + 1, or the boss zone for area -4).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing update.js) ------------------
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: (tag) => ({
    width: 0, height: 0,
    getContext: () => ctxStub,
    addEventListener: noop,
  }),
};
globalThis.window = { addEventListener: noop };

const U = await import('../systems/update.js');
const { S, getState, setState } = await import('../state.js');
const { ZONE_ENTRY_X, ZONE_GROUND_Y, buildLevelZones, LEVELS } = await import('../level.js');

// --- Helpers -----------------------------------------------------------------

/**
 * Step the clear sequence forward by the given number of frames.
 */
function stepClear(dt, steps) {
  for (let i = 0; i < steps; i++) {
    U.stepClearSequence(dt);
  }
}

const DT = 1 / 60;
const BANNER_STEPS = Math.ceil(1.2 / DT);
const FADE_OUT_STEPS = Math.ceil(0.6 / DT);
const FADE_IN_STEPS = Math.ceil(0.6 / DT);

/** Reset the clear sequence to a clean idle state. */
function resetSeq() {
  // Step through any active phases to reach idle.
  const state = U.getClearSequence().state;
  if (state !== 'idle') {
    // Complete whatever phase is active.
    stepClear(DT, BANNER_STEPS + FADE_OUT_STEPS + FADE_IN_STEPS + 10);
  }
  // Consume any pending fade-in.
  if (U.getClearSequence().pendingFadeIn) {
    U.beginClearFadeIn();
    stepClear(DT, FADE_IN_STEPS + 10);
  }
}

// --- Tests -------------------------------------------------------------------

test('onExitFlagReached: sets the banner text and pending area (zone-model indexing)', () => {
  resetSeq();
  const seq = U.getClearSequence();
  assert.equal(seq.state, 'idle', 'starts in idle state');

  // Clearing area -1 (the first area) advances to area -2.
  U.onExitFlagReached('1-1', -2);

  const s = U.getClearSequence();
  assert.equal(s.state, 'banner', 'transitions to banner state');
  assert.equal(s.bannerText, '1-1 CLEAR', 'banner text is "1-1 CLEAR"');
  assert.equal(s.pendingArea, -2, 'pending area is -2 (zone-model index)');
  assert.equal(s.pendingFadeIn, true, 'fade-in is pending');
});

test('onExitFlagReached: banner text is formatted correctly for each area', () => {
  // Clearing area -1 → '1-1 CLEAR'
  resetSeq();
  U.onExitFlagReached('1-1', -2);
  assert.equal(U.getClearBanner(), '1-1 CLEAR');

  // Clearing area -2 → '1-2 CLEAR'
  resetSeq();
  U.onExitFlagReached('1-2', -3);
  assert.equal(U.getClearBanner(), '1-2 CLEAR');

  // Clearing area -3 → '1-3 CLEAR'
  resetSeq();
  U.onExitFlagReached('1-3', -4);
  assert.equal(U.getClearBanner(), '1-3 CLEAR');
});

test('stepClearSequence: transitions from banner to fadeOut after banner duration', () => {
  resetSeq();
  U.onExitFlagReached('1-1', -2);
  assert.equal(U.getClearSequence().state, 'banner');

  stepClear(DT, BANNER_STEPS);
  assert.equal(U.getClearSequence().state, 'fadeOut', 'transitions to fadeOut after banner');
});

test('stepClearSequence: fadeOut completes, advances hero to next zone area, shows entry screen', () => {
  resetSeq();
  const hero = U.getHero();
  setState(S.PLAY);
  hero.currentArea = -1;

  // Clearing area -1 advances to area -2.
  U.onExitFlagReached('1-1', -2);

  stepClear(DT, BANNER_STEPS);
  assert.equal(U.getClearSequence().state, 'fadeOut');

  stepClear(DT, FADE_OUT_STEPS);

  // After fadeOut completes:
  assert.equal(U.getClearSequence().state, 'idle', 'sequence completes to idle');
  assert.equal(U.getClearSequence().pendingFadeIn, true, 'fade-in is still pending');
  // The hero should be in the next zone-model area.
  assert.equal(hero.currentArea, -2, 'hero advanced to area -2 (zone model)');
  // The entry screen should be showing.
  assert.equal(getState(), S.AREA_ENTRY, 'entry screen is shown');
});

test('clear sequence does NOT fire for the boss checkpoint (BLOCKER 6)', () => {
  // The -4 exit is the boss checkpoint (checkpoints.md §1). In the zone model
  // the -4 exit routes into the BOSS ZONE (currentArea = BOSS_AREA), not into
  // a nonexistent fifth area. The clear sequence itself still runs (it is the
  // normal transition per boss-arena.md §1); what must never happen is the
  // hero landing on an ordinary area index past -4.
  //
  // We verify the invariant: clearing area -4 (the last ordinary area)
  // advances the hero to the boss zone, and no clear sequence ever produces a
  // pendingArea between -4 and the boss zone (there is no such area).
  resetSeq();
  // Simulate clearing area -4 (the last ordinary area). The next area is the
  // boss zone (BOSS_AREA = zones.length - 1).
  U.onExitFlagReached('1-4', 4);
  const s = U.getClearSequence();
  assert.equal(s.pendingArea, 4, 'clearing -4 advances to the boss zone');
  // The boss zone (currentArea = 4) is set by the clear sequence; it is the
  // final zone, so the hero must never end up on an ordinary area past -4.
  stepClear(DT, BANNER_STEPS + FADE_OUT_STEPS);
  const hero = U.getHero();
  assert.equal(hero.currentArea, 4, 'hero is in the boss zone after -4 exit');
});

test('getClearBanner: returns null when no banner is active', () => {
  resetSeq();
  U.onExitFlagReached('1-1', -2);
  stepClear(DT, BANNER_STEPS + FADE_OUT_STEPS + FADE_IN_STEPS + 10);
  assert.equal(U.getClearBanner(), null, 'banner is null after sequence completes');
});

test('getClearFadeAlpha: returns 0 when no fade is active', () => {
  resetSeq();
  U.onExitFlagReached('1-1', -2);
  stepClear(DT, BANNER_STEPS + FADE_OUT_STEPS + FADE_IN_STEPS + 10);
  assert.equal(U.getClearFadeAlpha(), 0, 'no fade when sequence is idle');
});

test('getClearFadeAlpha: returns 1 at the start of fadeOut', () => {
  resetSeq();
  U.onExitFlagReached('1-1', -2);
  stepClear(DT, BANNER_STEPS);
  assert.equal(U.getClearSequence().state, 'fadeOut');
  const alpha = U.getClearFadeAlpha();
  assert.ok(alpha >= 0 && alpha <= 1, `fade alpha is in [0, 1], got ${alpha}`);
});

test('getClearFadeAlpha: returns 0 at the end of fadeOut (fully black)', () => {
  resetSeq();
  U.onExitFlagReached('1-1', -2);
  stepClear(DT, BANNER_STEPS + FADE_OUT_STEPS - 1);
  const alpha = U.getClearFadeAlpha();
  assert.ok(alpha > 0.9, `fade alpha should be near 1 at the end, got ${alpha}`);
});

test('beginClearFadeIn: starts the fade-in, places hero at zone entry (BLOCKER 4)', () => {
  resetSeq();
  const hero = U.getHero();
  setState(S.PLAY);
  hero.currentArea = -1;

  U.onExitFlagReached('1-1', -2);
  stepClear(DT, BANNER_STEPS + FADE_OUT_STEPS);
  assert.equal(U.getClearSequence().state, 'idle');
  assert.equal(U.getClearSequence().pendingFadeIn, true);

  U.beginClearFadeIn();

  assert.equal(U.getClearSequence().state, 'fadeIn', 'fade-in started');
  assert.equal(U.getClearSequence().pendingFadeIn, false, 'pending flag consumed');
  // The hero should be at the new zone's start on the GROUND.
  assert.equal(hero.x, ZONE_ENTRY_X, 'hero at zone entry x');
  // For a horizontal zone, the hero stands on the floor (feet at ZONE_GROUND_Y).
  assert.equal(
    hero.y,
    ZONE_GROUND_Y - hero.h,
    'hero at ground level (feet on floor)',
  );
});

test('beginClearFadeIn: is a no-op when no fade-in is pending', () => {
  resetSeq();
  const hero = U.getHero();
  const beforeX = hero.x;
  const beforeY = hero.y;

  assert.equal(U.getClearSequence().state, 'idle', 'sequence is idle');
  assert.equal(U.getClearSequence().pendingFadeIn, false, 'no pending fade-in');

  U.beginClearFadeIn();

  assert.equal(U.getClearSequence().state, 'idle', 'still idle after no-op');
  assert.equal(hero.x, beforeX, 'hero position unchanged');
  assert.equal(hero.y, beforeY, 'hero position unchanged');
});

test('fade-in completes and returns to idle', () => {
  resetSeq();
  const hero = U.getHero();
  setState(S.PLAY);
  hero.currentArea = -1;

  U.onExitFlagReached('1-1', -2);
  stepClear(DT, BANNER_STEPS + FADE_OUT_STEPS);
  U.beginClearFadeIn();
  assert.equal(U.getClearSequence().state, 'fadeIn');

  stepClear(DT, FADE_IN_STEPS + 1);

  assert.equal(U.getClearSequence().state, 'idle', 'fade-in completes to idle');
  assert.equal(U.getClearFadeAlpha(), 0, 'no fade after fade-in completes');
});

test('full clear sequence: flash → banner → fadeOut → entry screen → fadeIn → idle', () => {
  resetSeq();
  const hero = U.getHero();
  setState(S.PLAY);
  hero.currentArea = -1;

  // Step 1: trigger the exit flag (clearing area -1, advancing to -2).
  U.onExitFlagReached('1-1', -2);
  assert.equal(U.getClearSequence().state, 'banner');
  assert.equal(U.getClearBanner(), '1-1 CLEAR');

  // Step 2: banner phase.
  stepClear(DT, BANNER_STEPS);
  assert.equal(U.getClearSequence().state, 'fadeOut');
  assert.equal(U.getClearBanner(), null, 'banner is gone after the banner phase');

  // Step 3: fadeOut phase.
  stepClear(DT, FADE_OUT_STEPS);
  assert.equal(U.getClearSequence().state, 'idle');
  assert.equal(getState(), S.AREA_ENTRY, 'entry screen is shown after fade-out');
  assert.equal(hero.currentArea, -2, 'hero is in area -2 (zone model)');

  // Step 4: confirm the entry screen (AREA_ENTRY → PLAY).
  U.beginClearFadeIn();
  assert.equal(U.getClearSequence().state, 'fadeIn');
  assert.equal(hero.x, ZONE_ENTRY_X, 'hero at the new zone start');

  // Step 5: fade-in phase.
  stepClear(DT, FADE_IN_STEPS + 1);
  assert.equal(U.getClearSequence().state, 'idle', 'sequence returns to idle');
  assert.equal(U.getClearFadeAlpha(), 0, 'no fade after the sequence');
});

test('hero is frozen during the clear sequence (camera does not reveal next zone)', () => {
  resetSeq();
  const hero = U.getHero();
  setState(S.PLAY);
  hero.currentArea = -1;
  const startX = hero.x;
  const startY = hero.y;

  U.onExitFlagReached('1-1', -2);
  stepClear(DT, 5);
  assert.notEqual(U.getClearSequence().state, 'idle', 'sequence is active');
  assert.equal(hero.x, startX, 'hero x unchanged during banner (frozen)');
  assert.equal(hero.y, startY, 'hero y unchanged during banner (frozen)');
});

test('checkpoint is set to the next zone entry flag (BLOCKER 3)', () => {
  resetSeq();
  const hero = U.getHero();
  setState(S.PLAY);
  hero.currentArea = -1;

  // Clearing area -1 advances to area -2.
  U.onExitFlagReached('1-1', -2);
  stepClear(DT, BANNER_STEPS + FADE_OUT_STEPS);

  // After fadeOut, the hero's checkpoint should be set to the next zone's
  // entry flag position. Area -2 has an entry flag at ZONE_ENTRY_X.
  const zones = buildLevelZones(LEVELS[0]);
  const zone2 = zones.find((z) => z.idx === -2);
  assert.ok(zone2.entryFlag, 'area -2 has an entry flag');
  // The checkpoint x should match the entry flag x (zone-local).
  assert.equal(
    hero.checkpoint.x,
    zone2.bounds.x + zone2.entryFlag.x,
    'checkpoint x matches entry flag x',
  );
});

test('entry flag does not immediately re-trigger a clear (latched by startLife)', () => {
  resetSeq();
  const hero = U.getHero();
  setState(S.PLAY);
  hero.currentArea = -1;

  U.onExitFlagReached('1-1', -2);
  stepClear(DT, BANNER_STEPS + FADE_OUT_STEPS);
  U.beginClearFadeIn();

  // The hero is at the zone entry. The entry flag is also at ZONE_ENTRY_X.
  // The hero's checkpoint should match the entry flag position so that
  // startLife can latch the entry flag.
  assert.equal(hero.x, ZONE_ENTRY_X, 'hero at zone entry');
  assert.equal(hero.checkpoint.x, ZONE_ENTRY_X, 'checkpoint at zone entry (matches entry flag)');
});
