// Petal Panic — update system (fixed 60Hz physics step).
// Task 1.3 integration test: a hero-colored box moved by arrow keys / WASD,
// colliding against static orange SOLID platforms via CollisionWorld + resolve().
// F3 toggles the debug overlay (collision boxes) in render.js.

import { VIEW_W, VIEW_H } from '../view.js';
import { Entity } from '../entity.js';
import { LAYER } from '../consts.js';
import { CollisionWorld, resolve } from '../collision.js';

// --- Tunables for the test rig ---------------------------------------------
const MOVE_SPEED = 240;          // px/s horizontal
const JUMP_VY = -520;            // jump impulse
const GRAVITY_SCALE = 1;         // uses consts.GRAVITY internally

// --- Static solid platforms (orange) ----------------------------------------
// Plain AABBs; also wrapped as layer entities so the debug overlay can draw
// them and the mask rules are exercised end-to-end.
export const SOLIDS = [
  { x: 0,    y: VIEW_H - 40, w: VIEW_W, h: 40 },   // floor
  { x: 180,  y: 380, w: 200, h: 24 },              // low left platform
  { x: 560,  y: 300, w: 220, h: 24 },              // mid right platform
  { x: 360,  y: 200, w: 160, h: 24 },              // high center platform
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

export function getHero() { return hero; }
export function getSolids() { return SOLIDS; }
export function getCollisionWorld() { return world; }

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

  // 3. collide: positional correction against solids (no pass-through),
  //    then broadphase/narrowphase rule dispatch.
  const hit = resolve(hero, SOLIDS);
  world.update();

  // Keep the hero inside the view horizontally (test-rig convenience).
  const wb = hero.worldBox();
  if (wb.x < 0) { hero.x = -hero.box.ox; hero.vx = 0; }
  else if (wb.x + wb.w > VIEW_W) { hero.x = VIEW_W - hero.box.ox - hero.box.bw; hero.vx = 0; }
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
