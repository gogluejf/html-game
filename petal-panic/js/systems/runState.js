// Petal Panic — Run state (zone-entry-unification plan, Step 2).
//
// A Run is the persistent game identity: which hero, which world, where in
// the level, how many lives/continues remain, the wallet (farmable resources),
// the zone-snapshot chain (anti-farming rollback), and the append-only trace
// (score telemetry).
//
// This object SURVIVES death, continue, and save/load. It does NOT include
// attempt-state (energy, weapon, position) — that belongs to Life.

import { GAME_RULES, createContinuePool } from './gameRules.js';
import { createTrace } from '../stats.js';

/**
 * Create a fresh Run state for a new game.
 * @param {string} heroId the hero's definition id ('scarlet', 'balthazar', ...)
 * @param {number} seed the world generation seed
 * @returns {object} the Run state
 */
export function createRun(heroId, seed) {
  return {
    heroId,
    seed,
    level: 1,
    area: 1,
    lives: GAME_RULES.startingLives,
    continues: createContinuePool(GAME_RULES.startingContinues),
    wallet: {
      current: { coins: 0, kills: 0 },
      snapshots: {},
    },
    trace: createTrace(),
  };
}

/**
 * Serialize a Run for saving (Save & Quit / autosave).
 * Returns a plain JSON-safe object.
 * @param {object} run
 * @returns {object}
 */
export function serializeRun(run) {
  return {
    heroId: run.heroId,
    seed: run.seed,
    level: run.level,
    area: run.area,
    lives: run.lives,
    continues: run.continues?.remaining ?? 0,
    wallet: structuredClone(run.wallet),
    timestamp: Date.now(),
  };
}

/**
 * Deserialize a saved Run back into a live state object.
 * Tolerates missing/legacy fields (falls back to defaults).
 * @param {object} saved the serialized run (from saveMeta)
 * @returns {object} a Run state ready to use
 */
export function deserializeRun(saved) {
  const run = createRun(saved.heroId ?? 'scarlet', saved.seed ?? 1);
  if (Number.isInteger(saved.level)) run.level = saved.level;
  if (Number.isInteger(saved.area)) run.area = saved.area;
  if (Number.isInteger(saved.lives) && saved.lives >= 0) run.lives = saved.lives;
  if (Number.isInteger(saved.continues) && saved.continues >= 0 && run.continues) {
    run.continues.remaining = saved.continues;
  }
  if (saved.wallet && typeof saved.wallet === 'object') {
    if (saved.wallet.current) run.wallet.current = { ...saved.wallet.current };
    if (saved.wallet.snapshots) run.wallet.snapshots = { ...saved.wallet.snapshots };
  }
  return run;
}
