// Star power on destructible barrels — the starred hero pops barrels on touch.
// Run: node petal-panic/js/test/starPowerBarrel.test.js
// Headless integration against the real update loop (areaTransition pattern):
// a live barrel in the zone + hero.starPower → U.update() must destroy it via
// the unified resolver (onDestroyed aftermath pipeline), with hitstop armed.

import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();

import { strict as assert } from 'node:assert';
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => ctxStub, addEventListener: noop }) };
globalThis.window = { addEventListener: noop, __selectedHero: 'scarlet' };

const U = await import('../systems/update.js');
const { S, setState } = await import('../core/state.js');
const { makeCheckpoint, GameObj, WOOD_BARREL_DEF } = await import('../objects/object.js');
const { ZONE_GROUND_Y } = await import('../world/level.js');
const { consumeHitstop, resetHitstop } = await import('../core/hitstop.js');

const DT = 1 / 60;
let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Install a fresh zone with one wood barrel standing on the floor. */
function installZoneWithBarrel(barrelX) {
  U.bossZone.reset();
  Object.assign(U.getClearSequence(), { state: 'idle', timer: 0, pendingArea: null, pendingFadeIn: false });
  const h = U.getHero();
  h.currentArea = 1;
  h.dying = false;
  h.alive = true;
  h.energy = h.maxEnergy;
  h.starPower = false;
  const zone = U.getActiveZone(h);
  const flag = makeCheckpoint(zone.exitFlag.id, zone.exitFlag.x, zone.exitFlag.y, { isEntry: false });
  const barrel = new GameObj(WOOD_BARREL_DEF, barrelX, ZONE_GROUND_Y - 48);
  U.loadActiveZone(zone, { solids: zone.platforms, enemies: [], barrels: [barrel], powerups: [], checkpoints: [flag] });
  return { h, barrel };
}

console.log('Star power × barrels');

ok('starred touch LAUNCHES the barrel and detonates it after a beat (stomp feel)', () => {
  resetHitstop();
  const { h, barrel } = installZoneWithBarrel(300);
  h.x = 300 - h.w + 4; // hero's right edge bites into the barrel (32px-wide box)
  h.y = ZONE_GROUND_Y - h.h;
  h.vx = h.vy = 0;
  h.starPower = true;
  setState(S.PLAY);
  const hpBefore = barrel.hp;
  U.update(DT);
  // Touch frame: launched HARD (upward + away), fuse armed, NOT yet destroyed.
  assert.ok(barrel._fuse != null, 'fuse armed on the touch frame');
  assert.ok(barrel.vy < -400, `barrel yeeted upward (vy=${barrel.vy})`);
  assert.ok(Math.abs(barrel.vx) > 400, `barrel shoved sideways (vx=${barrel.vx})`);
  assert.ok(!barrel.destroyed, 'not instant — it cooks for a beat first');
  assert.equal(barrel.hp, hpBefore, 'hp untouched until detonation');
  let frozen = 0;
  while (consumeHitstop()) frozen++;
  assert.ok(frozen >= 1, `hitstop armed on the touch frame (got ${frozen})`);
  // Cook: the blast lands within the fuse window (~0.35s ≈ 21 frames).
  let frames = 0;
  while (!barrel.destroyed && frames++ < 60) U.update(DT);
  assert.ok(frames < 60, `detonated within the fuse window (frame ${frames})`);
  assert.ok(barrel.destroyed || !barrel.alive, 'barrel destroyed by the delayed blast');
  assert.equal(barrel.hp, 0, 'hp drained to 0 at detonation');
  resetHitstop();
});

ok('non-starred hero does NOT destroy a barrel by touching it', () => {
  resetHitstop();
  const { h, barrel } = installZoneWithBarrel(300);
  h.x = 300 - h.w + 4;
  h.y = ZONE_GROUND_Y - h.h;
  h.vx = h.vy = 0;
  h.starPower = false;
  setState(S.PLAY);
  for (let i = 0; i < 10; i++) U.update(DT);
  assert.ok(!barrel.destroyed && barrel.alive, 'barrel survives a plain touch');
  assert.equal(barrel.hp, WOOD_BARREL_DEF.hp, 'hp untouched');
  resetHitstop();
});

ok('starred hero far from the barrel leaves it alone', () => {
  resetHitstop();
  const { h, barrel } = installZoneWithBarrel(900);
  h.x = 100;
  h.y = ZONE_GROUND_Y - h.h;
  h.vx = h.vy = 0;
  h.starPower = true;
  setState(S.PLAY);
  U.update(DT);
  assert.ok(!barrel.destroyed && barrel.alive, 'no overlap → no pop');
  resetHitstop();
});

console.log(`\n${passed} passed`);
