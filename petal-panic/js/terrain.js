// Petal Panic — Terrain grammar + seeded per-game RNG.
//
// Source of truth:
//   docs/levels/generation.md   §1 (Terrain grammar), §6 (Playability)
//   docs/levels/structure.md    §5 (Terrain vocabulary)
//   docs/levels/lifecycle.md    §1 (Game start), §6 (Lifetime of randomness)
//
// This module is PURE (no DOM, no game state). It defines the terrain unit
// model (blocks + platforms) and a deterministic per-game RNG. Later tasks
// (3.2 macro composer, 3.3 progression) consume `createRng` and the unit
// grammar to build an area's terrain from a single per-game seed.
//
// Key invariant (lifecycle.md §6): the RNG is rolled ONCE per game. Death /
// Continue rebuild the SAME world from the SAME choices — they never re-roll.
// "Regenerate" means rebuilding the identical world, not re-rolling it. So the
// same seed must always yield the identical sequence of generation choices.

// Physics + hero stats are owned by consts.js / heroDefs.js. We import the REAL
// values (not mirror copies) so that if hero physics change, tier
// reachability stays in lockstep automatically.
import { GRAVITY, DOUBLE_JUMP_FACTOR } from './consts.js';
import { HEROES } from './heroDefs.js';

// Re-export for consumers that import these from terrain.js (e.g. the terrain
// test). The single owner is consts.js; this is a pass-through alias.
export { GRAVITY, DOUBLE_JUMP_FACTOR };

// ---------------------------------------------------------------------------
// Seeded per-game RNG
// ---------------------------------------------------------------------------
// mulberry32: a small, fast, deterministic 32-bit PRNG. Given the same seed it
// produces the same infinite sequence every time, on every platform. This is
// the whole point — the game's generation choices are pinned to the seed.
//
// The seed is normalized to an unsigned 32-bit integer so that any reasonable
// input (number, string) yields a stable, reproducible stream. String seeds
// are hashed with FNV-1a so a themed/level string can be used as the seed.

/**
 * Hash an arbitrary string to a 32-bit unsigned integer (FNV-1a).
 * Used to derive a numeric seed from string input (e.g. a level id).
 *
 * @param {string} str
 * @returns {number} a 32-bit unsigned integer
 */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Create a deterministic per-game RNG from a seed.
 *
 * Same seed → same stream, every time. The returned object is a plain
 * closure over the internal state; it is stateful (each call advances the
 * stream) but fully reproducible.
 *
 * @param {number|string} seed numeric (any integer) or string seed
 * @returns {{
 *   next: () => number,            // [0, 1)
 *   int: (min: number, max: number) => number,  // inclusive integer [min, max]
 *   pick: (arr: any[]) => any,     // a random element of arr
 *   float: (min: number, max: number) => number // [min, max)
 * }}
 */
export function createRng(seed) {
  // Normalize the seed to a 32-bit unsigned int.
  let s;
  if (typeof seed === 'string') {
    s = hashSeed(seed);
  } else {
    // Coerce to a 32-bit int; NaN / non-finite fall back to a stable default.
    const n = Math.trunc(Number(seed));
    s = Number.isFinite(n) ? (n >>> 0) : 0;
  }

  function next() {
    // mulberry32 body.
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    /** Next float in [0, 1). */
    next,
    /** Inclusive random integer in [min, max]. */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** A random element of `arr` (throws on empty — a silent pick would hide a bug). */
    pick(arr) {
      if (!arr.length) throw new Error('createRng.pick: empty array');
      return arr[Math.floor(next() * arr.length)];
    },
    /** Float in [min, max). */
    float(min, max) {
      return min + next() * (max - min);
    },
  };
}

// ---------------------------------------------------------------------------
// Terrain unit model
// ---------------------------------------------------------------------------
// The two units are NOT interchangeable (structure.md §5):
//   - BLOCK: solid landscape, one width unit, heights 1/2/3, rises from the
//     ground and blocks passage from every direction. Cannot be jumped through
//     or dropped through.
//   - PLATFORM: one-way landing surface, one thickness, widths 1/2/3, at
//     elevation tier 1/2/3. Pass-through from below; Down+Jump drop-through.
//
// Dimensions are expressed in "units" (width/height units and elevation tiers),
// not pixels. The macro composer (task 3.2) maps units → pixels using the
// hero-reach constants below when it lays out a concrete area.

/** Block unit grammar (structure.md §5 "Blocks"). */
export const BLOCK = Object.freeze({
  kind: 'block',
  widths: Object.freeze([1]),       // always one width unit
  heights: Object.freeze([1, 2, 3]), // one, two, or three height units
  solid: true,                      // solid AABB from every side
  risesFromGround: true,            // base sits on the ground; top = ground + h
  oneWay: false,                    // never one-way; cannot jump/drop through
});

/** Platform unit grammar (structure.md §5 "Platforms"). */
export const PLATFORM = Object.freeze({
  kind: 'platform',
  widths: Object.freeze([1, 2, 3]), // one, two, or three width units
  tiers: Object.freeze([1, 2, 3]),  // elevation tier 1, 2, or 3
  thickness: 1,                     // one platform thickness
  oneWay: true,                     // pass up through; Down+Jump drops through
  solid: false,
});

// ---------------------------------------------------------------------------
// Double-jump reach (playability — generation.md §6, structure.md §5)
// ---------------------------------------------------------------------------
// Successive top-surface elevations must be spaced so BOTH heroes can reach the
// next tier with a double jump, with a usable margin (not a perfect jump).
//
// These come from the real hero physics (hero.js + consts.js):
//   - GRAVITY = 1500 px/s²
//   - ground jump apex  = jump² / (2·GRAVITY)
//   - double-jump apex  = (0.85·jump)² / (2·GRAVITY) added at the apex
//   - full double-jump reach = ground apex + double apex
//
// The binding constraint is the hero with the SMALLEST reach. We compute the
// reach for every hero and take the minimum, then reserve a MARGIN so the step
// is comfortably clearable, not a frame-perfect apex.

// GRAVITY and DOUBLE_JUMP_FACTOR are re-exported (imported above) so existing
// consumers keep a stable import path, but their single owner is consts.js.
//
// The usable margin is a design-plan decision (structure.md §5: "Spacing must
// work for both heroes with a usable margin, not only a perfect jump"). Its
// concrete value is owned by the single TUNING block (tuning.js) and re-exported
// here so existing importers keep a stable path.
import { TUNING_REACH } from './tuning.js';

// Re-export the margin so the terrain test / composer keep their import path;
// the single owner is tuning.js (TUNING_REACH.reachMargin).
export const REACH_MARGIN = TUNING_REACH.reachMargin;

/**
 * Hero reach data for playability checks. `jump` is the ground-jump impulse
 * (px/s) read directly from heroDefs.js HEROES.<id>.stats.jump — the SAME
 * source the runtime hero uses. The double jump adds
 * DOUBLE_JUMP_FACTOR·jump of extra impulse at the apex.
 *
 * Derived, not hand-maintained: if a hero's jump changes in heroDefs.js this
 * table changes with it, so the tier-spacing invariant never silently drifts.
 */
export const HERO_REACH = Object.freeze(
  Object.fromEntries(
    Object.values(HEROES).map((hero) => [hero.id, Object.freeze({ jump: hero.stats.jump })]),
  ),
);

/**
 * Full double-jump reach (px) for a hero, i.e. the height above the launch
 * surface that a held double jump can attain.
 *
 * @param {'scarlet'|'balthazar'} heroId
 * @returns {number} reach in px
 */
export function doubleJumpReach(heroId) {
  const def = HERO_REACH[heroId];
  if (!def) throw new Error(`doubleJumpReach: unknown hero "${heroId}"`);
  const groundApex = (def.jump * def.jump) / (2 * GRAVITY);
  const doubleImpulse = DOUBLE_JUMP_FACTOR * def.jump;
  const doubleApex = (doubleImpulse * doubleImpulse) / (2 * GRAVITY);
  return groundApex + doubleApex;
}

/**
 * The minimum double-jump reach across ALL heroes (px). Tier spacing must be
 * reachable by the weakest jumper, so this is the governing bound.
 *
 * @returns {number} px
 */
export function minHeroDoubleJumpReach() {
  return Math.min(...Object.keys(HERO_REACH).map((id) => doubleJumpReach(id)));
}

/**
 * Maximum clearable vertical step (px) between two successive top surfaces,
 * after reserving the usable margin. Any single-step elevation gain above this
 * is NOT double-jump reachable by the weakest hero.
 *
 * @returns {number} px
 */
export function maxClearableStep() {
  return minHeroDoubleJumpReach() - REACH_MARGIN;
}

/**
 * Convert an elevation tier (1/2/3) to a world Y offset above the ground
 * (px). Tier 0 (the ground) is 0. Each successive tier is spaced by exactly
 * `maxClearableStep()`, so every step — ground→tier 1, tier 1→2, tier 2→3 —
 * is double-jump reachable with margin for BOTH heroes.
 *
 * The spacing is derived from the real hero reach (not a hand-tuned constant),
 * which is what makes the "reachable by both heroes" invariant hold by
 * construction.
 *
 * @param {number} tier 0 (ground) … 3
 * @returns {number} vertical offset above the ground in px (positive = higher)
 */
export function tierToOffset(tier) {
  if (!Number.isInteger(tier) || tier < 0 || tier > 3) {
    throw new Error(`tierToOffset: tier must be an integer 0..3, got ${tier}`);
  }
  return tier * maxClearableStep();
}

// ---------------------------------------------------------------------------
// Unit factories
// ---------------------------------------------------------------------------
// These build concrete terrain units from the grammar. They are pure data
// builders (no placement / no pixels yet) — the macro composer assigns the
// horizontal position and the pixel scale. They exist so later tasks have a
// single, validated way to emit a unit and so the grammar is enforceable.

/**
 * Build a block unit of a given height.
 *
 * A block is a solid AABB that rises from the ground: its base sits on the
 * ground and its top is `height` units above the ground. It blocks passage from
 * every direction and cannot be jumped through.
 *
 * The returned `aabb` is the block's placement box in unit space, with the
 * ground at y=0 and +y pointing up (so "rises from ground" is encoded directly:
 * the base sits at y=0 and the top is at y=height). A concrete horizontal x
 * is assigned later by the macro composer; here x=0 is the unit's local origin.
 *
 * @param {1|2|3} height height in units (1, 2, or 3)
 * @returns {{kind:'block', width:number, height:number, solid:boolean, oneWay:boolean, risesFromGround:boolean, aabb:{x:number,y:number,w:number,h:number}}}
 */
export function makeBlock(height) {
  if (!BLOCK.heights.includes(height)) {
    throw new Error(`makeBlock: height must be one of ${BLOCK.heights.join('/')} units, got ${height}`);
  }
  const width = BLOCK.widths[0]; // always one width unit
  return {
    kind: 'block',
    width,
    height,
    solid: BLOCK.solid,
    oneWay: BLOCK.oneWay,
    risesFromGround: BLOCK.risesFromGround,
    // Base on the ground (y=0), top at y=height — the block rises from ground.
    aabb: { x: 0, y: 0, w: width, h: height },
  };
}

/**
 * Build a platform unit of a given width and elevation tier.
 *
 * A platform is a one-way landing surface: the hero passes up through it and
 * can drop through with Down+Jump. It occupies a single thickness and sits at
 * elevation tier 1/2/3 (see `tierToOffset` for the world Y).
 *
 * The returned `aabb` is the platform's placement box in unit space. It is
 * anchored to its top surface (the landing face) at the tier's elevation:
 * `y` is the tier offset (px above ground) and the box extends `thickness`
 * downward, so the top edge sits exactly at the tier height. A concrete
 * horizontal x is assigned later by the macro composer; here x=0 is the
 * unit's local origin.
 *
 * @param {1|2|3} width width in units (1, 2, or 3)
 * @param {1|2|3} tier elevation tier (1, 2, or 3)
 * @returns {{kind:'platform', width:number, tier:number, thickness:number, oneWay:boolean, solid:boolean, aabb:{x:number,y:number,w:number,h:number}}}
 */
export function makePlatform(width, tier) {
  if (!PLATFORM.widths.includes(width)) {
    throw new Error(`makePlatform: width must be one of ${PLATFORM.widths.join('/')} units, got ${width}`);
  }
  if (!PLATFORM.tiers.includes(tier)) {
    throw new Error(`makePlatform: tier must be one of ${PLATFORM.tiers.join('/')} units, got ${tier}`);
  }
  const thickness = PLATFORM.thickness;
  const y = tierToOffset(tier); // top surface at the tier's elevation above ground
  return {
    kind: 'platform',
    width,
    tier,
    thickness,
    oneWay: PLATFORM.oneWay,
    solid: PLATFORM.solid,
    // Top edge at the tier offset; the box extends `thickness` below it.
    aabb: { x: 0, y, w: width, h: thickness },
  };
}
