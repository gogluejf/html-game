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
import { CollisionWorld, resolve } from '../core/collision.js';
import { Camera } from '../core/camera.js';
import { Anim, makeTestFrame } from '../core/anim.js';
import { Hero } from '../hero/hero.js';
import { HEROES } from '../hero/heroDefs.js';
import { projectilePool, specialPool } from '../objects/projectile.js';
import { S, getState, tryTransition, onTransition } from '../core/state.js';
import { dispatchScreenInput } from '../ui/screens.js';
import { makeElephant } from '../boss/boss.js';
import { makeBossZone, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER } from '../boss/bossZone.js';
import { particles, coins } from '../effects/particles.js';
import { Effects } from '../effects.js';
import { Debug } from "../debug/debug.js";
import { applyGodMode, updateTheaterGamepad, setHeroRefSetter } from '../debug/debugHarness.js';
import { buildWorld, captureAreaMap, newGameSeed } from '../world/build.js';
import { CLEAR_SEQ, clearSeq, getClearSequence, getClearBanner, getClearFadeAlpha, onExitFlagReached, debugWrapToNextArea, stepClearSequence, beginClearFadeIn, beginAreaEntryPresentation, getAreaEntryFadeAlpha, stepAreaEntrySequence, heroEntryPosition, resetActiveZoneContent, retryFromGameOver, continueFromGameOver } from '../world/zoneLifecycle.js';
export { CLEAR_SEQ, clearSeq, getClearSequence, getClearBanner, getClearFadeAlpha, onExitFlagReached, debugWrapToNextArea, stepClearSequence, beginClearFadeIn, beginAreaEntryPresentation, getAreaEntryFadeAlpha, stepAreaEntrySequence, heroEntryPosition, resetActiveZoneContent, retryFromGameOver, continueFromGameOver };
import { LEVELS, buildLevelZones, ZONE_ENTRY_X, ZONE_GROUND_Y, BOSS_TRIGGER_X } from '../world/level.js';
import { startGame, bindAreaContext, rememberInitial, setRegenerateWorld, showAreaEntry } from '../systems/lifecycle.js';
import { getLevelConfig } from '../world/levelConfigs.js';
import { Theater } from '../debug/theater.js';
import { record } from '../stats.js';
import { isGrounded, standingOnOneWay } from '../hero/physics.js';
import { isBelowVerticalBottom, getDeathFadeAlpha, finishHeroDeath, DEATH_FADE_DURATION } from '../hero/death.js';
export { isBelowVerticalBottom, getDeathFadeAlpha, finishHeroDeath };
import { ctx } from '../world/context.js';
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
export function stepDynamicSolid(e, dt, statics, peers) {
  if (!e.alive) return;
  if (e.vy == null) e.vy = 0;
  e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL_SPEED);
  e.y += e.vy * dt;
  const prevBottom = e.worldBox().y + e.worldBox().h - e.vy * dt;
  const others = peers.filter(p => p !== e && p.alive);
  resolve(e, [...statics, ...others.map(p => p.worldBox())], { prevBottom });
  // Landing snap: zero fall velocity when resting on a surface.
  const wb = e.worldBox();
  for (const s of statics) {
    if (wb.x + wb.w <= s.x || wb.x >= s.x + s.w) continue;
    const gap = s.y - (wb.y + wb.h);
    if (gap >= -2 && gap <= 2 && e.vy > 0) { e.vy = 0; break; }
  }
}

// The hero's physical entry position for the active zone. Area -1 has no entry
// flag (it starts at the zone's start); later areas start beside their entry
// flag (checkpoints.md §1). startLife() owns placing the hero (lifecycle.md §3);
// these helpers give the lifecycle ops + boot the correct entry position.

// --- Hero ---------------------------------------------------------
// Real Hero wrapping the Scarlet Vale definition; run/jump/crouch/slide,
// gravity, ground friction, facing+mirrorX, and crouch-box shrink all live in
// js/hero.js. `let` because setHeroRef() reassigns it on new game / swap.
let hero = new Hero(HEROES.scarlet, ZONE_ENTRY_X, ZONE_GROUND_Y - HEROES.scarlet.h);
/** Rebind the module-level hero reference (used by debug hero-swap / new game). */
function setHeroRef(h) { hero = h; ctx.hero = h; }

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

import { floatTexts } from '../hero/floatText.js';

// --- Input -------------------------------------------------------------------
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
    // startGame/continueRun and placed by startLife, so this must NOT trigger
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
      const snappedX = Math.max(camera.minX, Math.min(camera.maxX, cx - camera.w / 2));
      if (Debug.enabled) console.log(`[cam-snap] hero.x=${h.x.toFixed(0)} cx=${cx.toFixed(0)} cam.x=${camera.x.toFixed(0)}→${snappedX.toFixed(0)} minX=${camera.minX} maxX=${camera.maxX}`);
      camera.x = snappedX;
    }
    // Boss zone (boss-arena.md §1): entering 1-B behaves like any other area —
    // RUN phase. The hero is placed at the left entry by startLife; the battle
    // room begins only when the hero crosses the boss checkpoint at the far
    // right (trigger line → enterBossRoom). No flow starts here.
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
ctx.coins = coins;
ctx.projectilePool = projectilePool;
ctx.specialPool = specialPool;
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
export { getShakeOffset, getHero, getSolids, getCollisionWorld, getEnemies, getLiveEnemies, getProjectiles, getSpecials, getPickups, getCamera, getRealEnemies, getBoss, getActiveZoneKind, getParticles, getCoins, getBarrels, getCoinBarrels, getPowerups, getCheckpoints, getFloatTexts } from '../world/accessors.js';
import { getCheckpoints, getHero } from '../world/accessors.js';

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
  // Shooting is blocked only during the actual intro presentation (LOCKED
  // through BOSS_ENTER), NOT during APPROACH. The player can shoot the moment
  // they enter the boss zone; the presentation just needs to play out visually.
  const shootingAllowed = !(bossZone.active &&
    (bossZone.state === BZ_LOCKED || bossZone.state === BZ_INTRO_SWEEP ||
     bossZone.state === BZ_BAR_FILL || bossZone.state === BZ_BOSS_ENTER));
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
  for (const b of dynBarrels) {
    b.update(dt);
    stepDynamicSolid(b, dt, SOLIDS, dynBarrels);
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
    if (bottom >= ZONE_GROUND_Y && s.vy > 0) {
      s.y = ZONE_GROUND_Y - s.h;
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

  // Battle room lock (boss-arena.md §3): while the room is locked (LOCKED
  // through COMBAT) the hero cannot scroll past the boss or leave through
  // either side. Clamp the hero's x to the fixed room view (the same bounds
  // the frozen camera uses). No-op outside the battle room (roomLocked() is
  // false while the machine is dormant — i.e. during the run phase).
  if (bossZone.roomLocked()) {
    const min = bossZone.roomX;
    const max = bossZone.roomX + bossZone.roomW;
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
import { refreshBarrelSolidBoxes, handleBarrelDestroyed, cullOffScreen, syncProjectilesToWorld, syncSpecialsToWorld, updateEffects } from '../objects/barrelSync.js';
