// Petal Panic — update system (fixed 60Hz physics step).
// integration test: a hero-colored box moved by arrow keys / WASD,
// colliding against static orange SOLID platforms via CollisionWorld + resolve().
// Debug mode toggles the unified debug overlay in render.js.
// hero-following camera clamped to level bounds with facing
// look-ahead; the test level is now longer than the viewport so the camera
// scrolls, and placeholder enemies/projectiles/pickups exercise every §16
// debug-overlay color.

import { input } from '../input.js';
import { VIEW_W, VIEW_H } from '../view.js';
import { Entity } from '../entity.js';
import { LAYER } from '../consts.js';
import { CollisionWorld, resolve, aabbOverlap } from '../collision.js';
import { Camera } from '../camera.js';
import { Anim, makeTestFrame } from '../anim.js';
import { Hero, WEAPON_SPECIAL } from '../hero.js';
import { HEROES, ATTACK_MELEE, ATTACK_SPECIAL_MELEE, ATTACK_SUPERMOVE } from '../heroDefs.js';
import { projectilePool, specialPool, dirAngle } from '../projectile.js';
import { damage } from '../damage.js';
import { applyKnockback } from '../knockback.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../hitbox.js';
import { S, getState, STATE_NAMES, tryTransition, onTransition } from '../state.js';
import { dispatchScreenInput } from '../screens.js';
import { Jester } from '../jester.js';
import { VineHound, VINE_HOUND_DEF } from '../vine_hound.js';
import { Violetta, VIOLETTA_DEF } from '../violetta.js';
import { JackOLantern } from '../jackolantern.js';
import { BorisLoon, BORIS_DEF, makeBorisBaby } from '../boris_loon.js';
import { Elephant, makeElephant, BOSS_TRIGGER_RADIUS, WEAK_POINT_MULT } from '../boss.js';import { particles, coins } from '../particles.js';
import { Effects } from '../effects.js';
import { makeBarrel, makeCoinBarrel, GameObj, Checkpoint, makeCheckpoint } from '../object.js';
import { resolveExplosion } from '../explosion.js';
import { Powerup, POWERUP_DEFS, POWERUP_TYPES } from '../powerup.js';
import { COIN_TYPES } from '../coin.js';
import { LEVELS, generateLevel } from '../level.js';
import { startGame, startLife, continueRun, restoreArea, bindAreaContext, rememberInitial, setRegenerateWorld, showAreaEntry } from '../lifecycle.js';
import { GAME_RULES } from '../gameRules.js';
import { Debug, initSpawnTable, SPAWN_KEYS } from '../debug.js';
import { Theater } from '../effects/theater.js';
import { dumpStats } from '../stats.js';

// --- Tunables for the test rig ---------------------------------------------
// (Hero movement feel lives in js/hero.js; level geometry below.)

// Level struct + rogue spawner (design §13). The declarative level
// definition (LEVELS[0] "Big Top") drives all world content: platforms,
// checkpoints, and every spawnable item. generateLevel() randomly places the
// spawnables along flat ground with min spacing; the hero-start zone (first
// 500px) and boss arena (last 500px) stay clear.
const LEVEL_DEF = LEVELS[0];
// `let` because a genuinely new game (lifecycle.md §1/§6) replaces the whole
// generated world with fresh random generation choices. startGame() invokes
// regenerateWorld() (registered below) to re-roll; death and Continue never
// touch it, so a run's arrangement is fixed for the whole game.
let generated = generateLevel(LEVEL_DEF);

// Level length comes from the level definition (camera clamps to this).
export const LEVEL_LENGTH = LEVEL_DEF.length;

// --- Static solid platforms -------------------------------------------------
// Plain AABBs from the level definition; also wrapped as layer entities so the
// debug overlay can draw them and the mask rules are exercised end-to-end.
export const SOLIDS = generated.platforms;

// Solid wrapper entities (layer-only; no velocity/anim needed).
class SolidBox extends Entity {
  constructor(box) {
    super({ x: box.x, y: box.y, w: box.w, h: box.h, gravity: 0, layer: LAYER.SOLID, debugColor: '#ff9f43' });
  }
}
const solidEntities = SOLIDS.map(b => new SolidBox(b));

// --- Hero ---------------------------------------------------------
// Real Hero wrapping the Scarlet Vale definition; run/jump/crouch/slide,
// gravity, ground friction, facing+mirrorX, and crouch-box shrink all live in
// js/hero.js. Spawn on the floor at x=100 (per design §13 hero start).
const FLOOR_TOP = SOLIDS[0].y; // ground top (first platform is the full-length floor)
const HERO_START_X = 100;
// The module-level hero reference. Boot starts a genuine new game via the
// lifecycle module (lifecycle.md §1); the SELECT→PLAY hook rebinds it for a
// new hero. `let` because setHeroRef() reassigns it.
let hero = new Hero(HEROES.scarlet, HERO_START_X, FLOOR_TOP - HEROES.scarlet.h);
/** Rebind the module-level hero reference (used by debug hero-swap / new game). */
function setHeroRef(h) { hero = h; }

// thorn fire state. Cooldown is in seconds; rapid powerup halves it.
// (Hero.stats.projectile_freq is "shots per second", so base interval = 1/freq.)
hero.fireCooldown = 0;

// Lock Direction must freeze the RESOLVED aim, not the raw directional key
// (design §5): install the hero's contextual resolver into the input engine so
// the lock-capture applies the same rules as resolveAim (grounded crouch →
// horizontal toward facing, airborne/lockMove + Down → straight down, ...).
input.setResolveAim((intent) => getHero().resolveAim(intent));

// --- New game (lifecycle.md §1) -------------------------------------------
// The SELECT→PLAY transition hook below rebuilds the hero with the chosen
// definition; at boot we start a genuine new game with the default hero.
// startGame() owns lives, the continue pool, fresh run stats, and the area
// position — nothing here assigns them ad hoc.
hero = startGame({ oldHero: hero }, HEROES.scarlet);
hero.x = HERO_START_X;
hero.y = FLOOR_TOP - hero.h;
hero.checkpoint = { x: hero.x, y: hero.y };
// Register the world-regeneration callback so SUBSEQUENT genuinely-new games
// (SELECT → PLAY) establish fresh generation choices (lifecycle.md §1/§6).
// The boot game above used the world baked at module load; only a new game
// after the first rerolls. Death and Continue never call startGame, so they
// never reroll.
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

// --- Placeholder non-hero entities (debug-color exercise only) ---------------
// These exist purely so every §16 overlay color is visible on screen. They are
// static (gravity 0) and do NOT participate in collision resolution this task;
// real enemy/projectile/powerup behavior lands in later tasks.
// three red target boxes (HP = 20) that friendly thorns can destroy.
// These stand in for real enemies: same ENEMY layer + HP, but no death pipeline
// yet (that lands in ). When hp drops to <= 0 they are culled here.
const FLOOR_TOP_ENEMY = SOLIDS[0].y; // floor top
// Legacy placeholder targets removed — real enemies (realEnemies) handle all combat.
// Kept as empty array so existing code paths (melee, collision, damage) don't break.
const enemies = [];

// Real enemies come from generateLevel(LEVELS[0]). The rogue spawner
// randomly places each type along flat ground with min spacing; flyers hover at
// their resting altitude, grounders sit on the floor. Every documented AI
// (jester/vine_hound/violetta/jackolantern/boris_loon/boris_loon_baby) is
// instantiated per the level's spawn budget.
const realEnemies = generated.enemies;

// Overgrown Elephant boss (design §9). Spawned at the far end of the
// level in the boss arena (last 500px stay clear of regular spawns). The camera
// locks to its arena once the hero gets within BOSS_TRIGGER_RADIUS; defeating it
// transitions to S.WIN. Tracked separately from realEnemies so the generic
// enemy loop never drives the boss's phase machine.
// `let` because a genuinely new game replaces the boss with a freshly
// generated one (lifecycle.md §1/§6). regenerateWorld() reassigns it.
export let boss = makeElephant(LEVEL_LENGTH - 300, FLOOR_TOP);

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

// Destructible solid barrels (design §10 "Object").
// Barrels are SOLID (block hero + enemy) but carry an HP pool; melee/thorns/bombs
// chip that HP and it only explodes when HP hits 0. Placed along the floor so the
// hero has to shoot around/through them. Coin barrels sit nearby as a coin source
// (no damaging explosion). positions now come from generateLevel().
const barrels = generated.barrels;
const woodBarrels = generated.woodBarrels ?? [];
const coinBarrels = generated.coinBarrels;

// dynamic SOLID registry: world boxes of every LIVE barrel.
// Barrels are solids like the static platforms (design §10/§16): the hero and
// grounded enemies resolve() against SOLIDS + this list each step, so they can
// stand on and be blocked by barrels. The list is refreshed once per fixed
// step because barrels get destroyed (HP 0 → alive=false) mid-fight.
const barrelSolidBoxes = [];
function refreshBarrelSolidBoxes() {
  barrelSolidBoxes.length = 0;
  for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) {
    if (b.alive) barrelSolidBoxes.push(b.worldBox());
  }
}

// Powerups (design §10). Scattered along the level by the rogue
// spawner with min spacing. Each sits on the floor (bob animation lifts it
// visually). The 'clear' powerup is placed wherever the spawner rolls it.
export const powerups = generated.powerups;

// Checkpoints (design §10/§13): four flags at x = 2000/4000/6000/7500
// with ids '1-1' … '1-4'. Touching one stores its position on hero.checkpoint
// for death-restart. They are NOT solids — they don't block movement.
export const checkpoints = generated.checkpoints;

// --- Area lifecycle context (lifecycle.md §2/§3/§4) -------------------------
// The generated world IS the area's fixed arrangement. We record each entity's
// initial position/state ONCE (the arrangement is fixed for the whole game and
// must never change), then bind that context to the hero so the lifecycle ops
// (startLife / continueRun) can restore the area without any other module
// knowing what "start" means. rememberInitial() is idempotent, so this only
// matters at boot.
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
for (const e of realEnemies) rememberInitial(e, { aiState: e.aiState });
rememberInitial(boss, { aiState: boss.aiState });
for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) rememberInitial(b);
for (const p of powerups) rememberInitial(p);
bindAreaContext(hero, areaContext);

/**
 * Re-generate the world with FRESH random generation choices (lifecycle.md
 * §1/§6). Called ONLY by startGame() — a genuinely new game is allowed new
 * choices; death and Continue never reroll, so a run's arrangement stays fixed.
 *
 * The module-level `generated` is swapped for a fresh one and the area context
 * (and the collision world / solid entities) are rebound to the new entity
 * lists. The hero is NOT swapped here — startGame() builds and inserts the
 * fresh hero. The old boss is removed from the collision world; the new one is
 * added. The camera length is unchanged (the level definition is identical).
 *
 * @param {object} oldCtx the previous area context (its entity lists)
 * @returns {object} the new area context (bound to the new world)
 */
function regenerateWorld(oldCtx) {
  const prev = generated;
  generated = generateLevel(LEVEL_DEF);

  // Rebuild the static solid wrapper entities from the fresh platforms.
  SOLIDS.length = 0;
  for (const b of generated.platforms) SOLIDS.push(b);
  solidEntities.length = 0;
  for (const b of generated.platforms) solidEntities.push(new SolidBox(b));

  // Swap the generated entity lists into the mutable module references so the
  // update loop, debug overlay, and getters all see the new world.
  realEnemies.length = 0; realEnemies.push(...generated.enemies);
  barrels.length = 0; barrels.push(...generated.barrels);
  woodBarrels.length = 0; woodBarrels.push(...generated.woodBarrels ?? []);
  coinBarrels.length = 0; coinBarrels.push(...generated.coinBarrels);
  powerups.length = 0; powerups.push(...generated.powerups);
  checkpoints.length = 0; checkpoints.push(...generated.checkpoints);

  // Rebuild the area context around the fresh entity lists.
  const newCtx = {
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

  // Rebind the collision world: drop the old boss + solids, add the new boss +
  // solids. The hero is managed by startGame() (it removes oldHero / adds the
  // new hero), so we don't touch the hero here.
  world.remove(oldCtx.boss);
  for (const s of solidEntities) world.add(s);
  world.add(boss);

  // The fresh entities start WITHOUT a recorded _initPos. startGame() clears
  // any stale _initPos via resetGeneration() (defensive: the new instances are
  // already clean), and the first startLife/continueRun of the new game records
  // the arrangement exactly once via rememberInitial() (idempotent). That first
  // recording fixes the arrangement for the whole new game (lifecycle.md §2).
  return newCtx;
}

// --- Floating text (VFX) -------------------------------------------
// Small pooled "value label" popups for powerup pickups (e.g. "+100 Ammo") and
// checkpoint triggers ("CHECKPOINT 1-2"). Pure visual: no collision layer, no
// allocation after init. Reuses the same pool pattern as particles.
class FloatText {
  constructor() { this.alive = false; }
  spawn(x, y, text, color) {
    this.x = x; this.y = y; this.text = text; this.color = color;
    this.life = 1.0; this.maxLife = 1.0; this.alive = true;
  }
  update(dt) {
    if (!this.alive) return;
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    this.y -= 30 * dt; // drift upward while fading
  }
  draw(ctx) {
    if (!this.alive) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
    ctx.fillStyle = this.color;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}
const FLOAT_TEXT_POOL_SIZE = 16;
const floatTexts = Array.from({ length: FLOAT_TEXT_POOL_SIZE }, () => new FloatText());
/** Spawn a floating label at (x, y). Returns null when the pool is exhausted. */
function spawnFloatText(x, y, text, color) {
  for (const t of floatTexts) {
    if (t.alive) continue;
    t.spawn(x, y, text, color);
    return t;
  }
  return null;
}

// --- Input -------------------------------------------------------------------
/**
 * Retry from the pause menu / game over: a fresh attempt at the CURRENT area's
 * beginning (lifecycle.md §3 — "replaying the same arrangement"). This is a
 * LIFE START, not a resume: it restores the whole area (enemies, barrels,
 * powerups, checkpoints), clears transient projectiles/coins/effects, and
 * places the hero back at the area's entry with full energy and i-frames.
 *
 * Lives are UNTOUCHED (lifecycle.md §3; game-rules.md §1): retry is a fresh
 * attempt, not a continue — only Continue restores the starting life count.
 * The continue pool is also untouched. All the "what does starting mean"
 * knowledge lives in lifecycle.js (startLife); this is a thin wrapper so the
 * GameOver screen's `retry` action and the pause menu's "Retry Level" keep
 * working and the state transition (OVER/PAUSE → PLAY) stays local.
 */
export function retryFromGameOver() {
  startLife(hero, areaContext);
  if (tryTransition(S.PLAY)) {
    console.log('[lifecycle] → PLAY (retry)');
  }
}

/**
 * Continue from game over (lifecycle.md §4). Consumes exactly one continue,
 * restores the global starting life count, and returns to area -1 of the
 * CURRENT level. No coin cost. Returns true if the continue was applied.
 *
 * The pool is a growable global balance (gameRules.js); with no continues
 * remaining, Continue cannot be activated.
 */
export function continueFromGameOver() {
  const applied = continueRun(hero, areaContext);
  if (applied) console.log('[lifecycle] continue applied');
  return applied;
}

/**
 * Debug boot shortcut: reset the world to a clean state before jumping to PLAY.
 * Kills all enemies, clears projectiles/coins/particles, resets checkpoints.
 * The hero is rebuilt by the transition hook (SELECT/HOME/OVER/WIN → PLAY).
 */
function resetWorldForDebug() {
  // Kill all real enemies (NOT the boss — killing it triggers WIN).
  for (const e of realEnemies) {
    if (e.alive) { e.alive = false; }
  }
  // Clear projectiles.
  for (const p of projectilePool.activeItems) { p.alive = false; }
  projectilePool.active.length = 0;
  // Clear coins.
  for (const c of coins.activeItems) { c.alive = false; c.collected = true; }
  coins.active.length = 0;
  // Reset checkpoint flags.
  for (const c of checkpoints) c.triggered = false;
  // Reset effects.
  Effects.reset();
  console.log('[debug] world reset for debug boot');
}

/**
 * Enable the unified debug experience: overlay + harness + log.
 * Idempotent — safe to call multiple times.
 */
function enableDebug(source) {
  if (!Debug.enabled) Debug.toggle();
  if (!Debug.showLog) {
    Debug.showLog = true;
    Debug.logEvent(`${source}: debug ON`);
  }
}

function handleDebugToggle(e, source) {
  e.preventDefault();
  const s = getState();
  if (s !== S.PLAY) {
    window.__selectedHero = 'scarlet';
    hero.x = 80;
    hero.y = FLOOR_TOP - hero.h;
    hero.vx = 0; hero.vy = 0;
    hero.alive = true;
    hero.dying = false;
    hero.deathTimer = 0;
    enableDebug(source);
    tryTransition(S.PLAY);
    console.log(`[debug] ${source}: ${STATE_NAMES[s]} → PLAY`);
    return;
  }

  if (!Debug.enabled) {
    enableDebug(source);
  } else {
    Debug.toggle();
    Debug.reset();
    // Closing debug also closes the theater (it's a debug overlay).
    if (Theater.active) Theater.close();
    Debug.logEvent(`${source}: debug OFF`);
  }
}

// Debug is intentionally outside normal navigation/gameplay bindings.
window.addEventListener('keydown', (e) => {
  if (input.capturing) return;
  if (['F1', 'F2', 'F3'].includes(e.code)) e.preventDefault();
  // F1: toggle debug mode. Opening debug from gameplay enters PLAY + harness.
  // Closing debug returns to normal gameplay (and closes theater if open).
  if (e.code === 'F1') { handleDebugToggle(e, 'debug'); return; }
  // F2: toggle Effect Theater. Works from anywhere (gameplay or debug).
  // Does NOT require debug to be on — it's a standalone overlay.
  if (e.code === 'F2') {
    if (Theater.active) {
      Theater.close();
      Debug.logEvent('theater CLOSE (F2)');
    } else {
      Theater.open();
      Debug.logEvent('theater OPEN (F2)');
    }
    return;
  }
  handleDebugKeys(e);
});

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

// --- Effect Theater gamepad stepping ------------------------------
// Tracks the previous held-direction so a step fires only on the edge (crossing
// zero), preventing hold-to-spin. `wasHeld` is -1/0/+1 for prev/left/right.
let theaterWasHeld = 0;

/**
 * Step the Effect Theater from gamepad input. Called once per frame from
 * processInput() while Theater.active. Reads input.state.moveX (d-pad +
 * left-stick, already normalized by the existing input remap) for left/right.
 * Closing is handled in processInput via nav.back (Escape / gamepad ○).
 */
function updateTheaterGamepad() {
  const s = input.state;
  const dir = s.moveX < -0.2 ? -1 : s.moveX > 0.2 ? 1 : 0;
  // Edge-trigger: fire a step only when the held direction changes away from 0
  // into a new side (or flips side). Holding keeps the same dir → no re-step.
  if (dir !== 0 && dir !== theaterWasHeld) {
    Theater.step(dir);
    Debug.logEvent(`theater → ${Theater.current().type}`);
  }
  theaterWasHeld = dir;
}

// --- Debug harness mouse input: click to select / force an enemy's state -----
// Converts a screen-space click into logical 960x540 coords (inverse of the
// main.js transform), then selects or cycles the entity under it. Only active
// while the harness is on; zero cost otherwise (early return).
window.addEventListener('mousedown', (e) => {
  if (!Debug.enabled) return;
  const canvas = document.getElementById('game');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  // Screen → logical: account for letterbox centering + dpr scaling.
  const sx = (e.clientX - rect.left) / rect.width * VIEW_W;
  const sy = (e.clientY - rect.top) / rect.height * VIEW_H;
  const cam = getCamera();
  const lx = sx + cam.x;
  const ly = sy + cam.y;
  // Left click = force-cycle AI state; right click = select for inspection.
  if (e.button === 2) { e.preventDefault(); selectEntityAt(lx, ly); }
  else forceStateAt(lx, ly);
});
window.addEventListener('contextmenu', (e) => { if (Debug.enabled) e.preventDefault(); });

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

// --- Debug & Test Harness ----------------------------------------------------
// Everything below is gated behind `if (Debug.enabled)` so normal play pays only
// a single boolean check per frame. The spawn table is populated once from the
// entity constructors that exist in this module's scope.
initSpawnTable({
  Jester, VineHound, Violetta, JackOLantern,
  BorisLoon, BORIS_DEF, makeBorisBaby,
  makeBarrel, makeCoinBarrel, Powerup, POWERUP_TYPES,
});

/**
 * Spawn a debug entity at (x, y) with an optional forced AI state, register it
 * in the collision world, and log it. Returns the created entity (or null if the
 * type is unknown). Used by the free-spawn hotkeys and the cursor-spawn click.
 * @param {string} type spawn-table key (see SPAWN_KEYS / initSpawnTable)
 * @param {number} x world x
 * @param {number} y world y
 * @param {string} [state] AI state to force after creation
 */
function debugSpawn(type, x, y, state) {
  const entry = Debug.spawnTable[type];
  if (!entry) return null;
  const ent = entry.make(x, y, state);
  // Register so it participates in collisions/rendering like level entities.
  world.add(ent);
  // Track spawned enemies in realEnemies so the generic update loop drives their
  // AI + death pipeline exactly as level spawns do.
  if (ent.layer === LAYER.ENEMY || ent.layer === LAYER.BOSS) realEnemies.push(ent);
  else if (ent instanceof GameObj) barrels.push(ent); // barrels live in the barrel list
  else if (ent instanceof Powerup) powerups.push(ent);
  Debug.logEvent(`spawn ${type}${state ? ` @${state}` : ''} (${Math.round(x)},${Math.round(y)})`);
  return ent;
}

/**
 * Handle debug keypresses. Called from the global keydown listener while
 * Debug.enabled is true. All actions are edge-triggered (one press = one action).
 * @param {KeyboardEvent} e
 */
function handleDebugKeys(e) {
  // F3 auto-enables debug if off, then cycles view on next press.
  if (e.code === 'F3' && !Debug.enabled) {
    handleDebugToggle(e, 'debug');
    return;
  }
  if (!Debug.enabled) return;

  // Free-spawn hotkeys (1-9): spawn at hero position + small offset.
  const spawnType = SPAWN_KEYS[e.code];
  if (spawnType) {
    const ox = 40, oy = -20; // small offset so it doesn't overlap the hero
    debugSpawn(spawnType, hero.x + hero.w / 2 + ox, hero.y + hero.h / 2 + oy);
    return;
  }

  switch (e.code) {
    case 'KeyF': // God mode toggle
      Debug.god = !Debug.god;
      if (!Debug.god) hero.intangible = false;
      Debug.logEvent(`god mode ${Debug.god ? 'ON' : 'OFF'}`);
      break;
    case 'KeyZ': // Slow-mo / freeze cycle
      Debug.timeScale = Debug.cycleTimeScale();
      Debug.logEvent(`timeScale → ${Debug.timeScale}x`);
      break;
    case 'KeyT': // Toggle telemetry panel
      Debug.showStats = !Debug.showStats;
      Debug.logEvent(`telemetry ${Debug.showStats ? 'ON' : 'OFF'}`);
      break;
    case 'KeyU': // Toggle live input monitor panel
      Debug.showInput = !Debug.showInput;
      Debug.logEvent(`input monitor ${Debug.showInput ? 'ON' : 'OFF'}`);
      break;
    case 'KeyY': // Hero swap Scarlet <-> Balthazhar
      swapHero();
      break;
    case 'KeyL': // Toggle event-log display
      Debug.showLog = !Debug.showLog;
      break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
      // Theater stepping is handled by updateTheaterGamepad (reads input.state.moveX).
      // Don't double-step here. Only drive the anim scrubber when theater is closed.
      if (!Theater.active) {
        scrubSelectedAnim(e.code);
      }
      break;
    case 'KeyX': // Deselect current entity
      if (Debug.selected) { Debug.selected = null; Debug.logEvent('deselect'); }
      break;
    case 'KeyE': // Dump stats JSON to disk
      dumpStats(hero.runStats, hero);
      Debug.logEvent('stats JSON downloaded');
      break;
    case 'F3': // Cycle collision view mode (round-robin)
      Debug.viewMode = (Debug.viewMode + 1) % 3;
      const modeNames = ['sprite+collision', 'collision-only', 'sprite-only'];
      Debug.logEvent(`view: ${modeNames[Debug.viewMode]}`);
      break;
  }
}

/**
 * Toggle between the two heroes (Scarlet Vale <-> Balthazhar). Rebuilds the hero
 * instance in place, preserving position/energy/lives/ammo so the A/B test is
 * about feel (jump height, speed, melee range), not a fresh start.
 */
function swapHero() {
  const curId = hero.heroDef.id;
  const nextId = curId === 'scarlet' ? 'balthazar' : 'scarlet';
  const def = HEROES[nextId];

  // Preserve runtime resources across the swap.
  const saved = {
    x: hero.x, y: hero.y, vx: hero.vx, vy: hero.vy,
    energy: hero.energy, lives: hero.lives, coins: hero.coins,
    ammo: hero.ammo, specialAmmo: hero.specialAmmo,
    selectedWeapon: hero.selectedWeapon,
    checkpoint: hero.checkpoint, continuesUsed: hero.continuesUsed,
    stats: hero.stats,
    runStats: hero.runStats, // preserve unified telemetry
    intangible: hero.intangible, rapidTimer: hero.rapidTimer,
  };

  const nh = new Hero(def, saved.x, saved.y);
  Object.assign(nh, saved);
  // Carry the remaining i-frame window across the swap so the new hero is not
  // immune forever (flag alone would outlive its timer). If the old flag was
  // set but the timer already expired, clear both so the flag can't linger.
  if (saved.intangible) {
    const remaining = hero.timers.get('intangible');
    if (remaining > 0) {
      nh.timers.set('intangible', remaining);
    } else {
      nh.intangible = false;
    }
  }
  // CRITICAL: restore the NEW hero's stats (Object.assign overwrote them
  // with the old hero's stats object). Stats define speed/jump/special/etc.
  nh.stats = def.stats;
  nh.vx = saved.vx; nh.vy = saved.vy;
  // Re-alias combatStats into the (preserved) runStats so damage.js / powerup.js
  // continue writing into the unified structure after the swap.
  nh.combatStats = {
    get projectilesShot() { return nh.runStats.projectilesShot; },
    set projectilesShot(v) { nh.runStats.projectilesShot = v; },
    hitsLanded: nh.runStats.hitsLanded,
    damageDealt: nh.runStats.damageDealt,
    powerupsCollected: nh.runStats.powerupsCollected,
  };
  // Reattach placeholder anims sized for the new body.
  nh.anim = new Anim(
    ['#2ecc71', '#27ae60', '#1abc9c'].map(c => makeTestFrame(nh.w, nh.h, c)),
    { speed: 200, loop: true },
  );
  nh.anims.attack = new Anim(
    ['#555555', '#888888', '#aaaaaa', '#ffffff', '#666666'].map(c => makeTestFrame(nh.w, nh.h, c)),
    { speed: 80, loop: false },
  );

  // Swap the reference inside the collision world.
  world.remove(hero);
  world.add(nh);
  // Rebind the module-level `hero` via the getter indirection: we mutate the
  // exported binding by reassigning the captured variable through a setter.
  setHeroRef(nh);
  Debug.logEvent(`hero → ${def.name}`);
}

/** Step the selected entity's animation forward/back one frame. */
function scrubSelectedAnim(code) {
  const sel = Debug.selected;
  if (!sel) return;
  const anim = sel.anim ?? sel.anims?.attack;
  if (!anim || !anim.frames.length) { Debug.logEvent('no anim on selection'); return; }
  const n = anim.frames.length;
  let i = anim.frameIndex;
  if (code === 'ArrowRight') i = (i + 1) % n;
  else if (code === 'ArrowLeft') i = (i - 1 + n) % n;
  else if (code === 'ArrowUp') i = 0;
  else if (code === 'ArrowDown') i = n - 1;
  anim.pickFrame(i);
  Debug.logEvent(`scrub ${sel.type ?? sel.heroDef?.id ?? '?'} frame ${i}/${n - 1}`);
}

/** Select the topmost enemy/boss/powerup under a logical-space point. */
export function selectEntityAt(lx, ly) {
  // Prefer enemies + boss (the interesting ones), then powerups/barrels.
  const candidates = [...realEnemies, ...enemies, boss].filter(e => e && e.alive !== false);
  for (const p of powerups) if (p.alive && !p.collected) candidates.push(p);
  for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) if (b.alive) candidates.push(b);
  const hero = getHero();
  if (hero && !hero.dying) candidates.push(hero);
  for (const c of candidates) {
    const b = c.worldBox();
    if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) {
      Debug.selected = c;
      // Selecting an entity promotes detail to inspect level so its numeric
      // panel shows immediately (mirror icons stay on at every level).
      if (Debug.detailLevel < 2) {
        Debug.detailLevel = 2;
        Debug.logEvent('detail: inspect');
      }
      Debug.logEvent(`select ${c.type ?? c.powerType ?? '?'} @(${Math.round(lx)},${Math.round(ly)})`);
      return c;
    }
  }
  Debug.selected = null;
  return null;
}

/** Force-cycle the AI state of the entity under a logical-space point. */
export function forceStateAt(lx, ly) {
  const hit = pickEnemyAt(lx, ly);
  if (!hit) return null;
  const s = Debug.nextState(hit);
  Debug.logEvent(`force ${hit.type}: ${s ?? '(none)'}`);
  return s;
}

/** Find an enemy/boss whose box contains the point (for click-to-force-state). */
function pickEnemyAt(lx, ly) {
  const candidates = [...realEnemies, boss].filter(e => e && e.alive !== false);
  for (const c of candidates) {
    const b = c.worldBox();
    if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) return c;
  }
  return null;
}

/** Per-frame god-mode enforcement: intangible + infinite ammo. */
function applyGodMode(dt) {
  if (!Debug.god) return;
  hero.intangible = true;
  hero.ammo = Infinity;
  hero.specialAmmo = Infinity;
}
// --- Collision world -----------------------------------------------------------
const world = new CollisionWorld({ cellSize: 64 });
for (const s of solidEntities) world.add(s);
world.add(hero);
// Live targets + the decorative anim-test box participate in collisions so
// thorns can hit them (the anim box has no hp, so it's damage-immune).
for (const e of enemies) world.add(e);
world.add(animTestEnemy);
// remaining enemies participate in collisions (thorn hits, contact,
// foe projectiles). Flyers use gravity 0 so they never fall; grounders do not.
for (const e of realEnemies) world.add(e);
// boss participates in collisions (PROJ_ALLY×BOSS → 'hit',
// HERO×BOSS → contact). Added after the regular enemies.
world.add(boss);
// barrels are SOLID: they block hero + enemy (resolve) and can be
// hit by friendly thorns (PROJ_ALLY×SOLID → 'hit'). Added now; destroyed ones
// are removed from the world when their HP hits 0. Both explosive barrels AND
// coin barrels participate (coin barrels just skip the damaging AoE on death).
for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) world.add(b);
// powerups (PICKUP layer; HERO×PICKUP → 'pickup') and checkpoints
// (CHECKPOINT layer; HERO×CHECKPOINT → 'checkpoint'). Both are non-solid.
for (const p of powerups) world.add(p);
for (const c of checkpoints) world.add(c);

// Rule-action handlers — the declarative dispatch path. For this task we only
// need to observe events; damage/pickup logic arrives with later tasks.
world.on('resolve', () => {}); // positional correction happens via the resolve()
                                // calls below (SOLIDS + barrelSolidBoxes)

// friendly thorns hit ENEMY/BOSS (PROJ_ALLY rule). Apply damage and
// cull the projectile on impact. This is the ONLY place a PROJ_ALLY can interact
// with an enemy; there is no PROJ_ALLY↔HERO rule, so friendly-fire stays off.
world.on('hit', (a, b) => {
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
      world.remove(target);
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
      victim.runStats.hitsTaken.enemyProjectile += 1;
      victim.runStats.hitsTaken.total += 1;
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
world.on('contact', (a, b) => {
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
    heroEnt.runStats.hitsTaken.enemyContact += 1;
    heroEnt.runStats.hitsTaken.total += 1;
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
world.on('collect', (a, b) => {
  const coinEnt = a.layer === LAYER.COIN ? a : (b.layer === LAYER.COIN ? b : null);
  const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
  if (!coinEnt || !heroEnt) return;
  if (coinEnt.collected || !coinEnt.alive) return; // already credited (guard)

  // Credit the hero + stats.
  const type = coinEnt.coinType ?? 'bronze';
  const value = coinEnt.value ?? COIN_TYPES.bronze.value;
  heroEnt.coins += value;
  heroEnt.runStats.coinsCollected[type] = (heroEnt.runStats.coinsCollected[type] ?? 0) + 1;
  heroEnt.runStats.coinsCollected.total += 1;

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
  world.remove(coinEnt);
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
world.on('pickup', (a, b) => {
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

  world.remove(pu);
});

// HERO × CHECKPOINT trigger (design §10/§13). Fires when the hero's
// box overlaps a checkpoint flag. Checkpoint.trigger() stores its position on
// hero.checkpoint (used by the death-restart pipeline) and latches so re-walking
// over it is a no-op. A brief flash plays via the entity's flashTimer.
world.on('checkpoint', (a, b) => {
  const cp = a.layer === LAYER.CHECKPOINT ? a : (b.layer === LAYER.CHECKPOINT ? b : null);
  const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
  if (!cp || !heroEnt) return;
  if (!(cp instanceof Checkpoint)) return;
  if (cp.triggered) return; // already triggered this run

  const fired = cp.trigger(heroEnt);
  if (!fired) return;

  // count checkpoint hits (design §4.1).
  heroEnt.runStats.checkpointsHit += 1;

  // VFX: flash (entity-driven) + floating id label.
  const cx = cp.x + cp.w / 2;
  const cy = cp.y + cp.h / 2;
  Effects.fireParticleBurst(cx, cy, 5); // engine path — plain sparkle burst
  spawnFloatText(cx, cy - 20, `CHECKPOINT ${cp.checkpointId}`, '#ffd700');
  // SFX: checkpoint

  // checkpoints.md §1/§3: a checkpoint marks an area boundary. Reaching one
  // advances to the next area (the boss zone, identified as the level's boss
  // area, receives the same shared entry screen). The world is single-level
  // for v1, so the area index is the level's checkpoint position: the
  // triggered flag at index i is the entry of area i (area -1 is the
  // pre-area before the first flag). The player confirms the entry screen to
  // begin the new area (lifecycle.md §2: show the screen, then begin play).
  const idx = checkpoints.indexOf(cp);
  if (idx >= 0) {
    heroEnt.currentArea = idx;
    showAreaEntry(heroEnt, areaContext);
  }
});

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
    const nh = startGame({ world, oldHero, areaContext }, def);
    nh.x = HERO_START_X;
    nh.y = FLOOR_TOP - nh.h;
    nh.checkpoint = { x: nh.x, y: nh.y };
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

// --- Camera --------------------------------------------------------------------
// Hero-following cam clamped to [0, LEVEL_LENGTH - VIEW_W] with facing look-ahead.
export const camera = new Camera();
camera.levelLength = LEVEL_LENGTH;

// brief screen shake on barrel explosions (optional juice). The
// camera-shake effect engine instance is the single owner of the shake state
// (effects/cameraShake.js); triggerShake()/updateShake() used to live here as
// module locals but were migrated through the Effects shim (review):
// render.js reads getShakeOffset(), which now returns the tracked instance's
// current offset ({0,0} when idle/done).
export function getShakeOffset() { return Effects.getShakeOffset(); }

export function getHero() { return hero; }
export function getSolids() { return SOLIDS; }
export function getCollisionWorld() { return world; }
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
  if (getState() !== S.PLAY) return;

  // --- Debug harness: time scaling + god mode. Zero cost when off. -----------
  if (Debug.enabled) {
    applyGodMode(dt);
    dt *= Debug.timeScale; // slow-mo / freeze-frame (0 = physics paused, render continues)
    if (dt <= 0) { Effects.update(0); return; } // frozen: skip all physics this step
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
  if (input.switchWeapon) hero.toggleWeapon(); // edge-triggered, no fire
  // Thorn cooldown ticks EVERY frame regardless of input/selection — a stale
  // cooldown must never freeze while J is released or Special is selected.
  if (hero.fireCooldown > 0) hero.fireCooldown -= dt;
  tryFire(hero, input, dt);                    // dispatches on hero.selectedWeapon

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
  if (input.melee && !hero.hitStunned) {
    const wasActive = hero.meleeActive || hero.specialMeleeActive;
    hero.requestMelee(input.down ? 'special' : 'normal');
    if (!wasActive && (hero.meleeActive || hero.specialMeleeActive)) {
      hero.runStats.meleeSwings += 1; // count the swing start
    }
  }
  processAllHitboxes();

  // 1d. decay hit-flash timers on enemies (white flash when struck).
  for (const e of enemies) {
    if (e.hitFlash > 0) e.hitFlash -= dt;
  }

  // 1d2. tick live barrels (decays their hit-flash timer).
  for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) {
    if (b.alive) b.update(dt);
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
  world.update();

  // Grounded: derive from the last resolved axis + a surface-contact probe so
  // the hero can jump again immediately after landing. While dropping through
  // a one-way platform the hero is NOT grounded on it (the probe below skips
  // ignored one-way solids); solid terrain still grounds normally.
  hero.setGrounded(isGrounded(hit));

  // Keep the hero inside the LEVEL horizontally (test-rig convenience).
  const wb = hero.worldBox();
  if (wb.x < 0) { hero.x = -hero.box.ox; hero.vx = 0; }
  else if (wb.x + wb.w > LEVEL_LENGTH) { hero.x = LEVEL_LENGTH - hero.box.ox - hero.box.bw; hero.vx = 0; }

  // 4. camera follows the hero (clamped to level bounds, facing look-ahead).
  camera.update(hero);

  // 4b. track run distance + time for stats (design §4.1).
  hero.runStats.distanceTraveled += Math.abs(hero.vx * dt);
  hero.runStats.timePlayed += dt;

  // 5. the camera-shake instance is stepped by updateEffects() →
  // Effects.update(dt) below (render reads getShakeOffset()).
}

// checkpoints.md §4: after the death presentation and a short delay, FADE TO
// BLACK. Consume one life exactly once. If lives remain, show the shared
// entry screen with the new count, then restart the entire current area
// (the player confirms the screen to begin the attempt).
/** Length of the fade-to-black after the skull presentation (checkpoints.md §4). */
const DEATH_FADE_DURATION = 0.6;
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
  if (hero.lives > 0) {
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

// --- Shooting (+ design §21) ----------------------------------------
// ONE shared shoot path: J fires whatever weapon is currently SELECTED on the
// hero ('thorn' | 'special'). N never fires — it only toggles the selection
// (hero.toggleWeapon, called by the update step). Each weapon keeps its own
// ammo pool and its own cooldown timer, so depleting Thorn ammo never blocks
// Special and vice versa. The aim is resolved once by gameplay context
// (hero.resolveAim, design §4/§32); friendly projectiles only ever hit
// ENEMY/BOSS via COLLISION_RULES, so friendly-fire is off by construction.

/**
 * Attempt to fire the hero's selected weapon this step. Dispatches on
 * h.selectedWeapon; each branch consumes that weapon's OWN ammo pool and sets
 * its OWN cooldown (Thorn → h.ammo / h.fireCooldown; Special → h.specialAmmo /
 * the labeled 'special' timer, which shows in the per-entity debug stack).
 * @param {Hero} h the firing hero
 * @param {object} input current intent (shoot/lockMove/aimX/aimY/...)
 * @param {number} dt seconds
 */
function tryFire(h, input, dt) {
  if (!input.shoot) return;
  if (h.selectedWeapon === WEAPON_SPECIAL) {
    fireSpecial(h, input);
  } else {
    // Default workhorse: fast, straight thorns (§21).
    fireThorn(h, input, dt);
  }
}

/** Fire one Thorn (default weapon): projectilePool + 'ammo' + fireCooldown. */
function fireThorn(h, input, dt) {
  if (h.fireCooldown > 0) return; // still cooling down (ticks every frame in update())
  if (h.ammo <= 0) return;        // no ammo → cannot fire

  const dir = h.resolveAim(input);

  // Spawn at the active-box center, offset slightly toward the aim so the
  // thorn starts just outside the body (avoids same-frame self-overlap).
  const { x: cx, y: cy } = h.bodyCenter();
  const size = 12;
  const ox = Math.cos(dirAngle(dir)) * 16;
  const oy = Math.sin(dirAngle(dir)) * 16;
  const p = projectilePool.spawn(cx - size / 2 + ox, cy - size / 2 + oy, dir, true);
  if (!p) return; // pool exhausted — skip this shot (soft cap, no allocation)

  h.ammo -= 1;
  h.combatStats.projectilesShot += 1;

  // Cooldown: base interval = 1 / shots-per-second; ×0.5 during rapid powerup.
  const base = 1 / h.stats.projectile_freq;
  h.fireCooldown = h.rapidTimer > 0 ? base * 0.5 : base;
}

/**
 * Fire the hero's Special weapon (design §21): Scarlet throws a fast saw blade
 * (no gravity, short range); Balthazar lobs a bomb (gravity, fuse, AoE).
 * Consumes specialAmmo, gated by special_freq. The cooldown is a labeled timer
 * on the HERO ('special') so it shows in the per-entity debug stack like every
 * other countdown — independent of the Thorn fireCooldown.
 */
function fireSpecial(h, input) {
  if (h.timers.get('special') > 0) return; // still cooling down
  if (h.specialAmmo <= 0) return;          // no special ammo → cannot fire

  const type = h.stats.special; // 'saw' | 'bomb'
  const dir = h.resolveAim(input);
  const { x: cx, y: cy } = h.bodyCenter();
  const angle = dirAngle(dir);
  const ox = Math.cos(angle) * 20;
  const oy = Math.sin(angle) * 20;

  const s = specialPool.spawn(cx - 10 + ox, cy - 10 + oy, dir, type);
  if (!s) return; // pool exhausted

  h.specialAmmo -= 1;
  h.combatStats.specialsUsed = (h.combatStats.specialsUsed ?? 0) + 1;
  h.timers.set('special', h.stats.special_freq); // cooldown as a labeled timer

  if (Debug.enabled) Debug.logEvent(`special ${type} fired`);
}

/**
 * Explode a special projectile (bomb AoE or saw fizzle). Called from ANY death
 * path: TTL expiry, enemy contact, barrel contact, off-screen cull. Single
 * source of truth so VFX + damage are identical regardless of trigger.
 */
function explodeSpecial(s) {
  if (s.exploded) return; // already exploded (idempotent)
  s.exploded = true;
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;

  if (s.type === 'bomb' && s.radius > 0) {
    // AoE damage to all live entities in radius (enemies only — no self-damage).
    // Route through takeDamage() so real enemies own their death transition
    // internally (hp<=0 -> die() -> death TTL); placeholders use raw damage().
    for (const t of realEnemies) {
      if (!t.alive) continue;
      const dx = (t.x + t.w / 2) - cx;
      const dy = (t.y + t.h / 2) - cy;
      if (Math.sqrt(dx * dx + dy * dy) <= s.radius) {
        const dealt = typeof t.takeDamage === 'function'
          ? t.takeDamage(s.damage, s, 'special')
          : damage(s, t, s.damage, 'special');
        if (Debug.enabled) Debug.logEvent(`bomb → ${t.type} dmg ${dealt}`);
      }
    }
    // Legacy bomb explosion roll (pre-migration spawnExplosionVFX, preserved
    // verbatim): 12 + floor(rand*4) → 12–15 particles. The engine's
    // deterministic formula is overridden by this explicit count; palettes
    // and speeds stay owned by effects/explosion.js.
    const bombCount = 12 + Math.floor(Math.random() * 4);
    Effects.spawnExplosion(cx, cy, s.radius, bombCount); // engine path — warm fire burst sized to AoE
    Effects.bigExplosion();
    Effects.triggerShake(6); // engine path — camera-shake singleton
    if (Debug.enabled) Debug.logEvent('bomb exploded');
  } else {
    // Saw: small fizzle spark, no AoE.
    Effects.fireParticleBurst(cx, cy, 4); // engine path — plain sparkle burst
  }
}

// --- Melee attack -------------------------------------------------
// J key starts a swing (hero.tryMelee). During the single ACTIVE frame of the
// swing, the hero's meleeHitboxWorld is checked against every live enemy; on
// overlap we route through central damage(). Each enemy can only be hit once
// per swing (tracked in _meleeHitSet), so a multi-enemy overlap still deals
// exactly one hit each. The cooldown prevents spamming.

// --- Unified hitbox system ---------------------------------------------------
// All attack hitboxes register here each frame. One generic loop processes
// them via processHitboxes(). Each hitbox "slot" follows the same lifecycle:
//   box appears → activate + reset hitSet (fresh instance)
//   box persists → stay active, hitSet prevents re-hits
//   box disappears → deactivate, flag ready for next instance

const _hitboxes = []; // registered hitbox instances (reused, not allocated per frame)

/**
 * A hitbox slot: pairs a persistent Hitbox object with the state needed to
 * track its instance lifecycle (reset-on-first-frame pattern).
 */
function makeSlot(hb, { ownerGet, boxGet, damageGet, resetFlag }) {
  return { hb, ownerGet, boxGet, damageGet, resetFlag };
}

/**
 * Update one hitbox slot for this tick. Returns nothing; mutates the slot's
 * hitbox in place. The resetFlag is a [getter, setter] pair on the owner so
 * each entity tracks its own "has this instance already reset?" state.
 */
function updateSlot(slot) {
  const { hb, ownerGet, boxGet, damageGet, resetFlag } = slot;
  const owner = ownerGet();
  const box = boxGet();
  if (box && owner) {
    hb.owner = owner;
    hb.box = box;
    hb.damage = damageGet();
    // Knockback rides on the resolved box (heroDefs data → attackHitboxWorld).
    // Copy it onto the hitbox so processAllHitboxes reads hb.knockback at impact.
    hb.knockback = box.knockback;
    hb.active = true;
    if (!resetFlag.get()) {
      resetHitbox(hb);
      resetFlag.set(true);
    }
  } else {
    hb.active = false;
    resetFlag.set(false);
  }
}

// Hero melee slot.
const _hbMelee = makeHitbox({ owner: null, team: 'ally', box: null, damage: 0, method: 'melee' });
_hitboxes.push(_hbMelee);
const _slotMelee = makeSlot(_hbMelee, {
  ownerGet: () => hero,
  boxGet: () => hero.attackHitboxWorld(ATTACK_MELEE),
  damageGet: () => hero.stats.attack,
  resetFlag: { get: () => !!hero._meleeHbReset, set: v => hero._meleeHbReset = v },
});

// Hero supermove dash slot.
const _hbSuper = makeHitbox({ owner: null, team: 'ally', box: null, damage: 0, method: 'super' });
_hitboxes.push(_hbSuper);
const _slotSuper = makeSlot(_hbSuper, {
  ownerGet: () => hero,
  boxGet: () => hero.attackHitboxWorld(ATTACK_SUPERMOVE),
  damageGet: () => hero.stats.attack * 2,
  resetFlag: { get: () => !!hero._supermoveHbReset, set: v => hero._supermoveHbReset = v },
});

// Hero special melee slot (design §15): Down+Melee per-hero trajectory swing.
// Same lifecycle as the normal melee slot — only the active phase exposes a
// box; damage routes through the same central damage() system.
const _hbSpecialMelee = makeHitbox({ owner: null, team: 'ally', box: null, damage: 0, method: 'specialMelee' });
_hitboxes.push(_hbSpecialMelee);
const _slotSpecialMelee = makeSlot(_hbSpecialMelee, {
  ownerGet: () => hero,
  boxGet: () => hero.attackHitboxWorld(ATTACK_SPECIAL_MELEE),
  damageGet: () => hero.stats.attack,
  resetFlag: { get: () => !!hero._specialMeleeHbReset, set: v => hero._specialMeleeHbReset = v },
});

/**
 * Register active hitboxes for this frame and process them all in one pass.
 * Called once per update tick after all entities have integrated.
 */
function processAllHitboxes() {
  const h = hero;

  // --- Hero slots (melee + special melee + supermove) ---
  updateSlot(_slotMelee);
  updateSlot(_slotSpecialMelee);
  updateSlot(_slotSuper);

  // --- Enemy attack hitboxes (whip, lunge, jab) ---
  // Each real enemy exposes an attack hitbox getter. Register dynamically.
  for (const e of realEnemies) {
    if (!e.alive || e.aiState === 'dead') continue;
    const ehb = getEnemyAttackHitbox(e);
    if (!ehb) {
      // No box this frame → deactivate + ready for next attack.
      if (e._hitbox) {
        e._hitbox.active = false;
        e._hitboxReset = false;
      }
      continue;
    }
    let hb = e._hitbox;
    if (!hb) {
      hb = makeHitbox({ owner: e, team: 'foe', box: null, damage: e.stats.attack, method: 'melee' });
      e._hitbox = hb;
      _hitboxes.push(hb);
    }
    hb.owner = e;
    hb.box = ehb;
    hb.damage = e.stats.attack;
    hb.active = true;
    if (!e._hitboxReset) {
      resetHitbox(hb);
      e._hitboxReset = true;
    }
  }

  // --- Process all against all targets ---
  const targets = [h, ...realEnemies, boss, ...barrels, ...woodBarrels, ...coinBarrels].filter(Boolean);
  processHitboxes(_hitboxes, targets, (hb, target, dealt) => {
    // Self-protection on connect (knockback.md ): the FIRST clean
    // hit of a special melee swing arms the hero's protection window for the
    // rest of that swing. The callback only fires when the box actually struck
    // a target — a whiff never reaches here, so it grants nothing. Normal
    // melee and supermove connects intentionally do NOT arm it (acceptance #4).
    if (hb.method === 'specialMelee' && hb.owner === h) {
      h.markSpecialConnect();
    }
    // VFX / juice on hit.
    if (target.layer === LAYER.HERO) {
      Effects.heroDamaged();
    } else {
      Effects.beginEnemyShake(target);
      if (target.hitFlash !== undefined) target.hitFlash = 0.1;

      // Hero→enemy knockback: if the attack hitbox carries a `knockback`
      // setting, apply the physical reaction to the enemy. No per-attack-type
      // branching — presence of the data is the only gate. The setting lives on
      // the hitbox (design §7), not the hero; the hero is used for motion/dir.
      const source = hb.owner;
      if (hb.knockback) {
        const dirMode = hb.knockback.dirMode || 'fromAttacker';
        let nx, ny;
        if (dirMode === 'alongVelocity') {
          const len = Math.hypot(source.vx || 0, source.vy || 0) || 1;
          nx = (source.vx || 0) / len;
          ny = (source.vy || 0) / len;
        } else {
          // 'fromAttacker' or 'radial': direction from source center to enemy center
          const scx = source.x + (source.w || 0) / 2;
          const scy = source.y + (source.h || 0) / 2;
          const ecx = target.x + target.w / 2;
          const ecy = target.y + target.h / 2;
          const dx = ecx - scx, dy = ecy - scy;
          const len = Math.hypot(dx, dy) || 1;
          nx = dx / len; ny = dy / len;
        }
        applyKnockback(target, source, hb.knockback, { x: nx, y: ny });
      }
    }
    // Remove dead enemies from world.
    if (target.alive === false && target !== h) {
      world.remove(target);
    }
    // Handle barrel destruction.
    if (target.destroyed) {
      handleBarrelDestroyed(target);
    }
  });
}

/**
 * Get the current attack hitbox for a real enemy, or null.
 * Each enemy type stores its hitbox getter under a known property name.
 */
function getEnemyAttackHitbox(e) {
  // Jester: whipHitboxWorld, VineHound: lungeHitboxWorld, Violetta: meleeHitboxWorld
  if (e.whipHitboxWorld != null) return e.whipHitboxWorld;
  if (e.lungeHitboxWorld != null) return e.lungeHitboxWorld;
  if (e.meleeHitboxWorld != null) return e.meleeHitboxWorld;
  return null;
}

// --- Real-enemy update (jester + remaining AIs) ------------
// Drives every real Enemy's AI state machine, physics integration, per-type
// attack hitbox check, solid collision, and death pipeline (sparkle burst +
// coin drop on full death). The jester-specific whip logic is generalized into a
// per-enemy "attack hitbox" accessor so one loop covers all six types.

/**
 * Per-frame step for a single real enemy. Called from updateRealEnemies().
 * @param {Enemy} e the enemy entity
 * @param {number} dt seconds
 */
function updateRealEnemy(e, dt) {
  // Decay contact cooldown (shared by all real enemies via the 'contact' rule).
  if (e._contactCd > 0) e._contactCd -= dt;

  // AI + gravity + integrate (base Enemy.update handles all of this). Flyers
  // have gravity 0 so they never fall; grounders do not.
  e.update(dt, hero, world);

  // Resolve against solids (static platforms + live barrels) so grounders
  // don't walk through platforms or barrels. Flyers skip solid resolution
  // (they fly over/through them by design). Dying enemies (aiState === 'dead')
  // still resolve: their death pipeline integrates vx/vy + gravity, so a body
  // knocked back mid-death must land on platforms and slide along the ground
  // instead of ghosting through floors. Resolution stops only when alive
  // flips to false (death fade complete), at which point updateRealEnemy()
  // removes the entity from the collision world.
  if (e.alive && e.gravity > 0) {
    resolve(e, [...SOLIDS, ...barrelSolidBoxes]);
  }

  // Attack hitbox: now handled by the unified processAllHitboxes() system.
  // The old inline check is removed; enemy hitboxes register as team:'foe'
  // and the generic loop routes them against the hero.
  const atkHb = getAttackHitbox(e);
  if (!atkHb) e._atkHitDone = false; // reset when window closes (hitbox system uses its own hitSet)

  // Explosion (generic): any entity that carries an `explosion` property and has
  // latched its detonation fires the AoE blast here — the SAME path a barrel uses.
  // The only per-source difference is WHEN the trigger fires: barrels detonate on
  // destruction, the Jack-O-Lantern latches `exploded` when it blows up. No
  // instanceof checks; the engine reads e.explosion and resolves uniformly.
  if (e.explosion && e.exploded && !e._explodeHandled) {
    e._explodeHandled = true;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const targets = [hero, ...enemies, ...realEnemies];
    const result = resolveExplosion({
      ...e.explosion,
      cx, cy,
      self: e,
      ctx: { hero },
    }, targets);
    // Legacy enemy-death explosion roll (pre-migration spawnExplosionVFX,
    // preserved verbatim): 12 + floor(rand*4) → 12–15 particles.
    const deathCount = 12 + Math.floor(Math.random() * 4);
    Effects.spawnExplosion(cx, cy, result.radius, deathCount); // engine path — warm fire burst sized to AoE
    Effects.bigExplosion(); // screen flash on big explosion
    Effects.triggerShake(6); // engine path — camera-shake singleton
    // SFX: explosion
  }

  // Death pipeline completion: when alive flips to false after the anim,
  // spawn sparkles + coins and remove from the collision world.
  if (!e.alive && !e._deathHandled) {
    e._deathHandled = true;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    Effects.fireParticleBurst(cx, cy, 7);          // engine path — plain sparkle burst
    Effects.spawnDeathSparkle(cx, cy, Math.max(e.w, e.h)); // sprite-sized burst
    coins.dropCoins(e.coinDrop, cx, cy);      // coin drop per config
    world.remove(e);                          // drop from play
    // Telemetry: count the kill by type (design §4.1 enemiesKilled).
    hero.runStats.enemiesKilled[e.type] = (hero.runStats.enemiesKilled[e.type] ?? 0) + 1;
    if (Debug.enabled) Debug.logEvent(`kill ${e.type}`);
  }
}

/**
 * Resolve the current active attack hitbox for a real enemy, or null when no
 * damage should be dealt this frame. Each type stores its own getter name; the
 * jester uses whipHitboxWorld, the vine hound lungeHitboxWorld, violetta
 * meleeHitboxWorld. Boris Loon has no melee hitbox (it attacks via dive/contact
 * + projectile).
 * @param {Enemy} e
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
function getAttackHitbox(e) {
  if (e.whipHitboxWorld != null) return e.whipHitboxWorld;       // jester
  if (e.lungeHitboxWorld != null) return e.lungeHitboxWorld;     // vine hound
  if (e.meleeHitboxWorld != null) return e.meleeHitboxWorld;     // violetta
  return null;
}

/**
 * Advance every real enemy this step. Called from update() in place of the old
 * single-jester call.
 * @param {number} dt seconds
 */
function updateRealEnemies(dt) {
  for (const e of realEnemies) {
    if (e === undefined || e === null) continue;
    updateRealEnemy(e, dt);
  }
}

// --- Boss (Overgrown Elephant) -----------------------------------
// Drives the boss's phase machine, camera lock, stomp screen-shake, and the
// win-state transition on death. The boss is tracked separately from
// realEnemies so its custom AI (phase-based, not aggro-based) runs here.

/**
 * Per-frame boss step: activate the fight when the hero approaches, run the
 * phase AI + physics, resolve against solids, trigger the stomp shake, and
 * handle the death → win pipeline.
 * @param {number} dt seconds
 */
function updateBoss(dt) {
  const b = boss;
  if (!b) return;

  // Decay the contact cooldown (shared with the 'contact' rule handler).
  if (b._contactCd > 0) b._contactCd -= dt;

  // Activate the fight once the hero is close enough (latches on).
  if (b.aiState !== 'dead') {
    const wasActive = b.active;
    b.shouldActivate(hero);
    if (b.active && !wasActive) {
      // First activation: lock the camera to the arena.
      camera.lockTo(b.arenaX, b.arenaW);
      // checkpoints.md §1/§3: the boss zone is a separate zone that starts
      // beside the boss checkpoint and receives the SHARED area-entry screen,
      // identified as the level's boss area (the last checkpoint of the
      // level's checkpoint definitions). The player confirms the screen to
      // begin the encounter (lifecycle.md §2).
      //
      // The boss zone lies BEYOND the last ordinary flag — it is not the area
      // reached by the flag at index (length-1). showAreaEntry() formats the
      // id from (currentArea - 1), so currentArea must be checkpoints.length
      // to map onto the level's boss area (formatAreaId: area >=
      // checkpoints.length - 1 → '1-B'). Setting it one past the last flag
      // keeps the -1 offset uniform with the ordinary-flag path.
      hero.currentArea = LEVEL_DEF.checkpoints.length; // boss zone (beyond last flag)
      // checkpoints.md §1: the boss zone restarts beside the boss checkpoint
      // (the last flag of the level). Set the respawn point BEFORE showing the
      // entry screen so confirming it (startLife → hero.respawn()) lands the
      // hero here, not at the previous ordinary flag.
      const bossCp = checkpoints[checkpoints.length - 1];
      if (bossCp) hero.checkpoint = { x: bossCp.x, y: bossCp.y };
      showAreaEntry(hero, areaContext);
      console.log('[boss] fight started — camera locked to arena, boss-zone entry screen shown');
    }
  }

  // AI + gravity + integrate (base Enemy.update handles the death pipeline too).
  b.update(dt, hero, world);

  // Keep the boss inside the arena horizontally while alive & active.
  if (b.alive && b.aiState !== 'dead' && b.active) {
    const minX = b.arenaX;
    const maxX = b.arenaX + b.arenaW - b.w;
    if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx); }
    else if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx); }
  }

  // Resolve against solids so the boss rests on the floor (it has gravity 1).
  if (b.alive && b.aiState !== 'dead' && b.gravity > 0) {
    resolve(b, SOLIDS);
  }

  // Stomp shake: doStomp() records a magnitude; convert it into a screen shake.
  if (b.shakeMag > 0) {
    Effects.triggerShake(b.shakeMag); // engine path — stomp shake
    b.shakeMag = 0;
  }

  // Death pipeline completion: spawn effects, drop coins, remove from world,
  // unlock the camera, and transition to WIN exactly once.
  if (!b.alive && !b._deathHandled) {
    b._deathHandled = true;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    Effects.fireParticleBurst(cx, cy, 14);        // engine path — big victory sparkle burst
    coins.dropCoins(b.coinDrop, cx, cy);       // generous coin bounty
    world.remove(b);                           // drop from play
    camera.unlock();                           // release the arena lock
    b.onDeath();                               // boss-side death hook
    // mark boss as killed (design §4.1).
    hero.runStats.bossKilled = true;
    if (getState() === S.PLAY) {
      tryTransition(S.WIN);
      console.log(`[state] PLAY → ${STATE_NAMES[S.WIN]} (boss defeated)`);
    }
  }
}

// Advance particle + coin pools (called each frame regardless of jester state).
function updateEffects(dt) {
  Effects.update(dt); // decay vignette / screen flash timers
  particles.updateAll(dt);
  // Coins bounce off the floor AND any air platform top they land on. We pass
  // the SOLIDS list minus the floor itself (the floor is handled by floorTop).
  const platforms = SOLIDS.slice(1); // index 0 is the full-length floor
  coins.updateAll(dt, FLOOR_TOP, LEVEL_LENGTH, platforms);
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
      hero.runStats.hitsTaken.explosion += 1;
      hero.runStats.hitsTaken.total += 1;
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
  world.remove(barrel);
  // Telemetry: count the destroyed barrel by type (design §4.1 barrelsDestroyed).
  const bkey = barrel.type; // 'woodBarrel' | 'barrel' | 'coinBarrel'
  hero.runStats.barrelsDestroyed[bkey] = (hero.runStats.barrelsDestroyed[bkey] ?? 0) + 1;
  if (Debug.enabled) Debug.logEvent(`barrel destroyed (${bkey})`);
}

/** Keep the collision world's coin set in sync with the pool. */
function syncCoinsToWorld() {
  const live = coins.activeItems;
  for (const e of world.entities) {
    if (e.layer === LAYER.COIN && !live.includes(e)) world.remove(e);
  }
  for (const c of live) {
    if (!world.entities.has(c)) world.add(c);
  }
}

/** Cull thorns that have flown past the level bounds (lifetime cull is in update). */
function cullOffScreen(items) {
  for (const p of items) {
    if (p.x + p.w < 0 || p.x > LEVEL_LENGTH || p.y + p.h < -40 || p.y > VIEW_H + 40) {
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
  for (const e of world.entities) {
    if (e.friendly && (e.layer === LAYER.PROJ_ALLY || e.layer === LAYER.PROJ_FOE) && !live.includes(e)) {
      world.remove(e);
    }
  }
  // Add any live thorn not yet registered.
  for (const p of live) {
    if (!world.entities.has(p)) world.add(p);
  }
}




/** Sync live specials into the collision world (same pattern as projectiles). */
function syncSpecialsToWorld() {
  const live = specialPool.activeItems;
  for (const e of world.entities) {
    if (e.type === 'saw' || e.type === 'bomb') {
      if (!live.includes(e)) world.remove(e);
    }
  }
  for (const s of live) {
    if (!world.entities.has(s)) world.add(s);
  }
}
