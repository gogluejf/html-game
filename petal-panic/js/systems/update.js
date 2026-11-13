// Petal Panic — update system (fixed 60Hz physics step).
// integration test: a hero-colored box moved by arrow keys / WASD,
// colliding against static orange SOLID platforms via CollisionWorld + resolve().
// Debug mode toggles the unified debug overlay in render.js.
// hero-following camera clamped to level bounds with facing
// look-ahead; the test level is now longer than the viewport so the camera
// scrolls, and placeholder enemies/projectiles/pickups exercise every §16
// debug-overlay color.

import { input } from '../core/input.js';
import { VIEW_W } from '../core/view.js';
import { SolidBox } from '../core/solidBox.js';
import { GRAVITY, MAX_FALL_SPEED } from '../consts.js';
import { UNIT_PX_Y } from '../world/macros.js';
import { CollisionWorld, resolve, aabbOverlap } from '../core/collision.js';
import { Camera } from '../core/camera.js';
import { Anim, makeTestFrame } from '../core/anim.js';
import { Hero } from '../hero/hero.js';
import { updateHeroLocomotionAnim, attachHeroSprites, HERO_SPRITE_DIRS } from '../hero/heroSprites.js';
import { HEROES } from '../hero/heroDefs.js';
import { projectilePool } from '../objects/projectile.js';
import { BombAttackHost } from '../combat/attack/bombAttackHost.js';
import { AttackLifecycle } from '../combat/attack/lifecycle.js';
import { stepBombTerrain, stepBomb } from '../combat/attack/primitives/projectile.js';
import { S, getState, tryTransition, onTransition } from '../core/state.js';
import { dispatchScreenInput, setMenuHero } from '../ui/screens.js';
import { makeElephant } from '../boss/boss.js';
import { makeBossZone, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER } from '../boss/bossZone.js';
import { particles, coins } from '../effects/particles.js';
import { floatTexts } from '../hero/floatText.js';
import { applyKnockback, calculateKnockback } from '../combat/knockback.js';
import { applyHit } from '../combat/hitResolution.js';
import { AttackProvenance, Team } from '../combat/targeting.js';
import { Effects } from '../effects.js';
import { Debug } from "../debug/debug.js";
import { applyGodMode, setHeroRefSetter, tickDebugBarrelDrops, tickFrameTrace } from '../debug/debugHarness.js';
import { buildWorld, instantiateZone, captureAreaMap, newGameSeed, getLastWorldSeed } from '../world/build.js';
import { CLEAR_SEQ, clearSeq, areaEntrySeq, setMenuEntryPending, getClearSequence, getClearBanner, getClearFadeAlpha, onExitFlagReached, debugWrapToNextArea, stepClearSequence, beginClearFadeIn, beginAreaEntryPresentation, getAreaEntryFadeAlpha, stepAreaEntrySequence, heroEntryPosition, resetActiveZoneContent, retryLevel, continueFromGameOver } from '../world/zoneLifecycle.js';
export { CLEAR_SEQ, clearSeq, getClearSequence, getClearBanner, getClearFadeAlpha, onExitFlagReached, debugWrapToNextArea, stepClearSequence, beginClearFadeIn, beginAreaEntryPresentation, getAreaEntryFadeAlpha, stepAreaEntrySequence, heroEntryPosition, resetActiveZoneContent, retryLevel, continueFromGameOver };
import { LEVELS, buildLevelZones, ZONE_ENTRY_X, ZONE_GROUND_Y, roomFloorTop, BOSS_TRIGGER_X } from '../world/level.js';
import { startGame, bindAreaContext, rememberInitial, setRegenerateWorld, showAreaEntry, applySavedState, makeHero } from '../systems/lifecycle.js';
import { getLevelConfig } from '../world/levelConfigs.js';
import { loadStore } from '../systems/progressStore.js';
import { Theater } from '../debug/effect-theater.js';
import { AttackTheater } from '../debug/attack-theater.js';
import { record, createTrace } from '../stats.js';
import { GAME_RULES, createContinuePool } from '../systems/gameRules.js';
import { isGrounded, standingOnOneWay } from '../hero/physics.js';
import { stepDynamicSolid, heroBonkDynamic, heroPushCreep } from '../core/physics.js';
// Re-export for tests that import the shared physics step via update.js.
export { stepDynamicSolid };
import { isLethalFall, getDeathFadeAlpha, finishHeroDeath, DEATH_FADE_DURATION } from '../hero/death.js';
export { isLethalFall, getDeathFadeAlpha, finishHeroDeath };
import { makeCheckpoint, GameObj } from '../objects/object.js';
import { ctx } from '../world/context.js';
import { TUNING } from '../tuning.js';

// --- Zone-engine world (task 7.1 — the sealed zone model IS the world) ------
// (Hero movement feel lives in js/hero.js; level geometry is zone-driven.)
//
// The runtime no longer owns a flat corridor. The authoritative structure is
// the sealed zone model (buildLevelZones): a level is five independent zones
// (areas 1..4 + boss). Each zone's terrain is composed by the macro composer
// (buildAllZoneTerrain) and its enemies/barrels/powerups are resolved by the
// population resolver (populateArea) from the macro placements' declared types
// (typed spawn — each placeholder declares 'random' or a specific type id).
// The ACTIVE zone's composed content is installed into the collision world;
// switching zones swaps ALL world contents (structure.md §2).
const LEVEL_DEF = LEVELS[0];
// The level config (boss, vertical slot, macro weights, length budgets) the
// generator consumes (levelConfigs.js — the authoritative Level 1 config).
const LEVEL_CONFIG = getLevelConfig(LEVEL_DEF.index) ?? {};

// A genuinely new game (lifecycle.md §1/§6) establishes fresh random generation
// choices; death and Continue never reroll, so a run's arrangement is fixed for
// the whole game. The world is a module-level singleton owned by this module
// (its collision world, camera, and debug overlay are all bound to it).
let world = buildWorld(LEVEL_DEF, LEVEL_CONFIG, 1);

const collisionWorld = new CollisionWorld({ cellSize: 64 });

// Level length: the active zone's width. The hero is clamped to the zone's
// bounds (not a fixed corridor length). This is the zone's playable width.
// (The old fixed 8000px corridor is gone; each zone owns its own bounds.)



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
  // Guard: a missing/invalid currentArea (e.g. a freshly-built hero that lost
  // its progress identity) must NOT fall through to the boss zone — that would
  // make the boss-card trigger fire in an ordinary area. Default to area 1.
  const area = Number.isInteger(hero.currentArea) ? hero.currentArea : 1;
  const idx = area >= 1 && area <= 4
    ? area - 1
    : levelZones.length - 1; // AREA_BOSS (5) → boss zone
  return levelZones[idx];
}

// --- Active-zone world content (task 7.1) ------------------------------------
// The ACTIVE zone's installed content. These module-level lists are what the
// update loop, render, debug overlay, and lifecycle ops reference; they are
// REBUILT (cleared + refilled) whenever the active zone changes, so switching
// zones swaps ALL world contents (structure.md §2).
export const SOLIDS = [];
// Solid wrapper entities (layer-only) for the collision world + debug overlay.
// The SolidBox class now lives in core/solidBox.js (extracted to break the
// circular dependency with boss/bossFlow.js).
const solidEntities = [];

/**
 * Shared physics step for any DYNAMIC solid — an entity that has gravity and
 * is itself a standable surface (barrels today; crates/moving platforms later).
 *
 * This is the ONE place "what counts as a surface" is answered: static terrain
 * PLUS every other live dynamic solid. No caller needs to know what a surface
 * is or maintain per-entity resolve lists — that was the bug that kept barrels
 * from stacking on each other (each barrel only resolved against `SOLIDS`).
 *
 * Ordering note: `peers` should be passed bottom-up (lowest y first) so lower
 * bodies settle before upper ones land on them within the same frame.
 *
 * @param {object} e entity with x/y/w/h, vx/vy, alive, worldBox()
 * @param {number} dt seconds
 * @param {object[]} statics static terrain boxes (SOLID/PLATFORM)
 * @param {object[]} peers all dynamic solids INCLUDING e (self is filtered out)
 */

// --- Rolling-barrel impacts (declaration of impact) ---------------------------
// A knocked barrel is a physical object with momentum: when it is MOVING fast
// enough and overlaps an enemy, that overlap is an IMPACT — the barrel deals
// damage to the enemy, knocks the enemy back in the barrel's travel direction,
// and loses part of its own speed (momentum transfer). One impact per enemy
// per barrel until the barrel slows below the threshold or separates, so a
// rolling barrel does not machine-gun an enemy every frame.
const BARREL_IMPACT_MIN_SPEED = 120;   // px/s — slower than this = gentle roll, no hit
const BARREL_IMPACT_DAMAGE = 15;       // flat impact damage (speed-scaled below)
const BARREL_IMPACT_KNOCKBACK = { x: 260, y: -30, hitstun: 0.25 };
const BARREL_IMPACT_MOMENTUM_LOSS = 0.45; // barrel keeps 55% of speed per impact

/**
 * Impact sweep for one moving barrel against live enemies. Called from the
 * dynamic-solid step AFTER integration so positions are final for this frame.
 * @param {GameObj} b the barrel (any type — wood/coin/propane all roll)
 */
export function barrelImpactSweep(b) {
  if (!b.alive || b.destroyed) return;
  const speed = Math.abs(b.vx ?? 0);
  if (speed < BARREL_IMPACT_MIN_SPEED) { b._impactCooldown = 0; return; }
  if (b._impactCooldown > 0) { b._impactCooldown -= 1 / 60; return; }

  const bb = b.worldBox();
  const dirX = Math.sign(b.vx) || 1;
  for (const e of realEnemies) {
    if (!e || e.alive === false || e.aiState === 'dead') continue;
    const eb = e.worldBox ? e.worldBox() : { x: e.x, y: e.y, w: e.w, h: e.h };
    if (!aabbOverlap(bb, eb)) continue;

    // Damage + shove through the single choke point: applyHit() owns the
    // eligibility decision (i-frames/invuln absorb → no damage, no shove) and
    // applies the knockback vector after damage lands. The barrel's live speed
    // adds a motion term (a fast barrel shoves harder).
    const dmg = Math.round(BARREL_IMPACT_DAMAGE * (0.5 + speed / 400));
    const kb = calculateKnockback(b, 0);
    const res = applyHit({
      provenance: AttackProvenance.PROJECTILE,
      source: b,
      target: e,
      damage: dmg,
      team: Team.NEUTRAL,
      method: 'barrelImpact',
      knockback: {
        x: dirX * (BARREL_IMPACT_KNOCKBACK.x + (kb?.x ?? 0) * dirX),
        y: BARREL_IMPACT_KNOCKBACK.y,
        hitstun: BARREL_IMPACT_KNOCKBACK.hitstun,
      },
    });
    if (!res.accepted || res.dealt <= 0) continue; // absorbed — no impact reaction
    Effects.beginEnemyShake(e);

    // Momentum transfer: the barrel slows down — it did NOT pass through.
    b.vx *= (1 - BARREL_IMPACT_MOMENTUM_LOSS);
    b._impactCooldown = 0.35; // re-arm window: no second hit on the same body
    break; // one enemy per barrel per impact event
  }
}

// --- Falling-barrel impacts (stomp / bonk) -----------------------------------
// A barrel falling FAST onto the hero is a physical impact, not a pass-through:
//   - hero's head is in the lower half of the barrel and the barrel is moving
//     down → STOMP: the barrel takes heavy damage (often dies → its normal
//     destruction payload), the hero bounces off the top.
//   - any other fast overlap (barrel hits you from the side/above while you're
//     under it) → the barrel is destroyed on impact and detonates normally;
//     whoever (hero AND enemies) stands in the blast radius takes the blast's
//     own damage. No special stomp rule, no flat "bonk" number — the
//     detonation IS the damage. One rule for every way a barrel dies.
// Below FALLING_MIN_VY the barrel is just settling — no impact (stacking and
// gentle drops keep working). One impact per barrel per short window so a
// resting-on-head frame doesn't machine-gun.
const FALLING_BARREL_MIN_VY = 260;   // px/s downward before it counts as "falling"
const FALLING_BARREL_COOLDOWN = 0.3; // re-arm window per barrel
// Head-hit response: the barrel gets a small knockback launch (up + away from
// the hero) and a short fuse. It stays alive and arcs under gravity; it
// detonates when the fuse expires OR it lands on a surface — whichever first.
// The blast fires at its CURRENT position, so the explosion travels with the
// launched barrel (kick-a-barrel-and-it-blows-up feel).
const STOMP_KNOCKBACK = { x: 260, y: -120, hitstun: 0, iFrames: 0 };
const STOMP_FUSE = 0.45;             // seconds of cooking after the head-hit
// STAR POWER barrel pop: shove the barrel in front of the hero like an enemy
// knockback — a horizontal push with a SMALL fixed `pop` lobe (the same shape
// as enemy body-contact knockback: dirMode fromAttacker + modest pop). That's
// what reads as "pushed" instead of "launched into orbit". Barrels have
// knockbackResist 0.5, so impulses land at 2× face value.
const STAR_BARREL_KNOCKBACK = { x: 420, y: -160, hitstun: 0, iFrames: 0 };
const STAR_BARREL_FUSE = 0.25;       // snappy: they pop soon after the launch

/**
 * Impact check for one falling barrel against the hero. Called from the
 * dynamic-solid step AFTER integration (positions final for this frame).
 *
 * Kick-and-cook model: a fast-falling barrel that overlaps the hero gets a
 * small knockback launch (up + away) and a short fuse instead of dying
 * instantly. It stays alive and arcs under gravity (stepDynamicSolid handles
 * the physics each frame); it detonates when the fuse expires OR it lands —
 * whichever comes first — via tickFallingBarrelFuse(). The blast fires at the
 * barrel's CURRENT position, so the explosion travels with the launched barrel.
 * @param {GameObj} b the barrel
 */
export function fallingBarrelImpact(b) {
  if (!b.alive || b.destroyed) return;
  const vy = b.vy ?? 0;
  if (vy < FALLING_BARREL_MIN_VY) { b._fallCd = 0; return; } // settling, not falling
  if (b._fallCd > 0) { b._fallCd -= 1 / 60; return; }

  const h = ctx.hero;
  if (!h || !h.alive || h.dying) return;
  const bb = b.worldBox();
  const hb = h.worldBox ? h.worldBox() : { x: h.x, y: h.y, w: h.w, h: h.h };
  if (!aabbOverlap(bb, hb)) return;
  // STOMP GATE — the barrel must be driving DOWN onto the hero's HEAD from
  // above. Two geometric tests (both required):
  //   1. The hero's HEAD REGION (top 25% of the body) overlaps the barrel's
  //      LOWER half — your head is under the barrel's midline, i.e. it fell
  //      ONTO you, not past/beside you. Using a region (not just the top
  //      edge) matters for tall heroes: with a 91px hero and a 48px barrel,
  //      "top edge inside lower half" needs ≥33px of overlap, which a fast
  //      barrel can skip in one frame.
  //   2. barrel's BOTTOM edge at or below the hero's TOP edge — the barrel is
  //      still arriving from above. If its bottom is already ABOVE your head
  //      you're level with it in the air: a side touch, NOT a stomp. This is
  //      the case that used to cook barrels on mid-air contact.
  const heroTop = hb.y;
  const headBottom = hb.y + hb.h * 0.25; // head region: top quarter of the body
  const barrelMidY = bb.y + bb.h / 2;
  const barrelBottom = bb.y + bb.h;
  if (headBottom <= barrelMidY) return;    // head not under the barrel — no stomp
  if (barrelBottom < heroTop) return;      // barrel still above your head — no stomp

  // Launch the barrel off the hero: upward + horizontally away from the hero's
  // center. Pure impulse (no damage — the stomp is a physics interaction, not
  // a hit), so applyKnockback is called directly; stepDynamicSolid carries the arc.
  const dirX = Math.sign((bb.x + bb.w / 2) - (hb.x + hb.w / 2)) || 1;
  applyKnockback(b, { x: STOMP_KNOCKBACK.x * dirX, y: STOMP_KNOCKBACK.y });
  // Arm the fuse. It cooks while airborne; landing or fuse-expiry detonates.
  b._fuse = STOMP_FUSE;
  record(h, { kind: 'enemyStomped' });
  b._fallCd = FALLING_BARREL_COOLDOWN;
}

/**
 * Per-frame fuse tick for a cooking barrel (armed by fallingBarrelImpact).
 * Call once per live barrel in the dynamic-solid loop, AFTER stepDynamicSolid
 * so positions/velocity are final for the frame. Detonates when the fuse hits
 * zero OR the barrel has come to rest on a surface (vy ~ 0 and grounded), so a
 * launched barrel always blows up — at its current spot — rather than cooking
 * forever. No-op for barrels without an armed fuse.
 * @param {GameObj} b the barrel
 * @param {number} dt seconds
 */
export function tickFallingBarrelFuse(b, dt) {
  if (!b.alive || b.destroyed || b._fuse == null) return;
  b._fuse -= dt;
  // Landed? stepDynamicSolid zeroes vy on a surface; treat "no longer falling"
  // as the detonation trigger so a short hop still blows where it settles.
  const landed = (b.vy ?? 0) <= 1;
  if (b._fuse <= 0 || (landed && (b.vy ?? 0) >= 0)) {
    b._fuse = null;
    b.clearIntangible(); // back in the collision world at detonation
    const dealt = b.hit(Number.MAX_SAFE_INTEGER, b, 'stomp');
    if (b.destroyed && !b._destroyHandled) {
      b.onDestroyed?.({ source: b, provenance: 'STOMP' }, { accepted: true, dealt, destroyed: true });
    }
  }
}

// The hero's physical entry position for the active zone. Area -1 has no entry
// flag (it starts at the zone's start); later areas start beside their entry
// flag (checkpoints.md §1). placeHeroAtEntry() owns placing the hero (lifecycle.md §3);
// these helpers give the lifecycle ops + boot the correct entry position.

// --- Hero ---------------------------------------------------------
// Real Hero wrapping the Scarlet Vale definition; run/jump/crouch/slide,
// gravity, ground friction, facing+mirrorX, and crouch-box shrink all live in
// js/hero.js. `let` because setHeroRef() reassigns it on new game / swap.
let hero = new Hero(HEROES.scarlet, ZONE_ENTRY_X, ZONE_GROUND_Y - (HEROES.scarlet.targetH ?? 1) * UNIT_PX_Y);
/** Rebind the module-level hero reference (used by debug hero-swap / new game). */
function setHeroRef(h) {
  // Debug hero-swaps and any non-startGame rebuilds bypass makeHero() — attach
  // sheet sprites here so every live hero gets the sprite pipeline.
  attachHeroSprites(h, HERO_SPRITE_DIRS[h.heroDef?.id] ?? h.heroDef?.id);
  hero = h; ctx.hero = h; setMenuHero(h);
}

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
  const p = heroEntryPosition(hero, getActiveZone(hero));
  hero.x = p.x;
  hero.y = p.y;
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

// --- Active-zone entities (task 7.1) -----------------------------------------
// These are the ACTIVE zone's content. They are mutable module-level lists that
// installActiveZone() clears and refills on every zone switch, so the update
// loop, render, and lifecycle ops always see the current zone's world.
export const realEnemies = []; // active zone's enemies (from the population resolver)

// Overgrown Elephant boss (design §9). The boss belongs to the level's boss zone
// (boss-arena.md §1–§3); it is created ONCE and lives in the boss zone. It is
// tracked separately from realEnemies so the generic enemy loop never drives the
// boss's phase machine. `let` because a genuinely new game re-creates it.
export let boss = makeElephant(-9999, ZONE_GROUND_Y); // parked off-world until the battle room (begin() places it at its entrance x)

// --- Boss zone flow (docs/levels/boss-arena.md §1–§3) -------------------------
// The boss zone (zone[4], orientation 'boss') has two phases, both inside this
// ONE zone: a RUN phase (hero walks right from the left entry to the boss
// checkpoint at the far right — normal camera, machine dormant) and a BATTLE
// ROOM phase (triggered by crossing the checkpoint: the flag is removed, the
// camera freezes at x=0 on the leftmost VIEW_W of the zone, the hero is placed
// at the room's left entry, and the boss slides in from the right). The flow
// machine below owns the battle-room half (LOCKED → INTRO_SWEEP → BAR_FILL →
// BOSS_ENTER → COMBAT): boss visibility, the hero's shooting gate, and the
// boss's damage gate. It is started by enterBossRoom() (the trigger line at
// BOSS_TRIGGER_X) and re-started after a death via the same path.
const bossZoneDef = levelZones[4];
// Edge-trigger latch for the boss-card trigger line (see update()): remembers
// whether the hero was left of BOSS_TRIGGER_X on the previous frame so the
// battle room starts only on a genuine left→right crossing, not whenever the
// hero happens to stand past the line while the machine is dormant.
let _prevXLeftOfBossTrigger = true;
export const bossZone = makeBossZone(bossZoneDef, boss, {
  onSweepDone: () => {
    // The card (full-screen sweep) has disappeared — settle into the battle
    // room NOW, while the screen is still black: swap the floor to the real
    // 960px room at [0, 960], freeze the camera at 0, place the hero at the
    // left entry. The bar fill + boss entrance then play in the correct room
    // coordinates, revealed as the black lifts.
    settleIntoBossRoom();
    console.log('[bossZone] sweep done — settled into room under the black');
  },
  onCombat: () => {
    // Combat enable (boss-arena.md §2 step 8): the room was already settled
    // when the sweep finished (onSweepDone); here we only activate the boss
    // and lift the instant-black over the fade-in duration so the room
    // reveals. The boss's attack patterns are its own responsibility (the
    // boss/combat system); this flips the gate.
    boss.active = true;
    clearSeq.timer = 0;
    console.log('[bossZone] COMBAT — black lifting, boss active');
  },
});

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
// Register collision-event handlers (hit/contact/collect/pickup/checkpoint) —
// extracted into combat/collisionHandlers.js. Must run after the hero is in the
// collision world so the handlers' subscriptions are live from frame 1.
registerCollisionHandlers(collisionWorld);
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
  ctx.bombAttacks?.clear();
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
  console.log('[loadActiveZone] zone=' + (zone.areaIdx ?? 'boss') + ' solids count=' + solids.length + ' floor present=' + solids.some(s => s.kind === 'floor'));
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
  // ctx.world is a stable reference read by zoneLifecycle.js (retry / death /
  // advance reinstalls). Keep it pointed at the fresh world or later zone
  // switches would pull content from the previous game's world.
  ctx.world = world;

  // Re-create the boss for the fresh game (it is a fresh entity per game).
  const oldBoss = boss;
  boss = makeElephant(-9999, ZONE_GROUND_Y); // parked off-world until the battle room
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

// --- Input -------------------------------------------------------------------
export function processInput() {
  input.poll({ facing: hero.facing });
  // Theater overlays (F2 Effect / F4 Attack): SHARED input contract. Both are
  // exclusive debug overlays, so both consume their nav edges HERE — in the
  // same tick as input.poll() — and swallow everything else before it can
  // reach the screen dispatcher. KEY_NAV maps Escape to BOTH 'back' AND
  // 'pause' in one poll; if either edge leaked, the leftover 'pause' would
  // open the pause menu instead of just closing the theater. One code path,
  // identical behavior: back → close, confirm → replay, nothing leaks.
  const theater = AttackTheater.active ? AttackTheater : (Theater.active ? Theater : null);
  input.overlayOpen = !!theater; // ghost-edge guard in input.js observe()
  if (theater) {
    // Close/replay from the nav edge, SAME TICK as input.poll() — the same
    // contract the Effect Theater always had. Consuming the edge here (before
    // the screen dispatcher can see it) is what keeps Escape from leaking a
    // 'pause' action into gameplay. No barrier(): it quarantines EVERY held
    // control (d-pad/stick included) and broke in-theater gamepad navigation.
    if (input.nav.pressed.includes('back')) {
      theater.close();
      input.clearGameEdges(); // no ghost super/shoot from buttons held in-theater
      // Clear the nav edge too: Escape maps to BOTH 'back' and 'pause'.
      // Without this, the leftover 'pause' in nav.pressed could reach
      // dispatchScreenInput on a race frame and open the pause menu.
      input.nav.pressed.length = 0;
      Debug.logEvent(`theater CLOSE (back) → ${theater === AttackTheater ? 'attack' : 'effect'}`);
    } else if (input.nav.pressed.includes('confirm')) {
      theater.replay();
      Debug.logEvent(`theater REPLAY → ${theater === AttackTheater ? AttackTheater.currentId() : Theater.current().type}`);
    }
    if (Theater.active) {
      // Single navigation owner for keyboard AND gamepad (including touch pad).
      Theater.updateControls?.(); // select + param nudge + held repeat
    }
    return;
  }
  dispatchScreenInput(input, hero, {
    // On rejection (0 lives) tryTransition(S.OVER) is an intentional no-op when
    // we are already in S.OVER — it just keeps us on the Game Over screen.
    retry: () => { if (!retryLevel()) tryTransition(S.OVER); },
    cont: continueFromGameOver,
    playAgain: () => tryTransition(S.SELECT),
    quit: () => tryTransition(S.HOME),
  });
}

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
    // startGame/continueRun and placed by placeHeroAtEntry, so this must NOT trigger
    // startGame (which would rebuild the hero and reroll generation).
    // lifecycle.md §1: a genuinely new game rebuilds the hero with the chosen
    // definition and establishes lives, the continue pool, fresh run stats,
    // and the area position. startGame() owns all of that; this hook only
    // rebuilds the hero instance and rebinds the reference.
    const heroId = window.__selectedHero || 'scarlet';
    const def = HEROES[heroId] || HEROES.scarlet;
    const oldHero = hero;
    // FLUSH boss state (game-beat leak): beating the game leaves the boss-zone
    // flow machine in COMBAT — the death path never calls reset() (only the
    // debug wrap and death-restart do). Without this flush, a new game starts
    // with the energy bar still drawing, roomLocked() clamping the hero to the
    // arena x-range, and the trigger line re-firing instantly at area 1's
    // entry x. A finished game must leave NO boss residue.
    if (bossZone.active) {
      bossZone.reset();
      camera.unlock();
    }
    // The battle-room floor swap (settleIntoBossRoom) replaced the run floor
    // with the fixed 960px arena floor; restore the run-phase floor so area 1
    // gets its real terrain. loadActiveZone replaces solids anyway, but this
    // keeps the boss zone's own state consistent for a later entry into 1-B.
    restoreBossRunFloor();
    // Attempt boundary: a genuinely new game starts with zero transients —
    // no fire zones, projectiles, particles, or effects from the previous run.
    AttackLifecycle.clearTransientWorld();
    const nh = startGame({ world: collisionWorld, oldHero, areaContext }, def);
    // Snapshot the freshly generated terrain into the trace's areaMap (stable
    // for the whole game — rolled once per seed).
    captureAreaMap(nh);
    {
      const p = heroEntryPosition(nh, getActiveZone(nh));
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
    nh.anims.melee = new Anim(
      ['#555555', '#888888', '#aaaaaa', '#ffffff', '#666666'].map(c => makeTestFrame(nh.w, nh.h, c)),
      { speed: 80, loop: false },
    );
    // Rebind the reference + bind the area context so restartAttempt/continueRun
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

// --- Menu Continue / Level Select / Boss Rush → AREA_ENTRY (menu-hub plan §2.3 / §3.2 / §3.3) ---
// When the menu hub's Continue option OR the level select screen OR the boss
// rush screen opens the shared area-entry screen for a SAVED or CHOSEN
// level/area, install that zone's world content + spawn checkpoint through the
// SAME path a normal mid-run area entry uses (stepClearSequence's fadeOut /
// debugWrapToNextArea): loadActiveZone swaps ALL world contents
// (structure.md §2) and the hero's checkpoint is set to the zone's spawn so
// placeHeroAtEntry places them at the chosen zone's entry — not wherever the previous
// run left them.
// This runs on EVERY MENU→AREA_ENTRY, LEVEL_SELECT→AREA_ENTRY and
// BOSS_RUSH→AREA_ENTRY transition; the only such sources are the Continue flow
// and the two select-screen confirms (new games route MENU→SELECT, never
// straight to AREA_ENTRY).
onTransition((from, to) => {
  if (to === S.AREA_ENTRY && (from === S.MENU || from === S.LEVEL_SELECT || from === S.BOSS_RUSH)) {
    let h = hero;
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
    if (sm?.heroId && sm.heroId !== hero.heroDef?.id) {
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
      collisionWorld.remove(hero);
      collisionWorld.add(newH);
      setHeroRef(newH);
      bindAreaContext(newH, ctx);
      // Re-apply saved state onto the CORRECT hero (continueFromMenu applied
      // it to the old hero before the transition fired; we redo it here).
      newH.currentLevel = sm.level;
      newH.currentArea = sm.area;
      if (sm.state && typeof sm.state === 'object') applySavedState(newH, sm.state);
      h = newH; // rebind local ref so checkpoint/zone logic below uses the new hero
      console.log(`[lifecycle] ${from} continue: swapped hero to ${sm.heroId}`);
    }
    if (sm && Number.isInteger(sm.seed) && sm.seed !== getLastWorldSeed()) {
      world = buildWorld(LEVEL_DEF, LEVEL_CONFIG, sm.seed);
      // CRITICAL: ctx.world is a STABLE reference read by resetActiveZoneContent /
      // continueFromGameOver / stepClearSequence (zoneLifecycle.js). Swapping only
      // the local `world` leaves ctx pointing at the PREVIOUS game's world, so any
      // later zone reinstall (retry, death-restart, advance) pulls terrain +
      // population from the stale world — the "retry spawns me in a NEW 1-1" bug.
      ctx.world = world;
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
    if (bossZone.active) { bossZone.reset(); camera.unlock(); restoreBossRunFloor(); }
    // Attempt boundary: a menu continue / level-select / boss-rush entry starts
    // with zero transients — no fire zones, projectiles, particles, or effects
    // from the previous session may bleed into the resumed zone.
    AttackLifecycle.clearTransientWorld();
    const zone = getActiveZone(h);
    if (zone.kind === 'area' && world.world.has(zone.areaIdx)) {
      // world.world holds live instances, not a pristine snapshot: same-seed
      // menu returns can otherwise revive enemies with destroyed/_deathHandled
      // still set and barrels with _destroyHandled (suppressing their blasts).
      // Recreate runtime state from the preserved arrangement, as retry does.
      loadActiveZone(zone, instantiateZone(
        zone, world.terrain.get(zone.areaIdx), world.population.get(zone.areaIdx), levelZones,
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
    camera.setZoneBounds(zone);
    const label = from === S.LEVEL_SELECT ? 'LEVEL_SELECT' : from === S.BOSS_RUSH ? 'BOSS_RUSH' : 'MENU';
    console.log(`[lifecycle] ${label} continue: installed zone ${zone.areaIdx ?? 'boss'} (checkpoint @${sp.x},${sp.y})`);
  }
});

// --- Area-entry presentation (checkpoints.md §3) ----------------------------
// Every entry into the shared area-entry view starts its timed, non-interactive
// presentation: fast fade-in → hold for TUNING.areaEntryHold → fast fade-out →
// auto-start play. This fires on ALL paths that open the entry screen (new
// game, clear-sequence advance, death restart, continue, and pause retry).
onTransition((from, to) => {
  // Carry the advance flag through the rebuild: the clear sequence sets it on
  // areaEntrySeq before showAreaEntry triggers this transition; without it the
  // presentation reset would downgrade a genuine zone arrival to a failure
  // restart (state-persistence.md §2.3).
  if (to === S.AREA_ENTRY) beginAreaEntryPresentation(areaEntrySeq.advance);
});

// AREA_ENTRY → PLAY: when the player confirms the area-entry screen, begin the
// fade-in into the new zone (checkpoints.md §2 step 6). This only fires when
// the area was reached via the clear sequence (exit flag → banner → fade-out →
// entry screen). For other entry-screen paths (new game, death restart,
// continue) the fade-in is not needed because the hero is already positioned
// by placeHeroAtEntry and the screen was opaque (no visible world to fade from).
onTransition((from, to) => {
  if (to === S.PLAY && from === S.AREA_ENTRY) {
    // Only start the fade-in when the entry screen was reached via the clear
    // sequence (exit flag → banner → fade-out → entry screen). For other
    // entry-screen paths (new game, death restart, continue) there is no
    // fade-in because the hero was already positioned by placeHeroAtEntry and the
    // screen was opaque (no visible world to fade from).
    beginClearFadeIn();
    // Re-clamp the camera to the zone the hero is now in (task 2.3). This runs
    // on EVERY area-entry confirmation (new game, clear-sequence advance, death
    // restart, continue), so the camera is always bound to the active zone and
    // a fresh vertical climb resets its ascent high-water mark.
    camera.setZoneBounds(getActiveZone(hero));
    // Snap the camera to the hero so they are on-screen from frame 1.
    // Without this, the camera may still be showing the previous zone's
    // position and the hero appears off-screen until the follow logic catches
    // up. For VERTICAL zones the y-snap is mandatory: the upward-only ratchet
    // owns y during play, but at area entry the camera must start at the
    // BOTTOM of the climb (where the hero spawns) — a stale y from the
    // previous zone would reveal the top of the climb instead.
    {
      const h = hero;
      const cx = h.x + h.w / 2;
      const snappedX = Math.max(camera.minX, Math.min(camera.maxX, cx - camera.w / 2));
      if (Debug.enabled) console.log(`[cam-snap] hero.x=${h.x.toFixed(0)} cx=${cx.toFixed(0)} cam.x=${camera.x.toFixed(0)}→${snappedX.toFixed(0)} minX=${camera.minX} maxX=${camera.maxX}`);
      camera.x = snappedX;
      const cy = h.y + h.h / 2;
      const snappedY = Math.max(camera.minY, Math.min(camera.maxY, cy - camera.h / 2));
      if (Debug.enabled) console.log(`[cam-snap] hero.y=${h.y.toFixed(0)} cy=${cy.toFixed(0)} cam.y=${camera.y.toFixed(0)}→${snappedY.toFixed(0)} minY=${camera.minY} maxY=${camera.maxY}`);
      camera.y = snappedY;
      // A fresh attempt starts its ascent from the spawn point — reset the
      // high-water mark to the snapped position so the ratchet can only raise
      // from here (never inherit a raised position from the previous zone).
      camera.minYReached = camera.y;
    }
    // Boss zone (boss-arena.md §1): entering 1-B behaves like any other area —
    // RUN phase. The hero is placed at the left entry by placeHeroAtEntry; the battle
    // room begins only when the hero crosses the boss checkpoint at the far
    // right (trigger line → enterBossRoom). No flow starts here.
  }
});

// --- Camera --------------------------------------------------------------------
// Hero-following cam clamped to the ACTIVE ZONE's world bounds (task 2.3).
// The zone model (levelZones) is the authoritative level structure: the
// camera's clamp range comes from the active room of getActiveZone(hero), NOT the legacy
// corridor length, so it can never reveal the previous or next zone
// (structure.md §2/§3, checkpoints.md §2). The legacy corridor is still the
// active geometry until task 7.1; the camera bounds are already zone-driven.
export const camera = new Camera();
// Bind the camera to the zone the hero starts in (area 1) so it is clamped
// from the very first frame.
camera.setZoneBounds(getActiveZone(hero));

// --- Shared mutable state context (world/context.js) -------------------------
// Extracted modules (combat/, boss/, enemies/) read/write shared state through
// this single object instead of importing update.js (which would be circular).
// Wired AFTER all module-level declarations are initialized below.
ctx.hero = hero;
ctx.collisionWorld = collisionWorld;
ctx.solids = SOLIDS;
ctx.solidEntities = solidEntities;
ctx.realEnemies = realEnemies;
ctx.barrels = barrels;
ctx.woodBarrels = woodBarrels;
ctx.coinBarrels = coinBarrels;
ctx.powerups = powerups;
ctx.checkpoints = checkpoints;
ctx.boss = boss;
ctx.camera = camera;
ctx.world = world;
ctx.levelZones = levelZones;
ctx.areaContext = areaContext;
ctx.barrelSolidBoxes = barrelSolidBoxes;
ctx.bossZone = bossZone;
ctx.handleBarrelDestroyed = handleBarrelDestroyed;
ctx.popSuperCoinHit = popSuperCoinHit;
// Wire hit-resolution hooks onto GameObj (avoids circular import object.js ↔ barrelSync.js)
GameObj.prototype.onHit = function (_ctx, result) {
  if (result.dealt > 0) ctx.popSuperCoinHit?.(this, result.dealt);
};
GameObj.prototype.onDestroyed = function (_ctx, _result) {
  // TRIPWIRE (debug): confirm the destroy hook actually fired for this barrel.
  // If a barrel dies (destroyed=true) but you NEVER see this line, the kill
  // path bypassed applyHit/onDestroyed entirely — that's the broken state.
  if (Debug.enabled) Debug.logEvent(`[barrel] onDestroyed HOOK type=${this.type} provenance=${_ctx?.provenance ?? '?'} dealt=${_result?.dealt}`);
  ctx.handleBarrelDestroyed?.(this);
};
ctx.coins = coins;
ctx.projectilePool = projectilePool;
ctx.floatTexts = floatTexts;
// Unified pool: specials ARE projectiles now (Special folded into Projectile,
// task 1.3) — the engine has ONE pool.
// Fresh per-frame world-state bag for the bomb-family attack context. Used by
// BombAttackHost at spawn time AND by AttackLifecycle.stepAll(opts.refreshCtx)
// each frame to refresh live handles' contexts in place.
export function freshBombContextBag() {
  const az = getActiveZone(hero);
  return {
    pools: { projectilePool }, collisionWorld, bombTerrainStepped: true,
    groundY: roomFloorTop(az.rooms[0], az.orientation),
    platforms: [...SOLIDS.slice(1), ...barrelSolidBoxes],
    camera: ctx.camera,
    world: { targets: getDamageables() },
  };
}
export const bombAttacks = new BombAttackHost(freshBombContextBag);
ctx.bombAttacks = bombAttacks;
// Gameplay callers use this entry point, not a discarded invoke() result.
export function spawnBombAttack(id, params, attacker = hero) {
  return bombAttacks.spawn(id, params, attacker);
}
ctx.bossZoneDef = bossZoneDef;
ctx.clearSeq = clearSeq;
ctx.CLEAR_SEQ = CLEAR_SEQ;
ctx.getActiveZone = getActiveZone;
ctx.getCheckpoints = getCheckpoints;
ctx.AREA_BOSS = AREA_BOSS;
ctx.loadActiveZone = loadActiveZone;
setHeroRefSetter(setHeroRef);

// brief screen shake on barrel explosions (optional juice). The
// camera-shake effect engine instance is the single owner of the shake state
// (effects/cameraShake.js); triggerShake()/updateShake() used to live here as
// module locals but were migrated through the Effects shim (review):
// render.js reads getShakeOffset(), which now returns the tracked instance's
// current offset ({0,0} when idle/done). World accessors are extracted into
// world/accessors.js; re-exported here so existing importers keep working.
export { getShakeOffset, getHero, getSolids, getCollisionWorld, getEnemies, getLiveEnemies, getProjectiles, getSpecials, getPickups, getCamera, getRealEnemies, getBoss, getActiveZoneKind, getParticles, getCoins, getBarrels, getDamageables, getCoinBarrels, getPowerups, getCheckpoints, getFloatTexts } from '../world/accessors.js';
import { getCheckpoints, getHero, getDamageables } from '../world/accessors.js';

// --- Per-frame step ------------------------------------------------------------
export function update(dt) {
  processInput();
  // Effect Theater (debug-only): advance its demo clock while open. Gated on
  // active so normal play pays zero cost. Runs even outside PLAY (the theater
  // is a debug overlay independent of gameplay state). While the black-screen
  // theater is up we FREEZE the game behind it: skip all gameplay physics so
  // the hero doesn't walk and gamepad actions don't fire under the overlay.
  // EXCEPTION: the area-entry presentation must keep advancing even with a
  // theater open — otherwise its timed auto-advance freezes and the player is
  // stranded on the entry screen forever. F2/F4 are gated to in-area PLAY, so
  // this path only matters for stale/theater-open edge cases; still safe.
  if (Theater.active) {
    Theater.update(dt);
    if (getState() === S.AREA_ENTRY) stepAreaEntrySequence(dt);
    return;
  }
  // Attack Theater (debug-only): advance its live sandbox while open. Like the
  // Effect Theater it freezes gameplay behind the overlay.
  if (AttackTheater.active) {
    AttackTheater.update(dt);
    if (getState() === S.AREA_ENTRY) stepAreaEntrySequence(dt);
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

  // 0. Area-clear sequence (checkpoints.md §2): step the state machine
  //     (banner → fadeOut → entry screen → fadeIn). While the sequence is
  //     active the hero is frozen (no input, no physics) so the camera
  //     cannot scroll past the exit into the next zone.
  if (clearSeq.state !== 'idle') {
    stepClearSequence(dt);
    // Completing fade-out opens AREA_ENTRY and installs a new zone, but
    // the hero is not respawned until that card finishes. End this frame
    // before physics, collisions, or the boss trigger see the old position.
    if (getState() !== S.PLAY) return;
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
    tickDebugBarrelDrops(dt); // B-key barrel rain: spawn pending drops on their timers
    tickFrameTrace();         // V-key frame-by-frame box/hitbox trace (no-op when off)
  }

  // During the intro PRESENTATION (LOCKED → INTRO_SWEEP → BAR_FILL →
  // BOSS_ENTER) the game is effectively paused: the hero is frozen (no input,
  // no physics) so the full-screen sweep and bar fill play out cleanly.
  // COMBAT resumes normal gameplay. The run phase (machine dormant) plays
  // normally — no special handling.
  const bzPresentation = bossZone.active &&
    (bossZone.state === BZ_LOCKED || bossZone.state === BZ_INTRO_SWEEP ||
     bossZone.state === BZ_BAR_FILL || bossZone.state === BZ_BOSS_ENTER);
  if (bzPresentation) {
    bossZone.update(dt, hero);
    if (boss.alive && boss.aiState !== 'dead' && boss.gravity > 0) resolve(boss, SOLIDS);
    // The card plays IN PLACE: hold the camera exactly where it is (no follow,
    // no drift) so the full-screen presentation reads cleanly. The snap to the
    // room happens once, at the BOSS_ENTER → COMBAT boundary (onCombat →
    // settleIntoBossRoom).
    Effects.update(dt);
    return;
  }

  // Boss-card trigger line (boss-arena.md §1): while walking the run phase of
  // 1-B (machine dormant), crossing the invisible line at BOSS_TRIGGER_X
  // starts the battle room — the card plays, the flag stays (it is purely
  // visual), the camera freezes on the fixed-width room, and the boss slides
  // in from the right. This is an EDGE trigger: it fires only when the hero
  // moves FROM left of the line TO at/past it this step. A bare `hero.x >=
  // BOSS_TRIGGER_X` would fire instantly whenever the hero happens to stand at
  // x >= 1080 while the machine is dormant (e.g. the frame after a debug
  // hero-swap that preserves position), so we latch the previous-frame side.
  const bzInRunPhase = !bossZone.active && !hero.dying && getActiveZone(hero)?.kind === 'boss';
  if (bzInRunPhase) {
    const nowLeft = hero.x < BOSS_TRIGGER_X;
    if (_prevXLeftOfBossTrigger && !nowLeft) {
      console.log(`[bossZone] trigger line crossed @${Math.round(hero.x)} — entering battle room`);
      enterBossRoom();
      return;
    }
    _prevXLeftOfBossTrigger = nowLeft;
  } else {
    // Outside the boss run phase: assume the hero starts left of the line so
    // the first entry into 1-B arms the edge correctly.
    _prevXLeftOfBossTrigger = true;
  }

  // 1. input → intents (movement/jump/crouch logic lives in Hero.update).
  // NOTE: named `intent` (not `input`) — a local `const input` here would shadow
  // the imported input engine for the whole function body and throw "Cannot
  // access 'input' before initialization" on the earlier input.poll() calls.
  const intent = readInput();
  // One-way platform context (design §13): Down+Jump while standing on a
  // one-way platform becomes a drop-through, not a jump. The probe uses the
  // PREVIOUS frame's grounded state — setGrounded() runs after hero.update(),
  // so this is exactly "standing on a one-way platform right now".
  intent.onOneWay = standingOnOneWay();
  hero.update(dt, intent);
  // Sheet-sprite locomotion + aim binding (idle/run/crouch × 5 aim dirs).
  // Runs after physics + shooting so vx, grounded and shoot intent are current;
  // no-op when the hero has no sprite data attached.
  updateHeroLocomotionAnim(hero, intent, dt);

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
  if (intent.switchWeapon) hero.rotateWeapon(); // edge-triggered, no fire
  // Thorn cooldown ticks EVERY frame regardless of input/selection — a stale
  // cooldown must never freeze while J is released or Special is selected.
  if (hero.fireCooldown > 0) hero.fireCooldown -= dt;
  // Shooting is blocked only during the actual intro presentation (LOCKED
  // through BOSS_ENTER), NOT during APPROACH. The player can shoot the moment
  // they enter the boss zone; the presentation just needs to play out visually.
  const shootingAllowed = !(bossZone.active &&
    (bossZone.state === BZ_LOCKED || bossZone.state === BZ_INTRO_SWEEP ||
     bossZone.state === BZ_BAR_FILL || bossZone.state === BZ_BOSS_ENTER));
  if (shootingAllowed) {
    tryFire(hero, intent, dt);                  // dispatches on hero.selectedWeapon
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
  if (intent.melee && !hero.hitStunned && shootingAllowed) {
    const wasActive = hero.meleeActive || hero.specialMeleeActive;
    hero.requestMelee(intent.down ? 'special' : 'normal');
    if (!wasActive && (hero.meleeActive || hero.specialMeleeActive)) {
      record(hero, { kind: 'meleeSwing' }); // count the swing start
    }
  }
  processAllHitboxes();

  // 1d2. tick live barrels (decays their hit-flash timer) + gravity, via the
  //     SHARED dynamic-solid step: any entity with gravity integrates and
  //     resolves against static terrain AND every other live dynamic solid.
  //     That is what lets barrels stack on each other and drop when the one
  //     beneath them is destroyed — no per-entity knowledge of "what counts
  //     as a surface". Barrels spawn feet-on-surface (instantiateZone), so at
  //     rest vy stays 0 and this is a no-op. Hero/enemies are NOT dynamic
  //     solids: they fall onto surfaces but are never themselves a surface.
  const dynBarrels = [...barrels, ...woodBarrels, ...coinBarrels]
    .filter(b => b.alive)
    .sort((a, b) => b.y - a.y); // bottom-up: lower barrels settle first
  // STAR POWER phase-through: a cooked (fuse-armed) barrel passes through
  // OTHER BARRELS for the WHOLE flight — no peer collision / momentum transfer —
  // but keeps NORMAL terrain physics (gravity, friction, wall bounces, landing).
  // That's what makes the arc feel physical instead of floaty: it flies clean
  // through a barrel stack, bounces off walls like any launched barrel, and
  // detonates on fuse expiry or where it lands. The flag is set ONCE at launch
  // (star-power touch below) and cleared by tickFallingBarrelFuse at detonation
  // — it is NOT re-derived from hero.starPower each frame, so a barrel still
  // cooking when the star expires keeps flying clean instead of slamming back
  // into the stack mid-flight.
  for (const b of dynBarrels) {
    b.update(dt);
    stepDynamicSolid(b, dt, SOLIDS, dynBarrels);
    tickFallingBarrelFuse(b, dt);   // cook + detonate launched barrels (post-physics)
    barrelImpactSweep(b);
    fallingBarrelImpact(b);
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
  // (Hero.update already ticks its own anim.)

  // 2c. thorn integration: advance the pool, cull off-screen shots,
  //     then refresh the collision world's live set from the pool.
  // Engine-owned carriers (ballistic/projectile with a live attack handle) are
  // integrated by their OWN clock (AttackLifecycle.stepAll / carrierMacro
  // h.step / theater _stepOnce) — same as the old separate-pool updateAll pass.
  // Stepping them here too would double-integrate; skipping them alone would
  // leave them frozen when no host steps them this frame. Net: every entity
  // gets exactly one update() per frame, from whichever clock owns it.
  for (let i = projectilePool.active.length - 1; i >= 0; i--) {
    const item = projectilePool.active[i];
    if (item._attackId === 'projectile') continue;
    item.update(dt);
    if (!item.alive) projectilePool.active.splice(i, 1);
  }
  // Host-stepped carriers (bombAttacks roots + nested macro children): the
  // hosts call stepBomb/stepProjectile (lifecycle only) and never integrate —
  // the OLD architecture moved them via the separate pool's updateAll pass.
  // Keep that contract: one explicit integration per frame, splice the dead
  // carriers here (loop A splices non-carriers only), BEFORE the terrain/
  // collision passes below read their positions.
  for (let i = projectilePool.active.length - 1; i >= 0; i--) {
    const s = projectilePool.active[i];
    if (s._attackId !== 'projectile') continue; // non-carriers: loop A
    if (!s._attackDone) s.update(dt);
    if (!s.alive) projectilePool.active.splice(i, 1);
  }
  cullOffScreen(projectilePool.activeItems);
  syncProjectilesToWorld();

  // Special projectiles: update + handle bomb explosions. Unified pool —
  // projectilePool.updateAll() above already stepped EVERY live entity exactly
  // once this frame (specials ARE projectiles now), so there is no second
  // step here; only the post-step sweeps run on the same pool.
  // Engine-owned ballistic carriers (homing / explosive specials) fly on the
  // macro's clock — cull them off-screen like thorns so a missed shot can't
  // live forever chasing its target. The macro completes on entity death.
  const engineCarriers = [];
  for (const s of projectilePool.activeItems) {
    if (s._arcRecipe) engineCarriers.push(s);
  }
  cullOffScreen(engineCarriers);
  // Detonate engine carriers that died this frame (terrain impact, contact,
  // TTL). stepBomb() emits the 'detonate' event the composing macro listens
  // for — WITHOUT this, a carrier nested inside another macro (e.g. molotov
  // children of a barrel's spawnSplit fan) never detonates: the parent's
  // h.step already ran before terrain killed the child, and no one else
  // calls stepBomb on it. Carriers stepped by their own host root (bombAttacks)
  // are safe here too: _attackDone latches after the first fire, so a
  // second call is a no-op.
  for (const s of projectilePool.items) {
    if (!s._attackId || s._attackDone || !s._attackHandle) continue;
    stepBomb(s, s._attackHandle._params ?? {}, ctx, s._attackHandle);
  }
  // Bomb terrain: the engine owns bounce (stepBombTerrain) — same rules
  // for gameplay and the sandbox. Reflect bombs rest on the ground (vy=0)
  // but stay alive; the fuse keeps running until TTL → explodeSpecial().
  // 'stop' bombs die on impact → explode immediately.
  // Floor is the active room's floor (single formula — REVISION-zones-as-data §1).
  const activeZone = getActiveZone(hero);
  const bombGroundY = roomFloorTop(activeZone.rooms[0], activeZone.orientation);
  for (const s of projectilePool.activeItems) {
    if (!s.alive || s.type !== 'bomb' || s._arcRecipe) continue;
    const settled = stepBombTerrain(s, dt, bombGroundY, SOLIDS.slice(1));
    if (settled && !s.exploded) {
      explodeSpecial(s);
    }
  }
  syncSpecialsToWorld();
  // TTL expiry: check the FULL pool (not just activeItems, which already
  // spliced dead items) for specials that just died from TTL this frame.
  for (const s of projectilePool.items) {
    if (!s._arcRecipe && s.ttlExpired && !s.exploded) {
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
  // Head-bonk: a jumping/falling hero hitting a RESTING barrel from above
  // bounces softly and shoves the barrel (shared physics, core/physics.js)
  // instead of stopping dead against it. Runs before resolve() so the
  // impulse reads the overlapping position; resolve() then separates.
  if (!hero.dying) {
    // STAR POWER (mario star): touching a destructible barrel LAUNCHES it off
    // the hero and arms a short fuse — it detonates after a beat, exactly like
    // the falling-barrel stomp (launch → cook → blast). That delay is the
    // satisfaction: the barrel flies up, hangs, then BOOM. Runs before bonk/
    // creep so a starred hero never shoves or creeps a barrel. The detonation
    // goes through GameObj.hit() → destroy() and fires onDestroyed (wired in
    // update.js) which owns the full aftermath: explosion AoE + VFX for
    // explosive barrels, coin burst for coin barrels.
    if (hero.starPower) {
      const hbx = hero.worldBox();
      for (const b of dynBarrels) {
        if (!b.alive || b.destroyed || b._fuse != null) continue;
        if (!aabbOverlap(hbx, b.worldBox())) continue;
        // Pure impulse (no damage — star power LAUNCHES the barrel, it doesn't
        // hit it), so applyKnockback is called directly. Push horizontally in
        // front of the hero (away from you); gravity owns the rest of the arc.
        const awayX = Math.sign((b.x + b.w / 2) - (hbx.x + hbx.w / 2)) || 1;
        applyKnockback(b, { x: STAR_BARREL_KNOCKBACK.x * awayX, y: STAR_BARREL_KNOCKBACK.y });
        b._fuse = STAR_BARREL_FUSE; // tickFallingBarrelFuse cooks + detonates
        b.setIntangible(STAR_BARREL_FUSE); // ghost flight for the whole cook (cleared at detonation)
        requestHitstop(STAR_POWER_HITSTOP_FRAMES);
        Effects.triggerShake(STAR_POWER_SHAKE);
        break; // ONE barrel per touch frame — the rest pop as you walk into them
      }
    }
    for (const b of dynBarrels) {
      if (b._fuse != null) continue; // star-launched barrels are already cooking — no bonk
      if (heroBonkDynamic(hero, b)) break; // one bonk per frame
    }
    // Walk-push creep: a GENTLE grounded press against a resting barrel's side
    // makes it crawl at HERO_PUSH_CREEP_SPEED instead of stopping dead. Runs
    // after the bonk pass (bonk is an impact; creep is sub-bonk-speed only),
    // and never touches a barrel already carrying a real impulse.
    for (const b of dynBarrels) {
      heroPushCreep(hero, b);
    }
  }
  const hit = resolve(hero, [...SOLIDS, ...barrelSolidBoxes], {
    prevBottom: heroPrevBottom,
    // One-way tops are ignored while drop-through is active OR during the
    // flat supermove burst (vy=0 committed line phases through platform tops).
    ignoreOneWay: hero.droppingThrough || (hero.supermoveActive && hero.supermovePhase === 'burst'),
  });
  // Shared top-surface collision before broadphase; payloads after dispatch.
  // Owned surfaces (live destructibles) get a PRE-terrain contact offer: a
  // falling bomb landing on an object's TOP damages/detonates it exactly like
  // a side hit (shared object-impact op), instead of bouncing off an
  // anonymous box. Anonymous terrain keeps its configured bounce.
  for (const s of projectilePool.items) {
    if (s._arcRecipe && !s._attackDone) {
      stepBombTerrain(s, dt, bombGroundY, [...SOLIDS.slice(1), ...barrelSolidBoxes], {
        onSurfaceContact: (ent, surface) => {
          if (!surface.owner?.alive || !ent.friendly) return; // preserve side-hit team eligibility
          applyObjectImpact(ent, surface.owner, hero);
        },
      });
    }
  }
  collisionWorld.update();
  // Self-contained attack lifecycle (task 3.2 B2a): the registry drives
  // EVERYTHING — hero-shot roots (registry-owned since task 3.2 B1), toxic
  // dust zones, barrel payloads, enemy/boss handles. opts.refreshCtx hands
  // each handle's _ctxRefresh the same fresh world-state bag BombAttackHost
  // used to Object.assign into its contexts. The `targets` argument matches
  // the old semantics: live.world.targets === getDamageables() from the
  // host's context bag. This single pass also covers barrel toxic dust zones
  // (previously a separate ad-hoc step in the game loop).
  AttackLifecycle.stepAll(dt, getDamageables(), { refreshCtx: freshBombContextBag });
  // Compatibility for directly invoked primitives/macros without a host root.
  // (Engine-carrier detonation for pool-resident carriers runs right after
  // cullOffScreen above — one stepBomb pass covers host roots AND nested
  // children, latched by _attackDone.)

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
  if (!hero.dying && isLethalFall(hero, getActiveZone(hero))) {
    hero.die();
  }

  // Keep the hero inside the LEVEL horizontally (test-rig convenience).
  const wb = hero.worldBox();
  const az0 = getActiveZone(hero);
  const zw = az0.rooms.find((r) => r.id === az0.activeRoom) ?? az0.rooms[0];
  if (wb.x < zw.x) { hero.x = zw.x - hero._boxOx; hero.vx = 0; }
  else if (wb.x + wb.w > zw.x + zw.w) { hero.x = zw.x + zw.w - hero._boxOx - hero.w; hero.vx = 0; }

  // Battle room lock (boss-arena.md §3): while the room is locked (LOCKED
  // through COMBAT) the hero cannot scroll past the boss or leave through
  // either side. Clamp the hero's x to the fixed room view (the same bounds
  // the frozen camera uses). No-op outside the battle room (roomLocked() is
  // false while the machine is dormant — i.e. during the run phase).
  if (bossZone.roomLocked()) {
    const min = bossZone.roomX;
    const max = bossZone.roomX + bossZone.roomW;
    if (wb.x < min) { hero.x = min - hero._boxOx; hero.vx = 0; }
    else if (wb.x + wb.w > max) { hero.x = max - hero._boxOx - hero.w; hero.vx = 0; }
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

// --- Thorn shooting -------------------------------------------------
// G key fires an 8-way thorn from the shared pool. The aim direction is resolved
// by gameplay context via hero.resolveAim() (design §4/§32): grounded crouch
// shoots horizontally toward facing, airborne or lockMove + Down shoot straight
// down, and no directional input falls back to the hero's facing. Ammo is
// consumed per shot and fire is gated by a cooldown derived from
// stats.projectile_freq (halved during rapid).
// Friendly projectiles only ever hit ENEMY/BOSS via COLLISION_RULES, so they can
// never damage the hero — friendly-fire is off by construction.

import { tryFire, explodeSpecial } from '../combat/shooting.js';
import { processAllHitboxes } from '../combat/hitboxes.js';
import { registerCollisionHandlers } from '../combat/collisionHandlers.js';
import { enterBossRoom, settleIntoBossRoom, restoreBossRunFloor, beginBossZoneFlow, updateBoss } from '../boss/bossFlow.js';
import { updateRealEnemies } from '../enemies/enemyUpdate.js';
import { refreshBarrelSolidBoxes, handleBarrelDestroyed, popSuperCoinHit, cullOffScreen, syncProjectilesToWorld, syncSpecialsToWorld, updateEffects } from '../objects/barrelSync.js';
import { applyObjectImpact } from '../combat/objectImpact.js';
import { hitstop as requestHitstop } from '../core/hitstop.js';
// Star-power barrel pop juice (same values as the enemy contact kill).
const STAR_POWER_HITSTOP_FRAMES = 2; // ~33ms — snappy pop beat (was 5 ≈ 83ms)
const STAR_POWER_SHAKE = 6;
