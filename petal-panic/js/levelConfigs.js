// Petal Panic — Level configurations (pure data).
//
// Each entry is the COMPLETE config the generator consumes for one level:
// per-stage budgets (the enemy/powerup/barrel QUANTITIES), optional type
// selection weights, boss, vertical slot, and length budgets. No logic, no
// rendering — the engine reads this, nothing here knows about the game.
//
// Source of truth for Level 1: docs/story/levels.md ("Level 1 — The Circus").
// Budget semantics: docs/levels/populate.md §1 — quantity budgets vs placement
// chances. Budgets here are PER-STAGE (per-area), not per-level totals, so a
// level-wide quantity is never mistakenly repeated in every area.
//
// SCHEMA (must match the resolver `populateArea` in macros.js):
//   stageBudgets[stage].enemies   : { type: count }   — QUANTITY budget per type
//   stageBudgets[stage].powerups  : { type: count }   — QUANTITY budget per type
//   stageBudgets[stage].barrels   : { type: count }   — QUANTITY budget per type
//   enemyWeights   (optional)     : { type: number }  — TYPE selection weights
//   powerupWeights (optional)     : { type: number }  — TYPE selection weights
//
// The per-stage counts ARE the enemy/powerup selection (populate.md §1: the
// quantity budget). The *_weights fields are a separate, OPTIONAL concern:
// they only bias WHICH type fills a given slot, never how many of each type
// appear (that is fixed by the per-stage counts). They are flat { type: number }
// maps — NOT nested { type: { weight } } — to match the resolver's expected
// shape. A top-level `enemies` weight block was removed: it duplicated the
// per-stage counts and was incompatible with the resolver's { type: count }
// schema (it would break if passed to `populateArea`).
//
// Adding a Level 2 requires only a new array entry below.
//
// Length budgets reference the zone constants in level.js (single source of
// truth) rather than re-declaring the pixel literals.
//
// NOTE: importing level.js here is safe — level.js's top level only builds
// declarative zone data from LEVEL_CONFIGS (no runtime/DOM), so there is no
// circular-initialization problem.
//
// DESIGN-PLAN DECISIONS SETTLED HERE (concrete values, one place to review):
//   - Area lengths in px (structure.md §6, generation.md §7): the concrete
//     horizontal (4000px) and vertical (1620px) area length budgets.
//   - Population budgets per stage (populate.md §1): the concrete per-stage
//     enemy/barrel/powerup QUANTITY budgets in `stageBudgets` below.
//   - Vertical slot (structure.md §1): which ordinary area is the vertical
//     climb, fixed per level (`verticalArea`).
//   - Stage weights (generation.md §5): the per-stage difficulty-tier
//     selection weights that bias WHICH macro difficulty fills a slot.
//
// OWNERSHIP SPLIT (task 7.2 tuning pass): this file is the owner for PER-LEVEL
// values (the ones above) because they vary by level. The GLOBAL, cross-level
// values (transition timings, boss-intro timings, coin/inventory policy,
// camera/scroll policy, music policy) are owned by the TUNING block
// (tuning.js). Coin carryover / inventory persistence (game-rules.md §2/§5)
// are NOT level-specific — the global policy lives in GAME_RULES
// (gameRules.js), sourced from the TUNING block (tuning.js). Levels do not
// redefine it.

import { ZONE_WIDTH_HORIZONTAL, ZONE_H_VERTICAL } from './level.js';

export const LEVEL_CONFIGS = [
  {
    // -----------------------------------------------------------------------
    // Level 1 — The Circus (docs/story/levels.md)
    //
    // NOTE: the legacy `LEVELS[0].name` in level.js is 'Big Top' — that string
    // is DEPRECATED. 'The Circus' is the authoritative Level 1 name (it matches
    // docs/story/levels.md); the legacy name should be removed when the old
    // LEVELS definition is retired.
    // -----------------------------------------------------------------------
    name: 'The Circus',
    index: 1,
    // NOTE: boss.js currently defines the boss with id 'elephant' ("Overgrown
    // Elephant"), but the authoritative story doc (docs/story/levels.md) names
    // this boss "Tusko Wobble". We keep 'tusko_wobble' here as the source of
    // truth; boss.js must be updated to use this id when the generator wires
    // the boss in (task 7.1).
    boss: 'tusko_wobble',
    // Nostalgic big-top warmth turning unsettling.
    vibe: 'nostalgic big-top warmth turning unsettling',

    // Which ordinary area (-2, -3, or -4) is the vertical climb.
    // Exactly one of the four ordinary areas is vertical; it is fixed per
    // level. -1 is never vertical (structure.md §1).
    verticalArea: -3,

    // -----------------------------------------------------------------------
    // Enemy TYPE selection weights (populate.md §4 — separate from the
    // QUANTITY budget). The per-stage counts in stageBudgets below are the
    // authoritative enemy selection (how many of each type appear); these
    // weights only bias WHICH type fills a given slot. Flat { type: number }
    // map matching the resolver's expected shape (NOT nested { type: {weight} }).
    //
    // Roster (docs/story/levels.md): Jester, Jack-O-Lantern, Vine Hound, Boris
    // Loon babies. Stage progression: -1 is the intro (fewer, easier), -4 is
    // the hardest before the boss; the mix shifts from Jester-dominant
    // (playful) toward more Boris Loon babies (unsettling) as it progresses.
    // -----------------------------------------------------------------------
    enemyWeights: {
      jester:          5,  // playful opener, present all stages
      jackolantern:    3,  // mid-level threat
      vine_hound:      3,  // ground chaser
      boris_loon_baby: 4,  // the "unsettling" addition
    },

    // -----------------------------------------------------------------------
    // Powerup TYPE selection weights (populate.md §2 — eligible types and
    // their selection weights, separate from the QUANTITY budget). The
    // per-stage counts in stageBudgets below fix how many of each type appear;
    // these weights only bias WHICH type fills a given slot. Flat
    // { type: number } map (NOT nested { type: {weight} }).
    // -----------------------------------------------------------------------
    powerupWeights: {
      ammo:          5,
      rapid:         3,
      shield:        3,
      special:       2,
      energy:        2,
      invincibility: 1,
      clear:         1,
      oneUp:         0.5,
    },

    // -----------------------------------------------------------------------
    // Per-stage budgets — CONCRETE design-plan values (populate.md §1: "the
    // matrix must make that scope explicit so a level-wide quantity is not
    // mistakenly repeated in every area"). Each stage (-1 through -4) gets
    // its own QUANTITY budget (how many of each type appear). These are the
    // concrete per-stage population budgets the doc defers to the plan; the
    // progression -1 (sparse) → -4 (dense) is visible in the counts.
    //
    // The boss zone is NOT budgeted here — it is a separate self-contained
    // arena with its own rules (structure.md §2).
    // -----------------------------------------------------------------------
    stageBudgets: {
      '-1': {
        // Intro: sparse, forgiving. Mostly Jesters, few barrels.
        enemies: { jester: 3, jackolantern: 0, vine_hound: 1, boris_loon_baby: 0 },
        barrels: { explosive: 2, wood: 1, coin: 1 },
        powerups: { ammo: 1, rapid: 1, shield: 0, special: 0, energy: 0, invincibility: 0, clear: 0, oneUp: 0 },
      },
      '-2': {
        // Building: introduce Jack-O-Lantern and Boris babies.
        enemies: { jester: 3, jackolantern: 2, vine_hound: 2, boris_loon_baby: 1 },
        barrels: { explosive: 3, wood: 2, coin: 2 },
        powerups: { ammo: 1, rapid: 1, shield: 1, special: 0, energy: 0, invincibility: 0, clear: 0, oneUp: 0 },
      },
      '-3': {
        // Vertical climb: moderate density, the "unsettling" shift.
        enemies: { jester: 2, jackolantern: 2, vine_hound: 2, boris_loon_baby: 3 },
        barrels: { explosive: 3, wood: 2, coin: 2 },
        powerups: { ammo: 1, rapid: 1, shield: 1, special: 1, energy: 0, invincibility: 0, clear: 0, oneUp: 0 },
      },
      '-4': {
        // Pre-boss: dense, all enemy types present.
        enemies: { jester: 3, jackolantern: 3, vine_hound: 3, boris_loon_baby: 4 },
        barrels: { explosive: 4, wood: 2, coin: 3 },
        powerups: { ammo: 1, rapid: 1, shield: 1, special: 1, energy: 1, invincibility: 0, clear: 1, oneUp: 0 },
      },
    },

    // -----------------------------------------------------------------------
    // Length budgets — CONCRETE design-plan values (structure.md §6 "Art and
    // length", generation.md §7 "Tuning boundary").
    //   horizontal: ~2x the ~2000px prototype segment = 4000px (the measured
    //     baseline the docs require before selecting exact dimensions).
    //   vertical:   ~3 screens tall (VIEW_H × 3 = 1620px), tuned separately
    //     rather than blindly doubled (structure.md §6).
    // These are the CONFIG-LEVEL budgets the composer receives; they are
    // fixed per area (not rolled per game).
    //
    // We IMPORT these from level.js rather than re-declaring the literals, so
    // the single source of truth is the zone constants in level.js.
    // -----------------------------------------------------------------------
    lengths: {
      horizontal: ZONE_WIDTH_HORIZONTAL,  // px — target width of a horizontal area
      vertical:   ZONE_H_VERTICAL,        // px — target height of the vertical climb
    },
  },
  // Level 2+ entries go here. Each is a self-contained object; the engine
  // iterates LEVEL_CONFIGS and builds zones from each entry.
];

/**
 * Get the config for a given level index.
 * @param {number} index the level number (1-based)
 * @returns {object|undefined} the level config or undefined
 */
export function getLevelConfig(index) {
  return LEVEL_CONFIGS.find((c) => c.index === index);
}

/**
 * Get the per-stage budget for a level and stage.
 * @param {object} config a level config entry
 * @param {number} stage the area index (-1 to -4)
 * @returns {object|null} the stage budget or null if the stage has none
 */
export function getStageBudget(config, stage) {
  return config.stageBudgets[String(stage)] ?? null;
}
