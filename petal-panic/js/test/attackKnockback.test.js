// Task 2.1 — knockback settings on the three committed hero attack hitboxes
// (docs/architecture/knockback.md §11). Run: node js/test/attackKnockback.test.js
// No DOM needed: heroDefs.js / hero.js are pure modules.
//
// Direct-intent pattern: assert the knockback data lives on the right attack
// objects in heroDefs, and that it rides through Hero.attackHitboxWorld() onto
// the resolved world box (the object updateSlot copies as hb.knockback at
// impact). Thorn/special projectiles never go through this path and carry no
// knockback field anywhere in heroDefs.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES, ATTACK_MELEE, ATTACK_SPECIAL_MELEE, ATTACK_SUPERMOVE } from '../heroDefs.js';

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
  const f = h.heroDef.specialMelee.frames;
  h.specialMeleeActive = true;
  h.specialMeleePhase = 'active';
  h.specialMeleeFrame = f.windup; // first active frame
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
  assert.ok(kb, 'sweep must expose a non-null knockback setting');
  assert.equal(kb.base, 320);
  assert.equal(kb.scaleBySpeed, 0.4);
  assert.equal(kb.hitstun, 0.28);
  assert.equal(kb.dirMode, 'alongVelocity'); // shove along the lunge velocity
});

ok('scarlet cartwheel carries strong escape shove away', () => {
  const kb = HEROES.scarlet.specialMelee.knockback;
  assert.ok(kb, 'cartwheel must expose a non-null knockback setting');
  assert.equal(kb.base, 360);
  assert.equal(kb.scaleBySpeed, 0.4);
  assert.equal(kb.hitstun, 0.30);
  assert.equal(kb.dirMode, 'fromAttacker'); // shove away from the hero
});

ok('supermove (both heroes) carries the strongest launch', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const kb = HEROES[id].attacks[ATTACK_SUPERMOVE].knockback;
    assert.ok(kb, `${id} supermove must expose a non-null knockback setting`);
    assert.equal(kb.base, 600);
    assert.equal(kb.scaleBySpeed, 0.5);
    assert.equal(kb.hitstun, 0.50);
    assert.equal(kb.dirMode, 'alongVelocity'); // scales with dash speed
  }
});

ok('normal melee carries NO knockback (damage only, v1)', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const entry = HEROES[id].attacks[ATTACK_MELEE];
    assert.equal(entry.knockback, undefined, `${id} melee must not carry knockback`);
    for (const frame of entry.frames) {
      if (frame) assert.equal(frame.knockback, undefined, 'melee frames must not carry knockback');
    }
  }
});

ok('thorn / special projectile definitions carry NO knockback', () => {
  // Friendly projectiles (thorn, saw, bomb) live in projectile.js, not heroDefs —
  // they never flow through attackHitboxWorld and must have no knockback data
  // attached to any hero attack definition.
  for (const id of ['scarlet', 'balthazar']) {
    const def = HEROES[id];
    assert.equal(def.attacks.knockback, undefined);
    assert.equal(def.specialMelee.hitbox.knockback, undefined, 'knockback sits beside the hitbox, not inside it');
  }
});

ok('strength ordering: super base > cartwheel base > sweep base', () => {
  const superBase = HEROES.scarlet.attacks[ATTACK_SUPERMOVE].knockback.base;
  const cartwheelBase = HEROES.scarlet.specialMelee.knockback.base;
  const sweepBase = HEROES.balthazar.specialMelee.knockback.base;
  assert.ok(superBase > cartwheelBase, `super (${superBase}) must exceed cartwheel (${cartwheelBase})`);
  assert.ok(cartwheelBase > sweepBase, `cartwheel (${cartwheelBase}) must exceed sweep (${sweepBase})`);
});

console.log('Resolved world box exposes knockback (hb.knockback source)');

ok('sweep hitbox resolves with its knockback setting', () => {
  const h = makeHero('balthazar');
  setSpecialActive(h);
  const box = h.attackHitboxWorld(ATTACK_SPECIAL_MELEE);
  assert.ok(box, 'active-phase sweep must resolve a box');
  assert.deepEqual(box.knockback, HEROES.balthazar.specialMelee.knockback);
});

ok('cartwheel hitbox resolves with its knockback setting', () => {
  const h = makeHero('scarlet');
  setSpecialActive(h);
  const box = h.attackHitboxWorld(ATTACK_SPECIAL_MELEE);
  assert.ok(box, 'active-phase cartwheel must resolve a box');
  assert.deepEqual(box.knockback, HEROES.scarlet.specialMelee.knockback);
});

ok('supermove hitbox resolves with its knockback setting (both heroes)', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const h = makeHero(id);
    startDash(h);
    const box = h.attackHitboxWorld(ATTACK_SUPERMOVE);
    assert.ok(box, `${id} dashing hero must resolve a supermove box`);
    assert.deepEqual(box.knockback, HEROES[id].attacks[ATTACK_SUPERMOVE].knockback);
  }
});

ok('normal melee hitbox resolves WITHOUT knockback', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const h = makeHero(id);
    setSwingFrame(h, 3); // active frame per MELEE_HITBOX_FRAMES
    const box = h.attackHitboxWorld(ATTACK_MELEE);
    assert.ok(box, 'active-frame melee must resolve a box');
    assert.equal(box.knockback, undefined, 'melee box must carry no knockback');
  }
});

console.log(`\n${passed} assertions passed.`);
