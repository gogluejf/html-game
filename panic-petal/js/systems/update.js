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
import { CollisionWorld, resolve } from '../collision.js';
import { Camera } from '../camera.js';
import { Anim, makeTestFrame } from '../anim.js';

// --- Tunables for the test rig ---------------------------------------------
const MOVE_SPEED = 240;          // px/s horizontal
const JUMP_VY = -520;            // jump impulse
const GRAVITY_SCALE = 1;         // uses consts.GRAVITY internally

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

// --- Hero test entity --------------------------------------------------------
const hero = new Entity({
  x: 80,
  y: VIEW_H - 40 - 48,
  w: 40,
  h: 48,
  vx: 0,
  vy: 0,
  gravity: GRAVITY_SCALE,
  facing: 1,
  layer: LAYER.HERO,
  debugColor: '#2ecc71',   // green per design §16 (hero boxes)
});

// Task 2.1 — Animation engine integration test.
// Generate 5 colored frames as offscreen canvases; cycle them on the hero.
const heroFrames = ['#2ecc71', '#27ae60', '#1abc9c', '#16a085', '#3498db'];
hero.anim = new Anim(
  heroFrames.map(c => makeTestFrame(40, 48, c)),
  { speed: 200, loop: true },
);

// --- Placeholder non-hero entities (debug-color exercise only) ---------------
// These exist purely so every §16 overlay color is visible on screen. They are
// static (gravity 0) and do NOT participate in collision resolution this task;
// real enemy/projectile/powerup behavior lands in later tasks.
const enemies = [
  new Entity({ x: 700,  y: VIEW_H - 40 - 40, w: 36, h: 40, gravity: 0, layer: LAYER.ENEMY,     debugColor: '#e74c3c' }),
  new Entity({ x: 1500, y: VIEW_H - 40 - 40, w: 36, h: 40, gravity: 0, layer: LAYER.ENEMY,     debugColor: '#e74c3c' }),
  new Entity({ x: 2500, y: VIEW_H - 40 - 40, w: 36, h: 40, gravity: 0, layer: LAYER.ENEMY,     debugColor: '#e74c3c' }),
];

// Task 2.1 — Non-looping anim test on the first enemy.
// 3 frames, plays once and stops (done=true). To replay, call anim.reset().
enemies[0].anim = new Anim(
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

// --- Input -------------------------------------------------------------------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (['ArrowLeft','ArrowRight','ArrowUp','KeyA','KeyD','KeyW','Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'F3') { e.preventDefault(); setDebugEnabled(!isDebugEnabled()); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

// --- Debug overlay state (F3) -------------------------------------------------
let debugEnabled = false;
export function isDebugEnabled() { return debugEnabled; }
export function setDebugEnabled(v) { debugEnabled = v; }

// --- Collision world -----------------------------------------------------------
const world = new CollisionWorld({ cellSize: 64 });
for (const s of solidEntities) world.add(s);
world.add(hero);

// Rule-action handlers — the declarative dispatch path. For this task we only
// need to observe events; damage/pickup logic arrives with later tasks.
world.on('resolve', () => {}); // positional correction handled separately below

// --- Camera --------------------------------------------------------------------
// Hero-following cam clamped to [0, LEVEL_LENGTH - VIEW_W] with facing look-ahead.
export const camera = new Camera();
camera.levelLength = LEVEL_LENGTH;

export function getHero() { return hero; }
export function getSolids() { return SOLIDS; }
export function getCollisionWorld() { return world; }
export function getEnemies() { return enemies; }
export function getProjectiles() { return projectiles; }
export function getPickups() { return pickups; }
export function getCamera() { return camera; }

// --- Per-frame step ------------------------------------------------------------
export function update(dt) {
  // 1. input → intents
  let moveX = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA'))  moveX -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) moveX += 1;
  hero.vx = moveX * MOVE_SPEED;
  if (moveX !== 0) { hero.facing = moveX; hero.syncMirror(); }

  if ((keys.has('ArrowUp') || keys.has('KeyW') || keys.has('Space')) && grounded()) {
    hero.vy = JUMP_VY;
  }

  // 2. integrate (gravity + velocity)
  hero.update(dt);

  // 2b. advance animations for any entity that has one attached.
  if (hero.anim) hero.anim.tick(dt);
  for (const e of enemies) if (e.anim) e.anim.tick(dt);

  // 3. collide: positional correction against solids (no pass-through),
  //    then broadphase/narrowphase rule dispatch.
  const hit = resolve(hero, SOLIDS);
  world.update();

  // Keep the hero inside the LEVEL horizontally (test-rig convenience).
  const wb = hero.worldBox();
  if (wb.x < 0) { hero.x = -hero.box.ox; hero.vx = 0; }
  else if (wb.x + wb.w > LEVEL_LENGTH) { hero.x = LEVEL_LENGTH - hero.box.ox - hero.box.bw; hero.vx = 0; }

  // 4. camera follows the hero (clamped to level bounds, facing look-ahead).
  camera.update(hero);
}

/** Grounded = resting on a solid's top surface (small epsilon tolerance). */
function grounded() {
  const wb = hero.worldBox();
  for (const s of SOLIDS) {
    if (wb.x + wb.w <= s.x || wb.x >= s.x + s.w) continue;
    const gap = s.y - (wb.y + wb.h);
    if (gap >= -2 && gap <= 4 && hero.vy >= 0) return true;
  }
  return false;
}
