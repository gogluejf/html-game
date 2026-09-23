// Petal Panic — Level configurations (pure data).
//
// Each entry is the COMPLETE config the generator consumes for one level:
// per-stage budgets (the enemy/powerup/barrel QUANTITIES), optional type
// selection weights, boss, vertical slot, macro difficulty weights, and length
// budgets. No logic, no rendering — the engine reads this, nothing here knows
// about the game.
//
// Source of truth for Level 1: docs/story/levels.md ("Level 1 — Big Top").
// Levels 2–8: docs/story/levels.md (Carnival Night, Wild Menagerie, Pirate
// Show, Freakshow, Runaway Train, Veggie City, Carrot Palace). The story doc
// names each level and its boss; the per-level enemy rosters and concrete
// budgets for levels beyond the first are TUNING work (generation.md §5b:
// "early configs may reuse existing enemy types as placeholders and be tuned
// later"). All eight levels reuse the six existing enemy types (stats.js
// ENEMY_KEYS) as placeholders.
//
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
//   macroWeights   (optional)     : { tier: number }  — macro DIFFICULTY weights
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
// macroWeights biases WHICH MACRO DIFFICULTY FILLs a slot (generation.md §5:
// "Patterns are grouped or weighted by challenge so progression is deliberate").
// The four tiers map to the -1 through -4 progression (generation.md §5):
//   tier 'easy'   — fewer blocks/platforms, simpler arrangements (area -1)
//   tier 'medium' — increased combinations, more climbing/crossing (-2)
//   tier 'hard'   — denser obstacles, more substantial set pieces (-3)
//   tier 'brutal' — strongest permitted combinations, harder elevated routes (-4)
// Later levels weight harder tiers more heavily (generation.md §5b: "Macro
// intensity: later levels weight harder macro families and denser set pieces
// within the same -1 to -4 curve"). The per-stage budgets (stageBudgets) are
// the QUANTITY budget (how many enemies/powerups/barrels); macroWeights is a
// SEPARATE concern that biases which difficulty tier fills a slot.
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
//     horizontal (4000px) and vertical (1620px) area length budgets.
//   - Population budgets per stage (populate.md §1): the concrete per-stage
//     enemy/barrel/powerup QUANTITY budgets in `stageBudgets` below.
//   - Vertical slot (structure.md §1): which ordinary area is the vertical
//     climb, fixed per level (`verticalArea`).
//   - Stage weights (generation.md §5): the per-stage difficulty-tier
//     selection weights that bias WHICH macro difficulty fills a slot
//     (`macroWeights`).
//
// TENSION CURVE ACROSS LEVELS (generation.md §5b):
//   - Enemy pressure: rosters grow and per-stage enemy QUANTITIES rise per
//     level (total enemies per level strictly increases from index 1 → 8).
//   - Resource scarcity: powerup availability trends DOWN as levels progress
//     (total powerups per level strictly decreases from index 1 → 8).
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

// The six existing enemy types (must match stats.js ENEMY_KEYS). All eight
// levels reuse these as placeholders; the per-level roster (which types appear
// in the stage budgets) and the per-stage quantities are the tension knobs.
// (generation.md §5b: "Final enemy rosters for levels beyond the first are not
// yet decided; early configs may reuse existing enemy types as placeholders.")
//
// The per-level roster (the union of enemy type keys across all stage budgets)
// GROWS with level index: Level 1 has 4 types (the story-doc roster); Level 2
// adds boris_loon; Level 3 adds violetta_marionetta; Levels 4–8 use all six.
// The per-stage QUANTITIES rise monotonically across levels (total enemies per
// level strictly increases from index 1 → 8).
const ENEMY_TYPES = {
  jester: 9,   // playful opener — present in every level
  jackolantern: 7,  // mid-level threat — present in every level
  vine_hound: 7,    // ground chaser — present in every level
  boris_loon: 6,    // the "unsettling" addition (introduced in Level 2)
  boris_loon_baby: 8, // the "unsettling" babies (present from Level 1)
  violetta_marionetta: 5, // the marionette (introduced in Level 3)
};

// The eight powerup types (must match stats.js POWERUP_KEYS). The per-level
// per-stage QUANTITIES fall monotonically across levels (total powerups per
// level strictly decreases from index 1 → 8 — generation.md §5b "Resource
// scarcity: powerup availability trends down as levels progress").
const POWERUP_TYPES = {
  ammo: 1,
  rapid: 0,
  shield: 0,
  special: 0,
  energy: 0,
  invincibility: 0,
  clear: 0,
  oneUp: 0,
};

// Barrel types (must match macros.js barrel schema).
const BARREL_TYPES = {
  explosive: 3,
  wood: 2,
  coin: 2,
};

/**
 * Build the per-stage budgets for a level given a tension index (1–8).
 *
 * The tension index drives three knobs (generation.md §5b), all applied
 * MULTIPLICATIVELY to per-type base counts:
 *   - Enemy quantities rise: each type's base count is multiplied by
 *     `tension` (1..8) and by the stage multiplier.
 *   - Powerup availability falls: each type's base count is multiplied by
 *     `9 - tension` (8..1) and by the stage multiplier.
 *   - Barrel density rises: each type's base count is multiplied by
 *     `tension` (1..8) and by the stage multiplier.
 *
 * Per-type count = round(base * scale * stageMult), floored at 0. Roster
 * gating is applied after scaling (boris_loon from tension ≥ 2,
 * violetta_marionetta from tension ≥ 3), so early levels omit those types
 * regardless of the scale.
 *
 * The per-stage progression (-1 sparse → -4 dense) is preserved within each
 * level (populate.md §1: "the matrix must make that scope explicit so a
 * level-wide quantity is not mistakenly repeated in every area").
 *
 * @param {number} tension 1–8 (the level index; higher = harder)
 * @returns {object} stageBudgets: { '-1': {...}, '-2': {...}, '-3': {...}, '-4': {...} }
 */
function buildStageBudgets(tension) {
  // Tension scales the base per-stage counts multiplicatively. The scales are
  // tuned so that the per-stage progression (-1 → -4) is visible AND the
  // per-level totals (summed across stages) strictly increase (enemies/barrels)
  // or decrease (powerups) with tension.
  //
  // Enemy/barrel scaling: count = round(base * tension * stageMult).
  // Powerup scaling: count = round(base * (9 - tension) * stageMult) — the
  // inverse tension scale makes powerups strictly scarcer in later levels.
  //
  // Barrel scaling: count = round(base * tension * stageMult).
  const enemyScale = tension;        // 1..8 — multiplies the base enemy counts
  const powerupScale = 9 - tension;   // 8..1 — multiplies the base powerup counts (falls)
  const barrelScale = tension;        // 1..8 — multiplies the base barrel counts

  // Per-stage multipliers (the -1 → -4 progression within a level).
  // Enemy/barrel multipliers sum to 3.5 (sparse → dense).
  // Powerup multipliers sum to 1.8 (the scarcity curve: fewer powerups per
  // stage, still showing the -1 → -4 progression but at a lower absolute count).
  const enemyMults = { '-1': 0.5, '-2': 0.75, '-3': 1.0, '-4': 1.25 };
  const powerupMults = { '-1': 0.3, '-2': 0.4, '-3': 0.5, '-4': 0.6 };
  const barrelMults = { '-1': 0.5, '-2': 0.75, '-3': 1.0, '-4': 1.25 };

  const stages = {};
  for (const stage of ['-1', '-2', '-3', '-4']) {
    const eMult = enemyMults[stage];
    const pMult = powerupMults[stage];
    const bMult = barrelMults[stage];

    // Enemy counts: scale the base enemy counts by tension and stage.
    const enemies = {};
    for (const [type, base] of Object.entries(ENEMY_TYPES)) {
      // The roster grows with tension: boris_loon appears from tension ≥ 2,
      // violetta_marionetta from tension ≥ 3.
      let count = Math.round(base * enemyScale * eMult);
      if (type === 'boris_loon' && tension < 2) count = 0;
      if (type === 'violetta_marionetta' && tension < 3) count = 0;
      enemies[type] = Math.max(0, count);
    }

    // Powerup counts: scale the base powerup counts by (inverse) tension and stage.
    const powerups = {};
    for (const [type, base] of Object.entries(POWERUP_TYPES)) {
      let count = Math.round(base * powerupScale * pMult);
      powerups[type] = Math.max(0, count);
    }

    // Barrel counts: scale the base barrel counts by tension and stage.
    const barrels = {};
    for (const [type, base] of Object.entries(BARREL_TYPES)) {
      let count = Math.round(base * barrelScale * bMult);
      barrels[type] = Math.max(0, count);
    }

    stages[stage] = { enemies, barrels, powerups };
  }

  return stages;
}

/**
 * Build the macro difficulty weights for a level given a tension index (1–8).
 *
 * The four tiers map to the -1 through -4 progression (generation.md §5):
 *   'easy'   — fewer blocks/platforms, simpler arrangements (area -1)
 *   'medium' — increased combinations, more climbing/crossing (-2)
 *   'hard'   — denser obstacles, more substantial set pieces (-3)
 *   'brutal' — strongest permitted combinations, harder elevated routes (-4)
 *
 * Later levels weight harder tiers more heavily (generation.md §5b: "Macro
 * intensity: later levels weight harder macro families and denser set pieces
 * within the same -1 to -4 curve"). The brutal-tier weight strictly increases
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
    // Macro difficulty weights (generation.md §5 — "Patterns are grouped or
    // weighted by challenge so progression is deliberate"). The four tiers
    // map to the -1 through -4 progression. Level 1 is the easiest level:
    // the easy tier is weighted most heavily, the brutal tier least.
    // -----------------------------------------------------------------------
    macroWeights: { easy: 7, medium: 5, hard: 2, brutal: 1 },

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
    verticalArea: -2,
    enemyWeights: {
      jester:          5,
      jackolantern:    4,
      vine_hound:      4,
      boris_loon:      3,
      boris_loon_baby: 5,
    },
    powerupWeights: {
      ammo:          4,
      rapid:         3,
      shield:        2,
      special:       2,
      energy:        1,
      invincibility: 1,
      clear:         1,
      oneUp:         0.5,
    },
    stageBudgets: buildStageBudgets(2),
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
    verticalArea: -3,
    enemyWeights: {
      jester:          4,
      jackolantern:    4,
      vine_hound:      5,
      boris_loon:      4,
      boris_loon_baby: 5,
      violetta_marionetta: 3,
    },
    powerupWeights: {
      ammo:          4,
      rapid:         3,
      shield:        2,
      special:       2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    stageBudgets: buildStageBudgets(3),
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
    verticalArea: -4,
    enemyWeights: {
      jester:          4,
      jackolantern:    5,
      vine_hound:      5,
      boris_loon:      4,
      boris_loon_baby: 5,
      violetta_marionetta: 4,
    },
    powerupWeights: {
      ammo:          3,
      rapid:         3,
      shield:        2,
      special:       2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    stageBudgets: buildStageBudgets(4),
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
    verticalArea: -2,
    enemyWeights: {
      jester:          3,
      jackolantern:    5,
      vine_hound:      5,
      boris_loon:      5,
      boris_loon_baby: 6,
      violetta_marionetta: 5,
    },
    powerupWeights: {
      ammo:          3,
      rapid:         2,
      shield:        2,
      special:       2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    stageBudgets: buildStageBudgets(5),
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
    verticalArea: -3,
    enemyWeights: {
      jester:          3,
      jackolantern:    5,
      vine_hound:      6,
      boris_loon:      5,
      boris_loon_baby: 6,
      violetta_marionetta: 5,
    },
    powerupWeights: {
      ammo:          3,
      rapid:         2,
      shield:        2,
      special:       2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    stageBudgets: buildStageBudgets(6),
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
    verticalArea: -4,
    enemyWeights: {
      jester:          3,
      jackolantern:    5,
      vine_hound:      6,
      boris_loon:      6,
      boris_loon_baby: 6,
      violetta_marionetta: 6,
    },
    powerupWeights: {
      ammo:          3,
      rapid:         2,
      shield:        2,
      special:       2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    stageBudgets: buildStageBudgets(7),
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
    verticalArea: -2,
    enemyWeights: {
      jester:          3,
      jackolantern:    5,
      vine_hound:      6,
      boris_loon:      6,
      boris_loon_baby: 7,
      violetta_marionetta: 6,
    },
    powerupWeights: {
      ammo:          2,
      rapid:         2,
      shield:        2,
      special:       2,
      energy:        1,
      invincibility: 1,
      clear:         0.5,
      oneUp:         0.5,
    },
    stageBudgets: buildStageBudgets(8),
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

/**
 * Get the per-stage budget for a level and stage.
 * @param {object} config a level config entry
 * @param {number} stage the area index (-1 to -4)
 * @returns {object|null} the stage budget or null if the stage has none
 */
export function getStageBudget(config, stage) {
  return config.stageBudgets[String(stage)] ?? null;
}
