// Petal Panic — update system (fixed 60Hz physics step).
// Task 1.3 integration test: a hero-colored box moved by arrow keys / WASD,
// colliding against static orange SOLID platforms via CollisionWorld + resolve().
// F3 toggles the debug overlay (collision boxes) in render.js.
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
import { projectilePool, aimFromInput, dirAngle } from '../projectile.js';
import { damage } from '../damage.js';
import { S, getState, STATE_NAMES, tryTransition } from '../state.js';
import { Jester } from '../jester.js';
import { particles, coins } from '../particles.js';
import { makeBarrel, makeCoinBarrel, explodeBarrel, BARREL_DAMAGE, GameObj } from '../object.js';
import { COIN_TYPES } from '../coin.js';

// --- Tunables for the test rig ---------------------------------------------
// (Hero movement feel lives in js/hero.js; level geometry below.)

// Level length: intentionally wider than the 960px viewport so the camera
// can scroll. Floor spans the full length; air platforms are scattered along it.
export const LEVEL_LENGTH = 3000;

// --- Static solid platforms (orange) ----------------------------------------
// Plain AABBs; also wrapped as layer entities so the debug overlay can draw
// them and the mask rules are exercised end-to-end.
export const SOLIDS = [
  { x: 0,    y: VIEW_H - 40, w: LEVEL_LENGTH, h: 40 },   // floor (full length)
  { x: 180,  y: 380, w: 200, h: 24 },                    // low left platform
  { x: 560,  y: 300, w: 220, h: 24 },                    // mid right platform
  { x: 360,  y: 200, w: 160, h: 24 },                    // high center platform
  { x: 900,  y: 360, w: 240, h: 24 },                    // further-right platform
  { x: 1400, y: 300, w: 200, h: 24 },                    // mid platform
  { x: 1900, y: 360, w: 260, h: 24 },                    // far platform
  { x: 2400, y: 280, w: 200, h: 24 },                    // near-end platform
];

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
// js/hero.js. Spawn on the floor: y = floorTop - hero.h.
const FLOOR_TOP = VIEW_H - 40;
const hero = new Hero(HEROES.scarlet, 80, FLOOR_TOP - HEROES.scarlet.h);

// Task 3.1 — thorn fire state. Cooldown is in seconds; rapid powerup halves it.
// (Hero.stats.projectile_freq is "shots per second", so base interval = 1/freq.)
hero.fireCooldown = 0;
// Combat telemetry (Task 3.1). Kept off hero.stats because that object is a
// flat spread of the heroDef stat sheet (speed/jump/attack/...); these counters
// are runtime bookkeeping, not tunable feel knobs.
hero.combatStats = {
  projectilesShot: 0,
  hitsLanded: { projectile: 0, melee: 0 },
  damageDealt: { byMethod: { projectile: 0, melee: 0 } },
};

// Task 4.2 — coin collection stats (design §14). Per-type counters + total;
// the total drives the 1up threshold (every 100 coins → +1 life).
hero.stats.coinsCollected = { bronze: 0, silver: 0, gold: 0, total: 0 };

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

// --- Placeholder non-hero entities (debug-color exercise only) ---------------
// These exist purely so every §16 overlay color is visible on screen. They are
// static (gravity 0) and do NOT participate in collision resolution this task;
// real enemy/projectile/powerup behavior lands in later tasks.
// Task 3.1 — three red target boxes (HP = 20) that friendly thorns can destroy.
// These stand in for real enemies: same ENEMY layer + HP, but no death pipeline
// yet (that lands in Task 3.3). When hp drops to <= 0 they are culled here.
const FLOOR_TOP_ENEMY = VIEW_H - 40; // floor top; targets sit on the floor
const TARGET_HP = 20;
const enemies = [
  new Entity({ x: 700,  y: FLOOR_TOP_ENEMY - 40, w: 36, h: 40, gravity: 0, layer: LAYER.ENEMY, debugColor: '#e74c3c' }),
  new Entity({ x: 1500, y: FLOOR_TOP_ENEMY - 40, w: 36, h: 40, gravity: 0, layer: LAYER.ENEMY, debugColor: '#e74c3c' }),
  new Entity({ x: 2500, y: FLOOR_TOP_ENEMY - 40, w: 36, h: 40, gravity: 0, layer: LAYER.ENEMY, debugColor: '#e74c3c' }),
];
for (const e of enemies) {
  e.hp = TARGET_HP;
  e.maxHp = TARGET_HP;
  e.type = 'target';      // telemetry bucket (damage().byEnemy)
  e.hitFlash = 0;         // white-flash timer when struck (Task 3.2)
}

// Task 3.3 — real Jester enemy replacing one of the placeholder targets.
// The jester has full AI (idle/chase/whip), contact damage, and a death
// pipeline (shrink → fade → sparkle burst → coin drop).
const jester = new Jester(1100, FLOOR_TOP_ENEMY - 48);

// Task 2.1 — Non-looping anim test. Kept off the live targets (above) so the
// animation cycle doesn't obscure their destruction; attached to a separate
// decorative placeholder that never takes damage.
const animTestEnemy = new Entity({ x: 1150, y: FLOOR_TOP_ENEMY - 40, w: 36, h: 40, gravity: 0, layer: LAYER.ENEMY, debugColor: '#9b59b6' });
animTestEnemy.anim = new Anim(
  ['#e74c3c', '#f39c12', '#9b59b6'].map(c => makeTestFrame(36, 40, c)),
  { speed: 400, loop: false },
);
const projectiles = [
  new Entity({ x: 1100, y: 320, w: 16, h: 10, gravity: 0, layer: LAYER.PROJ_ALLY, debugColor: '#ff6ec7' }),
  new Entity({ x: 1800, y: 300, w: 16, h: 10, gravity: 0, layer: LAYER.PROJ_FOE,  debugColor: '#ff6ec7' }),
];
const pickups = [
  new Entity({ x: 1200, y: VIEW_H - 40 - 28, w: 24, h: 24, gravity: 0, layer: LAYER.PICKUP, debugColor: '#3498db' }),
  new Entity({ x: 2000, y: VIEW_H - 40 - 28, w: 24, h: 24, gravity: 0, layer: LAYER.PICKUP, debugColor: '#3498db' }),
];

// Task 4.1 — Destructible solid barrels (design §10 "Object").
// Barrels are SOLID (block hero + enemy) but carry an HP pool; melee/thorns/bombs
// chip that HP and it only explodes when HP hits 0. Placed along the floor so the
// hero has to shoot around/through them. One coin barrel sits nearby as a coin
// source (no damaging explosion).
const BARREL_FLOOR_TOP = VIEW_H - 40; // sit on the floor
const barrels = [
  makeBarrel(600,  BARREL_FLOOR_TOP - 48),   // just right of spawn area
  makeBarrel(1350, BARREL_FLOOR_TOP - 48),   // near the jester
  makeBarrel(2100, BARREL_FLOOR_TOP - 48),   // mid-level cover
  makeCoinBarrel(2700, BARREL_FLOOR_TOP - 48), // coin source near the end
];

// --- Input -------------------------------------------------------------------
const keys = new Set();

// State-machine test driver (skeleton): Enter walks HOME→SELECT→PLAY.
// Milestone 8 replaces this with per-screen input handling.
function handleStateKeys(e) {
  if (e.code !== 'Enter') return;
  const s = getState();
  let target = null;
  if (s === S.HOME)   target = S.SELECT;
  else if (s === S.SELECT) target = S.PLAY;
  if (target !== null && tryTransition(target)) {
    console.log(`[state] ${STATE_NAMES[s]} → ${STATE_NAMES[target]}`);
  }
}

window.addEventListener('keydown', (e) => {
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS','Space','KeyG','KeyJ'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'F3') { e.preventDefault(); setDebugEnabled(!isDebugEnabled()); }
  handleStateKeys(e);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

/** Build the per-frame intent object from the live key set. */
function readInput() {
  return {
    left:   keys.has('ArrowLeft') || keys.has('KeyA'),
    right:  keys.has('ArrowRight') || keys.has('KeyD'),
    up:     keys.has('ArrowUp') || keys.has('KeyW'),
    down:   keys.has('ArrowDown') || keys.has('KeyS'),
    jump:   keys.has('ArrowUp') || keys.has('KeyW') || keys.has('Space'),
    shoot:  keys.has('KeyG'),
    special: false,
    melee:  keys.has('KeyJ'),
  };
}

// --- Debug overlay state (F3) -------------------------------------------------
let debugEnabled = false;
export function isDebugEnabled() { return debugEnabled; }
export function setDebugEnabled(v) { debugEnabled = v; }

// --- Collision world -----------------------------------------------------------
const world = new CollisionWorld({ cellSize: 64 });
for (const s of solidEntities) world.add(s);
world.add(hero);
// Live targets + the decorative anim-test box participate in collisions so
// thorns can hit them (the anim box has no hp, so it's damage-immune).
for (const e of enemies) world.add(e);
world.add(animTestEnemy);
// Task 3.3 — jester participates in collisions (thorn hits, contact damage).
world.add(jester);
// Task 4.1 — barrels are SOLID: they block hero + enemy (resolve) and can be
// hit by friendly thorns (PROJ_ALLY×SOLID → 'hit'). Added now; destroyed ones
// are removed from the world when their HP hits 0.
for (const b of barrels) world.add(b);

// Rule-action handlers — the declarative dispatch path. For this task we only
// need to observe events; damage/pickup logic arrives with later tasks.
world.on('resolve', () => {}); // positional correction handled separately below

// Task 3.1 — friendly thorns hit ENEMY/BOSS (PROJ_ALLY rule). Apply damage and
// cull the projectile on impact. This is the ONLY place a PROJ_ALLY can interact
// with an enemy; there is no PROJ_ALLY↔HERO rule, so friendly-fire stays off.
world.on('hit', (a, b) => {
  const proj = a.layer === LAYER.PROJ_ALLY ? a : (b.layer === LAYER.PROJ_ALLY ? b : null);
  if (!proj || !proj.friendly) return; // only handle hero thorns here
  const target = proj === a ? b : a;

  // Task 4.1 — friendly thorn hits a barrel (SOLID with an HP pool). Chip its
  // HP; on destruction the barrel explodes (AoE + VFX) and is removed from the
  // world. Thorns are consumed on impact either way.
  if (target instanceof GameObj) {
    const dealt = target.hit(proj.damage, hero, 'projectile');
    if (dealt > 0) {
      proj.alive = false;
      if (target.destroyed) handleBarrelDestroyed(target);
    } else {
      proj.alive = false; // hit an already-destroyed solid — still consumed
    }
    return;
  }

  if (target.layer !== LAYER.ENEMY && target.layer !== LAYER.BOSS) return;
  if (target.hp == null) return;       // non-target placeholder (e.g. anim test box)
  // Central damage routing: defense + telemetry in one place (Task 3.2).
  const dealt = damage(hero, target, proj.damage, 'projectile');
  if (dealt > 0) target.hitFlash = 0.1; // brief white flash on impact
  proj.alive = false;                   // thorn is consumed on impact
  // Task 3.3 — Enemy instances trigger their death pipeline via die().
  // damage() already set alive=false when hp<=0; we call die() to start the
  // shrink/fade sequence and restore alive=true so the anim plays.
  // The entity is removed from the world when the anim completes (in updateJester).
  if (typeof target.die === 'function' && target.hp <= 0 && target.aiState !== 'dead') {
    target.die();
    target.alive = true; // keep alive during death anim
  } else if (!target.alive) {
    // Placeholder targets (plain Entity, no death pipeline): remove immediately.
    world.remove(target);
  }
});

// Task 3.3 — ENEMY × HERO contact damage (jester body touching hero drains energy).
// The COLLISION_RULES table has {a:HERO, b:ENEMY, action:'contact'}; this fires
// when the hero overlaps an enemy's body box. We drain the hero's energy via
// central damage() (enemy as source, hero as target). A per-enemy cooldown
// prevents multi-hit drain every frame while overlapping.
const CONTACT_COOLDOWN = 0.5; // seconds between contact hits from same enemy
world.on('contact', (a, b) => {
  const enemyEnt = a.layer === LAYER.ENEMY ? a : (b.layer === LAYER.ENEMY ? b : null);
  const heroEnt = a.layer === LAYER.HERO ? a : (b.layer === LAYER.HERO ? b : null);
  if (!enemyEnt || !heroEnt) return;
  if (!enemyEnt.alive || enemyEnt.aiState === 'dead') return; // dead enemies don't hurt
  if (enemyEnt._contactCd > 0) return;
  enemyEnt._contactCd = CONTACT_COOLDOWN;
  const amt = enemyEnt.stats?.attack ?? 10;
  damage(enemyEnt, heroEnt, amt, 'contact');
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
  heroEnt.stats.coinsCollected[type] = (heroEnt.stats.coinsCollected[type] ?? 0) + 1;
  heroEnt.stats.coinsCollected.total += 1;

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

  // 1up check: every ONEUP_THRESHOLD total coins grants +1 life.
  oneUpProgress += 1;
  if (oneUpProgress >= ONEUP_THRESHOLD) {
    oneUpProgress -= ONEUP_THRESHOLD;
    heroEnt.lives += 1;
    // SFX: 1up
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
// Task 2.1 — decorative anim-test box (damage-immune placeholder).
export function getAnimTestEnemy() { return animTestEnemy; }
// Task 3.1 — live thorns come from the shared pool (pooled, no allocation).
export function getProjectiles() { return projectilePool.activeItems; }
export function getPickups() { return pickups; }
export function getCamera() { return camera; }
// Task 3.3 — jester + particle/coin pools for render.
export function getJester() { return jester; }
export function getParticles() { return particles; }
export function getCoins() { return coins; }
// Task 4.1 — barrels + explosion screen shake for render.
export function getBarrels() { return barrels; }

// --- Per-frame step ------------------------------------------------------------
export function update(dt) {
  // Physics only runs during PLAY; other states are screen-driven (Milestone 8).
  if (getState() !== S.PLAY) return;

  // 1. input → intents (movement/jump/crouch logic lives in Hero.update).
  const input = readInput();
  hero.update(dt, input);

  // 1b. thorn shooting (Task 3.1): G key fires 8-way projectiles from the pool.
  tryFire(hero, input, dt);

  // 1c. melee swing (Task 3.2): J starts a swing; during its single active
  //     frame the hero's hitbox is checked against enemies and routed through
  //     central damage(). The cooldown lives on the hero (updateMelee).
  if (input.melee) hero.tryMelee();
  applyMeleeDamage(hero, dt);

  // 1d. decay hit-flash timers on enemies (white flash when struck).
  for (const e of enemies) {
    if (e.hitFlash > 0) e.hitFlash -= dt;
  }

  // 1d2. Task 4.1 — tick live barrels (decays their hit-flash timer).
  for (const b of barrels) {
    if (b.alive) b.update(dt);
  }

  // 1e. Task 3.3 — Jester AI + physics + whip damage + death pipeline.
  updateJester(dt);

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

  // 3. collide: positional correction against solids (no pass-through),
  //    then broadphase/narrowphase rule dispatch.
  const hit = resolve(hero, SOLIDS);
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

  // 5. Task 4.1 — decay the explosion screen shake (render reads getShakeOffset()).
  updateShake(dt);
}

/**
 * Grounded = resting on a solid's top surface. Combines the last resolve()
 * result (pushed down onto a floor this frame) with a small epsilon contact
 * probe so the flag stays true while standing still.
 */
function isGrounded(hit) {
  if (hit && hit.axis === 'y' && hit.dir === 1) return true; // landed on a surface
  const wb = hero.worldBox();
  for (const s of SOLIDS) {
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

// --- Melee attack (Task 3.2) -------------------------------------------------
// J key starts a swing (hero.tryMelee). During the single ACTIVE frame of the
// swing, the hero's meleeHitboxWorld is checked against every live enemy; on
// overlap we route through central damage(). Each enemy can only be hit once
// per swing (tracked in _meleeHitSet), so a multi-enemy overlap still deals
// exactly one hit each. The cooldown prevents spamming.

/**
 * Check the hero's active melee hitbox against all enemies this step.
 * Only produces damage when the swing is on its active frame.
 * @param {Hero} h the swinging hero
 * @param {number} dt seconds (unused here but kept for symmetry)
 */
function applyMeleeDamage(h, _dt) {
  const hb = h.meleeHitboxWorld;
  if (!hb) return; // not on the active frame — no damage window

  // Reset the per-swing hit set at the start of the active frame.
  if (!h._meleeHitSet || h.meleeFrame < h.MELEE_ACTIVE_FRAME + 0.5) {
    h._meleeHitSet = new Set();
  }

  for (const e of enemies) {
    if (!e.alive) continue;
    if (h._meleeHitSet.has(e)) continue; // already struck this swing
    const eb = e.worldBox();
    // AABB overlap test
    if (hb.x < eb.x + eb.w && hb.x + hb.w > eb.x &&
        hb.y < eb.y + eb.h && hb.y + hb.h > eb.y) {
      const dealt = damage(h, e, h.stats.attack, 'melee');
      if (dealt > 0) {
        e.hitFlash = 0.1; // brief white flash
        h._meleeHitSet.add(e);
        if (!e.alive) world.remove(e); // destroyed — drop from play
      }
    }
  }

  // Task 3.3 — melee also hits the jester (Enemy instance with takeDamage).
  if (jester.alive && !h._meleeHitSet.has(jester)) {
    const jb = jester.worldBox();
    if (hb.x < jb.x + jb.w && hb.x + hb.w > jb.x &&
        hb.y < jb.y + jb.h && hb.y + hb.h > jb.y) {
      const dealt = jester.takeDamage(h.stats.attack, h, 'melee');
      if (dealt > 0) {
        h._meleeHitSet.add(jester);
        if (!jester.alive) {
          // Death pipeline completed (shouldn't happen instantly, but guard).
          world.remove(jester);
        }
      }
    }
  }

  // Task 4.1 — melee chips barrel HP (a swing breaks a barrel over several hits;
  // it does NOT break on touch). Each barrel is struck at most once per swing.
  for (const b of barrels) {
    if (!b.alive || b.destroyed) continue;
    if (h._meleeHitSet.has(b)) continue;
    const bb = b.worldBox();
    if (hb.x < bb.x + bb.w && hb.x + hb.w > bb.x &&
        hb.y < bb.y + bb.h && hb.y + hb.h > bb.y) {
      const dealt = b.hit(h.stats.attack, h, 'melee');
      if (dealt > 0) {
        h._meleeHitSet.add(b);
        if (b.destroyed) handleBarrelDestroyed(b);
      }
    }
  }
}

// --- Jester update (Task 3.3) -------------------------------------------------
// Drives the jester's AI state machine, physics integration, whip damage check,
// solid collision, and death pipeline (sparkle burst + coin drop on full death).

/**
 * Per-frame jester step. Called from update() after hero movement.
 * @param {number} dt seconds
 */
function updateJester(dt) {
  // Decay contact cooldown.
  if (jester._contactCd > 0) jester._contactCd -= dt;

  // AI + gravity + integrate (base Enemy.update handles all of this).
  jester.update(dt, hero, world);

  // Resolve against solids so the jester doesn't walk through platforms.
  if (jester.alive && jester.aiState !== 'dead') {
    resolve(jester, SOLIDS);
  }

  // Whip damage check: if the whip hitbox overlaps the hero, deal damage.
  // Only one hit per whip swing (tracked via _whipHitDone flag).
  const whipHb = jester.whipHitboxWorld;
  if (whipHb && !jester._whipHitDone) {
    const hb = hero.worldBox();
    if (aabbOverlap(whipHb, hb)) {
      const dealt = damage(jester, hero, jester.stats.attack, 'melee');
      if (dealt > 0) {
        jester._whipHitDone = true; // one hit per whip
        hero.invincibleTimer = Math.max(hero.invincibleTimer, 0.3); // brief i-frames
      }
    }
  }
  // Reset the whip-hit flag when the whip ends.
  if (!jester.whipActive) jester._whipHitDone = false;

  // Death pipeline completion: when alive flips to false after the anim,
  // spawn sparkles + coins and remove from the collision world.
  if (!jester.alive && !jester._deathHandled) {
    jester._deathHandled = true;
    const cx = jester.x + jester.w / 2;
    const cy = jester.y + jester.h / 2;
    // Sparkle burst (6-8 particles, sprite-sized).
    particles.spawnBurst(cx, cy, 7);
    // Coin drop based on coinDrop config.
    coins.dropCoins(jester.coinDrop, cx, cy);
    // Remove from collision world.
    world.remove(jester);
  }
}

// Advance particle + coin pools (called each frame regardless of jester state).
function updateEffects(dt) {
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
    const targets = [hero, ...enemies, jester];
    const result = explodeBarrel(barrel, targets);
    // Explosion VFX: 12–15 orange/red particles expanding outward.
    spawnExplosionVFX(cx, cy, result.radius);
    triggerShake(8);
    // SFX: explosion
  } else {
    // Coin barrel: no damaging explosion, just a mixed-type coin burst
    // (design §10/§14). Mostly bronze, some silver, rare gold — each with a
    // random upward+sideways velocity for a fountain effect.
    coins.burstCoins(cx, cy, 5); // 4–6 mixed coins (clamped inside burstCoins)
    // Small pop burst (reuse sparkle emitter).
    particles.spawnBurst(cx, cy, 6);
    // SFX: coin
  }

  // Remove the dead barrel from the collision world so it stops blocking.
  world.remove(barrel);
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
