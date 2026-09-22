// Petal Panic — Level struct (design §13) + the sealed zone model
// (docs/levels/structure.md §1–§4, docs/levels/checkpoints.md §1).
//
// PRIMARY API: buildLevelZones(levelDef) — a level is FIVE SEALED zones
// (areas -1..-4 + a boss zone), each owning its own world bounds and its own
// entry/exit flags. This is the authoritative level structure (task 2.1).
//
// LEGACY (deprecated): the prototype was a single 8000px flat corridor driven
// by LEGACY_CORRIDOR below + generateLevel(). generateLevel() is kept ONLY so
// the existing runtime (systems/update.js) keeps working while the zone engine
// is wired in by later tasks; the LEVELS definition no longer encodes that
// single flat corridor. Do not build new features on the legacy model.
//
// Spawnable content (counts per enemy type, barrels, coin barrels, powerups)
// still lives on each LEVELS entry under `spawn`. The spawner (generateLevel)
// decides WHERE to place the spawnable items along flat ground, respecting a
// minimum spacing so spawns never cluster unfairly and keeping the hero-start
// zone (first SPAWN_START px) and boss arena (last 500 px) clear.
// Coins are NOT spawned directly. They come from exactly two sources (design
// §14):
//   - Coin barrels bursting on destruction (handled by object.js / update.js)
//   - Enemy death drops (Enemy.coinDrop config, rolled in updateRealEnemy)
// So `spawn` deliberately has no `coins` field.
// This module is pure (no DOM, no canvas) so it's unit-testable in node.

import { Jester } from './jester.js';
import { VineHound } from './vine_hound.js';
import { Violetta } from './violetta.js';
import { JackOLantern } from './jackolantern.js';
import { makeBoris, makeBorisBaby } from './boris_loon.js';
import { makeBarrel, makeWoodBarrel, makeCoinBarrel, makeCheckpoint } from './object.js';
import { Powerup } from './powerup.js';
import { VIEW_H } from './view.js';

// ---------------------------------------------------------------------------
// Level definitions (declarative — WHAT, not WHERE)
// ---------------------------------------------------------------------------
// v1 ships one level ("Big Top"). Later levels extend this array; the zone
// model (buildLevelZones) and the legacy spawner (generateLevel) are both
// agnostic to which definition they're handed.
//
// A LEVELS entry declares the level's CONTENT and its zone configuration:
//   - name / index / boss: theme + boss identity
//   - verticalArea: which ordinary area (-2, -3, or -4; never -1) is the
//     vertical climb (structure.md §1). Exactly one of the four ordinary
//     areas is vertical; it is fixed for the whole game.
//   - spawn: counts of every spawnable item (enemies, barrels, powerups).
//
// The entry does NOT carry the single flat-corridor geometry any more. That
// legacy geometry (the 8000px ground + air platforms + corridor checkpoints)
// lives in LEGACY_CORRIDOR below, consumed only by the deprecated
// generateLevel() while the runtime is still wired to it.

export const LEVELS = [
  {
    name: 'Big Top',
    index: 1,
    boss: 'elephant',
    // Which ordinary area is the vertical climb (structure.md §1). -1 is never
    // vertical; -3 is chosen here as the fixed slot for the whole game.
    verticalArea: -3,
    spawn: {
      enemies: {
        jester: 6,
        vine_hound: 4,
        violetta_marionetta: 3,
        jackolantern: 4,
        boris_loon: 3,
        boris_loon_baby: 6,
      },
      explosiveBarrels: 8,
      woodBarrels: 4,
      coinBarrels: 4,
      powerups: {
        ammo: 3,
        invincibility: 1,
        special: 2,
        rapid: 2,
        shield: 1,
        clear: 1,
        energy: 2,
        oneUp: 1,
      },
      // NOTE: no coins field — coins come from coin-barrel bursts + enemy drops.
    },
  },
];

// ---------------------------------------------------------------------------
// LEGACY single-corridor geometry (DEPRECATED — prototype only)
// ---------------------------------------------------------------------------
// The prototype level was ONE flat 8000px corridor: a ground floor, a handful
// of one-way air platforms, and four corridor checkpoints. That model has been
// replaced by the sealed zone model above (task 2.1). It is kept here — decoupled
// from LEVELS — ONLY so the deprecated generateLevel() below (still consumed by
// systems/update.js while the zone engine is wired in) can keep producing a
// working world. New code must use buildLevelZones(); do not build on this.
//
// Kept as a plain object (not on the LEVELS entry) so the declarative level
// definition no longer encodes a single flat corridor.

export const LEGACY_CORRIDOR = {
  length: 8000,
  checkpoints: [
    { id: '1-1', x: 2000 },
    { id: '1-2', x: 4000 },
    { id: '1-3', x: 6000 },
    { id: '1-4', x: 7500 },
  ],
  platforms: [
    // Ground: full length. y=500 matches VIEW_H(540) - 40 (floor thickness).
    // Solid by default (no oneWay flag) — drop-through never affects it (§13).
    { x: 0, y: 500, w: 8000, h: 40 },
    // Air platforms (a few) — scattered along the walk for vertical variety.
    // oneWay: true (design §13): the hero passes up through them and can
    // drop through with Down+Jump; they only land from above while falling.
    { x: 800,  y: 380, w: 150, h: 16, oneWay: true },
    { x: 1500, y: 350, w: 120, h: 16, oneWay: true },
    { x: 2500, y: 370, w: 180, h: 16, oneWay: true },
    { x: 3500, y: 340, w: 140, h: 16, oneWay: true },
    { x: 4500, y: 360, w: 160, h: 16, oneWay: true },
    { x: 5500, y: 380, w: 130, h: 16, oneWay: true },
    { x: 6500, y: 350, w: 150, h: 16, oneWay: true },
  ],
};

// Attach the legacy corridor to the level definition under a clearly-marked
// DEPRECATED field so the existing runtime (systems/update.js, lifecycle.js,
// hud.js) keeps working while the zone engine is wired in by later tasks. The
// PRIMARY zone API — buildLevelZones() — never reads this; it builds the sealed
// zones from the level's own config (index, verticalArea).
LEVELS[0].LEGACY = LEGACY_CORRIDOR;

// ---------------------------------------------------------------------------
// Zone model (docs/levels/structure.md §1–§4, checkpoints.md §1)
// ---------------------------------------------------------------------------
// A level is NOT one long scrolling corridor. It is five SEALED zones:
//   - four ordinary areas, ids -1 … -4
//   - one separate boss zone (its own approach + arena)
// Each zone owns its own world bounds and its own flags. Reaching an exit ends
// the current zone; a new zone then REPLACES it (structure.md §2). Zones are
// independent worlds — they share no geometry and are not physically connected.
//
// This module is pure (no DOM), so the zone model is unit-testable in node.
// Per-zone content (platforms, spawns, boss) is generated by later tasks; the
// model here only fixes the structure every zone must have.

/** Width of each sealed zone's playable world (px). */
export const ZONE_WIDTH = 1600;
/** Y of the floor top inside a zone (matches the prototype GROUND_Y). */
export const ZONE_GROUND_Y = 500;
/** Floor thickness. */
export const ZONE_FLOOR_H = 40;
/** Where the hero / entry flag start inside a zone, from its left edge (px). */
export const ZONE_ENTRY_X = 120;
/** Where the exit flag sits inside a zone, from its left edge (px). */
export const ZONE_EXIT_X = 1480;
/** Checkpoint flag height (matches CHECKPOINT_DEF in object.js). */
export const ZONE_FLAG_H = 48;
/**
 * World height of a horizontal zone (px). A horizontal area is a single-screen
 * walk, so its world is exactly one view tall (VIEW_H).
 */
export const ZONE_H_HORIZONTAL = VIEW_H;
/**
 * World height of a vertical zone (px). A vertical area is an upward climb
 * (structure.md §4) that spans several screens, so its world is taller than a
 * single view. The climb is authored per-zone by later tasks; this fixed height
 * is the structural bound every vertical zone must have.
 */
export const ZONE_H_VERTICAL = VIEW_H * 3;
/**
 * Y offset (from the top of the zone's bounds) where the top platform sits in
 * a vertical zone. The exit flag rests on this platform. In screen coordinates
 * y=0 is the top, so a small offset means "near the top of the climb".
 */
export const VERTICAL_TOP_PLATFORM_OFFSET = 56;

/**
 * The boss checkpoint is the visual marker that "leads to the boss zone".
 * checkpoints.md §1: the -4 exit uses the boss-checkpoint appearance, and the
 * boss zone itself begins beside a boss checkpoint flag too. We mark both with
 * the same appearance id so the renderer can paint one consistent glyph.
 */
export const BOSS_CHECKPOINT = { appearance: 'boss-checkpoint' };

/**
 * Build the fixed geometry (floor + top platform) for one zone.
 *
 * Horizontal / boss zones: a sealed floor at ZONE_GROUND_Y spanning the full
 * width.
 *
 * Vertical zones (structure.md §4): the bottom supporting platform is at the
 * BOTTOM of the zone (y = bounds.y + bounds.h), and a top platform sits near
 * the top of the climb to support the exit flag. The hero climbs from the
 * bottom platform upward to the top platform.
 *
 * @param {object} zone a zone from buildLevelZones()
 * @returns {object[]} the zone's platforms (plain AABBs, all solid)
 */
function zonePlatforms(zone) {
  const b = zone.bounds;
  if (zone.orientation === 'vertical') {
    // Bottom supporting platform (where the hero starts the climb).
    const bottomY = b.y + b.h;
    // Top platform (where the exit flag sits). Offset from the top of the world.
    const topY = VERTICAL_TOP_PLATFORM_OFFSET;
    return [
      { x: b.x, y: bottomY, w: b.w, h: ZONE_FLOOR_H },
      { x: b.x + ZONE_EXIT_X - 60, y: topY, w: 120, h: 16, oneWay: true },
    ];
  }
  // Horizontal / boss: floor at the standard ground level.
  return [
    { x: b.x, y: ZONE_GROUND_Y, w: b.w, h: ZONE_FLOOR_H },
  ];
}

/**
 * Y (top of flag) for a flag of a given kind in a zone.
 *
 * Horizontal / boss zones: flags sit on the floor (bottom of the world).
 * Vertical zones (structure.md §4, checkpoints.md §1): the ENTRY flag sits on
 * the supporting platform at the BOTTOM (the starting platform), and the EXIT
 * flag sits on a platform at the TOP of the climb. So the two flags are at
 * different y positions — bottom entry, top exit.
 *
 * @param {object} zone a zone from buildLevelZones()
 * @param {'entry'|'exit'} kind which flag
 * @returns {number} y (top of the flag box)
 */
function flagY(zone, kind) {
  if (zone.orientation === 'vertical') {
    // In screen coordinates y=0 is the TOP of the world.
    // Entry flag (bottom of climb): sits on the bottom supporting platform,
    // which is at the BOTTOM of the zone → LARGEST y value.
    // Exit flag (top of climb): sits on the top platform near y=0 → SMALLEST y.
    if (kind === 'entry') {
      // Bottom platform is at bounds.y + bounds.h; flag top = platform top - flag height.
      return zone.bounds.y + zone.bounds.h - ZONE_FLAG_H;
    }
    // Top platform is at VERTICAL_TOP_PLATFORM_OFFSET; flag sits on it.
    return VERTICAL_TOP_PLATFORM_OFFSET - ZONE_FLAG_H;
  }
  // Horizontal / boss: both flags rest on the floor.
  return ZONE_GROUND_Y - ZONE_FLAG_H;
}

/**
 * Build the entry flag for a zone (null for area -1).
 * checkpoints.md §1: area -1 has no entry checkpoint drawn; areas -2…-4 have an
 * entry checkpoint at their start; the boss zone begins beside a boss checkpoint.
 *
 * @param {object} zone a zone from buildLevelZones()
 * @returns {object|null} a flag descriptor or null
 */
function zoneEntryFlag(zone) {
  if (zone.kind === 'area' && zone.areaIdx === -1) return null;
  const isBoss = zone.kind === 'boss';
  return {
    id: isBoss ? `${zone.level}-boss` : `${zone.level}${zone.areaIdx}`,
    x: zone.bounds.x + ZONE_ENTRY_X,
    y: flagY(zone, 'entry'),
    // The boss zone's entry flag carries the boss-checkpoint appearance.
    appearance: isBoss ? BOSS_CHECKPOINT.appearance : 'entry',
  };
}

/**
 * Build the exit flag for a zone (null for the boss zone — it has no exit; it
 * is the final zone of the level).
 * checkpoints.md §1: each ordinary area has an exit checkpoint; the -4 exit is a
 * boss checkpoint (boss-checkpoint appearance) that leads to the boss zone.
 *
 * @param {object} zone a zone from buildLevelZones()
 * @returns {object|null} a flag descriptor or null
 */
function zoneExitFlag(zone) {
  if (zone.kind === 'boss') return null;
  const isBossCheckpoint = zone.areaIdx === -4;
  return {
    id: isBossCheckpoint ? `${zone.level}-4-exit` : `${zone.level}${zone.areaIdx}-exit`,
    x: zone.bounds.x + ZONE_EXIT_X,
    y: flagY(zone, 'exit'),
    // -4's exit uses the boss-checkpoint appearance (checkpoints.md §1).
    appearance: isBossCheckpoint ? BOSS_CHECKPOINT.appearance : 'exit',
  };
}

/**
 * Build the five sealed zones for a level.
 *
 * Each zone owns its own world bounds (x, y, w, h) and its own flags. Zones are
 * independent: they share no geometry, so one zone's platforms/checkpoints can
 * never be visible from or collide with another's.
 *
 * @param {object} levelDef one entry from LEVELS
 * @returns {{idx:string|number, level:number, areaIdx:number|null, kind:string,
 *            name:string, orientation:'horizontal'|'vertical'|'boss',
 *            bounds:{x:number,y:number,w:number,h:number},
 *            entryFlag:object|null, exitFlag:object|null, platforms:object[]}[]}
 *   the five zones, in play order: -1, -2, -3, -4, boss.
 */
export function buildLevelZones(levelDef) {
  const level = levelDef.index;
  const areas = [
    { areaIdx: -1, name: `${level}-1` },
    { areaIdx: -2, name: `${level}-2` },
    { areaIdx: -3, name: `${level}-3` },
    { areaIdx: -4, name: `${level}-4` },
  ];

  // Exactly one ordinary area is vertical (structure.md §1): it can be -2, -3,
  // or -4; never -1. The slot is read from the level config (levelDef.verticalArea,
  // which is explicit on every LEVELS entry). A missing/invalid value falls back
  // to -3 so the "exactly one, never -1" invariant holds even for malformed defs.
  const verticalIdx = levelDef.verticalArea ?? -3;

  const zones = areas.map((a) => {
    const orientation = a.areaIdx === verticalIdx ? 'vertical' : 'horizontal';
    // Vertical areas are a taller upward climb (structure.md §4); horizontal
    // areas are a single-screen walk. Heights derive from VIEW_H (view.js).
    const h = orientation === 'vertical' ? ZONE_H_VERTICAL : ZONE_H_HORIZONTAL;
    const bounds = { x: 0, y: 0, w: ZONE_WIDTH, h };
    const zone = {
      idx: a.areaIdx,
      level,
      areaIdx: a.areaIdx,
      kind: 'area',
      name: a.name,
      orientation,
      bounds,
      entryFlag: null, // filled below
      exitFlag: null,
      platforms: null, // filled below (needs orientation)
    };
    zone.platforms = zonePlatforms(zone);
    zone.entryFlag = zoneEntryFlag(zone);
    zone.exitFlag = zoneExitFlag(zone);
    return zone;
  });

  // The boss zone is a separate, self-contained zone: its own approach + arena.
  // It is a horizontal-style arena (own bounds, own floor, own boss checkpoint).
  const bossBounds = { x: 0, y: 0, w: ZONE_WIDTH, h: ZONE_H_HORIZONTAL };
  const bossZone = {
    idx: 'boss',
    level,
    areaIdx: null,
    kind: 'boss',
    name: `${level}-boss`,
    orientation: 'boss',
    bounds: bossBounds,
    entryFlag: null,
    exitFlag: null,
    platforms: null, // filled below
  };
  bossZone.platforms = zonePlatforms(bossZone);
  bossZone.entryFlag = zoneEntryFlag(bossZone);
  bossZone.exitFlag = zoneExitFlag(bossZone);
  zones.push(bossZone);

  return zones;
}

// ---------------------------------------------------------------------------
// Rogue spawner
// ---------------------------------------------------------------------------
// Reads a level definition and returns a fully-instantiated world:
//   { platforms, enemies[], barrels[], coinBarrels[], powerups[], checkpoints[] }
// All entities are real instances (Jester, VineHound, ..., GameObj, Powerup,
// Checkpoint) so the caller can drop them straight into the collision world.

/** Minimum horizontal distance between any two spawned items (px). */
export const MIN_SPACING = 100;
/** Don't spawn in the first N px (hero start area). */
export const SPAWN_START = 500;
/** Don't spawn in the last N px of the level (boss arena). */
export const BOSS_ARENA_PAD = 500;

/** Y where floor-sitting objects rest their top edge (ground top - object height). */
const GROUND_Y = 500; // matches LEVELS[0].platforms[0].y
const BARREL_H = 48;
const POWERUP_H = 28;
const CHECKPOINT_H = 48;
/** Resting altitude offset above the ground for flyer enemies (Boris Loon). */
const FLYER_REST_ALTITUDE = 150; // adult; baby uses 130 (matches layout)
const FLYER_BABY_REST_ALTITUDE = 130;

/**
 * Factory map: enemy type key → constructor at (x, y). Centralized here so
 * adding a new enemy type only requires touching this table + the level defs.
 */
const ENEMY_FACTORIES = {
  jester:               (x, y) => new Jester(x, y),
  vine_hound:           (x, y) => new VineHound(x, y),
  violetta_marionetta:  (x, y) => new Violetta(x, y),
  jackolantern:         (x, y) => new JackOLantern(x, y),
  boris_loon:           (x, y) => makeBoris(x, y),
  boris_loon_baby:      (x, y) => makeBorisBaby(x, y),
};

/**
 * Compute the spawn Y for an enemy given its type. Grounders sit on the floor
 * (top = GROUND_Y - def.h); flyers hover at a fixed altitude above the floor.
 * @param {string} type enemy type key
 * @returns {number} y (top of box)
 */
function enemySpawnY(type) {
  if (type === 'boris_loon') return GROUND_Y - FLYER_REST_ALTITUDE;
  if (type === 'boris_loon_baby') return GROUND_Y - FLYER_BABY_REST_ALTITUDE;
  // Grounders: read height from the factory's def via a throwaway instance? No —
  // we don't want to allocate just to measure. Instead use the known heights:
  switch (type) {
    case 'jester':              return GROUND_Y - 48;
    case 'vine_hound':          return GROUND_Y - 44;
    case 'violetta_marionetta': return GROUND_Y - 50;
    case 'jackolantern':        return GROUND_Y - 40;
    default:                    return GROUND_Y - 48;
  }
}

/**
 * Generate `count` random x positions in [SPAWN_START, SPAWN_END] that respect
 * MIN_SPACING against every position in `existing` AND against each other.
 * Returns fewer than `count` when the space runs out (soft cap — better to
 * under-spawn than violate the spacing rule). Attempts are bounded so a
 * pathological budget can't hang the loop.
 *
 * @param {number} count how many positions to generate
 * @param {number[]} existing already-used x positions (across all categories)
 * @param {number} spawnEnd exclusive upper bound (typically level.length - pad)
 * @returns {number[]} the generated positions (sorted ascending)
 */
export function randomPositions(count, existing = [], spawnEnd = 7500) {
  const positions = [];
  let attempts = 0;
  const MAX_ATTEMPTS = 10000;
  while (positions.length < count && attempts < MAX_ATTEMPTS) {
    const x = SPAWN_START + Math.random() * (spawnEnd - SPAWN_START);
    const all = [...existing, ...positions];
    if (all.every((px) => Math.abs(px - x) >= MIN_SPACING)) {
      positions.push(x);
    }
    attempts++;
  }
  positions.sort((a, b) => a - b);
  return positions;
}

/**
 * Build a fully-instantiated world from a level definition. Randomly places
 * every item in `levelDef.spawn` along flat ground with min spacing, and
 * instantiates the legacy single-corridor geometry (platforms, checkpoints)
 * as-is.
 *
 * DEPRECATED (task 2.1): this produces the old single 8000px corridor world,
 * NOT the sealed zone model. It is kept only so systems/update.js keeps running
 * while the zone engine is wired in by later tasks. The fixed geometry comes
 * from LEGACY_CORRIDOR (not from the LEVELS entry, which no longer encodes a
 * flat corridor); spawn counts still come from levelDef.spawn. New code must
 * use buildLevelZones() instead.
 *
 * The returned object is what systems/update.js consumes:
 *   - platforms: plain AABBs ({x,y,w,h}) — same shape as the old SOLIDS export
 *   - enemies:   Enemy instances (one per spawn.enemies entry)
 *   - barrels:   GameObj instances (explosive)
 *   - coinBarrels: GameObj instances (coin-bursting)
 *   - powerups:  Powerup instances
 *   - checkpoints: Checkpoint instances
 *
 * No loose coins are placed anywhere (design §14: coins only from barrel
 * bursts + enemy death drops).
 *
 * @param {object} levelDef one entry from LEVELS (used for its `spawn` counts)
 * @returns {{platforms:object[], enemies:object[], barrels:object[],
 *            coinBarrels:object[], powerups:object[], checkpoints:object[]}}
 */
export function generateLevel(levelDef) {
  const platforms = LEGACY_CORRIDOR.platforms.map((p) => ({ ...p }));
  const checkpoints = LEGACY_CORRIDOR.checkpoints.map((c) =>
    makeCheckpoint(c.id, c.x, GROUND_Y - CHECKPOINT_H),
  );

  const spawnEnd = LEGACY_CORRIDOR.length - BOSS_ARENA_PAD;
  const usedPositions = []; // shared across ALL categories (enemies + barrels + ...)

  // --- Enemies ---------------------------------------------------------------
  const enemies = [];
  for (const [type, count] of Object.entries(levelDef.spawn.enemies ?? {})) {
    const factory = ENEMY_FACTORIES[type];
    if (!factory) continue; // unknown type — skip rather than crash
    const y = enemySpawnY(type);
    const positions = randomPositions(count, usedPositions, spawnEnd);
    for (const x of positions) {
      enemies.push(factory(x, y));
      usedPositions.push(x);
    }
  }

  // --- Barrels (destructible solids) -----------------------------------------
  const barrels = [];
  const barrelPositions = randomPositions(
    levelDef.spawn.explosiveBarrels ?? 0, usedPositions, spawnEnd,
  );
  for (const x of barrelPositions) {
    barrels.push(makeBarrel(x, GROUND_Y - BARREL_H));
    usedPositions.push(x);
  }

  // --- Wood barrels (plain, non-explosive) -----------------------------------
  const woodBarrels = [];
  const woodBarrelPositions = randomPositions(
    levelDef.spawn.woodBarrels ?? 0, usedPositions, spawnEnd,
  );
  for (const x of woodBarrelPositions) {
    woodBarrels.push(makeWoodBarrel(x, GROUND_Y - BARREL_H));
    usedPositions.push(x);
  }

  // --- Coin barrels (coin source) --------------------------------------------
  const coinBarrels = [];
  const coinBarrelPositions = randomPositions(
    levelDef.spawn.coinBarrels ?? 0, usedPositions, spawnEnd,
  );
  for (const x of coinBarrelPositions) {
    coinBarrels.push(makeCoinBarrel(x, GROUND_Y - BARREL_H));
    usedPositions.push(x);
  }

  // --- Powerups (scattered pickups) ------------------------------------------
  // Spawn all powerups as a single batch to maximize available space.
  const totalPowerups = Object.values(levelDef.spawn.powerups ?? {}).reduce((a, b) => a + b, 0);
  const puPositions = randomPositions(totalPowerups, usedPositions, spawnEnd);
  const powerups = [];
  let puIdx = 0;
  for (const [type, count] of Object.entries(levelDef.spawn.powerups ?? {})) {
    for (let i = 0; i < count && puIdx < puPositions.length; i++) {
      const x = puPositions[puIdx++];
      powerups.push(new Powerup(type, x, GROUND_Y - POWERUP_H));
      usedPositions.push(x);
    }
  }

  return { platforms, enemies, barrels, woodBarrels, coinBarrels, powerups, checkpoints };
}
