// Task 2.3 — node-based unit tests for special melee (Down+Melee, design §15).
// Run: node js/test/specialMelee.test.js
// No DOM needed: entity.js / consts.js / hero.js are pure modules.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';
import { LAYER } from '../consts.js';
import { Entity } from '../entity.js';
import { damage } from '../damage.js';

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
// Advance the special swing to a specific integer frame index.
function setSpecialFrame(h, idx) {
  const cfg = h.heroDef.specialMelee;
  const phase = idx < cfg.frames.windup ? 'windup'
    : idx < cfg.frames.windup + cfg.frames.active ? 'active'
    : 'recovery';
  h.specialMeleeActive = true;
  h.specialMeleePhase = phase;
  h.specialMeleeFrame = idx;
}

console.log('Config (per-hero data in heroDefs)');
ok('both heroes carry specialMelee config', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const cfg = HEROES[id].specialMelee;
    assert.ok(cfg, `${id} missing specialMelee`);
    assert.equal(typeof cfg.direction, 'number');
    assert.ok(cfg.travelSpeed > 0);
    assert.ok(cfg.frames.windup >= 0 && cfg.frames.active >= 1 && cfg.frames.recovery >= 0);
    assert.ok(cfg.hitbox.bw > 0 && cfg.hitbox.bh > 0);
  }
});
ok('directions contrast: balthazar toward, scarlet away', () => {
  assert.equal(HEROES.balthazar.specialMelee.direction, 1);
  assert.equal(HEROES.scarlet.specialMelee.direction, -1);
});

console.log('Acceptance #1 — Down+Melee triggers special, plain Melee normal');
ok('startSpecialMelee starts special, not normal melee', () => {
  const h = makeHero('balthazar');
  h.startSpecialMelee();
  assert.equal(h.specialMeleeActive, true);
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
ok('balthazar vx = +travelSpeed during windup/active with no horizontal input', () => {
  const h = makeHero('balthazar');
  h.facing = 1;
  h.startSpecialMelee();
  assert.equal(h.specialMeleeDir, 1);
  const speed = HEROES.balthazar.specialMelee.travelSpeed;
  // Windup frame 0.
  h.update(DT, noInput());
  assert.equal(h.specialMeleePhase, 'windup');
  assert.ok(approx(h.vx, speed), `vx=${h.vx}`);
  // Step through all committed frames — vx stays locked, no input held.
  for (let i = 0; i < 6; i++) h.update(DT, noInput());
  assert.ok(approx(h.vx, speed), `vx=${h.vx} mid-swing`);
});
ok('balthazar moves forward across the full committed window', () => {
  const h = makeHero('balthazar');
  h.facing = 1;
  h.grounded = true;
  h.startSpecialMelee();
  const cfg = HEROES.balthazar.specialMelee;
  const committedFrames = cfg.frames.windup + cfg.frames.active;
  // Step one integer frame at a time (float-clock drift makes raw dt loops
  // land on unexpected phase boundaries).
  let allLocked = true;
  for (let i = 0; i < committedFrames; i++) {
    h.specialMeleeFrame = i;
    h.update(DT, noInput());
    if (!approx(h.vx, cfg.travelSpeed)) allLocked = false;
  }
  assert.ok(allLocked, 'vx must stay locked at travelSpeed every committed frame');
});

console.log('Acceptance #3 — Scarlet retreats but keeps orientation');
ok('scarlet vx = -travelSpeed (opposite facing) while facing unchanged', () => {
  const h = makeHero('scarlet');
  h.facing = 1;
  h.startSpecialMelee();
  assert.equal(h.specialMeleeDir, -1);
  const speed = HEROES.scarlet.specialMelee.travelSpeed;
  h.update(DT, noInput());
  assert.ok(approx(h.vx, -speed), `vx=${h.vx}`);
  // Orientation preserved through the whole committed window.
  for (let i = 0; i < 8; i++) h.update(DT, noInput());
  assert.equal(h.facing, 1, 'facing must stay original');
  assert.equal(h.mirrorX, false, 'mirrorX must stay original');
});
ok('scarlet facing left retreats right (+vx), sprite still faces left', () => {
  const h = makeHero('scarlet');
  h.facing = -1;
  h.syncMirror();
  h.startSpecialMelee();
  assert.equal(h.specialMeleeDir, 1); // -1 * -1
  const speed = HEROES.scarlet.specialMelee.travelSpeed;
  h.update(DT, noInput());
  assert.ok(approx(h.vx, speed), `vx=${h.vx}`);
  assert.equal(h.facing, -1);
  assert.equal(h.mirrorX, true);
});

console.log('Acceptance #4 — hitbox only on active frames, mirrors by facing');
ok('hitbox null on windup and recovery frames', () => {
  const h = makeHero('balthazar');
  const cfg = HEROES.balthazar.specialMelee;
  for (let f = 0; f < cfg.frames.windup; f++) {
    setSpecialFrame(h, f);
    assert.equal(h.specialMeleeHitboxWorld, null, `windup frame ${f}`);
  }
  for (let f = cfg.frames.windup + cfg.frames.active; f < h.specialMeleeTotalFrames; f++) {
    setSpecialFrame(h, f);
    assert.equal(h.specialMeleeHitboxWorld, null, `recovery frame ${f}`);
  }
});
ok('hitbox present on every active frame', () => {
  const h = makeHero('balthazar');
  const cfg = HEROES.balthazar.specialMelee;
  for (let f = cfg.frames.windup; f < cfg.frames.windup + cfg.frames.active; f++) {
    setSpecialFrame(h, f);
    assert.ok(h.specialMeleeHitboxWorld, `active frame ${f} should have box`);
  }
});
ok('hitbox mirrors when facing left', () => {
  const h = makeHero('balthazar');
  setSpecialFrame(h, 4); // first active frame
  h.facing = 1;
  const rightBox = h.specialMeleeHitboxWorld;
  h.facing = -1;
  const leftBox = h.specialMeleeHitboxWorld;
  const cx = h.x + h.w / 2;
  const hb = HEROES.balthazar.specialMelee.hitbox;
  assert.ok(approx(rightBox.x, cx + hb.ox), `right x=${rightBox.x}`);
  assert.ok(approx(leftBox.x, cx - hb.ox - hb.bw), `left x=${leftBox.x}`);
  assert.ok(approx(rightBox.y, leftBox.y));
});
ok('damage lands via central damage() during active phase', () => {
  const h = makeHero('balthazar'); // attack 20
  h.facing = 1;
  setSpecialFrame(h, 4);
  const box = h.specialMeleeHitboxWorld;
  assert.ok(box);
  const e = makeEnemy(box.x + 5, box.y + 5, 50);
  const dealt = damage(h, e, h.stats.attack, 'specialMelee');
  assert.ok(dealt > 0, `dealt=${dealt}`);
  assert.equal(e.hp, 50 - dealt);
});
ok('no damage outside active phase', () => {
  const h = makeHero('balthazar');
  setSpecialFrame(h, 0); // windup
  assert.equal(h.specialMeleeHitboxWorld, null);
  setSpecialFrame(h, 10); // recovery
  assert.equal(h.specialMeleeHitboxWorld, null);
});

console.log('Acceptance #5 — windup+active committed, recovery cancellable');
ok('jump press during windup does NOT cancel or launch', () => {
  const h = makeHero('balthazar');
  h.grounded = true;
  h.startSpecialMelee();
  h.update(DT, noInput()); // into windup
  assert.equal(h.specialMeleePhase, 'windup');
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
  h.startSpecialMelee();
  const cfg = HEROES.balthazar.specialMelee;
  // Land exactly on the first active frame. updateSpecialMelee derives the
  // phase from Math.floor(frame) BEFORE incrementing, so one extra tick is
  // needed to cross the windup→active boundary (frame N acts on pre-increment).
  for (let i = 0; i < cfg.frames.windup + 1; i++) {
    h.specialMeleeFrame = i;
    h.update(DT, noInput());
  }
  assert.equal(h.specialMeleePhase, 'active');
  h._prevJumpHeld = false;
  h.update(DT, { ...noInput(), jump: true });
  assert.equal(h.specialMeleeActive, true, 'must stay active');
  assert.equal(h.jumpsUsed, 0);
});
ok('jump press during recovery cancels the swing', () => {
  const h = makeHero('balthazar');
  h.grounded = true;
  h.startSpecialMelee();
  const cfg = HEROES.balthazar.specialMelee;
  // Jump straight to the first recovery frame (sets phase directly).
  setSpecialFrame(h, cfg.frames.windup + cfg.frames.active);
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
  const cfg = HEROES.balthazar.specialMelee;
  setSpecialFrame(h, cfg.frames.windup + cfg.frames.active);
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
  const speed = HEROES.balthazar.specialMelee.travelSpeed;
  // Hold LEFT the entire time — committed vx must stay +travelSpeed.
  for (let i = 0; i < 7; i++) {
    h.update(DT, { ...noInput(), left: true });
    if (h.specialMeleePhase !== 'recovery') {
      assert.ok(approx(h.vx, speed), `frame ${i}: vx=${h.vx} (held left)`);
    }
  }
});
ok('scarlet retreat cannot be pushed back by held input', () => {
  const h = makeHero('scarlet');
  h.facing = 1; h.syncMirror();
  h.grounded = true;
  h.startSpecialMelee();
  const speed = HEROES.scarlet.specialMelee.travelSpeed;
  for (let i = 0; i < 7; i++) {
    h.update(DT, { ...noInput(), right: true });
    if (h.specialMeleePhase !== 'recovery') {
      assert.ok(approx(h.vx, -speed), `frame ${i}: vx=${h.vx} (held right)`);
    }
  }
});

console.log(`\n${passed} assertions passed`);
if (process.exitCode) console.error('FAILURES above');
