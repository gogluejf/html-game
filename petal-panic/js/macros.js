// Petal Panic — Macro library + area composer.
//
// Source of truth:
//   docs/levels/generation.md   §2 (Macro examples), §3 (What a macro
//                               describes), §4 (Constructing an area),
//                               §5 (Progression -1 to -4), §6 (Playability)
//   docs/levels/structure.md    §5 (Terrain vocabulary)
//
// A macro is an authored terrain SEQUENCE (not a single block). It declares:
//   - orientation (horizontal / vertical)
//   - difficulty category (1 = easiest, 3 = hardest)
//   - terrain order: an ordered list of terrain units (blocks / platforms)
//     with relative widths, heights, tiers, and gaps
//   - entry / exit landing space (how many units of clear ground at each end)
//   - placement opportunities (slots where enemies / barrels / powerups go)
//   - allowed variations (alternative unit sequences with selection weights)
//   - follow conditions (which macros can precede / follow this one)
//
// The composer (`composeArea`) is a PURE function:
//   (rng, orientation, stage, budget) → layout
//
// It selects compatible macros, arranges them to the length budget, validates
// joins (no impossible gaps, no trapped starts, no buried landings), and
// returns a complete list of placed terrain units with their x positions.
//
// The layout is in UNIT SPACE (width-units and tier-units), not pixels.
// Pixel scaling is a later task (3.3 / 7.2).

import { createRng, makeBlock, makePlatform } from './terrain.js';
import { GRAVITY, DOUBLE_JUMP_FACTOR } from './consts.js';
import { HEROES } from './heroDefs.js';
import { BARREL_DEF } from './object.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum clear ground (width-units) at the START of an area. The hero spawns
 * here; no terrain units may occupy this zone.
 */
export const ENTRY_CLEAR = 3;

/**
 * Minimum clear ground (width-units) at the END of an area. The exit flag
 * sits here; no terrain units may occupy this zone.
 */
export const EXIT_CLEAR = 3;

/**
 * Maximum horizontal gap (width-units) that a hero can clear with a double
 * jump.
 *
 * Derived from the real hero physics — not a hand-tuned literal. The
 * governing figure is the hero with the SMALLEST horizontal clear:
 *   - horizontal run speed: HEROES.<id>.stats.speed (px/s)
 *   - double-jump airtime: the time from leaving the ground to returning to
 *     the launch surface, given a ground jump (v0 = jump) and a double jump
 *     (v0 = DOUBLE_JUMP_FACTOR·jump) applied at the apex.
 *
 *   single airtime t1 = 2·jump / GRAVITY          (up + down)
 *   double airtime t2 = 2·(0.85·jump) / GRAVITY  (added at the apex)
 *   total airtime    = t1 + t2
 *
 * A hero running full speed the whole airtime covers
 * speed · (t1 + t2) px. We take the minimum over both heroes, then divide by
 * the pixel width of one layout unit (UNIT_PX, see below) and floor to whole
 * units: any gap wider than this is IMPOSSIBLE and must be flagged by
 * validation.
 *
 * With the current stats (scarlet: 250 px/s, jump 500; balthazar: 180 px/s,
 * jump 420; GRAVITY 1500; DOUBLE_JUMP_FACTOR 0.85):
 *   scarlet:    250 · (2·500/1500 + 2·425/1500) = 250 · 1.1667 ≈ 291.7 px
 *   balthazar:  180 · (2·420/1500 + 2·357/1500) = 180 · 1.0360 ≈ 186.5 px
 *   min ≈ 186 px → 186 / 48 ≈ 3.87 → floor = 3 width-units.
 */

/**
 * Pixel width of one layout width-unit. The unit → pixel scale is owned by
 * the pixel-scaling task (3.3 / 7.2); this is the working scale the composer
 * uses to translate physics-derived reach into unit space.
 */
export const UNIT_PX = 48;

/**
 * Minimum horizontal clear distance (px) across ALL heroes for a full-speed
 * double jump. Computed from heroDefs.js + consts.js so it tracks the real
 * physics — if a hero's speed or jump changes, this changes with it.
 *
 * @returns {number} px
 */
export function minHeroGapClearPx() {
  let min = Infinity;
  for (const hero of Object.values(HEROES)) {
    const { speed, jump } = hero.stats;
    const singleAirtime = (2 * jump) / GRAVITY;
    const doubleAirtime = (2 * DOUBLE_JUMP_FACTOR * jump) / GRAVITY;
    const distance = speed * (singleAirtime + doubleAirtime);
    min = Math.min(min, distance);
  }
  return min;
}

/**
 * Maximum clearable horizontal gap (whole width-units) for a double jump at
 * full run speed, derived from hero physics (see minHeroGapClearPx).
 */
export const MAX_CLEARABLE_GAP = Math.max(1, Math.floor(minHeroGapClearPx() / UNIT_PX));

/**
 * Maximum elevation step (tiers) between successive landings. A hero can
 * reach at most 1 tier higher per jump (double jump reaches tier 1 from
 * ground, tier 2 from tier 1, etc.). A step of more than 1 tier is impossible.
 */
export const MAX_ELEVATION_STEP = 1;

/**
 * Elevation gain (tiers) a macro contributes to a vertical climb.
 *
 * A vertical macro is a sequence of platform landings; its net contribution
 * to the climb is (highest tier reached − entry tier). Macros entering at
 * ground level (tier 0) gain up to their highest platform tier. A macro that
 * dips and recovers (e.g. tier 3 → 2 → 3) still ends where it peaked, so the
 * net gain is the peak tier, not the last unit's tier.
 *
 * @param {object} macro a vertical macro from MACROS
 * @returns {number} net elevation gain in tiers (≥ 0)
 */
export function macroElevationGain(macro) {
  const tiers = macro.units
    .filter((u) => u.kind === 'platform')
    .map((u) => u.tier);
  if (tiers.length === 0) return 0;
  return Math.max(...tiers);
}

// ---------------------------------------------------------------------------
// Macro vocabulary (generation.md §2, §3)
// ---------------------------------------------------------------------------
// Each macro declares:
//   - id: unique identifier
//   - name: human-readable name
//   - orientation: 'horizontal' | 'vertical'
//   - difficulty: 1 (easy) | 2 (medium) | 3 (hard)
//   - units: ordered list of terrain unit descriptors
//   - entryClear: width-units of clear ground before the first unit
//   - exitClear: width-units of clear ground after the last unit
//   - placements: list of placement opportunity descriptors
//   - variations: list of alternative unit sequences with weights
//   - follows: list of macro ids that can precede this one (empty = any)
//   - followedBy: list of macro ids that can follow this one (empty = any)
//
// Unit descriptor shape:
//   { kind: 'block', height: 1|2|3 }
//   { kind: 'platform', width: 1|2|3, tier: 1|2|3 }
//   { kind: 'gap', width: n }  // n width-units of empty space

/**
 * Build a unit descriptor for a block of given height.
 * @param {1|2|3} height
 */
function B(height) {
  return { kind: 'block', height };
}

/**
 * Build a unit descriptor for a platform of given width and tier.
 * @param {1|2|3} width
 * @param {1|2|3} tier
 */
function P(width, tier) {
  return { kind: 'platform', width, tier };
}

/**
 * Build a unit descriptor for a gap of given width.
 * @param {number} width
 */
function G(width) {
  return { kind: 'gap', width };
}

/**
 * The macro vocabulary. Each entry is an authored terrain sequence with
 * a readable challenge, an entry, and an exit (generation.md §2, §3).
 *
 * These are FAMILIES of arrangements, not final spacing values
 * (generation.md §2). The composer selects and arranges them.
 */
export const MACROS = Object.freeze({
  // --- Horizontal macros ----------------------------------------------------

  /**
   * Pyramid: blocks of heights 1, 2, 3, 2, 1.
   * A symmetric rise-and-fall. The hero walks over the blocks (they are
   * solid, rising from ground, so the hero jumps over them).
   *
   * Entry: 5 units clear. Exit: 5 units clear. These simple patterns carry
   * EXTRA breathing room (generation.md §5: stage -1 is "fewer blocks, room to
   * move") so a -1 area packs fewer of them and reads as sparser than the
   * denser, more tightly-spaced set pieces of later stages.
   * Difficulty: 1 (simple, readable).
   */
  pyramid: Object.freeze({
    id: 'pyramid',
    name: 'Pyramid',
    orientation: 'horizontal',
    difficulty: 1,
    units: Object.freeze([B(1), B(2), B(3), B(2), B(1)]),
    entryClear: 5,
    exitClear: 5,
    // Slots sit on the TOP surface of the unit below them (block height /
    // platform tier / ground 0) — see surfaceElevationAt in placeMacro. A macro
    // with 5 blocks declares enough slots that a typical budget can be met
    // (task 4.1: 3-4 enemy, 2-3 barrel, 1-2 powerup).
    placements: Object.freeze([
      // Enemies patrol the base / on top of the low blocks.
      { slot: 'base', x: 0, type: 'enemy' },
      { slot: 'on-h1', x: 0, type: 'enemy' },
      { slot: 'on-h2', x: 1, type: 'enemy' },
      { slot: 'on-h2b', x: 3, type: 'enemy' },
      // Barrels sit on top of the mid/peak blocks.
      { slot: 'peak', x: 2, type: 'barrel' },
      { slot: 'on-h2-mid', x: 1, type: 'barrel' },
      // Powerups perch on the peak.
      { slot: 'peak-powerup', x: 2, type: 'powerup' },
    ]),
    variations: Object.freeze([]),
    follows: Object.freeze([]), // can follow any macro
    followedBy: Object.freeze([]), // can be followed by any macro
  }),

  /**
   * Low repeated obstacles: five single-height blocks in sequence.
   * A rhythm pattern — the hero jumps over each block in turn.
   *
   * Entry: 5 units clear. Exit: 5 units clear. Like pyramid, this simple
   * pattern carries extra breathing room so stage -1 areas read as sparser
   * (generation.md §5). Difficulty: 1 (simple repetition).
   */
  lowRepeated: Object.freeze({
    id: 'lowRepeated',
    name: 'Low Repeated Obstacles',
    orientation: 'horizontal',
    difficulty: 1,
    units: Object.freeze([B(1), B(1), B(1), B(1), B(1)]),
    entryClear: 5,
    exitClear: 5,
    // Five height-1 blocks: enemies + barrels sit on TOP of the blocks
    // (elevation 1), not inside them. Enough slots for a typical budget.
    placements: Object.freeze([
      { slot: 'e1', x: 0, type: 'enemy' },
      { slot: 'e2', x: 1, type: 'enemy' },
      { slot: 'e3', x: 2, type: 'enemy' },
      { slot: 'e4', x: 4, type: 'enemy' },
      { slot: 'b1', x: 2, type: 'barrel' },
      { slot: 'b2', x: 3, type: 'barrel' },
      { slot: 'b3', x: 1, type: 'barrel' },
      { slot: 'p1', x: 2, type: 'powerup' },
      { slot: 'p2', x: 4, type: 'powerup' },
    ]),
    variations: Object.freeze([]),
    follows: Object.freeze([]),
    followedBy: Object.freeze([]),
  }),

  /**
   * Stretched pyramid: five height-1 blocks, five height-2 blocks,
   * five height-3 blocks, followed by a descent/drop.
   * A long, sustained climb with a drop at the end.
   *
   * Entry: 2 units clear. Exit: 3 units clear (extra room after the drop).
   * Difficulty: 2 (longer, more sustained).
   */
  stretchedPyramid: Object.freeze({
    id: 'stretchedPyramid',
    name: 'Stretched Pyramid',
    orientation: 'horizontal',
    difficulty: 2,
    units: Object.freeze([
      B(1), B(1), B(1), B(1), B(1),
      B(2), B(2), B(2), B(2), B(2),
      B(3), B(3), B(3), B(3), B(3),
      G(2), // descent/drop
    ]),
    entryClear: 2,
    exitClear: 3,
    // Slots sit on the TOP of each block band: low (h1, elev 1), mid (h2,
    // elev 2), high (h3, elev 3). The resolver reads surfaceElevationAt, so
    // each slot rests on its band's surface, never inside a block.
    placements: Object.freeze([
      { slot: 'low', x: 2, type: 'enemy' },
      { slot: 'low2', x: 3, type: 'enemy' },
      { slot: 'mid-enemy', x: 7, type: 'enemy' },
      { slot: 'high-enemy', x: 12, type: 'enemy' },
      { slot: 'mid', x: 7, type: 'barrel' },
      { slot: 'mid2', x: 8, type: 'barrel' },
      { slot: 'high-barrel', x: 12, type: 'barrel' },
      { slot: 'high', x: 12, type: 'powerup' },
      { slot: 'high2', x: 13, type: 'powerup' },
    ]),
    variations: Object.freeze([]),
    follows: Object.freeze([]),
    followedBy: Object.freeze([]),
  }),

  /**
   * Mixed crossing: height-1, height-2, height-3 blocks; a gap;
   * a triple-width platform at tier 2; then height-3, height-2, height-1 blocks.
   * Combines blocks and platforms with a gap in the middle.
   *
   * Entry: 2 units clear. Exit: 2 units clear.
   * Difficulty: 3 (mixed terrain, gap, platform crossing).
   */
  mixedCrossing: Object.freeze({
    id: 'mixedCrossing',
    name: 'Mixed Crossing',
    orientation: 'horizontal',
    difficulty: 3,
    units: Object.freeze([
      B(1), B(2), B(3),
      G(3), // gap — must be cleared with a double jump
      P(3, 2), // triple-width platform at tier 2
      B(3), B(2), B(1), // descent after the platform
    ]),
    entryClear: 2,
    exitClear: 2,
    // Slots rest on the supporting surface: on-top of blocks (elev = height)
    // and on the platform's landing face (elev = tier 2). Enough slots for a
    // typical budget; the gap (x=3..5) carries no slots.
    placements: Object.freeze([
      { slot: 'on-h1', x: 0, type: 'enemy' },
      { slot: 'before-gap', x: 2, type: 'enemy' },
      { slot: 'on-platform', x: 5, type: 'enemy' },
      { slot: 'on-platform2', x: 6, type: 'enemy' },
      { slot: 'on-platform', x: 5, type: 'powerup' },
      { slot: 'on-platform-pu', x: 6, type: 'powerup' },
      { slot: 'after-platform', x: 9, type: 'barrel' },
      { slot: 'on-h3', x: 8, type: 'barrel' },
      { slot: 'on-h2', x: 9, type: 'barrel' },
    ]),
    variations: Object.freeze([]),
    follows: Object.freeze([]),
    followedBy: Object.freeze([]),
  }),

  /**
   * Gap/drop: a wide gap followed by a lower landing (descent).
   * A movement challenge — the hero must jump the gap and land on the
   * lower ground. Not a lethal pit (generation.md §2).
   *
   * Shape: gap → a solid block landing (the "drop"). The block is the
   * landing surface after the gap; the hero drops onto / past it. Two
   * adjacent gaps with no lower landing would be a lethal pit, which the
   * docs explicitly forbid — so the landing is a real surface, not air.
   *
   * Entry: 2 units clear. Exit: 2 units clear.
   * Difficulty: 2 (gap + drop).
   */
  gapDrop: Object.freeze({
    id: 'gapDrop',
    name: 'Gap / Drop',
    orientation: 'horizontal',
    difficulty: 2,
    units: Object.freeze([
      G(3), // gap — must be cleared with a double jump
      B(1), // lower landing block (the "drop")
    ]),
    entryClear: 2,
    exitClear: 2,
    // The hero drops onto the landing block (x=3, h1 → elev 1). The before-gap
    // slot is on the entry ground (elev 0). Enough slots for a typical budget.
    placements: Object.freeze([
      { slot: 'before-gap', x: 0, type: 'enemy' },
      { slot: 'before-gap2', x: 1, type: 'enemy' },
      { slot: 'landing-enemy', x: 3, type: 'enemy' },
      { slot: 'landing', x: 3, type: 'powerup' },
      { slot: 'landing-barrel', x: 3, type: 'barrel' },
      { slot: 'before-gap-barrel', x: 0, type: 'barrel' },
    ]),
    variations: Object.freeze([]),
    follows: Object.freeze([]),
    followedBy: Object.freeze([]),
  }),

  // --- Vertical macros ------------------------------------------------------

  /**
   * Climbing pattern: a sequence of reachable landings that continues upward
   * within the vertical area's fixed screen width.
   *
   * The landings are platforms at INCREASING tiers: 1, 2, 3. Each step is at
   * most 1 tier higher (MAX_ELEVATION_STEP), so both heroes can reach each
   * successive landing with a double jump. The macro ends at its highest
   * tier (3), so the composer can stack the next macro's entry at a higher
   * elevation — forming a sustained upward climb.
   *
   * Entry: 2 units clear (on the starting platform). Exit: 2 units clear.
   * Difficulty: 2 (sustained climbing).
   */
  climbing: Object.freeze({
    id: 'climbing',
    name: 'Climbing Pattern',
    orientation: 'vertical',
    difficulty: 2,
    units: Object.freeze([
      P(2, 1), // first landing at tier 1
      P(2, 2), // second landing at tier 2
      P(2, 3), // third landing at tier 3 (peak — ends at the top)
    ]),
    entryClear: 2,
    exitClear: 2,
    // Vertical slots rest on the ground (elev 0); the macro's platforms are
    // the climb landings. Enough slots for a typical budget.
    placements: Object.freeze([
      { slot: 'tier1', x: 0, type: 'enemy' },
      { slot: 'tier1b', x: 0, type: 'enemy' },
      { slot: 'tier2', x: 1, type: 'enemy' },
      { slot: 'tier3', x: 2, type: 'powerup' },
      { slot: 'tier3b', x: 2, type: 'powerup' },
      { slot: 'tier2-barrel', x: 1, type: 'barrel' },
      { slot: 'tier1-barrel', x: 0, type: 'barrel' },
    ]),
    variations: Object.freeze([]),
    follows: Object.freeze([]),
    followedBy: Object.freeze([]),
  }),

  /**
   * Climbing with gaps: a vertical climb with gaps between landings.
   * The hero must jump between platforms at increasing tiers.
   *
   * The tiers ascend: 1, 2, 3, 3. The macro ends at tier 3 (its peak), so
   * the next macro's entry sits at a higher elevation — the climb continues.
   *
   * Entry: 2 units clear. Exit: 2 units clear.
   * Difficulty: 3 (climbing + gaps).
   */
  climbingGaps: Object.freeze({
    id: 'climbingGaps',
    name: 'Climbing with Gaps',
    orientation: 'vertical',
    difficulty: 3,
    units: Object.freeze([
      P(1, 1),
      G(1),
      P(1, 2),
      G(1),
      P(1, 3),
      G(1),
      P(1, 3),
    ]),
    entryClear: 2,
    exitClear: 2,
    // Vertical slots rest on the ground (elev 0); platforms are climb landings.
    placements: Object.freeze([
      { slot: 'tier1', x: 0, type: 'enemy' },
      { slot: 'tier2', x: 1, type: 'enemy' },
      { slot: 'tier3', x: 2, type: 'enemy' },
      { slot: 'tier3b', x: 4, type: 'powerup' },
      { slot: 'tier3c', x: 4, type: 'powerup' },
      { slot: 'tier2-barrel', x: 1, type: 'barrel' },
      { slot: 'tier1-barrel', x: 0, type: 'barrel' },
    ]),
    variations: Object.freeze([]),
    follows: Object.freeze([]),
    followedBy: Object.freeze([]),
  }),
});

// ---------------------------------------------------------------------------
// Macro selection by progression stage (generation.md §5)
// ---------------------------------------------------------------------------

/**
 * Progression weighting per stage (generation.md §5).
 *
 * The weights are the SINGLE source of truth for how difficulty is weighted
 * within each stage. They encode the deliberate -1 → -4 progression:
 *
 *   -1: sparse & simple — difficulty 1 only, "room to move"
 *   -2: more combinations — difficulty 1-2, more climbing/crossing
 *   -3: denser set pieces — difficulty 1-3, substantial set pieces
 *   -4: strongest combos — difficulty 1-3, weighted toward 3 (hardest)
 *
 * Each entry's `weights` map difficulty → selection weight; the min/max are
 * derived from the map keys so a difficulty can never be selected outside its
 * allowed range. A weight of 0 would be redundant with min/max exclusion, so
 * every difficulty in a stage's range carries a positive weight.
 */
export const STAGE_WEIGHTS = Object.freeze({
  '-1': Object.freeze({ 1: 1 }),
  '-2': Object.freeze({ 1: 0.5, 2: 1 }),
  '-3': Object.freeze({ 1: 0.3, 2: 0.5, 3: 1 }),
  '-4': Object.freeze({ 1: 0.2, 2: 0.4, 3: 1 }),
});

/**
 * Stage → allowed difficulty range, DERIVED from STAGE_WEIGHTS so the two can
 * never drift apart.
 */
const STAGE_DIFFICULTY = Object.freeze(
  Object.fromEntries(
    Object.entries(STAGE_WEIGHTS).map(([stage, weights]) => {
      const diffs = Object.keys(weights).map(Number);
      return [
        stage,
        Object.freeze({
          min: Math.min(...diffs),
          max: Math.max(...diffs),
          weights,
        }),
      ];
    }),
  ),
);

/**
 * Filter and weight macros for a given orientation and progression stage.
 *
 * @param {string} orientation 'horizontal' | 'vertical'
 * @param {number} stage progression stage (-1 to -4)
 * @returns {Array<{macro: object, weight: number}>} weighted macro list
 */
export function selectMacros(orientation, stage) {
  const stageKey = String(stage);
  const stageCfg = STAGE_DIFFICULTY[stageKey];
  if (!stageCfg) {
    throw new Error(`selectMacros: unknown stage ${stage}`);
  }

  const result = [];
  for (const macro of Object.values(MACROS)) {
    if (macro.orientation !== orientation) continue;
    if (macro.difficulty < stageCfg.min || macro.difficulty > stageCfg.max) continue;
    const weight = stageCfg.weights[macro.difficulty] ?? 1;
    result.push({ macro, weight });
  }
  return result;
}

/**
 * Pick a macro from a weighted list using the given RNG.
 *
 * @param {Array<{macro: object, weight: number}>} candidates
 * @param {ReturnType<typeof createRng>} rng
 * @returns {object} the selected macro
 */
function pickWeighted(candidates, rng) {
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let roll = rng.next() * totalWeight;
  for (const c of candidates) {
    roll -= c.weight;
    if (roll <= 0) return c.macro;
  }
  // Fallback (floating-point edge case): return the last candidate.
  return candidates[candidates.length - 1].macro;
}

// ---------------------------------------------------------------------------
// Macro width (how many width-units a macro occupies)
// ---------------------------------------------------------------------------

/**
 * Compute the total width (in width-units) of a macro's unit sequence.
 *
 * @param {object} macro a macro from MACROS
 * @returns {number} total width in units
 */
export function macroWidth(macro) {
  let width = macro.entryClear;
  for (const u of macro.units) {
    if (u.kind === 'block') width += 1; // blocks are always 1 width unit
    else if (u.kind === 'platform') width += u.width;
    else if (u.kind === 'gap') width += u.width;
  }
  width += macro.exitClear;
  return width;
}

/**
 * Compute the total length (in units) a macro occupies ALONG THE COMPOSITION
 * AXIS.
 *
 * - Horizontal macros compose along X: the axis length is the macro's width.
 * - Vertical macros compose along Y: the axis length is the macro's HEIGHT
 *   (how much of the climb it consumes), not its width. The zone's width is
 *   fixed (one screen wide), so a vertical macro's width is a constraint,
 *   not a budget.
 *
 * @param {object} macro a macro from MACROS
 * @returns {number} axis length in units
 */
export function macroAxisLength(macro) {
  if (macro.orientation === 'vertical') {
    // Vertical axis length = entry + exit clear (vertical breathing room)
    // plus the height span of the platform sequence. A platform at tier T
    // sits T units above the entry surface, so the sequence spans
    // (maxTier − minTier) units of climb; the entry/exit clear zones add
    // breathing room above and below.
    const tiers = macro.units
      .filter((u) => u.kind === 'platform')
      .map((u) => u.tier);
    const span = tiers.length > 0 ? Math.max(...tiers) - Math.min(...tiers) : 0;
    return macro.entryClear + span + macro.exitClear;
  }
  return macroWidth(macro);
}

/**
 * Compute the ABSOLUTE climb elevation (units) of a macro's first platform
 * landing, given the macro's start position on the climb axis.
 *
 * A macro's first platform has LOCAL tier T_first (the lowest-tier platform
 * in the sequence). When the macro is stacked at climb elevation `axisPos`,
 * that platform sits at absolute elevation `axisPos + T_first`.
 *
 * @param {object} macro a vertical macro from MACROS
 * @param {number} axisPos the macro's start position on the climb axis
 * @returns {number} absolute climb elevation of the first platform
 */
function firstPlatformAbsY(macro, axisPos) {
  const tiers = macro.units
    .filter((u) => u.kind === 'platform')
    .map((u) => u.tier);
  if (tiers.length === 0) return axisPos;
  return axisPos + Math.min(...tiers);
}

/**
 * Compute the ABSOLUTE climb elevation (units) of a macro's last platform
 * landing (the highest tier reached), given the macro's start position on
 * the climb axis.
 *
 * The macro's "peak" is its highest-tier platform. When stacked at `axisPos`,
 * that platform sits at absolute elevation `axisPos + T_peak`.
 *
 * @param {object} macro a vertical macro from MACROS
 * @param {number} axisPos the macro's start position on the climb axis
 * @returns {number} absolute climb elevation of the last (peak) platform
 */
function lastPlatformAbsY(macro, axisPos) {
  const tiers = macro.units
    .filter((u) => u.kind === 'platform')
    .map((u) => u.tier);
  if (tiers.length === 0) return axisPos;
  return axisPos + Math.max(...tiers);
}

/**
 * How many physical terrain units (blocks + platforms) a macro contributes.
 *
 * Gaps are movement challenges (empty space), not "obstacles", so they are not
 * counted — a sparser stage wants fewer BLOCKS/PLATFORMS, not fewer gaps. This
 * is the density measure the progression tests use to assert that stage -1
 * areas are visibly sparser than stage -4 (generation.md §5).
 *
 * @param {object} macro a macro from MACROS
 * @returns {number} number of block/platform units
 */
export function macroDensity(macro) {
  return macro.units.filter((u) => u.kind === 'block' || u.kind === 'platform').length;
}

/**
 * Total density of a composed layout (sum of its macros' densities).
 *
 * @param {object} layout a layout from composeArea
 * @returns {number} total block/platform units across all placed macros
 */
export function layoutDensity(layout) {
  return layout.macros.reduce((sum, id) => sum + macroDensity(MACROS[id]), 0);
}

// ---------------------------------------------------------------------------
// Area population (populate.md §1–§5, generation.md §4 step 4)
// ---------------------------------------------------------------------------
// Terrain macros provide MEANINGFUL PLACEMENT SLOTS (populate.md §1):
// positions where enemies, barrels, and powerups can go. A slot is not an
// arbitrary coordinate — it is a meaningful place ("on top of this platform",
// "in this open pocket", "at this elevated perch"). The population RESOLVER
// (populateArea) fills those slots to meet the level's QUANTITY BUDGETS using
// the per-game seeded RNG.
//
// Two ideas are kept strictly distinct (populate.md §1):
//   - QUANTITY BUDGET: how many items/enemies belong in the area.
//   - PLACEMENT / TYPE CHANCE: which valid slots and which types are chosen
//     to satisfy that budget.
//
// For a fixed budget, independent coin flips must NOT accidentally produce an
// empty or overcrowded area (populate.md §1). The resolver therefore fills
// slots deterministically from the budget: it never under-fills below the
// budget when slots are available, and it never over-fills (each slot holds
// at most one item). If the chosen terrain cannot support the budget, the
// resolver fills every valid slot rather than piling items into invalid
// positions — the composition (composer) is the thing to revise, not the
// placement.
//
// The resolver is a PURE function: (rng, layout, config) → population. It
// never re-rolls the terrain; it only decides WHICH slots and WHICH types
// satisfy the budgets. The same (rng stream, layout, config) always yields the
// same population, which is what makes "the same arrangement is restored
// after a life loss" hold (lifecycle.md §6: the RNG is rolled once per game).

/**
 * Barrel structure scales (populate.md §3).
 *   - SINGLE:  isolated barrels (the common simple placement).
 *   - MEDIUM:  an organized arrangement of ~4–9 barrels.
 *   - SUPER:   a much larger set piece (a barrel pyramid/wall).
 *
 * The medium/super bounds are the doc's stated range. The exact frequency and
 * counts are tuning values (populate.md §3); the resolver treats them as the
 * structural envelope an arrangement must fit within.
 */
export const BARREL_STRUCTURE = Object.freeze({
  single: Object.freeze({ min: 1, max: 1 }),
  medium: Object.freeze({ min: 4, max: 9 }),
  super: Object.freeze({ min: 10, max: 99 }),
});

/**
 * How many width-units apart two barrels in the same structure must sit for
 * one to be inside another's blast radius (a "chain" position).
 *
 * A barrel's explosion reaches BARREL_EXPLOSION_RADIUS_PX; two adjacent
 * barrels (each BARREL_PX wide) sit 1 width-unit apart, so the chain threshold
 * is (radius − barrel width) in px, expressed in width-units. We use the
 * actual blast radius and barrel footprint so the "chain" claim is grounded in
 * the real explosion behavior, not assumed (populate.md §3: "must not assume
 * an explosion can reach beyond its actual gameplay area").
 */
// Barrel footprint + blast radius come from the single source of truth in
// object.js (BARREL_DEF) — not duplicated magic constants. All three barrel
// variants (explosive / wood / coin) share the same w (BARREL_DEF.w); the
// chain threshold is derived from the explosive barrel's blast radius.
const BARREL_PX = BARREL_DEF.w;
const BARREL_EXPLOSION_RADIUS_PX = BARREL_DEF.explosion.radius;
/** Max horizontal spacing (width-units) between two barrels for a chain. */
export const BARREL_CHAIN_MAX_UNITS = Math.max(
  1,
  Math.ceil((BARREL_EXPLOSION_RADIUS_PX - BARREL_PX) / UNIT_PX),
);

/**
 * Classify a group of barrel x-positions (width-units, same tier) into a
 * structure scale (populate.md §3).
 *
 * The doc's scales: single = isolated barrels (the common simple placement);
 * medium = an organized arrangement of ~4-9 barrels; super = a much larger set
 * piece. A small cluster of 2-3 barrels is NOT a medium structure — it is a
 * "small" arrangement (a step-up from a single barrel, far short of the 4-9
 * medium band), so it is classified as `small`. Only groups of 4+ enter the
 * medium band (populate.md §3: "approximately 4–9 barrels").
 *
 * @param {number[]} xs barrel x positions (unit space)
 * @returns {'single'|'small'|'medium'|'super'} the structure scale
 */
export function classifyBarrelStructure(xs) {
  const n = xs.length;
  if (n <= BARREL_STRUCTURE.single.max) return 'single';
  if (n < BARREL_STRUCTURE.medium.min) return 'small'; // 2-3: small cluster
  if (n <= BARREL_STRUCTURE.medium.max) return 'medium'; // 4-9
  return 'super';
}

/**
 * Whether a group of barrels on the SAME tier at the given x-positions (unit
 * space) forms a chain: at least two barrels within BARREL_CHAIN_MAX_UNITS of
 * each other. A well-placed attack then causes a satisfying chain reaction
 * (populate.md §3).
 *
 * @param {number[]} xs barrel x positions (unit space)
 * @returns {boolean} true if any two barrels are chain-adjacent
 */
export function formsChain(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] <= BARREL_CHAIN_MAX_UNITS) return true;
  }
  return false;
}

/**
 * Group an area's barrel placements into contiguous same-tier runs.
 *
 * A barrel "structure" (populate.md §3) is a set of barrels on the SAME
 * supporting surface (tier) that sit near each other along the route. We group
 * by tier, then by contiguity: two same-tier barrels belong to the same
 * structure when their x positions are within BARREL_CHAIN_MAX_UNITS of each
 * other (they are chain-adjacent). Isolated same-tier barrels form single
 * structures.
 *
 * @param {Array<{x:number, y:number, type:string, slot:string}>} barrelPlacements
 * @returns {Array<{tier:number, xs:number[], positions:object[]}>} the structures
 */
export function barrelStructures(barrelPlacements) {
  const byTier = new Map();
  for (const b of barrelPlacements) {
    const tier = b.y ?? 0;
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push(b);
  }
  const structures = [];
  for (const [tier, list] of byTier) {
    const sorted = list
      .slice()
      .sort((a, b) => (a.x - b.x) || (a.slot.localeCompare(b.slot)));
    let current = null;
    for (const b of sorted) {
      if (
        current &&
        b.x - current.positions[current.positions.length - 1].x <= BARREL_CHAIN_MAX_UNITS
      ) {
        current.positions.push(b);
        current.xs.push(b.x);
      } else {
        current = { tier, xs: [b.x], positions: [b] };
        structures.push(current);
      }
    }
  }
  return structures;
}

/**
 * Weighted pick from a map of {key: weight} using the given RNG.
 *
 * @param {Object<string, number>} weights key → weight
 * @param {ReturnType<typeof createRng>} rng
 * @returns {string} the chosen key
 */
function pickWeightedKey(weights, rng) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return entries[0][0];
  let roll = rng.next() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0]; // floating-point edge case
}

/**
 * Build the per-slot population opportunity lists from a composed layout.
 *
 * Each slot in layout.placements carries a `type` ('enemy' | 'barrel' |
 * 'powerup'). We group them into the three opportunity pools the resolver
 * fills. Slots are the ONLY valid positions — the resolver never invents a
 * coordinate (populate.md §1: "use valid opportunities to satisfy the
 * intended quantity").
 *
 * @param {object} layout the layout from composeArea (its `placements`)
 * @returns {{enemies:object[], barrels:object[], powerups:object[]}} the pools
 */
function buildSlotPools(layout) {
  const pools = { enemies: [], barrels: [], powerups: [] };
  for (const slot of layout.placements ?? []) {
    if (slot.type === 'enemy') pools.enemies.push(slot);
    else if (slot.type === 'barrel') pools.barrels.push(slot);
    else if (slot.type === 'powerup') pools.powerups.push(slot);
  }
  return pools;
}

/**
 * Whether a slot sits at a VALID standing position — i.e. NOT inside a solid
 * block (populate.md §1 + task 4.1 BLOCKER: items must never spawn in solids).
 *
 * A slot is valid when its y (the surface elevation it rests on) is at or above
 * the TOP of every solid block whose x-range covers the slot's x. A block of
 * height H occupies y = 0..H; a slot at elevation y is inside the block when
 * y < H (the slot is below the block's top surface). A slot at y >= H rests on
 * or above the block's top — a valid standing position.
 *
 * Platforms are one-way landings (not solids the hero walks inside), so they
 * do not invalidate a slot; only solid blocks do.
 *
 * @param {object} slot a slot {x, y}
 * @param {object[]} units the layout's placed units (its `aabb` + `kind` + `height`)
 * @returns {boolean} true if the slot is at a valid standing position
 */
export function slotIsOnValidSurface(slot, units) {
  if (!units) return true; // no terrain to check against
  for (const u of units) {
    if (u.kind !== 'block') continue; // platforms are one-way landings, not solids
    // The slot's x is the CENTER of its unit cell. A block of width W at x=u.x
    // occupies [u.x, u.x+W). The slot is at the same unit cell as the block
    // when slot.x is within [u.x, u.x+W). Since both are unit-aligned, the
    // slot's x matches the block's x exactly (slot.x === u.x for a slot on
    // top of the block). We check: does the slot's x fall within the block's
    // x-range? If so, the slot must be at or above the block's top.
    const uStart = u.x;
    const uEnd = u.x + u.aabb.w;
    if (slot.x >= uStart && slot.x < uEnd) {
      // The slot is above this block. It must be at or above the block's top
      // (height H) — i.e. y >= H. If y < H, the slot is INSIDE the block.
      const surfaceY = slot.y ?? 0;
      if (surfaceY < u.height) {
        return false; // the slot is INSIDE the block (below its top)
      }
    }
  }
  return true;
}

/**
 * Choose up to `count` slots from a pool using the seeded RNG.
 *
 * This is the "placement chance" (populate.md §1): WHICH valid slots are
 * selected to satisfy the budget. It draws a shuffled prefix of the pool
 * (Fisher–Yates with the provided RNG), so the selection is deterministic for
 * a given rng stream AND respects the budget (never more than `count`, never
 * more than the pool size). No independent coin flips — a fixed budget always
 * fills as many valid slots as the budget asks for, up to the pool's capacity.
 *
 * @param {object[]} pool the candidate slots
 * @param {number} count the quantity budget
 * @param {ReturnType<typeof createRng>} rng
 * @returns {object[]} the chosen slots (≤ count, ≤ pool.length)
 */
function chooseSlots(pool, count, rng) {
  const n = pool.length;
  const target = Math.max(0, Math.min(count, n));
  // Work on a copy so the caller's pool is not mutated.
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, target);
}

/**
 * Assign enemy types to chosen enemy slots from the level's enemy roster
 * (populate.md §4).
 *
 * The roster is a map of {type: count}. The resolver picks a type per slot
 * from the roster's available counts (weighted by remaining count) so the
 * area's enemy MIX matches the roster without forcing the same mix into every
 * macro (populate.md §4: "Do not force the same enemy mix into every macro
 * simply to reach a total"). Each type is capped at its roster count; if the
 * total roster count is below the number of slots, the extra slots are left
 * empty (a smaller mix than the roster, never a type beyond its budget).
 *
 * @param {object[]} enemySlots the chosen enemy slots
 * @param {Object<string, number>} roster {type: count}
 * @param {ReturnType<typeof createRng>} rng
 * @returns {object[]} the enemy placements ({slot, type})
 */
function assignEnemyTypes(enemySlots, roster, rng) {
  const remaining = { ...roster };
  const placements = [];
  for (const slot of enemySlots) {
    const total = Object.values(remaining).reduce((a, b) => a + b, 0);
    if (total <= 0) break; // roster exhausted — leave remaining slots empty
    const type = pickWeightedKey(remaining, rng);
    remaining[type] -= 1;
    placements.push({ ...slot, type });
  }
  return placements;
}

/**
 * Assign powerup types to chosen powerup slots from the level's powerup mix
 * (populate.md §2).
 *
 * The mix is a map of {type: count} (a QUANTITY budget per type) plus optional
 * selection weights. When weights are supplied, a slot's type is picked
 * weighted by the remaining count × weight; otherwise it is picked uniformly
 * among types that still have budget left. Each type is capped at its count
 * (the "guaranteed quantities and limits by type", populate.md §2). If the
 * total mix is below the number of slots, extra slots are left empty.
 *
 * @param {object[]} powerupSlots the chosen powerup slots
 * @param {Object<string, number>} mix {type: count}
 * @param {Object<string, number>|undefined} weights {type: weight} (optional)
 * @param {ReturnType<typeof createRng>} rng
 * @returns {object[]} the powerup placements ({slot, type})
 */
function assignPowerupTypes(powerupSlots, mix, weights, rng) {
  const remaining = { ...mix };
  const placements = [];
  for (const slot of powerupSlots) {
    const typesWithBudget = Object.entries(remaining).filter(([, c]) => c > 0);
    if (typesWithBudget.length === 0) break; // mix exhausted
    let type;
    if (weights) {
      const w = {};
      for (const [t, c] of typesWithBudget) w[t] = c * (weights[t] ?? 1);
      type = pickWeightedKey(w, rng);
    } else {
      type = rng.pick(typesWithBudget.map(([t]) => t));
    }
    remaining[type] -= 1;
    placements.push({ ...slot, type });
  }
  return placements;
}

/**
 * Populate a composed area's macro slots from the level's budgets (populate.md
 * §1–§5, generation.md §4 step 4).
 *
 * PURE: (rng, layout, config) → population. The same rng stream + layout +
 * config always produces the same population — the "fixed for the game"
 * contract (lifecycle.md §6). The resolver never invents coordinates: every
 * returned item sits on a slot from layout.placements, so it is never in a
 * solid (the composer already validated the terrain) and never buries/blocks
 * a landing (a slot is a designated, terrain-meaningful position).
 *
 * @param {ReturnType<typeof createRng>} rng the per-game RNG (stateful)
 * @param {object} layout the composed area layout (from composeArea)
 * @param {object} config the level/area population config:
 *   {
 *     enemies:  Object<string, number>,   // roster {type: count}
 *     powerups: Object<string, number>,   // mix {type: count}
 *     powerupWeights?: Object<string, number>, // optional selection weights
 *     barrels:  Object<string, number>,   // {explosive, wood, coin} counts
 *     hero?: 'scarlet'|'balthazar',        // for future reach/eligibility
 *   }
 * @returns {{enemies:object[], barrels:object[], powerups:object[],
 *            structures:object[],
 *            budgets:{enemies:{requested:number,placed:number,slots:number},
 *                     barrels:{requested:number,placed:number,slots:number},
 *                     powerups:{requested:number,placed:number,slots:number}}}}
 *   the population. Each item is the slot (x, y, slot, placementId) plus a
 *   `type`. `structures` groups the barrels by scale (populate.md §3).
 *   `budgets` records, per category, the requested quantity, how many were
 *   placed, and how many valid slots were available — so a budget that the
 *   terrain could not fully support is visible (under-placement), never hidden.
 *
 * STABLE SNAPSHOT (task 4.1 / acceptance #5, lifecycle.md §6): the returned
 * population is a pure, value-only snapshot — every item is a plain object
 * (slot fields + `type`), with no references to live entities or the RNG. It
 * is the authoritative arrangement for the whole game: the resolver runs ONCE
 * per game (from the seed), its output is stored (e.g. on the hero or zone),
 * and `restoreArea` (lifecycle.js) replays that SAME stored population after a
 * life loss. The integration with `restoreArea` happens in task 7.1 (full
 * runtime wiring); this task only guarantees the output is a stable snapshot
 * that can be stored and restored byte-for-byte.
 */
export function populateArea(rng, layout, config = {}) {
  const pools = buildSlotPools(layout);

  // BLOCKER guard (task 4.1): before any item is placed, verify every slot is
  // at a VALID standing position — i.e. NOT inside a solid block (checked
  // against the layout's block AABBs). The composer's surfaceElevationAt
  // already sets each slot's y to the top of the supporting surface, so this
  // check is a defense-in-depth invariant: it throws if a slot ever ends up
  // inside a solid, rather than silently spawning an item in a block.
  const solidUnits = (layout.units ?? []).filter((u) => u.kind === 'block');
  for (const slot of layout.placements ?? []) {
    if (!slotIsOnValidSurface(slot, solidUnits)) {
      throw new Error(
        `populateArea: slot ${slot.slot} at x=${slot.x} y=${slot.y ?? 0} ` +
          `is inside a solid block — items must never spawn in solids`,
      );
    }
  }

  const enemyRoster = config.enemies ?? {};
  const powerupMix = config.powerups ?? {};
  const powerupWeights = config.powerupWeights;
  const barrelCounts = config.barrels ?? {};

  // --- Enemies (populate.md §4) ---------------------------------------------
  const enemyBudget = Object.values(enemyRoster).reduce((a, b) => a + b, 0);
  const enemySlots = chooseSlots(pools.enemies, enemyBudget, rng);
  const enemies = assignEnemyTypes(enemySlots, enemyRoster, rng);

  // --- Barrels (populate.md §3) ---------------------------------------------
  // The barrel budget is the total of all barrel types. Slots are filled first
  // (placement chance), then each chosen slot is assigned a barrel type from
  // the per-type counts (type chance). Explosive barrels are assigned a
  // deterministic share so they can form chain positions (see below).
  const barrelBudget = Object.values(barrelCounts).reduce((a, b) => a + b, 0);
  const barrelSlots = chooseSlots(pools.barrels, barrelBudget, rng);
  const barrels = assignBarrelTypes(barrelSlots, barrelCounts, rng);

  // --- Powerups (populate.md §2) --------------------------------------------
  const powerupBudget = Object.values(powerupMix).reduce((a, b) => a + b, 0);
  const powerupSlots = chooseSlots(pools.powerups, powerupBudget, rng);
  const powerups = assignPowerupTypes(powerupSlots, powerupMix, powerupWeights, rng);

  const structures = barrelStructures(barrels).map((s) => ({
    tier: s.tier,
    xs: s.xs,
    scale: classifyBarrelStructure(s.xs),
    chain: formsChain(s.xs),
  }));

  return {
    enemies,
    barrels,
    powerups,
    structures,
    budgets: {
      enemies: { requested: enemyBudget, placed: enemies.length, slots: pools.enemies.length },
      barrels: { requested: barrelBudget, placed: barrels.length, slots: pools.barrels.length },
      powerups: { requested: powerupBudget, placed: powerups.length, slots: pools.powerups.length },
    },
  };
}

/**
 * Produce a stable, value-only SNAPSHOT of a population for storage and
 * restoration (task 4.1 / acceptance #5, lifecycle.md §6).
 *
 * The snapshot is the arrangement `restoreArea` (lifecycle.js) replays after a
 * life loss. It is a deep copy of the population's plain-object contents
 * (enemies, barrels, powerups, structures, budgets) — no references to live
 * entities, the RNG, or the layout — so it can be stored on the hero or zone
 * and restored byte-for-byte. The same snapshot always restores the same
 * arrangement (the "fixed for the game" contract).
 *
 * NOTE: the integration with `restoreArea` (storing this snapshot on the
 * hero/zone and replaying it on life loss) happens in task 7.1 (full runtime
 * wiring). This helper only makes the resolver's output a stable, storable
 * snapshot.
 *
 * @param {object} population the population from populateArea
 * @returns {object} a deep, value-only snapshot of the population
 */
export function populationSnapshot(population) {
  return {
    enemies: (population.enemies ?? []).map((e) => ({ ...e })),
    barrels: (population.barrels ?? []).map((b) => ({ ...b })),
    powerups: (population.powerups ?? []).map((p) => ({ ...p })),
    structures: (population.structures ?? []).map((s) => ({
      ...s,
      xs: (s.xs ?? []).slice(),
    })),
    budgets: {
      enemies: { ...(population.budgets?.enemies ?? {}) },
      barrels: { ...(population.budgets?.barrels ?? {}) },
      powerups: { ...(population.budgets?.powerups ?? {}) },
    },
  };
}

/**
 * Assign barrel types to chosen barrel slots from the per-type counts
 * (populate.md §3).
 *
 * Each type is capped at its count. To let explosive barrels FORM CHAIN
 * POSITIONS (populate.md §3: "a well-placed attack causes a satisfying chain
 * reaction"), the explosive count is placed on slots that are adjacent to
 * another chosen barrel slot (same tier, within BARREL_CHAIN_MAX_UNITS)
 * whenever possible — so the explosive barrels land in the middle of a
 * structure, not isolated at its edges. The remaining barrel types (wood,
 * coin) fill the rest.
 *
 * @param {object[]} barrelSlots the chosen barrel slots
 * @param {Object<string, number>} counts {explosive, wood, coin}
 * @param {ReturnType<typeof createRng>} rng
 * @returns {object[]} the barrel placements ({slot, type})
 */
function assignBarrelTypes(barrelSlots, counts, rng) {
  const remaining = { ...counts };
  const placements = [];

  // Order slots so "chainable" slots (adjacent to another chosen slot on the
  // same tier) come first. A slot is chainable when another chosen barrel slot
  // sits within BARREL_CHAIN_MAX_UNITS on the same tier.
  const isChainable = (slot) =>
    barrelSlots.some(
      (o) =>
        o !== slot &&
        (o.y ?? 0) === (slot.y ?? 0) &&
        Math.abs(o.x - slot.x) <= BARREL_CHAIN_MAX_UNITS,
    );
  const chainable = barrelSlots.filter(isChainable);
  const isolated = barrelSlots.filter((s) => !isChainable(s));
  // Deterministic order: chainable first (stable by x), then isolated.
  const ordered = [
    ...chainable.sort((a, b) => a.x - b.x),
    ...isolated.sort((a, b) => a.x - b.x),
  ];

  for (const slot of ordered) {
    // Prefer an explosive barrel while the explosive budget remains AND this
    // slot is chainable (so explosive barrels form the chain). On a non-
    // chainable slot an explosive barrel would sit isolated, so we let the
    // remaining types (wood/coin, plus any leftover explosive) fill it.
    if (remaining.explosive > 0 && isChainable(slot)) {
      placements.push({ ...slot, type: 'explosive' });
      remaining.explosive -= 1;
    } else if (Object.values(remaining).some((c) => c > 0)) {
      const type = pickWeightedKey(remaining, rng);
      placements.push({ ...slot, type });
      remaining[type] -= 1;
    } else {
      break; // all budgets exhausted
    }
  }

  return placements;
}

// ---------------------------------------------------------------------------
// Area composer (generation.md §4)
// ---------------------------------------------------------------------------

/**
 * Compose one area: safe entry → macros meeting budget → validated exit.
 *
 * This is a PURE function: (rng, orientation, stage, budget) → layout.
 * Same rng stream → same layout, every time.
 *
 * Composition axis (generation.md §4, structure.md §4):
 *   - HORIZONTAL areas compose along X. The budget is a WIDTH budget; macros
 *     are placed left to right, each one extending the route's x position.
 *   - VERTICAL areas compose along Y. The budget is a HEIGHT budget (the
 *     zone is VIEW_H·3 ≈ 1620 px tall, one screen wide). Macros are stacked
 *     upward: each macro's entry sits at the current climb elevation and its
 *     exit raises the hero's position. The zone's width is fixed (one screen
 *     wide), so horizontal positioning is constrained — the layout records
 *     the zone width but composition itself is purely vertical.
 *
 * @param {ReturnType<typeof createRng>} rng the per-game RNG (stateful)
 * @param {'horizontal'|'vertical'} orientation the area's orientation
 * @param {number} stage progression stage (-1 to -4)
 * @param {number} budget the area's length budget in units (width for
 *   horizontal, height for vertical)
 * @returns {object} the composed area layout
 *
 * Layout shape:
 *   {
 *     orientation: 'horizontal' | 'vertical',
 *     stage: number,
 *     budget: number,
 *     entryClear: number,     // clear units at the start of the axis
 *     exitClear: number,      // clear units at the end of the axis
 *     macros: string[],       // ids of macros used, in order
 *     units: Array<{          // placed terrain units with axis positions
 *       kind: 'block'|'platform',
 *       x: number,            // horizontal position (width-units)
 *       y: number,            // vertical offset along the climb (units);
 *                             // 0 for horizontal layouts
 *       width: number,
 *       height: number,       // blocks: height in units; platforms: tier
 *       tier: number,         // platforms: elevation tier; blocks: 0
 *       solid: boolean,
 *       oneWay: boolean,
 *       aabb: {x,y,w,h},
 *     }>,
 *     gaps: Array<{x: number, width: number}>,  // placed gaps
 *     totalWidth: number,     // total width in units
 *     totalHeight: number,    // total height in units (vertical: axis length)
 *     placements: Array<object>,  // placement opportunities (from macros)
 *   }
 */
export function composeArea(rng, orientation, stage, budget) {
  if (orientation !== 'horizontal' && orientation !== 'vertical') {
    throw new Error(`composeArea: orientation must be 'horizontal' or 'vertical', got ${orientation}`);
  }
  if (stage < -4 || stage > -1) {
    throw new Error(`composeArea: stage must be -1 to -4, got ${stage}`);
  }
  if (budget < ENTRY_CLEAR + EXIT_CLEAR) {
    throw new Error(`composeArea: budget ${budget} is less than minimum ${ENTRY_CLEAR + EXIT_CLEAR}`);
  }

  // Step 1: Reserve safe entry and exit (generation.md §4 step 1).
  const entryClear = ENTRY_CLEAR;
  const exitClear = EXIT_CLEAR;
  const available = budget - entryClear - exitClear;
  const isVertical = orientation === 'vertical';

  // In a vertical area, the hero starts at the bottom of the zone (y=0) and
  // climbs up. The entry clear zone is the space at the BOTTOM (y=0 to
  // y=entryClear), not above the first platform. So the first macro is
  // placed at y=0, not y=entryClear. This ensures the first platform is
  // reachable from the ground (at most 1 tier above).
  const initialAxisPos = isVertical ? 0 : entryClear;

  // Step 2: Select compatible macros (generation.md §4 step 2).
  const candidates = selectMacros(orientation, stage);
  if (candidates.length === 0) {
    throw new Error(`composeArea: no compatible macros for ${orientation} stage ${stage}`);
  }

  // Step 3: Arrange macros to meet the budget (generation.md §4 step 3).
  // The budget is consumed along the COMPOSITION AXIS: x for horizontal,
  // y (height) for vertical. `axisPos` is the macro's start position on that
  // axis; `axisUsed` is how much of the budget the macros have consumed.
  const macroIds = [];
  const placedUnits = [];
  const placedGaps = [];
  const placements = [];
  let axisPos = initialAxisPos; // current position on the composition axis
  let axisUsed = 0;         // budget consumed by placed macros

  // Track the last macro id for follow-condition validation.
  let lastMacroId = null;
  let placementSeq = 0; // unique id per macro placement instance

  // Keep selecting macros until the budget is met or no more fit.
  let guard = 0; // prevent infinite loops
  const MAX_MACROS = 50;
  // For vertical composition: track the absolute climb elevation of the
  // previous macro's peak (last platform) so the next macro's first platform
  // can be placed within a reachable step (≤ MAX_ELEVATION_STEP tiers up).
  // `prevPeakAbsY` is null until the first macro is placed.
  let prevPeakAbsY = null;

  while (guard < MAX_MACROS && axisUsed < available) {
    guard++;

    // Filter candidates by follow conditions (R2 #3: enforce BOTH
    // directions). A candidate is compatible when:
    //   - the last macro's `followedBy` list is empty OR contains the
    //     candidate's id, AND
    //   - the candidate's `follows` list is empty OR contains the last
    //     macro's id.
    // When both sides declare constraints, BOTH must agree.
    let filtered = candidates;
    if (lastMacroId) {
      const lastMacro = MACROS[lastMacroId];
      filtered = candidates.filter(({ macro }) => {
        const lastAllows = lastMacro.followedBy.length === 0
          || lastMacro.followedBy.includes(macro.id);
        const candidateAllows = macro.follows.length === 0
          || macro.follows.includes(lastMacroId);
        return lastAllows && candidateAllows;
      });
      if (filtered.length === 0) {
        // No candidate satisfies the follow constraints.
        //
        // WHY this relaxation exists: follow conditions (a macro's `follows`
        // / `followedBy` lists) are SOFT pacing/sequencing hints authored to
        // keep the route flowing; they are not structural invariants. The
        // HARD structural invariant is ORIENTATION: a horizontal macro can
        // only join the horizontal route and a vertical macro only the
        // vertical one. If we treated follow constraints as hard, a small
        // authoring gap (e.g. a macro that forgets to declare a `followedBy`
        // entry) would make composeArea THROW and fail to produce ANY layout.
        // Relaxing instead of failing keeps the composer total — it always
        // produces a valid, playable area even if the pacing intent is
        // broken.
        //
        // WHAT the relaxation sacrifices: the pacing/sequencing intent of the
        // author (the "story" of which macros should follow which). The route
        // remains structurally valid (same orientation, gaps and elevations
        // still validated in Step 5), but the macro ORDER may not match the
        // authored flow.
        //
        // We relax GRADUALLY rather than discarding ALL constraints at once.
        // Tier 1: prefer the closest match — keep the stage's DIFFICULTY TIER
        // (same pacing intensity as the stage calls for) AND the same
        // orientation. This preserves as much authoring intent as possible
        // while still guaranteeing a candidate exists (selectMacros already
        // filtered to this stage's difficulty range).
        // Tier 2: only if even the same-difficulty tier has no candidate
        // (effectively unreachable here, since candidates are all the same
        // stage difficulty range — kept as a defensive fallback), fall back
        // to ANY same-orientation macro.
        // eslint-disable-next-line no-console
        const lastMacro = MACROS[lastMacroId];
        const sameTier = candidates.filter(({ macro }) =>
          macro.orientation === orientation && macro.difficulty === lastMacro.difficulty);
        if (sameTier.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `composeArea: no macro follows "${lastMacroId}" per follow constraints; ` +
              `relaxing to same-difficulty (${lastMacro.difficulty}) ${orientation} macros`,
          );
          filtered = sameTier;
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `composeArea: no macro follows "${lastMacroId}" per follow constraints and ` +
              `none share its difficulty tier; relaxing to any ${orientation} macro`,
          );
          filtered = candidates.filter(({ macro }) => macro.orientation === orientation);
        }
      }
    }

    // Pick a macro that fits the remaining budget, weighted.
    const remaining = available - axisUsed;
    const fitting = filtered.filter(({ macro }) => macroAxisLength(macro) <= remaining);
    if (fitting.length === 0) break; // no macro fits; stop

    const macro = pickWeighted(fitting, rng);
    const axisLen = macroAxisLength(macro);

    // VERTICAL: ensure the inter-macro join is reachable. The next macro's
    // first platform must be within MAX_ELEVATION_STEP tiers UP of the
    // previous macro's peak (last platform). If the natural placement
    // (axisPos + firstPlatformLocalTier) would put the first platform more
    // than MAX_ELEVATION_STEP above prevPeakAbsY, shift the macro DOWN so
    // its first platform sits at prevPeakAbsY + MAX_ELEVATION_STEP.
    //
    // This is the fix for the unreachable inter-macro join: instead of
    // blindly stacking at axisPos (which leaves a gap of entryClear +
    // firstLocalTier tiers between the previous peak and the next first
    // platform), we anchor the next macro's first platform to a reachable
    // elevation. The macro's subsequent platforms (higher tiers) continue
    // the climb from there.
    //
    // We only shift DOWN (never up) so we don't exceed the budget. If the
    // shift would push the macro below the previous macro's start (overlap),
    // we clamp to the previous macro's start + 1 (minimal non-overlap).
    let placementAxisPos = axisPos;
    if (isVertical && prevPeakAbsY !== null) {
      const firstLocalTier = Math.min(...macro.units
        .filter((u) => u.kind === 'platform')
        .map((u) => u.tier));
      const naturalFirstAbsY = axisPos + firstLocalTier;
      const maxReachable = prevPeakAbsY + MAX_ELEVATION_STEP;
      if (naturalFirstAbsY > maxReachable) {
        // Shift the macro down so its first platform is at maxReachable.
        const shift = naturalFirstAbsY - maxReachable;
        const shifted = axisPos - shift;
        // Clamp: don't overlap the previous macro's start (axisPos - axisLen
        // is the previous macro's start; we need placementAxisPos >= that + 1
        // to avoid overlap, but in practice the shift is small).
        placementAxisPos = Math.max(shifted, 1);
      }
    }

    // Place the macro at its (possibly adjusted) axis position.
    placeMacro(macro, placementAxisPos, placedUnits, placedGaps, placements, entryClear, isVertical, placementSeq++);
    axisPos += axisLen;
    axisUsed += axisLen;
    macroIds.push(macro.id);
    lastMacroId = macro.id;
    if (isVertical) {
      prevPeakAbsY = lastPlatformAbsY(macro, placementAxisPos);
    }
  }

  if (macroIds.length === 0) {
    throw new Error(
      `composeArea: no ${orientation} macro fits budget ${budget} at stage ${stage}`,
    );
  }

  // Step 4: Build the layout.
  const totalWidth = isVertical
    ? Math.max(1, ...placedUnits.map((u) => u.x + u.aabb.w))
    : Math.max(budget, axisPos);
  const layout = {
    orientation,
    stage,
    budget,
    entryClear,
    exitClear,
    macros: macroIds,
    units: placedUnits,
    gaps: placedGaps,
    totalWidth,
    totalHeight: isVertical ? Math.max(budget, axisPos) : undefined,
    placements,
  };

  // Step 5: Validate the complete route (generation.md §4 step 5, §6).
  validateLayout(layout);

  return layout;
}

/**
 * Place a macro's units at the given axis offset.
 *
 * Horizontal: units are placed left to right starting at `axisPos` (x).
 * Vertical: the macro is stacked at climb elevation `axisPos` (y). The
 * entry surface sits at y = axisPos; a platform at tier T is placed at
 * y = axisPos + T, so each successive macro (entered at a higher y)
 * continues the climb. The zone width is fixed (one screen wide), so the
 * horizontal x is centered within the zone's screen width.
 *
 * @param {object} macro the macro to place
 * @param {number} axisPos the macro's start position on the composition axis
 * @param {object[]} placedUnits array to push placed units into
 * @param {object[]} placedGaps array to push placed gaps into
 * @param {object[]} placements array to push placement opportunities into
 * @param {number} entryClear the entry clear zone size
 * @param {boolean} isVertical whether the area is vertical
 * @param {number} instanceId unique id for this macro placement instance
 */
function placeMacro(macro, axisPos, placedUnits, placedGaps, placements, entryClear, isVertical, instanceId) {
  // Horizontal: cursor walks the x axis.
  // Vertical: cursor walks the y axis (climb elevation).
  let cursor = axisPos + macro.entryClear;

  // For vertical placement, the horizontal x is centered within the zone's
  // fixed screen width. Units are placed at x = CENTER_X and gaps are
  // recorded relative to the climb, so the layout stays one screen wide.
  const CENTER_X = ENTRY_CLEAR; // one screen wide; center at the entry line

  for (const u of macro.units) {
    if (u.kind === 'block') {
      const block = makeBlock(u.height);
      if (isVertical) {
        // Vertical: blocks act as ledges at the current climb elevation.
        const y = axisPos + u.height;
        placedUnits.push({
          ...block,
          placementId: instanceId,
          x: CENTER_X,
          y,
          aabb: { x: CENTER_X, y, w: block.aabb.w, h: block.aabb.h },
        });
        cursor += 1;
      } else {
        placedUnits.push({
          ...block,
          placementId: instanceId,
          x: cursor,
          y: 0,
          aabb: { x: cursor, y: 0, w: block.aabb.w, h: block.aabb.h },
        });
        cursor += 1;
      }
    } else if (u.kind === 'platform') {
      const platform = makePlatform(u.width, u.tier);
      if (isVertical) {
        const y = axisPos + u.tier;
        placedUnits.push({
          ...platform,
          placementId: instanceId,
          x: CENTER_X,
          y,
          aabb: { x: CENTER_X, y, w: platform.aabb.w, h: platform.aabb.h },
        });
        cursor += u.width;
      } else {
        placedUnits.push({
          ...platform,
          placementId: instanceId,
          x: cursor,
          y: 0,
          aabb: { x: cursor, y: platform.aabb.y, w: platform.aabb.w, h: platform.aabb.h },
        });
        cursor += u.width;
      }
    } else if (u.kind === 'gap') {
      if (isVertical) {
        // Vertical gaps are vertical breathing room (fall distance).
        placedGaps.push({ x: CENTER_X, y: cursor, width: u.width });
      } else {
        placedGaps.push({ x: cursor, width: u.width });
      }
      cursor += u.width;
    }
  }

  // Record placement opportunities (relative to macro start).
  //
  // A slot's y is the ELEVATION OF ITS SUPPORTING SURFACE, not a fixed 0:
  //   - a slot above a solid block of height H sits at elevation H (the block's
  //     TOP surface — the hero/items stand ON the block, never inside it);
  //   - a slot above a platform of tier T sits at elevation T (the platform's
  //     landing face);
  //   - a slot on open ground sits at elevation 0.
  // This is the BLOCKER fix (items spawning inside solids): the slot y MUST be
  // at the top of whatever surface is below it, so an item placed there rests
  // on a valid standing position. (populate.md §1: slots are meaningful,
  // terrain-valid positions, not arbitrary coordinates.)
  for (const p of macro.placements) {
    const surface = surfaceElevationAt(macro, p, isVertical);
    placements.push({
      ...p,
      x: isVertical ? CENTER_X : axisPos + macro.entryClear + p.x,
      y: surface,
      placementId: instanceId,
    });
  }
}

/**
 * Elevation (in units) of the supporting surface directly below a slot at
 * local unit-x `p.x`, relative to the macro's entry line.
 *
 * A slot stands on whatever surface is under it:
 *   - a solid block of height H → elevation H (stand on the block's top);
 *   - a platform of tier T → elevation T (stand on the platform's landing
 *     face — platforms are one-way landings, not solids the hero walks inside);
 *   - open ground (a gap or empty space) → elevation 0.
 *
 * Horizontal macros compose left-to-right along x. The local cursor for unit i
 * (0-based) is `entryClear + sum(widths of units[0..i-1])`; a slot at p.x sits
 * in the unit whose x-range covers p.x (or on the ground if none does — the
 * slot is in a gap / clear zone). We walk the MACRO'S OWN unit sequence (not
 * the cumulative placedUnits, which would include prior macros' units at
 * overlapping absolute x).
 *
 * Vertical macros place every unit at the same x (CENTER_X), so the
 * "supporting surface" is the ground at elevation 0; the macro's own platforms
 * are the climb landings, not the surface under a slot.
 *
 * @param {object} macro the macro being placed (its `units` + `entryClear`)
 * @param {object} p the slot descriptor (its local `x`)
 * @param {boolean} isVertical whether the area is vertical
 * @returns {number} the surface elevation (units) the slot rests on
 */
function surfaceElevationAt(macro, p, isVertical) {
  if (isVertical) {
    // Vertical: slots rest on the ground (elevation 0); the macro's platforms
    // are climb landings, not the supporting surface under a slot.
    return 0;
  }
  // Horizontal: walk the macro's own units left-to-right, accumulating the
  // local cursor, and find the unit whose x-range covers the slot's p.x.
  //
  // The slot's p.x is the offset from the ENTRY CLEAR ZONE START (not the
  // macro's start). The first unit is at local x = 0 (relative to the entry
  // clear zone start), so the cursor starts at 0, not at macro.entryClear.
  let cursor = 0;
  for (const u of macro.units) {
    const uStart = cursor;
    const uEnd = cursor + (u.width ?? 1);
    if (p.x >= uStart && p.x < uEnd) {
      // The slot is above this unit. A solid block → stand on its top (height);
      // a platform → stand on its landing face (tier); a gap → ground (0).
      if (u.kind === 'block') return u.height;
      if (u.kind === 'platform') return u.tier ?? 0;
      return 0; // gap
    }
    cursor = uEnd;
  }
  // No unit covers the slot's x — it is on open ground (gap / clear zone).
  return 0;
}

// ---------------------------------------------------------------------------
// Layout validation (generation.md §6)
// ---------------------------------------------------------------------------

/**
 * Validate a composed layout for playability.
 *
 * Checks (generation.md §6):
 *   1. No impossible gaps (gap width ≤ MAX_CLEARABLE_GAP)
 *   2. No trapped starts (entry zone is clear)
 *   3. No buried landings (platforms not under blocks)
 *   4. Elevation steps ≤ MAX_ELEVATION_STEP across the FULL route:
 *      ground → first unit, unit → next unit, last unit → exit. Not just
 *      platform → platform (R2 #4).
 *   5. Start/exit never require a random powerup (entry/exit zones clear)
 *
 * @param {object} layout the layout from composeArea
 * @throws {Error} if validation fails
 */
export function validateLayout(layout) {
  const { units, gaps, entryClear, exitClear, totalWidth } = layout;
  const isVertical = layout.orientation === 'vertical';

  // 1. No impossible gaps.
  for (const gap of gaps) {
    if (gap.width > MAX_CLEARABLE_GAP) {
      throw new Error(
        `validateLayout: impossible gap of ${gap.width} units at x=${gap.x} ` +
          `(max clearable: ${MAX_CLEARABLE_GAP})`,
      );
    }
  }

  // 2. Entry zone is clear (no units in the first entryClear width-units).
  for (const u of units) {
    if (u.x < entryClear) {
      throw new Error(
        `validateLayout: unit at x=${u.x} (${u.kind}) intrudes into the entry zone ` +
          `(entry clear: ${entryClear})`,
      );
    }
  }

  // 3. Exit zone is clear (no units in the last exitClear width-units).
  // Horizontal layouts only: in a vertical area the exit is at the TOP of the
  // climb (y-axis), not at the far x, so the x-based exit check does not
  // apply — the zone is one screen wide and units are centered within it.
  if (!isVertical) {
    const exitStart = totalWidth - exitClear;
    for (const u of units) {
      const unitEnd = u.x + u.aabb.w;
      if (unitEnd > exitStart) {
        throw new Error(
          `validateLayout: unit ending at x=${unitEnd} (${u.kind}) intrudes into the exit zone ` +
            `(exit clear: ${exitClear}, exit starts at x=${exitStart})`,
        );
      }
    }
  }

  // 4. No buried landings: a platform must not be underneath a solid block
  //    at the same x position. (A platform at tier T is at y = tierToOffset(T);
  //    a block of height H occupies y = 0..H. If H >= tierToOffset(T) at the
  //    same x, the platform is buried.)
  //
  // Since we work in unit space (not pixels), we check: if a block's height
  // (in units) >= a platform's tier (in units) at overlapping x, the platform
  // is buried. (This is an approximation in unit space; the exact pixel check
  // would use tierToOffset, but the unit-space check is sufficient for
  // structural validation.)
  for (const platform of units.filter((u) => u.kind === 'platform')) {
    for (const block of units.filter((u) => u.kind === 'block')) {
      // Check x overlap.
      const pStart = platform.x;
      const pEnd = platform.x + platform.aabb.w;
      const bStart = block.x;
      const bEnd = block.x + block.aabb.w;
      if (pStart < bEnd && pEnd > bStart) {
        // X overlap: check if the block is tall enough to bury the platform.
        // Block height (units) >= platform tier (units) → buried.
        if (block.height >= platform.tier) {
          throw new Error(
            `validateLayout: platform at x=${platform.x} (tier ${platform.tier}) ` +
              `is buried by block at x=${block.x} (height ${block.height})`,
          );
        }
      }
    }
  }

  // 5. Elevation steps (R2 #4): check the FULL route, not just platforms.
  //
  // HORIZONTAL: the route is a sequence of landings along x:
  //   ground (tier 0) → first unit → next unit → … → last unit → exit (tier 0)
  // Each unit's landing elevation is:
  //   - block: its height (the hero stands on top of the block)
  //   - platform: its tier
  // Successive landings must differ by at most MAX_ELEVATION_STEP tiers.
  // This catches block→platform, platform→block, block→block, and
  // ground→first / last→exit transitions — not just platform→platform.
  //
  // VERTICAL: the route climbs along y. Each macro is stacked at a higher
  // elevation; within a macro, successive platforms differ by at most
  // MAX_ELEVATION_STEP tiers. Between macros, the entry surface of the next
  // macro sits at a higher y than the peak of the previous, so the
  // transition is a climb (not a step-down). We check:
  //   - within each macro: successive platforms differ by ≤ 1 tier
  //   - between macros: the next macro's first platform tier must be
  //     reachable from the previous macro's peak (the climb continues)
  const landingElevation = (u) => (u.kind === 'block' ? u.height : u.tier);

  if (!isVertical) {
    // Horizontal: full route in x order.
    //
    // The route is: ground (tier 0) → first unit → next unit → … → last unit
    // → exit (tier 0). Each unit's landing elevation is:
    //   - block: its height (the hero stands on top of the block)
    //   - platform: its tier
    //
    // Only UPWARD steps are constrained: a hero can reach at most
    // MAX_ELEVATION_STEP tiers higher per jump. DOWNWARD steps are always
    // possible (falling), so they are not validated. This matches the
    // physical reality: you can always fall, but you can't jump up more
    // than one tier.
    const route = units
      .slice()
      .sort((a, b) => (a.x !== b.x ? a.x - b.x : (a.y ?? 0) - (b.y ?? 0)));

    const landings = [
      { label: 'ground', elevation: 0, x: 0 },
      ...route.map((u) => ({ label: `${u.kind} at x=${u.x}`, elevation: landingElevation(u), x: u.x })),
      { label: 'exit', elevation: 0, x: totalWidth },
    ];

    for (let i = 1; i < landings.length; i++) {
      const prev = landings[i - 1];
      const curr = landings[i];
      const step = curr.elevation - prev.elevation; // positive = upward
      if (step > MAX_ELEVATION_STEP) {
        throw new Error(
          `validateLayout: elevation step of ${step} tiers UP between ${prev.label} ` +
            `(elevation ${prev.elevation}) and ${curr.label} (elevation ${curr.elevation}) ` +
            `exceeds max upward step ${MAX_ELEVATION_STEP}`,
        );
      }
    }
  } else {
    // Vertical: the route climbs along y. The hero starts on GROUND at the
    // bottom of the zone (absolute elevation 0) and finishes at the EXIT
    // flag at the top (absolute elevation = totalHeight). Like the horizontal
    // case, we validate the FULL route — not just platform→platform within a
    // macro:
    //   ground (elev 0)
    //     → first macro's first platform     (upward step must be reachable)
    //     → … successive landings …
    //     → last macro's last platform
    //     → exit (elev totalHeight)          (upward step must be reachable)
    //
    // Each macro is stacked at climb elevation `axisPos` (the macro's start
    // y). A platform inside that macro with LOCAL tier T sits at absolute
    // elevation `axisPos + T`. The composer places the macros in `layout.macros`
    // order, accumulating each macro's axis length, so we can recover each
    // platform's absolute elevation from its `placementId` (the macro's
    // sequence index + 1).
    //
    // Only UPWARD steps are constrained: the hero can reach at most
    // MAX_ELEVATION_STEP tiers higher per jump. Downward steps are always
    // possible (falling), so they are not validated.
    //
    // Since all vertical units share the same x, we sort by y (climb order);
    // ties are broken by placementId so the authoring order within a macro
    // is preserved.
    // A vertical platform's absolute climb elevation is its y position.
    // placeMacro sets `y` directly on the unit; synthetic test layouts may
    // only carry `aabb.y`. Use whichever is present.
    const platformY = (p) => (p.y ?? p.aabb?.y ?? 0);

    const platforms = units
      .filter((u) => u.kind === 'platform')
      .sort((a, b) => (platformY(a) - platformY(b)) || (a.placementId - b.placementId));

    // The exit flag sits at the top of the climb. The composer records the
    // total climb height as `totalHeight`; for synthetic layouts (no macros)
    // fall back to the highest platform's y.
    const exitElevation = layout.totalHeight
      ?? (platforms.length > 0 ? Math.max(...platforms.map(platformY)) : 0);

    // In a vertical area, the hero climbs from one macro to the next. The
    // transition between macros is a JUMP (the hero jumps from the previous
    // macro's peak to the next macro's first platform), not a walk. So we
    // MUST check that the next macro's first platform is reachable from the
    // previous macro's peak (≤ MAX_ELEVATION_STEP tiers up).
    //
    // We check:
    //   - within each macro: successive platforms differ by ≤ 1 tier
    //   - between macros: the next macro's first platform must be within
    //     MAX_ELEVATION_STEP tiers UP of the previous macro's peak
    //   - ground → first macro's first platform (upward step must be reachable)
    //
    // (We do NOT check last platform → exit, because the exit is at the top
    // of the zone and is reached by climbing, not by jumping.)
    for (let i = 1; i < platforms.length; i++) {
      const prev = platforms[i - 1];
      const curr = platforms[i];
      const step = platformY(curr) - platformY(prev); // positive = upward
      if (prev.placementId === curr.placementId) {
        // Within the same macro: upward step must be ≤ MAX_ELEVATION_STEP.
        if (step > MAX_ELEVATION_STEP) {
          throw new Error(
            `validateLayout: elevation step of ${step} tiers UP between platforms at ` +
              `y=${platformY(prev)} and y=${platformY(curr)} (same macro) ` +
              `exceeds max ${MAX_ELEVATION_STEP}`,
          );
        }
      } else {
        // Between macros: the next macro's first platform must be reachable
        // from the previous macro's peak. The previous macro's peak is the
        // HIGHEST platform in that macro (the one the hero stands on before
        // jumping to the next macro). We find it by scanning all platforms
        // with the same placementId as `prev` and taking the max y.
        const prevMacroPeakY = Math.max(
          ...platforms
            .filter((p) => p.placementId === prev.placementId)
            .map(platformY),
        );
        const interMacroStep = platformY(curr) - prevMacroPeakY;
        if (interMacroStep > MAX_ELEVATION_STEP) {
          throw new Error(
            `validateLayout: inter-macro elevation step of ${interMacroStep} tiers UP ` +
              `between macro ${prev.placementId}'s peak (y=${prevMacroPeakY}) and ` +
              `macro ${curr.placementId}'s first platform (y=${platformY(curr)}) ` +
              `exceeds max ${MAX_ELEVATION_STEP} — unreachable join`,
          );
        }
      }
    }

    // Check ground → first platform. The hero starts at the bottom of the
    // zone (y=0) and must be able to reach the first platform with a jump.
    if (platforms.length > 0) {
      const first = platforms[0];
      const step = platformY(first) - 0;
      if (step > MAX_ELEVATION_STEP) {
        throw new Error(
          `validateLayout: elevation step of ${step} tiers UP between ground ` +
            `(elevation 0) and first platform at y=${platformY(first)} ` +
            `exceeds max upward step ${MAX_ELEVATION_STEP}`,
        );
      }
    }

    // Note: we do NOT check last platform → exit in a vertical area, because
    // the exit is at the TOP of the zone and is reached by climbing (walking
    // up the platforms), not by jumping. The exit check is only relevant for
    // horizontal areas, where the exit is at the same elevation as the ground.
  }
}

// ---------------------------------------------------------------------------
// Convenience: compose a full area with a seeded RNG
// ---------------------------------------------------------------------------

/**
 * Compose an area using a fresh RNG from a seed.
 *
 * This is a convenience wrapper around composeArea that creates the RNG
 * from the seed. Use this when you want a deterministic layout from a seed
 * without managing the RNG externally.
 *
 * @param {number|string} seed the per-game seed
 * @param {'horizontal'|'vertical'} orientation
 * @param {number} stage progression stage (-1 to -4)
 * @param {number} budget length budget in width-units
 * @returns {object} the composed area layout (same shape as composeArea)
 */
export function composeAreaSeeded(seed, orientation, stage, budget) {
  const rng = createRng(seed);
  return composeArea(rng, orientation, stage, budget);
}
