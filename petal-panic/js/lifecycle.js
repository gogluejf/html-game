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

import { GAME_RULES, createContinuePool, canSpend, spend } from './gameRules.js';
import { Hero } from './hero.js';
import { createStats } from './stats.js';
import { Anim, makeTestFrame } from './anim.js';
import { tryTransition, getState, S } from './state.js';

// The area a fresh run begins in. Per lifecycle.md §1/§4 a new game and a
// continue both enter area -1 of their level (the pre-area).
const ENTRY_AREA = -1;

// The hero's entry position for a level's pre-area (area -1). A new game and
// a continue both place the hero here so a continue lands the hero at the
// level's beginning rather than wherever they died (lifecycle.md §4). update.js
// starts the hero at the same spot, so this matches the actual play position.
// HERO_ENTRY_Y is the floor top; the caller offsets it by the hero's height so
// the hero's feet rest on the floor.
const HERO_ENTRY_X = 100;
const HERO_ENTRY_Y = 500; // floor top (SOLIDS[0].y)

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
  aliasCombatStats(h);
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
  return h;
}

/**
 * §2 Area start — first arrival. Fix the area's arrangement from this game's
 * generation choices (the world was already generated deterministically, so
 * this only records the current area and arms its entry), then begin a life.
 *
 * @param {Hero} h
 * @param {number} level the level index (1-based)
 * @param {number} areaIdx the area index (pre-area is -1)
 */
export function startArea(h, level, areaIdx) {
  h.currentLevel = level;
  h.currentArea = areaIdx;
  startLife(h, ctxOf(h));
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
  restoreArea(c);
  // Reset transient attempt state (death flags, energy, i-frames) so the new
  // attempt is clean, then place the hero at the area's entry (hero.checkpoint
  // is the entry position for the current area) with full energy and respawn
  // i-frames. Lives are untouched — the caller already consumed one (death)
  // or a continue restored them.
  resetHeroTransient(h);
  h.respawn();
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
  // Position the hero at the area's entry. On first arrival into a level the
  // entry IS the area's start; on re-arrival (e.g. continuing after defeat in
  // a later area) the checkpoint still holds the pre-area entry position, so
  // the hero lands in the level's area -1, not wherever they died.
  h.checkpoint = { x: HERO_ENTRY_X, y: HERO_ENTRY_Y - h.h };
  const c = ctx ?? ctxOf(h);
  restoreArea(c);
  resetHeroTransient(h);
  h.respawn();
  if (tryTransition(S.PLAY)) {
    console.log(`[lifecycle] OVER → PLAY (continue, ${h.continues.remaining} left)`);
  }
  return true;
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
