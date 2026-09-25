// Boss zone flow — enterBossRoom, settleIntoBossRoom, restoreBossRunFloor,
// beginBossZoneFlow, and the per-frame updateBoss step.
// All shared mutable state is read/written through ctx (world/context.js) to
// avoid a circular import back into systems/update.js.

import { ctx } from '../world/context.js';
import { ZONE_GROUND_Y, ZONE_ENTRY_X, ZONE_FLOOR_H } from '../world/level.js';
import { VIEW_W } from '../core/view.js';
import { BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT } from './bossZone.js';
import { resolve } from '../core/collision.js';
import { Effects } from '../effects.js';
import { record } from '../stats.js';
import { S, getState, STATE_NAMES } from '../core/state.js';
import { showLevelReward } from '../systems/lifecycle.js';
import { SolidBox } from '../core/solidBox.js';

/**
 * Enter the battle room: called exactly once when the hero crosses the boss
 * checkpoint (HERO×CHECKPOINT handler). Re-draws the fixed-width room over the
 * run — the flag is removed, the camera freezes at the room's left edge
 * (x=0; screen x = world x), the hero is placed at the room's left entry, the
 * boss is added off-screen right, and the presentation machine starts in
 * LOCKED. No computed center, no teleport: the hero is placed INSIDE the room
 * before the camera freezes, so nothing jumps.
 */
export function enterBossRoom() {
  // The card plays IN PLACE: no camera freeze, no hero teleport yet. The
  // hero stays where they crossed the line, the camera keeps its current
  // framing, and the full-screen presentation covers the view. When the intro
  // finishes (BOSS_ENTER → COMBAT), settleIntoBossRoom() snaps the hero to the
  // room's left entry and freezes the camera on the fixed-width room.
  // Make sure the boss is in the collision world (loadActiveZone adds it on
  // zone entry; this guards the death-restart path where it was removed).
  if (!ctx.collisionWorld.entities.has(ctx.boss)) ctx.collisionWorld.add(ctx.boss);
  // The boss checkpoint flag is only present during the RUN phase. Once the
  // card triggers, the fixed battle room takes over and the flag must not be
  // visible (or collidable) anymore — hide it until the zone restarts (death /
  // debug wrap re-instantiate a fresh, visible flag).
  for (const c of ctx.getCheckpoints()) {
    if (c.isEntry) c.visible = false;
  }
  // Instant black: the clear-fade overlay is the existing full-screen black
  // mechanism (render.js draws it at getClearFadeAlpha()). Pin it to 1 so the
  // world vanishes the same frame the card starts; liftBlackAtCombat() ramps
  // it back down when the room is settled.
  ctx.clearSeq.pendingFadeIn = true;
  ctx.clearSeq.state = 'fadeIn';
  ctx.clearSeq.timer = ctx.CLEAR_SEQ.FADE_IN; // alpha = 1 immediately (no ramp-up)
  // Start the presentation machine (LOCKED → … → COMBAT).
  beginBossZoneFlow();
  console.log(`[bossZone] trigger line crossed — instant black, card starting, hero @${Math.round(ctx.hero.x)}, state ${ctx.bossZone.state}`);
}

/**
 * Settle into the battle room: called exactly once when the intro presentation
 * finishes (the BOSS_ENTER → COMBAT transition). Snaps the hero to the room's
 * left entry (same spot as any level start) and freezes the camera on the
 * fixed-width room (minX === maxX = roomX; screen x = world x). The snap
 * happens UNDER the just-finished presentation, so it reads as "the card ends
 * and you are now in the arena" rather than a mid-walk teleport.
 */
export function settleIntoBossRoom() {
  // Swap the world to the battle room: a real 960px floor at [0, 960]. The
  // run floor (0..1600) is replaced so the room's left edge IS screen pixel 0
  // and its right edge IS screen pixel 960 — no offset math, no second
  // coordinate frame. The boss enters from off-screen right of THIS floor.
  const oldSolids = [...ctx.solidEntities];
  for (const e of oldSolids) ctx.collisionWorld.remove(e);
  ctx.solids.length = 0;
  ctx.solidEntities.length = 0;
  const roomFloor = { x: 0, y: ZONE_GROUND_Y, w: VIEW_W, h: ZONE_FLOOR_H };
  ctx.solids.push(roomFloor);
  const se = new SolidBox(roomFloor);
  ctx.solidEntities.push(se);
  ctx.collisionWorld.add(se);
  // Freeze the camera on the room (screen x = world x).
  ctx.camera.minX = ctx.camera.maxX = ctx.bossZone.roomX;
  ctx.camera.minY = ctx.camera.maxY = 0;
  ctx.camera.x = ctx.bossZone.roomX;
  ctx.camera.y = 0;
  // Hero at the room's left entry (same spot as any level start).
  ctx.hero.x = ZONE_ENTRY_X;
  ctx.hero.y = ZONE_GROUND_Y - ctx.hero.h;
  ctx.hero.vx = 0;
  ctx.hero.vy = 0;
  ctx.hero.checkpoint = { x: ctx.hero.x, y: ctx.hero.y };
  // Lift the black over the fade-in duration so the room reveals cleanly.
  ctx.clearSeq.timer = 0;
  console.log(`[bossZone] settled into room — floor swapped to [0,${VIEW_W}], cam @${ctx.camera.x}, hero @${ctx.hero.x}`);
}

/** Restore the run-phase floor (0..zone width) after a death / debug wrap. */
export function restoreBossRunFloor() {
  const zone = ctx.bossZoneDef;
  const oldSolids = [...ctx.solidEntities];
  for (const e of oldSolids) ctx.collisionWorld.remove(e);
  ctx.solids.length = 0;
  ctx.solidEntities.length = 0;
  for (const p of zone.platforms) {
    const sp = { ...p };
    ctx.solids.push(sp);
    const se = new SolidBox(sp);
    ctx.solidEntities.push(se);
    ctx.collisionWorld.add(se);
  }
}

/**
 * Start (or restart) the battle-room presentation: place the boss off-screen
 * right (invisible until BOSS_ENTER) and run the state machine. Called from
 * enterBossRoom() only — the camera freeze and hero placement happen there.
 */
export function beginBossZoneFlow() {
  ctx.bossZone.begin();
  // The boss is off-screen and invisible until BOSS_ENTER.
  if (ctx.boss.aiState !== 'dead') {
    ctx.boss.active = false;
    ctx.boss.phase = 'idle';
    ctx.boss.phaseTimer = 0;
  }
  console.log(`[bossZone] flow started — state ${ctx.bossZone.state}`);
}

/**
 * Per-frame boss step: activate the fight when the hero approaches, run the
 * phase AI + physics, resolve against solids, trigger the stomp shake, and
 * handle the death → win pipeline.
 * @param {number} dt seconds
 */
export function updateBoss(dt) {
  const b = ctx.boss;
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
    ctx.coins.dropCoins(b.coinDrop, cx, cy);       // generous coin bounty
    ctx.collisionWorld.remove(b);                           // drop from play
    ctx.camera.unlock();                           // release the arena lock
    b.onDeath();                               // boss-side death hook
    // mark boss as killed (design §4.1) — keyed by the level's boss id.
    record(ctx.hero, { kind: 'bossKilled', type: ctx.hero.levelConfig?.boss ?? 'boss' });
    if (getState() === S.PLAY) {
      // boss-arena.md §4: the level reward screen replaces the placeholder
      // post-boss (WIN) screen. showLevelReward() computes the documented
      // stats and credits the global continue pool exactly once.
      showLevelReward(ctx.hero);
      console.log(`[state] PLAY → ${STATE_NAMES[S.REWARD]} (boss defeated)`);
    }
    return;
  }

  // Boss zone flow (docs/levels/boss-arena.md §1–§3). The state machine
  // owns the approach → arena lock → intro → bar fill → boss entrance →
  // combat sequence. While the machine is running (states before COMBAT)
  // the boss is invisible and untouchable; the hero may move but not shoot.
  if (ctx.bossZone.active && ctx.bossZone.state !== BZ_COMBAT) {
    // Step the machine; it drives the boss's entrance position and the
    // energy-bar fill. The camera is frozen by enterBossRoom() at the trigger.
    ctx.bossZone.update(dt, ctx.hero);
    // The boss's own AI must NOT run during the intro: it is invisible and
    // the fight has not started. (Attack patterns are the boss system's
    // job; here we simply gate them off until COMBAT.)
    // We still resolve the boss against solids so its entrance lands on the
    // floor, but we skip b.update() (AI + integrate) until COMBAT.
    if (b.alive && b.aiState !== 'dead' && b.gravity > 0) {
      resolve(b, ctx.solids);
    }
    return;
  }

  // The boss AI only runs when the boss zone flow is active AND in COMBAT.
  // Before the player reaches the boss zone, the boss is dormant — no AI,
  // no attacks, no movement. (boss-arena.md §1: the boss is created per
  // boss-zone entry, not at module load.)
  if (!ctx.bossZone.active || ctx.bossZone.state !== BZ_COMBAT) return;

  // COMBAT: the boss AI drives the fight.
  // Activation is owned by the boss zone flow's onCombat hook (which sets
  // boss.active = true when the machine reaches COMBAT).
  if (b.aiState !== 'dead' && !b.active) {
    b.shouldActivate(ctx.hero);
  }

  // AI + gravity + integrate (base Enemy.update handles the death pipeline too).
  // BLOCKER 5: the AI receives the collision world, not the buildWorld record.
  b.update(dt, ctx.hero, ctx.collisionWorld);

  // Keep the boss inside the room horizontally while alive & active. The room
  // bounds are owned by the flow machine (bossZone.roomX/roomW).
  if (b.alive && b.aiState !== 'dead' && b.active) {
    const minX = ctx.bossZone.roomX;
    const maxX = ctx.bossZone.roomX + ctx.bossZone.roomW - b.w;
    if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx); }
    else if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx); }
  }

  // Resolve against solids so the boss rests on the floor (it has gravity 1).
  if (b.alive && b.aiState !== 'dead' && b.gravity > 0) {
    resolve(b, ctx.solids);
  }

  // Stomp shake: doStomp() records a magnitude; convert it into a screen shake.
  if (b.shakeMag > 0) {
    Effects.triggerShake(b.shakeMag); // engine path — stomp shake
    b.shakeMag = 0;
  }
}
