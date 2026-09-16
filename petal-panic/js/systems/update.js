// Petal Panic — update system (fixed 60Hz physics step).
// Task 1.3 integration test: a hero-colored box moved by arrow keys / WASD,
// colliding against static orange SOLID platforms via CollisionWorld + resolve().
// Debug mode toggles the unified debug overlay in render.js.
// Task 1.4: hero-following camera clamped to level bounds with facing
// look-ahead; the test level is now longer than the viewport so the camera
// scrolls, and placeholder enemies/projectiles/pickups exercise every §16
// debug-overlay color.

import { VIEW_W, VIEW_H } from '../view.js';
import { Entity } from '../entity.js';
import { LAYER } from '../consts.js';
import { CollisionWorld, resolve, aabbOverlap } from '../collision.js';
import { Camera } from '../camera.js';
import { Anim, makeTestFrame } from '../anim.js';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';
import { projectilePool, specialPool, aimFromInput, dirAngle } from '../projectile.js';
import { damage } from '../damage.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../hitbox.js';
import { S, getState, STATE_NAMES, tryTransition, onTransition } from '../state.js';
import { screenOnKey, screenOnKeyUp, screenReset } from '../screens.js';
import { Jester } from '../jester.js';
import { VineHound, VINE_HOUND_DEF } from '../vine_hound.js';
import { Violetta, VIOLETTA_DEF } from '../violetta.js';
import { JackOLantern, explodeJackolantern } from '../jackolantern.js';
import { BorisLoon, BORIS_DEF, makeBorisBaby } from '../boris_loon.js';
import { Elephant, makeElephant, BOSS_TRIGGER_RADIUS, WEAK_POINT_MULT } from '../boss.js';import { particles, coins } from '../particles.js';
import { Effects } from '../effects.js';
import { makeBarrel, makeCoinBarrel, explodeBarrel, BARREL_DAMAGE, GameObj, Checkpoint, makeCheckpoint } from '../object.js';
import { Powerup, POWERUP_DEFS, POWERUP_TYPES } from '../powerup.js';
import { COIN_TYPES } from '../coin.js';
import { LEVELS, generateLevel } from '../level.js';
import { Debug, initSpawnTable, SPAWN_KEYS } from '../debug.js';
import { createStats, dumpStats } from '../stats.js';

// --- Tunables for the test rig ---------------------------------------------
// (Hero movement feel lives in js/hero.js; level geometry below.)

// Task 5.2 — continue cost in coins (design §1/§14: 1000 coins per continue).
export const CONTINUE_COST = 1000;

// Task 5.3 — Level struct + rogue spawner (design §13). The declarative level
// definition (LEVELS[0] "Big Top") drives all world content: platforms,
// checkpoints, and every spawnable item. generateLevel() randomly places the
// spawnables along flat ground with min spacing; the hero-start zone (first
// 500px) and boss arena (last 500px) stay clear.
const LEVEL_DEF = LEVELS[0];
const generated = generateLevel(LEVEL_DEF);

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

// --- Hero (Task 2.2) ---------------------------------------------------------
// Real Hero wrapping the Scarlet Vale definition; run/jump/crouch/slide,
// gravity, ground friction, facing+mirrorX, and crouch-box shrink all live in
// js/hero.js. Spawn on the floor at x=100 (per design §13 hero start).
const FLOOR_TOP = SOLIDS[0].y; // ground top (first platform is the full-length floor)
const HERO_START_X = 100;
let hero = new Hero(HEROES.scarlet, HERO_START_X, FLOOR_TOP - HEROES.scarlet.h);
/** Rebind the module-level hero reference (used by debug hero-swap). */
function setHeroRef(h) { hero = h; }

// Task 3.1 — thorn fire state. Cooldown is in seconds; rapid powerup halves it.
// (Hero.stats.projectile_freq is "shots per second", so base interval = 1/freq.)
hero.fireCooldown = 0;

// Task 7.3 — Unified run telemetry (design §4.1). A single stats object tracks
// every documented field: kills, damage, coins, hits taken, time, distance, etc.
// It replaces the earlier scattered ad-hoc counters with one coherent structure.
// hero.combatStats is aliased to point INTO runStats so that damage.js and
// powerup.js (which write to hero.combatStats) update the unified object directly.
hero.runStats = createStats();
// Alias combatStats fields into runStats so existing code paths (damage.js,
// powerup.js) write into the unified structure without modification.
hero.combatStats = {
  get projectilesShot() { return hero.runStats.projectilesShot; },
  set projectilesShot(v) { hero.runStats.projectilesShot = v; },
  hitsLanded: hero.runStats.hitsLanded,
  damageDealt: hero.runStats.damageDealt,
  powerupsCollected: hero.runStats.powerupsCollected,
};

// Task 4.2 — coin collection stats (design §14). Per-type counters + total;
// the total drives the 1up threshold (every 100 coins → +1 life).
// Now lives in hero.runStats.coinsCollected (Task 7.3 unified stats).

// Task 2.1 — Animation engine integration test.
// Generate 5 colored frames as offscreen canvases; cycle them on the hero.
const heroFrames = ['#2ecc71', '#27ae60', '#1abc9c', '#16a085', '#3498db'];
hero.anim = new Anim(
  heroFrames.map(c => makeTestFrame(hero.w, hero.h, c)),
  { speed: 200, loop: true },
);

// Task 3.2 — Melee attack animation (5 placeholder frames).
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
// Task 3.1 — three red target boxes (HP = 20) that friendly thorns can destroy.
// These stand in for real enemies: same ENEMY layer + HP, but no death pipeline
// yet (that lands in Task 3.3). When hp drops to <= 0 they are culled here.
const FLOOR_TOP_ENEMY = SOLIDS[0].y; // floor top
// Legacy placeholder targets removed — real enemies (realEnemies) handle all combat.
// Kept as empty array so existing code paths (melee, collision, damage) don't break.
const enemies = [];

// Task 5.3 — Real enemies come from generateLevel(LEVELS[0]). The rogue spawner
// randomly places each type along flat ground with min spacing; flyers hover at
// their resting altitude, grounders sit on the floor. Every documented AI
// (jester/vine_hound/violetta/jackolantern/boris_loon/boris_loon_baby) is
// instantiated per the level's spawn budget.
const realEnemies = generated.enemies;

// Task 6.1 — Overgrown Elephant boss (design §9). Spawned at the far end of the
// level in the boss arena (last 500px stay clear of regular spawns). The camera
// locks to its arena once the hero gets within BOSS_TRIGGER_RADIUS; defeating it
// transitions to S.WIN. Tracked separately from realEnemies so the generic
// enemy loop never drives the boss's phase machine.
export const boss = makeElephant(LEVEL_LENGTH - 300, FLOOR_TOP);

// Task 2.1 — Non-looping anim test. Kept off the live targets (above) so the
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

// Task 4.1 — Destructible solid barrels (design §10 "Object").
// Barrels are SOLID (block hero + enemy) but carry an HP pool; melee/thorns/bombs
// chip that HP and it only explodes when HP hits 0. Placed along the floor so the
// hero has to shoot around/through them. Coin barrels sit nearby as a coin source
// (no damaging explosion). Task 5.3 — positions now come from generateLevel().
const barrels = generated.barrels;
const woodBarrels = generated.woodBarrels ?? [];
const coinBarrels = generated.coinBarrels;

// Task 4.1 — dynamic SOLID registry: world boxes of every LIVE barrel.
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

// Task 4.3 — Powerups (design §10). Scattered along the level by the rogue
// spawner with min spacing. Each sits on the floor (bob animation lifts it
// visually). The 'clear' powerup is placed wherever the spawner rolls it.
export const powerups = generated.powerups;

// Task 4.3 — Checkpoints (design §10/§13): four flags at x = 2000/4000/6000/7500
// with ids '1-1' … '1-4'. Touching one stores its position on hero.checkpoint
// for death-restart. They are NOT solids — they don't block movement.
export const checkpoints = generated.checkpoints;

// --- Floating text (Task 4.3 VFX) -------------------------------------------
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
const keys = new Set();

// State-machine input (Milestone 8 / Task 8.2): HOME/SELECT/OVER/PAUSE/WIN are
// all delegated to screens.js; update.js injects the game-reset closures
// (retry/continue/quit) so that logic stays here. Esc/P toggles pause during
// PLAY.
function handleStateKeys(e) {
  const s = getState();

  // --- Home & Select screens handle their own keys (Milestone 8) ------------
  if (s === S.HOME || s === S.SELECT) {
    screenOnKey(e.code, undefined, undefined, e.repeat);
    return;
  }

  // --- Pause toggle while playing (design §20: Esc or P enters/exits) -------
  if (s === S.PLAY && (e.code === 'Escape' || e.code === 'KeyP')) {
    if (tryTransition(S.PAUSE)) console.log('[state] PLAY → PAUSE');
    return;
  }

  // --- Game Over / Pause / Win options (Task 8.2) ----------------------------
  // The screens own key interpretation; we supply the level-reset actions.
  if (s === S.OVER || s === S.PAUSE || s === S.WIN) {
    const hero = getHero();
    const quit = () => {
      if (tryTransition(S.HOME)) {
        console.log(`[state] ${STATE_NAMES[s]} → ${STATE_NAMES[S.HOME]} (quit)`);
      }
    };
    const actions = {
      retry: () => retryFromGameOver(),   // OVER + PAUSE: restart at level start
      cont: () => continueFromGameOver(), // OVER: spend coins, respawn at checkpoint
      playAgain: () => {                  // WIN: back to hero select
        if (tryTransition(S.SELECT)) console.log('[state] WIN → SELECT (play again)');
      },
      quit,
    };
    screenOnKey(e.code, hero, actions);
  }
}

/**
 * Task 5.2 — Retry from game over: restart at the first checkpoint (1-1) or
 * level start, full energy, lives reset to 3, continues reset. Checkpoints do
 * NOT persist across a retry (design §1).
 */
export function retryFromGameOver() {
  const cp = checkpoints.length ? checkpoints[0] : null;
  hero.x = cp ? cp.x : 80;
  hero.y = cp ? cp.y : (VIEW_H - 40 - hero.h);
  hero.vx = 0;
  hero.vy = 0;
  hero.energy = hero.maxEnergy;
  hero.lives = 3;
  hero.dying = false;
  hero.deathTimer = 0;
  hero.alive = true;
  hero.invincibleTimer = Hero.RESPAWN_IFRAMES;
  hero.continuesUsed = 0;
  hero.checkpoint = { x: hero.x, y: hero.y };
  Effects.reset(); // Task 7.1 — clear any stale vignette/flash between runs
  // Reset checkpoint flags so they can re-trigger on the new run.
  for (const c of checkpoints) c.triggered = false;
  if (tryTransition(S.PLAY)) {
    console.log('[state] OVER → PLAY (retry)');
  }
}

/**
 * Task 5.2 — Continue from game over: costs CONTINUE_COST coins, limited to
 * hero.maxContinues per run. Restores at the last checkpoint with full energy
 * and one life. Returns true if the continue was applied.
 */
export function continueFromGameOver() {
  if (hero.continuesUsed >= hero.maxContinues) {
    console.log('[gameover] no continues left');
    return false;
  }
  if (hero.coins < CONTINUE_COST) {
    console.log(`[gameover] not enough coins (${hero.coins}/${CONTINUE_COST})`);
    return false;
  }
  hero.coins -= CONTINUE_COST;
  hero.continuesUsed += 1;
  hero.lives = 1;
  hero.respawn(); // restores at hero.checkpoint with full energy + i-frames
  if (tryTransition(S.PLAY)) {
    console.log(`[state] OVER → PLAY (continue #${hero.continuesUsed})`);
  }
  return true;
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
    Debug.logEvent(`${source}: debug OFF`);
  }
}

window.addEventListener('keydown', (e) => {
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS','Space','KeyG','KeyH','KeyJ','KeyB'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'F1' || e.code === 'F3') {
    handleDebugToggle(e, 'debug');
    return;
  }
  handleDebugKeys(e); // no-op unless Debug.enabled
  handleStateKeys(e);
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); screenOnKeyUp(e.code); });
window.addEventListener('blur', () => { keys.clear(); screenOnKeyUp('ArrowLeft'); screenOnKeyUp('ArrowRight'); });

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

/** Build the per-frame intent object from the live key set. */
function readInput() {
  return {
    left:   keys.has('ArrowLeft') || keys.has('KeyA'),
    right:  keys.has('ArrowRight') || keys.has('KeyD'),
    up:     keys.has('ArrowUp') || keys.has('KeyW'),
    down:   keys.has('ArrowDown') || keys.has('KeyS'),
    jump:   keys.has('ArrowUp') || keys.has('KeyW') || keys.has('Space'),
    shoot:  keys.has('KeyG'),
    special: keys.has('KeyH'),
    melee:  keys.has('KeyJ'),
    super:  keys.has('KeyB'),
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
    case 'KeyY': // Hero swap Scarlet <-> Balthazhar
      swapHero();
      break;
    case 'KeyL': // Toggle event-log display
      Debug.showLog = !Debug.showLog;
      break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
      // Anim scrubber: step the selected entity's anim frames.
      scrubSelectedAnim(e.code);
      break;
    case 'KeyX': // Deselect current entity
      if (Debug.selected) { Debug.selected = null; Debug.logEvent('deselect'); }
      break;
    case 'KeyE': // Dump stats JSON to disk
      dumpStats(hero.runStats, hero);
      Debug.logEvent('stats JSON downloaded');
      break;
    case 'KeyC': // Cycle collision view mode (round-robin): sprite+collision → collision-only → sprite-only
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
    checkpoint: hero.checkpoint, continuesUsed: hero.continuesUsed,
    stats: hero.stats,
    runStats: hero.runStats, // Task 7.3 — preserve unified telemetry
    invincibleTimer: hero.invincibleTimer, rapidTimer: hero.rapidTimer,
  };

  const nh = new Hero(def, saved.x, saved.y);
  Object.assign(nh, saved);
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

/** Per-frame god-mode enforcement: invincible + infinite ammo. */
function applyGodMode(dt) {
  if (!Debug.god) return;
  hero.invincibleTimer = Math.max(hero.invincibleTimer, 999);
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
// Task 5.1 — remaining enemies participate in collisions (thorn hits, contact,
// foe projectiles). Flyers use gravity 0 so they never fall; grounders do not.
for (const e of realEnemies) world.add(e);
// Task 6.1 — boss participates in collisions (PROJ_ALLY×BOSS → 'hit',
// HERO×BOSS → contact). Added after the regular enemies.
world.add(boss);
// Task 4.1 — barrels are SOLID: they block hero + enemy (resolve) and can be
// hit by friendly thorns (PROJ_ALLY×SOLID → 'hit'). Added now; destroyed ones
// are removed from the world when their HP hits 0. Both explosive barrels AND
// coin barrels participate (coin barrels just skip the damaging AoE on death).
for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) world.add(b);
// Task 4.3 — powerups (PICKUP layer; HERO×PICKUP → 'pickup') and checkpoints
// (CHECKPOINT layer; HERO×CHECKPOINT → 'checkpoint'). Both are non-solid.
for (const p of powerups) world.add(p);
for (const c of checkpoints) world.add(c);

// Rule-action handlers — the declarative dispatch path. For this task we only
// need to observe events; damage/pickup logic arrives with later tasks.
world.on('resolve', () => {}); // positional correction happens via the resolve()
                                // calls below (SOLIDS + barrelSolidBoxes)

// Task 3.1 — friendly thorns hit ENEMY/BOSS (PROJ_ALLY rule). Apply damage and
// cull the projectile on impact. This is the ONLY place a PROJ_ALLY can interact
// with an enemy; there is no PROJ_ALLY↔HERO rule, so friendly-fire stays off.
world.on('hit', (a, b) => {
  // --- Friendly thorns (hero → enemy/barrel) --------------------------------
  const allyProj = a.layer === LAYER.PROJ_ALLY ? a : (b.layer === LAYER.PROJ_ALLY ? b : null);
  if (allyProj && allyProj.friendly) {
    const target = allyProj === a ? b : a;

    // Task 4.1 — friendly thorn hits a barrel (SOLID with an HP pool). Chip its
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
    // Task 6.1 — boss weak point: thorns landing in the head/trunk zone deal
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
    // Central damage routing: defense + telemetry in one place (Task 3.2).
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
      // Task 7.1 — red hit sparkles at the impact point + enemy shake
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

  // --- Foe projectiles (enemy → hero), Task 5.1 -----------------------------
  // Violetta's shots and Boris Loon's dive-shots are unfriendly (PROJ_FOE). They
  // only ever hit the hero (PROJ_FOE×HERO rule); there is no PROJ_FOE↔ENEMY rule
  // so they can't self-damage. Route through central damage() and consume the
  // shot on impact. Respects the hero's invincibility window.
  const foeProj = a.layer === LAYER.PROJ_FOE ? a : (b.layer === LAYER.PROJ_FOE ? b : null);
  if (foeProj && !foeProj.friendly) {
    const victim = foeProj === a ? b : a;
    if (victim.layer !== LAYER.HERO) return;
    // Task 5.2 — a hero mid-death takes no further damage (skull is playing).
    if (victim.dying) { foeProj.alive = false; return; }
    if (victim.invincibleTimer > 0) { foeProj.alive = false; return; } // i-frames absorb it
    const dealt = damage(foeProj, victim, foeProj.damage, 'projectile');
    if (dealt > 0) {
      // Knockback along the projectile's travel direction + hit-stun + i-frames.
      victim.takeHit({
        dirX: foeProj.vx, dirY: foeProj.vy,
        strength: 220,
        recovery: 0.25,
        invincible: 0.30,
      });
      // Task 7.1 — red vignette when the hero takes damage (design §12).
      Effects.heroDamaged();
      // Task 7.3 — track hits taken from enemy projectiles (design §4.1).
      victim.runStats.hitsTaken.enemyProjectile += 1;
      victim.runStats.hitsTaken.total += 1;
    }
    foeProj.alive = false; // consumed on impact
    // SFX: hit
  }
});

// Task 3.3 — ENEMY × HERO contact damage (jester body touching hero drains energy).
// The COLLISION_RULES table has {a:HERO, b:ENEMY, action:'contact'}; this fires
// when the hero overlaps an enemy's body box. We drain the hero's energy via
// central damage() (enemy as source, hero as target). A per-enemy cooldown
// prevents multi-hit drain every frame while overlapping.
const CONTACT_COOLDOWN = 0.5; // seconds between contact hits from same enemy
world.on('contact', (a, b) => {
  // Task 6.1 — the boss is a BOSS-layer entity; treat it like an enemy for
  // contact damage (touching the elephant drains hero energy at its high attack).
  const enemyEnt = a.layer === LAYER.ENEMY ? a : (b.layer === LAYER.ENEMY ? b : null);
  const bossEnt = a.layer === LAYER.BOSS ? a : (b.layer === LAYER.BOSS ? b : null);
  const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
  const source = enemyEnt || bossEnt;
  if (!source || !heroEnt) return;
  // Task 5.2 — no contact damage while the hero is mid-death.
  if (heroEnt.dying) return;
  if (!source.alive || source.aiState === 'dead') return; // dead enemies don't hurt
  // i-frames absorb contact hits (prevents melt while overlapping). takeHit()
  // returns false when invincible, so we skip damage + cooldown in that case.
  if (heroEnt.intangible) return;
  if (heroEnt.timers.get('inv') > 0) return;
  if (source._contactCd > 0) return;
  source._contactCd = CONTACT_COOLDOWN;
  const amt = source.stats?.attack ?? 10;
  const dealt = damage(source, heroEnt, amt, 'contact');
  // Knockback + hit-stun + i-frames: shove the hero away from the attacker's
  // center with a small upward pop. Bosses fling harder than regular enemies.
  if (dealt > 0) {
    const hcx = heroEnt.x + heroEnt.w / 2, scx = source.x + source.w / 2;
    const dirX = Math.sign(hcx - scx) || (heroEnt.facing * -1);
    const isBoss = source.layer === LAYER.BOSS;
    heroEnt.takeHit({
      dirX, dirY: -0.6,
      strength: isBoss ? 340 : 260,
      recovery: isBoss ? 0.30 : 0.25,
      invincible: isBoss ? 0.70 : 0.60,
    });
    // Task 7.1 — red vignette on contact damage (design §12 "Hero damaged").
    Effects.heroDamaged();
    // Task 7.3 — track hits taken from enemy contact (design §4.1).
    heroEnt.runStats.hitsTaken.enemyContact += 1;
    heroEnt.runStats.hitsTaken.total += 1;
  }
});

// Task 4.2 — HERO × COIN collection (design §14). Fires when the hero's box
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
  particles.spawnBurst(cx, cy, 4);
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

// Task 4.3 — HERO × PICKUP powerup collection (design §10). Fires when the
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
  particles.spawnBurst(cx, cy, 6);
  Effects.spawnPickupPop(cx, cy, pu.def.color); // Task 7.1 — colored pop ring
  spawnFloatText(cx, cy - 16, pu.def.label, pu.def.color);
  // SFX: powerup
  if (Debug.enabled) Debug.logEvent(`powerup ${pu.def.label}`);

  world.remove(pu);
});

// Task 4.3 — HERO × CHECKPOINT trigger (design §10/§13). Fires when the hero's
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

  // Task 7.3 — count checkpoint hits (design §4.1).
  heroEnt.runStats.checkpointsHit += 1;

  // VFX: flash (entity-driven) + floating id label.
  const cx = cp.x + cp.w / 2;
  const cy = cp.y + cp.h / 2;
  particles.spawnBurst(cx, cy, 5);
  spawnFloatText(cx, cy - 20, `CHECKPOINT ${cp.checkpointId}`, '#ffd700');
  // SFX: checkpoint
});

// --- Task 7.3 — Stats dump on WIN / GAMEOVER ----------------------------------
// Subscribe to state transitions; when the run ends (WIN or OVER), serialize
// the full §4.1 telemetry to console + downloadable JSON. This is the "tuning
// pass" hook: every completed run produces a structured record for analysis.
// Stats dump is manual: press E in debug mode to download the JSON.
// No longer auto-triggers on WIN/OVER.

// Reset per-screen transient state (held keys, focus) on entry.
onTransition((from, to) => { screenReset(to); });

// Milestone 8 — When SELECT → PLAY, rebuild the hero with the chosen definition.
// The Select screen sets window.__selectedHero before calling tryTransition(S.PLAY).
onTransition((from, to) => {
  if (to === S.PLAY && from !== S.PAUSE) {
    // Covers: SELECT→PLAY, HOME→PLAY (debug boot), OVER→PLAY, WIN→PLAY.
    // PAUSE→PLAY is a resume — hero state is already correct.
    const heroId = window.__selectedHero || 'scarlet';
    const def = HEROES[heroId] || HEROES.scarlet;
    // Rebuild hero in place with the new definition.
    const saved = {
      x: hero.x, y: hero.y, vx: 0, vy: 0,
      energy: def.stats.stamina, lives: 3, coins: 0,
      ammo: 200, specialAmmo: 0,
      checkpoint: { x: hero.x, y: hero.y }, continuesUsed: 0,
    };
    const nh = new Hero(def, saved.x, saved.y);
    Object.assign(nh, saved);
    nh.energy = def.stats.stamina;
    nh.maxEnergy = def.stats.stamina;
    nh.checkpoint = { x: saved.x, y: saved.y };
    nh.invincibleTimer = 0;
    nh.dying = false;
    nh.deathTimer = 0;
    nh.continuesUsed = 0;
    // Fresh run stats.
    nh.runStats = createStats();
    nh.combatStats = {
      get projectilesShot() { return nh.runStats.projectilesShot; },
      set projectilesShot(v) { nh.runStats.projectilesShot = v; },
      hitsLanded: nh.runStats.hitsLanded,
      damageDealt: nh.runStats.damageDealt,
      powerupsCollected: nh.runStats.powerupsCollected,
    };
    // Placeholder anims sized for the new body.
    nh.anim = new Anim(
      ['#2ecc71', '#27ae60', '#1abc9c'].map(c => makeTestFrame(nh.w, nh.h, c)),
      { speed: 200, loop: true },
    );
    nh.anims.attack = new Anim(
      ['#555555', '#888888', '#aaaaaa', '#ffffff', '#666666'].map(c => makeTestFrame(nh.w, nh.h, c)),
      { speed: 80, loop: false },
    );
    // Swap in collision world + rebind reference.
    world.remove(hero);
    world.add(nh);
    setHeroRef(nh);
    Effects.reset();
    console.log(`[screens] hero instantiated: ${def.name} (${heroId})`);
  }
});

// --- Camera --------------------------------------------------------------------
// Hero-following cam clamped to [0, LEVEL_LENGTH - VIEW_W] with facing look-ahead.
export const camera = new Camera();
camera.levelLength = LEVEL_LENGTH;

// Task 4.1 — brief screen shake on barrel explosions (optional juice). A decaying
// magnitude in px; render.js offsets the world by a random vector within it.
let shakeMag = 0;
const SHAKE_DURATION = 0.25; // seconds the shake lasts after being triggered
let shakeTimer = 0;
let shakeOffset = { x: 0, y: 0 };
/** Trigger a screen shake of `mag` px for SHAKE_DURATION seconds. */
function triggerShake(mag) {
  shakeMag = Math.max(shakeMag, mag);
  shakeTimer = SHAKE_DURATION;
}
/** Per-frame decay; recomputes and returns the current random offset {x,y}. */
function updateShake(dt) {
  if (shakeTimer > 0) shakeTimer -= dt;
  if (shakeTimer <= 0 || shakeMag <= 0) {
    shakeMag = 0;
    shakeOffset.x = 0;
    shakeOffset.y = 0;
    return shakeOffset;
  }
  const m = shakeMag * (shakeTimer / SHAKE_DURATION); // ease out
  shakeOffset.x = (Math.random() * 2 - 1) * m;
  shakeOffset.y = (Math.random() * 2 - 1) * m;
  return shakeOffset;
}
export function getShakeOffset() { return shakeOffset; }

export function getHero() { return hero; }
export function getSolids() { return SOLIDS; }
export function getCollisionWorld() { return world; }
export function getEnemies() { return enemies; }
// Task 4.3 — all live enemy entities (placeholder targets + jester) used by
// the 'clear' powerup effect. Excludes dead/dead-animating enemies.
export function getLiveEnemies() {
  const out = [];
  for (const e of enemies) if (e.alive !== false) out.push(e);
  for (const e of realEnemies) {
    if (e.alive !== false && e.aiState !== 'dead') out.push(e);
  }
  return out;
}
// Task 2.1 — decorative anim-test box (damage-immune placeholder).
export function getAnimTestEnemy() { return animTestEnemy; }
// Task 3.1 — live thorns come from the shared pool (pooled, no allocation).
export function getProjectiles() { return projectilePool.activeItems; }
export function getSpecials() { return specialPool.activeItems; }
export function getPickups() { return pickups; }
export function getCamera() { return camera; }
// Task 5.3 — full real-enemy list (from generateLevel) for render/debug.
export function getRealEnemies() { return realEnemies; }
// Task 6.1 — the boss entity for render + debug.
export function getBoss() { return boss; }
export function getParticles() { return particles; }
export function getCoins() { return coins; }
// Task 4.1 + 5.3 — barrels (explosive + coin) + explosion screen shake for render.
export function getBarrels() { return [...barrels, ...woodBarrels, ...coinBarrels]; }
export function getCoinBarrels() { return coinBarrels; }
// Task 4.3 — powerups, checkpoints, floating text for render + debug.
export function getPowerups() { return powerups; }
export function getCheckpoints() { return checkpoints; }
export function getFloatTexts() { return floatTexts; }

// --- Per-frame step ------------------------------------------------------------
export function update(dt) {
  // Physics only runs during PLAY; other states are screen-driven (Milestone 8).
  if (getState() !== S.PLAY) return;

  // --- Debug harness: time scaling + god mode. Zero cost when off. -----------
  if (Debug.enabled) {
    applyGodMode(dt);
    dt *= Debug.timeScale; // slow-mo / freeze-frame (0 = physics paused, render continues)
    if (dt <= 0) { Effects.update(0); return; } // frozen: skip all physics this step
  }

  // 1. input → intents (movement/jump/crouch logic lives in Hero.update).
  const input = readInput();
  hero.update(dt, input);

  // 1a. Task 5.2 — energy / death / respawn / gameover flow.
  //     Trigger: if energy hit 0 (and no death already running) start the
  //     skull-fade sequence. While dying we skip all gameplay below (no input,
  //     no shooting, no melee) so the corpse plays out cleanly; on completion
  //     we either respawn at the checkpoint or transition to GAME OVER.
  //     God mode: energy is clamped AFTER all damage this frame has been
  //     applied, so the death check never sees 0.
  if (Debug.god) {
    hero.energy = Math.max(hero.energy, 1);
  }
  if (!hero.dying && hero.energy <= 0) {
    hero.die();
  }
  if (hero.dying) {
    hero.deathTimer += dt;
    if (hero.deathTimer >= hero.DEATH_DURATION) {
      finishHeroDeath();
    }
    // Camera still tracks (frozen) hero + decay shake so the fade reads well.
    camera.update(hero);
    updateShake(dt);
    return;
  }

  // 1b. thorn shooting (Task 3.1): G key fires 8-way projectiles from the pool.
  tryFire(hero, input, dt);
  trySpecial(hero, input, dt);

  // 1c. melee swing (Task 3.2): J starts a swing; during its single active
  //     frame the hero's hitbox is checked against enemies and routed through
  //     central damage(). The cooldown lives on the hero (updateMelee).
  if (input.melee) {
    const wasActive = hero.meleeActive;
    hero.tryMelee();
    if (!wasActive && hero.meleeActive) {
      hero.runStats.meleeSwings += 1; // Task 7.3 — count the swing start
    }
  }
  processAllHitboxes();

  // 1d. decay hit-flash timers on enemies (white flash when struck).
  for (const e of enemies) {
    if (e.hitFlash > 0) e.hitFlash -= dt;
  }

  // 1d2. Task 4.1 — tick live barrels (decays their hit-flash timer).
  for (const b of [...barrels, ...woodBarrels, ...coinBarrels]) {
    if (b.alive) b.update(dt);
  }

  // 1d3. Task 4.3 — tick powerups (bob anim), checkpoints (flash decay), and
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

  // 1e. Task 3.3 + 5.1 — real-enemy AI + physics + attack damage + death pipeline.
  updateRealEnemies(dt);

  // 1e2. Task 6.1 — boss: camera lock, phase machine, stomp shake, win on death.
  updateBoss(dt);

  // 1f. Task 3.3 — particle + coin pool advancement.
  updateEffects(dt);

  // 2b. advance animations for any entity that has one attached.
  // (Hero.update already ticks its own anim; tick the decorative anim-test box.)
  if (animTestEnemy.anim) animTestEnemy.anim.tick(dt);

  // 2c. thorn integration (Task 3.1): advance the pool, cull off-screen shots,
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
  const hit = resolve(hero, [...SOLIDS, ...barrelSolidBoxes]);
  world.update();

  // Grounded: derive from the last resolved axis + a surface-contact probe so
  // the hero can jump again immediately after landing.
  hero.setGrounded(isGrounded(hit));

  // Keep the hero inside the LEVEL horizontally (test-rig convenience).
  const wb = hero.worldBox();
  if (wb.x < 0) { hero.x = -hero.box.ox; hero.vx = 0; }
  else if (wb.x + wb.w > LEVEL_LENGTH) { hero.x = LEVEL_LENGTH - hero.box.ox - hero.box.bw; hero.vx = 0; }

  // 4. camera follows the hero (clamped to level bounds, facing look-ahead).
  camera.update(hero);

  // 4b. Task 7.3 — track run distance + time for stats (design §4.1).
  hero.runStats.distanceTraveled += Math.abs(hero.vx * dt);
  hero.runStats.timePlayed += dt;

  // 5. Task 4.1 — decay the explosion screen shake (render reads getShakeOffset()).
  updateShake(dt);

  // 6. Task 7.1 — decay screen-space effect timers (vignette / flash).
  Effects.update(dt);
}

/**
 * Task 5.2 — called when the skull-fade death sequence completes. Consumes a
 * life; if any remain, respawn at the last checkpoint with full energy + i-frames.
 * If no lives remain, transition to GAME OVER (the state machine then shows the
 * retry/continue/quit screen).
 */
function finishHeroDeath() {
  hero.lives -= 1;
  if (hero.lives > 0) {
    hero.respawn();
  } else {
    hero.dying = false; // stop the fade; the OVER overlay takes over
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
  // also covers the "standing on a barrel" case).
  for (const s of [...SOLIDS, ...barrelSolidBoxes]) {
    if (wb.x + wb.w <= s.x || wb.x >= s.x + s.w) continue;
    const gap = s.y - (wb.y + wb.h);
    if (gap >= -2 && gap <= 4 && hero.vy >= 0) return true;
  }
  return false;
}

// --- Thorn shooting (Task 3.1) -------------------------------------------------
// G key fires an 8-way thorn from the shared pool. The aim direction comes from
// the live WASD/arrow state (aimFromInput), falling back to the hero's facing
// when no directional input is held. Ammo is consumed per shot and fire is
// gated by a cooldown derived from stats.projectile_freq (halved during rapid).
// Friendly projectiles only ever hit ENEMY/BOSS via COLLISION_RULES, so they can
// never damage the hero — friendly-fire is off by construction.

/**
 * Attempt to fire one thorn this step. Mutates hero.fireCooldown / hero.ammo.
 * @param {Hero} h the firing hero
 * @param {object} input current intent (left/right/up/down/shoot)
 * @param {number} dt seconds
 */
function tryFire(h, input, dt) {
  if (h.fireCooldown > 0) h.fireCooldown -= dt;
  if (!input.shoot || h.fireCooldown > 0) return;
  if (h.ammo <= 0) return; // no ammo → cannot fire

  const dir = aimFromInput(input, h.facing);

  // Spawn at the hero's center, offset slightly toward the aim so the thorn
  // starts just outside the body (avoids same-frame self-overlap artifacts).
  const cx = h.x + h.w / 2;
  const cy = h.y + h.h / 2;
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

// --- Special attack (design §4): H key fires hero's unique weapon ------------
// Scarlet: fast saw blade (no gravity, short range). Balthazar: bomb (gravity,
// TTL fuse, AoE explosion on expiry). Consumes specialAmmo, gated by special_freq.
// The cooldown is a labeled timer on the HERO ('special') so it shows in the
// per-entity debug stack like every other countdown.
function trySpecial(h, input, dt) {
  if (!input.special) return;
  if (h.timers.get('special') > 0) return; // still cooling down
  if (h.specialAmmo <= 0) return;

  const type = h.stats.special; // 'saw' | 'bomb'
  const dir = aimFromInput(input, h.facing);
  const cx = h.x + h.w / 2;
  const cy = h.y + h.h / 2;
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
    spawnExplosionVFX(cx, cy, s.radius);
    Effects.bigExplosion();
    triggerShake(6);
    if (Debug.enabled) Debug.logEvent('bomb exploded');
  } else {
    // Saw: small fizzle spark, no AoE.
    particles.spawnBurst(cx, cy, 4);
  }
}

// --- Melee attack (Task 3.2) -------------------------------------------------
// J key starts a swing (hero.tryMelee). During the single ACTIVE frame of the
// swing, the hero's meleeHitboxWorld is checked against every live enemy; on
// overlap we route through central damage(). Each enemy can only be hit once
// per swing (tracked in _meleeHitSet), so a multi-enemy overlap still deals
// exactly one hit each. The cooldown prevents spamming.

// --- Unified hitbox system ---------------------------------------------------
// All attack hitboxes (hero melee, hero super, enemy whip/lunge/jab) register
// here each frame. One generic loop processes them via processHitboxes().

const _hitboxes = []; // registered hitbox instances (reused, not allocated per frame)

// Hero melee hitbox (ally team).
const _hbMelee = makeHitbox({ owner: null, team: 'ally', box: null, damage: 0, method: 'melee' });
_hitboxes.push(_hbMelee);

// Hero super dash hitbox (ally team).
const _hbSuper = makeHitbox({ owner: null, team: 'ally', box: null, damage: 0, method: 'super' });
_hitboxes.push(_hbSuper);

/**
 * Register active hitboxes for this frame and process them all in one pass.
 * Called once per update tick after all entities have integrated.
 */
function processAllHitboxes() {
  const h = hero;

  // --- Hero melee ---
  const mh = h.meleeHitboxWorld;
  if (mh) {
    _hbMelee.owner = h;
    _hbMelee.box = mh;
    _hbMelee.damage = h.stats.attack;
    _hbMelee.active = true;
    // Reset hit set at start of active frame.
    if (!h._meleeHitSet || h.meleeFrame < h.MELEE_ACTIVE_FRAME + 0.5) {
      resetHitbox(_hbMelee);
      h._meleeHitSet = _hbMelee.hitSet; // keep legacy ref working
    }
  } else {
    _hbMelee.active = false;
  }

  // --- Hero super dash ---
  const sh = h.superHitboxWorld;
  if (sh) {
    _hbSuper.owner = h;
    _hbSuper.box = sh;
    _hbSuper.damage = h.stats.attack * 2;
    _hbSuper.active = true;
  } else {
    _hbSuper.active = false;
  }

  // --- Enemy attack hitboxes (whip, lunge, jab) ---
  // Each real enemy exposes an attack hitbox getter. Register dynamically.
  for (const e of realEnemies) {
    if (!e.alive || e.aiState === 'dead') continue;
    const ehb = getEnemyAttackHitbox(e);
    if (!ehb) continue;
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
  // Deactivate enemy hitboxes that aren't attacking this frame.
  for (const e of realEnemies) {
    if (e._hitbox && !getEnemyAttackHitbox(e)) {
      e._hitbox.active = false;
      e._hitboxReset = false;
    }
  }

  // --- Process all against all targets ---
  const targets = [h, ...realEnemies, boss, ...barrels, ...woodBarrels, ...coinBarrels].filter(Boolean);
  processHitboxes(_hitboxes, targets, (hb, target, dealt) => {
    // VFX / juice on hit.
    if (target.layer === LAYER.HERO) {
      Effects.heroDamaged();
    } else {
      Effects.beginEnemyShake(target);
      if (target.hitFlash !== undefined) target.hitFlash = 0.1;
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

// --- Real-enemy update (Task 3.3 jester + Task 5.1 remaining AIs) ------------
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
  // (they fly over/through them by design).
  if (e.alive && e.aiState !== 'dead' && e.gravity > 0) {
    resolve(e, [...SOLIDS, ...barrelSolidBoxes]);
  }

  // Attack hitbox: now handled by the unified processAllHitboxes() system.
  // The old inline check is removed; enemy hitboxes register as team:'foe'
  // and the generic loop routes them against the hero.
  const atkHb = getAttackHitbox(e);
  if (!atkHb) e._atkHitDone = false; // reset when window closes (hitbox system uses its own hitSet)

  // Jack-O-Lantern explosion: when it detonates, run the AoE blast (same pattern
  // as a barrel) and spawn VFX. The explode() hook fires exactly once.
  if (e instanceof JackOLantern && e.exploded && !e._explodeHandled) {
    e._explodeHandled = true;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const targets = [hero, ...enemies, ...realEnemies];
    const result = explodeJackolantern(e, targets);
    spawnExplosionVFX(cx, cy, result.radius);
    Effects.bigExplosion(); // Task 7.1 — screen flash on big explosion
    triggerShake(6);
    // SFX: explosion
  }

  // Death pipeline completion: when alive flips to false after the anim,
  // spawn sparkles + coins and remove from the collision world.
  if (!e.alive && !e._deathHandled) {
    e._deathHandled = true;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    particles.spawnBurst(cx, cy, 7);          // sparkle burst (sprite-sized)
    Effects.spawnDeathSparkle(cx, cy, Math.max(e.w, e.h)); // Task 7.1 — sprite-sized burst
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

// --- Task 6.1 — Boss (Overgrown Elephant) -----------------------------------
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
      console.log('[boss] fight started — camera locked to arena');
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
    triggerShake(b.shakeMag);
    b.shakeMag = 0;
  }

  // Death pipeline completion: spawn effects, drop coins, remove from world,
  // unlock the camera, and transition to WIN exactly once.
  if (!b.alive && !b._deathHandled) {
    b._deathHandled = true;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    particles.spawnBurst(cx, cy, 14);          // big victory sparkle burst
    coins.dropCoins(b.coinDrop, cx, cy);       // generous coin bounty
    world.remove(b);                           // drop from play
    camera.unlock();                           // release the arena lock
    b.onDeath();                               // boss-side death hook
    // Task 7.3 — mark boss as killed (design §4.1).
    hero.runStats.bossKilled = true;
    if (getState() === S.PLAY) {
      tryTransition(S.WIN);
      console.log(`[state] PLAY → ${STATE_NAMES[S.WIN]} (boss defeated)`);
    }
  }
}

// Advance particle + coin pools (called each frame regardless of jester state).
function updateEffects(dt) {
  Effects.update(dt); // Task 7.1 — decay vignette / screen flash timers
  particles.updateAll(dt);
  // Coins bounce off the floor AND any air platform top they land on. We pass
  // the SOLIDS list minus the floor itself (the floor is handled by floorTop).
  const platforms = SOLIDS.slice(1); // index 0 is the full-length floor
  coins.updateAll(dt, FLOOR_TOP, LEVEL_LENGTH, platforms);
  // Sync coins into the collision world so HERO×COIN collect works.
  syncCoinsToWorld();
}

// --- Task 4.1 — Barrel destruction / explosion ---------------------------------
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

  if (barrel.explosive) {
    // AoE damage to every live entity in radius (enemies + hero). The pure
    // explodeBarrel() routes through central damage(); we pass the full live set.
    const targets = [hero, ...enemies, ...realEnemies];
    const result = explodeBarrel(barrel, targets);
    // Real enemies killed by the blast already ran their internal death pipeline
    // via takeDamage() inside explodeBarrel — no manual die() needed here.
    // Task 7.3 — track if the hero was hit by the explosion (design §4.1).
    if (result.hit.includes(hero)) {
      hero.runStats.hitsTaken.explosion += 1;
      hero.runStats.hitsTaken.total += 1;
      // Radial knockback away from the blast center + hit-stun + i-frames.
      const hcx = hero.x + hero.w / 2, hcy = hero.y + hero.h / 2;
      hero.takeHit({
        dirX: hcx - cx, dirY: hcy - cy,
        strength: 380,
        recovery: 0.30,
        invincible: 0.60,
      });
    }
    // Explosion VFX: 12–15 orange/red particles expanding outward.
    spawnExplosionVFX(cx, cy, result.radius);
    Effects.bigExplosion(); // Task 7.1 — brief white screen flash (design §12)
    triggerShake(8);
    // SFX: explosion
  } else if (barrel.coinDrop) {
    // Coin barrel (or any object with a coinDrop config): spawn the burst.
    coins.dropCoins(barrel.coinDrop, cx, cy);
    particles.spawnBurst(cx, cy, 6);
    // SFX: coin
  } else {
    // Wood barrel (plain): just breaks into wood-chip particles. No damage, no coins.
    particles.spawnBurst(cx, cy, 8);
    // SFX: break
  }

  // Remove the dead barrel from the collision world so it stops blocking.
  world.remove(barrel);
  // Telemetry: count the destroyed barrel by type (design §4.1 barrelsDestroyed).
  const bkey = barrel.type; // 'woodBarrel' | 'barrel' | 'coinBarrel'
  hero.runStats.barrelsDestroyed[bkey] = (hero.runStats.barrelsDestroyed[bkey] ?? 0) + 1;
  if (Debug.enabled) Debug.logEvent(`barrel destroyed (${bkey})`);
}

/**
 * Spawn an explosion visual: N orange/red particles flying outward from the
 * blast center. Reuses the pooled particle system; colors are warm (fire-like).
 * @param {number} cx blast center x
 * @param {number} cy blast center y
 * @param {number} radius explosion radius (scales the burst spread)
 */
function spawnExplosionVFX(cx, cy, radius) {
  const count = 12 + Math.floor(Math.random() * 4); // 12–15
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 120 + Math.random() * (radius * 1.5);
    const color = ['#e74c3c', '#f39c12', '#ff6ec7', '#ffffff'][i % 4];
    particles.spawnOne(cx, cy, color, speed, angle);
  }
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
