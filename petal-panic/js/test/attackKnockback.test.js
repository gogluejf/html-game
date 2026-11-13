// Task 2.1 — knockback vectors on the three committed hero attack hitboxes
// (docs/architecture/knockback.md §11). Run: node js/test/attackKnockback.test.js
// No DOM needed: heroDefs.js / hero.js are pure modules.
//
// The shove is ONE vector { x, y } in px/s (+ optional hitstun/iFrames).
// Direct-intent pattern: assert the knockback data lives on the right attack
// objects in heroDefs, and that it rides through Hero.attackHitboxWorld() onto
// the resolved world box (the object updateSlot copies as hb.knockback at
// impact). Thorn/special projectiles never go through this path and carry no
// knockback field anywhere in heroDefs.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero/hero.js';
import { HEROES, ATTACK_MELEE, ATTACK_SPECIAL_MELEE, ATTACK_SUPERMOVE } from '../hero/heroDefs.js';
import { applyKnockback } from '../combat/knockback.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, special: false, melee: false, super: false });
const makeHero = (id) => new Hero(HEROES[id], 0, 0);
// Advance a special swing to its ACTIVE phase so the hitbox resolves.
function setSpecialActive(h) {
  h.specialMeleeActive = true;
  h.specialMeleePhase = 'active';
  h.specialMeleeFrame = 4; // mid-swing (table fallback: active)
}
// Start a real supermove dash via the production path.
function startDash(h, facing = 1) {
  h.facing = facing;
  h.supermoveMeter = h.SUPERMOVE_MAX;
  const inp = noInput(); inp.super = true;
  h.update(DT, inp);
}
// Advance a normal swing to an active frame index.
function setSwingFrame(h, idx) { h.meleeActive = true; h.meleeFrame = idx; }

console.log('heroDefs data (knockback.md §11 matrix)');

ok('balthazar sweep carries aggressive forward pushback', () => {
  const kb = HEROES.balthazar.specialMelee.knockback;
  assert.ok(kb, 'sweep must expose a non-null knockback vector');
  assert.equal(kb.x, 320);
  assert.equal(kb.y, -40);
  assert.equal(kb.hitstun, 0.45);
  assert.equal(kb.dirMode, 'alongVelocity'); // shove along the lunge velocity
});

ok('scarlet sweep carries the same aggressive forward pushback', () => {
  const kb = HEROES.scarlet.specialMelee.knockback;
  assert.ok(kb, 'sweep must expose a non-null knockback vector');
  assert.equal(kb.x, 320);
  assert.equal(kb.y, -40);
  assert.equal(kb.hitstun, 0.45);
  assert.equal(kb.dirMode, 'alongVelocity');
});

ok('supermove (both heroes) carries the strongest launch', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const kb = HEROES[id].attacks[ATTACK_SUPERMOVE].knockback;
    assert.ok(kb, `${id} supermove must expose a non-null knockback vector`);
    assert.equal(kb.x, 360);
    assert.equal(kb.y, -90);                  // biggest upward loft
    assert.equal(kb.hitstun, 0.30);
    assert.equal(kb.dirMode, 'alongVelocity'); // rides the dash velocity
  }
});

ok('sweeps carry a smaller loft than the supermove', () => {
  const sweepY = HEROES.balthazar.specialMelee.knockback.y;
  const scarletY = HEROES.scarlet.specialMelee.knockback.y;
  const superY = HEROES.scarlet.attacks[ATTACK_SUPERMOVE].knockback.y;
  assert.ok(sweepY < 0 && scarletY < 0, 'special melee must loft upward (negative y)');
  assert.ok(-superY > -scarletY, `super loft (${Math.abs(superY)}) must exceed scarlet sweep loft (${Math.abs(scarletY)})`);
  assert.ok(-superY > -sweepY, `super loft (${Math.abs(superY)}) must exceed sweep loft (${Math.abs(sweepY)})`);
});

ok('normal melee carries a SMALL burst knockback (lighter than committed attacks)', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const entry = HEROES[id].attacks[ATTACK_MELEE];
    const kb = entry.knockback;
    assert.ok(kb, `${id} melee must carry a knockback vector`);
    // Burst only: no loft (committed attacks loft, the jab does not).
    assert.equal(kb.y, 0, `${id} melee must not loft victims off the ground`);
    // Clearly lighter than the committed attacks.
    const specialX = HEROES[id].specialMelee.knockback.x;
    const superX = HEROES[id].attacks[ATTACK_SUPERMOVE].knockback.x;
    assert.ok(kb.x < specialX, `melee x (${kb.x}) must be lighter than special (${specialX})`);
    assert.ok(kb.x < superX, `melee x (${kb.x}) must be lighter than supermove (${superX})`);
    for (const frame of entry.frames) {
      if (frame) assert.equal(frame.knockback, undefined, 'knockback sits beside the frames, not inside them');
    }
  }
});

ok('thorn / special projectile definitions carry NO knockback', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const def = HEROES[id];
    assert.equal(def.attacks.knockback, undefined);
    assert.equal(def.specialMelee.hitbox.knockback, undefined, 'knockback sits beside the hitbox, not inside it');
  }
});

ok('strength ordering: super x >= sweep x (unified, both heroes tie)', () => {
  const superX = HEROES.scarlet.attacks[ATTACK_SUPERMOVE].knockback.x;
  const scarletSweepX = HEROES.scarlet.specialMelee.knockback.x;
  const balthazarSweepX = HEROES.balthazar.specialMelee.knockback.x;
  assert.ok(superX >= scarletSweepX, `super (${superX}) must not be weaker than scarlet sweep (${scarletSweepX})`);
  assert.ok(superX >= balthazarSweepX, `super (${superX}) must not be weaker than balthazar sweep (${balthazarSweepX})`);
  assert.equal(scarletSweepX, balthazarSweepX, 'unified sweep: identical x for both heroes');
});

console.log('Resolved world box exposes knockback (hb.knockback source)');

ok('sweep hitbox resolves with its knockback vector', () => {
  const h = makeHero('balthazar');
  setSpecialActive(h);
  const box = h.attackHitboxWorld(ATTACK_SPECIAL_MELEE);
  assert.ok(box, 'active-phase sweep must resolve a box');
  assert.deepEqual(box.knockback, HEROES.balthazar.specialMelee.knockback);
});

ok('scarlet sweep hitbox resolves with its knockback vector', () => {
  const h = makeHero('scarlet');
  setSpecialActive(h);
  const box = h.attackHitboxWorld(ATTACK_SPECIAL_MELEE);
  assert.ok(box, 'active-phase sweep must resolve a box');
  assert.deepEqual(box.knockback, HEROES.scarlet.specialMelee.knockback);
});

ok('supermove hitbox is sheet-only: null without authored sheet boxes (both heroes)', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const h = makeHero(id);
    startDash(h);
    assert.equal(h.attackHitboxWorld(ATTACK_SUPERMOVE), null,
      `${id} dashing hero must resolve a sheet-only supermove box (null without sheets)`);
  }
});

ok('normal melee hitbox resolves WITH the small burst knockback (knockback.md §11)', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const h = makeHero(id);
    setSwingFrame(h, 3); // active frame per MELEE_HITBOX_FRAMES
    const box = h.attackHitboxWorld(ATTACK_MELEE);
    assert.ok(box, 'active-frame melee must resolve a box');
    assert.deepEqual(box.knockback, HEROES[id].attacks[ATTACK_MELEE].knockback,
      `${id} melee box must carry the def's burst knockback`);
  }
});

console.log('Loft on hard hits (y component of the vector)');

// Plain stand-in victim: only the fields applyKnockback reads/writes.
const mkVictim = (resist = 1) => ({ vx: 0, vy: 0, knockbackResist: resist });

// A ground-level supermove hit: the dash normal is horizontal (alongVelocity,
// hero moving purely horizontally). The vector's y component supplies the loft.
ok('a supermove hit sets victim.vy upward by the vector\'s y', () => {
  const kb = HEROES.scarlet.attacks[ATTACK_SUPERMOVE].knockback;
  const v = mkVictim(1);
  // Dash direction +x → oriented vector = { x: kb.x, y: kb.y }.
  const applied = applyKnockback(v, { x: kb.x, y: kb.y, hitstun: kb.hitstun });
  assert.equal(applied, true);
  assert.ok(v.vy < 0, `expected upward (negative) vy, got ${v.vy}`);
  assert.ok(Math.abs(v.vy - kb.y) < 1e-9, `expected vy=${kb.y}, got ${v.vy}`);
  assert.ok(v.vx > 0, `expected positive vx, got ${v.vx}`);
});

ok('supermove loft scales down for heavier victims (mass resists the whole vector)', () => {
  const kb = HEROES.balthazar.attacks[ATTACK_SUPERMOVE].knockback;
  const light = mkVictim(1);
  const heavy = mkVictim(2);
  applyKnockback(light, { x: kb.x, y: kb.y });
  applyKnockback(heavy, { x: kb.x, y: kb.y });
  assert.ok(Math.abs(heavy.vy - light.vy / 2) < 1e-9, `heavy vy=${heavy.vy} should be half of light vy=${light.vy}`);
});

ok('sweep gives a smaller hop than the supermove (tuned, not exaggerated)', () => {
  const sweepKb = HEROES.balthazar.specialMelee.knockback;
  const superKb = HEROES.scarlet.attacks[ATTACK_SUPERMOVE].knockback;
  const sweepVictim = mkVictim(1);
  const superVictim = mkVictim(1);
  applyKnockback(sweepVictim, { x: sweepKb.x, y: sweepKb.y });
  applyKnockback(superVictim, { x: superKb.x, y: superKb.y });
  assert.ok(sweepVictim.vy < 0, 'sweep must still loft upward');
  assert.ok(-sweepVictim.vy < -superVictim.vy,
    `sweep loft (${Math.abs(sweepVictim.vy)}) must be smaller than super loft (${Math.abs(superVictim.vy)})`);
});

ok('a Thorn hit (no knockback) leaves vy unchanged', () => {
  // Friendly Thorn carries no knockback data anywhere — the core wiring gates
  // on presence of hb.knockback, so applyKnockback never runs for it. Prove
  // both halves: null/undefined vectors are pure no-ops, and thorn/special
  // attack definitions expose no knockback field at all.
  const v = mkVictim(1);
  v.vx = 10; v.vy = -5; // pre-existing velocity must survive untouched
  assert.equal(applyKnockback(v, null), false);
  assert.equal(applyKnockback(v, undefined), false);
  assert.equal(v.vy, -5, 'vy must be unchanged by a no-knockback hit');
  assert.equal(v.vx, 10, 'vx must be unchanged by a no-knockback hit');
  assert.equal(v.hitstunTimer, undefined, 'no stun from a no-knockback hit');
  for (const id of ['scarlet', 'balthazar']) {
    const def = HEROES[id];
    assert.equal(def.attacks.knockback, undefined);
    assert.equal(def.specialMelee.hitbox.knockback, undefined);
  }
});

console.log(`\n${passed} assertions passed.`);
