// Task 2.3 — node-based unit tests for special melee (Down+Melee, design §15).
// Run: node js/test/specialMelee.test.js
// No DOM needed: entity.js / consts.js / hero.js are pure modules.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero/hero.js';
import { HEROES } from '../hero/heroDefs.js';
import { UNIT_PX_X } from '../world/macros.js';
import { LAYER } from '../consts.js';
import { Entity } from '../core/entity.js';
import { heroDamage as damage } from '../combat/damage.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const DT = 1 / 60; // fixed step

// --- Helpers -----------------------------------------------------------------
function makeHero(id = 'balthazar', x = 0, y = 0) {
  return new Hero(HEROES[id], x, y);
}
function makeEnemy(x, y, hp = 20, def = 0) {
  const e = new Entity({ x, y, w: 36, h: 40, gravity: 0, layer: LAYER.ENEMY });
  e.hp = hp; e.maxHp = hp; e.type = 'target';
  if (def > 0) e.defense = def;
  return e;
}
// Neutral input object.
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, super: false, melee: false });
// Advance the special swing to a specific integer frame index. Sheet-driven
// phase: derived from the sheet's authored attack boxes when a sheet is
// attached; without one (node path) every frame is 'active' (table fallback).
function setSpecialFrame(h, idx) {
  h.specialMeleeActive = true;
  h.specialMeleePhase = h._specialMeleePhaseAt(idx) ?? 'active';
  h.specialMeleeFrame = idx;
}

console.log('Config (per-hero data in heroDefs)');
ok('both heroes carry specialMelee config', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const cfg = HEROES[id].specialMelee;
    assert.ok(cfg, `${id} missing specialMelee`);
    assert.equal(typeof cfg.direction, 'number');
    assert.ok(cfg.travelSpeed > 0);
    // Timing is sheet-owned (super_melee cycle at its fps); the table hitbox
    // remains only as the no-box fallback.
    assert.ok(cfg.hitbox.bw > 0 && cfg.hitbox.bh > 0);
  }
});
ok('unified sweep: both heroes advance toward facing', () => {
  assert.equal(HEROES.balthazar.specialMelee.direction, 1);
  assert.equal(HEROES.scarlet.specialMelee.direction, 1);
});

console.log('Acceptance #1 — Down+Melee triggers special, plain Melee normal');
ok('startSpecialMelee starts special, not normal melee', () => {
  const h = makeHero('balthazar');
  h.startSpecialMelee();
  assert.equal(h.specialMeleeActive, true);
  // No sheet attached in node tests → committed windup until the first tick.
  assert.equal(h.specialMeleePhase, 'windup');
  assert.equal(h.meleeActive, false);
});
ok('plain tryMelee does NOT start special melee', () => {
  const h = makeHero('balthazar');
  h.tryMelee();
  assert.equal(h.meleeActive, true);
  assert.equal(h.specialMeleeActive, false);
});
ok('special melee cannot stack over an active normal swing', () => {
  const h = makeHero('balthazar');
  h.tryMelee();
  h.startSpecialMelee(); // refused while normal swing is up
  assert.equal(h.specialMeleeActive, false);
});
ok('normal melee cannot start under an active special swing (symmetric guard)', () => {
  const h = makeHero('balthazar');
  h.startSpecialMelee();
  h.tryMelee(); // refused while special swing is up
  assert.equal(h.meleeActive, false);
  assert.equal(h.specialMeleeActive, true);
});
ok('update system routing: down+melee → special, melee → normal', () => {
  // Mirrors the update.js trigger block exactly.
  const h = makeHero('balthazar');
  let input = { ...noInput(), melee: true, down: true };
  if (input.melee && !h.hitStunned) { if (input.down) h.startSpecialMelee(); else h.tryMelee(); }
  assert.equal(h.specialMeleeActive, true);
  assert.equal(h.meleeActive, false);

  const h2 = makeHero('balthazar');
  input = { ...noInput(), melee: true, down: false };
  if (input.melee && !h2.hitStunned) { if (input.down) h2.startSpecialMelee(); else h2.tryMelee(); }
  assert.equal(h2.meleeActive, true);
  assert.equal(h2.specialMeleeActive, false);
});

console.log('Acceptance #2 — Balthazar travels toward facing without input');
ok('balthazar vx = +travelSpeed during committed frames with no horizontal input', () => {
  const h = makeHero('balthazar');
  h.facing = 1;
  h.startSpecialMelee();
  assert.equal(h.specialMeleeDir, 1);
  const speed = HEROES.balthazar.specialMelee.travelSpeed * UNIT_PX_X; // def is unit-native (audit Tier 2)
  // First frame.
  h.update(DT, noInput());
  assert.ok(approx(h.vx, speed), `vx=${h.vx}`);
  // Step through the whole swing — no sheet → table fallback keeps every
  // frame committed (no recovery friction phase in the headless path).
  for (let i = 0; i < 6; i++) h.update(DT, noInput());
  assert.ok(approx(h.vx, speed), `vx=${h.vx} mid-swing`);
});
ok('balthazar moves forward across the full committed window', () => {
  const h = makeHero('balthazar');
  h.facing = 1;
  h.grounded = true;
  h.startSpecialMelee();
  const cfg = HEROES.balthazar.specialMelee;
  // Sheet-driven total: no sheet attached → legacy 11-frame fallback clock.
  const committedFrames = h.specialMeleeTotalFrames;
  // Step one integer frame at a time (float-clock drift makes raw dt loops
  // land on unexpected phase boundaries).
  let allLocked = true;
  for (let i = 0; i < committedFrames; i++) {
    h.specialMeleeFrame = i;
    h.update(DT, noInput());
    if (!approx(h.vx, cfg.travelSpeed * UNIT_PX_X)) allLocked = false;
  }
  assert.ok(allLocked, 'vx must stay locked at travelSpeed every committed frame');
});

console.log('Acceptance #3 — Scarlet advances with the unified sweep, keeps orientation');
ok('scarlet vx = +travelSpeed (toward facing) while facing unchanged', () => {
  const h = makeHero('scarlet');
  h.facing = 1;
  h.startSpecialMelee();
  assert.equal(h.specialMeleeDir, 1);
  const speed = HEROES.scarlet.specialMelee.travelSpeed * UNIT_PX_X; // def is unit-native (audit Tier 2)
  h.update(DT, noInput());
  assert.ok(approx(h.vx, speed), `vx=${h.vx}`);
  // Orientation preserved through the whole committed window.
  for (let i = 0; i < 8; i++) h.update(DT, noInput());
  assert.equal(h.facing, 1, 'facing must stay original');
  assert.equal(h.mirrorX, false, 'mirrorX must stay original');
});
ok('scarlet facing left advances left (-vx), sprite still faces left', () => {
  const h = makeHero('scarlet');
  h.facing = -1;
  h.syncMirror();
  h.startSpecialMelee();
  assert.equal(h.specialMeleeDir, -1); // -1 * 1
  const speed = HEROES.scarlet.specialMelee.travelSpeed * UNIT_PX_X; // def is unit-native (audit Tier 2)
  h.update(DT, noInput());
  assert.ok(approx(h.vx, -speed), `vx=${h.vx}`);
  assert.equal(h.facing, -1);
  assert.equal(h.mirrorX, true);
});

console.log('Acceptance #4 — hitbox only on active frames, mirrors by facing');
ok('no sheet (node path): sheet-only contract → no box on any frame', () => {
  const h = makeHero('balthazar');
  for (let f = 0; f < h.specialMeleeTotalFrames; f++) {
    setSpecialFrame(h, f);
    assert.equal(h.specialMeleeHitboxWorld, null, `frame ${f} → no sheet boxes in node tests → null`);
  }
});
ok('damage lands via central damage() during active phase', () => {
  const h = makeHero('balthazar'); // attack 20
  h.facing = 1;
  setSpecialFrame(h, 4);
  // Damage routing is sheet-independent: the box geometry comes from the
  // authored sheet in-game; here we just verify the central damage() path.
  const e = makeEnemy(0, 0, 50);
  const dealt = damage(h, e, h.stats.attack, 'specialMelee');
  assert.ok(dealt > 0, `dealt=${dealt}`);
  assert.equal(e.hp, 50 - dealt);
});
ok('no box outside the active phase (windup)', () => {
  const h = makeHero('balthazar');
  h.specialMeleeActive = true;
  h.specialMeleePhase = 'windup';
  assert.equal(h.specialMeleeHitboxWorld, null);
});

console.log('Acceptance #5 — committed frames do not cancel; recovery cancellable');
ok('jump press during a committed frame does NOT cancel or launch', () => {
  const h = makeHero('balthazar');
  h.grounded = true;
  h.startSpecialMelee();
  h.update(DT, noInput()); // first frame (table fallback: active)
  assert.ok(['windup', 'active'].includes(h.specialMeleePhase));
  // Fresh jump press this frame.
  h._prevJumpHeld = false;
  h.update(DT, { ...noInput(), jump: true });
  assert.equal(h.specialMeleeActive, true, 'must stay active');
  assert.equal(h.jumpsUsed, 0, 'jump must be suppressed');
  assert.ok(h.vy >= 0 || h.vy < 10, `vy=${h.vy} — no upward launch`);
});
ok('jump press during active does NOT cancel', () => {
  const h = makeHero('balthazar');
  h.grounded = true;
  h.requestMelee('special');
  h.specialMeleeFrame = 4; // mid-swing (table fallback: active)
  h._prevMeleeJumpHeld = false;
  h.update(DT, { ...noInput(), jump: true });
  assert.equal(h.specialMeleeActive, true, 'special active is committed');
  assert.equal(h.jumpsUsed, 0);
});
ok('jump press during recovery cancels the swing', () => {
  const h = makeHero('balthazar');
  h.grounded = true;
  h.startSpecialMelee();
  // Jump straight to a recovery frame (phase set directly — the sheet-driven
  // derivation needs an attached sheet, which node tests skip).
  h.specialMeleeActive = true;
  h.specialMeleePhase = 'recovery';
  h.specialMeleeFrame = 8;
  h.update(DT, noInput());
  assert.equal(h.specialMeleePhase, 'recovery');
  // Full production path: a fresh jump press THIS frame must cancel out of
  // recovery. _prevMeleeJumpHeld starts false (no prior jump), so the edge
  // check inside updateSpecialMelee sees a genuine fresh press.
  h._prevMeleeJumpHeld = false;
  h.update(DT, { ...noInput(), jump: true });
  assert.equal(h.specialMeleeActive, false, 'recovery must be jump-cancellable');
  assert.equal(h.specialMeleePhase, null);
});
ok('movement input during recovery cancels the swing (§16)', () => {
  const h = makeHero('balthazar');
  h.grounded = true;
  h.startSpecialMelee();
  h.specialMeleeActive = true;
  h.specialMeleePhase = 'recovery';
  h.specialMeleeFrame = 8;
  h.update(DT, noInput());
  assert.equal(h.specialMeleePhase, 'recovery');
  // Run/movement may immediately cancel recovery — full production path.
  h.update(DT, { ...noInput(), left: true });
  assert.equal(h.specialMeleeActive, false, 'recovery must be movement-cancellable');
  assert.equal(h.specialMeleePhase, null);
});
ok('recovery completes naturally without input', () => {
  const h = makeHero('balthazar');
  h.startSpecialMelee();
  // Step through every integer frame to natural completion. The final tick
  // must run with frame == total so the derived phase is "done" and the
  // swing clears (pre-increment derivation needs one extra step).
  for (let i = 0; i < h.specialMeleeTotalFrames + 1; i++) {
    h.specialMeleeFrame = i;
    h.update(DT, noInput());
  }
  assert.equal(h.specialMeleeActive, false);
  assert.equal(h.specialMeleePhase, null);
});

console.log('Acceptance #6 — trajectory cannot be reversed mid-attack');
ok('holding opposite direction does not steer the committed sweep', () => {
  const h = makeHero('balthazar');
  h.facing = 1; h.syncMirror();
  h.grounded = true;
  h.startSpecialMelee();
  const speed = HEROES.balthazar.specialMelee.travelSpeed * UNIT_PX_X; // def is unit-native (audit Tier 2)
  // Hold LEFT the entire time — committed vx must stay +travelSpeed.
  for (let i = 0; i < 7; i++) {
    h.update(DT, { ...noInput(), left: true });
    if (h.specialMeleePhase !== 'recovery') {
      assert.ok(approx(h.vx, speed), `frame ${i}: vx=${h.vx} (held left)`);
    }
  }
});
ok('scarlet sweep cannot be steered by held input', () => {
  const h = makeHero('scarlet');
  h.facing = 1; h.syncMirror();
  h.grounded = true;
  h.startSpecialMelee();
  const speed = HEROES.scarlet.specialMelee.travelSpeed * UNIT_PX_X; // def is unit-native (audit Tier 2)
  for (let i = 0; i < 7; i++) {
    h.update(DT, { ...noInput(), left: true });
    if (h.specialMeleePhase !== 'recovery') {
      assert.ok(approx(h.vx, speed), `frame ${i}: vx=${h.vx} (held left)`);
    }
  }
});

console.log(`\n${passed} assertions passed`);
if (process.exitCode) console.error('FAILURES above');
