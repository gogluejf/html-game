// Petal Panic — global game rules (docs/levels/game-rules.md, lifecycle.md §1).
//
// These are the configurable global defaults for a new game. Individual
// levels do not redefine them; modules must read values from GAME_RULES
// instead of hardcoding literals.
//
// The coin/score accounting and inventory-persistence policies (game-rules.md
// §2/§4/§5) are the design-plan decisions the docs defer to the plan. Their
// concrete values live in the single TUNING block (tuning.js) and are
// re-exported here so the lifecycle/reward systems read the settled policy
// from one owner (GAME_RULES) rather than a scattered literal.

import { TUNING_COINS, TUNING_INVENTORY } from './tuning.js';
import { WEAPON_THORN } from './hero.js';

export const GAME_RULES = Object.freeze({
  // A new game starts with 3 lives and 3 continues.
  startingLives: 3,
  startingContinues: 3,
  // Level reward screen awards one continue per full 1000 coins.
  // Global tuning value; may be reviewed later.
  coinsPerContinue: 1000,

  // --- Coin / reward accounting (game-rules.md §2, §4) ---------------------
  // Settled design-plan decisions. The reward counts only the coins collected
  // in the just-cleared level; the remainder below 1000 does not carry, failed
  // attempts do not count, and a Continue resets the current level's tally.
  coins: Object.freeze({
    // Remainder below 1000 does NOT carry between levels (game-rules.md §2).
    carryoverRemainder: TUNING_COINS.carryoverRemainder,
    // Coins on failed area attempts do NOT count toward the reward (§2).
    countFailedAttempts: TUNING_COINS.countFailedAttempts,
    // A Continue resets the current level's coin tally (§2).
    resetOnContinue: TUNING_COINS.resetOnContinue,
    // Converted 1000-coin chunks are MARKED REWARDED, not deducted from a
    // spendable balance (§2). Coins stay in the displayed tally; only the
    // full chunks credit continues.
    convertedCoins: TUNING_COINS.convertedCoins,
    // Score/kill/coin accounting rolls back to the area's entry totals on a
    // failed attempt — repeatable pickups can't be farmed (§4).
    accountingOnFailure: TUNING_COINS.accountingOnFailure,
  }),

  // --- Inventory persistence (game-rules.md §5) ----------------------------
  // How ammo / weapon / energy / temporary powerups / super meter behave across
  // death, continue, and area advance. 'reset' = cleared to baseline;
  // 'restore' = restored to the hero's full baseline (energy).
  inventory: Object.freeze({
    ammo: TUNING_INVENTORY.ammo,
    weapon: TUNING_INVENTORY.weapon,
    energy: TUNING_INVENTORY.energy,
    powerups: TUNING_INVENTORY.powerups,
    superMeter: TUNING_INVENTORY.superMeter,
  }),
});

// The continue pool is a remaining balance shared across the game, not a
// fixed maximum: additional continues can be earned (e.g. from level rewards).
export function createContinuePool(starting = GAME_RULES.startingContinues) {
  return { remaining: starting };
}

export function canSpend(pool) {
  return pool.remaining > 0;
}

// Consume exactly one continue. No-op when the pool is empty — with no
// continues remaining, Continue cannot be activated. Never goes negative.
export function spend(pool) {
  if (pool.remaining > 0) pool.remaining -= 1;
  return pool.remaining;
}

// Grow the pool by n (e.g. continues earned from level rewards).
export function credit(pool, n) {
  pool.remaining += n;
  return pool.remaining;
}

/**
 * Reset the current level's coin tally (game-rules.md §2). Called on a new
 * level and on a Continue so the just-cleared level's coins are not
 * double-counted and a continue does not carry the failed tally forward.
 *
 * @param {object} h the hero (owns runStats.coinsCollected)
 */
export function resetLevelCoinTally(h) {
  const coins = h.runStats?.coinsCollected;
  if (coins) {
    coins.bronze = 0;
    coins.silver = 0;
    coins.gold = 0;
    coins.total = 0;
  }
}

/**
 * Restore the hero's inventory to baseline (game-rules.md §5). Called on a
 * new area, on death, and on continue so temporary powerups, a charged super
 * meter, and drained energy do not leak into the fresh attempt. Energy is
 * restored to full (TUNING_INVENTORY.energy = 'restore'); the rest are reset
 * to baseline.
 *
 * @param {Hero} h the hero
 */
export function resetHeroInventory(h) {
  // Energy: restored to full (the existing resetHeroTransient already does
  // this; re-asserted here so the policy is explicit and single-owned).
  if (h.maxEnergy !== undefined) h.energy = h.maxEnergy;
  // Temporary powerups: do not persist across death/continue (game-rules.md
  // §5). Clear any active temporary-powerup state.
  if (h.shield !== undefined) h.shield = 0;
  // Super meter: reset to 0 (a fresh attempt starts with no charged super).
  if (h.supermoveMeter !== undefined) h.supermoveMeter = 0;
  // Ammo: reset to the hero's baseline (game-rules.md §5 — ammo does not
  // persist into the fresh attempt). The baseline is the constructor value
  // (hero.js: this.ammo = 200); a fresh attempt starts with the full baseline
  // rather than whatever the failed attempt drained or a powerup granted.
  if (h.ammo !== undefined) h.ammo = 200;
  // Special ammo: reset to 0 (hero.js baseline — a fresh run starts with no
  // special ammo; the powerup system grants it during a run).
  if (h.specialAmmo !== undefined) h.specialAmmo = 0;
  // Selected weapon: reset to the hero's default (hero.js baseline:
  // WEAPON_THORN). A fresh attempt does not carry the previous attempt's
  // weapon selection (game-rules.md §5 — selected weapon resets).
  if (h.selectedWeapon !== undefined) h.selectedWeapon = WEAPON_THORN;
  // Temporary rapid-fire state: cleared (game-rules.md §5 — temporary
  // powerups do not persist). The rapid-fire window is a labeled timer; a
  // fresh attempt starts with none active.
  if (h.timers && typeof h.timers.clear === 'function') h.timers.clear('rapid');
}
