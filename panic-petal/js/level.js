// Petal Panic — Level struct + demo rogue spawner (design §13).
//
// The LEVELS array is declarative: each entry declares WHAT content a run has
// (counts per enemy type, barrels, coin barrels, powerups) plus the fixed
// geometry (platforms, checkpoints, length). The spawner (generateLevel)
// decides WHERE to place the spawnable items along flat ground, respecting a
// minimum spacing so spawns never cluster unfairly and keeping the hero-start
// zone (first SPAWN_START px) and boss arena (last 500 px) clear.
//
// Coins are NOT spawned directly. They come from exactly two sources (design
// §14):
//   - Coin barrels bursting on destruction (handled by object.js / update.js)
//   - Enemy death drops (Enemy.coinDrop config, rolled in updateRealEnemy)
// So `spawn` deliberately has no `coins` field.
//
// This module is pure (no DOM, no canvas) so it's unit-testable in node.

import { Jester } from './jester.js';
import { VineHound } from './vine_hound.js';
import { Violetta } from './violetta.js';
import { JackOLantern } from './jackolantern.js';
import { makeBoris, makeBorisBaby } from './boris_loon.js';
import { makeBarrel, makeWoodBarrel, makeCoinBarrel, makeCheckpoint } from './object.js';
import { Powerup } from './powerup.js';

// ---------------------------------------------------------------------------
// Level definitions (declarative — WHAT, not WHERE)
// ---------------------------------------------------------------------------
// v1 ships one level ("Big Top"). Later levels extend this array; the spawner
// is agnostic to which definition it's handed.

export const LEVELS = [
  {
    name: 'Big Top',
    index: 1,
    boss: 'elephant',
    length: 8000,
    checkpoints: [
      { id: '1-1', x: 2000 },
      { id: '1-2', x: 4000 },
      { id: '1-3', x: 6000 },
      { id: '1-4', x: 7500 },
    ],
    platforms: [
      // Ground: full length. y=500 matches VIEW_H(540) - 40 (floor thickness).
      { x: 0, y: 500, w: 8000, h: 40 },
      // Air platforms (a few) — scattered along the walk for vertical variety.
      { x: 800,  y: 380, w: 150, h: 16 },
      { x: 1500, y: 350, w: 120, h: 16 },
      { x: 2500, y: 370, w: 180, h: 16 },
      { x: 3500, y: 340, w: 140, h: 16 },
      { x: 4500, y: 360, w: 160, h: 16 },
      { x: 5500, y: 380, w: 130, h: 16 },
      { x: 6500, y: 350, w: 150, h: 16 },
    ],
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
const FLYER_REST_ALTITUDE = 150; // adult; baby uses 130 (matches Task 5.1 layout)
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
 * instantiates the fixed geometry (platforms, checkpoints) as-is.
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
 * @param {object} levelDef one entry from LEVELS
 * @returns {{platforms:object[], enemies:object[], barrels:object[],
 *            coinBarrels:object[], powerups:object[], checkpoints:object[]}}
 */
export function generateLevel(levelDef) {
  const platforms = levelDef.platforms.map((p) => ({ ...p }));
  const checkpoints = levelDef.checkpoints.map((c) =>
    makeCheckpoint(c.id, c.x, GROUND_Y - CHECKPOINT_H),
  );

  const spawnEnd = levelDef.length - BOSS_ARENA_PAD;
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
