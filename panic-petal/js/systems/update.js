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
import { VINE_HOUND_DEF } from '../vine_hound.js';
import { VIOLETTA_DEF } from '../violetta.js';
import { JackOLantern, explodeJackolantern } from '../jackolantern.js';
import { Elephant, makeElephant, BOSS_TRIGGER_RADIUS, WEAK_POINT_MULT } from '../boss.js';import { particles, coins } from '../particles.js';
import { makeBarrel, makeCoinBarrel, explodeBarrel, BARREL_DAMAGE, GameObj, Checkpoint, makeCheckpoint } from '../object.js';
import { Powerup, POWERUP_DEFS, POWERUP_TYPES } from '../powerup.js';
import { COIN_TYPES } from '../coin.js';
import { LEVELS, generateLevel } from '../level.js';

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
const hero = new Hero(HEROES.scarlet, HERO_START_X, FLOOR_TOP - HEROES.scarlet.h);

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
const FLOOR_TOP_ENEMY = SOLIDS[0].y; // floor top; targets sit on the floor
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
// hero has to shoot around/through them. Coin barrels sit nearby as a coin source
// (no damaging explosion). Task 5.3 — positions now come from generateLevel().
const barrels = generated.barrels;
const coinBarrels = generated.coinBarrels;

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

// State-machine test driver (skeleton): Enter walks HOME→SELECT→PLAY.
// Task 5.2 — GAME OVER handles R (retry), C (continue), Q (quit).
// Milestone 8 replaces this with per-screen input handling.
function handleStateKeys(e) {
  const s = getState();

  // --- Game Over options (Task 5.2) -----------------------------------------
  if (s === S.OVER) {
    if (e.code === 'KeyR') {
      retryFromGameOver();
      return;
    }
    if (e.code === 'KeyC') {
      continueFromGameOver();
      return;
    }
    if (e.code === 'KeyQ') {
      if (tryTransition(S.HOME)) {
        console.log(`[state] ${STATE_NAMES[s]} → ${STATE_NAMES[S.HOME]} (quit)`);
      }
      return;
    }
    return;
  }

  if (e.code !== 'Enter') return;
  let target = null;
  if (s === S.HOME)   target = S.SELECT;
  else if (s === S.SELECT) target = S.PLAY;
  if (target !== null && tryTransition(target)) {
    console.log(`[state] ${STATE_NAMES[s]} → ${STATE_NAMES[target]}`);
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
for (const b of [...barrels, ...coinBarrels]) world.add(b);
// Task 4.3 — powerups (PICKUP layer; HERO×PICKUP → 'pickup') and checkpoints
// (CHECKPOINT layer; HERO×CHECKPOINT → 'checkpoint'). Both are non-solid.
for (const p of powerups) world.add(p);
for (const c of checkpoints) world.add(c);

// Rule-action handlers — the declarative dispatch path. For this task we only
// need to observe events; damage/pickup logic arrives with later tasks.
world.on('resolve', () => {}); // positional correction handled separately below

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
      const dealt = target.takeDamage(allyProj.damage, hero, 'projectile', { x: px, y: py });
      if (dealt > 0) target.hitFlash = 0.1;
      allyProj.alive = false;
      if (typeof target.die === 'function' && target.hp <= 0 && target.aiState !== 'dead') {
        target.die();
        target.alive = true; // keep alive during death anim
      }
      return;
    }
    // Central damage routing: defense + telemetry in one place (Task 3.2).
    const dealt = damage(hero, target, allyProj.damage, 'projectile');
    if (dealt > 0) target.hitFlash = 0.1; // brief white flash on impact
    allyProj.alive = false;               // thorn is consumed on impact
    // Task 3.3 — Enemy instances trigger their death pipeline via die().
    // damage() already set alive=false when hp<=0; we call die() to start the
    // shrink/fade sequence and restore alive=true so the anim plays.
    // The entity is removed from the world when the anim completes (in updateRealEnemies).
    if (typeof target.die === 'function' && target.hp <= 0 && target.aiState !== 'dead') {
      target.die();
      target.alive = true; // keep alive during death anim
    } else if (!target.alive) {
      // Placeholder targets (plain Entity, no death pipeline): remove immediately.
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
      victim.invincibleTimer = Math.max(victim.invincibleTimer, 0.3); // brief i-frames
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
  if (source._contactCd > 0) return;
  source._contactCd = CONTACT_COOLDOWN;
  const amt = source.stats?.attack ?? 10;
  damage(source, heroEnt, amt, 'contact');
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
  spawnFloatText(cx, cy - 16, pu.def.label, pu.def.color);
  // SFX: powerup

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

  // VFX: flash (entity-driven) + floating id label.
  const cx = cp.x + cp.w / 2;
  const cy = cp.y + cp.h / 2;
  particles.spawnBurst(cx, cy, 5);
  spawnFloatText(cx, cy - 20, `CHECKPOINT ${cp.checkpointId}`, '#ffd700');
  // SFX: checkpoint
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
export function getPickups() { return pickups; }
export function getCamera() { return camera; }
// Task 5.3 — full real-enemy list (from generateLevel) for render/F3.
export function getRealEnemies() { return realEnemies; }
// Task 6.1 — the boss entity for render + F3 debug.
export function getBoss() { return boss; }
export function getParticles() { return particles; }
export function getCoins() { return coins; }
// Task 4.1 + 5.3 — barrels (explosive + coin) + explosion screen shake for render.
export function getBarrels() { return [...barrels, ...coinBarrels]; }
export function getCoinBarrels() { return coinBarrels; }
// Task 4.3 — powerups, checkpoints, floating text for render + F3 debug.
export function getPowerups() { return powerups; }
export function getCheckpoints() { return checkpoints; }
export function getFloatTexts() { return floatTexts; }

// --- Per-frame step ------------------------------------------------------------
export function update(dt) {
  // Physics only runs during PLAY; other states are screen-driven (Milestone 8).
  if (getState() !== S.PLAY) return;

  // 1. input → intents (movement/jump/crouch logic lives in Hero.update).
  const input = readInput();
  hero.update(dt, input);

  // 1a. Task 5.2 — energy / death / respawn / gameover flow.
  //     Trigger: if energy hit 0 (and no death already running) start the
  //     skull-fade sequence. While dying we skip all gameplay below (no input,
  //     no shooting, no melee) so the corpse plays out cleanly; on completion
  //     we either respawn at the checkpoint or transition to GAME OVER.
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
  for (const b of [...barrels, ...coinBarrels]) {
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

  // 4b. Task 5.2 — track run distance for the game-over stats summary.
  if (hero.stats && hero.stats.distanceTraveled != null) {
    hero.stats.distanceTraveled += Math.abs(hero.vx * dt);
  }

  // 5. Task 4.1 — decay the explosion screen shake (render reads getShakeOffset()).
  updateShake(dt);
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

  // Task 3.3 + 5.1 — melee hits every real enemy (Enemy instances with takeDamage).
  for (const e of realEnemies) {
    if (!e.alive || e.aiState === 'dead') continue;
    if (h._meleeHitSet.has(e)) continue;
    const eb = e.worldBox();
    if (hb.x < eb.x + eb.w && hb.x + hb.w > eb.x &&
        hb.y < eb.y + eb.h && hb.y + hb.h > eb.y) {
      const dealt = e.takeDamage(h.stats.attack, h, 'melee');
      if (dealt > 0) {
        h._meleeHitSet.add(e);
        if (!e.alive) world.remove(e); // destroyed — drop from play
      }
    }
  }

  // Task 4.1 — melee chips barrel HP (a swing breaks a barrel over several hits;
  // it does NOT break on touch). Each barrel is struck at most once per swing.
  for (const b of [...barrels, ...coinBarrels]) {
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

  // Resolve against solids so grounders don't walk through platforms. Flyers
  // skip solid resolution (they fly over/through platforms by design).
  if (e.alive && e.aiState !== 'dead' && e.gravity > 0) {
    resolve(e, SOLIDS);
  }

  // Attack hitbox check: each type exposes an active-world hitbox getter that
  // returns null outside its damage window. On overlap we deal one hit per
  // swing/lunge/jab (tracked via _atkHitDone), then reset when the window ends.
  const atkHb = getAttackHitbox(e);
  if (atkHb && !e._atkHitDone) {
    const hb = hero.worldBox();
    // Task 5.2 — no melee damage while the hero is mid-death.
    if (!hero.dying && aabbOverlap(atkHb, hb)) {
      const dealt = damage(e, hero, e.stats.attack, 'melee');
      if (dealt > 0) {
        e._atkHitDone = true; // one hit per swing
        hero.invincibleTimer = Math.max(hero.invincibleTimer, 0.3); // brief i-frames
      }
    }
  }
  // Reset the hit flag once the attack window closes (hitbox back to null).
  if (!atkHb) e._atkHitDone = false;

  // Jack-O-Lantern explosion: when it detonates, run the AoE blast (same pattern
  // as a barrel) and spawn VFX. The explode() hook fires exactly once.
  if (e instanceof JackOLantern && e.exploded && !e._explodeHandled) {
    e._explodeHandled = true;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const targets = [hero, ...enemies, ...realEnemies];
    const result = explodeJackolantern(e, targets);
    spawnExplosionVFX(cx, cy, result.radius);
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
    coins.dropCoins(e.coinDrop, cx, cy);      // coin drop per config
    world.remove(e);                          // drop from play
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
    if (getState() === S.PLAY) {
      tryTransition(S.WIN);
      console.log(`[state] PLAY → ${STATE_NAMES[S.WIN]} (boss defeated)`);
    }
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
    const targets = [hero, ...enemies, ...realEnemies];
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
