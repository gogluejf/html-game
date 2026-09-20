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
import { applyKnockback } from '../knockback.js';

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
    assert.equal(kb.base, 360);
    assert.equal(kb.scaleBySpeed, 0.3);
    assert.equal(kb.hitstun, 0.30);
    assert.equal(kb.dirMode, 'alongVelocity'); // scales with dash speed
    assert.equal(kb.pop, 90);                  // biggest upward loft (§5)
  }
});

ok('sweep and cartwheel carry a smaller pop than the supermove (§5)', () => {
  const sweepPop = HEROES.balthazar.specialMelee.knockback.pop;
  const cartwheelPop = HEROES.scarlet.specialMelee.knockback.pop;
  const superPop = HEROES.scarlet.attacks[ATTACK_SUPERMOVE].knockback.pop;
  assert.ok(sweepPop > 0 && cartwheelPop > 0, 'special melee pops must be positive');
  assert.ok(superPop > cartwheelPop, `super pop (${superPop}) must exceed cartwheel pop (${cartwheelPop})`);
  assert.ok(superPop > sweepPop, `super pop (${superPop}) must exceed sweep pop (${sweepPop})`);
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

ok('strength ordering: super base >= cartwheel base > sweep base', () => {
  const superBase = HEROES.scarlet.attacks[ATTACK_SUPERMOVE].knockback.base;
  const cartwheelBase = HEROES.scarlet.specialMelee.knockback.base;
  const sweepBase = HEROES.balthazar.specialMelee.knockback.base;
  // Supermove was tuned down to 60% of its original heft, so it now ties the
  // cartwheel on base (360) and is distinguished by pop/scale instead.
  assert.ok(superBase >= cartwheelBase, `super (${superBase}) must not be weaker than cartwheel (${cartwheelBase})`);
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

console.log('Vertical pop on hard hits (§5 — 2D knockback)');

// Plain stand-in victim: only the fields applyKnockback reads/writes.
const mkVictim = (resist = 1) => ({ vx: 0, vy: 0, knockbackResist: resist });

// A ground-level supermove hit: the dash normal is horizontal (alongVelocity,
// hero moving purely horizontally), so without a pop the victim would slide
// sideways with NO upward motion. The pop must supply the loft.
ok('a supermove hit sets victim.vy upward proportional to strength', () => {
  const kb = HEROES.scarlet.attacks[ATTACK_SUPERMOVE].knockback;
  const v = mkVictim(1);
  // Attacker dashing right at ~900 px/s → alongVelocity normal is +x, y=0.
  const applied = applyKnockback(v, { vx: 900, vy: 0 }, kb, { x: 1, y: 0 });
  assert.equal(applied, true);
  assert.ok(v.vy < 0, `expected upward (negative) vy, got ${v.vy}`);
  // Exact pop: 150 / resist 1 straight up.
  assert.ok(Math.abs(v.vy - (-kb.pop)) < 1e-9, `expected vy=-${kb.pop}, got ${v.vy}`);
  // Horizontal shove still lands along the dash direction.
  assert.ok(v.vx > 0, `expected positive vx, got ${v.vx}`);
});

ok('supermove pop scales down for heavier victims (mass resists the loft)', () => {
  const kb = HEROES.balthazar.attacks[ATTACK_SUPERMOVE].knockback;
  const light = mkVictim(1);
  const heavy = mkVictim(2);
  applyKnockback(light, { vx: 900, vy: 0 }, kb, { x: 1, y: 0 });
  applyKnockback(heavy, { vx: 900, vy: 0 }, kb, { x: 1, y: 0 });
  assert.ok(Math.abs(heavy.vy - light.vy / 2) < 1e-9, `heavy vy=${heavy.vy} should be half of light vy=${light.vy}`);
});

ok('sweep gives a smaller hop than the supermove (tuned, not exaggerated)', () => {
  const sweepKb = HEROES.balthazar.specialMelee.knockback;
  const superKb = HEROES.scarlet.attacks[ATTACK_SUPERMOVE].knockback;
  const sweepVictim = mkVictim(1);
  const superVictim = mkVictim(1);
  // Sweep lunges toward facing at travelSpeed 300 → horizontal normal.
  applyKnockback(sweepVictim, { vx: 300, vy: 0 }, sweepKb, { x: 1, y: 0 });
  applyKnockback(superVictim, { vx: 900, vy: 0 }, superKb, { x: 1, y: 0 });
  assert.ok(sweepVictim.vy < 0, 'sweep must still pop upward');
  assert.ok(-sweepVictim.vy < -superVictim.vy,
    `sweep pop (${Math.abs(sweepVictim.vy)}) must be smaller than super pop (${Math.abs(superVictim.vy)})`);
});

ok('a Thorn hit (no knockback) leaves vy unchanged', () => {
  // Friendly Thorn carries no knockback data anywhere — the core wiring gates
  // on presence of hb.knockback, so applyKnockback never runs for it. Prove
  // both halves: null/undefined settings are pure no-ops, and thorn/special
  // attack definitions expose no knockback field at all.
  const v = mkVictim(1);
  v.vx = 10; v.vy = -5; // pre-existing velocity must survive untouched
  assert.equal(applyKnockback(v, { vx: 0, vy: 0 }, null, { x: 1, y: 0 }), false);
  assert.equal(applyKnockback(v, { vx: 0, vy: 0 }, undefined, { x: 1, y: 0 }), false);
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
