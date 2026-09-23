// Petal Panic — update system (fixed 60Hz physics step).
// integration test: a hero-colored box moved by arrow keys / WASD,
// colliding against static orange SOLID platforms via CollisionWorld + resolve().
// Debug mode toggles the unified debug overlay in render.js.
// hero-following camera clamped to level bounds with facing
// look-ahead; the test level is now longer than the viewport so the camera
// scrolls, and placeholder enemies/projectiles/pickups exercise every §16
// debug-overlay color.

import { input } from '../input.js';
import { VIEW_W, VIEW_H } from '../view.js';
import { Entity } from '../entity.js';
import { LAYER } from '../consts.js';
import { CollisionWorld, resolve, aabbOverlap } from '../collision.js';
import { Camera } from '../camera.js';
import { Anim, makeTestFrame } from '../anim.js';
import { Hero, WEAPON_SPECIAL } from '../hero.js';
import { HEROES, ATTACK_MELEE, ATTACK_SPECIAL_MELEE, ATTACK_SUPERMOVE } from '../heroDefs.js';
import { projectilePool, specialPool, dirAngle } from '../projectile.js';
import { damage } from '../damage.js';
import { applyKnockback } from '../knockback.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../hitbox.js';
import { S, getState, setState, STATE_NAMES, tryTransition, onTransition } from '../state.js';
import { dispatchScreenInput } from '../screens.js';
import { Jester } from '../jester.js';
import { VineHound, VINE_HOUND_DEF } from '../vine_hound.js';
import { Violetta, VIOLETTA_DEF } from '../violetta.js';
import { JackOLantern } from '../jackolantern.js';
import { BorisLoon, BORIS_DEF, makeBorisBaby } from '../boris_loon.js';
import { Elephant, makeElephant, BOSS_TRIGGER_RADIUS, WEAK_POINT_MULT } from '../boss.js';
import { makeBossZone, BZ_APPROACH, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT } from '../bossZone.js';
import { particles, coins } from '../particles.js';
import { Effects } from '../effects.js';
import { fireManual } from '../effects/index.js';
import { makeBarrel, makeWoodBarrel, makeCoinBarrel, GameObj, Checkpoint, makeCheckpoint } from '../object.js';
import { Debug, initSpawnTable, SPAWN_KEYS } from "../debug.js";
import { resolveExplosion } from '../explosion.js';
import { Powerup, POWERUP_DEFS, POWERUP_TYPES } from '../powerup.js';
import { COIN_TYPES } from '../coin.js';
import { LEVELS, buildLevelZones, buildAllZoneTerrain, ZONE_ENTRY_X, ZONE_GROUND_Y } from '../level.js';
import { startGame, startLife, continueRun, restoreArea, bindAreaContext, rememberInitial, setRegenerateWorld, showAreaEntry, formatAreaId, showLevelReward, recordAreaEntrySnapshot, setAreaEntryFadeOutCallback } from '../lifecycle.js';
import { getLevelConfig, getStageBudget } from '../levelConfigs.js';
import { populateArea, populationSnapshot, UNIT_PX } from '../macros.js';
import { createRng, tierToOffset } from '../terrain.js';
import { Theater } from '../effects/theater.js';
import { dumpTrace, record, recordAreaMap } from '../stats.js';
import { TUNING } from '../tuning.js';

// --- Zone-engine world (task 7.1 — the sealed zone model IS the world) ------
// (Hero movement feel lives in js/hero.js; level geometry is zone-driven.)
//
// The runtime no longer owns a flat corridor. The authoritative structure is
// the sealed zone model (buildLevelZones): a level is five independent zones
// (areas 1..4 + boss). Each zone's terrain is composed by the macro composer
// (buildAllZoneTerrain) and its enemies/barrels/powerups are resolved by the
// population resolver (populateArea) from the level's per-stage budgets
// (levelConfigs.js). The ACTIVE zone's composed content is installed into the
// collision world; switching zones swaps ALL world contents (structure.md §2).
const LEVEL_DEF = LEVELS[0];
// The level config (per-stage budgets, boss, vertical slot) the generator
// consumes (levelConfigs.js — the authoritative Level 1 config).
const LEVEL_CONFIG = getLevelConfig(LEVEL_DEF.index) ?? {};

// --- Terrain → pixel AABB (unit space from the composer → world pixels) ------
// A placed unit carries a unit-space aabb {x,y,w,h}: x/y are unit offsets, w/h
// are unit counts. Horizontal terrain composes along X (units→px via UNIT_PX)
// and rises from the zone floor (a block of height H occupies the H px above
// the floor). Vertical terrain composes along Y (a climb of H units is H px
// above the bottom platform) within the fixed one-screen width.
// (unit → px via UNIT_PX, imported from macros.js — single source of truth).
function horizontalUnitBox(zone, u) {
  const b = zone.bounds;
  const px = b.x + u.aabb.x * UNIT_PX;
  const py = b.y + b.h - u.aabb.y * UNIT_PX - u.aabb.h * UNIT_PX;
  return { x: px, y: py, w: u.aabb.w * UNIT_PX, h: u.aabb.h * UNIT_PX, oneWay: u.oneWay };
}
function verticalUnitBox(zone, u) {
  const b = zone.bounds;
  const px = b.x + u.aabb.x * UNIT_PX;
  const py = b.y + b.h - (u.aabb.y + u.aabb.h) * UNIT_PX;
  return { x: px, y: py, w: u.aabb.w * UNIT_PX, h: u.aabb.h * UNIT_PX, oneWay: u.oneWay };
}
/** A slot's surface elevation (units) to the y of its top surface (world px). */
function surfaceY(zone, elevationUnits) {
  const b = zone.bounds;
  return b.y + b.h - elevationUnits * UNIT_PX;
}
/** A slot's x position (units) to world px. */
function slotX(zone, unitX) {
  return zone.bounds.x + unitX * UNIT_PX;
}

// --- Entity instantiation from population items (plain {x,y,type} slots) -----
const ENEMY_FACTORIES = {
  jester: (x, y) => new Jester(x, y),
  vine_hound: (x, y) => new VineHound(x, y),
  violetta_marionetta: (x, y) => new Violetta(x, y),
  jackolantern: (x, y) => new JackOLantern(x, y),
  boris_loon: (x, y) => makeBoris(x, y),
  boris_loon_baby: (x, y) => makeBorisBaby(x, y),
};
const BARREL_FACTORIES = {
  explosive: (x, y) => makeBarrel(x, y),
  wood: (x, y) => makeWoodBarrel(x, y),
  coin: (x, y) => makeCoinBarrel(x, y),
};

/**
 * Instantiate one zone's playable world from its composed terrain + population
 * (generation.md §4, populate.md §1–§5). Pure over the inputs — the same zone
 * + population always yields the same world (deterministic per game).
 *
 * @param {object} zone a zone from buildLevelZones()
 * @param {object} layout the composed terrain layout (buildZoneTerrain)
 * @param {object} population the resolved population (populateArea)
 * @returns {{solids:object[], enemies:object[], barrels:object[],
 *            powerups:object[], checkpoints:object[]}}
 */
function instantiateZone(zone, layout, population) {
  const isVertical = zone.orientation === 'vertical';
  const boxOf = isVertical ? verticalUnitBox : horizontalUnitBox;

  // Terrain: the zone's structural platforms (floor / bottom+top) plus the
  // composed macro units (solid blocks + one-way platforms).
  const solids = zone.platforms.map((p) => ({ ...p }));
  for (const u of layout?.units ?? []) {
    if (u.kind === 'block' || u.kind === 'platform') solids.push(boxOf(zone, u));
  }

  // Enemies / barrels / powerups: instantiate on the slot's surface.
  const enemies = (population?.enemies ?? []).map((it) => {
    const f = ENEMY_FACTORIES[it.type];
    if (!f) return null; // unknown type — skip (soft) rather than crash
    const x = slotX(zone, it.x);
    const y = surfaceY(zone, it.y ?? 0) - (f(0, 0).h ?? 0); // feet on the surface
    return f(x, y);
  }).filter(Boolean);

  const barrels = (population?.barrels ?? []).map((it) => {
    const f = BARREL_FACTORIES[it.type];
    if (!f) return null;
    return f(slotX(zone, it.x), surfaceY(zone, it.y ?? 0) - 48);
  }).filter(Boolean);

  const powerups = (population?.powerups ?? []).map((it) => {
    return new Powerup(it.type, slotX(zone, it.x), surfaceY(zone, it.y ?? 0) - 28);
  });

  // Checkpoints: the entry flag (areas 2..4 + boss) and the exit flag
  // (ordinary areas; the 4 exit is the boss checkpoint). Area 1 has no entry
  // flag (checkpoints.md §1). Flags are zone-local flag descriptors.
  const checkpoints = [];
  const mkFlag = (f, isEntry) => {
    const c = makeCheckpoint(f.id, zone.bounds.x + f.x, f.y, { isEntry, appearance: f.appearance });
    // A freshly instantiated flag must start un-triggered (checkpoints.md §2).
    // If it doesn't, something mutated a shared instance — log loudly so the
    // stale-state leak is visible instead of silently swallowing area-clears.
    if (c.triggered) console.warn(`[instantiateZone] ${f.id} created pre-triggered — stale state leak`);
    return c;
  };
  if (zone.entryFlag) checkpoints.push(mkFlag(zone.entryFlag, true));
  if (zone.exitFlag) checkpoints.push(mkFlag(zone.exitFlag, false));

  return { solids, enemies, barrels, powerups, checkpoints };
}

/**
 * Build the full per-game world: compose terrain for every ordinary area from
 * the game seed and resolve each area's population from the level's per-stage
 * budgets. The boss zone is a self-contained arena (no composed terrain /
 * population — the boss encounter owns it).
 *
 * Deterministic per seed (lifecycle.md §6: rolled ONCE per game).
 *
 * @param {object} levelDef the level definition
 * @param {object} config the level config (levelConfigs.js)
 * @param {number|string} seed the per-game seed
 * @returns {{zones:object[], terrain:Map<number,object>, population:Map<number,object>,
 *            world:Map<number,object>}}
 */
function buildWorld(levelDef, config, seed) {
  const zones = buildLevelZones(levelDef);
  // Compose terrain biased by the level CONFIG's macroWeights (levelConfigs.js,
  // generation.md §5/§5b) — later levels weight harder macro tiers. The legacy
  // LEVELS entry (levelDef) carries no macroWeights, so the config is the bias
  // source; zones still come from levelDef's index/verticalArea.
  const terrain = buildAllZoneTerrain(config, seed); // areaIdx → layout
  // Expose the composed terrain + seed so the trace's areaMap can snapshot how
  // each area's terrain was generated (stable for the whole game).
  _lastTerrain = terrain;
  _lastSeed = seed;
  const population = new Map();
  const world = new Map();
  const rng = createRng(seed); // fresh stream for population (terrain consumed its own)
  for (const zone of zones) {
    if (zone.kind !== 'area') continue;
    const layout = terrain.get(zone.areaIdx);
    const stageBudget = getStageBudget(config, zone.areaIdx) ?? { enemies: {}, powerups: {}, barrels: {} };
    const pop = populateArea(rng, layout, {
      enemies: stageBudget.enemies ?? {},
      powerups: stageBudget.powerups ?? {},
      powerupWeights: config.powerupWeights,
      barrels: stageBudget.barrels ?? {},
    });
    population.set(zone.areaIdx, populationSnapshot(pop));
    world.set(zone.areaIdx, instantiateZone(zone, layout, pop));
  }
  return { zones, terrain, population, world };
}

// A genuinely new game (lifecycle.md §1/§6) establishes fresh random generation
// choices; death and Continue never reroll, so a run's arrangement is fixed for
// the whole game. The world is a module-level singleton owned by this module
// (its collision world, camera, and debug overlay are all bound to it).
// The most recently composed terrain + seed, exposed so the trace's areaMap can
// snapshot each area's generated layout (see captureAreaMap). Set by buildWorld.
let _lastTerrain = null;
let _lastSeed = null;

let world = buildWorld(LEVEL_DEF, LEVEL_CONFIG, 1);

/**
 * Snapshot the generated terrain into the hero's trace areaMap (one entry per
 * ordinary area). Called once per new game, right after startGame builds the
 * fresh hero + trace. Each entry stores the seed, orientation, stage, budget,
 * the macro ids placed, and the placed units in UNIT SPACE (the PNG/debug tool
 * multiplies by UNIT_PX when drawing). The layout is stable for the whole game
 * (rolled once per seed), so this snapshot stays accurate even if macro
 * definitions change later.
 * @param {Hero} h the fresh hero (owns .traceStats)
 */
function captureAreaMap(h) {
  if (!h?.traceStats || !_lastTerrain) return;
  const level = h.currentLevel ?? 1;
  for (const [areaIdx, layout] of _lastTerrain) {
    const areaId = formatAreaId(level, areaIdx);
    recordAreaMap(h, areaId, {
      seed: _lastSeed,
      orientation: layout.orientation,
      stage: layout.stage,
      budget: layout.budget,
      macros: (layout.macros ?? []).map((id) => ({ id })),
      placedUnits: (layout.units ?? []).map((u) => ({
        kind: u.kind,
        x: u.aabb.x,
        y: u.aabb.y,
        w: u.aabb.w,
        h: u.aabb.h,
        tier: u.tier,
        height: u.height,
        oneWay: !!u.oneWay,
      })),
    });
  }
}
const collisionWorld = new CollisionWorld({ cellSize: 64 });

// Floor top y (the zone's ground level). Used by bomb/coin bounce logic.
const FLOOR_TOP = ZONE_GROUND_Y;
// Level length: the active zone's width. The hero is clamped to the zone's
// bounds (not a fixed corridor length). This is the zone's playable width.
// (The old fixed 8000px corridor is gone; each zone owns its own bounds.)

// --- Area-clear sequence (checkpoints.md §2) -----------------------------------
// When the hero reaches an area's EXIT flag the area is cleared and the next
// zone is generated. The sequence (checkpoints.md §2, structure.md §2):
//   1. activate exit flag
//   2. celebratory flash effect (screenFlash)
//   3. 'X-Y CLEAR' banner
//   4. fade out (black overlay driven by getClearFadeAlpha)
//   5. show next area's entry screen (showAreaEntry)
//   6. fade into the new zone at its start
//
// The sequence is driven by a small state machine stepped in update() so it
// does not depend on frame timing. The banner is a full-screen presentation
// drawn by render.js (getClearBanner returns the text or null). The fade-out
// is a black overlay; the fade-in reuses the same mechanism after the entry
// screen is confirmed.
//
// State: 'idle' | 'flash' | 'banner' | 'fadeOut' | 'fadeIn'
// Concrete durations are the design-plan values checkpoints.md §2 defers;
// their single owner is the TUNING block (tuning.js).
const CLEAR_SEQ = {
  FLASH: TUNING.clearFlash,   // seconds of celebratory flash
  BANNER: TUNING.clearBanner, // seconds the 'X-Y CLEAR' banner is held
  FADE_OUT: TUNING.clearFadeOut, // seconds to fade to black before the entry screen
  FADE_IN: TUNING.clearFadeIn,   // seconds to fade into the new zone after the entry screen
};
let clearSeq = {
  state: 'idle',
  timer: 0,
  bannerText: null, // the 'X-Y CLEAR' text shown during the banner phase
  pendingArea: null, // the area index to advance to after the fade-out completes
  pendingFadeIn: false, // true when the next AREA_ENTRY→PLAY should start a fade-in
};

/**
 * The current clear-sequence state. Exposed for render.js and tests.
 * @returns {{state:string, timer:number, bannerText:string|null, pendingArea:number|null}}
 */
export function getClearSequence() {
  return clearSeq;
}

/**
 * The 'X-Y CLEAR' banner text, or null when the banner is not showing.
 * render.js reads this to draw the full-screen banner overlay.
 */
export function getClearBanner() {
  return clearSeq.state === 'banner' ? clearSeq.bannerText : null;
}

/**
 * The black-overlay alpha for the area-clear fade. Returns 0 when no fade is
 * active; 1 during the fade-out (fully black before the entry screen) and
 * during the fade-in (ramping from black into the new zone). render.js reads
 * this to draw the overlay (the same mechanism as the death fade).
 */
export function getClearFadeAlpha() {
  if (clearSeq.state === 'fadeOut') {
    const t = clearSeq.timer / CLEAR_SEQ.FADE_OUT;
    return Math.max(0, Math.min(1, t));
  }
  if (clearSeq.state === 'fadeIn') {
    const t = clearSeq.timer / CLEAR_SEQ.FADE_IN;
    return Math.max(0, Math.min(1, 1 - t));
  }
  return 0;
}

/**
 * Begin the area-clear sequence: fire the celebratory screen flash and show
 * the 'X-Y CLEAR' banner. The fade-out begins after the banner. Called from
 * the checkpoint handler when the hero reaches an exit flag.
 *
 * @param {string} areaId the area identifier being cleared (e.g. '1-1')
 * @param {number} nextArea the area index to advance to after the fade
 */
export function onExitFlagReached(areaId, nextArea) {
  console.log(`[clear] exit flag reached: ${areaId} → next area ${nextArea}`);
  // Fire the celebratory screen flash (reuse the existing screenFlash effect).
  fireManual({ type: 'screen-flash', params: { strength: 1 } }, null, { view: { w: VIEW_W, h: VIEW_H } });
  clearSeq = {
    state: 'banner',
    timer: 0,
    bannerText: `${areaId} CLEAR`,
    pendingArea: nextArea,
    pendingFadeIn: true,
  };
}

/**
 * Debug (W): wrap the hero to the NEXT area immediately — skip the celebratory
 * banner and fade-out entirely and go straight to the next area's entry screen.
 * This lets a developer step through every world (1-1 → 1-2 → … → boss) with
 * one press each, no waiting for the clear animation.
 *
 * Works from PLAY and from the AREA_ENTRY view: while the entry screen is up,
 * pressing W again immediately advances to the following area. No-op when
 * already mid-clear-sequence (avoid double-triggering) or in the boss zone.
 * Gated on Debug.enabled at the caller.
 */
export function debugWrapToNextArea() {
  // Don't stack another advance while one is already in flight.
  if (clearSeq.state !== 'idle') return;
  const zone = getActiveZone(hero);
  if (zone.kind === 'boss') {
    // At the boss zone there is no further area in this level. Wrap back to
    // area 1 of the current level so the developer can re-test the run quickly.
    // (If multiple levels were supported this would advance to the next
    // level's area 1 instead.)
    Debug.logEvent('wrap: boss → level 1-1 (restart)');
    hero.currentArea = 1;
    const z1 = getActiveZone(hero);
    if (z1.kind === 'area' && world.world.has(z1.areaIdx)) {
      loadActiveZone(z1, world.world.get(z1.areaIdx));
    }
    hero.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y - hero.h };
    recordAreaEntrySnapshot(hero);
    camera.setZoneBounds(z1);
    showAreaEntry(hero, areaContext);
    beginAreaEntryPresentation(); // reset the timer (transition may not fire if already in AREA_ENTRY)
    return;
  }
  if (zone.kind !== 'area') return;
  const nextArea = zone.areaIdx === 4 ? AREA_BOSS : zone.areaIdx + 1;
  Debug.logEvent(`wrap → ${formatAreaId(hero.currentLevel, nextArea)}`);
  // Advance directly: set the hero's area, load the zone content, place the
  // checkpoint, record the snapshot, and show the entry screen — skipping the
  // banner + fade-out that onExitFlagReached would otherwise play.
  hero.currentArea = nextArea;
  const nextZone = getActiveZone(hero);
  if (nextZone.kind === 'area' && world.world.has(nextZone.areaIdx)) {
    loadActiveZone(nextZone, world.world.get(nextZone.areaIdx));
  } else if (nextZone.kind === 'boss') {
    const bossCp = nextZone.entryFlag
      ? [makeCheckpoint(nextZone.entryFlag.id, nextZone.entryFlag.x, nextZone.entryFlag.y, { isEntry: true, appearance: nextZone.entryFlag.appearance })]
      : [];
    loadActiveZone(nextZone, { solids: nextZone.platforms.map(p => ({...p})), enemies: [], barrels: [], powerups: [], checkpoints: bossCp });
  }
  if (nextZone.kind === 'boss') {
    hero.checkpoint = { x: bossZone.approachStartX - hero.w / 2, y: ZONE_GROUND_Y - hero.h };
  } else if (nextZone.entryFlag) {
    hero.checkpoint = { x: nextZone.bounds.x + nextZone.entryFlag.x, y: nextZone.entryFlag.y };
  } else {
    hero.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y - hero.h };
  }
  recordAreaEntrySnapshot(hero);
  camera.setZoneBounds(nextZone);
  showAreaEntry(hero, areaContext);
  beginAreaEntryPresentation(); // reset the timer (transition may not fire if already in AREA_ENTRY)
}

/**
 * Step the clear-sequence state machine. Called from update() during PLAY.
 * Advances the timer and transitions between phases:
 *   banner → fadeOut → (showAreaEntry) → [entry screen confirmed] → fadeIn → idle
 *
 * @param {number} dt seconds
 */
export function stepClearSequence(dt) {
  if (clearSeq.state === 'idle') return;
  clearSeq.timer += dt;
  if (clearSeq.state === 'banner') {
    if (clearSeq.timer >= CLEAR_SEQ.BANNER) {
      clearSeq.state = 'fadeOut';
      clearSeq.timer = 0;
    }
  } else if (clearSeq.state === 'fadeOut') {
    if (clearSeq.timer >= CLEAR_SEQ.FADE_OUT) {
      // Fully faded: show the next area's entry screen. The attempt begins
      // when the player confirms it (lifecycle.md §2); the fade-in is started
      // when the entry screen is confirmed (AREA_ENTRY→PLAY transition).
      const area = clearSeq.pendingArea;
      clearSeq.state = 'idle';
      clearSeq.timer = 0;
      clearSeq.bannerText = null;
      clearSeq.pendingArea = null;
      // Mark that the next AREA_ENTRY→PLAY should start the fade-in.
      clearSeq.pendingFadeIn = true;
      // Advance the hero's area to the next zone-model area (BLOCKER 1/2).
      // The zone model uses areas 1, 2, 3, 4, boss; pendingArea is now
      // in the zone-model convention (e.g. 2 for the second area).
      hero.currentArea = area;
      const nextZone = getActiveZone(hero);
      // BLOCKER 2: swap the ACTIVE zone's world content so the previous
      // zone's terrain, enemies, barrels, powerups, and checkpoints do not
      // linger after the advance (structure.md §2: "a new zone replaces it").
      // The boss zone has no stored population (buildWorld skips non-area
      // zones), so loadActiveZone uses its fallback (zone.platforms = just
      // the floor) — clearing all previous-area entities.
      if (nextZone.kind === 'area' && world.world.has(nextZone.areaIdx)) {
        loadActiveZone(nextZone, world.world.get(nextZone.areaIdx));
        console.log(`[zone] loaded zone ${nextZone.areaIdx}, checkpoints: ${checkpoints.map(c => c.checkpointId + (c.isEntry ? '(entry)' : '(exit)')).join(', ')}`);
      } else if (nextZone.kind === 'boss') {
        // The boss zone has no composed population, but it DOES install its
        // entry flag (the boss checkpoint) so the hero can respawn beside it
        // after a death. Pass a minimal content object with just the checkpoint.
        const bossCp = nextZone.entryFlag
          ? [makeCheckpoint(nextZone.entryFlag.id, nextZone.entryFlag.x, nextZone.entryFlag.y, { isEntry: true, appearance: nextZone.entryFlag.appearance })]
          : [];
        loadActiveZone(nextZone, { solids: nextZone.platforms.map(p => ({...p})), enemies: [], barrels: [], powerups: [], checkpoints: bossCp });
        console.log(`[zone] loaded boss zone (empty arena + checkpoint)`);
      } else {
        console.log(`[zone] WARNING: no content for zone ${nextZone.areaIdx} (kind=${nextZone.kind}, has=${world.world.has(nextZone.areaIdx)})`);
      }
      // Set the checkpoint to the next zone's entry flag position so
      // startLife can latch the matching flag. For area 1 (no entry
      // flag), use the zone's start position. For the BOSS zone, place the
      // hero at the approach START (right side) so the APPROACH state has
      // room to walk left ~1 screen before the intro presentation begins.
      if (nextZone.kind === 'boss') {
        const bz = bossZone;
        hero.checkpoint = { x: bz.approachStartX - hero.w / 2, y: ZONE_GROUND_Y - hero.h };
      } else if (nextZone.entryFlag) {
        hero.checkpoint = {
          x: nextZone.bounds.x + nextZone.entryFlag.x,
          y: nextZone.entryFlag.y,
        };
      } else {
        // Area -1 has no entry flag; use the zone start position.
        hero.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y - hero.h };
      }
      // Accounting snapshot (game-rules.md §4): record the entry totals for
      // this genuine area advance so a later death restart of the area can
      // roll the run stats back to them (the 'rollback' policy).
      recordAreaEntrySnapshot(hero);
      showAreaEntry(hero, areaContext);
    }
  } else if (clearSeq.state === 'fadeIn') {
    if (clearSeq.timer >= CLEAR_SEQ.FADE_IN) {
      clearSeq.state = 'idle';
      clearSeq.timer = 0;
      clearSeq.bannerText = null;
      clearSeq.pendingArea = null;
    }
  }
}

/**
 * Begin the fade-in into the new zone. Called when the entry screen is
 * confirmed (the attempt begins). Places the hero at the new zone's start
 * and starts the fade-in.
 */
export function beginClearFadeIn() {
  if (!clearSeq.pendingFadeIn) return; // not a clear-sequence entry
  clearSeq.pendingFadeIn = false;
  clearSeq.state = 'fadeIn';
  clearSeq.timer = 0;
  // Place the hero at the new zone's start on the GROUND (not above the
  // entry flag). The entry flag is a naive sprite with zero collision; the
  // hero should stand on the floor beside it, not drop onto it.
  const zone = getActiveZone(hero);
  if (zone.orientation === 'vertical') {
    // Vertical: hero starts on the bottom platform.
    const bottomY = zone.bounds.y + zone.bounds.h;
    hero.x = zone.bounds.x + ZONE_ENTRY_X;
    hero.y = bottomY - hero.h;
  } else {
    // Horizontal / boss: hero starts on the floor.
    hero.x = zone.bounds.x + ZONE_ENTRY_X;
    hero.y = ZONE_GROUND_Y - hero.h;
  }
  hero.checkpoint = { x: hero.x, y: hero.y };
  // Re-clamp the camera to the new zone's bounds (task 2.3) so it cannot reveal
  // the previous or next zone; a fresh vertical climb also resets its ascent.
  camera.setZoneBounds(zone);
}

// --- Area-entry auto-advance (checkpoints.md §3) ------------------------------
// The level-start / area-entry view is a NON-interactive presentation: it fades
// in fast, holds for TUNING.areaEntryHold seconds, then fades out just as fast
// and starts play on its own — no confirm or navigation required (lifecycle.md
// §2: "show the entry screen, then begin play"). This small state machine owns
// that timing; render.js reads getAreaEntryFadeAlpha() to draw the black overlay
// (the same mechanism as the clear/death fades).
const AREA_ENTRY_FADE = 0.4; // seconds for the fast fade-in AND fade-out
let areaEntrySeq = { state: 'idle', timer: 0, startedAttempt: false };

/** Begin the area-entry presentation (fast fade-in → hold → fast fade-out). */
export function beginAreaEntryPresentation() {
  areaEntrySeq = { state: 'fadeIn', timer: 0, startedAttempt: false };
}

// Wire lifecycle.js's manual confirm/escape path to begin the fade-out overlay
// after it has already started the attempt + transitioned to PLAY. This ramps
// the black overlay down over the live world instead of leaving it pinned.
setAreaEntryFadeOutCallback(() => {
  // The attempt is already started by areaEntryOnAction; just arm the fade-out
  // so stepAreaEntrySequence ramps the overlay to 0 over the next frames.
  if (areaEntrySeq.state === 'idle' || areaEntrySeq.state === 'fadeIn' || areaEntrySeq.state === 'hold') {
    areaEntrySeq.state = 'fadeOut';
    areaEntrySeq.timer = 0;
    areaEntrySeq.startedAttempt = true; // attempt already begun — don't restart
  }
});

/**
 * Black-overlay alpha for the area-entry presentation. Returns 0 when idle,
 * ramps 1→0 during the fade-in, holds at 1 while the view is up, and ramps
 * 1→0 during the fade-out as the world fades back in from black.
 */
export function getAreaEntryFadeAlpha() {
  if (areaEntrySeq.state === 'fadeIn') {
    const t = areaEntrySeq.timer / AREA_ENTRY_FADE;
    return Math.max(0, Math.min(1, 1 - t));
  }
  if (areaEntrySeq.state === 'hold') return 1;
  if (areaEntrySeq.state === 'fadeOut') {
    // Ramp DOWN to 0 over the fade duration (world fades in from black).
    const t = areaEntrySeq.timer / AREA_ENTRY_FADE;
    return Math.max(0, Math.min(1, 1 - t));
  }
  return 0;
}

/**
 * Step the area-entry presentation. Called from update() while the state is
 * S.AREA_ENTRY. On completion it starts the attempt (startLife) and transitions
 * to PLAY — the same path the old confirm flow used, now driven by time.
 */
export function stepAreaEntrySequence(dt) {
  if (areaEntrySeq.state === 'idle') return;
  areaEntrySeq.timer += dt;
  if (areaEntrySeq.state === 'fadeIn') {
    if (areaEntrySeq.timer >= AREA_ENTRY_FADE) {
      areaEntrySeq.state = 'hold';
      areaEntrySeq.timer = 0;
    }
  } else if (areaEntrySeq.state === 'hold') {
    if (areaEntrySeq.timer >= TUNING.areaEntryHold) {
      // End of hold: begin the fade-out into play.
      areaEntrySeq.state = 'fadeOut';
      areaEntrySeq.timer = 0;
    }
  } else if (areaEntrySeq.state === 'fadeOut') {
    // Begin the attempt exactly once, at the top of the fade-out (whether we
    // got here from the timed hold or a manual fast-forward). The world is what
    // gets revealed as the overlay ramps down over it.
    if (!areaEntrySeq.startedAttempt) {
      areaEntrySeq.startedAttempt = true;
      startLife(hero, areaContext);
      if (getState() !== S.PLAY) {
        if (!tryTransition(S.PLAY)) setState(S.PLAY);
      }
      console.log('[lifecycle] AREA_ENTRY → PLAY (fade-out begins)');
    }
    if (areaEntrySeq.timer >= AREA_ENTRY_FADE) {
      areaEntrySeq.state = 'idle';
      areaEntrySeq.timer = 0;
    }
  }
}

// --- Zone model (task 2.1 — authoritative level structure) -------------------
// The sealed zone model IS the world (task 7.1). Each zone owns its own bounds,
// flags, and composed terrain; the ACTIVE zone's content is installed into the
// collision world. `levelZones` is the structural zone list (bounds/flags);
// `world` holds the composed terrain + population per area.
export const levelZones = buildLevelZones(LEVEL_DEF);
// The zone-model currentArea value that maps to the boss zone (zone[4]).
// AREA indices are positive (1..4 for the ordinary areas), so the boss zone
// gets its own constant AFTER them (5) — it must not collide with area 4.
export const AREA_BOSS = 5;
/**
 * The zone currently being played. Index into levelZones based on the hero's
 * currentArea. currentArea uses the single zone-model convention: 1 → zone[0],
 * 2 → zone[1], 3 → zone[2], 4 → zone[3], AREA_BOSS (5) → zone[4].
 */
export function getActiveZone(hero) {
  const idx = hero.currentArea >= 1 && hero.currentArea <= 4
    ? hero.currentArea - 1
    : levelZones.length - 1; // AREA_BOSS (or any out-of-range value) → boss zone
  return levelZones[idx];
}

// --- Active-zone world content (task 7.1) ------------------------------------
// The ACTIVE zone's installed content. These module-level lists are what the
// update loop, render, debug overlay, and lifecycle ops reference; they are
// REBUILT (cleared + refilled) whenever the active zone changes, so switching
// zones swaps ALL world contents (structure.md §2).
export const SOLIDS = [];
// Solid wrapper entities (layer-only) for the collision world + debug overlay.
class SolidBox extends Entity {
  constructor(box) {
    super({ x: box.x, y: box.y, w: box.w, h: box.h, gravity: 0, layer: LAYER.SOLID, debugColor: '#ff9f43' });
  }
}
const solidEntities = [];

// The hero's physical entry position for the active zone. Area -1 has no entry
// flag (it starts at the zone's start); later areas start beside their entry
// flag (checkpoints.md §1). startLife() owns placing the hero (lifecycle.md §3);
// these helpers give the lifecycle ops + boot the correct entry position.
function entryPosition(zone) {
  const b = zone.bounds;
  if (zone.entryFlag) {
    return { x: b.x + zone.entryFlag.x, y: b.y + zone.entryFlag.y };
  }
  // Area -1: start at the zone's start (beside where an entry flag would be).
  const bottomY = zone.orientation === 'vertical' ? b.y + b.h : ZONE_GROUND_Y;
  return { x: b.x + ZONE_ENTRY_X, y: bottomY };
}
/** The hero's top-left position (top = surfaceY - hero.h) for the active zone. */
function heroEntryPosition(hero) {
  const p = entryPosition(getActiveZone(hero));
  return { x: p.x, y: p.y - hero.h };
}

// --- Hero ---------------------------------------------------------
// Real Hero wrapping the Scarlet Vale definition; run/jump/crouch/slide,
// gravity, ground friction, facing+mirrorX, and crouch-box shrink all live in
// js/hero.js. `let` because setHeroRef() reassigns it on new game / swap.
let hero = new Hero(HEROES.scarlet, ZONE_ENTRY_X, ZONE_GROUND_Y - HEROES.scarlet.h);
/** Rebind the module-level hero reference (used by debug hero-swap / new game). */
function setHeroRef(h) { hero = h; }

// thorn fire state. Cooldown is in seconds; rapid powerup halves it.
hero.fireCooldown = 0;

// Lock Direction must freeze the RESOLVED aim, not the raw directional key
// (design §5): install the hero's contextual resolver into the input engine so
// the lock-capture applies the same rules as resolveAim.
input.setResolveAim((intent) => getHero().resolveAim(intent));

// --- New game (lifecycle.md §1) -------------------------------------------
// The SELECT→PLAY transition hook below rebuilds the hero with the chosen
// definition; at boot we start a genuine new game with the default hero.
// startGame() owns lives, the continue pool, fresh run stats, and the area
// position — nothing here assigns them ad hoc.
hero = startGame({ oldHero: hero }, HEROES.scarlet);
// Place the hero at the active zone's entry (lifecycle.md §1/§3; the physical
// position is owned here, not in update.js's old ad-hoc start).
{
  const p = heroEntryPosition(hero);
  hero.x = p.x;
  hero.y = p.y;
  hero.checkpoint = { x: p.x, y: p.y };
}
// Store the zone model on the hero (the authoritative structure the runtime
// references for structural decisions).
hero.zones = levelZones;
// Register the world-regeneration callback so SUBSEQUENT genuinely-new games
// (SELECT → PLAY) establish fresh generation choices (lifecycle.md §1/§6).
// The boot game used the world baked at module load; only a new game after the
// first rerolls. Death and Continue never call startGame, so they never reroll.
setRegenerateWorld(regenerateWorld);
// Hero uses no anim (solid debugColor rect). Real sprites later.
hero.anim = null;

// Melee attack animation (5 placeholder frames).
// Frame 3 (index) is the "active" frame where the hitbox is live.
// Colors progress from dark → bright → dim to visually mark the peak.
const attackFrames = ['#555555', '#888888', '#aaaaaa', '#ffffff', '#666666'];
hero.anims.attack = new Anim(
  attackFrames.map(c => makeTestFrame(hero.w, hero.h, c)),
  { speed: 80, loop: false }, // 80ms per frame matches MELEE_FRAME_DURATION
);

// Super move animation (10 placeholder frames — purple gradient).
// Will be replaced with real supermove sprite frames when loaded.
const superFrames = Array.from({ length: 10 }, (_, i) => {
  const t = i / 9;
  const r = Math.round(155 - t * 100);
  const g = Math.round(89 + t * 60);
  const b = Math.round(182 - t * 50);
  return makeTestFrame(hero.w, hero.h, `rgb(${r},${g},${b})`);
});
hero.anims.supermove = new Anim(superFrames, { speed: 60, loop: false });

// --- Active-zone entities (task 7.1) -----------------------------------------
// These are the ACTIVE zone's content. They are mutable module-level lists that
// installActiveZone() clears and refills on every zone switch, so the update
// loop, render, and lifecycle ops always see the current zone's world.
const enemies = []; // (legacy placeholder slot — always empty; realEnemies is live)
export const realEnemies = []; // active zone's enemies (from the population resolver)

// Overgrown Elephant boss (design §9). The boss belongs to the level's boss zone
// (boss-arena.md §1–§3); it is created ONCE and lives in the boss zone. It is
// tracked separately from realEnemies so the generic enemy loop never drives the
// boss's phase machine. `let` because a genuinely new game re-creates it.
export let boss = makeElephant(0, ZONE_GROUND_Y);

// --- Boss zone flow (docs/levels/boss-arena.md §1–§3) -------------------------
// The boss zone (zone[4], orientation 'boss') runs its own introduction
// state machine: approach → arena lock → intro sweep → bar fill → boss
// entrance → combat. The machine is created once at boot; it is started (or
// re-started after a death) by beginBossZoneFlow() when the hero reaches the
// boss zone. It owns boss visibility, the hero's shooting gate, and the
// boss's damage gate — the boss is invisible and untouchable until COMBAT.
const bossZoneDef = levelZones[4];
export const bossZone = makeBossZone(bossZoneDef, boss, {
  onLock: () => {
    // Arena lock (boss-arena.md §2 step 1): lock both sides + freeze the
    // camera on the fixed arena view.
    camera.setZoneBounds(bossZoneDef);
    camera.lockTo(bossZone.arenaX, bossZone.arenaY);
  },
  onCombat: () => {
    // Combat enable (boss-arena.md §2 step 8): the boss becomes active and
    // the fight begins. The boss's attack patterns are its own
    // responsibility (the boss/combat system); this only flips the gate.
    boss.active = true;
    console.log('[bossZone] COMBAT — boss active, fight enabled');
  },
});

/**
 * Start (or restart) the boss zone flow: the hero has reached the boss zone
 * (the shared area-entry screen is confirmed) and the approach begins beside
 * the boss checkpoint. Called from the AREA_ENTRY→PLAY hook and from the
 * death-restart path (boss-arena.md §3: losing a life restarts the boss zone
 * at its checkpoint, repeating the approach/introduction).
 */
export function beginBossZoneFlow() {
  bossZone.begin();
  // The boss is off-screen and invisible until BOSS_ENTER.
  if (boss.aiState !== 'dead') {
    boss.active = false;
    boss.phase = 'idle';
    boss.phaseTimer = 0;
  }
  console.log(`[bossZone] flow started — state ${bossZone.state}`);
}

// Non-looping anim test. Kept off the live targets (above) so the
// animation cycle doesn't obscure their destruction; attached to a separate
// decorative placeholder that never takes damage.
// Legacy placeholder entities (Tasks 1.2–3.1) — disabled. Real entities come
// from generateLevel() / projectilePool / powerups array. Kept as inert objects
// so existing code references don't break.
const animTestEnemy = new Entity({ x: -9999, y: -9999, w: 36, h: 40, gravity: 0, layer: LAYER.ENEMY, debugColor: '#9b59b6' });
animTestEnemy.alive = false;
animTestEnemy.anim = new Anim(
  ['#e74c3c', '#f39c12', '#9b59b6'].map(c => makeTestFrame(36, 40, c)),
  { speed: 400, loop: false },
);
const projectiles = [];
const pickups = [];

// Destructible solid barrels (design §10 "Object"). Barrels are SOLID (block
// hero + enemy) but carry an HP pool; they are placed by the population resolver
// on macro barrel slots (populate.md §3). `barrels` is the ACTIVE zone's full
// barrel list (explosive + wood + coin) — the three legacy sub-lists are kept as
// empty views so existing code paths (render, debug, getBarrels) keep working.
const barrels = [];
const woodBarrels = [];
const coinBarrels = [];

// dynamic SOLID registry: world boxes of every LIVE barrel. Barrels are solids
// like the static platforms (design §10/§16): the hero and grounded enemies
// resolve() against SOLIDS + this list each step.
const barrelSolidBoxes = [];
function refreshBarrelSolidBoxes() {
  barrelSolidBoxes.length = 0;
  for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) {
    if (b.alive) barrelSolidBoxes.push(b.worldBox());
  }
}

// Powerups (design §10). Placed by the population resolver on macro powerup
// slots (populate.md §2). The 'clear' powerup is placed wherever the resolver
// resolves it.
export const powerups = [];

// Checkpoints (checkpoints.md §1): the active zone's entry + exit flags. Touching
// an exit flag clears the area; the entry flag is the starting checkpoint.
// They are NOT solids — they don't block movement.
export const checkpoints = [];

// --- Active-zone installation (task 7.1) -------------------------------------
// The area lifecycle context references the ACTIVE zone's entity lists. It is
// REBUILT on every zone switch so restoreArea()/resetGeneration() (lifecycle.js)
// operate on the current zone's content. The context object's identity is stable
// (bound to the hero once) but its `barrels` array is refreshed in place.
const areaContext = {
  enemies: realEnemies,
  boss,
  barrels: [...barrels, ...woodBarrels, ...coinBarrels],
  powerups,
  checkpoints,
  projectiles: projectilePool,
  coins,
  particles,
  effects: Effects,
};
bindAreaContext(hero, areaContext);

// Install the initial zone (area 1) into the collision world so the runtime
// has a populated collision world from the very first frame. The boot game
// used the world baked at module load (seed=1); this installs area 1's
// content (solids, enemies, barrels, powerups, checkpoints) into the
// collision world. The hero and boss are added here (after the entity lists
// are declared).
loadActiveZone(getActiveZone(hero), world.world.get(getActiveZone(hero).areaIdx));
collisionWorld.add(hero);
// The boss is NOT added here — it is zone-scoped content installed by
// loadActiveZone() when the hero enters the boss zone. Adding it at boot
// would leave it physically present in every ordinary area.

/**
 * Install the ACTIVE zone's content into the collision world (structure.md §2:
 * "a new zone replaces it"). Removes the previous zone's entities (solids,
 * enemies, barrels, powerups, checkpoints) and adds the new zone's. The boss is
 * NOT touched here — it lives in the boss zone and is managed by the boss-zone
 * flow. This is the runtime seam that makes switching zones swap ALL world
 * contents.
 *
 * @param {object} zone the zone to install (from buildLevelZones)
 * @param {object} [content] the zone's instantiated content (instantiateZone).
 *   When omitted (e.g. the boss zone, which has no composed content) only the
 *   old content is cleared and the structural platforms are installed.
 */
export function loadActiveZone(zone, content) {
  // Remove the previous zone's content from the collision world.
  const oldCounts = { solids: solidEntities.length, enemies: realEnemies.length, barrels: [...barrels,...woodBarrels,...coinBarrels].length, powerups: powerups.length, cps: checkpoints.length };
  const cwBefore = collisionWorld.entities.size;
  for (const s of solidEntities) collisionWorld.remove(s);
  for (const e of realEnemies) collisionWorld.remove(e);
  for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) collisionWorld.remove(b);
  for (const p of powerups) collisionWorld.remove(p);
  for (const c of checkpoints) collisionWorld.remove(c);
  // The boss lives ONLY in the boss zone. Remove it from the collision world
  // when leaving so it cannot physically exist in ordinary areas (same logic
  // as any enemy — it is zone-scoped content, not a global entity).
  if (zone.kind !== 'boss') collisionWorld.remove(boss);
  const cwAfterRemove = collisionWorld.entities.size;

  // Clear the module-level lists.
  SOLIDS.length = 0;
  solidEntities.length = 0;
  realEnemies.length = 0;
  barrels.length = 0;
  woodBarrels.length = 0;
  coinBarrels.length = 0;
  powerups.length = 0;
  checkpoints.length = 0;

  // Install the new zone's content.
  const solids = content?.solids ?? zone.platforms.map((p) => ({ ...p }));
  for (const s of solids) {
    SOLIDS.push(s);
    solidEntities.push(new SolidBox(s));
    collisionWorld.add(solidEntities[solidEntities.length - 1]);
  }
  for (const e of content?.enemies ?? []) { realEnemies.push(e); collisionWorld.add(e); }
  for (const b of content?.barrels ?? []) { barrels.push(b); collisionWorld.add(b); }
  for (const p of content?.powerups ?? []) { powerups.push(p); collisionWorld.add(p); }
  for (const c of content?.checkpoints ?? []) { checkpoints.push(c); collisionWorld.add(c); }
  // The boss is zone-scoped content: add it to the collision world ONLY when
  // entering the boss zone. It is positioned by beginBossZoneFlow() (off-screen
  // right, invisible) once the hero confirms the entry screen.
  if (zone.kind === 'boss') {
    collisionWorld.add(boss);
    console.log(`[loadActiveZone] boss added to collision world`);
  }
  console.log(`[loadActiveZone] zone=${zone.areaIdx} removed ${JSON.stringify(oldCounts)} cw:${cwBefore}→${cwAfterRemove}, added new, cw final: ${collisionWorld.entities.size}`);
  console.log(`[loadActiveZone] checkpoints: ${checkpoints.map(c => `${c.checkpointId}@(${c.x},${c.y}) layer=${c.layer} alive=${c.alive}`).join(', ')}`);

  // Refresh the area context's barrel list (its identity is stable) and re-record
  // the arrangement ONCE (rememberInitial is idempotent; resetGeneration clears
  // it on a new game so the fresh world records its own positions).
  areaContext.barrels.length = 0;
  areaContext.barrels.push(...barrels);
  for (const e of realEnemies) rememberInitial(e, { aiState: e.aiState });
  for (const b of barrels) rememberInitial(b);
  for (const p of powerups) rememberInitial(p);
  return areaContext;
}

/**
 * Re-generate the world with FRESH random generation choices (lifecycle.md
 * §1/§6). Called ONLY by startGame() — a genuinely new game is allowed new
 * choices; death and Continue never reroll, so a run's arrangement stays fixed.
 *
 * The module-level `world` is swapped for a freshly composed one (new seed).
 * The boss is re-created (the level's boss identity is fixed). The active zone
 (area 1) is installed so the collision world is bound to the fresh world.
 * The hero is NOT swapped here — startGame() builds and inserts the fresh hero.
 *
 * @param {object} oldCtx the previous area context (its entity lists)
 * @returns {object} the new area context (bound to the new world)
 */
function regenerateWorld(oldCtx) {
  world = buildWorld(LEVEL_DEF, LEVEL_CONFIG, newGameSeed());

  // Re-create the boss for the fresh game (it is a fresh entity per game).
  const oldBoss = boss;
  boss = makeElephant(0, ZONE_GROUND_Y);
  rememberInitial(boss, { aiState: boss.aiState });
  // The boss-zone flow machine references the boss entity; it reads boss.x/y
  // live, so it needs no rewiring. (bossZone.boss is the same object reference
  // the machine moves; the machine is created with the original boss, so keep
  // it pointing at the fresh one.)
  bossZone.boss = boss;
  // MAJOR 8: the area context's boss reference must follow the re-created
  // boss, so restoreArea() (lifecycle.js) restores the FRESH boss on a
  // life loss in the new game, not the stale entity from the old one.
  areaContext.boss = boss;
  if (oldBoss && collisionWorld.entities.has(oldBoss)) collisionWorld.remove(oldBoss);
  collisionWorld.add(boss);

  // Install the FIRST zone (area 1) so the collision world is bound to the
  // fresh world. MAJOR 7: do NOT read getActiveZone(hero) here — the old
  // hero (still the module-level reference) may be on a later area from the
  // finished game; a new game always starts in the first zone (lifecycle.md
  // §1). The hero is managed by startGame() (removes oldHero / adds the
  // new hero), so we don't touch the hero here.
  const active = levelZones[0]; // area 1, the first zone
  loadActiveZone(active, world.world.get(active.areaIdx));
  camera.setZoneBounds(active);

  return areaContext;
}

/**
 * The per-game generation seed. A genuinely new game rolls a fresh seed so its
 * terrain + population differ from the previous game (lifecycle.md §6). Death
 * and Continue never call this — they reuse the world already built for the
 * game, so a run's arrangement stays fixed.
 * @returns {number}
 */
function newGameSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0);
}

// --- Floating text (VFX) -------------------------------------------
// Small pooled "value label" popups for powerup pickups (e.g. "+100 Ammo") and
// checkpoint triggers ("CHECKPOINT 1-2"). Pure visual: no collision layer, no
// allocation after init. Reuses the same pool pattern as particles.
class FloatText {
  constructor() { this.alive = false; }
  spawn(x, y, text, color) {
    this.x = x; this.y = y; this.text = text; this.color = color;
    this.life = 1.0; this.maxLife = 1.0; this.alive = true;
  }
  update(dt) {
    if (!this.alive) return;
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    this.y -= 30 * dt; // drift upward while fading
  }
  draw(ctx) {
    if (!this.alive) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
    ctx.fillStyle = this.color;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}
const FLOAT_TEXT_POOL_SIZE = 16;
const floatTexts = Array.from({ length: FLOAT_TEXT_POOL_SIZE }, () => new FloatText());
/** Spawn a floating label at (x, y). Returns null when the pool is exhausted. */
function spawnFloatText(x, y, text, color) {
  for (const t of floatTexts) {
    if (t.alive) continue;
    t.spawn(x, y, text, color);
    return t;
  }
  return null;
}

// --- Input -------------------------------------------------------------------
/**
 * Retry from the pause menu / game over: a fresh attempt at the CURRENT area's
 * beginning (lifecycle.md §3 — "replaying the same arrangement"). This is a
 * LIFE START, not a resume: it restores the whole area (enemies, barrels,
 * powerups, checkpoints), clears transient projectiles/coins/effects, and
 * places the hero back at the area's entry with full energy and i-frames.
 *
 * Lives are UNTOUCHED (lifecycle.md §3; game-rules.md §1): retry is a fresh
 * attempt, not a continue — only Continue restores the starting life count.
 * The continue pool is also untouched. All the "what does starting mean"
 * knowledge lives in lifecycle.js (startLife); this is a thin wrapper so the
 * GameOver screen's `retry` action and the pause menu's "Retry Level" keep
 * working and the state transition (OVER/PAUSE → PLAY) stays local.
 */
/**
 * Rebuild the active zone's FRESH content from the stored population snapshot
 * and install it into the collision world, so the next attempt starts from a
 * clean arrangement (defeated enemies, destroyed barrels, and collected
 * powerups are all restored). This is the BLOCKER 6 reset: restoreArea() alone
 * cannot re-add defeated entities, so we re-instantiate the whole zone from its
 * immutable snapshot instead. Shared by the death-restart path
 * (finishHeroDeath) and the pause/OVER retry path (retryFromGameOver) so both
 * reset the area identically. No-op for non-area zones (the boss zone keeps its
 * own flow) or when no content is stored for the zone.
 */
function resetActiveZoneContent() {
  const activeZone = getActiveZone(hero);
  if (activeZone.kind === 'area' && world.world.has(activeZone.areaIdx)) {
    const fresh = instantiateZone(
      activeZone,
      world.terrain.get(activeZone.areaIdx),
      world.population.get(activeZone.areaIdx),
    );
    loadActiveZone(activeZone, fresh);
  }
}

export function retryFromGameOver() {
  // Retry takes the SAME restart path as losing a life — except it does NOT
  // consume one. It resets the active zone to a fresh arrangement (enemies,
  // barrels, powerups, coins all restored exactly like a death-restart) and
  // opens the shared level-start / area-entry view. The timed entry sequence
  // then fades in, holds, and auto-starts play via startLife (which also
  // restores the preserved arrangement + hero placement).
  resetActiveZoneContent();
  showAreaEntry(hero, areaContext);
  console.log('[lifecycle] PAUSE/OVER → AREA_ENTRY (retry)');
}

/**
 * Continue from game over (lifecycle.md §4). Consumes exactly one continue,
 * restores the global starting life count, and returns to area 1 of the
 * CURRENT level. No coin cost. Returns true if the continue was applied.
 *
 * The pool is a growable global balance (gameRules.js); with no continues
 * remaining, Continue cannot be activated.
 */
export function continueFromGameOver() {
  const applied = continueRun(hero, areaContext);
  if (applied) console.log('[lifecycle] continue applied');
  return applied;
}

/**
 * Debug boot shortcut: reset the world to a clean state before jumping to PLAY.
 * Kills all enemies, clears projectiles/coins/particles, resets checkpoints.
 * The hero is rebuilt by the transition hook (SELECT/HOME/OVER/WIN → PLAY).
 */
function resetWorldForDebug() {
  // Kill all real enemies (NOT the boss — killing it triggers WIN).
  for (const e of realEnemies) {
    if (e.alive) { e.alive = false; }
  }
  // Clear projectiles.
  for (const p of projectilePool.activeItems) { p.alive = false; }
  projectilePool.active.length = 0;
  // Clear coins.
  for (const c of coins.activeItems) { c.alive = false; c.collected = true; }
  coins.active.length = 0;
  // Reset checkpoint flags.
  for (const c of checkpoints) c.triggered = false;
  // Reset effects.
  Effects.reset();
  console.log('[debug] world reset for debug boot');
}

/**
 * Enable the unified debug experience: overlay + harness + log.
 * Idempotent — safe to call multiple times.
 */
function enableDebug(source) {
  if (!Debug.enabled) Debug.toggle();
  if (!Debug.showLog) {
    Debug.showLog = true;
    Debug.logEvent(`${source}: debug ON`);
  }
}

function handleDebugToggle(e, source) {
  e.preventDefault();
  const s = getState();
  if (s !== S.PLAY) {
    window.__selectedHero = 'scarlet';
    hero.x = 80;
    hero.y = FLOOR_TOP - hero.h;
    hero.vx = 0; hero.vy = 0;
    hero.alive = true;
    hero.dying = false;
    hero.deathTimer = 0;
    enableDebug(source);
    tryTransition(S.PLAY);
    console.log(`[debug] ${source}: ${STATE_NAMES[s]} → PLAY`);
    return;
  }

  if (!Debug.enabled) {
    enableDebug(source);
  } else {
    Debug.toggle();
    Debug.reset();
    // Closing debug also closes the theater (it's a debug overlay).
    if (Theater.active) Theater.close();
    Debug.logEvent(`${source}: debug OFF`);
  }
}

// Debug is intentionally outside normal navigation/gameplay bindings.
window.addEventListener('keydown', (e) => {
  if (input.capturing) return;
  if (['F1', 'F2', 'F3'].includes(e.code)) e.preventDefault();
  // Shift+E: collision-world JSON dump. Handled BEFORE the F1/F2/debug gates so
  // it works whether or not debug mode is on (it IS the debug tool). Plain E
  // (stats dump) stays inside handleDebugKeys; KeyP/KeyD are unavailable —
  // input.js binds them to nav actions (pause / move-right).
  if (e.shiftKey && e.code === 'KeyE') {
    e.preventDefault();
    handleDebugKeys(e);
    return;
  }
  // F1: toggle debug mode. Opening debug from gameplay enters PLAY + harness.
  // Closing debug returns to normal gameplay (and closes theater if open).
  if (e.code === 'F1') { handleDebugToggle(e, 'debug'); return; }
  // F2: toggle Effect Theater. Works from anywhere (gameplay or debug).
  // Does NOT require debug to be on — it's a standalone overlay.
  if (e.code === 'F2') {
    if (Theater.active) {
      Theater.close();
      Debug.logEvent('theater CLOSE (F2)');
    } else {
      Theater.open();
      Debug.logEvent('theater OPEN (F2)');
    }
    return;
  }
  handleDebugKeys(e);
});

export function processInput() {
  input.poll({ facing: hero.facing });
  // Effect Theater: while open, route gamepad d-pad / left-stick horizontal
  // move to step the current effect. Back (Esc / ○) closes the theater.
  // F2 also toggles it (handled in keydown above). Edge-triggered so holding
  // a direction steps once per press, not every frame.
  if (Theater.active) {
    // Close on nav.back (Escape / gamepad ○) — uses the abstracted nav layer.
    if (input.nav.pressed.includes('back')) {
      Theater.close();
      Debug.logEvent('theater CLOSE (back)');
      return;
    }
    // Replay current effect on nav.confirm (Enter/Space / gamepad A).
    if (input.nav.pressed.includes('confirm')) {
      Theater.clock = -0.5;
      Debug.logEvent(`theater REPLAY → ${Theater.current().type}`);
      return;
    }
    updateTheaterGamepad();
    // Suppress normal screen navigation while the theater is open.
    return;
  }
  dispatchScreenInput(input, hero, {
    retry: retryFromGameOver,
    cont: continueFromGameOver,
    playAgain: () => tryTransition(S.SELECT),
    quit: () => tryTransition(S.HOME),
  });
}

// --- Effect Theater gamepad stepping ------------------------------
// Tracks the previous held-direction so a step fires only on the edge (crossing
// zero), preventing hold-to-spin. `wasHeld` is -1/0/+1 for prev/left/right.
let theaterWasHeld = 0;

/**
 * Step the Effect Theater from gamepad input. Called once per frame from
 * processInput() while Theater.active. Reads input.state.moveX (d-pad +
 * left-stick, already normalized by the existing input remap) for left/right.
 * Closing is handled in processInput via nav.back (Escape / gamepad ○).
 */
function updateTheaterGamepad() {
  const s = input.state;
  const dir = s.moveX < -0.2 ? -1 : s.moveX > 0.2 ? 1 : 0;
  // Edge-trigger: fire a step only when the held direction changes away from 0
  // into a new side (or flips side). Holding keeps the same dir → no re-step.
  if (dir !== 0 && dir !== theaterWasHeld) {
    Theater.step(dir);
    Debug.logEvent(`theater → ${Theater.current().type}`);
  }
  theaterWasHeld = dir;
}

// --- Debug harness mouse input: click to select / force an enemy's state -----
// Converts a screen-space click into logical 960x540 coords (inverse of the
// main.js transform), then selects or cycles the entity under it. Only active
// while the harness is on; zero cost otherwise (early return).
window.addEventListener('mousedown', (e) => {
  if (!Debug.enabled) return;
  const canvas = document.getElementById('game');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  // Screen → logical: account for letterbox centering + dpr scaling.
  const sx = (e.clientX - rect.left) / rect.width * VIEW_W;
  const sy = (e.clientY - rect.top) / rect.height * VIEW_H;
  const cam = getCamera();
  const lx = sx + cam.x;
  const ly = sy + cam.y;
  // Left click = force-cycle AI state; right click = select for inspection.
  if (e.button === 2) { e.preventDefault(); selectEntityAt(lx, ly); }
  else forceStateAt(lx, ly);
});
window.addEventListener('contextmenu', (e) => { if (Debug.enabled) e.preventDefault(); });

/** Build the per-frame intent object from the normalized input state. */
function readInput() {
  const s = input.state;
  return {
    left:   s.moveX < -0.2,
    right:  s.moveX > 0.2,
    up:     s.moveY < -0.2,
    down:   s.crouch,
    jump:   s.jump,
    shoot:  s.shooting,
    lockMove: s.lockMove,
    lockDir: s.lockDir,
    // §21: N is a weapon TOGGLE (selection), not a fire trigger. The intent is
    // edge-triggered by input.js; tryFire() dispatches on hero.selectedWeapon.
    switchWeapon: s.switchWeapon,
    melee:  s.melee,
    super:  s.supermove,
    // Aim direction (for projectile targeting)
    aimX:   s.aimX,
    aimY:   s.aimY,
  };
}

// --- Debug & Test Harness ----------------------------------------------------
// Everything below is gated behind `if (Debug.enabled)` so normal play pays only
// a single boolean check per frame. The spawn table is populated once from the
// entity constructors that exist in this module's scope.
initSpawnTable({
  Jester, VineHound, Violetta, JackOLantern,
  BorisLoon, BORIS_DEF, makeBorisBaby,
  makeBarrel, makeCoinBarrel, Powerup, POWERUP_TYPES,
});

/**
 * Spawn a debug entity at (x, y) with an optional forced AI state, register it
 * in the collision world, and log it. Returns the created entity (or null if the
 * type is unknown). Used by the free-spawn hotkeys and the cursor-spawn click.
 * @param {string} type spawn-table key (see SPAWN_KEYS / initSpawnTable)
 * @param {number} x world x
 * @param {number} y world y
 * @param {string} [state] AI state to force after creation
 */
function debugSpawn(type, x, y, state) {
  const entry = Debug.spawnTable[type];
  if (!entry) return null;
  const ent = entry.make(x, y, state);
  // Register so it participates in collisions/rendering like level entities.
  collisionWorld.add(ent);
  // Track spawned enemies in realEnemies so the generic update loop drives their
  // AI + death pipeline exactly as level spawns do.
  if (ent.layer === LAYER.ENEMY || ent.layer === LAYER.BOSS) realEnemies.push(ent);
  else if (ent instanceof GameObj) barrels.push(ent); // barrels live in the barrel list
  else if (ent instanceof Powerup) powerups.push(ent);
  Debug.logEvent(`spawn ${type}${state ? ` @${state}` : ''} (${Math.round(x)},${Math.round(y)})`);
  return ent;
}

/**
 * Handle debug keypresses. Called from the global keydown listener while
 * Debug.enabled is true. All actions are edge-triggered (one press = one action).
 * @param {KeyboardEvent} e
 */
function handleDebugKeys(e) {
  // F3 auto-enables debug if off, then cycles view on next press.
  if (e.code === 'F3' && !Debug.enabled) {
    handleDebugToggle(e, 'debug');
    return;
  }
  if (!Debug.enabled) return;

  // Free-spawn hotkeys (1-9): spawn at hero position + small offset.
  const spawnType = SPAWN_KEYS[e.code];
  if (spawnType) {
    const ox = 40, oy = -20; // small offset so it doesn't overlap the hero
    debugSpawn(spawnType, hero.x + hero.w / 2 + ox, hero.y + hero.h / 2 + oy);
    return;
  }

  switch (e.code) {
    case 'KeyF': // God mode toggle
      Debug.god = !Debug.god;
      if (!Debug.god) hero.intangible = false;
      Debug.logEvent(`god mode ${Debug.god ? 'ON' : 'OFF'}`);
      break;
    case 'KeyZ': // Slow-mo / freeze cycle
      Debug.timeScale = Debug.cycleTimeScale();
      Debug.logEvent(`timeScale → ${Debug.timeScale}x`);
      break;
    case 'KeyT': // Toggle telemetry panel
      Debug.showStats = !Debug.showStats;
      Debug.logEvent(`telemetry ${Debug.showStats ? 'ON' : 'OFF'}`);
      break;
    case 'KeyU': // Toggle live input monitor panel
      Debug.showInput = !Debug.showInput;
      Debug.logEvent(`input monitor ${Debug.showInput ? 'ON' : 'OFF'}`);
      break;
    case 'KeyY': // Hero swap Scarlet <-> Balthazhar
      swapHero();
      break;
    case 'KeyL': // Toggle event-log display
      Debug.showLog = !Debug.showLog;
      break;
    case 'KeyW': // Wrap to next area (debug): trigger the same clear-sequence
      // advance as reaching an exit flag — flash + banner + fade → next area's
      // entry screen. Works from PLAY and from the AREA_ENTRY view (pressing W
      // again during the entry screen immediately advances to the next area).
      debugWrapToNextArea();
      break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
      // Theater stepping is handled by updateTheaterGamepad (reads input.state.moveX).
      // Don't double-step here. Only drive the anim scrubber when theater is closed.
      if (!Theater.active) {
        scrubSelectedAnim(e.code);
      }
      break;
    case 'KeyX': // Deselect current entity
      if (Debug.selected) { Debug.selected = null; Debug.logEvent('deselect'); }
      break;
    case 'KeyE': // Dump JSON to disk. Plain E = stats; Shift+E = collision world.
      if (e.shiftKey) {
        dumpCollisionWorld();
        Debug.logEvent('collision world JSON downloaded');
      } else {
        dumpTrace(hero);
        Debug.logEvent('trace JSON downloaded');
      }
      break;
    case 'F3': // Cycle collision view mode (round-robin)
      Debug.viewMode = (Debug.viewMode + 1) % 3;
      const modeNames = ['sprite+collision', 'collision-only', 'sprite-only'];
      Debug.logEvent(`view: ${modeNames[Debug.viewMode]}`);
      break;
  }
}

/**
 * Debug: serialize every entity registered in the collision world to a JSON
 * download (P key). Includes layer, alive flag, world box, and identity so a
 * stale/leaked entity from a previous zone is obvious at a glance.
 */
function dumpCollisionWorld() {
  const LAYER_NAMES = {
    1: 'HERO', 2: 'ENEMY', 4: 'BOSS', 8: 'SOLID', 16: 'PICKUP',
    32: 'PROJ_ALLY', 64: 'PROJ_FOE', 128: 'COIN', 256: 'CHECKPOINT', 512: 'HAZARD',
  };
  const layerName = (l) => l === 0 ? 'NONE' : (LAYER_NAMES[l] ?? `bits=${l}`);
  const ents = [...collisionWorld.entities].map((e) => {
    const b = e.worldBox ? e.worldBox() : { x: e.x, y: e.y, w: e.w, h: e.h };
    return {
      ctor: e.constructor?.name ?? '?',
      type: e.type ?? null,
      checkpointId: e.checkpointId ?? null,
      isEntry: e.isEntry ?? null,
      triggered: e.triggered ?? null,
      layer: e.layer,
      layerName: layerName(e.layer),
      alive: e.alive,
      intangible: e.intangible ?? null,
      collected: e.collected ?? null,
      aiState: e.aiState ?? null,
      box: {
        x: Math.round(b.x * 10) / 10,
        y: Math.round(b.y * 10) / 10,
        w: b.w, h: b.h,
        right: Math.round((b.x + b.w) * 10) / 10,
        bottom: Math.round((b.y + b.h) * 10) / 10,
      },
    };
  });
  const out = {
    at: new Date().toISOString(),
    heroArea: hero.currentArea,
    heroBox: (() => { const hb = hero.worldBox(); return { x: hb.x, y: hb.y, w: hb.w, h: hb.h }; })(),
    totalEntities: ents.length,
    entities: ents,
  };
  console.log('[debug] collision world dump:', out.totalEntities, 'entities');
  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    try {
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'petal-panic-collision-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('[debug] failed to create download:', err.message);
    }
  }
  return out;
}

/**
 * Toggle between the two heroes (Scarlet Vale <-> Balthazhar). Rebuilds the hero
 * instance in place, preserving position/energy/lives/ammo so the A/B test is
 * about feel (jump height, speed, melee range), not a fresh start.
 */
function swapHero() {
  const curId = hero.heroDef.id;
  const nextId = curId === 'scarlet' ? 'balthazar' : 'scarlet';
  const def = HEROES[nextId];

  // Preserve runtime resources across the swap.
  const saved = {
    x: hero.x, y: hero.y, vx: hero.vx, vy: hero.vy,
    energy: hero.energy, lives: hero.lives, coins: hero.coins,
    ammo: hero.ammo, specialAmmo: hero.specialAmmo,
    selectedWeapon: hero.selectedWeapon,
    checkpoint: hero.checkpoint, continuesUsed: hero.continuesUsed,
    stats: hero.stats,
    wallet: hero.wallet, // preserve the live wallet (current + snapshot)
    traceStats: hero.traceStats, // preserve the accumulating trace
    _levelStartWallet: hero._levelStartWallet,
    _lifeBucketArmed: hero._lifeBucketArmed,
    _levelStartTotal: hero._levelStartTotal,
    _lifeBucketArmed: hero._lifeBucketArmed,
    intangible: hero.intangible, rapidTimer: hero.rapidTimer,
  };

  const nh = new Hero(def, saved.x, saved.y);
  Object.assign(nh, saved);
  // Carry the remaining i-frame window across the swap so the new hero is not
  // immune forever (flag alone would outlive its timer). If the old flag was
  // set but the timer already expired, clear both so the flag can't linger.
  if (saved.intangible) {
    const remaining = hero.timers.get('intangible');
    if (remaining > 0) {
      nh.timers.set('intangible', remaining);
    } else {
      nh.intangible = false;
    }
  }
  // CRITICAL: restore the NEW hero's stats (Object.assign overwrote them
  // with the old hero's stats object). Stats define speed/jump/special/etc.
  nh.stats = def.stats;
  nh.vx = saved.vx; nh.vy = saved.vy;
  // Wallet + trace are preserved via Object.assign(nh, saved) above (saved
  // carries hero.wallet / hero.traceStats), so no re-aliasing is needed.
  // Reattach placeholder anims sized for the new body.
  nh.anim = new Anim(
    ['#2ecc71', '#27ae60', '#1abc9c'].map(c => makeTestFrame(nh.w, nh.h, c)),
    { speed: 200, loop: true },
  );
  nh.anims.attack = new Anim(
    ['#555555', '#888888', '#aaaaaa', '#ffffff', '#666666'].map(c => makeTestFrame(nh.w, nh.h, c)),
    { speed: 80, loop: false },
  );

  // Swap the reference inside the collision world.
  collisionWorld.remove(hero);
  collisionWorld.add(nh);
  // Rebind the module-level `hero` via the getter indirection: we mutate the
  // exported binding by reassigning the captured variable through a setter.
  setHeroRef(nh);
  Debug.logEvent(`hero → ${def.name}`);
}

/** Step the selected entity's animation forward/back one frame. */
function scrubSelectedAnim(code) {
  const sel = Debug.selected;
  if (!sel) return;
  const anim = sel.anim ?? sel.anims?.attack;
  if (!anim || !anim.frames.length) { Debug.logEvent('no anim on selection'); return; }
  const n = anim.frames.length;
  let i = anim.frameIndex;
  if (code === 'ArrowRight') i = (i + 1) % n;
  else if (code === 'ArrowLeft') i = (i - 1 + n) % n;
  else if (code === 'ArrowUp') i = 0;
  else if (code === 'ArrowDown') i = n - 1;
  anim.pickFrame(i);
  Debug.logEvent(`scrub ${sel.type ?? sel.heroDef?.id ?? '?'} frame ${i}/${n - 1}`);
}

/** Select the topmost enemy/boss/powerup under a logical-space point. */
export function selectEntityAt(lx, ly) {
  // Prefer enemies + boss (the interesting ones), then powerups/barrels.
  const candidates = [...realEnemies, ...enemies, boss].filter(e => e && e.alive !== false);
  for (const p of powerups) if (p.alive && !p.collected) candidates.push(p);
  for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) if (b.alive) candidates.push(b);
  const hero = getHero();
  if (hero && !hero.dying) candidates.push(hero);
  for (const c of candidates) {
    const b = c.worldBox();
    if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) {
      Debug.selected = c;
      // Selecting an entity promotes detail to inspect level so its numeric
      // panel shows immediately (mirror icons stay on at every level).
      if (Debug.detailLevel < 2) {
        Debug.detailLevel = 2;
        Debug.logEvent('detail: inspect');
      }
      Debug.logEvent(`select ${c.type ?? c.powerType ?? '?'} @(${Math.round(lx)},${Math.round(ly)})`);
      return c;
    }
  }
  Debug.selected = null;
  return null;
}

/** Force-cycle the AI state of the entity under a logical-space point. */
export function forceStateAt(lx, ly) {
  const hit = pickEnemyAt(lx, ly);
  if (!hit) return null;
  const s = Debug.nextState(hit);
  Debug.logEvent(`force ${hit.type}: ${s ?? '(none)'}`);
  return s;
}

/** Find an enemy/boss whose box contains the point (for click-to-force-state). */
function pickEnemyAt(lx, ly) {
  const candidates = [...realEnemies, boss].filter(e => e && e.alive !== false);
  for (const c of candidates) {
    const b = c.worldBox();
    if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) return c;
  }
  return null;
}

/** Per-frame god-mode enforcement: intangible + infinite ammo. */
function applyGodMode(dt) {
  if (!Debug.god) return;
  hero.intangible = true;
  hero.ammo = Infinity;
  hero.specialAmmo = Infinity;
}

// friendly thorns hit ENEMY/BOSS (PROJ_ALLY rule). Apply damage and
// cull the projectile on impact. This is the ONLY place a PROJ_ALLY can interact
// with an enemy; there is no PROJ_ALLY↔HERO rule, so friendly-fire stays off.
collisionWorld.on('hit', (a, b) => {
  // --- Friendly thorns (hero → enemy/barrel) --------------------------------
  const allyProj = a.layer === LAYER.PROJ_ALLY ? a : (b.layer === LAYER.PROJ_ALLY ? b : null);
  if (allyProj && allyProj.friendly) {
    const target = allyProj === a ? b : a;

    // friendly thorn hits a barrel (SOLID with an HP pool). Chip its
    // HP; on destruction the barrel explodes (AoE + VFX) and is removed from the
    // world. Thorns are consumed on impact either way.
    if (target instanceof GameObj) {
      const dealt = target.hit(allyProj.damage, hero, 'projectile');
      if (dealt > 0) {
        allyProj.alive = false;
        if (target.destroyed) handleBarrelDestroyed(target);
      } else {
        allyProj.alive = false; // hit an already-destroyed solid — still consumed
      }
      // Specials explode/fizzle on barrel contact too.
      if (allyProj.type === 'saw' || allyProj.type === 'bomb') {
        explodeSpecial(allyProj);
      }
      return;
    }

    if (target.layer !== LAYER.ENEMY && target.layer !== LAYER.BOSS) return;
    if (target.hp == null) return;       // non-target placeholder (e.g. anim test box)
    // Boss zone flow (boss-arena.md §2): the boss cannot take damage before
    // COMBAT — the presentation must not imply it is attackable. The
    // projectile passes through (is consumed) but deals no damage.
    if (target === boss && !bossZone.bossCanTakeDamage()) {
      allyProj.alive = false;
      return;
    }
    // boss weak point: thorns landing in the head/trunk zone deal
    // WEAK_POINT_MULT× damage. Compute the impact point from the projectile's
    // center and route through the boss's takeDamage() for the bonus.
    if (target.isBoss && typeof target.isWeakPointHit === 'function') {
      const px = allyProj.x + allyProj.w / 2;
      const py = allyProj.y + allyProj.h / 2;
      // takeDamage() owns the death transition internally (hp<=0 -> die()).
      const dealt = target.takeDamage(allyProj.damage, hero, 'projectile', { x: px, y: py });
      if (dealt > 0) target.hitFlash = 0.1;
      allyProj.alive = false;
      return;
    }
    // Central damage routing: defense + telemetry in one place.
    // Real enemies route through takeDamage(), which OWNS the death transition
    // internally (hp<=0 -> die() -> death TTL). Placeholder targets (plain
    // Entity, no death pipeline) use raw damage() and are removed on death.
    const isRealEnemy = typeof target.takeDamage === 'function';
    const dealt = isRealEnemy
      ? target.takeDamage(allyProj.damage, hero, 'projectile')
      : damage(hero, target, allyProj.damage, 'projectile');
    if (dealt > 0 && !isRealEnemy) {
      target.hitFlash = 0.1; // brief white flash on impact
    }
    if (dealt > 0) {
      // red hit sparkles at the impact point + enemy shake
      // (design §12 "Projectile hit on enemy" / "Enemy damaged").
      Effects.spawnHitSparkles(allyProj.x + allyProj.w / 2, allyProj.y + allyProj.h / 2);
      Effects.beginEnemyShake(target);
      const srcName = allyProj.type === 'saw' || allyProj.type === 'bomb' ? allyProj.type : 'thorn';
      if (Debug.enabled) Debug.logEvent(`${srcName} → ${target.type ?? '?'} dmg ${dealt}`);
    }
    allyProj.alive = false;               // projectile is consumed on impact
    // Specials explode/fizzle on contact via the single explodeSpecial().
    if (allyProj.type === 'saw' || allyProj.type === 'bomb') {
      explodeSpecial(allyProj);
    }
    // Placeholders have no death anim: remove immediately when they die. Real
    // enemies play their internal death pipeline (handled by updateRealEnemies).
    if (!isRealEnemy && !target.alive) {
      collisionWorld.remove(target);
    }
    return;
  }

  // --- Foe projectiles (enemy → hero), ----------------------------
  // Violetta's shots and Boris Loon's dive-shots are unfriendly (PROJ_FOE). They
  // only ever hit the hero (PROJ_FOE×HERO rule); there is no PROJ_FOE↔ENEMY rule
  // so they can't self-damage. Route through central damage() and consume the
  // shot on impact. Respects the hero's invincibility window.
  const foeProj = a.layer === LAYER.PROJ_FOE ? a : (b.layer === LAYER.PROJ_FOE ? b : null);
  if (foeProj && !foeProj.friendly) {
    const victim = foeProj === a ? b : a;
    if (victim.layer !== LAYER.HERO) return;
    // Boss zone flow (boss-arena.md §2): the boss is untouchable before
    // COMBAT, so it fires no attacks during the intro either.
    if (foeProj === boss && !bossZone.bossCanTakeDamage()) { foeProj.alive = false; return; }
    // a hero mid-death takes no further damage (skull is playing).
    if (victim.dying) { foeProj.alive = false; return; }
    if (victim.intangible) { foeProj.alive = false; return; } // intangible absorbs it
    const dealt = damage(foeProj, victim, foeProj.damage, 'projectile');
    if (dealt > 0) {
      // Knockback along the projectile's travel direction + hit-stun + i-frames.
      // Contextual profile by source (design §25): ordinary foe shot.
      victim.takeHit({
        source: 'projectile',
        dirX: foeProj.vx, dirY: foeProj.vy,
      });
      // red vignette when the hero takes damage (design §12).
      Effects.heroDamaged();
      // track hits taken from enemy projectiles (design §4.1).
      record(victim, { kind: 'hitTaken', source: 'enemyProjectile' });
    }
    foeProj.alive = false; // consumed on impact
    // SFX: hit
  }
});

// ENEMY × HERO contact damage (jester body touching hero drains energy).
// The COLLISION_RULES table has {a:HERO, b:ENEMY, action:'contact'}; this fires
// when the hero overlaps an enemy's body box. We drain the hero's energy via
// central damage() (enemy as source, hero as target). A per-enemy cooldown
// prevents multi-hit drain every frame while overlapping.
const CONTACT_COOLDOWN = 0.5; // seconds between contact hits from same enemy
collisionWorld.on('contact', (a, b) => {
  // the boss is a BOSS-layer entity; treat it like an enemy for
  // contact damage (touching the elephant drains hero energy at its high attack).
  const enemyEnt = a.layer === LAYER.ENEMY ? a : (b.layer === LAYER.ENEMY ? b : null);
  const bossEnt = a.layer === LAYER.BOSS ? a : (b.layer === LAYER.BOSS ? b : null);
  const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
  const source = enemyEnt || bossEnt;
  if (!source || !heroEnt) return;
  // no contact damage while the hero is mid-death.
  if (heroEnt.dying) return;
  if (!source.alive || source.aiState === 'dead') return; // dead enemies don't hurt
  // Boss zone flow (boss-arena.md §2): the boss is untouchable before COMBAT.
  if (source === boss && !bossZone.bossCanTakeDamage()) return;
  // i-frames absorb contact hits (prevents melt while overlapping). takeHit()
  // returns false when invincible, so we skip damage + cooldown in that case.
  if (heroEnt.intangible) return;
  // Self-protection on connect (knockback.md ): a clean sweep or
  // cartwheel connect keeps the hero immune to contact damage until that
  // swing's active+recovery end. The flag is set by the unified hitbox
  // system on first connect and cleared by endSpecialMelee(); whiffs never
  // set it, so a missed swing leaves the hero fully exposed here.
  if (heroEnt.connectProtected) return;
  if (source._contactCd > 0) return;
  source._contactCd = CONTACT_COOLDOWN;
  const amt = source.stats?.attack ?? 10;
  const dealt = damage(source, heroEnt, amt, 'contact');
  // Body-contact knockback (§9): a single velocity-scaled rule carried on the
  // enemy. Idle enemies shove less than charging ones (motion term); bosses
  // read harder through their larger base + speed, not a separate category.
  if (dealt > 0) {
    const hcx = heroEnt.x + heroEnt.w / 2, scx = source.x + source.w / 2;
    const dirX = Math.sign(hcx - scx) || (heroEnt.facing * -1);
    // Build the push normal (horizontal away from attacker + small upward pop).
    const rawLen = Math.hypot(dirX, -0.6) || 1;
    const normal = { x: dirX / rawLen, y: -0.6 / rawLen };
    applyKnockback(heroEnt, source, source.bodyKnockback, normal);
    // Route applyKnockback's plain-field results into the hero's unified timer
    // system so the existing intangible flag + render blink keep working.
    if (heroEnt.hitstunTimer > 0) {
      heroEnt.timers.set('rec', Math.max(heroEnt.timers.get('rec'), heroEnt.hitstunTimer));
      heroEnt.hitstunTimer = 0;
    }
    if (heroEnt.iFrameTimer > 0) {
      heroEnt.intangible = true;
      heroEnt.timers.set('intangible', Math.max(heroEnt.timers.get('intangible'), heroEnt.iFrameTimer));
      heroEnt.iFrameTimer = 0;
    }
    // red vignette on contact damage (design §12 "Hero damaged").
    Effects.heroDamaged();
    // track hits taken from enemy contact (design §4.1).
    record(heroEnt, { kind: 'hitTaken', source: 'enemyContact' });
  }
});

// HERO × COIN collection (design §14). Fires when the hero's box
// overlaps a live coin's box. We credit the coin's value to the hero, bump the
// per-type + total counters, spawn a small sparkle burst at the pickup point,
// and remove the coin from both the pool and the collision world. The 1up
// threshold (every 100 total coins → +1 life) is checked here so it fires the
// moment the counter crosses the boundary.
const ONEUP_THRESHOLD = 100; // total coins collected per extra life (design §14)
let oneUpProgress = 0;       // running count toward the next 1up
collisionWorld.on('collect', (a, b) => {
  const coinEnt = a.layer === LAYER.COIN ? a : (b.layer === LAYER.COIN ? b : null);
  const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
  if (!coinEnt || !heroEnt) return;
  if (coinEnt.collected || !coinEnt.alive) return; // already credited (guard)

  // Credit the hero + stats.
  const type = coinEnt.coinType ?? 'bronze';
  const value = coinEnt.value ?? COIN_TYPES.bronze.value;
  heroEnt.coins += value;
  record(heroEnt, { kind: 'coin', type });

  // Pickup VFX: a small sparkle burst at the coin's center (reuses the pooled
  // particle system; no allocation). SFX hook for later audio wiring.
  const cx = coinEnt.x + coinEnt.w / 2;
  const cy = coinEnt.y + coinEnt.h / 2;
  Effects.fireParticleBurst(cx, cy, 4); // engine path (single fire path) — plain sparkle burst
  // SFX: coin

  // Mark collected (latches so the pair can't double-credit next frame) and
  // remove from the pool + collision world.
  coinEnt.collect();
  coins.remove(coinEnt);
  collisionWorld.remove(coinEnt);
  if (Debug.enabled) Debug.logEvent(`coin ${type} +${value}`);

  // 1up check: every ONEUP_THRESHOLD total coins grants +1 life.
  oneUpProgress += 1;
  if (oneUpProgress >= ONEUP_THRESHOLD) {
    oneUpProgress -= ONEUP_THRESHOLD;
    heroEnt.lives += 1;
    // SFX: 1up
  }
});

// HERO × PICKUP powerup collection (design §10). Fires when the
// hero's box overlaps a live powerup. We apply the documented effect via
// Powerup.collect() (which latches + bumps telemetry), spawn a sparkle pop at
// the pickup point, float the effect label above it, and remove the powerup
// from the collision world. The 'clear' effect needs the live enemy list, so
// we pass it through context.
collisionWorld.on('pickup', (a, b) => {
  const pu = a.layer === LAYER.PICKUP ? a : (b.layer === LAYER.PICKUP ? b : null);
  const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
  if (!pu || !heroEnt) return;
  if (!(pu instanceof Powerup)) return; // ignore non-powerup pickups
  if (pu.collected || !pu.alive) return; // already collected (guard)

  const cx = pu.x + pu.w / 2;
  const cy = pu.y + pu.h / 2;

  // Apply the effect with access to the live enemy set (for 'clear').
  const applied = pu.collect(heroEnt, { enemies: getLiveEnemies() });
  if (!applied) return;

  // VFX: sparkle pop + floating label text (design §12 "Powerup pickup").
  Effects.fireParticleBurst(cx, cy, 6); // engine path — plain sparkle burst
  Effects.spawnPickupPop(cx, cy, pu.def.color); // colored pop ring
  spawnFloatText(cx, cy - 16, pu.def.label, pu.def.color);
  // SFX: powerup
  if (Debug.enabled) Debug.logEvent(`powerup ${pu.def.label}`);

  collisionWorld.remove(pu);
});

// HERO × CHECKPOINT trigger (design §10/§13). Fires when the hero's
// box overlaps a checkpoint flag. Checkpoint.trigger() stores its position on
// hero.checkpoint (used by the death-restart pipeline) and latches so re-walking
// over it is a no-op. A brief flash plays via the entity's flashTimer.
collisionWorld.on('checkpoint', (a, b) => {
  const cp = a.layer === LAYER.CHECKPOINT ? a : (b.layer === LAYER.CHECKPOINT ? b : null);
  const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
  if (!cp || !heroEnt) return;
  if (!(cp instanceof Checkpoint)) return;
  // Entry flags are naive sprites: zero collision effect, no trigger, no VFX.
  if (cp.isEntry) return;
  if (cp.triggered) return; // already triggered this run
  // DEBUG: log exit-flag overlaps to diagnose trigger issues.
  console.log(`[checkpoint] ${cp.checkpointId} hero.area=${heroEnt.currentArea} hero.x=${Math.round(heroEnt.x)} cp.x=${cp.x}`);

  const fired = cp.trigger(heroEnt);
  if (!fired) return;

  // (checkpoint hits are no longer tracked in the stats model)

  // VFX: flash (entity-driven) + floating id label.
  const cx = cp.x + cp.w / 2;
  const cy = cp.y + cp.h / 2;
  Effects.fireParticleBurst(cx, cy, 5); // engine path — plain sparkle burst
  spawnFloatText(cx, cy - 20, `CHECKPOINT ${cp.checkpointId}`, '#ffd700');
  // SFX: checkpoint

  // checkpoints.md §1/§2, structure.md §2: a checkpoint marks an area
  // boundary. In the sealed-zone model each zone owns its OWN entry flag
  // (index 0 in its checkpoint list) and its OWN exit flag (index 1); the
  // indices restart per zone, so progression must use the ZONE MODEL, not a
  // global checkpoint index. Reaching the active zone's EXIT flag clears the
  // area (flash + 'X-Y CLEAR' banner + fade out) and advances to the next
  // zone. The -4 exit is the boss checkpoint (boss-arena.md §1): it routes
  // into the boss zone, whose content is loaded on the advance.
  const zone = getActiveZone(heroEnt);
  if (zone.kind !== 'area') return; // boss zone has no exit flag
  // The next area in the zone model: areas 1 → 2 → 3 → 4 → boss.
  // The 4 exit routes into the boss zone (boss-arena.md §1).
  const nextArea = zone.areaIdx === 4 ? AREA_BOSS : zone.areaIdx + 1;
  const clearedAreaId = formatAreaIdForClear(heroEnt.currentArea);
  // checkpoints.md §2: begin the clear sequence (flash + banner + fade).
  onExitFlagReached(clearedAreaId, nextArea);
});

/**
 * Format the area identifier for the 'X-Y CLEAR' banner. The area being
 * cleared is the one the hero is currently in (heroEnt.currentArea).
 * @param {number} currentArea the area index the hero is in
 * @returns {string} the area id (e.g. '1-1')
 */
function formatAreaIdForClear(currentArea) {
  // Zone-model area (1..4 or AREA_BOSS) is passed straight through to
  // formatAreaId (1..4 → 'X-N', AREA_BOSS → 'X-B').
  return formatAreaIdSafe(hero.currentLevel, currentArea);
}

/**
 * Safe wrapper around lifecycle's formatAreaId that falls back to a
 * positional id when the level definition is unavailable.
 */
function formatAreaIdSafe(level, area) {
  try {
    // formatAreaId is imported from lifecycle.js at the top of the module.
    return formatAreaId(level, area);
  } catch {
    return area >= 5 ? `${level}-B` : `${level}-${area}`;
  }
}

// --- Stats dump on WIN / GAMEOVER ----------------------------------
// Subscribe to state transitions; when the run ends (WIN or OVER), serialize
// the full §4.1 telemetry to console + downloadable JSON. This is the "tuning
// pass" hook: every completed run produces a structured record for analysis.
// Stats dump is manual: press E in debug mode to download the JSON.
// No longer auto-triggers on WIN/OVER.

// Reset per-screen transient state (held keys, focus) on entry.
// Screen lifecycle and input barriers are subscribed in screens.js.

// When SELECT → PLAY, rebuild the hero with the chosen definition.
// The Select screen sets window.__selectedHero before calling tryTransition(S.PLAY).
onTransition((from, to) => {
  if (to === S.PLAY && from !== S.PAUSE && from !== S.OVER && from !== S.AREA_ENTRY) {
    // New run: SELECT/HOME/WIN → PLAY. Retry/continue already restore OVER.
    // PAUSE→PLAY is a resume — hero state is already correct.
    // AREA_ENTRY→PLAY is the player confirming the shared area-entry screen to
    // begin the attempt (lifecycle.md §2/§3) — the hero was already rebuilt by
    // startGame/continueRun and placed by startLife, so this must NOT trigger
    // startGame (which would rebuild the hero and reroll generation).
    // lifecycle.md §1: a genuinely new game rebuilds the hero with the chosen
    // definition and establishes lives, the continue pool, fresh run stats,
    // and the area position. startGame() owns all of that; this hook only
    // rebuilds the hero instance and rebinds the reference.
    const heroId = window.__selectedHero || 'scarlet';
    const def = HEROES[heroId] || HEROES.scarlet;
    const oldHero = hero;
    const nh = startGame({ world: collisionWorld, oldHero, areaContext }, def);
    // Snapshot the freshly generated terrain into the trace's areaMap (stable
    // for the whole game — rolled once per seed).
    captureAreaMap(nh);
    {
      const p = heroEntryPosition(nh);
      nh.x = p.x;
      nh.y = p.y;
      nh.checkpoint = { x: p.x, y: p.y };
    }
    // Zone model (task 2.1) — authoritative structure on the hero.
    nh.zones = levelZones;
    // Placeholder anims sized for the new body.
    nh.anim = new Anim(
      ['#2ecc71', '#27ae60', '#1abc9c'].map(c => makeTestFrame(nh.w, nh.h, c)),
      { speed: 200, loop: true },
    );
    nh.anims.attack = new Anim(
      ['#555555', '#888888', '#aaaaaa', '#ffffff', '#666666'].map(c => makeTestFrame(nh.w, nh.h, c)),
      { speed: 80, loop: false },
    );
    // Rebind the reference + bind the area context so startLife/continueRun
    // can restore the preserved arrangement.
    setHeroRef(nh);
    bindAreaContext(nh, areaContext);
    // checkpoints.md §3: a genuinely new game opens the shared area-entry
    // screen (level name, area id, lives — no score) for the level's first
    // area. startGame() does NOT push the screen itself; the caller does so
    // AFTER the transition completes (lifecycle.md §1). The screen data is
    // supplied before the transition so the transition's screen reset cannot
    // clear it.
    showAreaEntry(nh, areaContext);
    console.log(`[lifecycle] new game: ${def.name} (${heroId})`);
  }
});

// --- Area-entry presentation (checkpoints.md §3) ----------------------------
// Every entry into the shared area-entry view starts its timed, non-interactive
// presentation: fast fade-in → hold for TUNING.areaEntryHold → fast fade-out →
// auto-start play. This fires on ALL paths that open the entry screen (new
// game, clear-sequence advance, death restart, continue, and pause retry).
onTransition((from, to) => {
  if (to === S.AREA_ENTRY) beginAreaEntryPresentation();
});

// AREA_ENTRY → PLAY: when the player confirms the area-entry screen, begin the
// fade-in into the new zone (checkpoints.md §2 step 6). This only fires when
// the area was reached via the clear sequence (exit flag → banner → fade-out →
// entry screen). For other entry-screen paths (new game, death restart,
// continue) the fade-in is not needed because the hero is already positioned
// by startLife and the screen was opaque (no visible world to fade from).
onTransition((from, to) => {
  if (to === S.PLAY && from === S.AREA_ENTRY) {
    // Only start the fade-in when the entry screen was reached via the clear
    // sequence (exit flag → banner → fade-out → entry screen). For other
    // entry-screen paths (new game, death restart, continue) there is no
    // fade-in because the hero was already positioned by startLife and the
    // screen was opaque (no visible world to fade from).
    beginClearFadeIn();
    // Re-clamp the camera to the zone the hero is now in (task 2.3). This runs
    // on EVERY area-entry confirmation (new game, clear-sequence advance, death
    // restart, continue), so the camera is always bound to the active zone and
    // a fresh vertical climb resets its ascent high-water mark.
    camera.setZoneBounds(getActiveZone(hero));
    // Snap the camera horizontally to the hero so they are on-screen from
    // frame 1. Without this, the camera may still be showing the previous
    // zone's x-position and the hero appears off-screen until the follow logic
    // catches up. Vertical is NOT snapped — the upward-only ratchet owns y.
    {
      const h = hero;
      const cx = h.x + h.w / 2;
      camera.x = Math.max(camera.minX, Math.min(camera.maxX, cx - camera.w / 2));
    }
    // Boss zone flow (boss-arena.md §1–§3): when the player confirms the
    // entry screen for the BOSS zone, start (or restart after a death) the
    // approach → lock → intro → combat sequence. The hero is already placed
    // beside the boss checkpoint by startLife; the flow machine takes over
    // from here.
    if (getActiveZone(hero)?.kind === 'boss') {
      beginBossZoneFlow();
    }
  }
});

// --- Camera --------------------------------------------------------------------
// Hero-following cam clamped to the ACTIVE ZONE's world bounds (task 2.3).
// The zone model (levelZones) is the authoritative level structure: the
// camera's clamp range comes from getActiveZone(hero).bounds, NOT the legacy
// corridor length, so it can never reveal the previous or next zone
// (structure.md §2/§3, checkpoints.md §2). The legacy corridor is still the
// active geometry until task 7.1; the camera bounds are already zone-driven.
export const camera = new Camera();
// Bind the camera to the zone the hero starts in (area 1) so it is clamped
// from the very first frame.
camera.setZoneBounds(getActiveZone(hero));

// brief screen shake on barrel explosions (optional juice). The
// camera-shake effect engine instance is the single owner of the shake state
// (effects/cameraShake.js); triggerShake()/updateShake() used to live here as
// module locals but were migrated through the Effects shim (review):
// render.js reads getShakeOffset(), which now returns the tracked instance's
// current offset ({0,0} when idle/done).
export function getShakeOffset() { return Effects.getShakeOffset(); }

export function getHero() { return hero; }
export function getSolids() { return SOLIDS; }
export function getCollisionWorld() { return collisionWorld; }
export function getEnemies() { return enemies; }
// all live enemy entities (placeholder targets + jester) used by
// the 'clear' powerup effect. Excludes dead/dead-animating enemies.
export function getLiveEnemies() {
  const out = [];
  for (const e of enemies) if (e.alive !== false) out.push(e);
  for (const e of realEnemies) {
    if (e.alive !== false && e.aiState !== 'dead') out.push(e);
  }
  return out;
}
// decorative anim-test box (damage-immune placeholder).
export function getAnimTestEnemy() { return animTestEnemy; }
// live thorns come from the shared pool (pooled, no allocation).
export function getProjectiles() { return projectilePool.activeItems; }
export function getSpecials() { return specialPool.activeItems; }
export function getPickups() { return pickups; }
export function getCamera() { return camera; }
// full real-enemy list (from generateLevel) for render/debug.
export function getRealEnemies() { return realEnemies; }
// the boss entity for render + debug.
export function getBoss() { return boss; }
/** The kind of the zone the hero is currently in ('area' | 'boss'). Used by
 *  render.js to gate boss-only visuals (debug box, HP bar) to the boss zone. */
export function getActiveZoneKind() { return getActiveZone(hero).kind; }
export function getParticles() { return particles; }
export function getCoins() { return coins; }
// barrels (explosive + coin) + explosion screen shake for render.
export function getBarrels() { return [...barrels, ...woodBarrels, ...coinBarrels]; }
export function getCoinBarrels() { return coinBarrels; }
// powerups, checkpoints, floating text for render + debug.
export function getPowerups() { return powerups; }
export function getCheckpoints() { return checkpoints; }
export function getFloatTexts() { return floatTexts; }

// --- Per-frame step ------------------------------------------------------------
export function update(dt) {
  processInput();
  // Effect Theater (debug-only): advance its demo clock while open. Gated on
  // active so normal play pays zero cost. Runs even outside PLAY (the theater
  // is a debug overlay independent of gameplay state). While the black-screen
  // theater is up we FREEZE the game behind it: skip all gameplay physics so
  // the hero doesn't walk and gamepad actions don't fire under the overlay.
  if (Theater.active) {
    Theater.update(dt);
    return;
  }
  // Physics only runs during PLAY; other states are screen-driven ().
  if (getState() !== S.PLAY) {
    // The area-entry view is a timed, non-interactive presentation: it fades in,
    // holds, then fades out and auto-starts play (checkpoints.md §3). Step that
    // sequence while the entry screen is up.
    if (getState() === S.AREA_ENTRY) {
      stepAreaEntrySequence(dt);
      // Debug wrap (W) may have started a clear-sequence advance FROM the entry
      // view; keep stepping it here so the banner/fade-out/next-entry plays out
      // even though we're not in PLAY.
      if (clearSeq.state !== 'idle') stepClearSequence(dt);
    }
    return;
  }
  // The area-entry fade-out ramps down OVER the live world after play has begun
  // (the attempt starts at the top of the fade-out), so keep stepping the
  // sequence here until it returns to idle — otherwise the black overlay would
  // stay pinned at full alpha over the new level.
  stepAreaEntrySequence(dt);

  // DEBUG: track hero position vs exit flag when in area 2.
  if (hero.currentArea === 2 && checkpoints.length > 0) {
    const exit = checkpoints.find(c => !c.isEntry);
    if (exit && Math.random() < 0.05) { // ~3x/sec
      const hb = hero.worldBox();
      const eb = exit.worldBox ? exit.worldBox() : { x: exit.x, y: exit.y, w: exit.w, h: exit.h };
      console.log(`[debug] hero.worldBox=[${Math.round(hb.x)},${Math.round(hb.y)},${hb.w}x${hb.h}] exit.worldBox=[${Math.round(eb.x)},${Math.round(eb.y)},${eb.w}x${eb.h}] hero.box=${JSON.stringify(hero.box)} exit.box=${JSON.stringify(exit.box)} exit.x=${exit.x} exit.y=${exit.y}`);
    }
  }

  // DEBUG: track clear sequence state.
  if (hero.currentArea === 2 && Math.random() < 0.02) {
    console.log(`[seq] state=${clearSeq.state} timer=${clearSeq.timer.toFixed(2)} pendingFadeIn=${clearSeq.pendingFadeIn}`);
  }

  // 0. Area-clear sequence (checkpoints.md §2): step the state machine
  //     (banner → fadeOut → entry screen → fadeIn). While the sequence is
  //     active the hero is frozen (no input, no physics) so the camera
  //     cannot scroll past the exit into the next zone.
  if (clearSeq.state !== 'idle') {
    stepClearSequence(dt);
    // While the clear sequence is active (banner/fadeOut/fadeIn), skip
    // gameplay physics: the hero is frozen and the camera stays put.
    // The fade-in completes and returns to normal play.
    if (clearSeq.state !== 'idle') {
      camera.update(hero);
      Effects.update(dt);
      return;
    }
    // Fade-in just completed: continue into normal play this frame.
  }

  // --- Debug harness: time scaling + god mode. Zero cost when off. -----------
  if (Debug.enabled) {
    applyGodMode(dt);
    dt *= Debug.timeScale; // slow-mo / freeze-frame (0 = physics paused, render continues)
    if (dt <= 0) { Effects.update(0); return; } // frozen: skip all physics this step
  }

  // Boss zone flow (boss-arena.md §1–§3): the state machine is DORMANT until
  // the hero actually reaches the boss zone (BLOCKER 1). The hero is placed at
  // the boss zone's entry by startLife on the AREA_ENTRY→PLAY confirmation, but
  // the machine only arms once getActiveZone() resolves to the boss zone. This
  // re-arms the flow on a death restart too: finishHeroDeath() advances
  // currentArea to the boss zone, so this branch fires on the first PLAY frame
  // after the entry screen is confirmed (the AREA_ENTRY→PLAY hook above already
  // fires beginBossZoneFlow() on the confirm; this is a safety net so the flow
  // is never left dormant while the hero stands in the boss zone).
  if (!bossZone.active && getActiveZone(hero)?.kind === 'boss') {
    beginBossZoneFlow();
  }

  // During the intro PRESENTATION (LOCKED → INTRO_SWEEP → BAR_FILL →
  // BOSS_ENTER) the game is effectively paused: the hero is frozen (no input,
  // no physics) so the full-screen sweep and bar fill play out cleanly.
  // APPROACH still allows movement (the hero walks to the arena). COMBAT
  // resumes normal gameplay.
  const bzPresentation = bossZone.active &&
    (bossZone.state === BZ_LOCKED || bossZone.state === BZ_INTRO_SWEEP ||
     bossZone.state === BZ_BAR_FILL || bossZone.state === BZ_BOSS_ENTER);
  if (bzPresentation) {
    bossZone.update(dt, hero);
    if (b.alive && b.aiState !== 'dead' && b.gravity > 0) resolve(b, SOLIDS);
    camera.update(hero);
    Effects.update(dt);
    return;
  }

  // 1. input → intents (movement/jump/crouch logic lives in Hero.update).
  const input = readInput();
  // One-way platform context (design §13): Down+Jump while standing on a
  // one-way platform becomes a drop-through, not a jump. The probe uses the
  // PREVIOUS frame's grounded state — setGrounded() runs after hero.update(),
  // so this is exactly "standing on a one-way platform right now".
  input.onOneWay = standingOnOneWay();
  hero.update(dt, input);

  // 1a. energy / death / respawn / gameover flow.
  //     Trigger: if energy hit 0 (and no death already running) start the
  //     skull-fade sequence. While dying we skip all gameplay below (no input,
  //     no shooting, no melee) so the corpse plays out cleanly; on completion
  //     we either respawn at the checkpoint or transition to GAME OVER.
  if (!hero.dying && hero.energy <= 0) {
    hero.die();
  }
  // 1a2. Lethal bottom emptiness (structure.md §4) runs AFTER collision
  //      resolution below (step 3): gravity can push a hero's feet past the
  //      bottom platform top in the same frame the ground snaps them back, so
  //      the check must see the post-collision position. A hero standing on
  //      the bottom platform has feet exactly AT the platform top (not >),
  //      so the strict check does not kill a safe standing hero.
  if (hero.dying) {
    hero.deathTimer += dt;
    if (hero.deathTimer >= hero.DEATH_DURATION + DEATH_FADE_DURATION) {
      finishHeroDeath();
    }
    // Camera still tracks (frozen) hero; the shake instance is stepped by
    // updateEffects() below only on live frames — during death the monolith
    // decayed it here, so step the shim directly to preserve that tail.
    camera.update(hero);
    Effects.update(dt);
    return;
  }

  // 1b. shooting (+ §21): J fires the SELECTED weapon through one
  //     shared path; N toggles the selection without firing anything.
  //     Boss zone flow (boss-arena.md §2): shooting is disabled during the
  //     intro (states 1–5) — the presentation must not imply the boss is
  //     attackable before combat starts.
  if (input.switchWeapon) hero.toggleWeapon(); // edge-triggered, no fire
  // Thorn cooldown ticks EVERY frame regardless of input/selection — a stale
  // cooldown must never freeze while J is released or Special is selected.
  if (hero.fireCooldown > 0) hero.fireCooldown -= dt;
  const shootingAllowed = !bossZone.inIntro;
  if (shootingAllowed) {
    tryFire(hero, input, dt);                    // dispatches on hero.selectedWeapon
  }

  // 1c. melee swing (+ §17-§19): H starts a swing; during its single
  //     active frame the hero's hitbox is checked against enemies and routed
  //     through central damage(). The cooldown lives on the hero (updateMelee).
  //     §24: combat inputs are locked during hit-stun — no melee activation.
  //     §15: Down+Melee resolves to the SPECIAL melee (per-hero trajectory);
  //     plain Melee stays normal. §17: both kinds funnel through ONE shared
  //     pending slot with latest-wins replacement — a press during an
  //     in-progress attack buffers instead of being dropped, and the buffered
  //     action fires only after the current attack's natural recovery (§18).
  //     §19 ordering: hero.update() above already evaluated the recovery
  //     cancel BEFORE any buffer execution this frame (cancel beats buffer);
  //     this block then handles the NEW melee press for THIS frame — either
  //     starting a fresh swing or buffering into the still-active one.
  if (input.melee && !hero.hitStunned && shootingAllowed) {
    const wasActive = hero.meleeActive || hero.specialMeleeActive;
    hero.requestMelee(input.down ? 'special' : 'normal');
    if (!wasActive && (hero.meleeActive || hero.specialMeleeActive)) {
      record(hero, { kind: 'meleeSwing' }); // count the swing start
    }
  }
  processAllHitboxes();

  // 1d. decay hit-flash timers on enemies (white flash when struck).
  for (const e of enemies) {
    if (e.hitFlash > 0) e.hitFlash -= dt;
  }

  // 1d2. tick live barrels (decays their hit-flash timer).
  for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) {
    if (b.alive) b.update(dt);
  }

  // 1d3. tick powerups (bob anim), checkpoints (flash decay), and
  //     floating text popups. Collected powerups are removed from the world on
  //     pickup, so we only advance still-live ones here.
  for (const p of powerups) {
    if (p.alive) p.update(dt);
  }
  for (const c of checkpoints) {
    c.update(dt);
  }
  for (const t of floatTexts) {
    t.update(dt);
  }

  // 1e. real-enemy AI + physics + attack damage + death pipeline.
  updateRealEnemies(dt);

  // 1e2. boss: camera lock, phase machine, stomp shake, win on death.
  updateBoss(dt);

  // 1f. particle + coin pool advancement.
  updateEffects(dt);

  // 2b. advance animations for any entity that has one attached.
  // (Hero.update already ticks its own anim; tick the decorative anim-test box.)
  if (animTestEnemy.anim) animTestEnemy.anim.tick(dt);

  // 2c. thorn integration: advance the pool, cull off-screen shots,
  //     then refresh the collision world's live set from the pool.
  projectilePool.updateAll(dt);
  cullOffScreen(projectilePool.activeItems);
  syncProjectilesToWorld();

  // Special projectiles: update + handle bomb explosions.
  specialPool.updateAll(dt);
  // Bomb bounce: bombs arc and bounce off floor/platform tops (like coins).
  for (const s of specialPool.activeItems) {
    if (!s.alive || s.type !== 'bomb') continue;
    const bottom = s.y + s.h;
    // Floor bounce.
    if (bottom >= FLOOR_TOP && s.vy > 0) {
      s.y = FLOOR_TOP - s.h;
      s.vy *= -0.5; // restitution
      s.vx *= 0.7;  // friction
    }
    // Platform-top bounces.
    for (const p of SOLIDS.slice(1)) {
      const prevBottom = bottom - s.vy * dt;
      if (prevBottom <= p.y + 2 && bottom >= p.y && s.vy > 0) {
        if (s.x + s.w > p.x && s.x < p.x + p.w) {
          s.y = p.y - s.h;
          s.vy *= -0.5;
          s.vx *= 0.7;
          break;
        }
      }
    }
  }
  syncSpecialsToWorld();
  // TTL expiry: check the FULL pool (not just activeItems, which already
  // spliced dead items) for specials that just died from TTL this frame.
  for (const s of specialPool.items) {
    if (s.ttlExpired && !s.exploded) {
      explodeSpecial(s);
      s.ttlExpired = false;
    }
  }

  // 3. collide: positional correction against solids (no pass-through),
  //    then broadphase/narrowphase rule dispatch.
  // Refresh the dynamic solid list (barrels) and resolve the hero against
  // static platforms AND live barrels — barrels block movement like any
  // platform piece (design §10: destructible solids).
  refreshBarrelSolidBoxes();
  // One-way platforms (design §13): resolve() needs the hero's bottom edge
  // BEFORE this frame's integration to tell "fell onto it from above" apart
  // from "arrived from underneath". Capture it here — hero.update() above has
  // already integrated x/y for this step.
  const heroPrevBottom = hero.worldBox().y + hero.worldBox().h - hero.vy * dt;
  const hit = resolve(hero, [...SOLIDS, ...barrelSolidBoxes], {
    prevBottom: heroPrevBottom,
    ignoreOneWay: hero.droppingThrough,
  });
  collisionWorld.update();

  // Grounded: derive from the last resolved axis + a surface-contact probe so
  // the hero can jump again immediately after landing. While dropping through
  // a one-way platform the hero is NOT grounded on it (the probe below skips
  // ignored one-way solids); solid terrain still grounds normally.
  hero.setGrounded(isGrounded(hit));

  // 1a2. Lethal bottom emptiness (structure.md §4): in a vertical zone, falling
  //      below the supporting bottom platform kills exactly like any other
  //      death — route through the same die() → death-TTL → finishHeroDeath()
  //      pipeline so the restart/continue/lives rules are identical. Runs
  //      AFTER collision resolution: a hero whose feet were pushed past the
  //      platform top by gravity this frame has already been snapped back onto
  //      the platform (feet == bottom, not >), so only a genuinely fallen
  //      hero (no platform below to catch them) dies here.
  if (!hero.dying && isBelowVerticalBottom(hero, getActiveZone(hero))) {
    hero.die();
  }

  // Keep the hero inside the LEVEL horizontally (test-rig convenience).
  const wb = hero.worldBox();
  const zw = getActiveZone(hero).bounds;
  if (wb.x < zw.x) { hero.x = zw.x - hero.box.ox; hero.vx = 0; }
  else if (wb.x + wb.w > zw.x + zw.w) { hero.x = zw.x + zw.w - hero.box.ox - hero.box.bw; hero.vx = 0; }

  // Boss arena lock (boss-arena.md §3): while the arena is locked (LOCKED
  // through COMBAT) the hero cannot scroll past the boss or leave through
  // either side. Clamp the hero's x to the fixed arena view (the same bounds
  // the frozen camera uses). No-op outside the boss zone (arenaLocked() is
  // false while the machine is dormant).
  if (bossZone.arenaLocked()) {
    const min = bossZone.arenaX;
    const max = bossZone.arenaX + bossZone.arenaW;
    if (wb.x < min) { hero.x = min - hero.box.ox; hero.vx = 0; }
    else if (wb.x + wb.w > max) { hero.x = max - hero.box.ox - hero.box.bw; hero.vx = 0; }
  }

  // 4. camera follows the hero (clamped to level bounds, facing look-ahead).
  camera.update(hero);

  // 4b. track run distance + time for stats (design §4.1). timePlayed = active
  // play time; sessionTime = wall-clock from start (both accumulate here while
  // an area is being played).
  const t = hero.traceStats;
  if (t) {
    t.distanceTraveled += Math.abs(hero.vx * dt);
    t.timePlayed += dt;
    t.sessionTime += dt;
  }

  // 5. the camera-shake instance is stepped by updateEffects() →
  // Effects.update(dt) below (render reads getShakeOffset()).
}

// checkpoints.md §4: after the death presentation and a short delay, FADE TO
// BLACK. Consume one life exactly once. If lives remain, show the shared
// entry screen with the new count, then restart the entire current area
// (the player confirms the screen to begin the attempt).
/**
 * structure.md §4: in a vertical zone the hero may fall within the visible
 * view, but falling into the bottom emptiness — below the supporting bottom
 * platform — kills them. "Descending cannot recover the earlier part of the
 * climb," so the camera's upward ratchet (task 2.3) is never reset by a fall;
 * only a death restart resets it.
 *
 * The bottom platform's top surface is the zone's bottom (`bounds.y +
 * bounds.h`). A standing hero's feet rest exactly on that line, so a hero
 * standing normally on the entry platform is NOT below it and does not die
 * (structure.md §4: "the initial supporting platform must allow a safe start;
 * the lethal bottom rule must not kill a hero standing normally at the entry").
 * The hero dies only when their feet drop strictly below the platform top.
 *
 * @param {Hero} h the hero
 * @param {object} zone the active zone from buildLevelZones()
 * @returns {boolean} true if the hero has fallen into the bottom emptiness
 */
export function isBelowVerticalBottom(h, zone) {
  if (!zone || zone.orientation !== 'vertical') return false;
  const bottom = zone.bounds.y + zone.bounds.h; // bottom platform top surface
  // World-space collision box (consistent with the rest of the collision
  // code): feet at the box's bottom edge, y + h.
  const wb = h.worldBox ? h.worldBox() : { y: h.y, h: h.h };
  const feet = wb.y + wb.h;
  return feet > bottom;
}

/** Length of the fade-to-black after the skull presentation (checkpoints.md §4:
 *  "After the death presentation and a short delay, fade to black"). Concrete
 *  value owned by the TUNING block (tuning.js). */
const DEATH_FADE_DURATION = TUNING.deathFade;
/** Black overlay drawn during the post-skull fade-to-black (render.js reads it). */
export function getDeathFadeAlpha() {
  if (!hero.dying) return 0;
  const t = (hero.deathTimer - hero.DEATH_DURATION) / DEATH_FADE_DURATION;
  return Math.max(0, Math.min(1, t));
}

/**
 * Called when the death presentation + fade-to-black completes. Consumes one
 * life exactly once; if any remain, show the SHARED area-entry screen
 * (lifecycle.md §3); if no lives remain, transition to GAME OVER (the
 * state machine then shows the continue/quit screen).
 */
function finishHeroDeath() {
  hero.lives -= 1;
  hero.dying = false; // stop the fade (the entry screen / OVER overlay take over)
  // Boss zone flow (boss-arena.md §3): losing a life during the intro or
  // combat restarts the BOSS ZONE at its checkpoint — the approach and the
  // introduction repeat. The shared area-entry screen is shown for the boss
  // area (as it is for any area death); when the player confirms it,
  // beginBossZoneFlow() re-runs the whole sequence.
  const inBossZone = getActiveZone(hero)?.kind === 'boss';
  if (hero.lives > 0) {
    if (inBossZone) {
      // BLOCKER 3: advance the hero's area to the boss zone so getActiveZone()
      // keeps resolving to the boss zone on the restart. Without this the hero
      // stayed on the previous area's index, so the flow never re-armed (the
      // dormant machine never saw a boss zone) and the entry screen showed the
      // wrong area id. AREA_BOSS is the zone-model value for the boss zone.
      hero.currentArea = AREA_BOSS;
      // Place the checkpoint at the approach START (right side) so the
      // APPROACH state has room to walk left before the intro begins.
      hero.checkpoint = { x: bossZone.approachStartX - hero.w / 2, y: ZONE_GROUND_Y - hero.h };
    }
    // Ensure the active zone's content is installed in the collision world
    // before showing the entry screen. This updates the checkpoints array
    // to the active zone's flags so startLife can latch the entry flag.
    // BLOCKER 6: re-instantiate the zone's FRESH content from the stored
    // population snapshot (buildWorld) rather than reusing the mutated
    // entities — restoreArea() cannot re-add defeated enemies, destroyed
    // barrels, or collected powerups (lifecycle.md §3: "the previous
    // attempt's kills and destroyed objects do not leave the next attempt
    // partly cleared"). Shared with retryFromGameOver so a retry resets the
    // area identically to a death-restart.
    resetActiveZoneContent();
    // checkpoints.md §4: after the death presentation and the fade, consume
    // one life exactly once and show the SHARED area-entry screen with the new
    // count. The whole area is restored and the attempt starts beside the
    // area's entry flag (e.g. death in 1-3 restarts 1-3 beside its flag) when
    // the player confirms the screen.
    showAreaEntry(hero, areaContext);
  } else {
    // checkpoints.md §5: at zero lives the EXISTING Game Over screen takes
    // over instead of the area-entry screen — untouched.
    tryTransition(S.OVER);
  }
}

/**
 * Grounded = resting on a solid's top surface. Combines the last resolve()
 * result (pushed down onto a floor this frame) with a small epsilon contact
 * probe so the flag stays true while standing still.
 */
function isGrounded(hit) {
  if (hit && hit.axis === 'y' && hit.dir === 1) return true; // landed on a surface
  const wb = hero.worldBox();
  // Static platforms + live barrels both count as floor surfaces (the probe
  // also covers the "standing on a barrel" case). One-way solids currently
  // being dropped through are excluded — the hero is intentionally passing
  // below them, not standing on them (design §13 drop-through).
  for (const s of [...SOLIDS, ...barrelSolidBoxes]) {
    if (s.oneWay && hero.droppingThrough) continue;
    if (wb.x + wb.w <= s.x || wb.x >= s.x + s.w) continue;
    const gap = s.y - (wb.y + wb.h);
    if (gap >= -2 && gap <= 4 && hero.vy >= 0) return true;
  }
  return false;
}

/**
 * True when the hero is grounded on a one-way platform (design §13): the
 * Down+Jump drop-through intent is only valid there. Solid terrain never
 * qualifies, so normal jumps over floors/barrels are unaffected.
 */
function standingOnOneWay() {
  if (!hero.grounded) return false;
  const wb = hero.worldBox();
  for (const s of SOLIDS) {
    if (!s.oneWay) continue;
    if (wb.x + wb.w <= s.x || wb.x >= s.x + s.w) continue;
    const gap = s.y - (wb.y + wb.h);
    if (gap >= -2 && gap <= 4) return true;
  }
  return false;
}

// --- Thorn shooting -------------------------------------------------
// G key fires an 8-way thorn from the shared pool. The aim direction is resolved
// by gameplay context via hero.resolveAim() (design §4/§32): grounded crouch
// shoots horizontally toward facing, airborne or lockMove + Down shoot straight
// down, and no directional input falls back to the hero's facing. Ammo is
// consumed per shot and fire is gated by a cooldown derived from
// stats.projectile_freq (halved during rapid).
// Friendly projectiles only ever hit ENEMY/BOSS via COLLISION_RULES, so they can
// never damage the hero — friendly-fire is off by construction.

// --- Shooting (+ design §21) ----------------------------------------
// ONE shared shoot path: J fires whatever weapon is currently SELECTED on the
// hero ('thorn' | 'special'). N never fires — it only toggles the selection
// (hero.toggleWeapon, called by the update step). Each weapon keeps its own
// ammo pool and its own cooldown timer, so depleting Thorn ammo never blocks
// Special and vice versa. The aim is resolved once by gameplay context
// (hero.resolveAim, design §4/§32); friendly projectiles only ever hit
// ENEMY/BOSS via COLLISION_RULES, so friendly-fire is off by construction.

/**
 * Attempt to fire the hero's selected weapon this step. Dispatches on
 * h.selectedWeapon; each branch consumes that weapon's OWN ammo pool and sets
 * its OWN cooldown (Thorn → h.ammo / h.fireCooldown; Special → h.specialAmmo /
 * the labeled 'special' timer, which shows in the per-entity debug stack).
 * @param {Hero} h the firing hero
 * @param {object} input current intent (shoot/lockMove/aimX/aimY/...)
 * @param {number} dt seconds
 */
function tryFire(h, input, dt) {
  if (!input.shoot) return;
  if (h.selectedWeapon === WEAPON_SPECIAL) {
    fireSpecial(h, input);
  } else {
    // Default workhorse: fast, straight thorns (§21).
    fireThorn(h, input, dt);
  }
}

/** Fire one Thorn (default weapon): projectilePool + 'ammo' + fireCooldown. */
function fireThorn(h, input, dt) {
  if (h.fireCooldown > 0) return; // still cooling down (ticks every frame in update())
  if (h.ammo <= 0) return;        // no ammo → cannot fire

  const dir = h.resolveAim(input);

  // Spawn at the active-box center, offset slightly toward the aim so the
  // thorn starts just outside the body (avoids same-frame self-overlap).
  const { x: cx, y: cy } = h.bodyCenter();
  const size = 12;
  const ox = Math.cos(dirAngle(dir)) * 16;
  const oy = Math.sin(dirAngle(dir)) * 16;
  const p = projectilePool.spawn(cx - size / 2 + ox, cy - size / 2 + oy, dir, true);
  if (!p) return; // pool exhausted — skip this shot (soft cap, no allocation)

  h.ammo -= 1;
  record(h, { kind: 'projectile', subtype: 'thorn' });

  // Cooldown: base interval = 1 / shots-per-second; ×0.5 during rapid powerup.
  const base = 1 / h.stats.projectile_freq;
  h.fireCooldown = h.rapidTimer > 0 ? base * 0.5 : base;
}

/**
 * Fire the hero's Special weapon (design §21): Scarlet throws a fast saw blade
 * (no gravity, short range); Balthazar lobs a bomb (gravity, fuse, AoE).
 * Consumes specialAmmo, gated by special_freq. The cooldown is a labeled timer
 * on the HERO ('special') so it shows in the per-entity debug stack like every
 * other countdown — independent of the Thorn fireCooldown.
 */
function fireSpecial(h, input) {
  if (h.timers.get('special') > 0) return; // still cooling down
  if (h.specialAmmo <= 0) return;          // no special ammo → cannot fire

  const type = h.stats.special; // 'saw' | 'bomb'
  const dir = h.resolveAim(input);
  const { x: cx, y: cy } = h.bodyCenter();
  const angle = dirAngle(dir);
  const ox = Math.cos(angle) * 20;
  const oy = Math.sin(angle) * 20;

  const s = specialPool.spawn(cx - 10 + ox, cy - 10 + oy, dir, type);
  if (!s) return; // pool exhausted

  h.specialAmmo -= 1;
  record(h, { kind: 'projectile', subtype: 'special' });
  record(h, { kind: 'superMove' });
  h.timers.set('special', h.stats.special_freq); // cooldown as a labeled timer

  if (Debug.enabled) Debug.logEvent(`special ${type} fired`);
}

/**
 * Explode a special projectile (bomb AoE or saw fizzle). Called from ANY death
 * path: TTL expiry, enemy contact, barrel contact, off-screen cull. Single
 * source of truth so VFX + damage are identical regardless of trigger.
 */
function explodeSpecial(s) {
  if (s.exploded) return; // already exploded (idempotent)
  s.exploded = true;
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;

  if (s.type === 'bomb' && s.radius > 0) {
    // AoE damage to all live entities in radius (enemies only — no self-damage).
    // Route through takeDamage() so real enemies own their death transition
    // internally (hp<=0 -> die() -> death TTL); placeholders use raw damage().
    for (const t of realEnemies) {
      if (!t.alive) continue;
      const dx = (t.x + t.w / 2) - cx;
      const dy = (t.y + t.h / 2) - cy;
      if (Math.sqrt(dx * dx + dy * dy) <= s.radius) {
        const dealt = typeof t.takeDamage === 'function'
          ? t.takeDamage(s.damage, s, 'special')
          : damage(s, t, s.damage, 'special');
        if (Debug.enabled) Debug.logEvent(`bomb → ${t.type} dmg ${dealt}`);
      }
    }
    // Legacy bomb explosion roll (pre-migration spawnExplosionVFX, preserved
    // verbatim): 12 + floor(rand*4) → 12–15 particles. The engine's
    // deterministic formula is overridden by this explicit count; palettes
    // and speeds stay owned by effects/explosion.js.
    const bombCount = 12 + Math.floor(Math.random() * 4);
    Effects.spawnExplosion(cx, cy, s.radius, bombCount); // engine path — warm fire burst sized to AoE
    Effects.bigExplosion();
    Effects.triggerShake(6); // engine path — camera-shake singleton
    if (Debug.enabled) Debug.logEvent('bomb exploded');
  } else {
    // Saw: small fizzle spark, no AoE.
    Effects.fireParticleBurst(cx, cy, 4); // engine path — plain sparkle burst
  }
}

// --- Melee attack -------------------------------------------------
// J key starts a swing (hero.tryMelee). During the single ACTIVE frame of the
// swing, the hero's meleeHitboxWorld is checked against every live enemy; on
// overlap we route through central damage(). Each enemy can only be hit once
// per swing (tracked in _meleeHitSet), so a multi-enemy overlap still deals
// exactly one hit each. The cooldown prevents spamming.

// --- Unified hitbox system ---------------------------------------------------
// All attack hitboxes register here each frame. One generic loop processes
// them via processHitboxes(). Each hitbox "slot" follows the same lifecycle:
//   box appears → activate + reset hitSet (fresh instance)
//   box persists → stay active, hitSet prevents re-hits
//   box disappears → deactivate, flag ready for next instance

const _hitboxes = []; // registered hitbox instances (reused, not allocated per frame)

/**
 * A hitbox slot: pairs a persistent Hitbox object with the state needed to
 * track its instance lifecycle (reset-on-first-frame pattern).
 */
function makeSlot(hb, { ownerGet, boxGet, damageGet, resetFlag }) {
  return { hb, ownerGet, boxGet, damageGet, resetFlag };
}

/**
 * Update one hitbox slot for this tick. Returns nothing; mutates the slot's
 * hitbox in place. The resetFlag is a [getter, setter] pair on the owner so
 * each entity tracks its own "has this instance already reset?" state.
 */
function updateSlot(slot) {
  const { hb, ownerGet, boxGet, damageGet, resetFlag } = slot;
  const owner = ownerGet();
  const box = boxGet();
  if (box && owner) {
    hb.owner = owner;
    hb.box = box;
    hb.damage = damageGet();
    // Knockback rides on the resolved box (heroDefs data → attackHitboxWorld).
    // Copy it onto the hitbox so processAllHitboxes reads hb.knockback at impact.
    hb.knockback = box.knockback;
    hb.active = true;
    if (!resetFlag.get()) {
      resetHitbox(hb);
      resetFlag.set(true);
    }
  } else {
    hb.active = false;
    resetFlag.set(false);
  }
}

// Hero melee slot.
const _hbMelee = makeHitbox({ owner: null, team: 'ally', box: null, damage: 0, method: 'melee' });
_hitboxes.push(_hbMelee);
const _slotMelee = makeSlot(_hbMelee, {
  ownerGet: () => hero,
  boxGet: () => hero.attackHitboxWorld(ATTACK_MELEE),
  damageGet: () => hero.stats.attack,
  resetFlag: { get: () => !!hero._meleeHbReset, set: v => hero._meleeHbReset = v },
});

// Hero supermove dash slot.
const _hbSuper = makeHitbox({ owner: null, team: 'ally', box: null, damage: 0, method: 'super' });
_hitboxes.push(_hbSuper);
const _slotSuper = makeSlot(_hbSuper, {
  ownerGet: () => hero,
  boxGet: () => hero.attackHitboxWorld(ATTACK_SUPERMOVE),
  damageGet: () => hero.stats.attack * 2,
  resetFlag: { get: () => !!hero._supermoveHbReset, set: v => hero._supermoveHbReset = v },
});

// Hero special melee slot (design §15): Down+Melee per-hero trajectory swing.
// Same lifecycle as the normal melee slot — only the active phase exposes a
// box; damage routes through the same central damage() system.
const _hbSpecialMelee = makeHitbox({ owner: null, team: 'ally', box: null, damage: 0, method: 'specialMelee' });
_hitboxes.push(_hbSpecialMelee);
const _slotSpecialMelee = makeSlot(_hbSpecialMelee, {
  ownerGet: () => hero,
  boxGet: () => hero.attackHitboxWorld(ATTACK_SPECIAL_MELEE),
  damageGet: () => hero.stats.attack,
  resetFlag: { get: () => !!hero._specialMeleeHbReset, set: v => hero._specialMeleeHbReset = v },
});

/**
 * Register active hitboxes for this frame and process them all in one pass.
 * Called once per update tick after all entities have integrated.
 */
function processAllHitboxes() {
  const h = hero;

  // --- Hero slots (melee + special melee + supermove) ---
  updateSlot(_slotMelee);
  updateSlot(_slotSpecialMelee);
  updateSlot(_slotSuper);

  // --- Enemy attack hitboxes (whip, lunge, jab) ---
  // Each real enemy exposes an attack hitbox getter. Register dynamically.
  for (const e of realEnemies) {
    if (!e.alive || e.aiState === 'dead') continue;
    const ehb = getEnemyAttackHitbox(e);
    if (!ehb) {
      // No box this frame → deactivate + ready for next attack.
      if (e._hitbox) {
        e._hitbox.active = false;
        e._hitboxReset = false;
      }
      continue;
    }
    let hb = e._hitbox;
    if (!hb) {
      hb = makeHitbox({ owner: e, team: 'foe', box: null, damage: e.stats.attack, method: 'melee' });
      e._hitbox = hb;
      _hitboxes.push(hb);
    }
    hb.owner = e;
    hb.box = ehb;
    hb.damage = e.stats.attack;
    hb.active = true;
    if (!e._hitboxReset) {
      resetHitbox(hb);
      e._hitboxReset = true;
    }
  }

  // --- Process all against all targets ---
  // Boss zone flow (boss-arena.md §2): the boss cannot take damage before
  // COMBAT. This gate MUST run BEFORE any damage is applied — processHitboxes
  // applies damage (takeDamage / hit) internally, so the onHit callback fires
  // only AFTER the boss has already been damaged. Filtering the boss out of
  // the target list here is the pre-damage guard: it stops melee, projectiles,
  // and specials from ever reaching the boss's takeDamage() until COMBAT.
  // (The onHit callback below keeps a redundant guard as a safety net.)
  const bossDamageAllowed = bossZone.bossCanTakeDamage();
  const targets = [h, ...realEnemies,
    ...(bossDamageAllowed ? [boss] : []),
    ...barrels, ...woodBarrels, ...coinBarrels].filter(Boolean);
  processHitboxes(_hitboxes, targets, (hb, target, dealt) => {
    // Safety net (defense in depth): the boss was already excluded from
    // `targets` above when combat has not started, so this never fires for the
    // boss pre-COMBAT. Kept for clarity / future refactor safety.
    if (target === boss && !bossZone.bossCanTakeDamage()) return;
    // Self-protection on connect (knockback.md ): the FIRST clean
    // hit of a special melee swing arms the hero's protection window for the
    // rest of that swing. The callback only fires when the box actually struck
    // a target — a whiff never reaches here, so it grants nothing. Normal
    // melee and supermove connects intentionally do NOT arm it (acceptance #4).
    if (hb.method === 'specialMelee' && hb.owner === h) {
      h.markSpecialConnect();
    }
    // VFX / juice on hit.
    if (target.layer === LAYER.HERO) {
      Effects.heroDamaged();
    } else {
      Effects.beginEnemyShake(target);
      if (target.hitFlash !== undefined) target.hitFlash = 0.1;

      // Hero→enemy knockback: if the attack hitbox carries a `knockback`
      // setting, apply the physical reaction to the enemy. No per-attack-type
      // branching — presence of the data is the only gate. The setting lives on
      // the hitbox (design §7), not the hero; the hero is used for motion/dir.
      const source = hb.owner;
      if (hb.knockback) {
        const dirMode = hb.knockback.dirMode || 'fromAttacker';
        let nx, ny;
        if (dirMode === 'alongVelocity') {
          const len = Math.hypot(source.vx || 0, source.vy || 0) || 1;
          nx = (source.vx || 0) / len;
          ny = (source.vy || 0) / len;
        } else {
          // 'fromAttacker' or 'radial': direction from source center to enemy center
          const scx = source.x + (source.w || 0) / 2;
          const scy = source.y + (source.h || 0) / 2;
          const ecx = target.x + target.w / 2;
          const ecy = target.y + target.h / 2;
          const dx = ecx - scx, dy = ecy - scy;
          const len = Math.hypot(dx, dy) || 1;
          nx = dx / len; ny = dy / len;
        }
        applyKnockback(target, source, hb.knockback, { x: nx, y: ny });
      }
    }
    // Remove dead enemies from world.
    if (target.alive === false && target !== h) {
      collisionWorld.remove(target);
    }
    // Handle barrel destruction.
    if (target.destroyed) {
      handleBarrelDestroyed(target);
    }
  });
}

/**
 * Get the current attack hitbox for a real enemy, or null.
 * Each enemy type stores its hitbox getter under a known property name.
 */
function getEnemyAttackHitbox(e) {
  // Jester: whipHitboxWorld, VineHound: lungeHitboxWorld, Violetta: meleeHitboxWorld
  if (e.whipHitboxWorld != null) return e.whipHitboxWorld;
  if (e.lungeHitboxWorld != null) return e.lungeHitboxWorld;
  if (e.meleeHitboxWorld != null) return e.meleeHitboxWorld;
  return null;
}

// --- Real-enemy update (jester + remaining AIs) ------------
// Drives every real Enemy's AI state machine, physics integration, per-type
// attack hitbox check, solid collision, and death pipeline (sparkle burst +
// coin drop on full death). The jester-specific whip logic is generalized into a
// per-enemy "attack hitbox" accessor so one loop covers all six types.

/**
 * Per-frame step for a single real enemy. Called from updateRealEnemies().
 * @param {Enemy} e the enemy entity
 * @param {number} dt seconds
 */
function updateRealEnemy(e, dt) {
  // Decay contact cooldown (shared by all real enemies via the 'contact' rule).
  if (e._contactCd > 0) e._contactCd -= dt;

  // AI + gravity + integrate (base Enemy.update handles all of this). Flyers
  // have gravity 0 so they never fall; grounders do not.
  // BLOCKER 5: the AI receives the collision world, not the buildWorld record.
  e.update(dt, hero, collisionWorld);

  // Resolve against solids (static platforms + live barrels) so grounders
  // don't walk through platforms or barrels. Flyers skip solid resolution
  // (they fly over/through them by design). Dying enemies (aiState === 'dead')
  // still resolve: their death pipeline integrates vx/vy + gravity, so a body
  // knocked back mid-death must land on platforms and slide along the ground
  // instead of ghosting through floors. Resolution stops only when alive
  // flips to false (death fade complete), at which point updateRealEnemy()
  // removes the entity from the collision world.
  if (e.alive && e.gravity > 0) {
    resolve(e, [...SOLIDS, ...barrelSolidBoxes]);
  }

  // Lethal fall cull (mirrors the hero's isBelowVerticalBottom rule): an enemy
  // that drops below the active zone's floor has no surface left — kill it
  // immediately so it can't linger as a phantom in the collision world
  // (observed: a Jack-O-Lantern fell to y≈24,000 while staying registered).
  // The normal death pipeline (sparkles + coins + world removal) still runs
  // via the !e.alive branch below; _deathHandled guards against double-credit.
  const zw = getActiveZone(hero)?.bounds;
  if (zw && e.alive && e.y > zw.y + zw.h + 200) {
    e.alive = false;
  }

  // Attack hitbox: now handled by the unified processAllHitboxes() system.
  // The old inline check is removed; enemy hitboxes register as team:'foe'
  // and the generic loop routes them against the hero.
  const atkHb = getAttackHitbox(e);
  if (!atkHb) e._atkHitDone = false; // reset when window closes (hitbox system uses its own hitSet)

  // Explosion (generic): any entity that carries an `explosion` property and has
  // latched its detonation fires the AoE blast here — the SAME path a barrel uses.
  // The only per-source difference is WHEN the trigger fires: barrels detonate on
  // destruction, the Jack-O-Lantern latches `exploded` when it blows up. No
  // instanceof checks; the engine reads e.explosion and resolves uniformly.
  if (e.explosion && e.exploded && !e._explodeHandled) {
    e._explodeHandled = true;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const targets = [hero, ...enemies, ...realEnemies];
    const result = resolveExplosion({
      ...e.explosion,
      cx, cy,
      self: e,
      ctx: { hero },
    }, targets);
    // Legacy enemy-death explosion roll (pre-migration spawnExplosionVFX,
    // preserved verbatim): 12 + floor(rand*4) → 12–15 particles.
    const deathCount = 12 + Math.floor(Math.random() * 4);
    Effects.spawnExplosion(cx, cy, result.radius, deathCount); // engine path — warm fire burst sized to AoE
    Effects.bigExplosion(); // screen flash on big explosion
    Effects.triggerShake(6); // engine path — camera-shake singleton
    // SFX: explosion
  }

  // Death pipeline completion: when alive flips to false after the anim,
  // spawn sparkles + coins and remove from the collision world.
  if (!e.alive && !e._deathHandled) {
    e._deathHandled = true;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    Effects.fireParticleBurst(cx, cy, 7);          // engine path — plain sparkle burst
    Effects.spawnDeathSparkle(cx, cy, Math.max(e.w, e.h)); // sprite-sized burst
    coins.dropCoins(e.coinDrop, cx, cy);      // coin drop per config
    collisionWorld.remove(e);                          // drop from play
    // Telemetry: count the kill by type (design §4.1 enemiesKilled).
    record(hero, { kind: 'enemyKilled', type: e.type });
    hero.wallet.current.kills += 1; // farming-safe wallet tally (resets on death)
    if (Debug.enabled) Debug.logEvent(`kill ${e.type}`);
  }
}

/**
 * Resolve the current active attack hitbox for a real enemy, or null when no
 * damage should be dealt this frame. Each type stores its own getter name; the
 * jester uses whipHitboxWorld, the vine hound lungeHitboxWorld, violetta
 * meleeHitboxWorld. Boris Loon has no melee hitbox (it attacks via dive/contact
 * + projectile).
 * @param {Enemy} e
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
function getAttackHitbox(e) {
  if (e.whipHitboxWorld != null) return e.whipHitboxWorld;       // jester
  if (e.lungeHitboxWorld != null) return e.lungeHitboxWorld;     // vine hound
  if (e.meleeHitboxWorld != null) return e.meleeHitboxWorld;     // violetta
  return null;
}

/**
 * Advance every real enemy this step. Called from update() in place of the old
 * single-jester call.
 * @param {number} dt seconds
 */
function updateRealEnemies(dt) {
  for (const e of realEnemies) {
    if (e === undefined || e === null) continue;
    updateRealEnemy(e, dt);
  }
}

// --- Boss (Overgrown Elephant) -----------------------------------
// Drives the boss's phase machine, camera lock, stomp screen-shake, and the
// win-state transition on death. The boss is tracked separately from
// realEnemies so its custom AI (phase-based, not aggro-based) runs here.

/**
 * Per-frame boss step: activate the fight when the hero approaches, run the
 * phase AI + physics, resolve against solids, trigger the stomp shake, and
 * handle the death → win pipeline.
 * @param {number} dt seconds
 */
function updateBoss(dt) {
  const b = boss;
  if (!b) return;

  // Decay the contact cooldown (shared with the 'contact' rule handler).
  if (b._contactCd > 0) b._contactCd -= dt;

  // Death pipeline completion: spawn effects, drop coins, remove from world,
  // unlock the camera, and transition to the reward screen exactly once.
  // This runs regardless of the boss zone flow state — if the boss died
  // (combat, test, or debug), the death pipeline must complete.
  if (!b.alive && !b._deathHandled) {
    b._deathHandled = true;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    Effects.fireParticleBurst(cx, cy, 14);        // engine path — big victory sparkle burst
    coins.dropCoins(b.coinDrop, cx, cy);       // generous coin bounty
    collisionWorld.remove(b);                           // drop from play
    camera.unlock();                           // release the arena lock
    b.onDeath();                               // boss-side death hook
    // mark boss as killed (design §4.1) — keyed by the level's boss id.
    record(hero, { kind: 'bossKilled', type: hero.levelConfig?.boss ?? 'boss' });
    if (getState() === S.PLAY) {
      // boss-arena.md §4: the level reward screen replaces the placeholder
      // post-boss (WIN) screen. showLevelReward() computes the documented
      // stats and credits the global continue pool exactly once.
      showLevelReward(hero);
      console.log(`[state] PLAY → ${STATE_NAMES[S.REWARD]} (boss defeated)`);
    }
    return;
  }

  // Boss zone flow (docs/levels/boss-arena.md §1–§3). The state machine
  // owns the approach → arena lock → intro → bar fill → boss entrance →
  // combat sequence. While the machine is running (states before COMBAT)
  // the boss is invisible and untouchable; the hero may move but not shoot.
  if (bossZone.active && bossZone.state !== BZ_COMBAT) {
    // Step the machine; it drives the boss's entrance position and the
    // energy-bar fill. The camera is frozen by the machine's onLock hook.
    bossZone.update(dt, hero);
    // The boss's own AI must NOT run during the intro: it is invisible and
    // the fight has not started. (Attack patterns are the boss system's
    // job; here we simply gate them off until COMBAT.)
    // We still resolve the boss against solids so its entrance lands on the
    // floor, but we skip b.update() (AI + integrate) until COMBAT.
    if (b.alive && b.aiState !== 'dead' && b.gravity > 0) {
      resolve(b, SOLIDS);
    }
    return;
  }

  // The boss AI only runs when the boss zone flow is active AND in COMBAT.
  // Before the player reaches the boss zone, the boss is dormant — no AI,
  // no attacks, no movement. (boss-arena.md §1: the boss is created per
  // boss-zone entry, not at module load.)
  if (!bossZone.active || bossZone.state !== BZ_COMBAT) return;

  // COMBAT: the boss AI drives the fight.
  // Activation is owned by the boss zone flow's onCombat hook (which sets
  // boss.active = true when the machine reaches COMBAT).
  if (b.aiState !== 'dead' && !b.active) {
    b.shouldActivate(hero);
  }

  // AI + gravity + integrate (base Enemy.update handles the death pipeline too).
  // BLOCKER 5: the AI receives the collision world, not the buildWorld record.
  b.update(dt, hero, collisionWorld);

  // Keep the boss inside the arena horizontally while alive & active.
  if (b.alive && b.aiState !== 'dead' && b.active) {
    const minX = b.arenaX;
    const maxX = b.arenaX + b.arenaW - b.w;
    if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx); }
    else if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx); }
  }

  // Resolve against solids so the boss rests on the floor (it has gravity 1).
  if (b.alive && b.aiState !== 'dead' && b.gravity > 0) {
    resolve(b, SOLIDS);
  }

  // Stomp shake: doStomp() records a magnitude; convert it into a screen shake.
  if (b.shakeMag > 0) {
    Effects.triggerShake(b.shakeMag); // engine path — stomp shake
    b.shakeMag = 0;
  }
}

// Advance particle + coin pools (called each frame regardless of jester state).
function updateEffects(dt) {
  Effects.update(dt); // decay vignette / screen flash timers
  particles.updateAll(dt);
  // Coins bounce off the floor AND any air platform top they land on. We pass
  // the SOLIDS list minus the floor itself (the floor is handled by floorTop).
  const platforms = SOLIDS.slice(1); // index 0 is the full-length floor
  coins.updateAll(dt, FLOOR_TOP, getActiveZone(hero).bounds.w, platforms);
  // Sync coins into the collision world so HERO×COIN collect works.
  syncCoinsToWorld();
}

// --- Barrel destruction / explosion ---------------------------------
// When a barrel's HP hits 0 (from any source: thorn, melee, bomb) we run the
// explosion pipeline once: AoE damage to everything in radius (enemies AND hero),
// an orange/red particle burst, a brief screen shake, and removal from the world.
// Coin barrels skip the damaging AoE but still pop coins.

/**
 * Handle a barrel that just reached 0 HP. Runs the explosion AoE (damaging
 * barrel only), spawns VFX, drops coins for coin barrels, shakes the screen,
 * and removes the barrel from the collision world.
 * @param {GameObj} barrel the destroyed object
 */
function handleBarrelDestroyed(barrel) {
  const { cx, cy } = { cx: barrel.x + barrel.w / 2, cy: barrel.y + barrel.h / 2 };

  if (barrel.explosion) {
    // AoE damage to every live entity in radius (enemies + hero). The pure
    // resolveExplosion() routes through central damage(); we pass the full live set.
    // A barrel is a NEUTRAL blast: it hurts whoever stands in range (hero AND enemies)
    // and shoves everyone radially. Hero knockback is routed through takeHit('explosion')
    // inside resolveExplosion, preserving the exact pre-refactor rec/intangible behavior.
    // Same generic path as any other detonating entity — only the trigger differs.
    const targets = [hero, ...enemies, ...realEnemies];
    const result = resolveExplosion({
      ...barrel.explosion,
      cx, cy,
      self: barrel,
      ctx: { hero },
    }, targets);
    // Real enemies killed by the blast already ran their internal death pipeline
    // via takeDamage() inside resolveExplosion — no manual die() needed here.
    // track if the hero was hit by the explosion (design §4.1).
    if (result.hit.includes(hero)) {
      record(hero, { kind: 'hitTaken', source: 'explosion' });
    }
    // Legacy barrel explosion roll (pre-migration spawnExplosionVFX, preserved
    // verbatim): 12 + floor(rand*4) → 12–15 particles.
    const barrelCount = 12 + Math.floor(Math.random() * 4);
    Effects.spawnExplosion(cx, cy, result.radius, barrelCount); // engine path — warm fire burst sized to AoE
    Effects.bigExplosion(); // brief white screen flash (design §12)
    Effects.triggerShake(8); // engine path — barrel explosion shake
    // SFX: explosion
  } else if (barrel.coinDrop) {
    // Coin barrel (or any object with a coinDrop config): spawn the burst.
    coins.dropCoins(barrel.coinDrop, cx, cy);
    Effects.fireParticleBurst(cx, cy, 6); // engine path — plain sparkle burst
    // SFX: coin
  } else {
    // Wood barrel (plain): just breaks into wood-chip particles. No damage, no coins.
    Effects.fireParticleBurst(cx, cy, 8); // engine path — plain sparkle burst
    // SFX: break
  }

  // Remove the dead barrel from the collision world so it stops blocking.
  collisionWorld.remove(barrel);
  // Telemetry: count the destroyed barrel by type (design §4.1 barrelsDestroyed).
  const bkey = barrel.type; // 'woodBarrel' | 'barrel' | 'coinBarrel'
  record(hero, { kind: 'barrel', type: bkey });
  if (Debug.enabled) Debug.logEvent(`barrel destroyed (${bkey})`);
}

/** Keep the collision world's coin set in sync with the pool. */
function syncCoinsToWorld() {
  const live = coins.activeItems;
  for (const e of collisionWorld.entities) {
    if (e.layer === LAYER.COIN && !live.includes(e)) collisionWorld.remove(e);
  }
  for (const c of live) {
    if (!collisionWorld.entities.has(c)) collisionWorld.add(c);
  }
}

/** Cull thorns that have flown past the level bounds (lifetime cull is in update). */
function cullOffScreen(items) {
  for (const p of items) {
    const _zw = getActiveZone(hero).bounds; if (p.x + p.w < _zw.x || p.x > _zw.x + _zw.w || p.y + p.h < -40 || p.y > VIEW_H + 40) {
      p.alive = false;
    }
  }
}

/**
 * Keep the collision world's live set in sync with the pool: add newly-spawned
 * thorns, drop ones that died since last frame. The world skips !alive entities
 * each pass, so this only needs to handle membership churn.
 */
function syncProjectilesToWorld() {
  const live = projectilePool.activeItems;
  // Remove dead projectiles still registered in the world.
  for (const e of collisionWorld.entities) {
    if (e.friendly && (e.layer === LAYER.PROJ_ALLY || e.layer === LAYER.PROJ_FOE) && !live.includes(e)) {
      collisionWorld.remove(e);
    }
  }
  // Add any live thorn not yet registered.
  for (const p of live) {
    if (!collisionWorld.entities.has(p)) collisionWorld.add(p);
  }
}




/** Sync live specials into the collision world (same pattern as projectiles). */
function syncSpecialsToWorld() {
  const live = specialPool.activeItems;
  for (const e of collisionWorld.entities) {
    if (e.type === 'saw' || e.type === 'bomb') {
      if (!live.includes(e)) collisionWorld.remove(e);
    }
  }
  for (const s of live) {
    if (!collisionWorld.entities.has(s)) collisionWorld.add(s);
  }
}
