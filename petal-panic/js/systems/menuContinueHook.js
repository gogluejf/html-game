// Petal Panic — menu continue / level select / boss rush → AREA_ENTRY hook
// (extracted from systems/update.js, menu-hub plan §2.3 / §3.2 / §3.3).
//
// When the menu hub's Continue option OR the level select screen OR the boss
// rush screen opens the shared area-entry screen for a SAVED or CHOSEN
// level/area, install that zone's world content + spawn checkpoint: rebuild
// the world from the saved seed when it differs, swap the hero definition if
// the save names a different one, restore the persistent columns, and install
// the zone fresh. update.js registers this at boot by importing this module
// for its side effect; all mutable state is read through ctx.
import { S, onTransition } from '../core/state.js';
import { HEROES } from '../hero/heroDefs.js';
import { createTrace } from '../stats.js';
import { GAME_RULES, createContinuePool } from './gameRules.js';
import { loadStore } from './progressStore.js';
import { makeHero, applySavedState, bindAreaContext } from './lifecycle.js';
import { setMenuEntryPending } from '../world/zoneLifecycle.js';
import { buildWorld, instantiateZone, getLastWorldSeed } from '../world/build.js';
import { LEVELS, ZONE_ENTRY_X, ZONE_GROUND_Y } from '../world/level.js';
import { getLevelConfig } from '../world/levelConfigs.js';
import { makeCheckpoint } from '../objects/object.js';
import { loadActiveZone, syncRuntimeState } from '../world/runtime.js';
import { restoreBossRunFloor } from '../boss/bossFlow.js';
import { setHeroRef } from './heroRef.js';
import { ctx } from '../world/context.js';

onTransition((from, to) => {
  if (to === S.AREA_ENTRY && (from === S.MENU || from === S.LEVEL_SELECT || from === S.BOSS_RUSH)) {
    let h = ctx.hero;
    // This zone was installed FROM THE MENU (reload-Continue / level select /
    // boss rush): the entry sequence MUST start the attempt in FAILURE flavor
    // (state-persistence.md §2.6 — snapshot rollback, full energy, weapon
    // cleared), never as an advance. The flag is consumed by the entry
    // sequence when the attempt starts.
    //
    // CRITICAL ORDERING: arm this AFTER the transition has fired, not inside
    // the hook. showAreaEntry() calls tryTransition() and fires ALL listeners
    // synchronously before returning — a mid-run death or clear-sequence
    // advance reaches AREA_ENTRY via PLAY→AREA_ENTRY while THIS listener is
    // still executing for an earlier menu entry, and would see `from` as the
    // menu state and wrongly force the failure flavor on a genuine zone pass
    // (§2.3 keep-everything broken: energy/weapon reset on next-area).
    queueMicrotask(() => setMenuEntryPending(true));
    // A Continue after a page reload must rebuild the world with the SAVED
    // generation seed (saveMeta.seed) so the run resumes on the exact terrain
    // + spawns it was played on. In-session continues skip this: the live
    // world already matches. Legacy saves without a seed keep today's behavior
    // (the module-load world). Level Select / Boss Rush are the same rule:
    // starting a zone from the menu must not silently fall back to a stale
    // or freshly-rolled world — if the save names a different seed, rebuild.
    const sm = loadStore().saveMeta;
    // Hero identity restore: if the saved run was played with a different hero
    // than the current one (always Scarlet on fresh page load), rebuild the
    // hero with the correct definition BEFORE restoring state onto it.
    if (sm?.heroId && sm.heroId !== ctx.hero.heroDef?.id) {
      const def = HEROES[sm.heroId] || HEROES.scarlet;
      const newH = makeHero(def);
      newH.lives = GAME_RULES.startingLives;
      newH.continues = createContinuePool(GAME_RULES.startingContinues);
      Object.defineProperty(newH, 'continuesUsed', {
        get() { return GAME_RULES.startingContinues - newH.continues.remaining; },
        set(n) { newH.continues.remaining = GAME_RULES.startingContinues - n; },
      });
      newH.traceStats = createTrace();
      newH.wallet.snapshots = {};
      // Swap: remove old hero from collision world, add new one, rebind refs.
      ctx.collisionWorld.remove(ctx.hero);
      ctx.collisionWorld.add(newH);
      setHeroRef(newH);
      bindAreaContext(newH, ctx.areaContext);
      // Re-apply saved state onto the CORRECT hero (continueFromMenu applied
      // it to the old hero before the transition fired; we redo it here).
      newH.currentLevel = sm.level;
      newH.currentArea = sm.area;
      if (sm.state && typeof sm.state === 'object') applySavedState(newH, sm.state);
      h = newH; // rebind local ref so checkpoint/zone logic below uses the new hero
      console.log(`[lifecycle] ${from} continue: swapped hero to ${sm.heroId}`);
    }
    if (sm && Number.isInteger(sm.seed) && sm.seed !== getLastWorldSeed()) {
      world = buildWorld(LEVELS[0], getLevelConfig(LEVELS[0].index) ?? {}, sm.seed);
      // CRITICAL: ctx.world is a STABLE reference read by resetActiveZoneContent /
      // continueFromGameOver / stepClearSequence (zoneLifecycle.js). Swapping only
      // the local `world` leaves ctx pointing at the PREVIOUS game's world, so any
      // later zone reinstall (retry, death-restart, advance) pulls terrain +
      // population from the stale world — the "retry spawns me in a NEW 1-1" bug.
      ctx.world = world;
      syncRuntimeState();
      console.log(`[lifecycle] ${from} continue: rebuilt world from saved seed ${sm.seed}`);
    }
    // Persistent-column resume (state-persistence.md §2.6): AFTER the seed
    // rebuild and BEFORE the zone installs, restore lives + continues + the
    // zone-snapshot chain onto the hero. The entry screen then shows the saved
    // life count, and the entry sequence's failure-style restart rolls
    // coins/score back to the SAVED ZONE's entry snapshot with full energy and
    // cleared weapon — identical in-session and after a page reload. Legacy
    // saves without a `state` block keep today's behavior.
    if (sm?.state && typeof sm.state === 'object') applySavedState(h, sm.state);
    // Tear down any lingering boss battle room before swapping zones (a fresh
    // resume must not inherit COMBAT state from a finished run).
    if (ctx.bossZone?.active) { ctx.bossZone.reset(); ctx.camera.unlock(); restoreBossRunFloor(); }
    // Attempt boundary: a menu continue / level-select / boss-rush entry starts
    // with zero transients — no fire zones, projectiles, particles, or effects
    // from the previous session may bleed into the resumed zone.
    ctx.areaContext.clearTransients?.();
    const zone = ctx.getActiveZone(h);
    if (zone.kind === 'area' && world.world.has(zone.areaIdx)) {
      // world.world holds live instances, not a pristine snapshot: same-seed
      // menu returns can otherwise revive enemies with destroyed/_deathHandled
      // still set and barrels with _destroyHandled (suppressing their blasts).
      // Recreate runtime state from the preserved arrangement, as retry does.
      loadActiveZone(zone, instantiateZone(
        zone, world.terrain.get(zone.areaIdx), world.population.get(zone.areaIdx), ctx.levelZones,
      ));
    } else if (zone.kind === 'boss') {
      const bossCp = zone.entryFlag
        ? [makeCheckpoint(zone.entryFlag.id, zone.entryFlag.x, zone.entryFlag.y, { isEntry: true, appearance: zone.entryFlag.appearance, spawnPos: zone.spawn })]
        : [];
      loadActiveZone(zone, { solids: zone.platforms.map(p => ({...p})), enemies: [], barrels: [], powerups: [], checkpoints: bossCp });
    }
    // Spawn checkpoint is zone data (REVISION-zones-as-data §4): feet on the
    // floor of the active room. placeHeroAtEntry() reads this to place the hero.
    const sp = zone.spawn ?? { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y };
    h.checkpoint = { x: sp.x, y: sp.y - h.h };
    ctx.camera.setZoneBounds(zone);
    const label = from === S.LEVEL_SELECT ? 'LEVEL_SELECT' : from === S.BOSS_RUSH ? 'BOSS_RUSH' : 'MENU';
    console.log(`[lifecycle] ${label} continue: installed zone ${zone.areaIdx ?? 'boss'} (checkpoint @${sp.x},${sp.y})`);
  }
});

