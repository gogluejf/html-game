// Zone lifecycle — area-clear sequence, area-entry auto-advance, entry
// positions, and retry/continue from game over.
// All shared mutable state is read/written through ctx (world/context.js) to
// avoid a circular import back into systems/update.js.

import { ctx } from './context.js';
import { ZONE_ENTRY_X, ZONE_GROUND_Y } from './level.js';
import { VIEW_W, VIEW_H } from '../core/view.js';
import { TUNING } from '../tuning.js';
import { S, getState, setState, tryTransition } from '../core/state.js';
import { fireManual } from '../effects/index.js';
import { Debug } from '../debug/debug.js';
import { makeCheckpoint } from '../objects/object.js';
import { showAreaEntry, formatAreaId, recordAreaEntrySnapshot, setAreaEntryFadeOutCallback, startLife, continueRun } from '../systems/lifecycle.js';
import { instantiateZone } from './build.js';
import { restoreBossRunFloor } from '../boss/bossFlow.js';

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
export const CLEAR_SEQ = {
  FLASH: TUNING.clearFlash,   // seconds of celebratory flash
  BANNER: TUNING.clearBanner, // seconds the 'X-Y CLEAR' banner is held
  FADE_OUT: TUNING.clearFadeOut, // seconds to fade to black before the entry screen
  FADE_IN: TUNING.clearFadeIn,   // seconds to fade into the new zone after the entry screen
};
export let clearSeq = {
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
  clearSeq.state = 'banner';
  clearSeq.timer = 0;
  clearSeq.bannerText = `${areaId} CLEAR`;
  clearSeq.pendingArea = nextArea;
  clearSeq.pendingFadeIn = true;
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
  const hero = ctx.hero;
  const zone = ctx.getActiveZone(hero);
  if (zone.kind === 'boss') {
    // At the boss zone there is no further area in this level. Wrap back to
    // area 1 of the current level so the developer can re-test the run quickly.
    // (If multiple levels were supported this would advance to the next
    // level's area 1 instead.) If a battle room is currently up, tear it down
    // first (machine dormant, camera un-frozen) so nothing leaks into 1-1.
    Debug.logEvent('wrap: boss → level 1-1 (restart)');
    if (ctx.bossZone.active) {
      ctx.bossZone.reset();
      ctx.camera.unlock();
    }
    // If a battle room was up, its 960px floor replaced the run floor —
    // restore it before loading area 1 (loadActiveZone will replace solids
    // anyway, but this keeps the boss zone's own state consistent for a
    // later wrap back into 1-B).
    hero.currentArea = 1;
    const z1 = ctx.getActiveZone(hero);
    if (z1.kind === 'area' && ctx.world.world.has(z1.areaIdx)) {
      ctx.loadActiveZone(z1, ctx.world.world.get(z1.areaIdx));
    }
    hero.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y - hero.h };
    recordAreaEntrySnapshot(hero);
    ctx.camera.setZoneBounds(z1);
    showAreaEntry(hero, ctx.areaContext);
    beginAreaEntryPresentation(); // reset the timer (transition may not fire if already in AREA_ENTRY)
    return;
  }
  if (zone.kind !== 'area') return;
  const nextArea = zone.areaIdx === 4 ? ctx.AREA_BOSS : zone.areaIdx + 1;
  Debug.logEvent(`wrap → ${formatAreaId(hero.currentLevel, nextArea)}`);
  // Advance directly: set the hero's area, load the zone content, place the
  // checkpoint, record the snapshot, and show the entry screen — skipping the
  // banner + fade-out that onExitFlagReached would otherwise play.
  hero.currentArea = nextArea;
  const nextZone = ctx.getActiveZone(hero);
  if (nextZone.kind === 'area' && ctx.world.world.has(nextZone.areaIdx)) {
    ctx.loadActiveZone(nextZone, ctx.world.world.get(nextZone.areaIdx));
  } else if (nextZone.kind === 'boss') {
    const bossCp = nextZone.entryFlag
      ? [makeCheckpoint(nextZone.entryFlag.id, nextZone.entryFlag.x, nextZone.entryFlag.y, { isEntry: true, appearance: nextZone.entryFlag.appearance })]
      : [];
    ctx.loadActiveZone(nextZone, { solids: nextZone.platforms.map(p => ({...p})), enemies: [], barrels: [], powerups: [], checkpoints: bossCp });
  }
  if (nextZone.kind === 'boss') {
    // Wrapping INTO the boss zone starts the run phase clean: machine dormant,
    // camera bound to the full zone width, hero at the left entry. The battle
    // room begins only when the hero crosses the checkpoint (or on the next W).
    if (ctx.bossZone.active) {
      ctx.bossZone.reset();
      ctx.camera.unlock();
    }
    // Entering the boss zone starts the RUN phase: hero at the left entry,
    // normal camera, machine dormant. The battle room begins only when the
    // hero crosses the boss checkpoint at the far right (HERO×CHECKPOINT).
    hero.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y - hero.h };
  } else if (nextZone.entryFlag) {
    hero.checkpoint = { x: nextZone.bounds.x + nextZone.entryFlag.x, y: nextZone.entryFlag.y };
  } else {
    hero.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y - hero.h };
  }
  recordAreaEntrySnapshot(hero);
  ctx.camera.setZoneBounds(nextZone);
  showAreaEntry(hero, ctx.areaContext);
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
  const hero = ctx.hero;
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
      const nextZone = ctx.getActiveZone(hero);
      // BLOCKER 2: swap the ACTIVE zone's world content so the previous
      // zone's terrain, enemies, barrels, powerups, and checkpoints do not
      // linger after the advance (structure.md §2: "a new zone replaces it").
      // The boss zone has no stored population (buildWorld skips non-area
      // zones), so loadActiveZone uses its fallback (zone.platforms = just
      // the floor) — clearing all previous-area entities.
      if (nextZone.kind === 'area' && ctx.world.world.has(nextZone.areaIdx)) {
        ctx.loadActiveZone(nextZone, ctx.world.world.get(nextZone.areaIdx));
        console.log(`[zone] loaded zone ${nextZone.areaIdx}, checkpoints: ${ctx.checkpoints.map(c => c.checkpointId + (c.isEntry ? '(entry)' : '(exit)')).join(', ')}`);
      } else if (nextZone.kind === 'boss') {
        // The boss zone has no composed population, but it DOES install its
        // entry flag (the boss checkpoint) so the hero can respawn beside it
        // after a death. Pass a minimal content object with just the checkpoint.
        const bossCp = nextZone.entryFlag
          ? [makeCheckpoint(nextZone.entryFlag.id, nextZone.entryFlag.x, nextZone.entryFlag.y, { isEntry: true, appearance: nextZone.entryFlag.appearance })]
          : [];
        ctx.loadActiveZone(nextZone, { solids: nextZone.platforms.map(p => ({...p})), enemies: [], barrels: [], powerups: [], checkpoints: bossCp });
        console.log(`[zone] loaded boss zone (empty arena + checkpoint)`);
      } else {
        console.log(`[zone] WARNING: no content for zone ${nextZone.areaIdx} (kind=${nextZone.kind}, has=${ctx.world.world.has(nextZone.areaIdx)})`);
      }
      // Set the checkpoint to the next zone's entry flag position so
      // startLife can latch the matching flag. For area 1 (no entry
      // flag), use the zone's start position. For the BOSS zone, the hero
      // starts at the LEFT and walks right across the whole zone to the
      // boss checkpoint at the far right (run phase) — same as any area.
      if (nextZone.kind === 'boss') {
        hero.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y - hero.h };
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
      showAreaEntry(hero, ctx.areaContext);
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
  const hero = ctx.hero;
  clearSeq.pendingFadeIn = false;
  clearSeq.state = 'fadeIn';
  clearSeq.timer = 0;
  // Place the hero at the new zone's start on the GROUND (not above the
  // entry flag). The entry flag is a naive sprite with zero collision; the
  // hero should stand on the floor beside it, not drop onto it.
  const zone = ctx.getActiveZone(hero);
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
  ctx.camera.setZoneBounds(zone);
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
  const hero = ctx.hero;
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
      startLife(hero, ctx.areaContext);
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

// --- Entry positions -----------------------------------------------------------
// The hero's physical entry position for the active zone. Area -1 has no entry
// flag (it starts at the zone's start); later areas start beside their entry
// flag (checkpoints.md §1). startLife() owns placing the hero (lifecycle.md §3);
// these helpers give the lifecycle ops + boot the correct entry position.
function entryPosition(zone) {
  const b = zone.bounds;
  // The boss zone's entry flag is the boss checkpoint at the FAR RIGHT — it
  // is a trigger, not a spawn point. The hero enters the boss zone at the
  // LEFT like any other area and walks right to the checkpoint (run phase).
  if (zone.kind === 'boss') {
    return { x: b.x + ZONE_ENTRY_X, y: ZONE_GROUND_Y };
  }
  if (zone.entryFlag) {
    return { x: b.x + zone.entryFlag.x, y: b.y + zone.entryFlag.y };
  }
  // Area -1: start at the zone's start (beside where an entry flag would be).
  const bottomY = zone.orientation === 'vertical' ? b.y + b.h : ZONE_GROUND_Y;
  return { x: b.x + ZONE_ENTRY_X, y: bottomY };
}
/** The hero's top-left position (top = surfaceY - hero.h) for the active zone. */
export function heroEntryPosition(hero, zone) {
  const z = zone ?? ctx.getActiveZone(hero);
  const p = entryPosition(z);
  return { x: p.x, y: p.y - hero.h };
}

// --- Retry / Continue from game over -------------------------------------------
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
export function resetActiveZoneContent() {
  const hero = ctx.hero;
  const activeZone = ctx.getActiveZone(hero);
  if (activeZone.kind === 'area' && ctx.world.world.has(activeZone.areaIdx)) {
    const fresh = instantiateZone(
      activeZone,
      ctx.world.terrain.get(activeZone.areaIdx),
      ctx.world.population.get(activeZone.areaIdx),
    );
    ctx.loadActiveZone(activeZone, fresh);
  } else if (activeZone.kind === 'boss') {
    // Boss zone: re-install the run-phase content — the floor + the boss
    // checkpoint flag at the far right (fresh, un-triggered). The battle room
    // is torn down: the machine goes dormant, the camera is re-bound to the
    // full zone width, and the boss is pulled out of the collision world
    // (re-added by enterBossRoom on the next trigger). Death in the room
    // restarts the WHOLE area (boss-arena.md §3).
    const bossCp = activeZone.entryFlag
      ? [makeCheckpoint(activeZone.entryFlag.id, activeZone.entryFlag.x, activeZone.entryFlag.y, { isEntry: true, appearance: activeZone.entryFlag.appearance })]
      : [];
    ctx.loadActiveZone(activeZone, { solids: activeZone.platforms.map(p => ({...p})), enemies: [], barrels: [], powerups: [], checkpoints: bossCp });
    // If a battle room was up, its 960px floor replaced the run floor —
    // restore the full zone floor so the re-walk has ground under it.
    if (ctx.solids.length === 1 && ctx.solidEntities[0] && ctx.solids[0].w === VIEW_W) {
      restoreBossRunFloor();
    }
    ctx.collisionWorld.remove(ctx.boss);
    ctx.bossZone.reset();
    ctx.camera.unlock();
    ctx.camera.setZoneBounds(activeZone);
    hero.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y - hero.h };
  }
}

export function retryFromGameOver() {
  const hero = ctx.hero;
  // Retry takes the SAME restart path as losing a life — except it does NOT
  // consume one. It resets the active zone to a fresh arrangement (enemies,
  // barrels, powerups, coins all restored exactly like a death-restart) and
  // opens the shared level-start / area-entry view. The timed entry sequence
  // then fades in, holds, and auto-starts play via startLife (which also
  // restores the preserved arrangement + hero placement).
  resetActiveZoneContent();
  showAreaEntry(hero, ctx.areaContext);
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
  const hero = ctx.hero;
  const applied = continueRun(hero, ctx.areaContext);
  if (applied) console.log('[lifecycle] continue applied');
  return applied;
}
