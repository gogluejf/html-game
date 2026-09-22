// One-way platforms + Down+Jump drop-through (design §13).
// Run: node js/test/oneWayPlatform.test.js
// No DOM needed: hero.js / collision.js / level.js are pure modules.
//
// Direct-intent pattern (see jumpslide.test.js): hero.update(DT, intent) with
// plain intent objects; resolve() is driven directly with hand-built solids.
// We assert behavior invariants (pass-through, landing, no-jump-on-drop),
// not pixel offsets or tuning constants.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';
import { resolve } from '../collision.js';
import { LEVELS, LEGACY_CORRIDOR } from '../level.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, special: false, melee: false });
const makeHero = () => new Hero(HEROES.scarlet, 0, 0); // speed 250, jump 500

// A one-way air platform and a solid floor piece (barrel-shaped solid terrain).
const ONE_WAY = { x: 800, y: 380, w: 150, h: 16, oneWay: true };
const SOLID_FLOOR = { x: 700, y: 500, w: 400, h: 40 }; // no oneWay flag → solid

/** Place the hero's feet exactly on the top of `plat` (standing pose). */
function standOn(h, plat) {
  h.x = plat.x + plat.w / 2 - h.w / 2;
  h.y = plat.y - h.h;
  h.vx = 0;
  h.vy = 0;
  h.setGrounded(true);
}

console.log('Level definitions');
ok('air platforms carry oneWay: true; the floor stays solid', () => {
  const plats = LEGACY_CORRIDOR.platforms;
  assert.equal(plats[0].oneWay, undefined, 'floor must remain solid (no oneWay flag)');
  for (const p of plats.slice(1)) {
    assert.equal(p.oneWay, true, `air platform at x=${p.x} must be oneWay`);
  }
});

console.log('Upward pass-through (§13 "Jumping Up Through")');
ok('rising hero passes through a one-way platform without being pushed down', () => {
  const h = makeHero();
  // Start below the platform, overlapping its underside while rising fast.
  h.x = ONE_WAY.x + ONE_WAY.w / 2 - h.w / 2;
  h.y = ONE_WAY.y + 10;          // box top 10px below the platform top → overlap
  h.vy = -300;                   // moving upward
  const prevBottom = h.y + h.h;  // bottom was below the platform top (came from underneath)
  const hit = resolve(h, [ONE_WAY], { prevBottom });
  assert.equal(hit, null, 'no correction — the underside must not block the jump');
  assert.ok(h.y < ONE_WAY.y + 10 || h.vy === -300, 'position/velocity untouched by the one-way solid');
  assert.equal(h.vy, -300, 'upward velocity must survive (not zeroed into the platform)');
});

ok('a solid platform DOES block an overlapping hero (control case)', () => {
  const h = makeHero();
  const solid = { ...ONE_WAY, oneWay: false };
  h.x = solid.x + solid.w / 2 - h.w / 2;
  h.y = solid.y + 10;
  h.vy = -300;
  const prevBottom = h.y + h.h;
  const hit = resolve(h, [solid], { prevBottom });
  assert.ok(hit !== null, 'solid terrain must still correct the overlap');
});

console.log('Landing from above (§13 "Landing")');
ok('falling onto a one-way platform from above lands it as ground', () => {
  const h = makeHero();
  // Just above the platform, falling: previous bottom was AT the top edge.
  h.x = ONE_WAY.x + ONE_WAY.w / 2 - h.w / 2;
  h.y = ONE_WAY.y - h.h - 5;     // 5px above the surface
  h.vy = 400;                    // falling fast enough to cross the gap in one step
  const prevBottom = h.y + h.h;  // = ONE_WAY.y - 5 → above the top
  h.y += h.vy * DT;              // integrate first (as update() does) so the box overlaps
  const hit = resolve(h, [ONE_WAY], { prevBottom });
  assert.ok(hit && hit.axis === 'y' && hit.dir === 1, 'should be pushed DOWN onto the surface');
  const wb = h.worldBox();
  assert.ok(Math.abs((wb.y + wb.h) - ONE_WAY.y) < 1, `feet should rest on the top, got gap ${(ONE_WAY.y - (wb.y + wb.h)).toFixed(2)}`);
  assert.equal(h.vy, 0, 'vertical velocity zeroed on landing');
  // setGrounded() path: landing this frame → grounded becomes true.
  h.setGrounded(true);
  assert.equal(h.grounded, true, 'setGrounded(true) after landing');
});

ok('arriving from underneath does NOT land even while falling', () => {
  const h = makeHero();
  // Box overlaps the platform but the PREVIOUS bottom was below its top:
  // the hero came up through it — it must keep passing, not snap to the top.
  h.x = ONE_WAY.x + ONE_WAY.w / 2 - h.w / 2;
  h.y = ONE_WAY.y - 5;           // slightly sunk into the platform
  h.vy = 50;                     // now falling (just past apex)
  const prevBottom = h.y + h.h + 20; // previous frame: well below the top
  const hit = resolve(h, [ONE_WAY], { prevBottom });
  assert.equal(hit, null, 'must not be pushed up out of the platform');
});

console.log('Drop-through (§13 "Drop Through")');
ok('Down+Jump on a one-way platform drops through and does NOT trigger a jump', () => {
  const h = makeHero();
  standOn(h, ONE_WAY);
  const inp = noInput(); inp.down = true; inp.jump = true; inp.onOneWay = true;
  h.update(DT, inp);
  assert.equal(h.jumpsUsed, 0, 'drop-through must NOT consume a jump');
  assert.ok(h.vy >= 0, `no upward impulse (vy=${h.vy})`);
  assert.ok(h.droppingThrough, 'drop-through window must be active');
  assert.ok(h._dropTimer > 0, 'ignore window timer must be running');
});

ok('while dropping through, the one-way platform is ignored (hero falls through it)', () => {
  const h = makeHero();
  standOn(h, ONE_WAY);
  h.startDropThrough();
  // Next frame: gravity pulls the hero into the platform.
  h.vy = 100;
  h.y += h.vy * DT;              // integrate (as update() does)
  const prevBottom = h.y + h.h - h.vy * DT;
  const hit = resolve(h, [ONE_WAY], { prevBottom, ignoreOneWay: h.droppingThrough });
  assert.equal(hit, null, 'ignored one-way solid must not push the hero back up');
  assert.ok(h.worldBox().y + h.worldBox().h > ONE_WAY.y, 'hero has fallen BELOW the platform top');
});

ok('Down+Jump on SOLID terrain is a normal jump (drop-through never applies)', () => {
  const h = makeHero();
  standOn(h, SOLID_FLOOR);
  const inp = noInput(); inp.down = true; inp.jump = true; inp.onOneWay = false;
  h.update(DT, inp);
  assert.equal(h.jumpsUsed, 1, 'solid terrain: the press IS a jump');
  assert.ok(h.vy < 0, 'upward impulse applied');
  assert.equal(h.droppingThrough, false, 'no drop-through window on solid terrain');
});

ok('drop-through window expires and the platform becomes landable again', () => {
  const h = makeHero();
  standOn(h, ONE_WAY);
  h.startDropThrough();
  // Advance until the window closes (DROP_THROUGH_TIME ≈ 0.25s → ~15 frames).
  let frames = 0;
  while (h.droppingThrough && frames < 120) { h.update(DT, noInput()); frames++; }
  assert.ok(frames < 60, `window should expire within ~15-20 frames, took ${frames}`);
  assert.equal(h.droppingThrough, false, 'window expired');
  // Now falling onto the same platform from above lands normally.
  h.x = ONE_WAY.x + ONE_WAY.w / 2 - h.w / 2;
  h.y = ONE_WAY.y - h.h - 5;
  h.vy = 400;
  const prevBottom = h.y + h.h;
  h.y += h.vy * DT;              // integrate so the box overlaps the surface
  const hit = resolve(h, [ONE_WAY], { prevBottom, ignoreOneWay: h.droppingThrough });
  assert.ok(hit && hit.axis === 'y' && hit.dir === 1, 'platform must be landable again after expiry');
});

ok('solid terrain (floor) is never affected by drop-through', () => {
  const h = makeHero();
  standOn(h, SOLID_FLOOR);
  h.startDropThrough(); // window active — must not matter for solid terrain
  h.vy = 400;
  const prevBottom = h.y + h.h;
  h.y += h.vy * DT;      // fall into the floor
  const hit = resolve(h, [SOLID_FLOOR], { prevBottom, ignoreOneWay: h.droppingThrough });
  assert.ok(hit && hit.axis === 'y' && hit.dir === 1, 'floor must still stop the hero');
  const wb = h.worldBox();
  assert.ok(wb.y + wb.h <= SOLID_FLOOR.y + 1, 'hero rests ON the floor, not inside it');
});

console.log('Edge cases (§13 / §31)');
ok('a hero NOT horizontally overlapping a one-way platform is NOT snapped onto it', () => {
  const h = makeHero();
  // Hero far to the LEFT of the platform, falling with its PREVIOUS bottom at
  // or above the platform top (so the "came from underneath" skip does NOT
  // fire) but no horizontal overlap → must exit at the penX/penY AABB check.
  h.x = ONE_WAY.x - h.w - 50;   // box right edge 50px left of the platform
  h.y = ONE_WAY.y - h.h - 5;    // previous bottom 5px ABOVE the platform top
  h.vy = 300;                   // falling
  const prevBottom = h.y + h.h; // = ONE_WAY.y - 5 → at/above the top
  const hit = resolve(h, [ONE_WAY], { prevBottom });
  assert.equal(hit, null, 'no correction — no AABB overlap, must not snap');
  const wb = h.worldBox();
  assert.ok(wb.x + wb.w < ONE_WAY.x, 'hero x untouched (not teleported onto the platform)');
  assert.equal(h.vy, 300, 'falling velocity untouched');
});

ok('after landing on a one-way platform the hero stays grounded (does not sink through)', () => {
  const h = makeHero();
  standOn(h, ONE_WAY); // feet exactly at the platform top, grounded
  let stayed = true;
  for (let i = 0; i < 10; i++) {
    // Each frame: gravity pulls in, resolve() must re-land at the exact edge
    // (prevBottom === s.y counts as "came from above", not underneath).
    h.vy += 980 * DT;                 // gravity (as update() does)
    const prevBottom = h.y + h.h;     // = ONE_WAY.y exactly (at rest on surface)
    h.y += h.vy * DT;                 // integrate → sinks slightly below top
    const hit = resolve(h, [ONE_WAY], { prevBottom });
    const bottom = h.worldBox().y + h.worldBox().h;
    if (!(hit && hit.axis === 'y' && Math.abs(bottom - ONE_WAY.y) < 0.01)) {
      stayed = false;
      break;
    }
  }
  assert.ok(stayed, 'hero must remain planted on the platform every frame');
  const bottom = h.worldBox().y + h.worldBox().h;
  assert.ok(Math.abs(bottom - ONE_WAY.y) < 0.01, `feet still on the surface (gap ${(bottom - ONE_WAY.y).toFixed(3)})`);
});

ok('on the drop-through trigger frame, other systems (rapid timer) still tick down', () => {
  const h = makeHero();
  standOn(h, ONE_WAY);
  h.rapidTimer = 0.5;                 // labeled timer running
  const before = h.rapidTimer;
  const inp = noInput(); inp.down = true; inp.jump = true; inp.onOneWay = true;
  h.update(DT, inp);
  // Drop-through fired...
  assert.ok(h.droppingThrough, 'drop-through window active');
  assert.equal(h.jumpsUsed, 0, 'no jump consumed');
  // ...but the rapid timer advanced this frame (no early return out of update()).
  assert.ok(h.rapidTimer < before, `rapid timer must tick down (${before} → ${h.rapidTimer})`);
  assert.ok(Math.abs((before - h.rapidTimer) - DT) < 1e-6, 'timer advanced by exactly dt');
});

console.log(`\n${passed} passed`);
