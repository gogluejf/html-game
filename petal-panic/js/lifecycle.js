// Petal Panic — lifecycle operations (docs/levels/lifecycle.md).
//
// Starting a game, continuing, entering an area, and starting a life are
// DIFFERENT operations. They may lead to the same entry screen, but they reset
// different things. This module is the single owner of what each start event
// resets — no other module assigns lives / the continue pool / the area
// position for a restart.
//
// The four operations (lifecycle.md):
//   §1 startGame     — from zero: fresh hero, lives, continue pool, fresh
//                      generation choices, enter the first level's area -1.
//   §2 startArea     — first arrival: fix the area's arrangement from this
//                      game's generation choices (already done at generation
//                      time; here we record the area and prepare it), then
//                      begin a life there.
//   §3 startLife     — an attempt in the current area: restore the preserved
//                      arrangement, place the hero at its entry with i-frames.
//                      Lives are untouched (the caller already consumed one).
//   §4 continueRun   — at Game Over: spend exactly one continue, restore the
//                      starting life count, return to area -1 of the CURRENT
//                      level, start a fresh attempt. Never rerolls generation.
//
// This module is pure over the pieces handed to it (hero, entities, pools,
// effects) so the rules are unit-testable in node without a DOM.

import { GAME_RULES, createContinuePool, canSpend, spend, credit, resetLevelCoinTally, resetHeroInventory } from './gameRules.js';
import { LEVELS, ZONE_ENTRY_X, ZONE_GROUND_Y } from './level.js';
import { getLevelConfig } from './levelConfigs.js';
import { Hero } from './hero.js';
import { createStats, calculateScore, cloneStats } from './stats.js';
import { Anim, makeTestFrame } from './anim.js';
import { tryTransition, getState, setState, S } from './state.js';
import { TUNING } from './tuning.js';

// --- Area-entry accounting snapshot (game-rules.md §2/§4) -------------------
//
// game-rules.md §4: "Restoring enemies, barrels, and pickups is confirmed;
// whether their rewards accumulate repeatedly or roll back to the area's entry
// totals is not." The concrete policy is GAME_RULES.coins.accountingOnFailure
// (the TUNING block): 'rollback'. This is ENFORCED here, not just declared —
// a per-area-entry snapshot of the hero's run stats (score inputs, kills,
// coins) is recorded the first time an area is entered, and restored on every
// subsequent startLife() so a failed attempt's kills/coins/score do NOT
// accumulate into the next attempt (which would create the extra-life / coin
// farming loop the doc warns about).
//
// The snapshot is keyed to the (level, area) the hero is entering, so a
// genuine area entry (a new area) records a fresh snapshot, while a death
// restart of the SAME area restores the original entry snapshot. Continue
// returns to area -1 of the current level (a new area), so it records a fresh
// snapshot — and, per GAME_RULES.coins.resetOnContinue, the coin tally is
// additionally zeroed on the continue itself.
//
// WeakMap so the snapshot is garbage-collected with the hero.
const _areaEntrySnapshot = new WeakMap();

/**
 * Record the area-entry snapshot for the hero's current (level, area). Called
 * on a GENUINE area entry (startArea / continueRun / rewardOnAction next
 * level / startGame) — NOT on a death restart of the same area, which must
 * keep the original entry snapshot.
 * @param {Hero} h
 */
export function recordAreaEntrySnapshot(h) {
  const key = `${h.currentLevel}:${h.currentArea}`;
  _areaEntrySnapshot.set(h, { key, stats: cloneStats(h.runStats) });
}

/**
 * Restore the hero's run stats to the recorded area-entry snapshot (if any).
 * A no-op when there is no snapshot (e.g. the very first area of a new game,
 * where runStats is already fresh from startGame) or when the snapshot's key
 * does not match the current (level, area).
 * @param {Hero} h
 */
function restoreAreaEntryStats(h) {
  const snap = _areaEntrySnapshot.get(h);
  if (!snap || snap.key !== `${h.currentLevel}:${h.currentArea}`) return;
  if (!snap.stats || !h.runStats) return;
  for (const [k, v] of Object.entries(snap.stats)) {
    if (v && typeof v === 'object' && h.runStats[k] && typeof h.runStats[k] === 'object') {
      for (const [k2, v2] of Object.entries(v)) h.runStats[k][k2] = v2;
    } else {
      h.runStats[k] = v;
    }
  }
}

// The area a fresh run begins in. Per lifecycle.md §1/§4 a new game and a
// continue both enter area -1 of their level (the pre-area).
const ENTRY_AREA = -1;

// The hero's entry position for a level's pre-area (area -1). A new game and
// a continue both place the hero here so a continue lands the hero at the
// level's beginning rather than wherever they died (lifecycle.md §4).
// MINOR 9: the coordinates are zone-aware (level.js ZONE_ENTRY_X /
// ZONE_GROUND_Y), not stale prototype constants. Area -1 has no entry flag
// (checkpoints.md §1), so its entry is the zone's start position.

/**
 * Build a fresh Hero for a new game with the given definition.
 * Placeholder anims are attached here (the only run-setup site that does so)
 * so the SELECT→PLAY transition hook in update.js stays a thin wrapper.
 * @param {object} heroDef one of HEROES from heroDefs.js
 * @returns {Hero}
 */
export function makeHero(heroDef) {
  const h = new Hero(heroDef, 0, 0);
  h.anim = new Anim(
    ['#2ecc71', '#27ae60', '#1abc9c'].map(c => makeTestFrame(h.w, h.h, c)),
    { speed: 200, loop: true },
  );
  h.anims.attack = new Anim(
    ['#555555', '#888888', '#aaaaaa', '#ffffff', '#666666'].map(c => makeTestFrame(h.w, h.h, c)),
    { speed: 80, loop: false },
  );
  return h;
}

/**
 * Alias the unified run stats onto a hero so damage.js / powerup.js keep
 * writing into the same object (mirrors the pre-refactor wiring).
 * @param {Hero} h
 */
function aliasCombatStats(h) {
  h.runStats = createStats();
  h.combatStats = {
    get projectilesShot() { return h.runStats.projectilesShot; },
    set projectilesShot(v) { h.runStats.projectilesShot = v; },
    hitsLanded: h.runStats.hitsLanded,
    damageDealt: h.runStats.damageDealt,
    powerupsCollected: h.runStats.powerupsCollected,
  };
}

// --- Entity restoration (lifecycle.md §3) ------------------------------------
// "All enemies, barrels, and powerups return to their original positions and
//  initial state. Destroyed objects and defeated enemies are restored."

/** Restore an enemy (regular or boss) to its initial state. */
function restoreEnemy(e) {
  if (!e || e._initPos === undefined) return;
  const p = e._initPos;
  e.x = p.x; e.y = p.y; e.vx = 0; e.vy = 0;
  e.hp = e.maxHp;
  e.alive = true;
  e.aiState = p.aiState;
  e.fading = false;
  e.hitFlash = 0;
  e.hitstunTimer = 0;
  e.timers.map.clear();
  // Subclass-specific transient state.
  if ('whipCooldown' in e) { e.whipCooldown = 0; e.whipActive = false; e.whipTimer = 0; }
  if ('lungeCooldown' in e) { e.lungeCooldown = 0; e.lungeActive = false; e.lungeTimer = 0; e.recoverTimer = 0; }
  if ('paceDir' in e) { e.paceDir = 1; e.projectileTimer = 0; e.meleeActive = false; e.meleeTimer = 0; e.meleeCooldown = 0; }
  if ('fuseTimer' in e) { e.fuseTimer = 0; e.launchTimer = 0; e.explodeTimer = 0; e.exploded = false; }
  if ('phase' in e) { e.phase = 'idle'; e.phaseTimer = 0; e._blastFired = false; e._stomped = false; }
}

/** Restore a GameObj (barrel) to its initial state. */
function restoreBarrel(b) {
  if (!b || b._initPos === undefined) return;
  const p = b._initPos;
  b.x = p.x; b.y = p.y;
  b.hp = b.maxHp;
  b.alive = true;
  b.destroyed = false;
  b.hitFlash = 0;
  b.timers.map.clear();
}

/** Restore a Powerup to its initial state. */
function restorePowerup(p) {
  if (!p || p._initPos === undefined) return;
  const q = p._initPos;
  p.x = q.x; p.y = q.y;
  p.collected = false;
  p.alive = true;
  p.timers.map.clear();
}

/** Restore a Checkpoint flag (re-arm so it can trigger again). */
function restoreCheckpoint(c) {
  if (!c) return;
  c.triggered = false;
  c.flashTimer = 0;
}

/**
 * Reset the hero's transient attempt state (death flags, energy, i-frames) to
 * a clean, playable, not-dying baseline. Full respawn i-frames + the area
 * entry placement are applied afterwards by hero.respawn() so this never
 * double-grants them. This is the shared helper the lifecycle ops use to keep
 * a restart from leaking a death flag / drained energy / stale i-frames into
 * the fresh attempt (lifecycle.md §3). Lives are NOT touched here — the
 * caller owns the life count for each operation.
 * @param {Hero} h
 */
export function resetHeroTransient(h) {
  h.dying = false;
  h.deathTimer = 0;
  h.alive = true;
  h.energy = h.maxEnergy;
  h.intangible = false;
  h.vx = 0;
  h.vy = 0;
}

/**
 * Record the initial (arrangement) position + state of an entity once, so a
 * later startLife/continueRun can restore it. No-op on subsequent calls —
 * the arrangement is fixed for the whole game and must never change.
 */
export function rememberInitial(e, extra = {}) {
  if (e._initPos !== undefined) return;
  e._initPos = { x: e.x, y: e.y, ...extra };
}

/**
 * Restore the whole area from its preserved arrangement: every enemy, barrel,
 * and powerup returns to its original position and initial state; destroyed
 * objects and defeated enemies are restored; checkpoints re-arm; all transient
 * projectiles, coins, and effects from the failed attempt are cleared so they
 * do not leak into the new attempt (lifecycle.md §3).
 *
 * This is REPLAYING the same arrangement, not rolling a new one.
 *
 * @param {object} ctx { enemies, boss, barrels, powerups, checkpoints,
 *                       projectiles, coins, particles, effects }
 */
export function restoreArea(ctx) {
  for (const e of ctx.enemies ?? []) restoreEnemy(e);
  if (ctx.boss) restoreEnemy(ctx.boss);
  for (const b of ctx.barrels ?? []) restoreBarrel(b);
  for (const p of ctx.powerups ?? []) restorePowerup(p);
  for (const c of ctx.checkpoints ?? []) restoreCheckpoint(c);

  // Transient objects must not leak into the new attempt.
  for (const p of ctx.projectiles?.activeItems ?? []) { p.alive = false; }
  if (ctx.projectiles) ctx.projectiles.active.length = 0;
  for (const c of ctx.coins?.activeItems ?? []) { c.alive = false; c.collected = true; }
  if (ctx.coins) ctx.coins.active.length = 0;
  ctx.particles?.reset?.();
  ctx.effects?.reset?.();
}

// --- The four lifecycle operations -------------------------------------------

/**
 * §1/§6 Fresh generation choices for a genuinely new game.
 *
 * The generated world is a module-level singleton owned by update.js (its
 * collision world, camera, and debug overlay are all bound to it). A genuinely
 * new game must establish a FRESH set of random generation choices — the old
 * choices belong to the finished game (lifecycle.md §6: "Quit and start from
 * scratch: the old game is over; new choices are allowed"). Returning from
 * death or using Continue must NEVER reroll (lifecycle.md §1/§4/§6).
 *
 * update.js owns the world and therefore owns re-generation; it supplies this
 * callback so the lifecycle operations stay pure over the pieces they're given
 * (and unit-testable without a DOM). startGame invokes it; startLife and
 * continueRun deliberately do not.
 *
 * @type {((old) => object) | undefined}
 */
let regenerateWorld = null;

/**
 * Register the world-regeneration callback for new games. update.js sets this
 * once at boot; it receives the previous generated world and returns the new
 * one (with its own entity lists).
 * @param {(old) => object} fn
 */
export function setRegenerateWorld(fn) { regenerateWorld = fn; }

/**
 * Clear every recorded arrangement position so the next world generation is
 * treated as a first arrival and records its own fresh positions. Called by
 * startGame when a new world is generated. No-op otherwise — the arrangement
 * is fixed for the whole game and must never change mid-game.
 * @param {object} ctx the area context whose entities are being (re)arranged
 */
export function resetGeneration(ctx) {
  for (const e of ctx.enemies ?? []) delete e._initPos;
  if (ctx.boss) delete ctx.boss._initPos;
  for (const b of ctx.barrels ?? []) delete b._initPos;
  for (const p of ctx.powerups ?? []) delete p._initPos;
}

/**
 * §1 Game start — from zero. Establishes the selected hero, global starting
 * lives and continues, fresh progress/reward accounting, fresh generation
 * choices, and entry into the first level's area -1.
 *
 * Fresh generation choices (lifecycle.md §1/§6): when a regenerate callback is
 * registered (update.js), the previous world is replaced with a freshly
 * generated one and its entities' arrangement positions are cleared so the new
 * world is recorded as a first arrival. Death / Continue never reach here, so
 * they never reroll generation.
 *
 * @param {object} ctx { world, oldHero, areaContext, effects }
 * @param {object} heroDef the selected hero definition (HEROES[...])
 * @returns {Hero} the fresh hero
 */
export function startGame(ctx, heroDef) {
  const h = makeHero(heroDef);
  h.lives = GAME_RULES.startingLives;
  h.continues = createContinuePool(GAME_RULES.startingContinues);
  // continuesUsed is a derived view of the pool for backwards compatibility
  // (HUD, tests, and the GameOver screen read it). Writable so tests can
  // set it directly (which adjusts the pool).
  Object.defineProperty(h, 'continuesUsed', {
    get() { return GAME_RULES.startingContinues - h.continues.remaining; },
    set(n) { h.continues.remaining = GAME_RULES.startingContinues - n; },
  });
  h.currentLevel = 1;
  h.currentArea = ENTRY_AREA;
  // A genuinely new game starts with no level reward in flight. Clear the
  // presented-reward latch so a reward from a PREVIOUS game can never
  // suppress the credit for a genuinely new reward in this one (game-rules.md
  // §2: a reward is credited exactly once, keyed to the reward, not to
  // presentation state left over from a prior run).
  _rewardData = null;
  aliasCombatStats(h);
  // Accounting snapshot (game-rules.md §4): record the (fresh) entry totals
  // for the first area so a later death restart can roll the run stats back
  // to them (the 'rollback' policy).
  recordAreaEntrySnapshot(h);
  // Fresh generation choices for a genuinely new game (lifecycle.md §1/§6).
  // Only when the caller provided the area context (update.js does); a bare
  // startGame (e.g. unit tests) leaves the existing world untouched. Death and
  // Continue never call startGame, so they never reroll.
  if (regenerateWorld && ctx.areaContext) {
    const nw = regenerateWorld(ctx.areaContext);
    resetGeneration(nw);
  }
  // Swap the hero in the collision world (only when a world is provided).
  if (ctx.world) { ctx.world.remove(ctx.oldHero); ctx.world.add(h); }
  ctx.effects?.reset?.();
  // checkpoints.md §3: the shared area-entry screen opens the first area of a
  // new game (level name, area id, lives — no score). startGame does NOT push
  // the screen itself — the caller (update.js) does so AFTER the
  // SELECT→PLAY transition has settled, so the screen data is not cleared by
  // the transition's screen reset.
  return h;
}

/**
 * §2 Area start — first arrival. Fix the area's arrangement from this game's
 * generation choices (the world was already generated deterministically, so
 * this only records the current area and arms its entry), then show the
 * shared area-entry screen; the attempt begins when the player confirms it
 * (lifecycle.md §2: "Show the area-entry screen, then begin play at the
 * area's start").
 *
 * @param {Hero} h
 * @param {number} level the level index (1-based)
 * @param {number} areaIdx the area index (pre-area is -1)
 */
export function startArea(h, level, areaIdx) {
  h.currentLevel = level;
  h.currentArea = areaIdx;
  // Accounting snapshot (game-rules.md §4): record the entry totals for this
  // genuine area entry so a later death restart of the same area can roll the
  // run stats back to them (the 'rollback' policy).
  recordAreaEntrySnapshot(h);
  // checkpoints.md §3: the shared area-entry screen also opens every area
  // advance (and the boss zone, identified as the level's boss area).
  showAreaEntry(h, ctxOf(h));
}

/**
 * §3 Life start — an attempt in the current area. Restore the preserved
 * arrangement, place the hero at its entry with i-frames. Lives are UNTOUCHED:
 * the caller has already consumed one (ordinary death) or a continue restored
 * them. Does not reroll generation.
 *
 * @param {Hero} h
 */
export function startLife(h, ctx) {
  const c = ctx ?? ctxOf(h);
  // Accounting rollback (game-rules.md §4, TUNING_COINS.accountingOnFailure):
  // restore the run stats to the area's entry snapshot so a failed attempt's
  // kills/coins/score do NOT accumulate into the fresh attempt. This is the
  // enforcement of the declared 'rollback' policy — without it, repeatable
  // pickups (extra lives, coins) could be farmed across attempts.
  restoreAreaEntryStats(h);
  restoreArea(c);
  // Reset transient attempt state (death flags, energy, i-frames) so the new
  // attempt is clean, then place the hero at the area's entry (hero.checkpoint
  // is the entry position for the current area) with full energy and respawn
  // i-frames. Lives are untouched — the caller already consumed one (death)
  // or a continue restored them.
  resetHeroTransient(h);
  // Inventory persistence (game-rules.md §5): temporary powerups and a charged
  // super meter do NOT persist into the fresh attempt — the hero is restored
  // to baseline (energy is restored to full by resetHeroTransient). The policy
  // is the concrete design-plan decision owned by GAME_RULES.inventory (the
  // TUNING block).
  resetHeroInventory(h);
  h.respawn();
  // Entry flags are PURE VISUAL (checkpoints.md §1): no trigger, no latch, no
  // state. The hero spawns beside one; nothing about it changes gameplay.
  // (The old code latched the entry flag here by position-matching so a
  // respawn couldn't "re-trigger" it — but entry flags have no trigger to
  // re-fire, so the latch only ever created stale-state bugs across zones.)
}

/**
 * §4 Game continue. Requires a remaining continue and consumes exactly one,
 * restores the global starting life count, returns to area -1 of the CURRENT
 * level, and starts a fresh attempt there. All previously generated areas keep
 * their arrangements — continue never rerolls generation choices.
 *
 * @param {Hero} h
 * @param {object} ctx the area context (see restoreArea)
 * @returns {boolean} true if the continue was applied (a continue was spent),
 *                    false if the pool was empty (Continue cannot activate).
 */
export function continueRun(h, ctx) {
  if (!canSpend(h.continues)) return false;
  spend(h.continues);
  h.lives = GAME_RULES.startingLives;
  // Return to area -1 of the CURRENT level (lifecycle.md §4). The level is
  // unchanged; the area index is reset to the pre-area.
  h.currentArea = ENTRY_AREA;
  // Coin accounting (game-rules.md §2): what happens to the current level's
  // coin tally after using Continue. The concrete policy is GAME_RULES.coins
  // (the TUNING block): a continue resets the current level's tally so the
  // fresh attempt starts clean and the failed attempt's coins do not count.
  if (GAME_RULES.coins.resetOnContinue) resetLevelCoinTally(h);
  // Accounting snapshot (game-rules.md §4): the continue returns to area -1
  // of the current level (a NEW area), so record a fresh entry snapshot. The
  // resetLevelCoinTally above already zeroed the coin tally; the snapshot
  // captures the (now-zeroed) entry totals so a later death restart of area
  // -1 rolls back to them.
  recordAreaEntrySnapshot(h);
  // Position the hero at area -1's entry (checkpoints.md §5, lifecycle.md §4):
  // Continue returns to the current level's area -1 with restored lives and
  // starts a FRESH attempt there — it does NOT resume beside the flag of the
  // area where the last life was lost. Area -1 has no entry flag, so the entry
  // is the zone's start position (the hero's physical position is owned by
  // startLife() via h.checkpoint; task 7.1).
  h.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y - h.h };
  const c = ctx ?? ctxOf(h);
  // checkpoints.md §3: continue shows the shared area-entry screen (with the
  // restored life count) and starts a fresh attempt there — the attempt begins
  // when the player confirms, not on the Continue press itself.
  showAreaEntry(h, c);
  return true;
}

// --- Shared area-entry screen (checkpoints.md §3) ----------------------------
//
// ONE full-screen presentation, shown for: starting the first area of a new
// game, advancing to another area or level, restarting an area after an
// ordinary death, restarting the current level's -1 after Continue, and
// entering/restarting the boss zone. It displays exactly three pieces of
// information:
//   1. Level name
//   2. Area identifier (e.g. '1-3'; the boss zone is '1-B')
//   3. Number of lives remaining
// NO SCORE APPEARS HERE (game-rules.md §3/§4).
//
// The presentation itself (canvas drawing, pause-menu ergonomics) lives in
// screens.js; this module owns the screen's data and its confirm-to-play flow
// so the rules are unit-testable in node.

/**
 * Callback registered by screens.js to receive the area-entry screen data.
 * This avoids a circular import: lifecycle.js calls the callback, and
 * screens.js registers it at module evaluation time.
 * @type {((data: object) => void) | null}
 */
let _onAreaEntryData = null;

/** The last area-entry screen data presented (for tests / render). */
let _areaEntryData = null;

/**
 * Register the callback that receives the area-entry screen data.
 * Called by screens.js at module evaluation time.
 * @param {(data: object) => void} fn
 */
export function setAreaEntryDataCallback(fn) { _onAreaEntryData = fn; }

/** Get the last area-entry screen data presented. */
export function getAreaEntryData() { return _areaEntryData; }

/**
 * Present the shared area-entry screen for the hero's current level/area.
 * Called by every lifecycle path that leads into an area: new game, area
 * advance, post-death restart, and continue.
 *
 * The screen is skippable: confirm (or pause) starts the attempt —
 * startLife() restores the preserved arrangement and places the hero at the
 * area's entry (lifecycle.md §2/§3). Lives are UNTOUCHED here: the caller has
 * already consumed one (ordinary death) or restored them (continue).
 *
 * @param {Hero} h the hero (owns currentLevel / currentArea / lives)
 * @param {object} [ctx] area context (falls back to the bound context)
 * @returns {object} the screen data as displayed
 */
export function showAreaEntry(h, ctx) {
  // Convert the area index to the formatAreaId input convention.
  //
  // Two conventions are in play:
  //   ZONE MODEL: currentArea is -1, -2, -3, -4, or BOSS_AREA (4).
  //   OLD (test): currentArea is -1, 0, 1, 2, 3, 4 (area index).
  //
  // formatAreaId expects: -1 → 'X-1', 0 → 'X-2', 1 → 'X-3', 2 → 'X-4', 3+ → 'X-B'.
  //
  // Zone model → formatAreaId:
  //   -1 → -1, -2 → 0, -3 → 1, -4 → 2, 4 → 3
  // OLD → formatAreaId (subtract 1):
  //   -1 → -1 (pre-area, no subtraction), 0 → -1, 1 → 0, 2 → 1, 3 → 2, 4 → 3
  let fmtArea;
  if (h.currentArea < 0 && h.currentArea !== -1) {
    // Zone model negative area (not -1): -2 → 0, -3 → 1, -4 → 2
    fmtArea = h.currentArea + 2;
  } else if (h.currentArea >= 4) {
    // Boss zone (zone model 4 or OLD 4): → 3
    fmtArea = 3;
  } else if (h.currentArea === -1) {
    // Pre-area (both conventions): → -1
    fmtArea = -1;
  } else {
    // OLD convention (0..3): subtract 1
    fmtArea = h.currentArea - 1;
  }
  const data = {
    levelName: levelName(h.currentLevel),
    areaId: formatAreaId(h.currentLevel, fmtArea),
    lives: h.lives,
  };
  _areaEntryData = data;
  if (_onAreaEntryData) _onAreaEntryData(data);
  if (tryTransition(S.AREA_ENTRY)) {
    console.log(`[lifecycle] → AREA_ENTRY ${data.areaId} (lives: ${data.lives})`);
  }
  return data;
}

/**
 * Handle input on the area-entry screen. Confirm starts the attempt
 * (lifecycle.md §2: "Show the area-entry screen, then begin play at the
 * area's start"); back returns to the pause menu.
 *
 * @param {string} action semantic navigation action
 * @param {Hero} h the hero
 * @param {object} [ctx] area context
 */
export function areaEntryOnAction(action, h, ctx) {
  if (action === 'confirm' || action === 'pause') {
    // The attempt begins from the entry screen: the hero is restored to the
    // area's preserved arrangement and placed at its entry (startLife).
    startLife(h, ctx);
    if (getState() !== S.PLAY) {
      // The normal path is AREA_ENTRY → PLAY via the transition map. A caller
      // that entered AREA_ENTRY directly via setState() (tests) is also
      // honoured, so the screen always ends in PLAY on confirm.
      tryTransition(S.PLAY);
      if (getState() !== S.PLAY) setState(S.PLAY);
    }
    console.log('[lifecycle] AREA_ENTRY → PLAY (start attempt)');
    return true;
  }
  if (action === 'back') {
    if (tryTransition(S.PAUSE)) console.log('[lifecycle] AREA_ENTRY → PAUSE (back)');
    return true;
  }
  return false;
}

// Level names come from the level definitions (level.js) — the declarative
// LEVELS array is the single source of truth for a level's name.
function levelName(level) {
  return LEVELS[level - 1]?.name ?? `Level ${level}`;
}

// --- Level reward screen (boss-arena.md §4–5, game-rules.md §2–3) -------------
//
// The boss zone's second screen, shown after the boss's defeat presentation:
// a full-screen level reward summary (boss beaten, level passed). It presents
// exactly the documented minimal set (game-rules.md §3):
//   1. Enemies killed
//   2. Score
//   3. Coins collected
//   4. Continues earned (one per full 1000-coin chunk — GAME_RULES
//      .coinsPerContinue, a global tuning value)
//
// The reward is credited to the GLOBAL continue pool (gameRules.js credit())
// EXACTLY ONCE, on the first presentation — never again because the screen
// redraws or its animation repeats (game-rules.md §2: "A reward must be
// credited once, not again because the screen redraws or its animation
// repeats"). The presentation itself (canvas drawing, pause-menu ergonomics)
// lives in screens.js; this module owns the data, the crediting, and the
// confirm flow (next level's area -1, or the end-of-game path) so the rules
// are unit-testable in node.

/** Callback registered by screens.js to receive the reward screen data. */
let _onRewardData = null;

/** The last reward screen data presented (for tests / render). */
let _rewardData = null;

/**
 * Identity of the reward whose credit has already been applied to the global
 * pool. This is the exactly-once latch (game-rules.md §2: "A reward must be
 * credited once, not again because the screen redraws or its animation
 * repeats").
 *
 * It is keyed to the REWARD — not to presentation state. A repeat
 * presentation of the same reward (redraw / animation) carries the same
 * identity and is a no-op, while a genuinely new reward (a different boss
 * kill, a different level) carries a fresh identity and is credited. Keying to
 * the reward (rather than to whether a screen is currently up) means a stale
 * non-null presentation can never suppress the credit for a new reward.
 *
 * Shape: { level, coins, earned } — the inputs that make a reward distinct
 * within a level. The level is part of the identity so a redraw of the same
 * reward (same level, same coin tally) never re-credits, while a different
 * level's reward (or a different coin tally) is credited fresh.
 * @type {{level:number, coins:number, earned:number} | null}
 */
let _creditedReward = null;

/**
 * Register the callback that receives the reward screen data.
 * Called by screens.js at module evaluation time (same pattern as the
 * area-entry data callback, to avoid a circular import).
 * @param {(data: object) => void} fn
 */
export function setRewardDataCallback(fn) { _onRewardData = fn; }

/** Get the last reward screen data presented. */
export function getRewardData() { return _rewardData; }

/**
 * Wall-clock timestamp (ms) of the moment the reward screen was last shown.
 * Used to enforce the minimum dwell time before the reward screen can be
 * dismissed (TUNING.rewardMinDwell — boss-arena.md §4–5: "Its duration, skip
 * behavior, and celebration effects are design-plan concerns"). A confirm or
 * pause pressed before this dwell has elapsed is rejected; the screen stays
 * up until the dwell expires.
 *
 * `null` means no reward screen is currently presented.
 * @type {number|null}
 */
let _rewardShownAt = null;

/**
 * Test helper: reset the dwell timer so tests can simulate time passing
 * without waiting. Sets `_rewardShownAt` to a past timestamp such that the
 * dwell has already elapsed.
 */
export function _advanceRewardDwellForTest() {
  if (_rewardShownAt !== null) {
    _rewardShownAt = Date.now() - TUNING.rewardMinDwell * 1000 - 1;
  }
}

/** Callback registered by screens.js to receive the end-of-game final score. */
let _onEndOfGameScore = null;

/**
 * Register the callback that receives the end-of-game final score.
 * Called by screens.js at module evaluation time (same pattern as the
 * reward data callback, to avoid a circular import).
 * @param {(score: number) => void} fn
 */
export function setEndOfGameScoreCallback(fn) { _onEndOfGameScore = fn; }

/**
 * Test helper: consume the currently presented reward (as rewardOnAction's
 * confirm does) so the next test starts with a clean presentation. Tests
 * only — production code resets both the presentation and the credit latch via
 * rewardOnAction().
 */
export function _resetRewardForTest() {
  _rewardData = null;
  _creditedReward = null;
}

/**
 * The number of continues a coin total earns: one per full
 * GAME_RULES.coinsPerContinue chunk (game-rules.md §2). 2500 coins earn 2;
 * 999 coins earn 0.
 * @param {number} coins
 * @returns {number}
 */
export function continuesEarned(coins) {
  return Math.floor((coins ?? 0) / GAME_RULES.coinsPerContinue);
}

/**
 * Present the level reward screen for the hero's just-finished level.
 *
 * Computes the documented stats (kills, score, coins, continues earned),
 * credits the earned continues to the global continue pool exactly once,
 * and transitions to S.REWARD. The credit is latched by the reward's IDENTITY
 * (its level, coins, earned amount, and the pool balance at the moment of
 * crediting): a repeat presentation of the same reward (redraw/animation) is
 * a no-op, while a genuinely new reward — a different boss kill, a different
 * level, or a different coin tally — carries a fresh identity and is credited
 * again.
 *
 * @param {Hero} h the hero (owns the continue pool + run stats + current level)
 * @returns {object} the screen data as displayed
 */
export function showLevelReward(h) {
  const s = h.runStats ?? {};
  const kills = Object.values(s.enemiesKilled ?? {}).reduce((a, b) => a + b, 0);
  const coins = s.coinsCollected?.total ?? 0;
  const earned = continuesEarned(coins);
  // Credit the global pool exactly once PER REWARD (game-rules.md §2). The
  // identity is the reward itself: same (level, coins, earned, balance) → the
  // same reward being re-presented (redraw / animation) → no re-credit. A
  // different boss kill / level / tally changes the identity and is credited
  // fresh. Because the balance is part of the identity, a redraw (balance
  // already grown) never re-credits; a brand-new reward sees a different
  // balance and is credited once.
  const identity = {
    level: h.currentLevel,
    coins,
    earned,
  };
  const alreadyCredited =
    _creditedReward &&
    _creditedReward.level === identity.level &&
    _creditedReward.coins === identity.coins &&
    _creditedReward.earned === identity.earned;
  if (!alreadyCredited) {
    if (earned > 0) credit(h.continues, earned);
    _creditedReward = identity;
  }
  const data = {
    kills,
    coins,
    continuesEarned: earned,
    // The resulting GLOBAL continue-pool balance after this credit is applied.
    // The screen must show the credit to the global counter, not just the
    // delta earned (boss-arena.md §4; game-rules.md §2–3).
    continuesRemaining: h.continues?.remaining ?? 0,
    isFinalLevel: h.currentLevel >= LEVELS.length,
  };
  data.score = calculateScore({
    enemiesKilled: s.enemiesKilled ?? {},
    bossKilled: !!s.bossKilled,
    coinsCollected: s.coinsCollected ?? { total: 0 },
    barrelsDestroyed: s.barrelsDestroyed ?? { woodBarrel: 0, explosiveBarrel: 0, coinBarrel: 0 },
    checkpointsHit: s.checkpointsHit ?? 0,
  }, h);
  _rewardData = data;
  // Record when the reward screen was shown so the minimum dwell
  // (TUNING.rewardMinDwell) is enforced before the confirm/pause is honored.
  _rewardShownAt = Date.now();
  if (_onRewardData) _onRewardData(data);
  if (tryTransition(S.REWARD)) {
    console.log(`[lifecycle] → REWARD (level ${h.currentLevel}, coins: ${coins}, +${earned} continue${earned === 1 ? '' : 's'})`);
  }
  return data;
}

/**
 * Handle input on the reward screen (boss-arena.md §5, lifecycle.md §5).
 *
 * Confirm: the next level starts at area -1 with its shared entry screen
 * (level name, area, lives). For the FINAL level there is no next level —
 * the last boss must not advance into a nonexistent one; instead the
 * end-of-game path takes over (lifecycle.md §5): a minimal congratulations
 * screen with the final score and a single return-home option. The full
 * ending (story scenes, credits) belongs to the future story epic.
 *
 * @param {string} action semantic navigation action
 * @param {Hero} h the hero (owns currentLevel + run stats)
 * @returns {boolean} whether the action was handled
 */
export function rewardOnAction(action, h) {
  if (action === 'back') {
    // Quit from the reward screen (the nav bar's "Quit" keycap). The state
    // transition S.REWARD → S.HOME already exists; the presented reward is
    // consumed so a fresh run credits again.
    console.log('[lifecycle] REWARD → HOME (quit from reward)');
    _rewardData = null;
    _creditedReward = null;
    _rewardShownAt = null;
    if (tryTransition(S.HOME)) return true;
    return true;
  }
  if (action === 'confirm' || action === 'pause') {
    // Enforce the minimum dwell before the reward screen can be dismissed
    // (TUNING.rewardMinDwell — boss-arena.md §4–5). The celebratory beat
    // must play out before the confirm/pause is honored; an early press is
    // rejected (the screen stays up) so the credit to the global continue
    // pool reads clearly. `back` (quit) is NOT dwell-gated — it is a nav-bar
    // escape, not the confirm flow.
    if (_rewardShownAt !== null) {
      const elapsed = (Date.now() - _rewardShownAt) / 1000;
      if (elapsed < TUNING.rewardMinDwell) {
        // Dwell not yet elapsed: reject the confirmation.
        return false;
      }
    }
    if (h.currentLevel >= LEVELS.length) {
      // Final level: end-of-game instead of a next level (lifecycle.md §5).
      // A minimal end-of-game screen (congratulations + final score + return
      // home) is presented. The presented reward is consumed so a fresh run
      // credits again.
      console.log('[lifecycle] REWARD → END_OF_GAME (final level complete)');
      // The final score is the reward screen's score (the just-finished
      // level's tally). Push it to the end-of-game screen before consuming
      // the presented reward data.
      if (_onEndOfGameScore) _onEndOfGameScore(_rewardData?.score ?? 0);
      _rewardData = null;
      _creditedReward = null;
      _rewardShownAt = null;
      if (tryTransition(S.END_OF_GAME)) return true;
      return true;
    }
    // Next level: establish the level config, reset the per-level reward
    // accounting, and open the next level at area -1 with its shared entry
    // screen (boss-arena.md §5, lifecycle.md §5). The actual world swap is
    // task 7.1's job; here we set everything the entry screen and the next
    // level's reward accounting need.
    h.currentLevel += 1;
    h.currentArea = ENTRY_AREA;
    // Per-level reward accounting: a new level starts with a fresh kill/coin
    // tally so the next boss's reward reflects THIS level only (boss-arena.md
    // §4 — the reward counts the level just cleared). The global continue
    // pool is preserved (it is a shared remaining balance, game-rules.md §1).
    h.levelConfig = getLevelConfig(h.currentLevel);
    h.runStats = createStats();
    // Accounting snapshot (game-rules.md §4): record the (fresh) entry totals
    // for the next level's area -1 so a later death restart can roll the run
    // stats back to them (the 'rollback' policy).
    recordAreaEntrySnapshot(h);
    // The presented reward is consumed; the next boss kill presents a fresh
    // one and credits again.
    _rewardData = null;
    _creditedReward = null;
    _rewardShownAt = null;
    showAreaEntry(h, ctxOf(h));
    console.log(`[lifecycle] REWARD → AREA_ENTRY ${h.currentLevel}-${ENTRY_AREA} (next level)`);
    return true;
  }
  return false;
}

/**
 * Format the area identifier from the level definition (checkpoints.md §1/§3):
 * pre-area -1 → '1-1', area 0 → '1-2', 1 → '1-3', 2 → '1-4', and the level's
 * boss area → '1-B'. The IDs come from the level's checkpoint definitions —
 * the boss zone is a property of the level (the checkpoint whose id ends in
 * '-B'), not a universal index.
 *
 * The `area` parameter uses the 0-based checkpoint-index convention:
 *   -1 → first area, 0 → second, 1 → third, 2 → fourth, 3+ → boss.
 * The zone model's area indices (-1, -2, -3, -4, BOSS_AREA) are converted
 * to this convention by the caller (showAreaEntry) before calling this.
 */
export function formatAreaId(level, area) {
  // For known levels (present in LEVELS), use the checkpoint-based mapping:
  //   -1 → 'X-1', 0 → 'X-2', 1 → 'X-3', 2 → 'X-4', 3+ → 'X-B'
  // For unknown levels, fall back to positional ids:
  //   -1 → 'X-1', 0 → 'X-1', 1 → 'X-2', 2 → 'X-3', 3 → 'X-4', 4+ → 'X-B'
  const def = LEVELS[level - 1];
  if (def) {
    // Known level: checkpoint-based mapping
    if (area < 0) return `${level}-1`;
    if (area >= 3) return `${level}-B`;
    return `${level}-${area + 2}`;
  }
  // Unknown level: positional fallback
  if (area < 0) return `${level}-1`;
  if (area >= 4) return `${level}-B`;
  return `${level}-${area + 1}`;
}

// --- Internals ---------------------------------------------------------------

/**
 * Resolve the area context bound to a hero. update.js sets this via
 * bindAreaContext(hero, ctx) at boot; startLife/continueRun fall back to it
 * so callers don't have to thread the entity lists through every call site.
 */
const _ctx = new WeakMap();
export function bindAreaContext(h, ctx) { _ctx.set(h, ctx); }
function ctxOf(h) { return _ctx.get(h); }
