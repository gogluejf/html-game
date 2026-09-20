// Task 4.1 — node-based unit tests for self-protection on connect
// (knockback.md milestone 4). Run: node js/test/connectProtect.test.js
// No DOM needed: hero.js / heroDefs.js are pure modules. Direct-intent pattern:
// drive the special swing with updateSpecialMelee(DT, intent), arm protection
// via markSpecialConnect() (exactly what processAllHitboxes does on a clean
// connect), and assert the connectProtected window's lifecycle.
//
// Contract under test:
//   • A clean sweep/cartwheel connect makes the hero immune to contact damage
//     for the rest of that swing (active + recovery).
//   • A whiffed swing grants NO protection — the hero stays exposed.
//   • Protection clears when the swing ends naturally or is cancelled.
//   • Normal melee and projectiles never arm the window (only the special-
//     melee hitbox's onHit callback calls markSpecialConnect; the flag is
//     inert unless a special swing is active).

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES } from '../heroDefs.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60; // fixed step — one special-melee frame per tick

// --- Helpers -----------------------------------------------------------------
function makeHero(id = 'balthazar', x = 0, y = 0) {
  return new Hero(HEROES[id], x, y);
}
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, super: false, melee: false });
/** Land the special swing exactly on its first ACTIVE frame. */
function setSpecialActive(h) {
  const cfg = h.heroDef.specialMelee;
  h.specialMeleeActive = true;
  h.specialMeleePhase = 'active';
  h.specialMeleeFrame = cfg.frames.windup;
}
/** Land the special swing exactly on its first RECOVERY frame. */
function setSpecialRecovery(h) {
  const cfg = h.heroDef.specialMelee;
  h.specialMeleeActive = true;
  h.specialMeleePhase = 'recovery';
  h.specialMeleeFrame = cfg.frames.windup + cfg.frames.active;
}

console.log('Acceptance #1 — a clean connect protects for the rest of the swing');
ok('markSpecialConnect arms protection during the active phase', () => {
  const h = makeHero('balthazar');
  setSpecialActive(h);
  assert.equal(h.connectProtected, false);
  h.markSpecialConnect();
  assert.equal(h.connectProtected, true);
});
ok('protection survives through the entire recovery phase', () => {
  const h = makeHero('scarlet');
  const cfg = h.heroDef.specialMelee;
  setSpecialActive(h);
  h.markSpecialConnect();
  // Step through every remaining active frame + all recovery frames.
  const total = h.specialMeleeTotalFrames;
  for (let i = cfg.frames.windup; i < total - 1; i++) {
    h.updateSpecialMelee(DT, noInput());
    assert.ok(h.connectProtected, `still protected at frame ${i}`);
  }
});
ok('window length equals remaining active + all recovery frames', () => {
  const h = makeHero('balthazar');
  const cfg = h.heroDef.specialMelee;
  setSpecialActive(h);
  h.markSpecialConnect();
  // Connected on the FIRST active frame → full active+recovery window.
  assert.equal(h._connectProtectFrames, cfg.frames.active + cfg.frames.recovery);
});
ok('a connect late in active grants a shorter (remaining-only) window', () => {
  const h = makeHero('balthazar');
  const cfg = h.heroDef.specialMelee;
  h.specialMeleeActive = true;
  h.specialMeleePhase = 'active';
  h.specialMeleeFrame = cfg.frames.windup + cfg.frames.active - 1; // last active frame
  h.markSpecialConnect();
  assert.equal(h._connectProtectFrames, 1 + cfg.frames.recovery);
});
ok('re-hits do not extend the window (idempotent max)', () => {
  const h = makeHero('balthazar');
  const cfg = h.heroDef.specialMelee;
  setSpecialActive(h);
  h.markSpecialConnect();
  const first = h._connectProtectFrames;
  h.specialMeleeFrame += 1; // later active frame → shorter remaining window
  h.markSpecialConnect();
  assert.equal(h._connectProtectFrames, first, 'earliest (longest) window wins');
});

console.log('Acceptance #2 — a whiff grants nothing');
ok('no connect → no protection across the whole swing', () => {
  const h = makeHero('balthazar');
  h.startSpecialMelee();
  const total = h.specialMeleeTotalFrames;
  for (let i = 0; i < total; i++) {
    h.updateSpecialMelee(DT, noInput());
    assert.equal(h.connectProtected, false, `exposed at frame ${i}`);
  }
});
ok('whiffed swing leaves _connectProtectFrames at zero', () => {
  const h = makeHero('scarlet');
  setSpecialActive(h);
  h.updateSpecialMelee(DT, noInput());
  h.updateSpecialMelee(DT, noInput());
  assert.equal(h._connectProtectFrames, 0);
});

console.log('Acceptance #3 — protection clears when the swing ends or is cancelled');
ok('natural completion clears the window', () => {
  const h = makeHero('balthazar');
  const cfg = h.heroDef.specialMelee;
  setSpecialActive(h);
  h.markSpecialConnect();
  // Run the swing out to natural completion.
  while (h.specialMeleeActive) h.updateSpecialMelee(DT, noInput());
  assert.equal(h.specialMeleeActive, false);
  assert.equal(h.connectProtected, false);
  assert.equal(h._connectProtectFrames, 0);
});
ok('recovery jump-cancel clears the window immediately', () => {
  const h = makeHero('balthazar');
  setSpecialRecovery(h);
  h._prevMeleeJumpHeld = false;
  h.markSpecialConnect();
  assert.equal(h.connectProtected, true);
  // Fresh jump press during recovery cancels the swing (§16/§19).
  h.updateSpecialMelee(DT, { ...noInput(), jump: true });
  assert.equal(h.specialMeleeActive, false);
  assert.equal(h.connectProtected, false);
});
ok('endSpecialMelee clears an armed window directly', () => {
  const h = makeHero('scarlet');
  setSpecialActive(h);
  h.markSpecialConnect();
  h.endSpecialMelee();
  assert.equal(h.connectProtected, false);
});
ok('respawn clears any leftover window', () => {
  const h = makeHero('balthazar');
  setSpecialActive(h);
  h.markSpecialConnect();
  h.respawn();
  assert.equal(h.connectProtected, false);
});

console.log('Acceptance #4 — normal melee and projectiles are unaffected');
ok('markSpecialConnect is inert without an active special swing', () => {
  const h = makeHero('balthazar');
  // Simulate a normal-melee connect: melee is active, special is not. The
  // unified system only routes the special slot's hits to markSpecialConnect,
  // but even if it did, the guard refuses to arm outside a special swing.
  h.tryMelee();
  h.meleeFrame = h.MELEE_ACTIVE_FRAME;
  h.markSpecialConnect();
  assert.equal(h.connectProtected, false);
});
ok('a normal melee swing never arms the window end-to-end', () => {
  const h = makeHero('balthazar');
  h.tryMelee();
  for (let i = 0; i < h.MELEE_TOTAL_FRAMES; i++) {
    h.update(DT, noInput());
    assert.equal(h.connectProtected, false);
  }
});
ok('fresh heroes start unprotected', () => {
  for (const id of ['balthazar', 'scarlet']) {
    const h = makeHero(id);
    assert.equal(h.connectProtected, false);
    assert.equal(h._connectProtectFrames, 0);
  }
});

console.log('\n' + passed + ' assertions passed');
