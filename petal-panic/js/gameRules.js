// Petal Panic — global game rules (docs/levels/game-rules.md, lifecycle.md §1).
//
// These are the configurable global defaults for a new game. Individual
// levels do not redefine them; modules must read values from GAME_RULES
// instead of hardcoding literals.

export const GAME_RULES = Object.freeze({
  // A new game starts with 3 lives and 3 continues.
  startingLives: 3,
  startingContinues: 3,
  // Level reward screen awards one continue per full 1000 coins.
  // Global tuning value; may be reviewed later.
  coinsPerContinue: 1000,
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
