// World build — terrain→pixel AABB math, entity instantiation from population
// items, and the full per-game world composition (buildWorld).
// All shared mutable state is read/written through ctx (world/context.js) to
// avoid a circular import back into systems/update.js.

import { UNIT_PX_X, UNIT_PX_Y, PLATFORM_DRAW_H, populateArea, populationSnapshot } from './macros.js';
import { ZONE_GROUND_Y, buildLevelZones, buildAllZoneTerrain } from './level.js';
import { VIEW_W, VIEW_H } from '../core/view.js';
import { Jester } from '../enemies/jester.js';
import { VineHound } from '../enemies/vine_hound.js';
import { Violetta } from '../enemies/violetta.js';
import { JackOLantern } from '../enemies/jackolantern.js';
import {makeBoris, makeBorisBaby} from '../enemies/boris_loon.js';
import { makeBarrel, makeWoodBarrel, makeCoinBarrel, makeCheckpoint } from '../objects/object.js';
import { Powerup } from '../objects/powerup.js';
import { recordAreaMap } from '../stats.js';
import { formatAreaId } from '../systems/lifecycle.js';
import {getStageBudget} from './levelConfigs.js';
import { createRng } from './terrain.js';

// --- Terrain → pixel AABB (unit space from the composer → world pixels) ------
// A placed unit carries a unit-space aabb {x,y,w,h}: x/y are unit offsets, w/h
// are unit counts. Horizontal terrain composes along X (units→px via UNIT_PX_X)
// and rises from the zone floor (a block of height H occupies the H px above
// the floor). Vertical terrain composes along Y (a climb of H units is H px
// above the bottom platform) within the fixed one-screen width.
// (unit → px via UNIT_PX_X / UNIT_PX_Y, imported from macros.js — single
// source of truth; anisotropic since R6: x-units are wider than y-units).
// BUGFIX: unit-space y=0 means "resting on the floor top", which is at
// ZONE_GROUND_Y (500) — NOT the zone bottom (b.y + b.h = 540). Anchoring to
// the zone bottom sank every block 40px (ZONE_FLOOR_H) into the floor slab.
function horizontalUnitBox(zone, u) {
  const b = zone.bounds;
  const px = b.x + u.aabb.x * UNIT_PX_X;
  const py = ZONE_GROUND_Y - u.aabb.y * UNIT_PX_Y - u.aabb.h * UNIT_PX_Y;
  // R5.1: one-way platforms get a THIN box (PLATFORM_DRAW_H px) anchored to
  // the landing face — collision matches the draw. Blocks keep full height.
  const h = u.oneWay ? Math.min(u.aabb.h * UNIT_PX_Y, PLATFORM_DRAW_H) : u.aabb.h * UNIT_PX_Y;
  return { x: px, y: py, w: u.aabb.w * UNIT_PX_X, h, oneWay: u.oneWay };
}
function verticalUnitBox(zone, u) {
  const b = zone.bounds;
  const px = b.x + u.aabb.x * UNIT_PX_X;
  // BUGFIX: a vertical zone's ground is its BOTTOM platform (b.y + b.h), not
  // ZONE_GROUND_Y (500 — the horizontal floor level). Anchoring to 500 placed
  // every climb unit at y ≈ -24..-1700, i.e. far ABOVE the 2700px-tall zone:
  // only the bottom-most landings were visible and they rendered off-center
  // right. Elevation is counted UP from the bottom platform.
  const py = (b.y + b.h) - (u.aabb.y + u.aabb.h) * UNIT_PX_Y;
  const h = u.oneWay ? Math.min(u.aabb.h * UNIT_PX_Y, PLATFORM_DRAW_H) : u.aabb.h * UNIT_PX_Y;
  return { x: px, y: py, w: u.aabb.w * UNIT_PX_X, h, oneWay: u.oneWay };
}
/** A slot's surface elevation (units) to the y of its top surface (world px). */
function surfaceY(zone, elevationUnits) {
  // Vertical zones: elevation counts up from the BOTTOM platform (b.y + b.h),
  // not ZONE_GROUND_Y — same anchor as verticalUnitBox.
  if (zone.orientation === 'vertical') {
    return zone.bounds.y + zone.bounds.h - elevationUnits * UNIT_PX_Y;
  }
  return ZONE_GROUND_Y - elevationUnits * UNIT_PX_Y;
}
/** A slot's x position (units) to world px. */
function slotX(zone, unitX) {
  return zone.bounds.x + unitX * UNIT_PX_X;
}

/**
 * Center an item of pixel width `itemW` on its slot cell: the cell spans
 * [slotX, slotX + UNIT_PX_X), so the item's left edge is offset by half the
 * leftover space. BUGFIX: items were previously placed at the cell's LEFT
 * EDGE, so a 32px barrel in a 72px cell hung ~20px left of center — reading
 * as "under the platform" instead of "on it".
 */
function slotCenterX(zone, unitX, itemW) {
  return slotX(zone, unitX) + Math.max(0, (UNIT_PX_X - itemW) / 2);
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
export function instantiateZone(zone, layout, population) {
  const isVertical = zone.orientation === 'vertical';
  const boxOf = isVertical ? verticalUnitBox : horizontalUnitBox;

  // Terrain: the zone's structural platforms (floor / bottom+top) plus the
  // composed macro units (solid blocks + one-way platforms).
  const solids = zone.platforms.map((p) => ({ ...p }));
  for (const u of layout?.units ?? []) {
    if (u.kind === 'block' || u.kind === 'platform') solids.push(boxOf(zone, u));
  }

  // Enemies / barrels / powerups: instantiate on the slot's surface.
  // BUGFIX (offsets): items were placed at the cell's LEFT edge with a
  // hardcoded vertical offset (-48 / -28) that only matched some item
  // heights — so they hung off-center and read as "under" the platform.
  // Now: centered on the cell, feet exactly on the slot's surface elevation
  // using each item's OWN height (no magic numbers).
  //
  // SAFETY NET (spawn-inside): a slot's elevation can be wrong (the composer
  // picks the supporting surface by x-range, which is ambiguous in narrow
  // vertical climbs where many platforms stack at the same x). If the slot's
  // surface has NO solid directly under it, the item would spawn in mid-air or
  // inside a platform and fall through one-way landings. Fix: drop the feet
  // down to the nearest real surface below. Items on valid slots are already
  // resting on a surface, so this is a no-op for them.
  const snapFeetToSurface = (feetY, leftX, rightX) => {
    let best = null;
    for (const s of solids) {
      if (rightX <= s.x || leftX >= s.x + s.w) continue; // no horizontal overlap
      // Surface at/below the feet → candidate to stand on.
      if (s.y >= feetY - 1) {
        if (best === null || s.y < best) best = s.y; // nearest surface below
        continue;
      }
      // Surface ABOVE the feet: only counts if the feet are INSIDE that solid
      // (feet below its top but above its bottom) — i.e. spawned inside it.
      // Snap up onto its top face. Nearest such top wins.
      if (s.y + s.h > feetY) {
        if (best === null || s.y > best) best = s.y;
      }
    }
    return best !== null ? best : feetY;
  };
  const enemies = (population?.enemies ?? []).map((it) => {
    const f = ENEMY_FACTORIES[it.type];
    if (!f) return null; // unknown type — skip (soft) rather than crash
    const probe = f(0, 0);
    const x = slotCenterX(zone, it.x, probe.w);
    const feet = snapFeetToSurface(surfaceY(zone, it.y ?? 0), x, x + probe.w);
    const y = feet - probe.h; // feet on the surface
    return f(x, y);
  }).filter(Boolean);

  const barrels = (population?.barrels ?? []).map((it) => {
    const f = BARREL_FACTORIES[it.type];
    if (!f) return null;
    const probe = f(0, 0);
    const x = slotCenterX(zone, it.x, probe.w);
    const feet = snapFeetToSurface(surfaceY(zone, it.y ?? 0), x, x + probe.w);
    const y = feet - probe.h; // feet on the surface
    return f(x, y);
  }).filter(Boolean);

  const powerups = (population?.powerups ?? []).map((it) => {
    const p = new Powerup(it.type, 0, 0);
    const x = slotCenterX(zone, it.x, p.w);
    const feet = snapFeetToSurface(surfaceY(zone, it.y ?? 0), x, x + p.w);
    const y = feet - p.h; // bottom on the surface
    p.x = x;
    p.y = y;
    return p;
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
export function buildWorld(levelDef, config, seed) {
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

// The most recently composed terrain + seed, exposed so the trace's areaMap can
// snapshot each area's generated layout (see captureAreaMap). Set by buildWorld.
let _lastTerrain = null;
let _lastSeed = null;

/**
 * The per-game generation seed. A genuinely new game rolls a fresh seed so its
 * terrain + population differ from the previous game (lifecycle.md §6). Death
 * and Continue never call this — they reuse the world already built for the
 * game, so a run's arrangement stays fixed.
 * @returns {number}
 */
export function newGameSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0);
}

/**
 * Snapshot the generated terrain into the hero's trace areaMap (one entry per
 * ordinary area). Called once per new game, right after startGame builds the
 * fresh hero + trace. Each entry stores the seed, orientation, stage, budget,
 * the macro ids placed, and the placed units in UNIT SPACE (the PNG/debug tool
 * multiplies by UNIT_PX_X / UNIT_PX_Y when drawing). The layout is stable for
 * (rolled once per seed), so this snapshot stays accurate even if macro
 * definitions change later.
 * @param {Hero} h the fresh hero (owns .traceStats)
 */
export function captureAreaMap(h) {
  if (!h?.traceStats || !_lastTerrain) return;
  const level = h.currentLevel ?? 1;
  for (const [areaIdx, layout] of _lastTerrain) {
    const areaId = formatAreaId(level, areaIdx);
    recordAreaMap(h, areaId, {
      seed: _lastSeed,
      orientation: layout.orientation,
      stage: layout.stage,
      budget: layout.budget,
      zoneWidthPx: layout.orientation === 'vertical' ? VIEW_W : layout.budget * UNIT_PX_X,
      zoneHeightPx: layout.orientation === 'vertical' ? layout.budget * UNIT_PX_Y : VIEW_H,
      unitPxX: UNIT_PX_X,
      unitPxY: UNIT_PX_Y,
      // R5.2: the platform's DRAW height in px (single source of truth =
      // PLATFORM_DRAW_H). Consumers (PNG tool) multiply by their render
      // scale; old dumps without this field fall back to unitPxY/8.
      platformDrawH: PLATFORM_DRAW_H,
      macros: (layout.macros ?? []).map((id) => ({ id })),
      slots: (layout.placements ?? []).map((p) => ({
        x: p.x,
        y: p.y,
        type: p.type,
      })),
      // R4.1: placedUnits carry the 2D GRID layout in unit space — (x, y)
      // plus width/height in unit counts — so the dump fully reconstructs each
      // area's terrain including stacked units. `x`/`y` are the authoritative
      // grid positions (convert with the stored unitPxX/unitPxY header).
      placedUnits: (layout.units ?? []).map((u) => ({
        kind: u.kind,
        x: u.aabb.x,
        y: u.kind === 'platform' && layout.orientation !== 'vertical' ? (u.tier ?? 0) : u.aabb.y,
        w: u.aabb.w,
        // R5.2: platforms carry their THIN draw height (fractional units) so
        // the dump distinguishes a thin platform from a solid block purely
        // from the data; blocks keep full integer heights. The logical
        // footprint (h=1 unit of clearance space) is unchanged.
        h: u.kind === 'platform' ? PLATFORM_DRAW_H / UNIT_PX_Y : u.aabb.h,
        tier: u.tier,
        height: u.height,
        oneWay: !!u.oneWay,
      })),
    });
  }
}
