// Petal Panic — Level configurations (pure data).
//
// Each entry is the COMPLETE config the generator consumes for one level:
// boss, vertical slot, macro difficulty weights, and length budgets. No logic,
// no rendering — the engine reads this, nothing here knows about the game.
//
// Source of truth for Level 1: docs/story/levels.md ("Level 1 — Big Top").
// Levels 2–8: docs/story/levels.md (Carnival Night, Wild Menagerie, Pirate
// Show, Freakshow, Runaway Train, Veggie City, Carrot Palace). The story doc
// names each level and its boss; the per-level enemy rosters are TUNING work
// (generation.md §5b: "early configs may reuse existing enemy types as
// placeholders and be tuned later"). All eight levels reuse the six existing
// enemy types (stats.js ENEMY_KEYS) as placeholders.
//
// POPULATION: there are NO per-stage quantity budgets anymore
// (placeholder-typed-spawn plan, task 2.2). The authored macro placements ARE
// the population spec — each placeholder declares 'random' or a specific type
// id from its family registry, and the composer (populateArea in macros.js)
// spawns exactly that. What remains here is only the non-quantity tuning:
//
// SCHEMA:
//   macroWeights   (optional)     : { tier: number }  — macro DIFFICULTY weights
//
// macroWeights biases WHICH MACRO DIFFICULTY FILLs a slot (generation.md §5:
// "Patterns are grouped or weighted by challenge so progression is deliberate").
// The four tiers map to the 1 through 4 progression (generation.md §5):
//   tier 'easy'   — fewer blocks/platforms, simpler arrangements (area 1)
//   tier 'medium' — increased combinations, more climbing/crossing (2)
//   tier 'hard'   — denser obstacles, more substantial set pieces (3)
//   tier 'brutal' — strongest permitted combinations, harder elevated routes (4)
// Later levels weight harder tiers more heavily (generation.md §5b: "Macro
// intensity: later levels weight harder macro families and denser set pieces
// within the same 1 to 4 curve"). macroWeights is a SEPARATE concern that
// biases which difficulty tier fills a slot.
//
// Adding a Level 9 requires only a new array entry below.
//
// Length budgets reference the zone constants in level.js (single source of
// truth) rather than re-declaring the pixel literals.
//
// NOTE: importing level.js here is safe — level.js's top level only builds
// declarative zone data (no runtime/DOM), so there is no circular-initialization
// problem.
//
// DESIGN-PLAN DECISIONS SETTLED HERE (concrete values, one place to review):
//   - Area lengths in px (structure.md §6, generation.md §7): the concrete
//     horizontal (4000px) and vertical (2700px) area length budgets.
//   - Vertical slot (structure.md §1): which ordinary area is the vertical
//     climb, fixed per level (`verticalArea`).
//   - Stage weights (generation.md §5): the per-stage difficulty-tier
//     selection weights that bias WHICH macro difficulty fills a slot
//     (`macroWeights`).
//
// TENSION CURVE ACROSS LEVELS (generation.md §5b):
//   - Macro intensity: later levels weight harder macro families more heavily
//     (the brutal-tier weight strictly increases from index 1 → 8).
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

/**
 * Build the macro difficulty weights for a level given a tension index (1–8).
 *
 * The four tiers map to the 1 through 4 progression (generation.md §5):
 *   'easy'   — fewer blocks/platforms, simpler arrangements (area 1)
 *   'medium' — increased combinations, more climbing/crossing (2)
 *   'hard'   — denser obstacles, more substantial set pieces (3)
 *   'brutal' — strongest permitted combinations, harder elevated routes (4)
 *
 * Later levels weight harder tiers more heavily (generation.md §5b: "Macro
 * intensity: later levels weight harder macro families and denser set pieces
 * within the same 1 to 4 curve"). The brutal-tier weight strictly increases
 * from index 1 → 8.
 *
 * @param {number} tension 1–8 (the level index; higher = harder)
 * @returns {object} { easy: number, medium: number, hard: number, brutal: number }
 */
function buildMacroWeights(tension) {
  // The tier weights are LINEAR in tension and clamped at zero:
  // easy:   max(0, 7 - tension) → 6,5,4,3,2,1,0,0 (falls as tension rises)
  // medium: max(0, 6 - tension) → 5,4,3,2,1,0,0,0
  // hard:   1 + tension         → 2,3,4,5,6,7,8,9 (rises)
  // brutal: tension             → 1,2,3,4,5,6,7,8 (rises strictly)
  // Note: Level 1's weights are hand-tuned in its config entry
  // ({ easy: 7, medium: 5, hard: 2, brutal: 1 }) — the easy=7 there keeps
  // Level 1 distinctly easier than Level 2's derived easy=5.
  const easy = Math.max(0, 7 - tension);
  const medium = Math.max(0, 6 - tension);
  const hard = 1 + tension;
  const brutal = tension;
  return { easy, medium, hard, brutal };
}

// The zone-model currentArea value that maps to the boss zone (zone[4]).
// AREA indices are positive (1..4 for the ordinary areas), so the boss zone
// gets its own constant AFTER them (5) — it must not collide with area 4.
// Canonical home: this pure data module is the lowest common ancestor of
// every consumer (lifecycle.js, ui/levelSelectModel.js, systems/update.js all
// import levelConfigs.js directly, while update.js also imports lifecycle.js —
// so re-exporting from either of those would create a cycle). update.js and
// ui/levelSelectModel.js keep their own `export const AREA_BOSS = 5` lines as
// compatibility shims; they must stay in sync with this value.
export const AREA_BOSS = 5;

export const LEVEL_CONFIGS = [
  // -----------------------------------------------------------------------
  // Level 1 — Big Top (docs/story/levels.md)
  //
  // NOTE: `LEVELS[0].name` in level.js is 'Big Top' — the same string used
  // here. Both names come from the authoritative story doc ("Level 1 — Big
  // Top"); the two must stay in sync.
  // -----------------------------------------------------------------------
  {
    name: 'Big Top',
    index: 1,
    // NOTE: boss.js currently defines the boss with id 'elephant' ("Overgrown
    // Elephant"), but the authoritative story doc (docs/story/levels.md) names
    // this boss "Tusko Wobble". We keep 'tusko_wobble' here as the source of
    // truth; boss.js must be updated to use this id when the generator wires
    // the boss in (task 7.1).
    boss: 'tusko_wobble',
    // Nostalgic big-top warmth turning unsettling.
    vibe: 'nostalgic big-top warmth turning unsettling',

    // Which ordinary area (2, 3, or 4) is the vertical climb.
    // Exactly one of the four ordinary areas is vertical; it is fixed per
    // level. 1 is never vertical (structure.md §1).
    verticalArea: 3,

    // -----------------------------------------------------------------------
    // Enemy TYPE selection weights (populate.md §4). These weights only bias
    // WHICH type fills a given slot. Flat { type: number } map matching the
    // resolver's expected shape (NOT nested { type: {weight} }).
    //
    // Roster (docs/story/levels.md): Jester, Jack-O-Lantern, Vine Hound, Boris
    // Loon babies. Stage progression: 1 is the intro (fewer, easier), 4 is
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
    // their selection weights). These weights only bias WHICH type fills a
    // given slot. Flat { type: number } map (NOT nested { type: {weight} }).
    // -----------------------------------------------------------------------
    powerupWeights: {
      specialDrop:   4,
      rapid:         3,
      shield:        3,
      energy:        2,
      invincibility: 1,
      clear:         1,
      oneUp:         0.5,
    },

    // -----------------------------------------------------------------------
    // Macro difficulty weights (generation.md §5 — "Patterns are grouped or
    // weighted by challenge so progression is deliberate"). The four tiers
    // map to the 1 through 4 progression. Level 1 is the easiest level:
    // the easy tier is weighted most heavily, the brutal tier least.
    // -----------------------------------------------------------------------
    macroWeights: { easy: 7, medium: 5, hard: 2, brutal: 1 },

    // -----------------------------------------------------------------------
    // Length budgets — CONCRETE design-plan values (structure.md §6 "Art and
    // length", generation.md §7 "Tuning boundary").
    //   horizontal: ~2x the ~2000px prototype segment = 4000px (the measured
    //     baseline the docs require before selecting exact dimensions).
    //   vertical:   5 screens tall (VIEW_H × 5 = 2700px), tuned separately
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
  // -----------------------------------------------------------------------
  // Level 2 — Carnival Night (docs/story/levels.md)
  //
  // Boss: Grim Vertigo (the corrupted carousel).
  // Vibe: Magical midnight carnival becoming increasingly surreal.
  // Roster: adds boris_loon (the "unsettling" addition) to the Level 1 roster.
  // -----------------------------------------------------------------------
  {
    name: 'Carnival Night',
    index: 2,
    boss: 'grim_vertigo',
    vibe: 'magical midnight carnival becoming increasingly surreal',
    verticalArea: 2,
    enemyWeights: {
      jester:          5,
      jackolantern:    4,
      vine_hound:      4,
      boris_loon:      3,
      boris_loon_baby: 5,
    },
    powerupWeights: {
      rapid:         3,
      shield:        2,
      energy:        1,
      invincibility: 1,
      clear:         1,
      oneUp:         0.5,
    },
    macroWeights: buildMacroWeights(2),
    lengths: { horizontal: ZONE_WIDTH_HORIZONTAL, vertical: ZONE_H_VERTICAL },
  },
  // -----------------------------------------------------------------------
  // Level 3 — Wild Menagerie (docs/story/levels.md)
  //
  // Boss: The Great Maraboo (ruler of the abandoned menagerie).
  // Vibe: Exotic circus wilderness. Adventurous and mysterious.
  // Roster: adds violetta_marionetta (the marionette) to the Level 2 roster.
  // -----------------------------------------------------------------------
  {
    name: 'Wild Menagerie',
    index: 3,
    boss: 'great_maraboo',
    vibe: 'exotic circus wilderness, adventurous and mysterious',
    verticalArea: 3,
    enemyWeights: {
      jester:          4,
      jackolantern:    4,
      vine_hound:      5,
      boris_loon:      4,
      boris_loon_baby: 5,
      violetta_marionetta: 3,
    },
    powerupWeights: {
      rapid:         3,
      shield:        2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    macroWeights: buildMacroWeights(3),
    lengths: { horizontal: ZONE_WIDTH_HORIZONTAL, vertical: ZONE_H_VERTICAL },
  },
  // -----------------------------------------------------------------------
  // Level 4 — Pirate Show (docs/story/levels.md)
  //
  // Boss: Ratchet Rumbelow (the pirate circus ship).
  // Vibe: Grand theatrical pirate adventure becoming a real ocean voyage.
  // Roster: all six enemy types (full roster).
  // -----------------------------------------------------------------------
  {
    name: 'Pirate Show',
    index: 4,
    boss: 'ratchet_rumbelow',
    vibe: 'grand theatrical pirate adventure, stormy and dangerous',
    verticalArea: 4,
    enemyWeights: {
      jester:          4,
      jackolantern:    5,
      vine_hound:      5,
      boris_loon:      4,
      boris_loon_baby: 5,
      violetta_marionetta: 4,
    },
    powerupWeights: {
      rapid:         3,
      shield:        2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    macroWeights: buildMacroWeights(4),
    lengths: { horizontal: ZONE_WIDTH_HORIZONTAL, vertical: ZONE_H_VERTICAL },
  },
  // -----------------------------------------------------------------------
  // Level 5 — Freakshow (docs/story/levels.md)
  //
  // Boss: Pizza Cat (the star attraction of the Freakshow).
  // Vibe: Spooky, grotesque and funny. A vintage sideshow nightmare.
  // Roster: all six enemy types.
  // -----------------------------------------------------------------------
  {
    name: 'Freakshow',
    index: 5,
    boss: 'pizza_cat',
    vibe: 'spooky, grotesque and funny sideshow nightmare',
    verticalArea: 2,
    enemyWeights: {
      jester:          3,
      jackolantern:    5,
      vine_hound:      5,
      boris_loon:      5,
      boris_loon_baby: 6,
      violetta_marionetta: 5,
    },
    powerupWeights: {
      rapid:         2,
      shield:        2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    macroWeights: buildMacroWeights(5),
    lengths: { horizontal: ZONE_WIDTH_HORIZONTAL, vertical: ZONE_H_VERTICAL },
  },
  // -----------------------------------------------------------------------
  // Level 6 — Runaway Train (docs/story/levels.md)
  //
  // Boss: Ironhoof (the runaway locomotive).
  // Vibe: Relentless forward motion. Fast, exhilarating, out of control.
  // Roster: all six enemy types.
  // -----------------------------------------------------------------------
  {
    name: 'Runaway Train',
    index: 6,
    boss: 'ironhoof',
    vibe: 'relentless forward motion, fast and out of control',
    verticalArea: 3,
    enemyWeights: {
      jester:          3,
      jackolantern:    5,
      vine_hound:      6,
      boris_loon:      5,
      boris_loon_baby: 6,
      violetta_marionetta: 5,
    },
    powerupWeights: {
      rapid:         2,
      shield:        2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    macroWeights: buildMacroWeights(6),
    lengths: { horizontal: ZONE_WIDTH_HORIZONTAL, vertical: ZONE_H_VERTICAL },
  },
  // -----------------------------------------------------------------------
  // Level 7 — Veggie City (docs/story/levels.md)
  //
  // Boss: Madame Beetroot (the glamorous and unsettling diva).
  // Vibe: Beautiful, absurd and slightly spooky vegetable metropolis.
  // Roster: all six enemy types.
  // -----------------------------------------------------------------------
  {
    name: 'Veggie City',
    index: 7,
    boss: 'madame_beetroot',
    vibe: 'beautiful, absurd and slightly spooky vegetable metropolis',
    verticalArea: 4,
    enemyWeights: {
      jester:          3,
      jackolantern:    5,
      vine_hound:      6,
      boris_loon:      6,
      boris_loon_baby: 6,
      violetta_marionetta: 6,
    },
    powerupWeights: {
      rapid:         2,
      shield:        2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    macroWeights: buildMacroWeights(7),
    lengths: { horizontal: ZONE_WIDTH_HORIZONTAL, vertical: ZONE_H_VERTICAL },
  },
  // -----------------------------------------------------------------------
  // Level 8 — Carrot Palace (docs/story/levels.md)
  //
  // Boss: Colonel Carrot (the figure behind it all — the final boss).
  // Vibe: Monumental, theatrical and completely excessive. The absurdity of
  // the entire journey reaches its peak.
  // Roster: all six enemy types (full roster, hardest level).
  // -----------------------------------------------------------------------
  {
    name: 'Carrot Palace',
    index: 8,
    boss: 'colonel_carrot',
    vibe: 'monumental, theatrical and completely excessive',
    verticalArea: 2,
    enemyWeights: {
      jester:          3,
      jackolantern:    5,
      vine_hound:      6,
      boris_loon:      6,
      boris_loon_baby: 7,
      violetta_marionetta: 6,
    },
    powerupWeights: {
      rapid:         2,
      shield:        2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    macroWeights: buildMacroWeights(8),
    lengths: { horizontal: ZONE_WIDTH_HORIZONTAL, vertical: ZONE_H_VERTICAL },
  },
];

/**
 * Get the config for a given level index.
 * @param {number} index the level number (1-based)
 * @returns {object|undefined} the level config or undefined
 */
export function getLevelConfig(index) {
  return LEVEL_CONFIGS.find((c) => c.index === index);
}
