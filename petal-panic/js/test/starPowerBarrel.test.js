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
const { ctx: wctx } = await import('../world/context.js');

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
  U.getCollisionWorld().add(barrel); // ensure it is in the world for contact/bonk passes
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
  // Touch frame: enemy-style shove — horizontal push in front + small pop
  // lobe. Barrel sits to the hero's right → flies right, pops a little.
  assert.ok(barrel._fuse != null, 'fuse armed on the touch frame');
  assert.ok(barrel.vx > 600, `barrel shoved away horizontally (vx=${barrel.vx})`);
  assert.ok(barrel.vy < 0, `small pop lobe (vy=${barrel.vy})`);
  assert.ok(barrel.vy > -500, `pop is small — not clown-launched into the sky (vy=${barrel.vy})`);
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

ok('star-launched barrel flies CLEAN through a whole row (others stay put)', () => {
  resetHitstop();
  const { h } = installZoneWithBarrel(0); // no barrel yet; we build the row below
  const zone = U.getActiveZone(h);
  // A horizontal row of 4 barrels on the floor, touching each other.
  const row = [];
  for (let i = 0; i < 4; i++) row.push(new GameObj(WOOD_BARREL_DEF, 400 + i * 32, ZONE_GROUND_Y - 48));
  U.loadActiveZone(zone, {
    solids: zone.platforms, enemies: [], barrels: row, powerups: [],
    checkpoints: [makeCheckpoint('t', 5280, 384, { isEntry: false })],
  });
  for (const b of row) U.getCollisionWorld().add(b);
  // Hero touches the LEFTMOST barrel from its left side → launch flies RIGHT
  // through barrels 2, 3, 4.
  h.x = 400 - h.w + 4;
  h.y = ZONE_GROUND_Y - h.h;
  h.vx = h.vy = 0;
  h.starPower = true;
  setState(S.PLAY);
  U.update(DT); // touch frame: leftmost launches right + intangible
  assert.ok(row[0]._fuse != null, 'leftmost launched');
  assert.equal(row[0].intangible, true, 'phasing from the launch frame');
  // The launch frame's OWN peer impulse (stepDynamicSolid runs before the
  // star block sets intangible) is excluded by design — measure flight from
  // the NEXT frame onward.
  U.update(DT);
  const xsMid = row.map(b => b.x); // capture AFTER the first phasing step
  // Cook until it detonates.
  let frames = 0;
  while (!row[0].destroyed && frames++ < 90) U.update(DT);
  assert.ok(row[0].destroyed, `detonated (frame ${frames})`);
  // The other three were NEVER shoved DURING THE FLIGHT: their x positions are
  // unchanged from the post-launch snapshot (the launch frame's own peer
  // impulse is excluded — phase starts the next step, by design).
  for (let i = 1; i < 4; i++) {
    assert.ok(Math.abs(row[i].x - xsMid[i]) < 1,
      `barrel ${i + 1} stayed put during flight (moved ${Math.abs(row[i].x - xsMid[i]).toFixed(2)}px)`);
    assert.ok(!row[i].destroyed, `barrel ${i + 1} survived the pass-through`);
  }
  resetHitstop();
});

ok('flying star-barrel is not a solid surface for the hero (passes clean through)', () => {
  resetHitstop();
  const { h, barrel } = installZoneWithBarrel(300);
  h.x = 300 - h.w + 4;
  h.y = ZONE_GROUND_Y - h.h;
  h.vx = h.vy = 0;
  h.starPower = true;
  setState(S.PLAY);
  U.update(DT); // touch: launch + fuse
  U.update(DT); // step: _phaseThrough flagged
  assert.equal(barrel.intangible, true, 'phasing while cooking');
  // The hero's solid list must NOT include the flying barrel.
  const inSolids = wctx.barrelSolidBoxes.some(bx => bx.owner === barrel);
  assert.equal(inSolids, false, 'flying barrel excluded from hero solid boxes');
  resetHitstop();
});

ok('phase-through survives the star expiring mid-flight (flight-owned, not powerup-owned)', () => {
  resetHitstop();
  const { h, barrel } = installZoneWithBarrel(300);
  h.x = 300 - h.w + 4;
  h.y = ZONE_GROUND_Y - h.h;
  h.vx = h.vy = 0;
  h.starPower = true;
  setState(S.PLAY);
  U.update(DT); // launch: fuse + phase-through
  assert.equal(barrel.intangible, true, 'phasing at launch');
  // Star expires while the barrel is still cooking.
  h.starPower = false;
  h.invincible = false;
  for (let i = 0; i < 5 && !barrel.destroyed; i++) U.update(DT);
  if (!barrel.destroyed) {
    assert.equal(barrel.intangible, true, 'still phasing after the star dropped');
  }
  // It must still detonate (fuse expiry), not cook forever.
  let frames = 0;
  while (!barrel.destroyed && frames++ < 90) U.update(DT);
  assert.ok(barrel.destroyed, `detonated after star expiry (frame ${frames})`);
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
