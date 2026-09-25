// Petal Panic — update system (fixed 60Hz physics step).
// integration test: a hero-colored box moved by arrow keys / WASD,
// colliding against static orange SOLID platforms via CollisionWorld + resolve().
// Debug mode toggles the unified debug overlay in render.js.
// hero-following camera clamped to level bounds with facing
// look-ahead; the test level is now longer than the viewport so the camera
// scrolls, and placeholder enemies/projectiles/pickups exercise every §16
// debug-overlay color.

import { input } from '../core/input.js';
import { VIEW_W, VIEW_H } from '../core/view.js';
import { Entity } from '../core/entity.js';
import { SolidBox } from '../core/solidBox.js';
import { LAYER, GRAVITY, MAX_FALL_SPEED } from '../consts.js';
import { CollisionWorld, resolve, aabbOverlap } from '../core/collision.js';
import { Camera } from '../core/camera.js';
import { Anim, makeTestFrame } from '../core/anim.js';
import { Hero, WEAPON_SPECIAL } from '../hero/hero.js';
import { HEROES } from '../hero/heroDefs.js';
import { projectilePool, specialPool, dirAngle } from '../objects/projectile.js';
import { damage } from '../combat/damage.js';
import { applyKnockback } from '../combat/knockback.js';
import { S, getState, setState, STATE_NAMES, tryTransition, onTransition } from '../core/state.js';
import { dispatchScreenInput } from '../ui/screens.js';
import { Elephant, makeElephant, BOSS_TRIGGER_RADIUS, WEAK_POINT_MULT } from '../boss/boss.js';
import { makeBossZone, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT } from '../boss/bossZone.js';
import { particles, coins } from '../effects/particles.js';
import { Effects } from '../effects.js';
import { GameObj, Checkpoint } from '../objects/object.js';
import { Debug } from "../debug/debug.js";
import { applyGodMode, updateTheaterGamepad, selectEntityAt, forceStateAt, setHeroRefSetter } from '../debug/debugHarness.js';
import { resolveExplosion } from '../combat/explosion.js';
import { Powerup } from '../objects/powerup.js';
import { COIN_TYPES } from '../objects/coin.js';
import { instantiateZone, buildWorld, captureAreaMap } from '../world/build.js';
import { CLEAR_SEQ, clearSeq, getClearSequence, getClearBanner, getClearFadeAlpha, onExitFlagReached, debugWrapToNextArea, stepClearSequence, beginClearFadeIn, beginAreaEntryPresentation, getAreaEntryFadeAlpha, stepAreaEntrySequence, heroEntryPosition, resetActiveZoneContent, retryFromGameOver, continueFromGameOver } from '../world/zoneLifecycle.js';
export { CLEAR_SEQ, clearSeq, getClearSequence, getClearBanner, getClearFadeAlpha, onExitFlagReached, debugWrapToNextArea, stepClearSequence, beginClearFadeIn, beginAreaEntryPresentation, getAreaEntryFadeAlpha, stepAreaEntrySequence, heroEntryPosition, resetActiveZoneContent, retryFromGameOver, continueFromGameOver };
import { LEVELS, buildLevelZones, ZONE_ENTRY_X, ZONE_GROUND_Y, BOSS_TRIGGER_X } from '../world/level.js';
import { startGame, bindAreaContext, rememberInitial, setRegenerateWorld, showAreaEntry, formatAreaId } from '../systems/lifecycle.js';
import { getLevelConfig } from '../world/levelConfigs.js';
import { Theater } from '../debug/theater.js';
import { record } from '../stats.js';
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

// Floor top y (the zone's ground level). Used by bomb/coin bounce logic.
const FLOOR_TOP = ZONE_GROUND_Y;
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
// The SolidBox class now lives in core/solidBox.js (extracted to break the
// circular dependency with boss/bossFlow.js).
const solidEntities = [];

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

import { floatTexts, spawnFloatText } from '../hero/floatText.js';

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
ctx.enemies = enemies;
ctx.barrelSolidBoxes = barrelSolidBoxes;
ctx.bossZone = bossZone;
ctx.handleBarrelDestroyed = handleBarrelDestroyed;
ctx.coins = coins;
ctx.projectilePool = projectilePool;
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
  // in from the right. Edge-triggered by the position check: once the room is
  // up the machine is active and this branch never runs again.
  if (!bossZone.active && !hero.dying && getActiveZone(hero)?.kind === 'boss'
      && hero.x >= BOSS_TRIGGER_X) {
    console.log(`[bossZone] trigger line crossed @${Math.round(hero.x)} — entering battle room`);
    enterBossRoom();
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

  // 1d. decay hit-flash timers on enemies (white flash when struck).
  for (const e of enemies) {
    if (e.hitFlash > 0) e.hitFlash -= dt;
  }

  // 1d2. tick live barrels (decays their hit-flash timer) + gravity: a barrel
  // whose supporting surface disappeared (block destroyed, platform dropped)
  // falls and lands on whatever is below — resolve() snaps it onto the
  // surface top, exactly like the hero's landing. Barrels spawn feet-on-
  // surface (instantiateZone), so at rest vy stays 0 and this is a no-op.
  for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) {
    if (!b.alive) continue;
    b.update(dt);
    if (b.vy == null) b.vy = 0;
    b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL_SPEED);
    b.y += b.vy * dt;
    const prevBottom = b.worldBox().y + b.worldBox().h - b.vy * dt;
    resolve(b, SOLIDS, { prevBottom });
    // Landing snap: zero fall velocity when resting on a surface.
    const wb = b.worldBox();
    for (const s of SOLIDS) {
      if (wb.x + wb.w <= s.x || wb.x >= s.x + s.w) continue;
      const gap = s.y - (wb.y + wb.h);
      if (gap >= -2 && gap <= 2 && b.vy > 0) { b.vy = 0; break; }
    }
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
      // Keep the hero's area on the boss zone so getActiveZone() keeps
      // resolving to it. The reset below (resetActiveZoneContent) tears down
      // any active battle room and restores the run phase: flag back at the
      // far right, camera re-bound to the full zone width, machine dormant,
      // hero checkpoint at the left entry. Death in the room restarts the
      // WHOLE area (boss-arena.md §3).
      hero.currentArea = AREA_BOSS;
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

import { tryFire, explodeSpecial } from '../combat/shooting.js';
import { processAllHitboxes } from '../combat/hitboxes.js';
import { enterBossRoom, settleIntoBossRoom, restoreBossRunFloor, beginBossZoneFlow, updateBoss } from '../boss/bossFlow.js';
import { updateRealEnemies } from '../enemies/enemyUpdate.js';
import { ctx } from '../world/context.js';

// --- Melee attack -------------------------------------------------
// J key starts a swing (hero.tryMelee). During the single ACTIVE frame of the
// swing, the hero's meleeHitboxWorld is checked against every live enemy; on
// overlap we route through central damage(). Each enemy can only be hit once
// per swing (tracked in _meleeHitSet), so a multi-enemy overlap still deals
// exactly one hit each. The cooldown prevents spamming.

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
