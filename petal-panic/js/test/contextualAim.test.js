// Task 1.1 — Contextual Down: crouch vs downward aim resolution (design §4/§32).
// Run: node js/test/contextualAim.test.js
//
// Direct-intent style for the mechanic (hero.resolveAim / hero.update): plain
// intent objects, fixed dt = 1/60, no DOM key simulation. One small wiring
// section drives the real readInput → tryFire pipeline with stubbed DOM
// listeners to prove the resolved aim actually reaches the projectile spawn.

import { strict as assert } from 'node:assert';

// --- Minimal DOM stub (must run BEFORE importing update.js) --------------------
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, addEventListener: noop }),
  getElementById: () => null,
  addEventListener: noop,
};
const winHandlers = {};
globalThis.window = { devicePixelRatio: 1, innerWidth: 960, innerHeight: 540, __handlers: winHandlers, addEventListener: (ev, fn) => { (winHandlers[ev] ||= []).push(fn); } };
globalThis.Image = class {
  constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(v) { this._src = v; this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; }
};
globalThis.requestAnimationFrame = noop;
globalThis.performance = { now: () => Date.now() };

const HeroMod = await import('../hero.js');
const { HEROES } = await import('../heroDefs.js');
const { dirAngle, aimFromInput, DIR_RIGHT, DIR_LEFT, DIR_DOWN } = await import('../projectile.js');
const U = await import('../systems/update.js');
const { S, setState } = await import('../state.js');
const { input } = await import('../input.js');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const baseIntent = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, special: false, melee: false, lockMove: false, lockDir: false, super: false, aimX: 0, aimY: 0 });
const makeHero = () => new HeroMod.Hero(HEROES.scarlet, 0, 0);

console.log('resolveAim — grounded crouch (AC #1)');
ok('grounded + Down resolves horizontal toward facing, not down/diagonal', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = baseIntent(); inp.down = true;
  h.update(DT, inp); // enter crouch
  assert.ok(h.crouching, 'should be crouched');
  // Facing right: Down alone must NOT resolve to straight-down (6).
  assert.equal(h.resolveAim(inp), DIR_RIGHT, `facing right, got ${h.resolveAim(inp)}`);
  // Now hold Left too while crouched: still horizontal (toward facing), never a diagonal.
  inp.left = true; inp.aimX = -1; inp.aimY = 1;
  h.update(DT, inp);
  assert.ok(h.crouching, 'still crouched');
  assert.equal(h.resolveAim(inp), DIR_RIGHT, `crouched + left+down aim must stay horizontal toward facing, got ${h.resolveAim(inp)}`);
});

ok('crouched facing left resolves horizontal left', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = baseIntent(); inp.right = true;
  h.update(DT, inp); // face right first
  inp.right = false; inp.left = true;
  h.update(DT, inp); // face left
  assert.equal(h.facing, -1, 'should face left');
  inp.left = false; inp.down = true;
  h.update(DT, inp); // crouch while facing left
  assert.ok(h.crouching, 'should be crouched');
  assert.equal(h.resolveAim(inp), DIR_LEFT, `got ${h.resolveAim(inp)}`);
});

console.log('resolveAim — airborne (AC #3)');
ok('airborne + Down resolves straight down regardless of horizontal input', () => {
  const h = makeHero();
  h.setGrounded(false);
  h.vy = 0;
  let inp = baseIntent(); inp.down = true; inp.aimY = 1;
  assert.equal(h.resolveAim(inp), DIR_DOWN, `got ${h.resolveAim(inp)}`);
  inp.left = true; inp.aimX = -1; // holding a horizontal direction does not tilt it
  assert.equal(h.resolveAim(inp), DIR_DOWN, `airborne down must be straight down, got ${h.resolveAim(inp)}`);
});

ok('crouched hero who becomes airborne still holds Down → straight down (not horizontal)', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = baseIntent(); inp.down = true;
  h.update(DT, inp); // enter crouch while grounded
  assert.ok(h.crouching, 'should be crouched');
  assert.equal(h.resolveAim(inp), DIR_RIGHT, `grounded crouch is horizontal, got ${h.resolveAim(inp)}`);
  // Slide/fall off a ledge: now airborne with Down still held. The stale
  // crouch flag must NOT keep the aim horizontal (§4: airborne Down = down).
  h.setGrounded(false);
  h.vy = 50;
  assert.equal(h.resolveAim(inp), DIR_DOWN, `airborne crouch-flagged + Down must be straight down, got ${h.resolveAim(inp)}`);
});

console.log('resolveAim — lock direction (AC #6)');
ok('lockDir freezes the aim: frozen right + airborne Down keeps shooting right', () => {
  const h = makeHero();
  h.setGrounded(false);
  h.vy = 50;
  // Simulate Lock Direction engaged with a frozen rightward aim (input.js
  // overwrites aimX/aimY from the locked angle when s.lockDir is set).
  const inp = baseIntent();
  inp.lockDir = true;
  inp.aimX = 1; inp.aimY = 0;   // frozen aim: right
  inp.down = true;              // raw Down still held while airborne
  assert.equal(h.resolveAim(inp), DIR_RIGHT, `locked aim must win over contextual Down, got ${h.resolveAim(inp)}`);
  // Same rule while grounded-crouched: the frozen aim wins there too.
  const g = makeHero();
  g.setGrounded(true);
  const ginp = baseIntent();
  ginp.lockDir = true; ginp.aimX = 1; ginp.aimY = 0; ginp.down = true;
  assert.equal(g.resolveAim(ginp), DIR_RIGHT, `locked aim must beat the crouch rule, got ${g.resolveAim(ginp)}`);
});

// Real lock engagement through the input engine (design §5): Lock Direction
// captures the RESOLVED aim at the moment of engage — not the raw directional
// key. The gameplay layer installs hero.resolveAim as the resolver, so a
// grounded crouched hero pressing I while holding Down locks horizontal
// toward facing, never straight-down.
const { createInput } = await import('../input.js');
class Events {
  handlers = new Map();
  addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
  emit(name, event = {}) { for (const fn of this.handlers.get(name) || []) fn({ preventDefault() {}, ...event }); }
}
function inputFixture(hero) {
  const target = new Events(), document = new Events(), pads = []; const data = new Map();
  const storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  const engine = createInput({ target, document, getGamepads: () => pads, storage: () => storage });
  engine.setResolveAim((intent) => hero.resolveAim(intent));
  return { engine, target,
    down: code => target.emit('keydown', { code }), up: code => target.emit('keyup', { code }) };
}

ok('REAL engage: grounded crouch holding Down + I locks horizontal toward facing, NOT down (§5)', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = baseIntent(); inp.down = true;
  h.update(DT, inp); // enter crouch
  assert.ok(h.crouching, 'should be crouched');
  assert.equal(h.facing, 1, 'fresh hero faces right');
  const f = inputFixture(h);
  f.down('KeyS'); f.engine.poll({ facing: h.facing }); // hold Down (crouching)
  f.down('KeyI'); f.engine.poll({ facing: h.facing }); // engage Lock Direction
  const s = f.engine.state;
  assert.ok(s.lockDir, 'lockDir should be engaged');
  assert.ok(Math.abs(s.aimY) < 1e-9, `locked aim must be horizontal, got aimY=${s.aimY}`);
  assert.ok(s.aimX > 0.99, `locked aim must point toward facing (right), got aimX=${s.aimX}`);
  // Movement still follows the raw direction (Down kept held → moveY stays 1).
  assert.equal(s.moveY, 1, 'movement must keep following the raw key');
  // The frozen aim feeds back into resolveAim's lockDir branch: even with
  // Down still held, the shot goes horizontal toward facing.
  const intent = { ...baseIntent(), down: true, lockDir: true, aimX: s.aimX, aimY: s.aimY };
  assert.equal(h.resolveAim(intent), DIR_RIGHT, `resolved locked aim must be horizontal, got ${h.resolveAim(intent)}`);
  f.up('KeyI'); f.up('KeyS'); f.engine.destroy();
});

ok('REAL engage: crouched facing left + I locks horizontal LEFT (not down)', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = baseIntent(); inp.right = true;
  h.update(DT, inp);
  inp.right = false; inp.left = true;
  h.update(DT, inp);
  assert.equal(h.facing, -1, 'should face left');
  inp.left = false; inp.down = true;
  h.update(DT, inp);
  assert.ok(h.crouching, 'should be crouched');
  const f = inputFixture(h);
  f.down('KeyS'); f.engine.poll({ facing: h.facing });
  f.down('KeyI'); f.engine.poll({ facing: h.facing });
  const s = f.engine.state;
  assert.ok(Math.abs(s.aimY) < 1e-9, `locked aim must be horizontal, got aimY=${s.aimY}`);
  assert.ok(s.aimX < -0.99, `locked aim must point left (facing), got aimX=${s.aimX}`);
  const intent = { ...baseIntent(), down: true, lockDir: true, aimX: s.aimX, aimY: s.aimY };
  assert.equal(h.resolveAim(intent), DIR_LEFT, `resolved locked aim must be left, got ${h.resolveAim(intent)}`);
  f.up('KeyI'); f.up('KeyS'); f.engine.destroy();
});

ok('REAL engage: airborne holding Down + I still locks straight down (§5 example)', () => {
  const h = makeHero();
  h.setGrounded(false);
  h.vy = 50;
  const f = inputFixture(h);
  f.down('KeyS'); f.engine.poll({ facing: h.facing });
  f.down('KeyI'); f.engine.poll({ facing: h.facing });
  const s = f.engine.state;
  assert.ok(Math.abs(s.aimX) < 1e-9, `airborne lock must be vertical, got aimX=${s.aimX}`);
  // Screen-space y grows downward (DIR_ANGLES: down = +PI/2). The frozen
  // vector is (cos, sin) of the locked angle, so "down" is aimY ≈ +1.
  assert.ok(s.aimY > 0.99, `airborne lock must point down, got aimY=${s.aimY}`);
  const intent = { ...baseIntent(), down: true, lockDir: true, aimX: s.aimX, aimY: s.aimY };
  assert.equal(h.resolveAim(intent), DIR_DOWN, `resolved locked aim must be down, got ${h.resolveAim(intent)}`);
  f.up('KeyI'); f.up('KeyS'); f.engine.destroy();
});

console.log('resolveAim — movement locked (AC #4)');
ok('lockMove + Down resolves straight down and holds vx at 0', () => {
  const h = makeHero();
  h.setGrounded(true);
  h.vx = 200;
  let inp = baseIntent(); inp.lockMove = true; inp.down = true; inp.aimY = 1;
  h.update(DT, inp);
  assert.equal(h.resolveAim(inp), DIR_DOWN, `got ${h.resolveAim(inp)}`);
  assert.equal(h.vx, 0, `lockMove must zero locomotion, vx=${h.vx}`);
  assert.equal(h.crouching, false, 'Down under lockMove must NOT initiate crouch (§4)');
  // A second frame keeps it pinned.
  h.vx = 150;
  h.update(DT, inp);
  assert.equal(h.vx, 0, `vx held at 0 on subsequent frames, got ${h.vx}`);
});

console.log('resolveAim — neutral shot (AC #5)');
ok('no directional input resolves horizontal toward facing', () => {
  const h = makeHero();
  h.setGrounded(true);
  const inp = baseIntent();
  assert.equal(h.resolveAim(inp), DIR_RIGHT, `facing right, got ${h.resolveAim(inp)}`);
  h.facing = -1;
  assert.equal(h.resolveAim(inp), DIR_LEFT, `facing left, got ${h.resolveAim(inp)}`);
});

ok('non-Down directions pass through untouched (up/right etc.)', () => {
  const h = makeHero();
  h.setGrounded(true);
  let inp = baseIntent(); inp.up = true; inp.aimX = 0; inp.aimY = -1;
  assert.equal(h.resolveAim(inp), 2, `up should resolve to index 2, got ${h.resolveAim(inp)}`);
  inp = baseIntent(); inp.right = true; inp.aimX = 1; inp.aimY = 0;
  assert.equal(h.resolveAim(inp), DIR_RIGHT, `right should resolve to index 0`);
});

console.log('bodyCenter — active-box origin (AC #2)');
ok('crouched body center is lower than standing, derived from crouchBox', () => {
  const h = makeHero();
  h.setGrounded(true);
  const stand = h.bodyCenter();
  let inp = baseIntent(); inp.down = true;
  h.update(DT, inp);
  assert.ok(h.crouching, 'should be crouched');
  const crouch = h.bodyCenter();
  assert.ok(crouch.y > stand.y, `crouch center y=${crouch.y} must be below standing y=${stand.y}`);
  // Exact expectation from the box geometry: feet planted, top drops by h*0.4.
  const expected = h.y + h.crouchBox.oy + h.crouchBox.bh / 2;
  assert.ok(Math.abs(crouch.y - expected) < 1e-9, `expected ${expected}, got ${crouch.y}`);
  assert.ok(Math.abs(crouch.x - (h.x + h.w / 2)) < 1e-9, 'x stays at body midpoint');
});

// --- Wiring: real readInput → tryFire pipeline (stubbed DOM listeners) --------
// Convention item 2: one small wiring test per new input surface. Uses the full
// pipeline with full key release + processInput() before/after every case and
// polls until the condition holds instead of fixed frame counts.
console.log('wiring — readInput routes resolved aim into spawned projectiles');
const hero = U.getHero();
const solids = U.getSolids();
const FLOOR_TOP = solids[0].y;
// The window stub above captured every listener registered at import time in
// winHandlers; drive the real keyboard path through those captured handlers.
function press(code) {
  if (winHandlers?.keydown) winHandlers.keydown.forEach(fn => fn({ code, preventDefault: noop }));
}
function release(code) {
  if (winHandlers?.keyup) winHandlers.keyup.forEach(fn => fn({ code, preventDefault: noop }));
}
function releaseAllAndSync() {
  for (const code of ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyJ','KeyI','KeyO']) release(code);
  U.processInput();
}
function placeHero(x, y) {
  setState(S.PLAY);
  hero.x = x; hero.y = y;
  hero.vx = 0; hero.vy = 0;
  hero.grounded = false;
  hero.jumpsUsed = 0;
  hero.dying = false;
  hero.alive = true;
  hero.energy = hero.maxEnergy;
  hero.ammo = 200;
  hero.fireCooldown = 0;
  for (let i = 0; i < 10; i++) U.update(DT); // settle onto the floor
}
function lastProjectile() {
  const items = U.getProjectiles();
  return items.length ? items[items.length - 1] : null;
}
function clearProjectiles() {
  for (const p of U.getProjectiles()) p.alive = false;
  U.projectilePoolCull?.();
}

ok('pipeline: grounded crouch + shoot fires horizontally toward facing (not down)', () => {
  if (!winHandlers?.keydown) { console.log('    (skipped — window listeners not capturable in this harness)'); return; }
  releaseAllAndSync();
  placeHero(300, FLOOR_TOP - hero.h - 4);
  // Face right by running briefly.
  press('KeyD'); U.processInput();
  for (let i = 0; i < 5; i++) U.update(DT);
  release('KeyD'); U.processInput();
  assert.equal(hero.facing, 1, 'should face right');
  // Crouch + shoot: press Down first, run one frame so crouch commits (box =
  // crouchBox), THEN press Shoot — bodyCenter() must be the crouched center.
  press('KeyS'); U.processInput();
  for (let i = 0; i < 3; i++) U.update(DT); // settle: let crouch commit + floor resolve
  assert.ok(hero.crouching, 'hero must be crouched before shooting');
  press('KeyJ'); U.processInput();
  let p = null;
  let heroYAtSpawn = null;
  for (let i = 0; i < 90 && !p; i++) { U.update(DT); p = lastProjectile(); if (p) heroYAtSpawn = hero.y; }
  releaseAllAndSync();
  assert.ok(p, 'a projectile should have spawned');
  const angle = dirAngle(p.dir);
  assert.ok(Math.abs(Math.sin(angle)) < 1e-9, `shot must be horizontal, angle=${angle}`);
  assert.ok(Math.cos(angle) > 0, `shot must go right (facing), cos=${Math.cos(angle)}`);
  // Spawn origin must come from the CROUCHED body center (lower than standing).
  // Compare against the hero position captured on the frame the shot appeared.
  const standCenterY = heroYAtSpawn + hero.standBox.oy + hero.standBox.bh / 2;
  const crouchCenterY = heroYAtSpawn + hero.crouchBox.oy + hero.crouchBox.bh / 2;
  const spawnY = p.y + p.h / 2; // box top-left → center
  // Tolerance: heroYAtSpawn is captured on the frame the projectile appears,
  // which can lag the true crouch-frame origin by a sub-pixel gravity dip /
  // floor-correction shift. Allow 2px so the assertion stays robust.
  assert.ok(spawnY > standCenterY - 2, `crouched shot y=${spawnY} must be at/below standing center ${standCenterY} (±2px)`);
  // The spawn Y should be within a few px of the crouch center. The exact value
  // depends on the ±16px aim offset and mid-frame gravity; use a generous
  // tolerance since heroYAtSpawn may lag the fire-frame by one integration step.
  assert.ok(Math.abs(spawnY - crouchCenterY) < 25, `expected spawn y near crouch center ${crouchCenterY}, got ${spawnY}`);
});

ok('pipeline: airborne + Down + shoot fires straight down', () => {
  if (!winHandlers?.keydown) { console.log('    (skipped — window listeners not capturable in this harness)'); return; }
  releaseAllAndSync();
  placeHero(300, FLOOR_TOP - hero.h - 4);
  // Jump.
  press('Space'); U.processInput();
  for (let i = 0; i < 3; i++) U.update(DT);
  release('Space'); U.processInput();
  assert.equal(hero.grounded, false, 'should be airborne');
  press('KeyS'); press('KeyJ'); U.processInput();
  let p = null;
  for (let i = 0; i < 90 && !p; i++) { U.update(DT); p = lastProjectile(); }
  releaseAllAndSync();
  assert.ok(p, 'a projectile should have spawned');
  const angle = dirAngle(p.dir);
  assert.ok(Math.abs(Math.cos(angle)) < 1e-9, `shot must be vertical, angle=${angle}`);
  assert.ok(Math.sin(angle) > 0, `shot must go down, sin=${Math.sin(angle)}`);
});

ok('pipeline: lockMove + Down + shoot fires straight down with vx held at 0', () => {
  if (!winHandlers?.keydown) { console.log('    (skipped — window listeners not capturable in this harness)'); return; }
  releaseAllAndSync();
  placeHero(300, FLOOR_TOP - hero.h - 4);
  press('KeyO'); press('KeyS'); press('KeyJ'); U.processInput();
  let p = null;
  for (let i = 0; i < 90 && !p; i++) { U.update(DT); p = lastProjectile(); }
  releaseAllAndSync();
  assert.ok(p, 'a projectile should have spawned');
  const angle = dirAngle(p.dir);
  assert.ok(Math.abs(Math.cos(angle)) < 1e-9, `shot must be vertical, angle=${angle}`);
  assert.ok(Math.sin(angle) > 0, `shot must go down, sin=${Math.sin(angle)}`);
  assert.equal(hero.vx, 0, `lockMove must hold vx at 0, got ${hero.vx}`);
});

ok('pipeline: grounded crouch holding Down, THEN I engages Lock Direction → shot goes horizontal toward facing (§5)', () => {
  if (!winHandlers?.keydown) { console.log('    (skipped — window listeners not capturable in this harness)'); return; }
  releaseAllAndSync();
  placeHero(300, FLOOR_TOP - hero.h - 4);
  // Face right by running briefly.
  press('KeyD'); U.processInput();
  for (let i = 0; i < 5; i++) U.update(DT);
  release('KeyD'); U.processInput();
  assert.equal(hero.facing, 1, 'should face right');
  // Crouch (holding Down), then engage Lock Direction while still holding Down.
  // The capture must use the RESOLVED aim (horizontal toward facing), not the
  // raw Down key — a straight-down lock would be the §5 bug.
  press('KeyS'); U.processInput();
  for (let i = 0; i < 2; i++) U.update(DT);
  assert.ok(hero.crouching, 'should be crouched before locking');
  press('KeyI'); U.processInput();
  assert.ok(input.state.lockDir, 'Lock Direction should be engaged');
  assert.ok(Math.abs(input.state.aimY) < 1e-9, `locked aim must be horizontal, got aimY=${input.state.aimY}`);
  assert.ok(input.state.aimX > 0.99, `locked aim must point right (facing), got aimX=${input.state.aimX}`);
  // Shoot: the frozen aim feeds resolveAim's lockDir branch → horizontal shot.
  press('KeyJ'); U.processInput();
  let p = null;
  for (let i = 0; i < 90 && !p; i++) { U.update(DT); p = lastProjectile(); }
  releaseAllAndSync();
  assert.ok(p, 'a projectile should have spawned');
  const angle = dirAngle(p.dir);
  assert.ok(Math.abs(Math.sin(angle)) < 1e-9, `locked crouch shot must be horizontal, angle=${angle}`);
  assert.ok(Math.cos(angle) > 0, `shot must go right (facing), cos=${Math.cos(angle)}`);
});

console.log(`\n${passed} passed`);
