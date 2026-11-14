// Petal Panic — zone runtime (extracted from systems/update.js).
//
// The active-zone installation seam: loadActiveZone swaps ALL world contents
// when the active zone changes (structure.md §2); rebuildZoneContent is the
// fresh-install implementation enterZone's 'rebuild' transitions route through
// (fresh-zone-cleanup); regenerateWorld establishes a brand-new world for a
// genuinely new game. update.js owns the module-level lists and registers
// these with the shared ctx at boot, so this file stays pure over them.
import { ctx } from '../world/context.js';
import { SolidBox } from '../core/solidBox.js';
import { VIEW_W } from '../core/view.js';
import { makeElephant } from '../boss/boss.js';
import { restoreBossRunFloor } from '../boss/bossFlow.js';
import { buildWorld, instantiateZone, newGameSeed, getLastWorldSeed } from './build.js';
import { getLevelConfig } from './levelConfigs.js';
import { LEVELS } from './level.js';
import { ZONE_GROUND_Y } from './level.js';
import { makeCheckpoint } from '../objects/object.js';
import { setRebuildZoneContent } from '../systems/lifecycle.js';

// Mutable state lives in ctx (wired by update.js at boot). The three
// functions below read it through small local helpers so a swap (new game /
// menu continue) is always seen: world + boss are reassigned by
// regenerateWorld and pushed back to ctx immediately.
const LEVEL_DEF = LEVELS[0];
const LEVEL_CONFIG = getLevelConfig(LEVEL_DEF.index) ?? {};

let world = null;   // mirrors ctx.world (regenerateWorld pushes both)
let boss = null;    // mirrors ctx.boss

let _collisionWorld = null;
/** update.js wires the collision world here at creation (before ctx exists). */
export function setCollisionWorld(cw) { _collisionWorld = cw; }

/** update.js calls this after wiring ctx at boot AND after any hero/world swap. */
export function syncRuntimeState() {
  world = ctx.world;
  boss = ctx.boss;
}

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
  ctx.bombAttacks?.clear();
  // Remove the previous zone's content from the collision world.
  const oldCounts = { solids: ctx.solidEntities.length, enemies: ctx.realEnemies.length, barrels: [...ctx.barrels,...ctx.woodBarrels,...ctx.coinBarrels].length, powerups: ctx.powerups.length, cps: ctx.checkpoints.length };
  const cwBefore = _collisionWorld.entities.size;
  for (const s of ctx.solidEntities) _collisionWorld.remove(s);
  for (const e of ctx.realEnemies) _collisionWorld.remove(e);
  for (const b of [...ctx.barrels, ...ctx.woodBarrels, ...ctx.coinBarrels]) _collisionWorld.remove(b);
  for (const p of ctx.powerups) _collisionWorld.remove(p);
  for (const c of ctx.checkpoints) _collisionWorld.remove(c);
  // The boss lives ONLY in the boss zone. Remove it from the collision world
  // when leaving so it cannot physically exist in ordinary areas (same logic
  // as any enemy — it is zone-scoped content, not a global entity).
  if (zone.kind !== 'boss') _collisionWorld.remove(ctx.boss);
  const cwAfterRemove = _collisionWorld.entities.size;

  // Clear the module-level lists.
  ctx.solids.length = 0;
  ctx.solidEntities.length = 0;
  ctx.realEnemies.length = 0;
  ctx.barrels.length = 0;
  ctx.woodBarrels.length = 0;
  ctx.coinBarrels.length = 0;
  ctx.powerups.length = 0;
  ctx.checkpoints.length = 0;

  // Install the new zone's content.
  const solids = content?.solids ?? zone.platforms.map((p) => ({ ...p }));
  console.log('[loadActiveZone] zone=' + (zone.areaIdx ?? 'boss') + ' solids count=' + solids.length + ' floor present=' + solids.some(s => s.kind === 'floor'));
  for (const s of solids) {
    ctx.solids.push(s);
    ctx.solidEntities.push(new SolidBox(s));
    _collisionWorld.add(ctx.solidEntities[ctx.solidEntities.length - 1]);
  }
  for (const e of content?.enemies ?? []) { ctx.realEnemies.push(e); _collisionWorld.add(e); }
  for (const b of content?.barrels ?? []) { ctx.barrels.push(b); _collisionWorld.add(b); }
  for (const p of content?.powerups ?? []) { ctx.powerups.push(p); _collisionWorld.add(p); }
  for (const c of content?.checkpoints ?? []) { ctx.checkpoints.push(c); _collisionWorld.add(c); }
  // The boss is zone-scoped content: add it to the collision world ONLY when
  // entering the boss zone. It is positioned by beginBossZoneFlow() (off-screen
  // right, invisible) once the hero confirms the entry screen.
  if (zone.kind === 'boss') {
    _collisionWorld.add(boss);
    console.log(`[loadActiveZone] boss added to collision world`);
  }
  console.log(`[loadActiveZone] zone=${zone.areaIdx} removed ${JSON.stringify(oldCounts)} cw:${cwBefore}→${cwAfterRemove}, added new, cw final: ${_collisionWorld.entities.size}`);
  console.log(`[loadActiveZone] checkpoints: ${ctx.checkpoints.map(c => `${c.checkpointId}@(${c.x},${c.y}) layer=${c.layer} alive=${c.alive}`).join(', ')}`);

  // Refresh the area context's barrel list (its identity is stable).
  ctx.areaContext.barrels.length = 0;
  ctx.areaContext.barrels.push(...ctx.barrels);
  return ctx.areaContext;
}

/**
 * FRESH ZONE INSTALL — the implementation enterZone's 'rebuild' transitions
 * route through (registered via setRebuildZoneContent). Tears down every
 * transient (attack handles, projectiles, fire zones, particles, effects),
 * re-instantiates the hero's CURRENT zone from layout + population snapshot
 * (instantiateZone → brand-new entity objects), and rebinds the camera. Boss
 * zones reinstall their run-phase content and tear down any active battle
 * room (boss-arena.md §3). This is the former resetActiveZoneContent body —
 * callers no longer invoke it separately; enterZone owns the ordering
 * (run rule → life rule → rebuild → place hero).
 */
export function rebuildZoneContent(ctxArg, h) {
  const hero = ctx.hero ?? h;
  // Transient teardown is invoked by enterZone BEFORE this runs (the context's
  // clearTransients hook) — see bindAreaContext below. This stays a no-op guard
  // for any direct call path that skipped it.
  const activeZone = ctx.getActiveZone(hero);
  if (activeZone.kind === 'area' && world.world.has(activeZone.areaIdx)) {
    const fresh = instantiateZone(
      activeZone,
      world.terrain.get(activeZone.areaIdx),
      world.population.get(activeZone.areaIdx),
      ctx.levelZones,
    );
    loadActiveZone(activeZone, fresh);
  } else if (activeZone.kind === 'boss') {
    // Boss zone: re-install the run-phase content — the floor + the boss
    // checkpoint flag at the far right (fresh, un-triggered). The battle room
    // is torn down: machine dormant, camera re-bound to full zone width, boss
    // pulled out of the collision world (re-added by enterBossRoom on trigger).
    const bossCp = activeZone.entryFlag
      ? [makeCheckpoint(activeZone.entryFlag.id, activeZone.entryFlag.x, activeZone.entryFlag.y, { isEntry: true, appearance: activeZone.entryFlag.appearance, spawnPos: activeZone.spawn })]
      : [];
    loadActiveZone(activeZone, { solids: activeZone.platforms.map(p => ({...p})), enemies: [], barrels: [], powerups: [], checkpoints: bossCp });
    if (ctx.solidEntities.length === 1 && ctx.solidEntities[0] && ctx.solids[0].w === VIEW_W) {
      restoreBossRunFloor();
    }
    _collisionWorld.remove(ctx.boss);
    ctx.bossZone?.reset();
    ctx.camera.unlock();
  }
  ctx.camera.setZoneBounds(activeZone);
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
export function regenerateWorld(oldCtx) {
  world = buildWorld(LEVEL_DEF, LEVEL_CONFIG, newGameSeed());
  // ctx.world is a stable reference read by zoneLifecycle.js (retry / death /
  // advance reinstalls). Keep it pointed at the fresh world or later zone
  // switches would pull content from the previous game's world.
  ctx.world = world;

  // Re-create the boss for the fresh game (it is a fresh entity per game).
  const oldBoss = boss;
  boss = makeElephant(-9999, ZONE_GROUND_Y); // parked off-world until the battle room
  ctx.boss = boss;
  // The boss-zone flow machine references the boss entity; it reads boss.x/y
  // live, so it needs no rewiring. (The machine holds the same object
  // reference it was created with — point it at the fresh boss.)
  ctx.bossZone.boss = boss;
  // MAJOR 8: the area context's boss reference must follow the re-created
  // boss, so the fresh-zone install uses the FRESH boss on a
  // life loss in the new game, not the stale entity from the old one.
  ctx.areaContext.boss = boss;
  if (oldBoss && _collisionWorld.entities.has(oldBoss)) _collisionWorld.remove(oldBoss);
  _collisionWorld.add(boss);

  // Install the FIRST zone (area 1) so the collision world is bound to the
  // fresh world. MAJOR 7: do NOT read getActiveZone(hero) here — the old
  // hero (still the module-level reference) may be on a later area from the
  // finished game; a new game always starts in the first zone (lifecycle.md
  // §1). The hero is managed by startGame() (removes oldHero / adds the
  // new hero), so we don't touch the hero here.
  const active = ctx.levelZones[0]; // area 1, the first zone
  loadActiveZone(active, world.world.get(active.areaIdx));
  ctx.camera.setZoneBounds(active);

  return ctx.areaContext;
}

